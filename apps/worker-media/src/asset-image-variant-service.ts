import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import convertHeic from "heic-convert";
import type { Pool } from "pg";
import type { AssetImageVariantRequestedPayload } from "@live-photo-studio/graph-contracts";
import type { ObjectStoragePort } from "@live-photo-studio/storage";

const execFileAsync = promisify(execFile);
const STALE_CLAIM_SECONDS = 300;

type VariantType = "DISPLAY_PREVIEW" | "MODEL_INPUT";

interface ImageVariantRecipe {
  readonly variantType: VariantType;
  readonly size: string;
  readonly quality: number;
  readonly maxBytes: number;
}

const RECIPES = {
  "display-preview.v1": {
    variantType: "DISPLAY_PREVIEW",
    size: "1280x1280",
    quality: 82,
    maxBytes: 4 * 1024 * 1024,
  },
  "model-input.v1": {
    variantType: "MODEL_INPUT",
    size: "2048x2048",
    quality: 90,
    maxBytes: 10 * 1024 * 1024,
  },
} as const satisfies Record<
  AssetImageVariantRequestedPayload["recipeVersion"],
  ImageVariantRecipe
>;

interface VariantSource {
  readonly assetId: string;
  readonly projectId: string;
  readonly objectKey: string;
  readonly contentType: string;
}

type VariantClaim =
  | { readonly kind: "CLAIMED"; readonly source: VariantSource }
  | { readonly kind: "IN_PROGRESS" }
  | { readonly kind: "ALREADY_DONE" };

export interface AssetImageVariantStorePort {
  claim(payload: AssetImageVariantRequestedPayload): Promise<VariantClaim>;
  complete(
    payload: AssetImageVariantRequestedPayload,
    objectKey: string,
    bytes: number,
  ): Promise<void>;
  fail(
    payload: AssetImageVariantRequestedPayload,
    errorCode: string,
  ): Promise<void>;
}

export interface AssetImageVariantRenderer {
  render(
    input: Uint8Array,
    contentType: string,
    recipe: ImageVariantRecipe,
  ): Promise<Uint8Array>;
}

export class PermanentAssetImageVariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentAssetImageVariantError";
  }
}

export class VipsAssetImageVariantRenderer
  implements AssetImageVariantRenderer
{
  async render(
    input: Uint8Array,
    contentType: string,
    recipe: ImageVariantRecipe,
  ): Promise<Uint8Array> {
    const directory = await mkdtemp(join(tmpdir(), "live-photo-variant-"));
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
          throw new PermanentAssetImageVariantError(
            "ASSET_VARIANT_HEIC_DECODE_FAILED",
          );
        }
      }

      try {
        await execFileAsync(
          "vipsthumbnail",
          [
            thumbnailSource,
            "--size",
            recipe.size,
            "--output",
            `${outputPath}[Q=${recipe.quality},strip,optimize_coding]`,
          ],
          { timeout: 30_000, maxBuffer: 256 * 1024 },
        );
      } catch {
        throw new PermanentAssetImageVariantError(
          "ASSET_VARIANT_RESIZE_FAILED",
        );
      }

      const output = await readFile(outputPath);
      if (
        output.byteLength < 3 ||
        output.byteLength > recipe.maxBytes ||
        output[0] !== 0xff ||
        output[1] !== 0xd8 ||
        output[2] !== 0xff
      ) {
        throw new PermanentAssetImageVariantError(
          "ASSET_VARIANT_OUTPUT_INVALID",
        );
      }
      return output;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export class PgAssetImageVariantStore implements AssetImageVariantStorePort {
  constructor(private readonly pool: Pool) {}

  async claim(
    payload: AssetImageVariantRequestedPayload,
  ): Promise<VariantClaim> {
    const recipe = RECIPES[payload.recipeVersion];
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
        throw new PermanentAssetImageVariantError(
          "ASSET_VARIANT_SOURCE_NOT_READY",
        );
      }

      const objectKey =
        `projects/${payload.projectId}/variants/${payload.assetId}/` +
        `${payload.recipeVersion}.jpg`;
      const inserted = await client.query(
        `INSERT INTO asset_variants (
           id, asset_id, project_id, variant_type, recipe_version,
           object_key, content_type, status
         ) VALUES ($1, $2, $3, $4, $5, $6, 'image/jpeg', 'RUNNING')
         ON CONFLICT (asset_id, variant_type, recipe_version) DO NOTHING
         RETURNING id`,
        [
          randomUUID(),
          payload.assetId,
          payload.projectId,
          recipe.variantType,
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
                  updated_at < now() - make_interval(secs => $5) AS stale
             FROM asset_variants
            WHERE asset_id = $1
              AND project_id = $2
              AND variant_type = $3
              AND recipe_version = $4
            FOR UPDATE`,
          [
            payload.assetId,
            payload.projectId,
            recipe.variantType,
            payload.recipeVersion,
            STALE_CLAIM_SECONDS,
          ],
        );
        const variant = existing.rows[0];
        if (!variant) {
          throw new Error("ASSET_IMAGE_VARIANT_NOT_FOUND");
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
              AND project_id = $2
              AND variant_type = $3
              AND recipe_version = $4`,
          [
            payload.assetId,
            payload.projectId,
            recipe.variantType,
            payload.recipeVersion,
          ],
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
    payload: AssetImageVariantRequestedPayload,
    objectKey: string,
    bytes: number,
  ): Promise<void> {
    const recipe = RECIPES[payload.recipeVersion];
    const result = await this.pool.query(
      `UPDATE asset_variants
          SET status = 'SUCCEEDED',
              object_key = $5,
              content_type = 'image/jpeg',
              bytes = $6,
              error_code = NULL,
              updated_at = now()
        WHERE asset_id = $1
          AND project_id = $2
          AND variant_type = $3
          AND recipe_version = $4
          AND status = 'RUNNING'`,
      [
        payload.assetId,
        payload.projectId,
        recipe.variantType,
        payload.recipeVersion,
        objectKey,
        bytes,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error("ASSET_IMAGE_VARIANT_COMPLETE_SCOPE_MISMATCH");
    }
  }

  async fail(
    payload: AssetImageVariantRequestedPayload,
    errorCode: string,
  ): Promise<void> {
    const recipe = RECIPES[payload.recipeVersion];
    await this.pool.query(
      `UPDATE asset_variants
          SET status = 'FAILED', error_code = $5, updated_at = now()
        WHERE asset_id = $1
          AND project_id = $2
          AND variant_type = $3
          AND recipe_version = $4
          AND status = 'RUNNING'`,
      [
        payload.assetId,
        payload.projectId,
        recipe.variantType,
        payload.recipeVersion,
        errorCode,
      ],
    );
  }
}

export class AssetImageVariantService {
  constructor(
    private readonly store: AssetImageVariantStorePort,
    private readonly storage: ObjectStoragePort,
    private readonly renderer: AssetImageVariantRenderer =
      new VipsAssetImageVariantRenderer(),
  ) {}

  async process(payload: AssetImageVariantRequestedPayload): Promise<
    "SUCCEEDED" | "ALREADY_DONE" | "IN_PROGRESS"
  > {
    const recipe = RECIPES[payload.recipeVersion];
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
        recipe,
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
          error instanceof PermanentAssetImageVariantError
            ? error.message
            : "ASSET_IMAGE_VARIANT_FAILED",
        )
        .catch(() => undefined);
      throw error;
    }
  }
}
