import "dotenv/config";
import { UnrecoverableError, Worker } from "bullmq";
import { Redis } from "ioredis";
import type { Pool } from "pg";
import { createAppPool } from "@live-photo-studio/database";
import {
  assetImageVariantRequestedPayloadSchema,
  safeLogEvent,
} from "@live-photo-studio/graph-contracts";
import { createObjectStorageFromEnvironment } from "@live-photo-studio/storage";
import {
  AssetImageVariantService,
  PermanentAssetImageVariantError,
  PgAssetImageVariantStore,
} from "./asset-image-variant-service.js";
import { RenderService } from "./export-service.js";
import {
  renderRequestedPayloadSchema,
} from "./renderer.js";
import { loadWorkerMediaConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadWorkerMediaConfig();
  const pool: Pool = createAppPool(config.DATABASE_URL);
  const connection = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
  const storage = createObjectStorageFromEnvironment();
  const service = new RenderService(
    pool,
    undefined,
    config.EXPORT_DURATION_MS,
    storage,
  );
  const imageVariantService = new AssetImageVariantService(
    new PgAssetImageVariantStore(pool),
    storage,
  );

  const renderWorker = new Worker(
    config.RENDER_JOB_QUEUE,
    async (job) => {
      const payload = renderRequestedPayloadSchema.parse(job.data);
      await service.process(payload);
    },
    { connection, concurrency: config.MEDIA_WORKER_CONCURRENCY },
  );

  renderWorker.on("failed", async (job, error) => {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) return;
    const parsed = renderRequestedPayloadSchema.safeParse(job.data);
    if (!parsed.success) return;
    await service
      .fail(parsed.data, "RENDER_FAILED")
      .catch(() => undefined);
    console.error(JSON.stringify(safeLogEvent("worker_media.job_failed", {
      jobId: job.id,
      workflowRunId: parsed.data.workflowRunId,
      projectId: parsed.data.projectId,
      traceId: parsed.data.traceId,
      externalJobId: parsed.data.jobId,
      message: error instanceof Error ? error.name : "UnknownError",
    })));
  });

  const previewWorker = new Worker(
    config.ASSET_PREVIEW_JOB_QUEUE,
    async (job) => {
      const payload = assetImageVariantRequestedPayloadSchema.parse(job.data);
      try {
        await imageVariantService.process(payload);
      } catch (error) {
        if (error instanceof PermanentAssetImageVariantError) {
          throw new UnrecoverableError(error.message);
        }
        throw error;
      }
    },
    {
      connection,
      concurrency: config.ASSET_PREVIEW_WORKER_CONCURRENCY,
    },
  );

  previewWorker.on("failed", (job, error) => {
    const parsed = assetImageVariantRequestedPayloadSchema.safeParse(job?.data);
    if (!parsed.success) return;
    console.error(
      JSON.stringify(
        safeLogEvent("worker_media.asset_image_variant_failed", {
          jobId: job?.id,
          projectId: parsed.data.projectId,
          assetId: parsed.data.assetId,
          recipeVersion: parsed.data.recipeVersion,
          message: error instanceof Error ? error.name : "UnknownError",
        }),
      ),
    );
  });

  const shutdown = async (): Promise<void> => {
    await Promise.allSettled([
      renderWorker.close(),
      previewWorker.close(),
      connection.quit(),
      pool.end(),
    ]);
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  console.info(JSON.stringify(safeLogEvent("worker_media.started", {
    renderQueue: config.RENDER_JOB_QUEUE,
    assetImageVariantQueue: config.ASSET_PREVIEW_JOB_QUEUE,
    concurrency: config.MEDIA_WORKER_CONCURRENCY,
    assetImageVariantConcurrency: config.ASSET_PREVIEW_WORKER_CONCURRENCY,
  })));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify(safeLogEvent("worker_media.bootstrap_failed", {
    message: error instanceof Error ? error.name : "UnknownError",
  })));
  process.exitCode = 1;
});
