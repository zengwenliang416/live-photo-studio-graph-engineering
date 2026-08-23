import type { Pool, PoolClient } from "pg";
import type { WorkflowRunStatus } from "@live-photo-studio/graph-contracts";

export interface WorkflowRunRecord {
  readonly id: string;
  readonly projectId: string;
  readonly userId: string;
  readonly traceId: string | null;
  readonly graphKey: string;
  readonly graphVersion: string;
  readonly threadId: string;
  readonly status: WorkflowRunStatus;
  readonly currentNode: string | null;
  readonly currentNodeVersion: number | null;
  readonly currentPhase: string | null;
  readonly externalJobId: string | null;
  readonly providerRequestId: string | null;
}

export class WorkflowRepository {
  constructor(private readonly pool: Pool) {}

  async createRun(input: {
    id: string;
    projectId: string;
    userId: string;
    traceId?: string | undefined;
    graphKey: string;
    graphVersion: string;
    threadId: string;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO workflow_runs (
         id, project_id, user_id, trace_id, graph_key, graph_version, thread_id, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'QUEUED')
       ON CONFLICT (id) DO NOTHING`,
      [
        input.id,
        input.projectId,
        input.userId,
        input.traceId ?? null,
        input.graphKey,
        input.graphVersion,
        input.threadId,
      ],
    );
    return result.rowCount === 1;
  }

  async findRun(id: string): Promise<WorkflowRunRecord | null> {
    const result = await this.pool.query<{
      id: string;
      project_id: string;
      user_id: string;
      trace_id: string | null;
      graph_key: string;
      graph_version: string;
      thread_id: string;
      status: WorkflowRunStatus;
      current_node: string | null;
      current_node_version: number | null;
      current_phase: string | null;
      last_external_job_id: string | null;
      provider_request_id: string | null;
    }>(
      `SELECT id, project_id, user_id, trace_id, graph_key, graph_version,
              thread_id, status, current_node, current_node_version,
              current_phase, last_external_job_id, provider_request_id
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
          traceId: row.trace_id,
          graphKey: row.graph_key,
          graphVersion: row.graph_version,
          threadId: row.thread_id,
          status: row.status,
          currentNode: row.current_node,
          currentNodeVersion: row.current_node_version,
          currentPhase: row.current_phase,
          externalJobId: row.last_external_job_id,
          providerRequestId: row.provider_request_id,
        }
      : null;
  }

