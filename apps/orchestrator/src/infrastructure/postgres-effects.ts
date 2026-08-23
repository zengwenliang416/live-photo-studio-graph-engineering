import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
  ProjectReadPort,
  ProjectSnapshot,
  WorkflowEffectPort,
} from "../graphs/live-photo-project/ports.js";

export class PostgresProjectReadAdapter implements ProjectReadPort {
  constructor(private readonly pool: Pool) {}

  async getProjectSnapshot(
    projectId: string,
    userId: string,
  ): Promise<ProjectSnapshot> {
    const project = await this.pool.query<{
      id: string;
      user_id: string;
      cover_asset_id: string | null;
    }>(
      `SELECT id, user_id, cover_asset_id
         FROM projects
        WHERE id = $1 AND user_id = $2`,
      [projectId, userId],
    );
    const row = project.rows[0];
    if (!row || !row.cover_asset_id) {
      throw new Error("Project or cover asset was not found.");
    }
    const assets = await this.pool.query<{ asset_id: string }>(
      `SELECT asset_id
         FROM asset_roles
        WHERE project_id = $1 AND role = 'CONTENT'
        ORDER BY created_at ASC`,
      [projectId],
    );
    return {
      projectId: row.id,
      userId: row.user_id,
      coverAssetId: row.cover_asset_id,
      sourceAssetIds: assets.rows.map((asset) => asset.asset_id),
    };
  }
}

/**
 * Transitional adapter. It records idempotent workflow effects and emits
 * Outbox events. Milestones 4-7 in the ExecPlan connect these events to the
 * existing generation and render application services.
 */
export class PostgresWorkflowEffectAdapter implements WorkflowEffectPort {
  constructor(private readonly pool: Pool) {}

  async ensureGenerationBatch(input: {
    workflowRunId: string;
    projectId: string;
    sourceAssetIds: readonly string[];
    coverAssetId: string;
    revision: number;
    effectKey: string;
    traceId?: string | undefined;
  }): Promise<{ jobId: string }> {
    return this.ensureExternalEffect({
      workflowRunId: input.workflowRunId,
      nodeName: "dispatch_generation_v1",
      nodeVersion: 1,
      traceId: input.traceId,
      effectKey: input.effectKey,
      eventType: "workflow.generation.requested.v1",
      payload: {
        projectId: input.projectId,
        sourceAssetIds: input.sourceAssetIds,
        coverAssetId: input.coverAssetId,
        revision: input.revision,
      },
    });
  }

  async ensureRenderJob(input: {
    workflowRunId: string;
    projectId: string;
    selectedOutputId: string;
    effectKey: string;
    traceId?: string | undefined;
  }): Promise<{ jobId: string }> {
    return this.ensureExternalEffect({
      workflowRunId: input.workflowRunId,
      nodeName: "dispatch_render_v1",
      nodeVersion: 1,
      traceId: input.traceId,
      effectKey: input.effectKey,
      eventType: "workflow.render.requested.v1",
      payload: {
        projectId: input.projectId,
        selectedOutputId: input.selectedOutputId,
      },
    });
  }

  async markWorkflowCompleted(input: {
    workflowRunId: string;
    projectId: string;
    exportId: string;
    effectKey: string;
    traceId?: string | undefined;
  }): Promise<void> {
    await this.ensureTerminalEffect({
      workflowRunId: input.workflowRunId,
      nodeName: "complete_v1",
      nodeVersion: 1,
      traceId: input.traceId,
      effectKey: input.effectKey,
      eventType: "workflow.completed.v1",
      payload: { projectId: input.projectId, exportId: input.exportId },
    });
  }

  async markWorkflowCancelled(input: {
    workflowRunId: string;
    projectId: string;
    effectKey: string;
    traceId?: string | undefined;
  }): Promise<void> {
    await this.ensureTerminalEffect({
      workflowRunId: input.workflowRunId,
      nodeName: "cancelled_v1",
      nodeVersion: 1,
      traceId: input.traceId,
      effectKey: input.effectKey,
      eventType: "workflow.cancelled.v1",
      payload: { projectId: input.projectId },
    });
  }

  async markWorkflowFailed(input: {
    workflowRunId: string;
    projectId: string;
    errorCode: string;
    effectKey: string;
    traceId?: string | undefined;
  }): Promise<void> {
    await this.ensureTerminalEffect({
      workflowRunId: input.workflowRunId,
      nodeName: "failed_v1",
      nodeVersion: 1,
      traceId: input.traceId,
      effectKey: input.effectKey,
      eventType: "workflow.failed.v1",
      payload: { projectId: input.projectId, errorCode: input.errorCode },
    });
  }

  private async ensureExternalEffect(input: {
    workflowRunId: string;
    nodeName: string;
    nodeVersion: number;
    effectKey: string;
    eventType: string;
    payload: Record<string, unknown>;
    traceId?: string | undefined;
  }): Promise<{ jobId: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ external_job_id: string }>(
        `SELECT external_job_id
         FROM workflow_node_effects
          WHERE effect_key = $1
          FOR UPDATE`,
        [input.effectKey],
      );
      if (existing.rows[0]?.external_job_id) {
        await client.query("COMMIT");
        return { jobId: existing.rows[0].external_job_id };
      }
      const jobId = randomUUID();
      await client.query(
        `INSERT INTO workflow_node_effects (
           id, workflow_run_id, node_name, node_version, effect_key,
           external_job_id, status, trace_id
         ) VALUES ($1, $2, $3, $4, $5, $6, 'REQUESTED', $7)`,
        [
          randomUUID(),
          input.workflowRunId,
          input.nodeName,
          input.nodeVersion,
          input.effectKey,
          jobId,
          input.traceId ?? input.workflowRunId,
        ],
      );
      await client.query(
        `INSERT INTO outbox_events (
           id, aggregate_type, aggregate_id, event_type, payload, status,
           created_at, trace_id, node_name, node_version, external_job_id
         ) VALUES ($1, 'workflow', $2, $3, $4::jsonb, 'PENDING', now(),
                   $5, $6, $7, $8)`,
        [
          randomUUID(),
          input.workflowRunId,
          input.eventType,
          JSON.stringify({
            ...input.payload,
            workflowRunId: input.workflowRunId,
            jobId,
            traceId: input.traceId ?? input.workflowRunId,
            nodeName: input.nodeName,
            nodeVersion: input.nodeVersion,
            externalJobId: jobId,
          }),
          input.traceId ?? input.workflowRunId,
          input.nodeName,
          input.nodeVersion,
          jobId,
        ],
      );
      await client.query("COMMIT");
      return { jobId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async ensureTerminalEffect(input: {
    workflowRunId: string;
    nodeName: string;
    nodeVersion: number;
    effectKey: string;
    eventType: string;
    payload: Record<string, unknown>;
    traceId?: string | undefined;
  }): Promise<void> {
    await this.ensureExternalEffect(input);
  }
}
