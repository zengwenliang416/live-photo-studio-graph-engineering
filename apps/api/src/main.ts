import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Pool } from "pg";
import { loadApiConfig } from "./config.js";
import { AppModule } from "./app.module.js";
import { WORKFLOW_TOKENS } from "./workflows/workflow-tokens.js";
import type { OutboxDispatcher } from "./workflows/infrastructure/outbox-dispatcher.js";

async function bootstrap(): Promise<void> {
  const config = loadApiConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  await app.listen(config.PORT, "0.0.0.0");

  const dispatcher = app.get<OutboxDispatcher>(
    WORKFLOW_TOKENS.outboxDispatcher,
  );
  dispatcher.start();

  const shutdown = async (): Promise<void> => {
    dispatcher.stop();
    await app.close();
    const pool = app.get<Pool>(WORKFLOW_TOKENS.pool);
    await pool.end();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  console.info(
    JSON.stringify({
      event: "api.started",
      port: config.PORT,
      graphWorkflowEnabled: config.GRAPH_WORKFLOW_ENABLED,
    }),
  );
}

bootstrap().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: "api.bootstrap_failed",
      message: error instanceof Error ? error.name : "UnknownError",
    }),
  );
  process.exitCode = 1;
});
