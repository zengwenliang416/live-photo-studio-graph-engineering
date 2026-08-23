import type { Pool, PoolClient } from "pg";
import { withTransaction } from "@live-photo-studio/database";
import { ApplicationProblemError } from "../../http/problem-details.js";
import {
  IdempotencyConflictError,
  type HumanTaskRow,
  type StoredIdempotentResponse,
  type WorkflowRunRow,
  type WorkflowRunStatusValue,
  type WorkflowTx,
  type WorkflowUnitPort,
} from "../ports.js";

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function mapRunRow(row: Record<string, unknown>): WorkflowRunRow {
  const pendingHumanTaskId = row["pending_human_task_id"];
  return {
    id: row["id"] as string,
    projectId: row["project_id"] as string,
    userId: row["user_id"] as string,
    graphKey: row["graph_key"] as string,
    graphVersion: row["graph_version"] as string,
    status: row["status"] as WorkflowRunStatusValue | string,
    currentNode: (row["current_node"] as string | null) ?? null,
    currentPhase: (row["current_phase"] as string | null) ?? null,
    pendingHumanTaskId:
      typeof pendingHumanTaskId === "string" ? pendingHumanTaskId : null,
    updatedAt: (row["updated_at"] as Date).toISOString(),
  };
}

export class PgWorkflowUnit implements WorkflowUnitPort {
  constructor(private readonly pool: Pool) {}

  async transact<T>(work: (tx: WorkflowTx) => Promise<T>): Promise<T> {
    try {
      return await withTransaction(this.pool, (client) =>
        work(new PgWorkflowTx(client)),
      );
    } catch (error) {
      // The idempotency primary key turns a concurrent duplicate request into
      // a typed retry signal; the application layer retries and replays.
      if (
        isUniqueViolation(error) &&
        String((error as { constraint?: unknown }).constraint ?? "").startsWith(
          "idempotency_keys_pkey",
        )
      ) {
        throw new IdempotencyConflictError();
      }
      throw error;
    }
  }
}

class PgWorkflowTx implements WorkflowTx {
  constructor(private readonly client: PoolClient) {}

  async assertProjectOwner(projectId: string, userId: string): Promise<void> {
    const result = await this.client.query(
      "SELECT 1 FROM projects WHERE id = $1 AND user_id = $2",
      [projectId, userId],
    );
    if (result.rowCount === 0) {
      throw new ApplicationProblemError(
        403,
        "PROJECT_ACCESS_DENIED",
        "Project access denied.",
        "The caller does not own this project.",
      );
    }
  }

  async insertWorkflowRun(input: {
    id: string;
    projectId: string;
    userId: string;
    graphKey: string;
    graphVersion: string;
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO workflow_runs (
         id, project_id, user_id, graph_key, graph_version, thread_id, status
       ) VALUES ($1, $2, $3, $4, $5, $1, 'QUEUED')
       ON CONFLICT (id) DO NOTHING`,
      [
        input.id,
        input.projectId,
        input.userId,
        input.graphKey,
        input.graphVersion,
      ],
    );
  }

  async insertOutboxEvent(input: {
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: unknown;
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO outbox_events (
         id, aggregate_type, aggregate_id, event_type, payload, status
       ) VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb, 'PENDING')`,
      [
        input.aggregateType,
        input.aggregateId,
        input.eventType,
        JSON.stringify(input.payload),
      ],
    );
  }

  async findIdempotentResponse(
    scope: string,
    idempotencyKey: string,
    userId: string,
  ): Promise<StoredIdempotentResponse | null> {
    const result = await this.client.query<{
      request_hash: string;
      response_status: number;
      response_body: unknown;
    }>(
      `SELECT request_hash, response_status, response_body
         FROM idempotency_keys
        WHERE scope = $1 AND idempotency_key = $2 AND user_id = $3
        FOR UPDATE`,
      [scope, idempotencyKey, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      requestHash: row.request_hash,
      responseStatus: row.response_status,
      responseBody: row.response_body,
    };
  }

  async recordIdempotentResponse(input: {
    scope: string;
    idempotencyKey: string;
    userId: string;
    requestHash: string;
    responseStatus: number;
    responseBody: unknown;
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO idempotency_keys (
         scope, idempotency_key, user_id, request_hash,
         response_status, response_body
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        input.scope,
        input.idempotencyKey,
        input.userId,
        input.requestHash,
        input.responseStatus,
        JSON.stringify(input.responseBody),
      ],
    );
  }

  async findRunById(runId: string): Promise<WorkflowRunRow | null> {
    const result = await this.client.query<Record<string, unknown>>(
      `SELECT r.id, r.project_id, r.user_id, r.graph_key, r.graph_version,
              r.status, r.current_node, r.current_phase, r.updated_at,
              (SELECT ht.id FROM human_tasks ht
                WHERE ht.workflow_run_id = r.id AND ht.status = 'PENDING'
                ORDER BY ht.created_at DESC LIMIT 1) AS pending_human_task_id
         FROM workflow_runs r
        WHERE r.id = $1`,
      [runId],
    );
    const row = result.rows[0];
    return row ? mapRunRow(row) : null;
  }

  async listHumanTasksForRun(runId: string): Promise<readonly HumanTaskRow[]> {
    const result = await this.client.query<Record<string, unknown>>(
      `SELECT ht.id, ht.workflow_run_id, ht.task_type, ht.node_name,
              ht.status, ht.payload, ht.created_at
         FROM human_tasks ht
        WHERE ht.workflow_run_id = $1
        ORDER BY ht.created_at ASC`,
      [runId],
    );
    return result.rows.map((row) => {
      const payload = row["payload"] as Record<string, unknown>;
      return {
        id: row["id"] as string,
        workflowRunId: row["workflow_run_id"] as string,
        taskType: row["task_type"] as string,
        nodeName: row["node_name"] as string,
        status: row["status"] as HumanTaskRow["status"],
        allowedActions: asStringArray(payload["allowedActions"]),
        candidateOutputIds: asStringArray(payload["candidateOutputIds"]),
        createdAt: (row["created_at"] as Date).toISOString(),
      };
    });
  }

  async findTaskById(taskId: string): Promise<{
    task: HumanTaskRow;
    runUserId: string;
  } | null> {
    const result = await this.client.query<Record<string, unknown>>(
      `SELECT ht.id, ht.workflow_run_id, ht.task_type, ht.node_name,
              ht.status, ht.payload, ht.created_at, r.user_id AS run_user_id
         FROM human_tasks ht
         JOIN workflow_runs r ON r.id = ht.workflow_run_id
        WHERE ht.id = $1`,
      [taskId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const payload = row["payload"] as Record<string, unknown>;
    return {
      runUserId: row["run_user_id"] as string,
      task: {
        id: row["id"] as string,
        workflowRunId: row["workflow_run_id"] as string,
        taskType: row["task_type"] as string,
        nodeName: row["node_name"] as string,
        status: row["status"] as HumanTaskRow["status"],
        allowedActions: asStringArray(payload["allowedActions"]),
        candidateOutputIds: asStringArray(payload["candidateOutputIds"]),
        createdAt: (row["created_at"] as Date).toISOString(),
      },
    };
  }

  async completePendingTask(taskId: string, result: unknown): Promise<boolean> {
    const update = await this.client.query(
      `UPDATE human_tasks
          SET status = 'COMPLETED',
              result = $2::jsonb,
              completed_at = now(),
              updated_at = now()
        WHERE id = $1 AND status = 'PENDING'
        RETURNING id`,
      [taskId, JSON.stringify(result)],
    );
    return update.rowCount === 1;
  }
}
