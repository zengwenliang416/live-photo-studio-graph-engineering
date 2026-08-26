import { z } from "zod";

export const apiConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  GRAPH_COMMAND_QUEUE: z.string().min(1).default("graph-commands"),
  GRAPH_SIGNAL_QUEUE: z.string().min(1).default("graph-signals"),
  GENERATION_JOB_QUEUE: z.string().min(1).default("generation-jobs"),
  RENDER_JOB_QUEUE: z.string().min(1).default("render-jobs"),
  OUTBOX_DISPATCH_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  OUTBOX_DISPATCH_BATCH_SIZE: z.coerce.number().int().positive().max(200).default(20),
  OUTBOX_VISIBILITY_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  GRAPH_WORKFLOW_ENABLED: z.enum(["true", "false"]).default("true"),
  GRAPH_WORKFLOW_CANARY_USER_IDS: z.string().default(""),
  GRAPH_ADMIN_USER_IDS: z.string().default(""),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(20_971_520),
  SETTINGS_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/u)
    .optional(),
});

export type ApiConfig = z.infer<typeof apiConfigSchema>;

export function loadApiConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  return apiConfigSchema.parse(environment);
}

export const authConfigSchema = z.object({
  AUTH_SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(31_536_000)
    .default(604_800),
  AUTH_MAX_SESSIONS_PER_USER: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10),
  AUTH_COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  AUTH_ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:3000,http://127.0.0.1:3000"),
});

export type AuthConfig = z.infer<typeof authConfigSchema>;

export function loadAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  const config = authConfigSchema.parse(environment);
  if (
    environment["NODE_ENV"] === "production" &&
    config.AUTH_COOKIE_SECURE !== "true"
  ) {
    throw new Error(
      "AUTH_COOKIE_SECURE must be true when NODE_ENV=production.",
    );
  }
  return config;
}
