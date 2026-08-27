import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import convertHeic from "heic-convert";
import type { Pool } from "pg";
import type { AssetPreviewRequestedPayload } from "@live-photo-studio/graph-contracts";
import type { ObjectStoragePort } from "@live-photo-studio/storage";

const execFileAsync = promisify(execFile);
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
const STALE_CLAIM_SECONDS = 300;

interface PreviewSource {
  readonly assetId: string;
  readonly projectId: string;
  readonly objectKey: string;
  readonly contentType: string;
}

type PreviewClaim =
  | { readonly kind: "CLAIMED"; readonly source: PreviewSource }
  | { readonly kind: "IN_PROGRESS" }
  | { readonly kind: "ALREADY_DONE" };

export interface AssetPreviewStorePort {
  claim(payload: AssetPreviewRequestedPayload): Promise<PreviewClaim>;
  complete(
    payload: AssetPreviewRequestedPayload,
    objectKey: string,
    bytes: number,
  ): Promise<void>;
  fail(payload: AssetPreviewRequestedPayload, errorCode: string): Promise<void>;
}

export interface AssetPreviewRenderer {
  render(input: Uint8Array, contentType: string): Promise<Uint8Array>;
}

export class PermanentAssetPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentAssetPreviewError";
  }
}

export class VipsAssetPreviewRenderer implements AssetPreviewRenderer {
  async render(input: Uint8Array, contentType: string): Promise<Uint8Array> {
    const directory = await mkdtemp(join(tmpdir(), "live-photo-preview-"));
    try {
      const extension =
        contentType === "image/png"
          ? "png"
          : contentType === "image/webp"
            ? "webp"
            : contentType === "image/jpeg"
              ? "jpg"
              : "heic";
      const inputPath = join(directory, `input.${extension}`);
      const decodedPath = join(directory, "decoded.jpg");
      const outputPath = join(directory, "preview.jpg");
      await writeFile(inputPath, input);

      let thumbnailSource = inputPath;
      if (contentType === "image/heic" || contentType === "image/heif") {
        try {
          const decoded = await convertHeic({
            buffer: Buffer.from(input),
            format: "JPEG",
            quality: 0.9,
          });
          await writeFile(decodedPath, decoded);
          thumbnailSource = decodedPath;
        } catch {
          throw new PermanentAssetPreviewError("ASSET_PREVIEW_HEIC_DECODE_FAILED");
        }
      }

      try {
        await execFileAsync(
          "vipsthumbnail",
          [
            thumbnailSource,
            "--size",
            "1280x1280",
            "--output",
            `${outputPath}[Q=82,strip,optimize_coding]`,
          ],
          { timeout: 30_000, maxBuffer: 256 * 1024 },
        );
      } catch {
        throw new PermanentAssetPreviewError("ASSET_PREVIEW_RESIZE_FAILED");
      }

      const output = await readFile(outputPath);
      if (
        output.byteLength < 3 ||
        output.byteLength > MAX_PREVIEW_BYTES ||
        output[0] !== 0xff ||
        output[1] !== 0xd8 ||
        output[2] !== 0xff
      ) {
        throw new PermanentAssetPreviewError("ASSET_PREVIEW_OUTPUT_INVALID");
      }
      return output;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export class PgAssetPreviewStore implements AssetPreviewStorePort {
  constructor(private readonly pool: Pool) {}

  async claim(payload: AssetPreviewRequestedPayload): Promise<PreviewClaim> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const assetResult = await client.query<{
        id: string;
        project_id: string;
        object_key: string;
        content_type: string;
        status: string;
      }>(
        `SELECT id, project_id, object_key, content_type, status
           FROM project_assets
          WHERE id = $1 AND project_id = $2
          FOR UPDATE`,
        [payload.assetId, payload.projectId],
      );
      const asset = assetResult.rows[0];
      if (!asset || asset.status !== "READY") {
        throw new PermanentAssetPreviewError("ASSET_PREVIEW_SOURCE_NOT_READY");
      }

      const objectKey =
        `projects/${payload.projectId}/variants/${payload.assetId}/` +
        `${payload.recipeVersion}.jpg`;
      const inserted = await client.query(
        `INSERT INTO asset_variants (
           id, asset_id, project_id, variant_type, recipe_version,
           object_key, content_type, status
         ) VALUES ($1, $2, $3, 'DISPLAY_PREVIEW', $4, $5, 'image/jpeg', 'RUNNING')
         ON CONFLICT (asset_id, variant_type, recipe_version) DO NOTHING
         RETURNING id`,
        [
          randomUUID(),
          payload.assetId,
          payload.projectId,
          payload.recipeVersion,
          objectKey,
        ],
      );
      if (inserted.rowCount === 0) {
        const existing = await client.query<{
          status: "RUNNING" | "SUCCEEDED" | "FAILED";
          stale: boolean;
        }>(
          `SELECT status,
                  updated_at < now() - make_interval(secs => $4) AS stale
             FROM asset_variants
            WHERE asset_id = $1
              AND project_id = $2
              AND variant_type = 'DISPLAY_PREVIEW'
              AND recipe_version = $3
            FOR UPDATE`,
          [
            payload.assetId,
            payload.projectId,
            payload.recipeVersion,
            STALE_CLAIM_SECONDS,
          ],
        );
        const variant = existing.rows[0];
        if (!variant) {
          throw new Error("ASSET_PREVIEW_VARIANT_NOT_FOUND");
        }
        if (variant.status === "SUCCEEDED") {
          await client.query("COMMIT");
          return { kind: "ALREADY_DONE" };
        }
        if (variant.status === "RUNNING" && !variant.stale) {
          await client.query("COMMIT");
          return { kind: "IN_PROGRESS" };
        }
        await client.query(
          `UPDATE asset_variants
              SET status = 'RUNNING', error_code = NULL, updated_at = now()
            WHERE asset_id = $1
              AND variant_type = 'DISPLAY_PREVIEW'
              AND recipe_version = $2`,
          [payload.assetId, payload.recipeVersion],
        );
      }
      await client.query("COMMIT");
      return {
        kind: "CLAIMED",
        source: {
          assetId: asset.id,
          projectId: asset.project_id,
          objectKey: asset.object_key,
          contentType: asset.content_type,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(
    payload: AssetPreviewRequestedPayload,
    objectKey: string,
    bytes: number,
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE asset_variants
          SET status = 'SUCCEEDED',
              object_key = $4,
              content_type = 'image/jpeg',
              bytes = $5,
              error_code = NULL,
              updated_at = now()
        WHERE asset_id = $1
          AND project_id = $2
          AND recipe_version = $3
          AND variant_type = 'DISPLAY_PREVIEW'
          AND status = 'RUNNING'`,
      [
        payload.assetId,
        payload.projectId,
        payload.recipeVersion,
        objectKey,
        bytes,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error("ASSET_PREVIEW_COMPLETE_SCOPE_MISMATCH");
    }
  }

  async fail(
    payload: AssetPreviewRequestedPayload,
    errorCode: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE asset_variants
          SET status = 'FAILED', error_code = $4, updated_at = now()
        WHERE asset_id = $1
          AND project_id = $2
          AND recipe_version = $3
          AND variant_type = 'DISPLAY_PREVIEW'
          AND status = 'RUNNING'`,
      [payload.assetId, payload.projectId, payload.recipeVersion, errorCode],
    );
  }
}

export class AssetPreviewService {
  constructor(
    private readonly store: AssetPreviewStorePort,
    private readonly storage: ObjectStoragePort,
    private readonly renderer: AssetPreviewRenderer = new VipsAssetPreviewRenderer(),
  ) {}

  async process(payload: AssetPreviewRequestedPayload): Promise<
    "SUCCEEDED" | "ALREADY_DONE" | "IN_PROGRESS"
  > {
    const claim = await this.store.claim(payload);
    if (claim.kind === "ALREADY_DONE") return "ALREADY_DONE";
    if (claim.kind === "IN_PROGRESS") return "IN_PROGRESS";

    const outputKey =
      `projects/${payload.projectId}/variants/${payload.assetId}/` +
      `${payload.recipeVersion}.jpg`;
    try {
      const input = await this.storage.getObject(claim.source.objectKey);
      const preview = await this.renderer.render(
        input,
        claim.source.contentType,
      );
      const stored = await this.storage.putObject({
        objectKey: outputKey,
        body: preview,
        contentType: "image/jpeg",
      });
      await this.store.complete(payload, stored.objectKey, stored.bytes);
      return "SUCCEEDED";
    } catch (error) {
      await this.store
        .fail(
          payload,
          error instanceof PermanentAssetPreviewError
            ? error.message
            : "ASSET_PREVIEW_FAILED",
        )
        .catch(() => undefined);
      throw error;
    }
  }
}
