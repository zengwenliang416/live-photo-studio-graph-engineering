import { ApplicationProblemError } from "../http/problem-details.js";
import {
  IdempotencyConflictError,
  type HumanTaskRow,
  type OutboxEventInput,
  type StoredIdempotentResponse,
  type WorkflowRunRow,
  type WorkflowTx,
  type WorkflowUnitPort,
} from "../workflows/ports.js";

export interface InMemoryState {
  readonly projects: Map<string, string>;
  readonly runs: Map<string, WorkflowRunRow>;
  readonly tasks: Map<string, { task: HumanTaskRow; runUserId: string }>;
  readonly outbox: OutboxEventInput[];
  readonly idempotency: Map<string, StoredIdempotentResponse>;
}

function idempotencyRecordKey(
  scope: string,
  idempotencyKey: string,
  userId: string,
): string {
  return `${userId}::${scope}::${idempotencyKey}`;
}

/**
 * Mirrors the SQL semantics the application service relies on:
 * unique idempotency records, single pending task completion and
 * transactional outbox writes.
 */
export class InMemoryWorkflowUnit implements WorkflowUnitPort {
  readonly projects = new Map<string, string>();
  readonly runs = new Map<string, WorkflowRunRow>();
  readonly tasks = new Map<string, { task: HumanTaskRow; runUserId: string }>();
  readonly outbox: OutboxEventInput[] = [];
  readonly idempotency = new Map<string, StoredIdempotentResponse>();

  seedProject(projectId: string, ownerUserId: string): void {
    this.projects.set(projectId, ownerUserId);
  }

  seedRun(run: WorkflowRunRow): void {
    this.runs.set(run.id, run);
  }

  seedTask(task: HumanTaskRow, runUserId: string): void {
    this.tasks.set(task.id, { task, runUserId });
  }

  completedTaskResults: Array<{ taskId: string; result: unknown }> = [];

  async transact<T>(work: (tx: WorkflowTx) => Promise<T>): Promise<T> {
    return work(this.buildTx());
  }

  private buildTx(): WorkflowTx {
    const state = this;
    return {
      async assertProjectOwner(projectId, userId): Promise<void> {
        if (state.projects.get(projectId) !== userId) {
          throw new ApplicationProblemError(
            403,
            "PROJECT_ACCESS_DENIED",
            "Project access denied.",
            "The caller does not own this project.",
          );
        }
      },
      async insertWorkflowRun(run): Promise<void> {
        if (state.runs.has(run.id)) return;
        state.runs.set(run.id, {
          ...run,
          traceId: run.traceId ?? null,
          status: "QUEUED",
          currentNode: null,
          currentPhase: null,
          pendingHumanTaskId: null,
          updatedAt: new Date().toISOString(),
        });
      },
      async insertOutboxEvent(event): Promise<void> {
        state.outbox.push(event);
      },
      async findIdempotentResponse(scope, key, userId) {
        return (
          state.idempotency.get(idempotencyRecordKey(scope, key, userId)) ??
          null
        );
      },
      async recordIdempotentResponse(input): Promise<void> {
        const recordKey = idempotencyRecordKey(
          input.scope,
          input.idempotencyKey,
          input.userId,
        );
        if (state.idempotency.has(recordKey)) {
          throw new IdempotencyConflictError();
        }
        state.idempotency.set(recordKey, {
          requestHash: input.requestHash,
          responseStatus: input.responseStatus,
          responseBody: input.responseBody,
        });
      },
      async findRunById(runId) {
        return state.runs.get(runId) ?? null;
      },
      async listHumanTasksForRun(runId) {
        return [...state.tasks.values()]
          .filter((entry) => entry.task.workflowRunId === runId)
          .map((entry) => entry.task)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      },
      async findTaskById(taskId) {
        const entry = state.tasks.get(taskId);
        const run = entry ? state.runs.get(entry.task.workflowRunId) : undefined;
        return entry
          ? {
              task: entry.task,
              runUserId: entry.runUserId,
              ...(run?.projectId ? { projectId: run.projectId } : {}),
              traceId: run?.traceId,
            }
          : null;
      },
      async completePendingTask(taskId, result): Promise<boolean> {
        const entry = state.tasks.get(taskId);
        if (!entry || entry.task.status !== "PENDING") return false;
        entry.task = { ...entry.task, status: "COMPLETED" };
        state.tasks.set(taskId, entry);
        state.completedTaskResults.push({ taskId, result });
        return true;
      },
    };
  }
}
