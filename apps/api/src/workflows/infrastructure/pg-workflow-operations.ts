import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "@live-photo-studio/database";
import { workflowSignalSchema } from "@live-photo-studio/graph-contracts";
import type {
  WorkflowOperationsPort,
  WorkflowTriage,
} from "../application/workflow-operations-service.js";

interface RunRow {
  id: string;
  project_id: string;
  trace_id: string | null;
  status: string;
  current_phase: string | null;
  current_node: string | null;
  current_node_version: number | null;
  last_error_code: string | null;
  updated_at: Date;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function ageMs(value: Date | string): number {
  return Math.max(0, Date.now() - asDate(value).getTime());
}

function asNumber(value: number | string | null | undefined): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

export class PgWorkflowOperations implements WorkflowOperationsPort {
  constructor(private readonly pool: Pool) {}

  async getTriage(workflowRunId: string): Promise<WorkflowTriage | null> {
    const runResult = await this.pool.query<RunRow>(
      `SELECT id, project_id, trace_id, status, current_phase, current_node,
              current_node_version, last_error_code, updated_at
         FROM workflow_runs
        WHERE id = $1::uuid`,
      [workflowRunId],
    );
    const run = runResult.rows[0];
    if (!run) return null;

    const [
      tasks,
      signals,
      effects,
      nodeRuns,
      generationJobs,
      renderJobs,
      outbox,
    ] = await Promise.all([
      this.pool.query<{
        id: string;
        task_type: string;
        node_name: string;
        status: string;
        payload: unknown;
      }>(
        `SELECT id, task_type, node_name, status, payload
           FROM human_tasks
          WHERE workflow_run_id = $1::uuid
          ORDER BY created_at ASC
          LIMIT 100`,
        [workflowRunId],
      ),
      this.pool.query<{
        id: string;
        signal_type: string;
        correlation_id: string;
        status: string;
        duplicate_count: number;
        created_at: Date;
        last_error_code: string | null;
        trace_id: string | null;
        node_name: string | null;
        node_version: number | null;
        external_job_id: string | null;
      }>(
        `SELECT id, signal_type, correlation_id, status, duplicate_count,
                created_at, last_error_code, trace_id, node_name, node_version,
                external_job_id
           FROM workflow_signals
          WHERE workflow_run_id = $1::uuid
          ORDER BY created_at ASC
          LIMIT 100`,
        [workflowRunId],
      ),
      this.pool.query<{
        node_name: string;
        node_version: number | null;
        effect_key: string;
        external_job_id: string | null;
        status: string;
        created_at: Date;
        trace_id: string | null;
      }>(
        `SELECT node_name, node_version, effect_key, external_job_id, status,
                created_at, trace_id
           FROM workflow_node_effects
          WHERE workflow_run_id = $1::uuid
          ORDER BY created_at ASC
          LIMIT 100`,
        [workflowRunId],
      ),
      this.pool.query<{
        node_name: string;
        node_version: number;
        attempt: number;
        status: string;
        started_at: Date | null;
        completed_at: Date | null;
      }>(
        `SELECT node_name, node_version, attempt, status, started_at, completed_at
           FROM workflow_step_runs
          WHERE workflow_run_id = $1::uuid
          ORDER BY created_at ASC
          LIMIT 100`,
        [workflowRunId],
      ),
      this.pool.query<{
        id: string;
        status: string;
        revision: number;
        provider: string;
        error_code: string | null;
        cost_micros: number | string;
        trace_id: string | null;
      }>(
        `SELECT id, status, revision, provider, error_code, cost_micros, trace_id
           FROM generation_batches
          WHERE workflow_run_id = $1::uuid
          ORDER BY created_at ASC
          LIMIT 100`,
        [workflowRunId],
      ),
      this.pool.query<{
        id: string;
        status: string;
        selected_output_id: string;
        recipe_version: string;
        error_code: string | null;
        trace_id: string | null;
      }>(
        `SELECT id, status, selected_output_id, recipe_version, error_code, trace_id
           FROM render_jobs
          WHERE workflow_run_id = $1::uuid
          ORDER BY created_at ASC
          LIMIT 100`,
        [workflowRunId],
      ),
      this.pool.query<{
        id: string;
        event_type: string;
        status: string;
        attempts: number;
        created_at: Date;
        last_error_code: string | null;
      }>(
        `SELECT id, event_type, status, attempts, created_at, last_error_code
           FROM outbox_events
          WHERE aggregate_id = $1::text
          ORDER BY created_at ASC
          LIMIT 100`,
        [workflowRunId],
      ),
    ]);

    const triageSignals = signals.rows.map((signal) => ({
      signalId: signal.id,
      signalType: signal.signal_type,
      correlationId: signal.correlation_id,
      status: signal.status,
      duplicateCount: signal.duplicate_count,
      ageMs: ageMs(signal.created_at),
      lastErrorCode: signal.last_error_code,
      traceId: signal.trace_id,
      nodeName: signal.node_name,
      nodeVersion: signal.node_version,
      externalJobId: signal.external_job_id,
    }));
    const triageOutbox = outbox.rows.map((event) => ({
      eventId: event.id,
      eventType: event.event_type,
      status: event.status,
      attempts: event.attempts,
      ageMs: ageMs(event.created_at),
      lastErrorCode: event.last_error_code,
    }));
    const pendingOutbox = triageOutbox.filter(
      (event) => event.status === "PENDING" || event.status === "PROCESSING",
    );

    return {
      workflowRunId: run.id,
      projectId: run.project_id,
      traceId: run.trace_id,
      status: run.status,
      currentPhase: run.current_phase,
      currentNode: run.current_node,
      currentNodeVersion: run.current_node_version,
      lastErrorCode: run.last_error_code,
      updatedAt: run.updated_at.toISOString(),
      humanTasks: tasks.rows.map((task) => {
        const payload = asRecord(task.payload);
        return {
          humanTaskId: task.id,
          taskType: task.task_type,
          nodeName: task.node_name,
          status: task.status,
          allowedActions: asStringArray(payload["allowedActions"]),
          candidateOutputIds: asStringArray(payload["candidateOutputIds"]),
        };
      }),
      signals: triageSignals,
      effects: effects.rows.map((effect) => ({
        nodeName: effect.node_name,
        nodeVersion: effect.node_version,
        effectKey: effect.effect_key,
        externalJobId: effect.external_job_id,
        status: effect.status,
        ageMs: ageMs(effect.created_at),
        traceId: effect.trace_id,
      })),
      nodeRuns: nodeRuns.rows.map((node) => ({
        nodeName: node.node_name,
        nodeVersion: node.node_version,
        attempt: node.attempt,
        status: node.status,
        latencyMs:
          node.started_at && node.completed_at
            ? Math.max(
                0,
                node.completed_at.getTime() - node.started_at.getTime(),
              )
            : null,
      })),
      generationJobs: generationJobs.rows.map((job) => ({
        jobId: job.id,
        status: job.status,
        revision: job.revision,
        provider: job.provider,
        errorCode: job.error_code,
        costMicros: asNumber(job.cost_micros),
        traceId: job.trace_id,
      })),
      renderJobs: renderJobs.rows.map((job) => ({
        jobId: job.id,
        status: job.status,
        selectedOutputId: job.selected_output_id,
        recipeVersion: job.recipe_version,
        errorCode: job.error_code,
        traceId: job.trace_id,
      })),
      outbox: triageOutbox,
      metrics: {
        interruptAgeMs:
          run.status === "INTERRUPTED" ? ageMs(run.updated_at) : null,
        oldestQueueAgeMs:
          pendingOutbox.length > 0
            ? Math.max(...pendingOutbox.map((event) => event.ageMs))
            : null,
        duplicateSignalCount: triageSignals.reduce(
          (total, signal) => total + signal.duplicateCount,
          0,
        ),
        renderFailureCount: renderJobs.rows.filter(
          (job) => job.status === "FAILED",
        ).length,
        modelCostMicros: generationJobs.rows.reduce(
          (total, job) => total + asNumber(job.cost_micros),
          0,
        ),
      },
    };
  }

