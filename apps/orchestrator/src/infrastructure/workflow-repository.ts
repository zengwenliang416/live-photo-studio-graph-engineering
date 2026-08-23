import type { Pool, PoolClient } from "pg";
import type { WorkflowRunStatus } from "@live-photo-studio/graph-contracts";

export interface WorkflowRunRecord {
  readonly id: string;
  readonly projectId: string;
  readonly userId: string;
  readonly graphKey: string;
  readonly graphVersion: string;
  readonly threadId: string;
  readonly status: WorkflowRunStatus;
  readonly currentPhase: string | null;
}

export class WorkflowRepository {
  constructor(private readonly pool: Pool) {}

  async createRun(input: {
    id: string;
    projectId: string;
    userId: string;
    graphKey: string;
    graphVersion: string;
    threadId: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO workflow_runs (
         id, project_id, user_id, graph_key, graph_version, thread_id, status
       ) VALUES ($1, $2, $3, $4, $5, $6, 'QUEUED')
       ON CONFLICT (id) DO NOTHING`,
      [
        input.id,
        input.projectId,
        input.userId,
        input.graphKey,
        input.graphVersion,
        input.threadId,
      ],
    );
  }

  async findRun(id: string): Promise<WorkflowRunRecord | null> {
    const result = await this.pool.query<{
      id: string;
      project_id: string;
      user_id: string;
      graph_key: string;
      graph_version: string;
      thread_id: string;
      status: WorkflowRunStatus;
      current_phase: string | null;
    }>(
      `SELECT id, project_id, user_id, graph_key, graph_version,
              thread_id, status, current_phase
         FROM workflow_runs
        WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          projectId: row.project_id,
          userId: row.user_id,
          graphKey: row.graph_key,
          graphVersion: row.graph_version,
          threadId: row.thread_id,
          status: row.status,
          currentPhase: row.current_phase,
        }
      : null;
  }

  async updateProjection(input: {
    id: string;
    status: WorkflowRunStatus;
    currentNode?: string | null;
    currentPhase?: string | null;
    lastErrorCode?: string | null;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE workflow_runs
          SET status = $2,
              current_node = COALESCE($3, current_node),
              current_phase = COALESCE($4, current_phase),
              last_error_code = $5,
              started_at = CASE
                WHEN started_at IS NULL AND $2 = 'RUNNING' THEN now()
                ELSE started_at
              END,
              completed_at = CASE
                WHEN $2 IN ('SUCCEEDED', 'FAILED', 'CANCELLED') THEN now()
                ELSE completed_at
              END,
              updated_at = now()
        WHERE id = $1`,
      [
        input.id,
        input.status,
        input.currentNode ?? null,
        input.currentPhase ?? null,
        input.lastErrorCode ?? null,
      ],
    );
  }

  async registerSignal(
    client: PoolClient,
    input: {
      signalId: string;
      workflowRunId: string;
      signalType: string;
      correlationId: string;
      payload: Record<string, unknown>;
    },
  ): Promise<boolean> {
    const result = await client.query(
      `INSERT INTO workflow_signals (
         id, workflow_run_id, signal_type, correlation_id, payload, status
       ) VALUES ($1, $2, $3, $4, $5::jsonb, 'PROCESSING')
       ON CONFLICT (workflow_run_id, correlation_id, signal_type) DO NOTHING
       RETURNING id`,
      [
        input.signalId,
        input.workflowRunId,
        input.signalType,
        input.correlationId,
        JSON.stringify(input.payload),
      ],
    );
    return result.rowCount === 1;
  }

  async markSignalConsumed(client: PoolClient, signalId: string): Promise<void> {
    await client.query(
      `UPDATE workflow_signals
          SET status = 'CONSUMED', consumed_at = now()
        WHERE id = $1`,
      [signalId],
    );
  }

  async upsertHumanTask(input: {
    id: string;
    workflowRunId: string;
    taskType: string;
    nodeName: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO human_tasks (
         id, workflow_run_id, task_type, node_name, payload, status
       ) VALUES ($1, $2, $3, $4, $5::jsonb, 'PENDING')
       ON CONFLICT (workflow_run_id, node_name, status)
       WHERE status = 'PENDING'
       DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
      [
        input.id,
        input.workflowRunId,
        input.taskType,
        input.nodeName,
        JSON.stringify(input.payload),
      ],
    );
  }
}
