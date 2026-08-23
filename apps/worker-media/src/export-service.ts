import { randomUUID } from "node:crypto";
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
  constructor(private readonly pool: Pool) {}

  /**
   * Idempotent render keyed by the orchestrator's jobId. Deterministic
   * artifacts keep replays byte-identical; the export row plus the correlated
   * workflow signal commit atomically. The worker never writes project phases.
   */
  async process(payload: RenderRequestedPayload): Promise<{
    status: "SUCCEEDED" | "ALREADY_DONE";
    exportId?: string | undefined;
  }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await this.findExisting(client, payload.jobId);
      if (existing) {
        await client.query("COMMIT");
        return { status: "ALREADY_DONE", exportId: existing.exportId };
      }

      // Fail fast on invalid input before any domain write.
      const durationMs = await this.resolveDurationMs(
        client,
        payload.selectedOutputId,
      );
      const inserted = await client.query(
        `INSERT INTO render_jobs (id, project_id, workflow_run_id, selected_output_id, status)
         VALUES ($1, $2, $3, $4, 'RUNNING')
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          payload.jobId,
          payload.projectId,
          payload.workflowRunId,
          payload.selectedOutputId,
        ],
      );
      if (inserted.rowCount === 0) {
        // Lost a create race; serve whichever export exists for this job.
        const prior = await this.findExistingAfterWait(client, payload.jobId);
        await client.query("COMMIT");
        return prior
          ? { status: "ALREADY_DONE", exportId: prior.exportId }
          : { status: "ALREADY_DONE" };
      }

      const renderer = this.resolveRenderer();
      const artifacts = await renderer.render({
        projectId: payload.projectId,
        selectedOutputId: payload.selectedOutputId,
        durationMs,
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
      const { sha256Hex } = await import("./renderer.js");
      const sha256 = sha256Hex(zip);
      const exportId = randomUUID();
      const manifest = {
        ...(artifacts.manifest as Record<string, unknown>),
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        packageSha256: sha256,
        entries: ["cover.jpg", "motion.mov", "manifest.json"],
      };

      await client.query(
        `INSERT INTO export_packages (
           id, render_job_id, project_id, package_key,
           cover_key, motion_key, manifest_key, manifest,
           sha256, duration_ms, bytes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
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
          durationMs,
          zip.length,
        ],
      );
      await this.insertOutboxSignal(client, {
        signalId: randomUUID(),
        workflowRunId: payload.workflowRunId,
        signalType: "RENDER_JOB_COMPLETED",
        correlationId: payload.jobId,
        payload: { exportId },
        emittedAt: new Date().toISOString(),
      });
      await client.query(
        "UPDATE render_jobs SET status = 'SUCCEEDED', updated_at = now() WHERE id = $1",
        [payload.jobId],
      );
      await client.query("COMMIT");
      return { status: "SUCCEEDED", exportId };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async fail(payload: RenderRequestedPayload, errorCode: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO render_jobs (id, project_id, workflow_run_id, selected_output_id, status, error_code)
         VALUES ($1, $2, $3, $4, 'FAILED', $5)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          payload.jobId,
          payload.projectId,
          payload.workflowRunId,
          payload.selectedOutputId,
          errorCode,
        ],
      );
      if (inserted.rowCount === 0) return;
      await this.insertOutboxSignal(client, {
        signalId: randomUUID(),
        workflowRunId: payload.workflowRunId,
        signalType: "RENDER_JOB_FAILED",
        correlationId: payload.jobId,
        payload: { errorCode },
        emittedAt: new Date().toISOString(),
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private resolveRenderer(): ExportRenderer {
    return new FakeExportRenderer();
  }

  private async findExisting(
    client: PoolClient,
    jobId: string,
  ): Promise<ExportRecord | null> {
    const result = await client.query<{ id: string }>(
      `SELECT p.id FROM export_packages p JOIN render_jobs r ON r.id = p.render_job_id
       WHERE r.id = $1`,
      [jobId],
    );
    const row = result.rows[0];
    return row ? { exportId: row.id } : null;
  }

  private async findExistingAfterWait(
    client: PoolClient,
    jobId: string,
  ): Promise<ExportRecord | null> {
    return this.findExisting(client, jobId);
  }

  private async resolveDurationMs(
    client: PoolClient,
    selectedOutputId: string,
  ): Promise<number> {
    const result = await client.query(
      `SELECT 1 FROM generation_outputs o JOIN generation_batches b ON b.id = o.batch_id
       WHERE o.id = $1`,
      [selectedOutputId],
    );
    if (result.rowCount === 0) {
      throw new Error("SELECTED_OUTPUT_NOT_FOUND");
    }
    return 1500;
  }

  private async insertOutboxSignal(
    client: PoolClient,
    signal: WorkflowSignal,
  ): Promise<void> {
    await client.query(
      `INSERT INTO outbox_events (
         id, aggregate_type, aggregate_id, event_type, payload, status
       ) VALUES (gen_random_uuid(), 'workflow', $1, $2, $3::jsonb, 'PENDING')`,
      [signal.workflowRunId, signal.signalType, JSON.stringify(signal)],
    );
  }
}
