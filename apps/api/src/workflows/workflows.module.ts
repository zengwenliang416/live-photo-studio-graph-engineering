import { Inject, Module, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { Pool } from "pg";
import type { ApiConfig } from "../config.js";
import { PgWorkflowUnit } from "./infrastructure/pg-workflow-unit.js";
import {
  OutboxDispatcher,
  type OutboxQueuePair,
} from "./infrastructure/outbox-dispatcher.js";
import { WorkflowService } from "./application/workflow-service.js";
import { WorkflowsController } from "./workflows.controller.js";
import { WORKFLOW_TOKENS } from "./workflow-tokens.js";
import { ApiDatabaseModule } from "../database/api-database.module.js";

@Module({
  imports: [ApiDatabaseModule],
  controllers: [WorkflowsController],
  providers: [
    {
      provide: WORKFLOW_TOKENS.workflowUnit,
      inject: [WORKFLOW_TOKENS.pool],
      useFactory: (pool: Pool) => new PgWorkflowUnit(pool),
    },
    {
      provide: WorkflowService,
      inject: [WORKFLOW_TOKENS.workflowUnit],
      useFactory: (unit: PgWorkflowUnit) => new WorkflowService(unit),
    },
    {
      provide: WORKFLOW_TOKENS.outboxQueues,
      inject: [WORKFLOW_TOKENS.config],
      useFactory: (config: ApiConfig): OutboxQueuePair => {
        const connection = new Redis(config.REDIS_URL, {
          maxRetriesPerRequest: null,
          lazyConnect: false,
        });
        const build = (name: string): Queue =>
          new Queue(name, { connection });
        return {
          commands: build(config.GRAPH_COMMAND_QUEUE),
          signals: build(config.GRAPH_SIGNAL_QUEUE),
        };
      },
    },
    {
      provide: WORKFLOW_TOKENS.outboxDispatcher,
      inject: [
        WORKFLOW_TOKENS.pool,
        WORKFLOW_TOKENS.outboxQueues,
        WORKFLOW_TOKENS.config,
      ],
      useFactory: (
        pool: Pool,
        queues: OutboxQueuePair,
        config: ApiConfig,
      ) =>
        new OutboxDispatcher(pool, queues, {
          intervalMs: config.OUTBOX_DISPATCH_INTERVAL_MS,
          batchSize: config.OUTBOX_DISPATCH_BATCH_SIZE,
          visibilityTimeoutMs: config.OUTBOX_VISIBILITY_TIMEOUT_MS,
        }),
    },
  ],
  exports: [WORKFLOW_TOKENS.outboxQueues, WORKFLOW_TOKENS.outboxDispatcher],
})
export class WorkflowsModule implements OnModuleDestroy {
  constructor(
    @Inject(WORKFLOW_TOKENS.outboxQueues)
    private readonly queues: OutboxQueuePair,
    @Inject(WORKFLOW_TOKENS.outboxDispatcher)
    private readonly dispatcher: OutboxDispatcher,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.dispatcher.stop();
    await Promise.allSettled([
      this.queues.commands.close(),
      this.queues.signals.close(),
    ]);
  }
}