  async recordAudit(input: {
    operatorId: string;
    workflowRunId: string;
    action: string;
    commandVersion: string;
    outcome: "ALLOWED" | "DENIED" | "REJECTED";
    reason: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO workflow_admin_audit_events (
         id, operator_id, workflow_run_id, action, command_version,
         outcome, reason, payload
       ) VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb)`,
      [
        randomUUID(),
        input.operatorId,
        input.workflowRunId,
        input.action,
        input.commandVersion,
        input.outcome,
        input.reason,
        JSON.stringify(input.payload ?? {}),
      ],
    );
  }

  async replaySignal(input: {
    operatorId: string;
    workflowRunId: string;
    signalId: string;
    commandVersion: "v1";
    reason: string;
  }): Promise<
    | { readonly status: "ACCEPTED"; readonly eventId: string }
    | { readonly status: "CONFLICT"; readonly code: string }
    | null
  > {
    return withTransaction(this.pool, async (client) => {
      const run = await client.query<{ id: string }>(
        "SELECT id FROM workflow_runs WHERE id = $1::uuid FOR UPDATE",
        [input.workflowRunId],
      );
      if (!run.rows[0]) return null;
      const signal = await client.query<{
        id: string;
        workflow_run_id: string;
        signal_type: string;
        correlation_id: string;
        payload: unknown;
        status: string;
        trace_id: string | null;
        node_name: string | null;
        node_version: number | null;
        external_job_id: string | null;
        provider_request_id: string | null;
      }>(
        `SELECT id, workflow_run_id, signal_type, correlation_id, payload,
                status, trace_id, node_name, node_version, external_job_id,
                provider_request_id
           FROM workflow_signals
          WHERE id = $1::uuid AND workflow_run_id = $2::uuid
          FOR UPDATE`,
        [input.signalId, input.workflowRunId],
      );
      const row = signal.rows[0];
      if (!row) {
        await this.insertAudit(client, {
          operatorId: input.operatorId,
          workflowRunId: input.workflowRunId,
          action: "SIGNAL_REPLAY",
          commandVersion: input.commandVersion,
          outcome: "REJECTED",
          reason: "SIGNAL_NOT_FOUND",
        });
        return { status: "CONFLICT", code: "SIGNAL_NOT_FOUND" } as const;
      }
      if (row.status === "CONSUMED") {
        await this.insertAudit(client, {
          operatorId: input.operatorId,
          workflowRunId: input.workflowRunId,
          action: "SIGNAL_REPLAY",
          commandVersion: input.commandVersion,
          outcome: "REJECTED",
          reason: "SIGNAL_ALREADY_CONSUMED",
        });
        return { status: "CONFLICT", code: "SIGNAL_ALREADY_CONSUMED" } as const;
      }
      if (row.status !== "PROCESSING" && row.status !== "FAILED") {
        await this.insertAudit(client, {
          operatorId: input.operatorId,
          workflowRunId: input.workflowRunId,
          action: "SIGNAL_REPLAY",
          commandVersion: input.commandVersion,
          outcome: "REJECTED",
          reason: "SIGNAL_NOT_REPLAYABLE",
        });
        return { status: "CONFLICT", code: "SIGNAL_NOT_REPLAYABLE" } as const;
      }

      const parsed = workflowSignalSchema.safeParse({
        signalId: row.id,
        workflowRunId: row.workflow_run_id,
        signalType: row.signal_type,
        correlationId: row.correlation_id,
        payload: asRecord(row.payload),
        emittedAt: new Date().toISOString(),
        ...(row.trace_id ? { traceId: row.trace_id } : {}),
        ...(row.node_name ? { nodeName: row.node_name } : {}),
        ...(row.node_version ? { nodeVersion: row.node_version } : {}),
        ...(row.external_job_id ? { externalJobId: row.external_job_id } : {}),
        ...(row.provider_request_id
          ? { providerRequestId: row.provider_request_id }
          : {}),
      });
      if (!parsed.success) {
        await this.insertAudit(client, {
          operatorId: input.operatorId,
          workflowRunId: input.workflowRunId,
          action: "SIGNAL_REPLAY",
          commandVersion: input.commandVersion,
          outcome: "REJECTED",
          reason: "SIGNAL_PAYLOAD_INVALID",
        });
        return { status: "CONFLICT", code: "SIGNAL_PAYLOAD_INVALID" } as const;
      }

      const eventId = deterministicUuid(`workflow-signal-replay:v1:${row.id}`);
      await this.insertAudit(client, {
        operatorId: input.operatorId,
        workflowRunId: input.workflowRunId,
        action: "SIGNAL_REPLAY",
        commandVersion: input.commandVersion,
        outcome: "ALLOWED",
        reason: input.reason,
        payload: { signalId: row.id, eventId },
      });
      await client.query(
        `UPDATE workflow_signals
            SET status = 'PROCESSING', last_error_code = NULL, updated_at = now()
          WHERE id = $1::uuid`,
        [row.id],
      );
      await client.query(
        `INSERT INTO outbox_events (
           id, aggregate_type, aggregate_id, event_type, payload, status,
           trace_id, node_name, node_version, external_job_id, provider_request_id
         ) VALUES ($1::uuid, 'workflow', $2::text, $3, $4::jsonb, 'PENDING',
                   $5, $6, $7, $8::uuid, $9)
         ON CONFLICT (id) DO NOTHING`,
        [
          eventId,
          input.workflowRunId,
          row.signal_type,
          JSON.stringify(parsed.data),
          row.trace_id,
          row.node_name,
          row.node_version,
          row.external_job_id,
          row.provider_request_id,
        ],
      );
      return { status: "ACCEPTED", eventId } as const;
    });
  }

  private async insertAudit(
    client: PoolClient,
    input: {
      operatorId: string;
      workflowRunId: string;
      action: string;
      commandVersion: string;
      outcome: "ALLOWED" | "DENIED" | "REJECTED";
      reason: string;
      payload?: Record<string, unknown>;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO workflow_admin_audit_events (
         id, operator_id, workflow_run_id, action, command_version,
         outcome, reason, payload
       ) VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb)`,
      [
        randomUUID(),
        input.operatorId,
        input.workflowRunId,
        input.action,
        input.commandVersion,
        input.outcome,
        input.reason,
        JSON.stringify(input.payload ?? {}),
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
