import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ObjectStoragePort } from "@live-photo-studio/storage";
import { ApplicationProblemError } from "../../http/problem-details.js";
import { hashRequest } from "../../workflows/application/canonical-json.js";
import {
  IdempotencyConflictError,
  type AssetRow,
  type AssetStorePort,
  type AssetTx,
} from "../ports.js";
import type { UPLOAD_CONTENT_TYPES } from "../request-schemas.js";

export type UploadContentType = (typeof UPLOAD_CONTENT_TYPES)[number];

export interface UploadIntentBody {
  readonly contentType: UploadContentType;
  readonly bytes: number;
}

export interface ConfirmUploadBody {
  readonly bytes: number;
  readonly sha256: string;
}

export interface SetProjectCoverBody {
  readonly assetId: string;
}

export interface UseCaseResult {
  readonly status: number;
  readonly body: unknown;
}

export interface AssetUploadOptions {
  readonly uploadMaxBytes: number;
  readonly signedUploadTtlSeconds: number;
}

const SNIFF_PREFIX_BYTES = 16;
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]);

const storedUploadIntentSchema = z.object({
  data: z.object({ assetId: z.string().uuid() }),
});

function notFound(code: string, detail: string): ApplicationProblemError {
  return new ApplicationProblemError(404, code, "Resource not found.", detail);
}

function conflict(code: string, title: string): ApplicationProblemError {
  return new ApplicationProblemError(409, code, title);
}

function unprocessable(code: string, detail: string): ApplicationProblemError {
  return new ApplicationProblemError(
    422,
    code,
    "Request validation failed.",
    detail,
  );
}

function asciiAt(prefix: Uint8Array, start: number, length: number): string {
  return Buffer.from(prefix.subarray(start, start + length)).toString("ascii");
}

/** Sniffs the object prefix and checks it against the declared content type. */
export function matchesDeclaredContentType(
  prefix: Uint8Array,
  contentType: string,
): boolean {
  switch (contentType) {
    case "image/jpeg":
      return (
        prefix.length >= 3 &&
        prefix[0] === 0xff &&
        prefix[1] === 0xd8 &&
        prefix[2] === 0xff
      );
    case "image/png":
      return (
        prefix.length >= 8 &&
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
          (byte, index) => prefix[index] === byte,
        )
      );
    case "image/webp":
      return (
        prefix.length >= 12 &&
        asciiAt(prefix, 0, 4) === "RIFF" &&
        asciiAt(prefix, 8, 4) === "WEBP"
      );
    case "image/heic":
    case "image/heif":
      return (
        prefix.length >= 12 &&
        asciiAt(prefix, 4, 4) === "ftyp" &&
        HEIF_BRANDS.has(asciiAt(prefix, 8, 4))
      );
    default:
      return false;
  }
}

/**
 * Application layer for presigned direct uploads. Object storage calls
 * (signing, stat, magic-byte sniffing) never run inside a database
 * transaction (AGENTS.md §8): intent signs after the insert commits, confirm
 * verifies the object first and only then commits the READY transition
 * together with the idempotency record.
 *
 * Idempotency policy: only successful responses (201/200) are recorded, same
 * as WorkflowService. Validation failures are deterministic and simply
 * recomputed on replay; a replayed content-mismatch confirm deterministically
 * answers ASSET_REJECTED because the asset is already REJECTED.
 */
export class AssetUploadService {
  constructor(
    private readonly store: AssetStorePort,
    private readonly storage: ObjectStoragePort,
    private readonly options: AssetUploadOptions,
  ) {}

