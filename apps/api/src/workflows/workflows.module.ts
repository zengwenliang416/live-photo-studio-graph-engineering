import { Inject, Module, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { Pool } from "pg";
import {
  createObjectStorageFromEnvironment,
  loadObjectStorageEnvironment,
} from "@live-photo-studio/storage";
import type { ApiConfig } from "../config.js";
import { PgWorkflowUnit } from "./infrastructure/pg-workflow-unit.js";
import {
  OutboxDispatcher,
  type OutboxQueuePair,
} from "./infrastructure/outbox-dispatcher.js";
import { WorkflowService } from "./application/workflow-service.js";
import { WorkflowsController } from "./workflows.controller.js";
import { WorkflowEventsController } from "./workflow-events.controller.js";
import { WORKFLOW_TOKENS } from "./workflow-tokens.js";
import { ApiDatabaseModule } from "../database/api-database.module.js";
import {
  WorkflowOperationsService,
} from "./application/workflow-operations-service.js";
import { PgWorkflowOperations } from "./infrastructure/pg-workflow-operations.js";
import { WorkflowOperationsController } from "./workflow-operations.controller.js";
import { ObjectStorageCandidatePreviewSigner } from "./infrastructure/object-storage-candidate-preview-signer.js";
import type { WorkflowCandidatePreviewSignerPort } from "./ports.js";

@Module({
  imports: [ApiDatabaseModule],
  controllers: [
    WorkflowsController,
    WorkflowEventsController,
    WorkflowOperationsController,
  ],
  providers: [
    {
      provide: WORKFLOW_TOKENS.workflowUnit,
      inject: [WORKFLOW_TOKENS.pool],
      useFactory: (pool: Pool) => new PgWorkflowUnit(pool),
    },
    {
      provide: WORKFLOW_TOKENS.candidatePreviewSigner,
      useFactory: (): WorkflowCandidatePreviewSignerPort => {
        const environment = loadObjectStorageEnvironment();
        return new ObjectStorageCandidatePreviewSigner(
          createObjectStorageFromEnvironment(environment),
          environment.OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS,
        );
      },
    },
    {
      provide: WorkflowService,
      inject: [
        WORKFLOW_TOKENS.workflowUnit,
        WORKFLOW_TOKENS.candidatePreviewSigner,
      ],
      useFactory: (
        unit: PgWorkflowUnit,
        previewSigner: WorkflowCandidatePreviewSignerPort,
      ) => new WorkflowService(unit, previewSigner),
    },
    {
      provide: WORKFLOW_TOKENS.operationsPort,
      inject: [WORKFLOW_TOKENS.pool],
      useFactory: (pool: Pool): PgWorkflowOperations =>
        new PgWorkflowOperations(pool),
    },
    {
      provide: WorkflowOperationsService,
      inject: [WORKFLOW_TOKENS.operationsPort, WORKFLOW_TOKENS.config],
      useFactory: (
        operations: PgWorkflowOperations,
        config: ApiConfig,
      ): WorkflowOperationsService =>
        new WorkflowOperationsService(
          operations,
          config.GRAPH_ADMIN_USER_IDS
            .split(",")
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
        ),
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
          generationJobs: build(config.GENERATION_JOB_QUEUE),
          renderJobs: build(config.RENDER_JOB_QUEUE),
          assetPreviewJobs: build(config.ASSET_PREVIEW_JOB_QUEUE),
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
      this.queues.generationJobs.close(),
      this.queues.renderJobs.close(),
      this.queues.assetPreviewJobs.close(),
    ]);
  }
}
