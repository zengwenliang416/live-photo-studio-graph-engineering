import "dotenv/config";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import type { Pool } from "pg";
import { createAppPool } from "@live-photo-studio/database";
import { safeLogEvent } from "@live-photo-studio/graph-contracts";
import { createObjectStorageFromEnvironment } from "@live-photo-studio/storage";
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
  const service = new RenderService(
    pool,
    undefined,
    config.EXPORT_DURATION_MS,
    createObjectStorageFromEnvironment(),
  );

  const worker = new Worker(
    config.RENDER_JOB_QUEUE,
    async (job) => {
      const payload = renderRequestedPayloadSchema.parse(job.data);
      await service.process(payload);
    },
    { connection, concurrency: config.MEDIA_WORKER_CONCURRENCY },
  );

  worker.on("failed", async (job, error) => {
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

  const shutdown = async (): Promise<void> => {
    await Promise.allSettled([worker.close(), connection.quit(), pool.end()]);
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  console.info(JSON.stringify(safeLogEvent("worker_media.started", {
    queue: config.RENDER_JOB_QUEUE,
    concurrency: config.MEDIA_WORKER_CONCURRENCY,
  })));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify(safeLogEvent("worker_media.bootstrap_failed", {
    message: error instanceof Error ? error.name : "UnknownError",
  })));
  process.exitCode = 1;
});