  async createUploadIntent(params: {
    projectId: string;
    userId: string;
    idempotencyKey: string;
    body: UploadIntentBody;
  }): Promise<UseCaseResult> {
    const scope = `POST:/v1/projects/${params.projectId}/upload-intents`;
    const requestHash = hashRequest(params.body);
    if (params.body.bytes > this.options.uploadMaxBytes) {
      throw unprocessable(
        "UPLOAD_TOO_LARGE",
        `Declared size exceeds the ${this.options.uploadMaxBytes} byte upload limit.`,
      );
    }
    const attempt = async (): Promise<UseCaseResult> => {
      const prepared = await this.store.transact(async (tx) => {
        const existing = await tx.findIdempotentResponse(
          scope,
          params.idempotencyKey,
          params.userId,
        );
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw conflict(
              "IDEMPOTENCY_KEY_REUSED",
              "The Idempotency-Key was reused with a different request.",
            );
          }
          const record = storedUploadIntentSchema.parse(existing.responseBody);
          const asset = await tx.findAssetById(record.data.assetId);
          if (!asset) {
            throw notFound(
              "ASSET_NOT_FOUND",
              `Asset ${record.data.assetId} was not found.`,
            );
          }
          return asset;
        }
        await tx.assertProjectOwner(params.projectId, params.userId);
        const assetId = randomUUID();
        const objectKey = `projects/${params.projectId}/originals/${assetId}`;
        await tx.insertAsset({
          id: assetId,
          projectId: params.projectId,
          userId: params.userId,
          objectKey,
          contentType: params.body.contentType,
          declaredBytes: params.body.bytes,
        });
        // Only the asset identity is persisted; the short-lived upload URL is
        // re-minted after commit so replays never serve an expired link.
        await tx.recordIdempotentResponse({
          scope,
          idempotencyKey: params.idempotencyKey,
          userId: params.userId,
          requestHash,
          responseStatus: 201,
          responseBody: { data: { assetId } },
        });
        const asset = await tx.findAssetById(assetId);
        if (!asset) {
          throw new Error("project_assets insert returned no row.");
        }
        return asset;
      });
      const signed = await this.storage.createSignedUpload({
        objectKey: prepared.objectKey,
        contentType: prepared.contentType,
        expiresInSeconds: this.options.signedUploadTtlSeconds,
      });
      return {
        status: 201,
        body: {
          data: {
            assetId: prepared.id,
            uploadUrl: signed.url,
            uploadHeaders: signed.headers,
            expiresAt: signed.expiresAt,
          },
        },
      };
    };
    try {
      return await attempt();
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return attempt();
      }
      throw error;
    }
  }

  async confirmUpload(params: {
    assetId: string;
    userId: string;
    idempotencyKey: string;
    body: ConfirmUploadBody;
  }): Promise<UseCaseResult> {
    const scope = `POST:/v1/assets/${params.assetId}/confirm`;
    const requestHash = hashRequest(params.body);
    const attempt = async (): Promise<UseCaseResult> => {
      const phase = await this.store.transact(async (tx) => {
        const existing = await tx.findIdempotentResponse(
          scope,
          params.idempotencyKey,
          params.userId,
        );
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw conflict(
              "IDEMPOTENCY_KEY_REUSED",
              "The Idempotency-Key was reused with a different request.",
            );
          }
          return {
            replay: {
              status: existing.responseStatus,
              body: existing.responseBody,
            },
          };
        }
        const asset = await tx.findAssetById(params.assetId);
        if (!asset || asset.userId !== params.userId) {
          throw notFound(
            "ASSET_NOT_FOUND",
            `Asset ${params.assetId} was not found.`,
          );
        }
        if (asset.status === "REJECTED") {
          throw conflict(
            "ASSET_REJECTED",
            "The asset upload was rejected and cannot be confirmed.",
          );
        }
        if (asset.status === "READY") {
          throw conflict(
            "ASSET_ALREADY_CONFIRMED",
            "The asset upload was already confirmed.",
          );
        }
        return { asset };
      });
      if ("replay" in phase) {
        return phase.replay;
      }
      const asset: AssetRow = phase.asset;
      const stat = await this.storage.statObject(asset.objectKey);
      if (!stat) {
        throw conflict(
          "ASSET_OBJECT_MISSING",
          "The uploaded object was not found in storage.",
        );
      }
      if (
        stat.bytes !== asset.declaredBytes ||
        stat.bytes !== params.body.bytes
      ) {
        throw unprocessable(
          "ASSET_SIZE_MISMATCH",
          "The stored object size does not match the declared size.",
        );
      }
      const prefix = await this.storage.readObjectPrefix(
        asset.objectKey,
        SNIFF_PREFIX_BYTES,
      );
      if (!matchesDeclaredContentType(prefix, asset.contentType)) {
        await this.store.transact((tx) => tx.markAssetRejected(asset.id));
        throw unprocessable(
          "ASSET_CONTENT_MISMATCH",
          "The stored object bytes do not match the declared content type.",
        );
      }
      return this.executeIdempotently({
        scope,
        idempotencyKey: params.idempotencyKey,
        userId: params.userId,
        requestHash,
        work: async (tx) => {
          const marked = await tx.markAssetReady(
            asset.id,
            stat.bytes,
            params.body.sha256,
          );
          if (!marked) {
            throw conflict(
              "ASSET_ALREADY_CONFIRMED",
              "The asset upload was already confirmed.",
            );
          }
          return {
            status: 200,
            body: { data: { assetId: asset.id, status: "READY" } },
          };
        },
      });
    };
    try {
      return await attempt();
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return attempt();
      }
      throw error;
    }
  }

  async setProjectCover(params: {
    projectId: string;
    userId: string;
    idempotencyKey: string;
    body: SetProjectCoverBody;
  }): Promise<UseCaseResult> {
    return this.executeIdempotently({
      scope: `POST:/v1/projects/${params.projectId}/cover`,
      idempotencyKey: params.idempotencyKey,
      userId: params.userId,
      requestHash: hashRequest(params.body),
      work: async (tx) => {
        await tx.assertProjectOwner(params.projectId, params.userId);
        const asset = await tx.findAssetById(params.body.assetId);
        if (!asset || asset.projectId !== params.projectId) {
          throw notFound(
            "ASSET_NOT_FOUND",
            `Asset ${params.body.assetId} was not found.`,
          );
        }
        if (asset.status !== "READY") {
          throw unprocessable(
            "ASSET_NOT_READY",
            "Only READY assets can be set as the project cover.",
          );
        }
        await tx.setProjectCover(params.projectId, asset.id);
        return {
          status: 200,
          body: { data: { projectId: params.projectId, coverAssetId: asset.id } },
        };
      },
    });
  }

  private async executeIdempotently(params: {
    scope: string;
    idempotencyKey: string;
    userId: string;
    requestHash: string;
    work: (tx: AssetTx) => Promise<UseCaseResult>;
  }): Promise<UseCaseResult> {
    const attempt = (): Promise<UseCaseResult> =>
      this.store.transact(async (tx) => {
        const existing = await tx.findIdempotentResponse(
          params.scope,
          params.idempotencyKey,
          params.userId,
        );
        if (existing) {
          if (existing.requestHash !== params.requestHash) {
            throw conflict(
              "IDEMPOTENCY_KEY_REUSED",
              "The Idempotency-Key was reused with a different request.",
            );
          }
          return {
            status: existing.responseStatus,
            body: existing.responseBody,
          };
        }
        const result = await params.work(tx);
        await tx.recordIdempotentResponse({
          scope: params.scope,
          idempotencyKey: params.idempotencyKey,
          userId: params.userId,
          requestHash: params.requestHash,
          responseStatus: result.status,
          responseBody: result.body,
        });
        return result;
      });
    // A concurrent identical request may win the unique insert; retry once so
    // the loser serves the stored first response instead of a 500.
    try {
      return await attempt();
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return await attempt();
      }
      throw error;
    }
  }
}
