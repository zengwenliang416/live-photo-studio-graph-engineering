import type { Pool, PoolClient } from "pg";
import { withTransaction } from "@live-photo-studio/database";
import { ApplicationProblemError } from "../../http/problem-details.js";
import {
  IdempotencyConflictError,
  type AssetRow,
  type AssetStatus,
  type AssetStorePort,
  type AssetTx,
  type ConfirmedAssetRole,
  type LivePhotoPairRow,
  type StoredIdempotentResponse,
} from "../ports.js";

function isUniqueViolation(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function mapAssetRow(row: Record<string, unknown>): AssetRow {
  const bytes = row["bytes"];
  const sha256 = row["sha256"];
  return {
    id: row["id"] as string,
    projectId: row["project_id"] as string,
    userId: row["user_id"] as string,
    objectKey: row["object_key"] as string,
    contentType: row["content_type"] as string,
    declaredBytes: row["declared_bytes"] as number,
    bytes: typeof bytes === "number" ? bytes : null,
    sha256: typeof sha256 === "string" ? sha256 : null,
    status: row["status"] as AssetStatus,
    createdAt: (row["created_at"] as Date).toISOString(),
  };
}

const ASSET_COLUMNS =
  "id, project_id, user_id, object_key, content_type, declared_bytes, bytes, sha256, status, created_at";

export class PgAssetStore implements AssetStorePort {
  constructor(private readonly pool: Pool) {}

  async transact<T>(work: (tx: AssetTx) => Promise<T>): Promise<T> {
    try {
      return await withTransaction(this.pool, (client) =>
        work(new PgAssetTx(client)),
      );
    } catch (error) {
      // The idempotency primary key turns a concurrent duplicate request into
      // a typed retry signal; the application layer retries and replays.
      if (
        isUniqueViolation(error) &&
        String((error as { constraint?: unknown }).constraint ?? "").startsWith(
          "idempotency_keys_pkey",
        )
      ) {
        throw new IdempotencyConflictError();
      }
      throw error;
    }
  }
}

class PgAssetTx implements AssetTx {
  constructor(private readonly client: PoolClient) {}

  async assertProjectOwner(projectId: string, userId: string): Promise<void> {
    const result = await this.client.query(
      "SELECT 1 FROM projects WHERE id = $1 AND user_id = $2",
      [projectId, userId],
    );
    if (result.rowCount === 0) {
      // Existence is not leaked: a foreign project answers 404 like a missing one.
      throw new ApplicationProblemError(
        404,
        "PROJECT_NOT_FOUND",
        "Resource not found.",
        `Project ${projectId} was not found.`,
      );
    }
  }

  async insertAsset(input: {
    id: string;
    projectId: string;
    userId: string;
    objectKey: string;
    contentType: string;
    declaredBytes: number;
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO project_assets (
         id, project_id, user_id, object_key, content_type, declared_bytes, status
       ) VALUES ($1, $2, $3, $4, $5, $6, 'UPLOADING')`,
      [
        input.id,
        input.projectId,
        input.userId,
        input.objectKey,
        input.contentType,
        input.declaredBytes,
      ],
    );
  }

  async findAssetById(assetId: string): Promise<AssetRow | null> {
    const result = await this.client.query<Record<string, unknown>>(
      `SELECT ${ASSET_COLUMNS} FROM project_assets WHERE id = $1`,
      [assetId],
    );
    const row = result.rows[0];
    return row ? mapAssetRow(row) : null;
  }

  async markAssetReady(
    assetId: string,
    bytes: number,
    sha256: string,
    role: ConfirmedAssetRole,
  ): Promise<boolean> {
    const update = await this.client.query(
      `UPDATE project_assets
          SET status = 'READY', bytes = $2, sha256 = $3, confirmed_at = now()
        WHERE id = $1 AND status = 'UPLOADING'
        RETURNING id`,
      [assetId, bytes, sha256],
    );
    if (update.rowCount !== 1) return false;
    await this.client.query(
      `INSERT INTO asset_roles (project_id, asset_id, role)
       SELECT project_id, id, $2 FROM project_assets WHERE id = $1
       ON CONFLICT DO NOTHING`,
      [assetId, role],
    );
    return true;
  }

  async insertAssetPreviewRequest(input: {
    eventId: string;
    assetId: string;
    projectId: string;
  }): Promise<void> {
    await this.insertAssetImageVariantRequest({
      ...input,
      eventType: "asset.preview.requested.v1",
      recipeVersion: "display-preview.v1",
    });
  }

  async insertAssetModelInputRequest(input: {
    eventId: string;
    assetId: string;
    projectId: string;
  }): Promise<void> {
    await this.insertAssetImageVariantRequest({
      ...input,
      eventType: "asset.model-input.requested.v1",
      recipeVersion: "model-input.v1",
    });
  }

  private async insertAssetImageVariantRequest(input: {
    eventId: string;
    assetId: string;
    projectId: string;
    eventType:
      | "asset.preview.requested.v1"
      | "asset.model-input.requested.v1";
    recipeVersion: "display-preview.v1" | "model-input.v1";
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO outbox_events (
         id, aggregate_type, aggregate_id, event_type, payload
       ) VALUES ($1, 'asset', $2, $3, $4::jsonb)`,
      [
        input.eventId,
        input.assetId,
        input.eventType,
        JSON.stringify({
          jobId: input.eventId,
          projectId: input.projectId,
          assetId: input.assetId,
          recipeVersion: input.recipeVersion,
        }),
      ],
    );
  }

  async markAssetRejected(assetId: string): Promise<void> {
    await this.client.query(
      `UPDATE project_assets
          SET status = 'REJECTED'
        WHERE id = $1 AND status = 'UPLOADING'`,
      [assetId],
    );
  }

  async setProjectCover(projectId: string, assetId: string): Promise<void> {
    await this.client.query(
      "UPDATE projects SET cover_asset_id = $2, updated_at = now() WHERE id = $1",
      [projectId, assetId],
    );
    await this.client.query(
      `INSERT INTO asset_roles (project_id, asset_id, role)
       VALUES ($1, $2, 'COVER')
       ON CONFLICT DO NOTHING`,
      [projectId, assetId],
    );
  }

  async insertLivePhotoPair(input: {
    id: string;
    projectId: string;
    photoAssetId: string;
    videoAssetId: string;
  }): Promise<LivePhotoPairRow> {
    try {
      const result = await this.client.query<Record<string, unknown>>(
        `INSERT INTO live_photo_pairs (
           id, project_id, photo_asset_id, video_asset_id
         ) VALUES ($1, $2, $3, $4)
         RETURNING id, project_id, photo_asset_id, video_asset_id, status, created_at`,
        [
          input.id,
          input.projectId,
          input.photoAssetId,
          input.videoAssetId,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("live_photo_pairs insert returned no row.");
      return {
        id: row["id"] as string,
        projectId: row["project_id"] as string,
        photoAssetId: row["photo_asset_id"] as string,
        videoAssetId: row["video_asset_id"] as string,
        status: row["status"] as "PAIRED",
        createdAt: (row["created_at"] as Date).toISOString(),
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApplicationProblemError(
          409,
          "LIVE_PHOTO_ASSET_ALREADY_PAIRED",
          "One of the assets already belongs to a Live Photo pair.",
        );
      }
      throw error;
    }
  }

  async findIdempotentResponse(
    scope: string,
    idempotencyKey: string,
    userId: string,
  ): Promise<StoredIdempotentResponse | null> {
    const result = await this.client.query<{
      request_hash: string;
      response_status: number;
      response_body: unknown;
    }>(
      `SELECT request_hash, response_status, response_body
         FROM idempotency_keys
        WHERE scope = $1 AND idempotency_key = $2 AND user_id = $3
        FOR UPDATE`,
      [scope, idempotencyKey, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      requestHash: row.request_hash,
      responseStatus: row.response_status,
      responseBody: row.response_body,
    };
  }

  async recordIdempotentResponse(input: {
    scope: string;
    idempotencyKey: string;
    userId: string;
    requestHash: string;
    responseStatus: number;
    responseBody: unknown;
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO idempotency_keys (
         scope, idempotency_key, user_id, request_hash,
         response_status, response_body
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        input.scope,
        input.idempotencyKey,
        input.userId,
        input.requestHash,
        input.responseStatus,
        JSON.stringify(input.responseBody),
      ],
    );
  }
}
