import { z } from "zod";

export const workerAiConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  GENERATION_JOB_QUEUE: z.string().min(1).default("generation-jobs"),
  AI_PROVIDER: z.enum(["mock"]).default("mock"),
  AI_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  CANDIDATES_PER_BATCH: z.coerce.number().int().min(1).max(8).default(4),
  AI_MAX_COST_MICROS: z.coerce.number().int().min(0).default(0),
});

export type WorkerAiConfig = z.infer<typeof workerAiConfigSchema>;

export function loadWorkerAiConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerAiConfig {
  return workerAiConfigSchema.parse(environment);
}
