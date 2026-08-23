export interface StoredIdempotentResponse {
  readonly requestHash: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
}

export type WorkflowRunStatusValue =
  | "QUEUED"
  | "RUNNING"
  | "INTERRUPTED"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export interface WorkflowRunRow {
  readonly id: string;
  readonly projectId: string;
  readonly userId: string;
  readonly traceId?: string | null;
  readonly graphKey: string;
  readonly graphVersion: string;
  readonly status: WorkflowRunStatusValue | string;
  readonly currentNode: string | null;
  readonly currentPhase: string | null;
  readonly pendingHumanTaskId: string | null;
  readonly updatedAt: string;
}

export interface HumanTaskRow {
  readonly id: string;
  readonly workflowRunId: string;
  readonly taskType: string;
  readonly nodeName: string;
  readonly status: "PENDING" | "COMPLETED" | "CANCELLED" | "EXPIRED" | string;
  readonly allowedActions: readonly string[];
  readonly candidateOutputIds: readonly string[];
  readonly createdAt: string;
}

export interface OutboxEventInput {
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: unknown;
}

export interface WorkflowRunInsert {
  readonly id: string;
  readonly projectId: string;
  readonly userId: string;
  readonly traceId?: string | undefined;
  readonly graphKey: string;
  readonly graphVersion: string;
}

export interface WorkflowTx {
  assertProjectOwner(projectId: string, userId: string): Promise<void>;
  insertWorkflowRun(run: WorkflowRunInsert): Promise<void>;
  insertOutboxEvent(event: OutboxEventInput): Promise<void>;
  findIdempotentResponse(
    scope: string,
    idempotencyKey: string,
    userId: string,
  ): Promise<StoredIdempotentResponse | null>;
  recordIdempotentResponse(input: {
    scope: string;
    idempotencyKey: string;
    userId: string;
    requestHash: string;
    responseStatus: number;
    responseBody: unknown;
  }): Promise<void>;
  findRunById(runId: string): Promise<WorkflowRunRow | null>;
  listHumanTasksForRun(runId: string): Promise<readonly HumanTaskRow[]>;
  findTaskById(
    taskId: string,
  ): Promise<{
    task: HumanTaskRow;
    runUserId: string;
    projectId?: string | undefined;
    traceId?: string | null | undefined;
  } | null>;
  completePendingTask(taskId: string, result: unknown): Promise<boolean>;
}

/**
 * Thrown by infrastructure when a concurrent request inserted the same
 * idempotency record first (unique constraint race). The application service
 * retries once and then serves the stored response or a conflict.
 */
export class IdempotencyConflictError extends Error {
  constructor() {
    super("Concurrent idempotency record insertion detected.");
    this.name = "IdempotencyConflictError";
  }
}

export interface WorkflowUnitPort {
  transact<T>(work: (tx: WorkflowTx) => Promise<T>): Promise<T>;
}
