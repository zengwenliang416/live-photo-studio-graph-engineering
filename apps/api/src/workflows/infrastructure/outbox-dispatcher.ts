import type { Queue } from "bullmq";
import type { Pool } from "pg";
import {
  assetPreviewRequestedPayloadSchema,
  generationRequestedPayloadSchema,
  renderRequestedPayloadSchema,
  safeLogEvent,
  workflowCommandSchema,
  workflowSignalSchema,
} from "@live-photo-studio/graph-contracts";
import { withTransaction } from "@live-photo-studio/database";

export interface OutboxQueuePair {
  readonly commands: Queue;
  readonly signals: Queue;
  readonly generationJobs: Queue;
  readonly renderJobs: Queue;
  readonly assetPreviewJobs: Queue;
}

interface OutboxRow {
  readonly id: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly traceId: string | null;
  readonly nodeName: string | null;
  readonly nodeVersion: number | null;
  readonly externalJobId: string | null;
  readonly providerRequestId: string | null;
}

const MAX_DELIVERY_ATTEMPTS = 50;

const GRAPH_SIGNAL_EVENTS = new Set([
  "HUMAN_TASK_COMPLETED",
  "GENERATION_BATCH_COMPLETED",
  "GENERATION_BATCH_FAILED",
  "RENDER_JOB_COMPLETED",
  "RENDER_JOB_FAILED",
  "ASSET_INGEST_COMPLETED",
  "ASSET_INGEST_FAILED",
]);

const EVENT_ONLY_EVENTS = new Set([
  "workflow.completed.v1",
  "workflow.cancelled.v1",
  "workflow.failed.v1",
]);

const ROUTED_EVENT_TYPES = [
  ...GRAPH_SIGNAL_EVENTS,
  "START_WORKFLOW",
  "CANCEL_WORKFLOW",
  "workflow.generation.requested.v1",
  "workflow.render.requested.v1",
  "asset.preview.requested.v1",
] as const;

/**
 * Relays committed Outbox rows to BullMQ. Publication failures after commit
 * are recovered by polling; BullMQ deduplicates on the Outbox event id used
 * as jobId, so at-least-once delivery stays safe for idempotent consumers.
 */
