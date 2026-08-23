import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { Pool } from "pg";
import {
  workflowCommandSchema,
  workflowSignalSchema,
} from "@live-photo-studio/graph-contracts";
import { GraphEngine } from "./application/graph-engine.js";
import { createProductionCheckpointer } from "./checkpointer.js";
import { loadOrchestratorConfig } from "./config.js";
import { createGraphRegistry } from "./graph-registry.js";
import {
  PostgresProjectReadAdapter,
  PostgresWorkflowEffectAdapter,
} from "./infrastructure/postgres-effects.js";

async function main(): Promise<void> {
  const config = loadOrchestratorConfig();
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  const redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const checkpointer = await createProductionCheckpointer({
    connectionString: config.DATABASE_URL,
    setup: config.GRAPH_CHECKPOINT_SETUP === "true",
  });

  const registry = createGraphRegistry({
    projects: new PostgresProjectReadAdapter(pool),
    effects: new PostgresWorkflowEffectAdapter(pool),
    checkpointer,
  });
  const engine = new GraphEngine(pool, registry);

  const commandWorker = new Worker(
    config.GRAPH_COMMAND_QUEUE,
    async (job) => {
      await engine.handleCommand(workflowCommandSchema.parse(job.data));
    },
    {
      connection: redis,
      concurrency: config.ORCHESTRATOR_CONCURRENCY,
    },
  );

  const signalWorker = new Worker(
    config.GRAPH_SIGNAL_QUEUE,
    async (job) => {
      await engine.handleSignal(workflowSignalSchema.parse(job.data));
    },
    {
      connection: redis,
      concurrency: config.ORCHESTRATOR_CONCURRENCY,
    },
  );

  const shutdown = async (): Promise<void> => {
    await Promise.allSettled([
      commandWorker.close(),
      signalWorker.close(),
      redis.quit(),
      pool.end(),
    ]);
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

  console.info(
    JSON.stringify({
      event: "orchestrator.started",
      graphCommandQueue: config.GRAPH_COMMAND_QUEUE,
      graphSignalQueue: config.GRAPH_SIGNAL_QUEUE,
      concurrency: config.ORCHESTRATOR_CONCURRENCY,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: "orchestrator.failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }),
  );
  process.exitCode = 1;
});
