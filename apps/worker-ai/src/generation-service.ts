import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { WorkflowSignal } from "@live-photo-studio/graph-contracts";
import {
  ProviderFailureError,
  assertProviderBudget,
  type GeneratedCandidate,
  type ImageGenerationProvider,
} from "./provider.js";
import type { GenerationRequestedPayload } from "./provider.js";

export class GenerationService {
  constructor(
    private readonly pool: Pool,
    private readonly provider: ImageGenerationProvider,
    private readonly candidatesPerBatch = 4,
    private readonly maxCostMicros = 0,
  ) {}

  /**
   * Idempotent batch execution keyed by the orchestrator's jobId. Business
   * rows and the correlated workflow signal share one transaction; duplicate
   * deliveries return the existing outputs and emit nothing.
   */
  async process(payload: GenerationRequestedPayload): Promise<{
    status: "SUCCEEDED" | "ALREADY_DONE" | "FAILED";
    outputIds: readonly string[];
  }> {
    await this.assertWorkflowProject(payload);
    const existing = await this.loadBatch(payload);
    if (existing?.status === "SUCCEEDED" || existing?.status === "FAILED") {
      return { status: "ALREADY_DONE", outputIds: existing.outputIds };
    }

    // Provider work must not run inside a database transaction. The job id and
    // deterministic output ids make a replay safe if the process crashes after
    // the provider call but before the domain transaction commits.
    const estimatedCostMicros = this.provider.estimatedCostMicros ?? 0;
    try {
      assertProviderBudget(this.provider, this.maxCostMicros);
    } catch (error) {
      if (error instanceof ProviderFailureError && !error.retryable) {
        await this.fail(payload, error.code);
        return { status: "FAILED", outputIds: [] };
      }
      throw error;
    }

    let candidates: readonly GeneratedCandidate[];
    try {
      candidates = await this.provider.generate({
        projectId: payload.projectId,
        sourceAssetIds: payload.sourceAssetIds,
        coverAssetId: payload.coverAssetId,
        revision: payload.revision,
        count: this.candidatesPerBatch,
      });
    } catch (error) {
      if (error instanceof ProviderFailureError && !error.retryable) {
        await this.fail(payload, error.code);
        return { status: "FAILED", outputIds: [] };
      }
      throw error;
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO generation_batches (
           id, project_id, workflow_run_id, revision, status, provider,
           trace_id, provider_request_id, cost_micros
         ) VALUES ($1, $2, $3, $4, 'RUNNING', $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          payload.jobId,
          payload.projectId,
          payload.workflowRunId,
          payload.revision,
          this.provider.name,
          payload.traceId ?? payload.workflowRunId,
          candidates[0]?.providerRequestId ?? null,
          estimatedCostMicros,
        ],
      );
      if (inserted.rowCount === 0) {
        const current = await this.loadBatchWithClient(client, payload);
        if (
          current?.status === "SUCCEEDED" ||
          current?.status === "FAILED"
        ) {
          await client.query("COMMIT");
          return { status: "ALREADY_DONE", outputIds: current.outputIds };
        }
      }
      const outputIds: string[] = [];
      for (const [index, candidate] of candidates.entries()) {
        const outputId = deterministicUuid(
          `${payload.jobId}:generation-output:${index}`,
        );
        outputIds.push(outputId);
        await client.query(
          `INSERT INTO generation_outputs (id, batch_id, storage_key, width, height)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [
            outputId,
            payload.jobId,
            candidate.storageKey,
            candidate.width,
            candidate.height,
          ],
        );
      }
      const signal: WorkflowSignal = {
        signalId: deterministicUuid(
          `${payload.jobId}:GENERATION_BATCH_COMPLETED`,
        ),
        workflowRunId: payload.workflowRunId,
        signalType: "GENERATION_BATCH_COMPLETED",
        correlationId: payload.jobId,
        payload: { outputIds },
        emittedAt: new Date().toISOString(),
        traceId: payload.traceId ?? payload.workflowRunId,
        nodeName: "dispatch_generation_v1",
        nodeVersion: 1,
        externalJobId: payload.jobId,
        ...(candidates[0]?.providerRequestId
          ? { providerRequestId: candidates[0].providerRequestId }
          : {}),
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
    await this.assertWorkflowProject(payload);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO generation_batches (id, project_id, workflow_run_id, revision, status, provider, error_code)
         VALUES ($1, $2, $3, $4, 'FAILED', $5, $6)
         ON CONFLICT (id) DO UPDATE
           SET status = 'FAILED', error_code = EXCLUDED.error_code, updated_at = now()
         WHERE generation_batches.status = 'RUNNING'
           AND generation_batches.project_id = EXCLUDED.project_id
           AND generation_batches.workflow_run_id = EXCLUDED.workflow_run_id
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
      if (inserted.rowCount === 0) {
        await client.query("COMMIT");
        return; // already recorded elsewhere
      }
      const signal: WorkflowSignal = {
        signalId: deterministicUuid(`${payload.jobId}:GENERATION_BATCH_FAILED`),
        workflowRunId: payload.workflowRunId,
        signalType: "GENERATION_BATCH_FAILED",
        correlationId: payload.jobId,
        payload: { errorCode },
        emittedAt: new Date().toISOString(),
        traceId: payload.traceId ?? payload.workflowRunId,
        nodeName: "dispatch_generation_v1",
        nodeVersion: 1,
        externalJobId: payload.jobId,
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

  private async assertWorkflowProject(
    payload: GenerationRequestedPayload,
  ): Promise<void> {
    const result = await this.pool.query(
      `SELECT 1
         FROM workflow_runs
        WHERE id = $1::uuid AND project_id = $2::uuid`,
      [payload.workflowRunId, payload.projectId],
    );
    if (result.rowCount === 0) {
      throw new Error("WORKFLOW_PROJECT_MISMATCH");
    }
  }

  private async loadBatch(
    payload: GenerationRequestedPayload,
  ): Promise<{ status: string; outputIds: string[] } | null> {
    const client = await this.pool.connect();
    try {
      return await this.loadBatchWithClient(client, payload);
    } finally {
      client.release();
    }
  }

  private async loadBatchWithClient(
    client: PoolClient,
    payload: GenerationRequestedPayload,
  ): Promise<{ status: string; outputIds: string[] } | null> {
    const result = await client.query<{
      status: string;
      project_id: string;
      workflow_run_id: string | null;
      revision: number;
    }>(
      `SELECT status, project_id, workflow_run_id, revision
         FROM generation_batches
        WHERE id = $1::uuid`,
      [payload.jobId],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (
      row.project_id !== payload.projectId ||
      row.workflow_run_id !== payload.workflowRunId ||
      row.revision !== payload.revision
    ) {
      throw new Error("GENERATION_JOB_SCOPE_MISMATCH");
    }
    const outputs = await client.query<{ id: string }>(
      "SELECT id FROM generation_outputs WHERE batch_id = $1::uuid ORDER BY created_at ASC",
      [payload.jobId],
    );
    return {
      status: row.status,
      outputIds: outputs.rows.map((output) => output.id),
    };
  }

  private async insertOutboxSignal(
    client: import("pg").PoolClient,
    workflowRunId: string,
    signal: WorkflowSignal,
  ): Promise<void> {
    await client.query(
      `INSERT INTO outbox_events (
         id, aggregate_type, aggregate_id, event_type, payload, status,
         trace_id, node_name, node_version, external_job_id, provider_request_id
       ) VALUES ($1, 'workflow', $2, $3, $4::jsonb, 'PENDING',
                 $5, $6, $7, $8::uuid, $9)
       ON CONFLICT (id) DO NOTHING`,
      [
        signal.signalId,
        workflowRunId,
        signal.signalType,
        JSON.stringify(signal),
        signal.traceId ?? workflowRunId,
        signal.nodeName ?? null,
        signal.nodeVersion ?? null,
        signal.externalJobId ?? null,
        signal.providerRequestId ?? null,
      ],
    );
  }
}

function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
