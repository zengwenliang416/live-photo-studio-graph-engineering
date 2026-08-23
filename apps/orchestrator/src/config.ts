import { z } from "zod";

const environmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  GRAPH_COMMAND_QUEUE: z.string().min(1).default("graph-commands"),
  GRAPH_SIGNAL_QUEUE: z.string().min(1).default("graph-signals"),
  ORCHESTRATOR_CONCURRENCY: z.coerce.number().int().positive().default(4),
  GRAPH_CHECKPOINT_SETUP: z.enum(["true", "false"]).default("false"),
  GRAPH_MAX_REPAIR_ATTEMPTS: z.coerce.number().int().min(0).max(10).default(2),
});

export type OrchestratorConfig = z.infer<typeof environmentSchema>;

export function loadOrchestratorConfig(
  environment: NodeJS.ProcessEnv = process.env,
): OrchestratorConfig {
  return environmentSchema.parse(environment);
}
