import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);
const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

export const workerAiConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  GENERATION_JOB_QUEUE: z.string().min(1).default("generation-jobs"),
  AI_PROVIDER: z.enum(["mock", "openai-compatible"]).default("mock"),
  AI_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  CANDIDATES_PER_BATCH: z.coerce.number().int().min(1).max(8).default(4),
  AI_MAX_COST_MICROS: z.coerce.number().int().min(0).default(0),
  OPENAI_COMPAT_BASE_URL: optionalUrl,
  OPENAI_COMPAT_API_KEY: optionalSecret,
  OPENAI_IMAGE_MODEL: z.string().min(1).default("gpt-image-2"),
  SETTINGS_ENCRYPTION_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().regex(/^[0-9a-fA-F]{64}$/u).optional(),
  ),
});

export type WorkerAiConfig = z.infer<typeof workerAiConfigSchema>;

export function loadWorkerAiConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerAiConfig {
  return workerAiConfigSchema.parse(environment);
}
