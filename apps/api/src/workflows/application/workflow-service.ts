import { randomUUID } from "node:crypto";
import type {
  WorkflowCommand,
  WorkflowProjection,
  WorkflowSignal,
} from "@live-photo-studio/graph-contracts";
import { workflowProjectionSchema } from "@live-photo-studio/graph-contracts";
import { ApplicationProblemError } from "../../http/problem-details.js";
import { hashRequest } from "./canonical-json.js";
import type {
  WorkflowCandidatePreviewSignerPort,
  WorkflowTx,
  WorkflowUnitPort,
} from "../ports.js";
import { IdempotencyConflictError } from "../ports.js";

export interface StartWorkflowRunBody {
  readonly graphKey?: string;
  readonly graphVersion?: string;
  readonly input?: Record<string, unknown>;
}

export interface HumanTaskDecisionBody {
  readonly action: "SELECT" | "REGENERATE" | "CANCEL";
  readonly selectedOutputId?: string;
  readonly feedback?: string;
}

export interface CancelWorkflowRunBody {
  readonly reason?: string;
}

export interface UseCaseResult {
  readonly status: number;
  readonly body: unknown;
}

const TERMINAL_RUN_STATUSES = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);
const PUBLISHED_GRAPHS = new Set(["live-photo-project:v1"]);

function notFound(code: string, detail: string): ApplicationProblemError {
  return new ApplicationProblemError(404, code, "Resource not found.", detail);
}

function forbidden(detail: string): ApplicationProblemError {
  return new ApplicationProblemError(
    403,
    "PROJECT_ACCESS_DENIED",
    "Project access denied.",
    detail,
  );
}

function conflict(code: string, title: string): ApplicationProblemError {
  return new ApplicationProblemError(409, code, title);
}

function validationFailed(detail: string): ApplicationProblemError {
  return new ApplicationProblemError(
    422,
    "VALIDATION_FAILED",
    "Request validation failed.",
    detail,
  );
}

/**
 * Application layer for the workflow command/query boundary. The API never
 * touches a compiled graph: it writes domain records and Outbox envelopes in
 * one transaction and the orchestrator consumes them.
 */
export class WorkflowService {
  constructor(
    private readonly unit: WorkflowUnitPort,
    private readonly candidatePreviewSigner: WorkflowCandidatePreviewSignerPort | null =
      null,
  ) {}

  async startWorkflowRun(params: {
    projectId: string;
    userId: string;
    traceId?: string | undefined;
    idempotencyKey: string;
    body: StartWorkflowRunBody;
  }): Promise<UseCaseResult> {
    const scope = `POST:/v1/projects/${params.projectId}/workflow-runs`;
    return this.executeIdempotently({
      scope,
      idempotencyKey: params.idempotencyKey,
      userId: params.userId,
      requestHash: hashRequest(params.body),
      work: async (tx) => {
        await tx.assertProjectOwner(params.projectId, params.userId);
        const workflowRunId = randomUUID();
        const traceId = params.traceId ?? randomUUID();
        const graphKey = params.body.graphKey ?? "live-photo-project";
        const graphVersion = params.body.graphVersion ?? "v1";
        if (!PUBLISHED_GRAPHS.has(`${graphKey}:${graphVersion}`)) {
          throw validationFailed(
            `Graph ${graphKey}:${graphVersion} is not published for new runs.`,
          );
        }
        const envelope: WorkflowCommand = {
          type: "START_WORKFLOW",
          commandId: randomUUID(),
          workflowRunId,
          projectId: params.projectId,
          userId: params.userId,
          graphKey,
          graphVersion,
          traceId,
          input: {
            ...(params.body.input ?? {}),
            workflowRunId,
            projectId: params.projectId,
            userId: params.userId,
            graphKey,
            graphVersion,
          },
          requestedAt: new Date().toISOString(),
        };
        await tx.insertWorkflowRun({
          id: workflowRunId,
          projectId: params.projectId,
          userId: params.userId,
          traceId,
          graphKey,
          graphVersion,
        });
        await tx.insertOutboxEvent({
          aggregateType: "workflow",
          aggregateId: workflowRunId,
          eventType: "START_WORKFLOW",
          payload: envelope,
        });
        return {
          status: 202,
          body: {
            data: {
              workflowRunId,
              projectId: params.projectId,
              graphKey,
              graphVersion,
              status: "QUEUED",
              currentPhase: null,
            },
          },
        };
      },
    });
  }