  async findRunWithClient(
    client: PoolClient,
    id: string,
  ): Promise<WorkflowRunRecord | null> {
    const result = await client.query<{
      id: string;
      project_id: string;
      user_id: string;
      trace_id: string | null;
      graph_key: string;
      graph_version: string;
      thread_id: string;
      status: WorkflowRunStatus;
      current_node: string | null;
      current_node_version: number | null;
      current_phase: string | null;
      last_external_job_id: string | null;
      provider_request_id: string | null;
    }>(
      `SELECT id, project_id, user_id, trace_id, graph_key, graph_version,
              thread_id, status, current_node, current_node_version,
              current_phase, last_external_job_id, provider_request_id
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
          traceId: row.trace_id,
          graphKey: row.graph_key,
          graphVersion: row.graph_version,
          threadId: row.thread_id,
          status: row.status,
          currentNode: row.current_node,
          currentNodeVersion: row.current_node_version,
          currentPhase: row.current_phase,
          externalJobId: row.last_external_job_id,
          providerRequestId: row.provider_request_id,
        }
      : null;
  }

  async updateProjection(input: {
    id: string;
    status: WorkflowRunStatus;
    currentNode?: string | null;
    currentNodeVersion?: number | null;
    currentPhase?: string | null;
    lastErrorCode?: string | null;
    externalJobId?: string | null;
    providerRequestId?: string | null;
    traceId?: string | null;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE workflow_runs
          SET status = $2,
              current_node = COALESCE($3, current_node),
              current_node_version = COALESCE($4, current_node_version),
              current_phase = COALESCE($5, current_phase),
              last_error_code = $6,
              last_external_job_id = COALESCE($7, last_external_job_id),
              provider_request_id = COALESCE($8, provider_request_id),
              trace_id = COALESCE($9, trace_id),
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
        input.currentNodeVersion ?? null,
        input.currentPhase ?? null,
        input.lastErrorCode ?? null,
        input.externalJobId ?? null,
        input.providerRequestId ?? null,
        input.traceId ?? null,
      ],
    );
  }

  async updateProjectionWithClient(
    client: PoolClient,
    input: {
      id: string;
      status: WorkflowRunStatus;
      currentNode?: string | null;
      currentNodeVersion?: number | null;
      currentPhase?: string | null;
      lastErrorCode?: string | null;
      externalJobId?: string | null;
      providerRequestId?: string | null;
      traceId?: string | null;
    },
  ): Promise<void> {
    await client.query(
      `UPDATE workflow_runs
          SET status = $2,
              current_node = COALESCE($3, current_node),
              current_node_version = COALESCE($4, current_node_version),
              current_phase = COALESCE($5, current_phase),
              last_error_code = $6,
              last_external_job_id = COALESCE($7, last_external_job_id),
              provider_request_id = COALESCE($8, provider_request_id),
              trace_id = COALESCE($9, trace_id),
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
        input.currentNodeVersion ?? null,
        input.currentPhase ?? null,
        input.lastErrorCode ?? null,
        input.externalJobId ?? null,
        input.providerRequestId ?? null,
        input.traceId ?? null,
      ],
    );
  }

  async hasWorkflowEvent(
    workflowRunId: string,
    eventName: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1
         FROM workflow_events
        WHERE workflow_run_id = $1 AND event_name = $2
        LIMIT 1`,
      [workflowRunId, eventName],
    );
    return result.rowCount === 1;
  }

  async cancelPendingHumanTasks(workflowRunId: string): Promise<void> {
    await this.pool.query(
      `UPDATE human_tasks
          SET status = 'CANCELLED', updated_at = now()
        WHERE workflow_run_id = $1 AND status = 'PENDING'`,
      [workflowRunId],
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
      traceId?: string | undefined;
      nodeName?: string | undefined;
      nodeVersion?: number | undefined;
      externalJobId?: string | undefined;
      providerRequestId?: string | undefined;
    },
  ): Promise<boolean> {
    const result = await client.query(
      `INSERT INTO workflow_signals (
         id, workflow_run_id, signal_type, correlation_id, payload, status,
         trace_id, node_name, node_version, external_job_id, provider_request_id
       ) VALUES ($1, $2, $3, $4, $5::jsonb, 'PROCESSING',
                 $6, $7, $8, $9, $10)
       ON CONFLICT (workflow_run_id, correlation_id, signal_type) DO NOTHING
       RETURNING id`,
      [
        input.signalId,
        input.workflowRunId,
        input.signalType,
        input.correlationId,
        JSON.stringify(input.payload),
        input.traceId ?? null,
        input.nodeName ?? null,
        input.nodeVersion ?? null,
        input.externalJobId ?? null,
        input.providerRequestId ?? null,
      ],
    );
    return result.rowCount === 1;
  }

  async markSignalConsumed(client: PoolClient, signalId: string): Promise<void> {
    await client.query(
      `UPDATE workflow_signals
          SET status = 'CONSUMED', consumed_at = now(), updated_at = now()
        WHERE id = $1`,
      [signalId],
    );
  }

  async markSignalFailed(
    client: PoolClient,
    signalId: string,
    errorCode: string,
  ): Promise<void> {
    await client.query(
      `UPDATE workflow_signals
          SET status = 'FAILED', last_error_code = $2, updated_at = now()
        WHERE id = $1`,
      [signalId, errorCode],
    );
  }

  async hasWorkflowEventIdWithClient(
    client: PoolClient,
    eventId: string,
  ): Promise<boolean> {
    const result = await client.query(
      "SELECT 1 FROM workflow_events WHERE id = $1",
      [eventId],
    );
    return result.rowCount === 1;
  }

  async findSignalStatus(
    client: PoolClient,
    workflowRunId: string,
    correlationId: string,
    signalType: string,
  ): Promise<{
    id: string;
    status: string;
    signalType: string;
    correlationId: string;
    payload: Record<string, unknown>;
    traceId: string | null;
    nodeName: string | null;
    nodeVersion: number | null;
    externalJobId: string | null;
    providerRequestId: string | null;
    duplicateCount: number;
  } | null> {
    const result = await client.query<{
      id: string;
      status: string;
      signal_type: string;
      correlation_id: string;
      payload: Record<string, unknown>;
      trace_id: string | null;
      node_name: string | null;
      node_version: number | null;
      external_job_id: string | null;
      provider_request_id: string | null;
      duplicate_count: number;
    }>(
      `SELECT id, status, signal_type, correlation_id, payload,
              trace_id, node_name, node_version, external_job_id,
              provider_request_id, duplicate_count
         FROM workflow_signals
        WHERE workflow_run_id = $1 AND correlation_id = $2 AND signal_type = $3`,
      [workflowRunId, correlationId, signalType],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          status: row.status,
          signalType: row.signal_type,
          correlationId: row.correlation_id,
          payload: row.payload,
          traceId: row.trace_id,
          nodeName: row.node_name,
          nodeVersion: row.node_version,
          externalJobId: row.external_job_id,
          providerRequestId: row.provider_request_id,
          duplicateCount: row.duplicate_count,
        }
      : null;
  }

  async incrementSignalDuplicate(
    client: PoolClient,
    signalId: string,
  ): Promise<void> {
    await client.query(
      `UPDATE workflow_signals
          SET duplicate_count = duplicate_count + 1, updated_at = now()
        WHERE id = $1`,
      [signalId],
    );
  }

  async claimStaleProcessingSignal(
    client: PoolClient,
    signalId: string,
    visibilityTimeoutSeconds: number,
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE workflow_signals
          SET updated_at = now()
        WHERE id = $1
          AND status = 'PROCESSING'
          AND updated_at < now() - make_interval(secs => $2)
        RETURNING id`,
      [signalId, visibilityTimeoutSeconds],
    );
    return result.rowCount === 1;
  }

  async listStaleProcessingSignals(
    visibilityTimeoutSeconds: number,
    limit: number,
  ): Promise<
    readonly {
      id: string;
      workflowRunId: string;
      signalType: string;
      correlationId: string;
      payload: Record<string, unknown>;
    }[]
  > {
    const result = await this.pool.query<{
      id: string;
      workflow_run_id: string;
      signal_type: string;
      correlation_id: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT id, workflow_run_id, signal_type, correlation_id, payload
         FROM workflow_signals
        WHERE status = 'PROCESSING'
          AND updated_at < now() - make_interval(secs => $1)
        ORDER BY created_at ASC
        LIMIT $2`,
      [visibilityTimeoutSeconds, limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      workflowRunId: row.workflow_run_id,
      signalType: row.signal_type,
      correlationId: row.correlation_id,
      payload: row.payload,
    }));
  }

  async recordNodeStarted(input: {
    id: string;
    workflowRunId: string;
    nodeName: string;
    nodeVersion: number;
    attempt: number;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO workflow_step_runs (
         id, workflow_run_id, node_name, node_version, attempt, status,
         started_at
       ) VALUES ($1, $2, $3, $4, $5, 'RUNNING', now())
       ON CONFLICT (workflow_run_id, node_name, attempt) DO NOTHING`,
      [input.id, input.workflowRunId, input.nodeName, input.nodeVersion, input.attempt],
    );
  }

  async recordNodeFinished(input: {
    workflowRunId: string;
    nodeName: string;
    attempt: number;
    status: "SUCCEEDED" | "FAILED" | "INTERRUPTED" | "CANCELLED";
    errorCode?: string | undefined;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE workflow_step_runs
          SET status = $4,
              error_code = COALESCE($5, error_code),
              completed_at = CASE WHEN $4 IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
                THEN now() ELSE completed_at END
        WHERE workflow_run_id = $1 AND node_name = $2 AND attempt = $3`,
      [
        input.workflowRunId,
        input.nodeName,
        input.attempt,
        input.status,
        input.errorCode ?? null,
      ],
    );
  }

  async appendWorkflowEvent(input: {
    id: string;
    workflowRunId: string;
    eventName: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO workflow_events (id, workflow_run_id, event_name, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [input.id, input.workflowRunId, input.eventName, JSON.stringify(input.payload)],
    );
  }

  async appendWorkflowEventWithClient(
    client: PoolClient,
    input: {
      id: string;
      workflowRunId: string;
      eventName: string;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO workflow_events (id, workflow_run_id, event_name, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [input.id, input.workflowRunId, input.eventName, JSON.stringify(input.payload)],
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

  async upsertHumanTaskWithClient(
    client: PoolClient,
    input: {
      id: string;
      workflowRunId: string;
      taskType: string;
      nodeName: string;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await client.query(
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
