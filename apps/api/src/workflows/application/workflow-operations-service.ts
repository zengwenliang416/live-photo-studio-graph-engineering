import { ApplicationProblemError } from "../../http/problem-details.js";

export interface WorkflowTriage {
  readonly workflowRunId: string;
  readonly projectId: string;
  readonly traceId: string | null;
  readonly status: string;
  readonly currentPhase: string | null;
  readonly currentNode: string | null;
  readonly currentNodeVersion: number | null;
  readonly lastErrorCode: string | null;
  readonly updatedAt: string;
  readonly humanTasks: readonly {
    readonly humanTaskId: string;
    readonly taskType: string;
    readonly nodeName: string;
    readonly status: string;
    readonly allowedActions: readonly string[];
    readonly candidateOutputIds: readonly string[];
  }[];
  readonly signals: readonly {
    readonly signalId: string;
    readonly signalType: string;
    readonly correlationId: string;
    readonly status: string;
    readonly duplicateCount: number;
    readonly ageMs: number;
    readonly lastErrorCode: string | null;
    readonly traceId: string | null;
    readonly nodeName: string | null;
    readonly nodeVersion: number | null;
    readonly externalJobId: string | null;
  }[];
  readonly effects: readonly {
    readonly nodeName: string;
    readonly nodeVersion: number | null;
    readonly effectKey: string;
    readonly externalJobId: string | null;
    readonly status: string;
    readonly ageMs: number;
    readonly traceId: string | null;
  }[];
  readonly nodeRuns: readonly {
    readonly nodeName: string;
    readonly nodeVersion: number;
    readonly attempt: number;
    readonly status: string;
    readonly latencyMs: number | null;
  }[];
  readonly generationJobs: readonly {
    readonly jobId: string;
    readonly status: string;
    readonly revision: number;
    readonly provider: string;
    readonly errorCode: string | null;
    readonly costMicros: number;
    readonly traceId: string | null;
  }[];
  readonly renderJobs: readonly {
    readonly jobId: string;
    readonly status: string;
    readonly selectedOutputId: string;
    readonly recipeVersion: string;
    readonly errorCode: string | null;
    readonly traceId: string | null;
  }[];
  readonly outbox: readonly {
    readonly eventId: string;
    readonly eventType: string;
    readonly status: string;
    readonly attempts: number;
    readonly ageMs: number;
    readonly lastErrorCode: string | null;
  }[];
  readonly metrics: {
    readonly interruptAgeMs: number | null;
    readonly oldestQueueAgeMs: number | null;
    readonly duplicateSignalCount: number;
    readonly renderFailureCount: number;
    readonly modelCostMicros: number;
  };
}

export interface WorkflowOperationsPort {
  getTriage(workflowRunId: string): Promise<WorkflowTriage | null>;
  recordAudit(input: {
    operatorId: string;
    workflowRunId: string;
    action: string;
    commandVersion: string;
    outcome: "ALLOWED" | "DENIED" | "REJECTED";
    reason: string;
    payload?: Record<string, unknown>;
  }): Promise<void>;
  replaySignal(input: {
    operatorId: string;
    workflowRunId: string;
    signalId: string;
    commandVersion: "v1";
    reason: string;
  }): Promise<
    | { readonly status: "ACCEPTED"; readonly eventId: string }
    | { readonly status: "CONFLICT"; readonly code: string }
    | null
  >;
}

export class WorkflowOperationsService {
  private readonly operatorIds: ReadonlySet<string>;

  constructor(
    private readonly operations: WorkflowOperationsPort,
    operatorIds: readonly string[],
  ) {
    this.operatorIds = new Set(operatorIds.filter((value) => value.length > 0));
  }

  async getTriage(input: {
    operatorId: string;
    workflowRunId: string;
  }): Promise<{ data: WorkflowTriage }> {
    await this.requireOperator(input.operatorId, input.workflowRunId, "TRIAGE_READ");
    const triage = await this.operations.getTriage(input.workflowRunId);
    if (!triage) {
      throw new ApplicationProblemError(
        404,
        "WORKFLOW_RUN_NOT_FOUND",
        "Workflow run not found.",
      );
    }
    return { data: triage };
  }

  async replaySignal(input: {
    operatorId: string;
    workflowRunId: string;
    signalId: string;
    reason: string;
  }): Promise<{ data: { status: "ACCEPTED"; eventId: string } }> {
    await this.requireOperator(
      input.operatorId,
      input.workflowRunId,
      "SIGNAL_REPLAY",
    );
    const result = await this.operations.replaySignal({
      ...input,
      commandVersion: "v1",
    });
    if (!result) {
      throw new ApplicationProblemError(
        404,
        "WORKFLOW_RUN_NOT_FOUND",
        "Workflow run not found.",
      );
    }
    if (result.status === "CONFLICT") {
      throw new ApplicationProblemError(
        409,
        result.code,
        "The signal cannot be replayed.",
      );
    }
    return { data: result };
  }

  private async requireOperator(
    operatorId: string,
    workflowRunId: string,
    action: string,
  ): Promise<void> {
    if (this.operatorIds.has(operatorId)) return;
    await this.operations.recordAudit({
      operatorId,
      workflowRunId,
      action,
      commandVersion: "v1",
      outcome: "DENIED",
      reason: "OPERATOR_REQUIRED",
    });
    throw new ApplicationProblemError(
      403,
      "OPERATOR_ACCESS_REQUIRED",
      "An operator identity is required.",
    );
  }
}