  async getWorkflowRun(params: {
    workflowRunId: string;
    userId: string;
  }): Promise<UseCaseResult> {
    const projection: WorkflowProjection | null = await this.unit.transact(
      async (tx) => {
        const run = await tx.findRunById(params.workflowRunId);
        if (!run) {
          throw notFound(
            "WORKFLOW_RUN_NOT_FOUND",
            `Workflow run ${params.workflowRunId} was not found.`,
          );
        }
        if (run.userId !== params.userId) {
          throw forbidden("The caller does not own this workflow run.");
        }
        return workflowProjectionSchema.parse({
          workflowRunId: run.id,
          projectId: run.projectId,
          graphKey: run.graphKey,
          graphVersion: run.graphVersion,
          status: run.status,
          currentNode: run.currentNode ?? null,
          currentPhase: run.currentPhase ?? null,
          pendingHumanTaskId: run.pendingHumanTaskId ?? null,
          updatedAt: run.updatedAt,
        });
      },
    );
    return { status: 200, body: { data: projection } };
  }

  async listHumanTasks(params: {
    workflowRunId: string;
    userId: string;
  }): Promise<UseCaseResult> {
    const { tasks, outputs } = await this.unit.transact(
      async (tx) => {
        const run = await tx.findRunById(params.workflowRunId);
        if (!run) {
          throw notFound(
            "WORKFLOW_RUN_NOT_FOUND",
            `Workflow run ${params.workflowRunId} was not found.`,
          );
        }
        if (run.userId !== params.userId) {
          throw forbidden("The caller does not own this workflow run.");
        }
        const tasks = await tx.listHumanTasksForRun(params.workflowRunId);
        const candidateOutputIds = [
          ...new Set(tasks.flatMap((task) => task.candidateOutputIds)),
        ];
        const outputs = await tx.listGenerationOutputsForRun(
          params.workflowRunId,
          candidateOutputIds,
        );
        return { tasks, outputs };
      },
    );
    const signedCandidates = await Promise.all(
      outputs.map(async (output) => {
        if (this.candidatePreviewSigner === null) {
          return {
            ...output,
            previewUrl: null,
            previewExpiresAt: null,
          };
        }
        try {
          const signed = await this.candidatePreviewSigner.sign(
            output.storageKey,
          );
          return {
            ...output,
            previewUrl: signed.url,
            previewExpiresAt: signed.expiresAt,
          };
        } catch {
          return {
            ...output,
            previewUrl: null,
            previewExpiresAt: null,
          };
        }
      }),
    );
    const candidatesById = new Map(
      signedCandidates.map((candidate) => [candidate.id, candidate]),
    );
    return {
      status: 200,
      body: {
        data: tasks.map((task) => ({
          humanTaskId: task.id,
          taskType: task.taskType,
          nodeName: task.nodeName,
          status: task.status,
          allowedActions: task.allowedActions,
          candidateOutputIds: task.candidateOutputIds,
          candidates: task.candidateOutputIds.flatMap((outputId) => {
            const candidate = candidatesById.get(outputId);
            return candidate
              ? [
                  {
                    outputId: candidate.id,
                    previewUrl: candidate.previewUrl,
                    previewExpiresAt: candidate.previewExpiresAt,
                    width: candidate.width,
                    height: candidate.height,
                  },
                ]
              : [];
          }),
          createdAt: task.createdAt,
        })),
      },
    };
  }

  async submitHumanTaskDecision(params: {
    humanTaskId: string;
    userId: string;
    idempotencyKey: string;
    body: HumanTaskDecisionBody;
  }): Promise<UseCaseResult> {
    const scope = `POST:/v1/human-tasks/${params.humanTaskId}/decisions`;
    return this.executeIdempotently({
      scope,
      idempotencyKey: params.idempotencyKey,
      userId: params.userId,
      requestHash: hashRequest(params.body),
      work: async (tx) => {
        const found = await tx.findTaskById(params.humanTaskId);
        if (!found) {
          throw notFound(
            "HUMAN_TASK_NOT_FOUND",
            `Human task ${params.humanTaskId} was not found.`,
          );
        }
        if (found.runUserId !== params.userId) {
          throw forbidden("The caller does not own this human task.");
        }
        const task = found.task;
        if (task.status !== "PENDING") {
          throw conflict(
            "HUMAN_TASK_NOT_PENDING",
            "The human task is no longer pending.",
          );
        }
        if (!task.allowedActions.includes(params.body.action)) {
          throw validationFailed(
            `Action ${params.body.action} is not allowed for this task.`,
          );
        }
        let selectedOutputId: string | undefined;
        if (params.body.action === "SELECT") {
          selectedOutputId = params.body.selectedOutputId;
          if (!selectedOutputId) {
            throw validationFailed(
              "selectedOutputId is required for the SELECT action.",
            );
          }
          if (!task.candidateOutputIds.includes(selectedOutputId)) {
            throw validationFailed(
              "selectedOutputId does not belong to this task's candidates.",
            );
          }
        }
        const payload: Record<string, unknown> = {
          action: params.body.action,
        };
        if (selectedOutputId !== undefined) {
          payload["selectedOutputId"] = selectedOutputId;
        }
        const feedback = params.body.feedback;
        if (feedback !== undefined) {
          payload["feedback"] = feedback;
        }
        const completed = await tx.completePendingTask(task.id, payload);
        if (!completed) {
          throw conflict(
            "HUMAN_TASK_NOT_PENDING",
            "The human task is no longer pending.",
          );
        }
        const signal: WorkflowSignal = {
          signalId: randomUUID(),
          workflowRunId: task.workflowRunId,
          signalType: "HUMAN_TASK_COMPLETED",
          correlationId: task.id,
          payload,
          emittedAt: new Date().toISOString(),
          traceId: found.traceId ?? task.workflowRunId,
          nodeName: task.nodeName,
        };
        await tx.insertOutboxEvent({
          aggregateType: "workflow",
          aggregateId: task.workflowRunId,
          eventType: "HUMAN_TASK_COMPLETED",
          payload: signal,
        });
        return {
          status: 202,
          body: { data: { humanTaskId: task.id, status: "COMPLETED" } },
        };
      },
    });
  }

