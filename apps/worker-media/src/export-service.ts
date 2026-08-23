import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { WorkflowSignal } from "@live-photo-studio/graph-contracts";
import {
  InMemoryObjectStorage,
  type ObjectStoragePort,
} from "@live-photo-studio/storage";
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

interface RenderJobRecord {
  readonly projectId: string;
  readonly workflowRunId: string | null;
  readonly selectedOutputId: string;
  readonly status: "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
}

type RenderClaim =
  | { readonly kind: "CLAIMED" }
  | { readonly kind: "IN_PROGRESS" }
  | { readonly kind: "ALREADY_DONE"; readonly exportId: string };

export class RenderService {
  constructor(
    private readonly pool: Pool,
    private readonly renderer: ExportRenderer = new FakeExportRenderer(),
    private readonly durationMs = 1500,
    private readonly storage: ObjectStoragePort = new InMemoryObjectStorage(),
  ) {}

  /**
   * Idempotent render keyed by the orchestrator's jobId. Deterministic
   * artifacts keep replays byte-identical; the export row plus the correlated
   * workflow signal commit atomically. The worker never writes project phases.
   */
  async process(payload: RenderRequestedPayload): Promise<{
    status: "SUCCEEDED" | "ALREADY_DONE" | "IN_PROGRESS";
    exportId?: string | undefined;
  }> {
    await this.assertWorkflowInput(payload);
    const existing = await this.findExistingFromPool(payload);
    if (existing) {
      await this.repairCompletionSignal(payload, existing.exportId);
      return { status: "ALREADY_DONE", exportId: existing.exportId };
    }

    const claim = await this.claimRenderJob(payload);
    if (claim.kind === "ALREADY_DONE") {
      await this.repairCompletionSignal(payload, claim.exportId);
      return { status: "ALREADY_DONE", exportId: claim.exportId };
    }
    if (claim.kind === "IN_PROGRESS") {
      return { status: "IN_PROGRESS" };
    }

    try {
      // Media rendering must not run inside a database transaction. The
      // durable claim above prevents concurrent duplicate renders; deterministic
      // ids still make a replay safe after the renderer returns.
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
      const objectKeys = {
        package: `${base}/package.zip`,
        cover: `${base}/cover.jpg`,
        motion: `${base}/motion.mov`,
        manifest: `${base}/manifest.json`,
      };
      await this.uploadArtifacts({
        objectKeys,
        artifacts,
        manifestBytes,
        zip,
      });
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
            objectKeys.package,
            objectKeys.cover,
            objectKeys.motion,
            objectKeys.manifest,
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
        const completed = await client.query(
          `UPDATE render_jobs
              SET status = 'SUCCEEDED',
                  recipe_version = $5,
                  updated_at = now()
            WHERE id = $1
              AND project_id = $2
              AND workflow_run_id = $3
              AND selected_output_id = $4
              AND status = 'RUNNING'`,
          [
            payload.jobId,
            payload.projectId,
            payload.workflowRunId,
            payload.selectedOutputId,
            this.renderer.recipeVersion,
          ],
        );
        if (completed.rowCount === 0) {
          throw new Error("RENDER_JOB_SCOPE_MISMATCH");
        }
        await client.query("COMMIT");
        return { status: "SUCCEEDED", exportId: stored.exportId };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      // A failed attempt must not strand a RUNNING claim and block a later
      // BullMQ retry. A committed export protects its claim from deletion.
      await this.releaseRenderClaim(payload).catch(() => undefined);
      throw error;
    }
  }

  private async uploadArtifacts(input: {
    readonly objectKeys: {
      readonly package: string;
      readonly cover: string;
      readonly motion: string;
      readonly manifest: string;
    };
    readonly artifacts: {
      readonly cover: Uint8Array;
      readonly motion: Uint8Array;
    };
    readonly manifestBytes: Uint8Array;
    readonly zip: Uint8Array;
  }): Promise<void> {
    const objects = [
      {
        objectKey: input.objectKeys.cover,
        body: input.artifacts.cover,
        contentType: "image/jpeg",
        sha256: sha256Hex(input.artifacts.cover),
      },
      {
        objectKey: input.objectKeys.motion,
        body: input.artifacts.motion,
        contentType: "video/quicktime",
        sha256: sha256Hex(input.artifacts.motion),
      },
      {
        objectKey: input.objectKeys.manifest,
        body: input.manifestBytes,
        contentType: "application/json",
        sha256: sha256Hex(input.manifestBytes),
      },
      {
        objectKey: input.objectKeys.package,
        body: input.zip,
        contentType: "application/zip",
        contentDisposition: "attachment; filename=\"live-photo-package.zip\"",
        sha256: sha256Hex(input.zip),
      },
    ] as const;

    const stored = await Promise.all(
      objects.map((object) => this.storage.putObject(object)),
    );
    for (let index = 0; index < objects.length; index += 1) {
      const expected = objects[index];
      const actual = stored[index];
      if (
        !expected ||
        !actual ||
        actual.objectKey !== expected.objectKey ||
        actual.bytes !== expected.body.byteLength ||
        actual.sha256 !== expected.sha256
      ) {
        throw new Error("OBJECT_STORAGE_INTEGRITY_MISMATCH");
      }
    }
  }

