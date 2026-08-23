import type { Queue } from "bullmq";
import type { Pool } from "pg";
import { withTransaction } from "@live-photo-studio/database";

export interface OutboxQueuePair {
  readonly commands: Queue;
  readonly signals: Queue;
}

interface OutboxRow {
  readonly id: string;
  readonly eventType: string;
  readonly payload: unknown;
}

const MAX_DELIVERY_ATTEMPTS = 50;

/**
 * Relays committed Outbox rows to BullMQ. Publication failures after commit
 * are recovered by polling; BullMQ deduplicates on the Outbox event id used
 * as jobId, so at-least-once delivery stays safe for idempotent consumers.
 */
export class OutboxDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

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
          SET status = 'PENDING', updated_at = now()
        WHERE status = 'PROCESSING'
          AND updated_at < now() - make_interval(secs => $1)`,
      [timeoutSeconds],
    );
  }

  private async claimBatch(): Promise<readonly OutboxRow[]> {
    return withTransaction(this.pool, async (client) => {
      const select = await client.query<{
        id: string;
        event_type: string;
        payload: unknown;
      }>(
        `SELECT id, event_type, payload
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
      }));
    });
  }

  private async deliver(row: OutboxRow): Promise<void> {
    const queue = routeEvent(row.eventType, this.queues);
    if (!queue) {
      await this.markFailed(row.id, "UNKNOWN_EVENT_TYPE");
      return;
    }
    try {
      await queue.add("outbox-event", row.payload, {
        jobId: row.id,
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
      });
      await this.markSent(row.id);
    } catch (error) {
      const attempts = await this.incrementAttempts(row.id);
      if (attempts >= MAX_DELIVERY_ATTEMPTS) {
        await this.markFailed(row.id, "DELIVERY_ATTEMPTS_EXHAUSTED");
        return;
      }
      console.error(
        JSON.stringify({
          event: "outbox.publish_failed",
          message: error instanceof Error ? error.name : "UnknownError",
        }),
      );
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
  if (eventType === "HUMAN_TASK_COMPLETED") return queues.signals;
  if (
    eventType === "START_WORKFLOW" ||
    eventType === "CANCEL_WORKFLOW"
  ) {
    return queues.commands;
  }
  return null;
}