  async cancelWorkflowRun(params: {
    workflowRunId: string;
    userId: string;
    idempotencyKey: string;
    body: CancelWorkflowRunBody;
  }): Promise<UseCaseResult> {
    const scope = `POST:/v1/workflow-runs/${params.workflowRunId}/cancel`;
    return this.executeIdempotently({
      scope,
      idempotencyKey: params.idempotencyKey,
      userId: params.userId,
      requestHash: hashRequest(params.body),
      work: async (tx) => {
        const run = await tx.findRunById(params.workflowRunId);
        if (!run) {
          throw notFound(
            "WORKFLOW_RUN_NOT_FOUND",
            `Workflow run ${params.workflowRunId} was not found.`,
          );
        }
        if (run.userId !== params.userId) {
          throw forbidden("The caller does not own this workflow run.");
        }
        if (TERMINAL_RUN_STATUSES.has(run.status)) {
          throw conflict(
            "WORKFLOW_RUN_TERMINAL",
            "The workflow run already reached a terminal state.",
          );
        }
        const pendingTask =
          run.pendingHumanTaskId === null
            ? undefined
            : (await tx.listHumanTasksForRun(run.id)).find(
                (task) => task.id === run.pendingHumanTaskId,
              );
        if (
          pendingTask?.status !== "PENDING" ||
          !pendingTask.allowedActions.includes("CANCEL")
        ) {
          throw conflict(
            "WORKFLOW_CANCEL_NOT_ALLOWED",
            "Cancellation is not allowed by the current task.",
          );
        }
        const envelope: Extract<WorkflowCommand, { type: "CANCEL_WORKFLOW" }> =
          {
            type: "CANCEL_WORKFLOW",
            commandId: randomUUID(),
            workflowRunId: run.id,
            projectId: run.projectId,
            userId: run.userId,
            traceId: run.traceId ?? run.id,
            ...(params.body.reason !== undefined
              ? { reason: params.body.reason }
              : {}),
            requestedAt: new Date().toISOString(),
          };
        await tx.insertOutboxEvent({
          aggregateType: "workflow",
          aggregateId: run.id,
          eventType: "CANCEL_WORKFLOW",
          payload: envelope,
        });
        return {
          status: 202,
          body: { data: { workflowRunId: run.id, status: "CANCELLING" } },
        };
      },
    });
  }

  private async executeIdempotently(params: {
    scope: string;
    idempotencyKey: string;
    userId: string;
    requestHash: string;
    work: (tx: WorkflowTx) => Promise<UseCaseResult>;
  }): Promise<UseCaseResult> {
    const attempt = (): Promise<UseCaseResult> =>
      this.unit.transact(async (tx) => {
        const existing = await tx.findIdempotentResponse(
          params.scope,
          params.idempotencyKey,
          params.userId,
        );
        if (existing) {
          if (existing.requestHash !== params.requestHash) {
            throw conflict(
              "IDEMPOTENCY_KEY_REUSED",
              "The Idempotency-Key was reused with a different request.",
            );
          }
          return {
            status: existing.responseStatus,
            body: existing.responseBody,
          };
        }
        const result = await params.work(tx);
        await tx.recordIdempotentResponse({
          scope: params.scope,
          idempotencyKey: params.idempotencyKey,
          userId: params.userId,
          requestHash: params.requestHash,
          responseStatus: result.status,
          responseBody: result.body,
        });
        return result;
      });
    // A concurrent identical request may win the unique insert; retry once so
    // the loser serves the stored first response instead of a 500.
    try {
      return await attempt();
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return await attempt();
      }
      throw error;
    }
  }
}