export class OutboxDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private deliveredCount = 0;
  private invalidPayloadCount = 0;
  private failedDeliveryCount = 0;

  constructor(
    private readonly pool: Pool,
    private readonly queues: OutboxQueuePair,
    private readonly options: {
      intervalMs: number;
      batchSize: number;
      visibilityTimeoutMs: number;
    },
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    while (this.ticking) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  getMetrics(): {
    readonly deliveredCount: number;
    readonly invalidPayloadCount: number;
    readonly failedDeliveryCount: number;
  } {
    return {
      deliveredCount: this.deliveredCount,
      invalidPayloadCount: this.invalidPayloadCount,
      failedDeliveryCount: this.failedDeliveryCount,
    };
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.recoverStuckRows();
      const rows = await this.claimBatch();
      for (const row of rows) {
        await this.deliver(row);
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "outbox.tick_failed",
          message: error instanceof Error ? error.name : "UnknownError",
        }),
      );
    } finally {
      this.ticking = false;
    }
  }

  private async recoverStuckRows(): Promise<void> {
    const timeoutSeconds = Math.ceil(
      this.options.visibilityTimeoutMs / 1000,
    );
    await this.pool.query(
      `UPDATE outbox_events
          SET status = 'PENDING',
              last_error_code = NULL,
              updated_at = now()
        WHERE (
          status = 'PROCESSING'
          AND updated_at < now() - make_interval(secs => $1)
        ) OR (
          status = 'FAILED'
          AND last_error_code = 'UNKNOWN_EVENT_TYPE'
          AND event_type = ANY($2::text[])
        )`,
      [timeoutSeconds, ROUTED_EVENT_TYPES],
    );
  }

  private async claimBatch(): Promise<readonly OutboxRow[]> {
    return withTransaction(this.pool, async (client) => {
      const select = await client.query<{
        id: string;
        event_type: string;
        payload: unknown;
        trace_id: string | null;
        node_name: string | null;
        node_version: number | null;
        external_job_id: string | null;
        provider_request_id: string | null;
      }>(
          `SELECT id, event_type, payload, trace_id, node_name, node_version,
                  external_job_id, provider_request_id
           FROM outbox_events
          WHERE status = 'PENDING'
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1`,
        [this.options.batchSize],
      );
      const ids = select.rows.map((row) => row.id);
      if (ids.length === 0) return [];
      await client.query(
        `UPDATE outbox_events
            SET status = 'PROCESSING', updated_at = now()
          WHERE id = ANY($1::uuid[])`,
        [ids],
      );
      return select.rows.map((row) => ({
        id: row.id,
        eventType: row.event_type,
        payload: row.payload,
        traceId: row.trace_id,
        nodeName: row.node_name,
        nodeVersion: row.node_version,
        externalJobId: row.external_job_id,
        providerRequestId: row.provider_request_id,
      }));
    });
  }

  private async deliver(row: OutboxRow): Promise<void> {
    if (EVENT_ONLY_EVENTS.has(row.eventType)) {
      await this.markSent(row.id);
      this.deliveredCount += 1;
      return;
    }
    const queue = routeEvent(row.eventType, this.queues);
    if (!queue) {
      await this.markFailed(row.id, "UNKNOWN_EVENT_TYPE");
      return;
    }
    try {
      const payload = parseRoutedPayload(row.eventType, row.payload);
      await queue.add("outbox-event", payload, {
        jobId: row.id,
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
      });
      await this.markSent(row.id);
      this.deliveredCount += 1;
    } catch (error) {
      if (error instanceof OutboxPayloadError) {
        this.invalidPayloadCount += 1;
        await this.markFailed(row.id, "INVALID_OUTBOX_PAYLOAD");
        return;
      }
      this.failedDeliveryCount += 1;
      const attempts = await this.incrementAttempts(row.id);
      if (attempts >= MAX_DELIVERY_ATTEMPTS) {
        await this.markFailed(row.id, "DELIVERY_ATTEMPTS_EXHAUSTED");
        return;
      }
      console.error(JSON.stringify(safeLogEvent("outbox.publish_failed", {
        traceId: row.traceId,
        workflowRunId: row.payload instanceof Object
          ? (row.payload as Record<string, unknown>)["workflowRunId"]
          : undefined,
        nodeName: row.nodeName,
        nodeVersion: row.nodeVersion,
        externalJobId: row.externalJobId,
        providerRequestId: row.providerRequestId,
        message: error instanceof Error ? error.name : "UnknownError",
      })));
    }
  }

  private async markSent(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE outbox_events
          SET status = 'SENT', published_at = now(), updated_at = now(),
              last_error_code = NULL
        WHERE id = $1`,
      [id],
    );
  }

  private async incrementAttempts(id: string): Promise<number> {
    const result = await this.pool.query<{ attempts: number }>(
      `UPDATE outbox_events
          SET attempts = attempts + 1,
              status = CASE WHEN attempts + 1 >= $2 THEN 'FAILED' ELSE 'PENDING' END,
              updated_at = now()
        WHERE id = $1
        RETURNING attempts`,
      [id, MAX_DELIVERY_ATTEMPTS],
    );
    const row = result.rows[0];
    return row ? row.attempts : 0;
  }

  private async markFailed(id: string, code: string): Promise<void> {
    await this.pool.query(
      `UPDATE outbox_events
          SET status = 'FAILED', last_error_code = $2, updated_at = now()
        WHERE id = $1`,
      [id, code],
    );
  }
}

export function routeEvent(
  eventType: string,
  queues: OutboxQueuePair,
): Queue | null {
  if (GRAPH_SIGNAL_EVENTS.has(eventType)) return queues.signals;
  if (eventType === "START_WORKFLOW" || eventType === "CANCEL_WORKFLOW") {
    return queues.commands;
  }
  if (eventType === "workflow.generation.requested.v1") {
    return queues.generationJobs;
  }
  if (eventType === "workflow.render.requested.v1") {
    return queues.renderJobs;
  }
  if (eventType === "asset.preview.requested.v1") {
    return queues.assetPreviewJobs;
  }
  return null;
}

export class OutboxPayloadError extends Error {
  constructor() {
    super("Outbox payload does not satisfy its published contract.");
    this.name = "OutboxPayloadError";
  }
}

export function parseRoutedPayload(eventType: string, payload: unknown): unknown {
  const parsed =
    eventType === "START_WORKFLOW" || eventType === "CANCEL_WORKFLOW"
      ? workflowCommandSchema.safeParse(payload)
      : GRAPH_SIGNAL_EVENTS.has(eventType)
        ? workflowSignalSchema.safeParse(payload)
        : eventType === "workflow.generation.requested.v1"
          ? generationRequestedPayloadSchema.safeParse(payload)
          : eventType === "workflow.render.requested.v1"
            ? renderRequestedPayloadSchema.safeParse(payload)
            : eventType === "asset.preview.requested.v1"
              ? assetPreviewRequestedPayloadSchema.safeParse(payload)
            : { success: true as const, data: payload };
  if (!parsed.success) throw new OutboxPayloadError();
  return parsed.data;
}
