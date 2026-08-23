import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { WorkflowSignal } from "@live-photo-studio/graph-contracts";
import {
  FakeExportRenderer,
  type ExportRenderer,
} from "./renderer.js";
import type { RenderRequestedPayload } from "./renderer.js";
import { buildStoreZip } from "./zip.js";

const MANIFEST_SCHEMA_VERSION = "1";

interface ExportRecord {
  readonly exportId: string;
}

export class RenderService {
  constructor(
    private readonly pool: Pool,
    private readonly renderer: ExportRenderer = new FakeExportRenderer(),
    private readonly durationMs = 1500,
  ) {}

  /**
   * Idempotent render keyed by the orchestrator's jobId. Deterministic
   * artifacts keep replays byte-identical; the export row plus the correlated
   * workflow signal commit atomically. The worker never writes project phases.
   */
  async process(payload: RenderRequestedPayload): Promise<{
    status: "SUCCEEDED" | "ALREADY_DONE";
    exportId?: string | undefined;
  }> {
    await this.assertWorkflowInput(payload);
    const existing = await this.findExistingFromPool(payload);
    if (existing) {
      await this.repairCompletionSignal(payload, existing.exportId);
      return { status: "ALREADY_DONE", exportId: existing.exportId };
    }

    // Media rendering must not run inside a database transaction. If the
    // process crashes after rendering, the deterministic job/export ids let a
    // replay finish the durable rows and signal without overwriting input.
    const artifacts = await this.renderer.render({
      projectId: payload.projectId,
      selectedOutputId: payload.selectedOutputId,
      durationMs: this.durationMs,
    });
    const manifestBytes = new TextEncoder().encode(
      JSON.stringify(artifacts.manifest),
    );
    const base = `projects/${payload.projectId}/exports/${payload.jobId}`;
    const zip = buildStoreZip([
      { name: "cover.jpg", bytes: artifacts.cover },
      { name: "motion.mov", bytes: artifacts.motion },
      { name: "manifest.json", bytes: manifestBytes },
    ]);
    const sha256 = sha256Hex(zip);
    const exportId = deterministicUuid(`${payload.jobId}:export`);
    const manifest = {
      ...(artifacts.manifest as Record<string, unknown>),
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      recipeVersion: this.renderer.recipeVersion,
      packageSha256: sha256,
      entries: ["cover.jpg", "motion.mov", "manifest.json"],
    };

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO render_jobs (
           id, project_id, workflow_run_id, selected_output_id, status,
           trace_id, external_job_id
         ) VALUES ($1, $2, $3, $4, 'RUNNING', $5, $1)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          payload.jobId,
          payload.projectId,
          payload.workflowRunId,
          payload.selectedOutputId,
          payload.traceId ?? payload.workflowRunId,
        ],
      );
      if (inserted.rowCount === 0) {
        const prior = await this.findExisting(client, payload);
        if (prior) {
          await this.insertCompletionSignal(client, payload, prior.exportId);
          await client.query(
            "UPDATE render_jobs SET status = 'SUCCEEDED', updated_at = now() WHERE id = $1",
            [payload.jobId],
          );
          await client.query("COMMIT");
          return { status: "ALREADY_DONE", exportId: prior.exportId };
        }
      }

      await client.query(
        `INSERT INTO export_packages (
           id, render_job_id, project_id, package_key,
           cover_key, motion_key, manifest_key, manifest,
           sha256, duration_ms, bytes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
         ON CONFLICT (render_job_id) DO NOTHING`,
        [
          exportId,
          payload.jobId,
          payload.projectId,
          `${base}/package.zip`,
          `${base}/cover.jpg`,
          `${base}/motion.mov`,
          `${base}/manifest.json`,
          JSON.stringify(manifest),
          sha256,
          this.durationMs,
          zip.length,
        ],
      );
      const stored = await this.findExisting(client, payload);
      if (!stored) {
        throw new Error("EXPORT_PACKAGE_NOT_PERSISTED");
      }
      await this.insertCompletionSignal(client, payload, stored.exportId);
      await client.query(
        "UPDATE render_jobs SET status = 'SUCCEEDED', updated_at = now() WHERE id = $1",
        [payload.jobId],
      );
      await client.query("COMMIT");
      return { status: "SUCCEEDED", exportId: stored.exportId };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async fail(payload: RenderRequestedPayload, errorCode: string): Promise<void> {
    await this.assertWorkflowProject(payload);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO render_jobs (
           id, project_id, workflow_run_id, selected_output_id, status, error_code
         ) VALUES ($1, $2, $3, $4, 'FAILED', $5)
         ON CONFLICT (id) DO UPDATE
           SET status = 'FAILED', error_code = EXCLUDED.error_code, updated_at = now()
         WHERE render_jobs.status = 'RUNNING'
           AND render_jobs.project_id = EXCLUDED.project_id
           AND render_jobs.workflow_run_id = EXCLUDED.workflow_run_id
           AND render_jobs.selected_output_id = EXCLUDED.selected_output_id
         RETURNING id`,
        [
          payload.jobId,
          payload.projectId,
          payload.workflowRunId,
          payload.selectedOutputId,
          errorCode,
        ],
      );
      if (inserted.rowCount === 0) {
        await client.query("COMMIT");
        return;
      }
      await this.insertFailureSignal(client, payload, errorCode);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async assertWorkflowInput(
    payload: RenderRequestedPayload,
  ): Promise<void> {
    await this.assertWorkflowProject(payload);
    const result = await this.pool.query(
      `SELECT 1
         FROM generation_outputs o
         JOIN generation_batches b ON b.id = o.batch_id
        WHERE o.id = $1::uuid
          AND b.project_id = $2::uuid
          AND b.workflow_run_id = $3::uuid`,
      [payload.selectedOutputId, payload.projectId, payload.workflowRunId],
    );
    if (result.rowCount === 0) {
      throw new Error("SELECTED_OUTPUT_NOT_FOUND");
    }
  }

  private async assertWorkflowProject(
    payload: RenderRequestedPayload,
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

  private async findExistingFromPool(
    payload: RenderRequestedPayload,
  ): Promise<ExportRecord | null> {
    return this.findExisting(this.pool, payload);
  }

  private async findExisting(
    client: Pool | PoolClient,
    payload: RenderRequestedPayload,
  ): Promise<ExportRecord | null> {
    const result = await client.query<{
      id: string;
      project_id: string;
      workflow_run_id: string | null;
      selected_output_id: string;
    }>(
      `SELECT p.id, r.project_id, r.workflow_run_id, r.selected_output_id
         FROM export_packages p
         JOIN render_jobs r ON r.id = p.render_job_id
        WHERE r.id = $1::uuid`,
      [payload.jobId],
    );
    const row = result.rows[0];
    if (
      row &&
      (row.project_id !== payload.projectId ||
        row.workflow_run_id !== payload.workflowRunId ||
        row.selected_output_id !== payload.selectedOutputId)
    ) {
      throw new Error("RENDER_JOB_SCOPE_MISMATCH");
    }
    return row ? { exportId: row.id } : null;
  }

  private async repairCompletionSignal(
    payload: RenderRequestedPayload,
    exportId: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.insertCompletionSignal(client, payload, exportId);
      await client.query(
        "UPDATE render_jobs SET status = 'SUCCEEDED', updated_at = now() WHERE id = $1",
        [payload.jobId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async insertCompletionSignal(
    client: PoolClient,
    payload: RenderRequestedPayload,
    exportId: string,
  ): Promise<void> {
    await this.insertOutboxSignal(client, {
      signalId: deterministicUuid(`${payload.jobId}:RENDER_JOB_COMPLETED`),
      workflowRunId: payload.workflowRunId,
      signalType: "RENDER_JOB_COMPLETED",
      correlationId: payload.jobId,
      payload: { exportId },
      emittedAt: new Date().toISOString(),
      traceId: payload.traceId ?? payload.workflowRunId,
      nodeName: "dispatch_render_v1",
      nodeVersion: 1,
      externalJobId: payload.jobId,
    });
  }

  private async insertFailureSignal(
    client: PoolClient,
    payload: RenderRequestedPayload,
    errorCode: string,
  ): Promise<void> {
    await this.insertOutboxSignal(client, {
      signalId: deterministicUuid(`${payload.jobId}:RENDER_JOB_FAILED`),
      workflowRunId: payload.workflowRunId,
      signalType: "RENDER_JOB_FAILED",
      correlationId: payload.jobId,
      payload: { errorCode },
      emittedAt: new Date().toISOString(),
      traceId: payload.traceId ?? payload.workflowRunId,
      nodeName: "dispatch_render_v1",
      nodeVersion: 1,
      externalJobId: payload.jobId,
    });
  }

  private async insertOutboxSignal(
    client: PoolClient,
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
        signal.workflowRunId,
        signal.signalType,
        JSON.stringify(signal),
        signal.traceId ?? signal.workflowRunId,
        signal.nodeName ?? null,
        signal.nodeVersion ?? null,
        signal.externalJobId ?? null,
        signal.providerRequestId ?? null,
      ],
    );
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
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
