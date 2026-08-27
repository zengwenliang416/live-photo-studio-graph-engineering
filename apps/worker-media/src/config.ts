import { z } from "zod";

export const workerMediaConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  RENDER_JOB_QUEUE: z.string().min(1).default("render-jobs"),
  ASSET_PREVIEW_JOB_QUEUE: z.string().min(1).default("asset-preview-jobs"),
  MEDIA_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  ASSET_PREVIEW_WORKER_CONCURRENCY: z.coerce
    .number()
    .int()
    .positive()
    .default(1),
  FFMPEG_PATH: z.string().min(1).default("ffmpeg"),
  FFPROBE_PATH: z.string().min(1).default("ffprobe"),
});

export type WorkerMediaConfig = z.infer<typeof workerMediaConfigSchema>;

export function loadWorkerMediaConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerMediaConfig {
  return workerMediaConfigSchema.parse(environment);
}