  async fail(payload: RenderRequestedPayload, errorCode: string): Promise<void> {
    await this.assertWorkflowInput(payload);
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
        const current = await this.findRenderJob(client, payload.jobId);
        if (!current) {
          throw new Error("RENDER_JOB_NOT_FOUND");
        }
        this.assertRenderJobScope(current, payload);
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

  private async claimRenderJob(
    payload: RenderRequestedPayload,
  ): Promise<RenderClaim> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO render_jobs (
           id, project_id, workflow_run_id, selected_output_id, status,
           recipe_version, trace_id, external_job_id
         ) VALUES ($1, $2, $3, $4, 'RUNNING', $5, $6, $1)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          payload.jobId,
          payload.projectId,
          payload.workflowRunId,
          payload.selectedOutputId,
          this.renderer.recipeVersion,
          payload.traceId ?? payload.workflowRunId,
        ],
      );
      if (inserted.rowCount === 1) {
        await client.query("COMMIT");
        return { kind: "CLAIMED" };
      }

      const current = await this.findRenderJob(client, payload.jobId);
      if (!current) {
        throw new Error("RENDER_JOB_NOT_FOUND");
      }
      this.assertRenderJobScope(current, payload);

      const existing = await this.findExisting(client, payload);
      if (existing) {
        await client.query("COMMIT");
        return { kind: "ALREADY_DONE", exportId: existing.exportId };
      }
      if (current.status === "RUNNING") {
        await client.query("COMMIT");
        return { kind: "IN_PROGRESS" };
      }

      const reclaimed = await client.query(
        `UPDATE render_jobs
            SET status = 'RUNNING',
                error_code = NULL,
                recipe_version = $5,
                trace_id = $6,
                external_job_id = $1,
                updated_at = now()
          WHERE id = $1
            AND project_id = $2
            AND workflow_run_id = $3
            AND selected_output_id = $4
            AND status IN ('FAILED', 'CANCELLED')
          RETURNING id`,
        [
          payload.jobId,
          payload.projectId,
          payload.workflowRunId,
          payload.selectedOutputId,
          this.renderer.recipeVersion,
          payload.traceId ?? payload.workflowRunId,
        ],
      );
      if (reclaimed.rowCount === 1) {
        await client.query("COMMIT");
        return { kind: "CLAIMED" };
      }
      throw new Error("RENDER_JOB_NOT_CLAIMABLE");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async findRenderJob(
    client: Pool | PoolClient,
    jobId: string,
  ): Promise<RenderJobRecord | null> {
    const result = await client.query<{
      project_id: string;
      workflow_run_id: string | null;
      selected_output_id: string;
      status: RenderJobRecord["status"];
    }>(
      `SELECT project_id, workflow_run_id, selected_output_id, status
         FROM render_jobs
        WHERE id = $1::uuid
        FOR UPDATE`,
      [jobId],
    );
    const row = result.rows[0];
    return row
      ? {
          projectId: row.project_id,
          workflowRunId: row.workflow_run_id,
          selectedOutputId: row.selected_output_id,
          status: row.status,
        }
      : null;
  }

  private assertRenderJobScope(
    row: RenderJobRecord,
    payload: RenderRequestedPayload,
  ): void {
    if (
      row.projectId !== payload.projectId ||
      row.workflowRunId !== payload.workflowRunId ||
      row.selectedOutputId !== payload.selectedOutputId
    ) {
      throw new Error("RENDER_JOB_SCOPE_MISMATCH");
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
      const updated = await client.query(
        `UPDATE render_jobs
            SET status = 'SUCCEEDED', updated_at = now()
          WHERE id = $1
            AND project_id = $2
            AND workflow_run_id = $3
            AND selected_output_id = $4`,
        [
          payload.jobId,
          payload.projectId,
          payload.workflowRunId,
          payload.selectedOutputId,
        ],
      );
      if (updated.rowCount === 0) {
        throw new Error("RENDER_JOB_SCOPE_MISMATCH");
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async releaseRenderClaim(
    payload: RenderRequestedPayload,
  ): Promise<void> {
    await this.pool.query(
      `DELETE FROM render_jobs r
        WHERE r.id = $1
          AND r.project_id = $2
          AND r.workflow_run_id = $3
          AND r.selected_output_id = $4
          AND r.status = 'RUNNING'
          AND NOT EXISTS (
            SELECT 1
              FROM export_packages p
             WHERE p.render_job_id = r.id
          )`,
      [
        payload.jobId,
        payload.projectId,
        payload.workflowRunId,
        payload.selectedOutputId,
      ],
    );
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
