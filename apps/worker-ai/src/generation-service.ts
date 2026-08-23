import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { WorkflowSignal } from "@live-photo-studio/graph-contracts";
import type {
  GeneratedCandidate,
  ImageGenerationProvider,
} from "./provider.js";
import type { GenerationRequestedPayload } from "./provider.js";

export class GenerationService {
  constructor(
    private readonly pool: Pool,
    private readonly provider: ImageGenerationProvider,
  ) {}

  /**
   * Idempotent batch execution keyed by the orchestrator's jobId. Business
   * rows and the correlated workflow signal share one transaction; duplicate
   * deliveries return the existing outputs and emit nothing.
   */
  async process(payload: GenerationRequestedPayload): Promise<{
    status: "SUCCEEDED" | "ALREADY_DONE";
    outputIds: readonly string[];
  }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const existingBatch = await client.query<{ id: string }>(
        "SELECT id FROM generation_batches WHERE id = $1",
        [payload.jobId],
      );
      if (existingBatch.rows[0]) {
        const outputs = await this.loadOutputIds(client, payload.jobId);
        await client.query("COMMIT");
        return { status: "ALREADY_DONE", outputIds: outputs };
      }

      const candidates: readonly GeneratedCandidate[] =
        await this.provider.generate({
          projectId: payload.projectId,
          sourceAssetIds: payload.sourceAssetIds,
          coverAssetId: payload.coverAssetId,
          revision: payload.revision,
          count: 4,
        });

      await client.query(
        `INSERT INTO generation_batches (id, project_id, workflow_run_id, revision, status, provider)
         VALUES ($1, $2, $3, $4, 'RUNNING', $5)
         ON CONFLICT (id) DO NOTHING`,
        [
          payload.jobId,
          payload.projectId,
          payload.workflowRunId,
          payload.revision,
          this.provider.name,
        ],
      );
      const outputIds: string[] = [];
      for (const candidate of candidates) {
        const outputId = randomUUID();
        outputIds.push(outputId);
        await client.query(
          `INSERT INTO generation_outputs (id, batch_id, storage_key, width, height)
           VALUES ($1, $2, $3, $4, $5)`,
          [outputId, payload.jobId, candidate.storageKey, candidate.width, candidate.height],
        );
      }
      const signal: WorkflowSignal = {
        signalId: randomUUID(),
        workflowRunId: payload.workflowRunId,
        signalType: "GENERATION_BATCH_COMPLETED",
        correlationId: payload.jobId,
        payload: { outputIds },
        emittedAt: new Date().toISOString(),
      };
      await this.insertOutboxSignal(client, payload.workflowRunId, signal);
      await client.query(
        "UPDATE generation_batches SET status = 'SUCCEEDED', updated_at = now() WHERE id = $1",
        [payload.jobId],
      );

      await client.query("COMMIT");
      return { status: "SUCCEEDED", outputIds };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Failure path for classified non-retryable errors: records the failure and
   * emits the correlated failed signal once.
   */
  async fail(
    payload: GenerationRequestedPayload,
    errorCode: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO generation_batches (id, project_id, workflow_run_id, revision, status, provider, error_code)
         VALUES ($1, $2, $3, $4, 'FAILED', $5, $6)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          payload.jobId,
          payload.projectId,
          payload.workflowRunId,
          payload.revision,
          this.provider.name,
          errorCode,
        ],
      );
      if (inserted.rowCount === 0) return; // already recorded elsewhere
      const signal: WorkflowSignal = {
        signalId: randomUUID(),
        workflowRunId: payload.workflowRunId,
        signalType: "GENERATION_BATCH_FAILED",
        correlationId: payload.jobId,
        payload: { errorCode },
        emittedAt: new Date().toISOString(),
      };
      await this.insertOutboxSignal(client, payload.workflowRunId, signal);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadOutputIds(
    client: import("pg").PoolClient,
    batchId: string,
  ): Promise<string[]> {
    const result = await client.query<{ id: string }>(
      "SELECT id FROM generation_outputs WHERE batch_id = $1 ORDER BY created_at ASC",
      [batchId],
    );
    return result.rows.map((row) => row.id);
  }

  private async insertOutboxSignal(
    client: import("pg").PoolClient,
    workflowRunId: string,
    signal: WorkflowSignal,
  ): Promise<void> {
    await client.query(
      `INSERT INTO outbox_events (
         id, aggregate_type, aggregate_id, event_type, payload, status
       ) VALUES (gen_random_uuid(), 'workflow', $1, $2, $3::jsonb, 'PENDING')`,
      [
        workflowRunId,
        signal.signalType,
        JSON.stringify(signal),
      ],
    );
  }
}
