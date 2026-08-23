import "dotenv/config";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import type { Pool } from "pg";
import { createAppPool } from "@live-photo-studio/database";
import {
  GenerationService,
} from "./generation-service.js";
import {
  generationRequestedPayloadSchema,
  MockImageGenerationProvider,
} from "./provider.js";
import { loadWorkerAiConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadWorkerAiConfig();
  const pool: Pool = createAppPool(config.DATABASE_URL);
  const connection = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  const provider = new MockImageGenerationProvider();
  const service = new GenerationService(pool, provider);

  const worker = new Worker(
    config.GENERATION_JOB_QUEUE,
    async (job) => {
      // Payloads carry IDs and small configuration only.
      const payload = generationRequestedPayloadSchema.parse(job.data);
      await service.process(payload);
    },
    {
      connection,
      concurrency: config.AI_WORKER_CONCURRENCY,
    },
  );

  worker.on("failed", async (job, error) => {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) return; // transient retry still pending
    const parsed = generationRequestedPayloadSchema.safeParse(job.data);
    if (!parsed.success) return;
    await service
      .fail(parsed.data, "GENERATION_FAILED")
      .catch(() => undefined);
    console.error(
      JSON.stringify({
        event: "worker_ai.job_failed",
        jobId: job.id,
        message: error instanceof Error ? error.name : "UnknownError",
      }),
    );
  });

  const shutdown = async (): Promise<void> => {
    await Promise.allSettled([worker.close(), connection.quit(), pool.end()]);
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  console.info(
    JSON.stringify({
      event: "worker_ai.started",
      queue: config.GENERATION_JOB_QUEUE,
      provider: provider.name,
      concurrency: config.AI_WORKER_CONCURRENCY,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: "worker_ai.bootstrap_failed",
      message: error instanceof Error ? error.name : "UnknownError",
    }),
  );
  process.exitCode = 1;
});
