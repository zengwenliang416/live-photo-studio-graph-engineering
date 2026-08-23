import { z } from "zod";

export const apiConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  GRAPH_COMMAND_QUEUE: z.string().min(1).default("graph-commands"),
  GRAPH_SIGNAL_QUEUE: z.string().min(1).default("graph-signals"),
  OUTBOX_DISPATCH_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  OUTBOX_DISPATCH_BATCH_SIZE: z.coerce.number().int().positive().max(200).default(20),
  OUTBOX_VISIBILITY_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  GRAPH_WORKFLOW_ENABLED: z.enum(["true", "false"]).default("true"),
});

export type ApiConfig = z.infer<typeof apiConfigSchema>;

export function loadApiConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  return apiConfigSchema.parse(environment);
}
