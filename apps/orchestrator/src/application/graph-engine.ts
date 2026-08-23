import { Command } from "@langchain/langgraph";
import type {
  WorkflowCommand,
  WorkflowEventName,
  WorkflowRunStatus,
  WorkflowSignal,
} from "@live-photo-studio/graph-contracts";
import {
  buildDeterministicUuid,
  extractInterruptPayloads,
  type CompiledWorkflowGraph,
  GraphRegistry,
  WorkflowSignalMismatchError,
} from "@live-photo-studio/graph-runtime";
import { graphSignalTypeSchema } from "@live-photo-studio/graph-contracts";
import type { Pool, PoolClient } from "pg";
import { PostgresAdvisoryLock } from "../infrastructure/advisory-lock.js";
import {
  WorkflowRepository,
  type WorkflowRunRecord,
} from "../infrastructure/workflow-repository.js";

export interface GraphEngineOptions {
  /** How long a PROCESSING signal may stay untouched before it is re-driven. */
  readonly signalVisibilityTimeoutMs?: number;
  /** Upper bound for one recovery scan. */
  readonly recoveryBatchSize?: number;
  /**
   * Test-only fault injection point after the graph checkpoint advances and
   * before the projection/signal transaction starts.
   */
  readonly afterGraphResume?: () => Promise<void> | void;
}

interface ResumeSignal {
  readonly signalType: WorkflowSignal["signalType"];
  readonly correlationId: string;
  readonly payload: Record<string, unknown>;
}

interface WorkflowResultProjection {
  readonly status: WorkflowRunStatus;
  readonly currentPhase: string | null;
  readonly lastErrorCode: string | null;
  readonly externalJobId: string | null;
  readonly interrupts: readonly unknown[];
}

interface CheckpointReadableGraph extends CompiledWorkflowGraph {
  getState?: (config: {
    configurable: { thread_id: string };
  }) => Promise<unknown>;
}

interface ClaimedSignal {
  readonly run: WorkflowRunRecord;
  readonly signalId: string;
  readonly signal: ResumeSignal;
}

type StaleSignalClaim =
  | { readonly kind: "RESUME"; readonly value: ClaimedSignal }
  | { readonly kind: "TERMINAL" }
  | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readStringArray(
  record: Record<string, unknown>,
  key: string,
): string[] {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function checkpointHasAdvanced(
  values: unknown,
  signal: ResumeSignal,
): boolean {
  if (!isRecord(values)) return false;
  const phase = readString(values, "currentPhase");
  if (!phase) return false;
  switch (signal.signalType) {
    case "GENERATION_BATCH_COMPLETED":
    case "GENERATION_BATCH_FAILED":
      return [
        "REVIEW_ANCHOR",
        "READY_TO_RENDER",
        "WAITING_RENDER",
        "READY_TO_COMPLETE",
        "COMPLETED",
        "CANCELLED",
        "FAILED",
      ].includes(phase);
    case "HUMAN_TASK_COMPLETED":
      return [
        "READY_TO_GENERATE",
        "WAITING_GENERATION",
        "READY_TO_RENDER",
        "WAITING_RENDER",
        "READY_TO_COMPLETE",
        "COMPLETED",
        "CANCELLED",
        "FAILED",
      ].includes(phase);
    case "RENDER_JOB_COMPLETED":
    case "RENDER_JOB_FAILED":
      return [
        "READY_TO_COMPLETE",
        "COMPLETED",
        "CANCELLED",
        "FAILED",
      ].includes(phase);
    default:
      return false;
  }
}

function checkpointResult(values: unknown): object | null {
  if (!isRecord(values)) return null;
  const phase = readString(values, "currentPhase");
  const workflowRunId = readString(values, "workflowRunId");
  if (!phase || !workflowRunId) return { ...values };
  const nodeName =
    phase === "WAITING_GENERATION"
      ? "await_generation_v1"
      : phase === "REVIEW_ANCHOR"
        ? "human_select_anchor_v1"
        : phase === "WAITING_RENDER"
          ? "await_render_v1"
          : null;
  if (!nodeName) return { ...values };
  const generationRevision = values["generationRevision"];
  const correlationId =
    phase === "REVIEW_ANCHOR"
      ? readString(values, "pendingHumanTaskId") ??
        buildDeterministicUuid(
          `${workflowRunId}:${nodeName}:${
            typeof generationRevision === "number" ? generationRevision : 0
          }`,
        )
      : readString(values, "pendingExternalJobId");
  if (!correlationId) return { ...values };
  if (phase === "REVIEW_ANCHOR") {
    const revision = generationRevision;
    const maxRepairAttempts = values["maxRepairAttempts"];
    const allowedActions =
      typeof revision === "number" &&
      typeof maxRepairAttempts === "number" &&
      revision < maxRepairAttempts
        ? ["SELECT", "REGENERATE", "CANCEL"]
        : ["SELECT", "CANCEL"];
    return {
      ...values,
      __interrupt__: [{
        value: {
          type: "HUMAN_TASK",
          taskType: "SELECT_ANCHOR_IMAGE",
          workflowRunId,
          nodeName,
          correlationId,
          humanTaskId: correlationId,
          candidateOutputIds: readStringArray(values, "candidateOutputIds"),
          allowedActions,
        },
      }],
    };
  }
  return {
    ...values,
    __interrupt__: [{
      value: {
        type: "WAIT_EXTERNAL_JOB",
        workflowRunId,
        nodeName,
        correlationId,
        expectedSignalTypes:
          phase === "WAITING_GENERATION"
            ? ["GENERATION_BATCH_COMPLETED", "GENERATION_BATCH_FAILED"]
            : ["RENDER_JOB_COMPLETED", "RENDER_JOB_FAILED"],
      },
    }],
  };
}

function isSignalMismatch(error: unknown): boolean {
  return (
    error instanceof WorkflowSignalMismatchError ||
    (isRecord(error) && Array.isArray(error["issues"]))
  );
}

function resumeEventId(
  workflowRunId: string,
  signal: ResumeSignal,
): string {
  return buildDeterministicUuid(
    `${workflowRunId}:workflow.resumed.v1:${signal.signalType}:${signal.correlationId}`,
  );
}

function projectResult(result: object): WorkflowResultProjection {
  const record = result as Record<string, unknown>;
  const phase = typeof record["currentPhase"] === "string"
    ? record["currentPhase"]
    : null;
  const errorCode = typeof record["lastErrorCode"] === "string"
    ? record["lastErrorCode"]
    : null;
  const externalJobId =
    typeof record["pendingExternalJobId"] === "string"
      ? record["pendingExternalJobId"]
      : typeof record["renderJobId"] === "string"
        ? record["renderJobId"]
        : null;
  const interrupts = extractInterruptPayloads(result);
  let status: WorkflowRunStatus = interrupts.length > 0 ? "INTERRUPTED" : "RUNNING";
  if (phase === "COMPLETED") status = "SUCCEEDED";
  if (phase === "FAILED") status = "FAILED";
  if (phase === "CANCELLED") status = "CANCELLED";
  return {
    status,
    currentPhase: phase,
    lastErrorCode: errorCode,
    externalJobId,
    interrupts,
  };
}

export class GraphEngine {
  private readonly repository: WorkflowRepository;
  private readonly lock: PostgresAdvisoryLock;
  private readonly signalVisibilityTimeoutMs: number;
  private readonly recoveryBatchSize: number;
  private readonly afterGraphResume:
    | (() => Promise<void> | void)
    | undefined;

  constructor(
    private readonly pool: Pool,
    private readonly registry: GraphRegistry,
    options: GraphEngineOptions = {},
  ) {
    this.repository = new WorkflowRepository(pool);
    this.lock = new PostgresAdvisoryLock(pool);
    this.signalVisibilityTimeoutMs = options.signalVisibilityTimeoutMs ?? 60_000;
    this.recoveryBatchSize = options.recoveryBatchSize ?? 50;
    this.afterGraphResume = options.afterGraphResume;
  }

  async handleCommand(command: WorkflowCommand): Promise<void> {
    if (command.type === "START_WORKFLOW") {
      await this.start(command);
      return;
    }
    await this.cancel(command.workflowRunId, command.reason ?? "USER_CANCELLED");
  }

  async handleSignal(signal: WorkflowSignal): Promise<void> {
    const run = await this.repository.findRun(signal.workflowRunId);
    if (!run) {
      throw new Error(`Workflow ${signal.workflowRunId} was not found.`);
    }
    await this.lock.withWorkflowSessionLock(run.id, async (client) => {
      const claim = await this.claimSignalForDelivery(client, signal);
      if (!claim) return;
      await this.driveClaimedSignal(client, claim);
    });
  }

  /**
   * Re-drives signals stuck in PROCESSING past the visibility timeout. This
   * covers crashes between checkpoint write and consumed marker; replay is
   * safe because every node effect is keyed and idempotent.
   */
  async recoverStuckSignals(): Promise<number> {
    const stale = await this.repository.listStaleProcessingSignals(
      Math.ceil(this.signalVisibilityTimeoutMs / 1000),
      this.recoveryBatchSize,
    );
    let recovered = 0;
    for (const staleSignal of stale) {
      const parsedType = graphSignalTypeSchema.safeParse(staleSignal.signalType);
      if (!parsedType.success) {
        await this.pool.query(
          "UPDATE workflow_signals SET status = 'FAILED', last_error_code = $2, updated_at = now() WHERE id = $1",
          [staleSignal.id, "INVALID_SIGNAL_TYPE"],
        );
        continue;
      }
      const run = await this.repository.findRun(staleSignal.workflowRunId);
      if (!run) continue;
      const resumed = await this.lock.withWorkflowSessionLock(run.id, async (client) => {
        const claim = await this.claimStaleSignal(
          client,
          staleSignal,
          parsedType.data,
        );
        if (!claim) return false;
        if (claim.kind === "TERMINAL") return true;
        await this.driveClaimedSignal(client, claim.value);
        return true;
      });
      if (resumed) recovered += 1;
    }
    return recovered;
  }

  private async claimSignalForDelivery(
    client: PoolClient,
    signal: WorkflowSignal,
  ): Promise<ClaimedSignal | null> {
    return this.withTransaction(client, async () => {
      const lockedRun = await this.repository.findRunWithClient(
        client,
        signal.workflowRunId,
      );
      if (!lockedRun) {
        throw new Error(`Workflow ${signal.workflowRunId} was not found.`);
      }
      const inserted = await this.repository.registerSignal(client, {
        signalId: signal.signalId,
        workflowRunId: signal.workflowRunId,
        signalType: signal.signalType,
        correlationId: signal.correlationId,
        payload: signal.payload,
        traceId: signal.traceId ?? lockedRun.traceId ?? lockedRun.id,
        nodeName: signal.nodeName ?? undefined,
        nodeVersion: signal.nodeVersion ?? undefined,
        externalJobId: signal.externalJobId ?? undefined,
        providerRequestId: signal.providerRequestId ?? undefined,
      });
      let signalId = signal.signalId;
      let resumeSignal: ResumeSignal = signal;
      if (!inserted) {
        const existing = await this.repository.findSignalStatus(
          client,
          lockedRun.id,
          signal.correlationId,
          signal.signalType,
        );
        if (!existing) return null;
        await this.repository.incrementSignalDuplicate(client, existing.id);
        if (existing.status === "CONSUMED") return null;
        const claimed = await this.repository.claimStaleProcessingSignal(
          client,
          existing.id,
          Math.ceil(this.signalVisibilityTimeoutMs / 1000),
        );
        if (!claimed) return null;
        signalId = existing.id;
        resumeSignal = {
          signalType: signal.signalType,
          correlationId: existing.correlationId,
          payload: existing.payload,
        };
      }
      if (isTerminalStatus(lockedRun.status)) {
        await this.repository.markSignalConsumed(client, signalId);
        return null;
      }
      return {
        run: lockedRun,
        signalId,
        signal: resumeSignal,
      };
    });
  }

  private async claimStaleSignal(
    client: PoolClient,
    staleSignal: {
      readonly id: string;
      readonly workflowRunId: string;
      readonly correlationId: string;
      readonly payload: Record<string, unknown>;
    },
    signalType: WorkflowSignal["signalType"],
  ): Promise<StaleSignalClaim> {
    return this.withTransaction(client, async () => {
      const lockedRun = await this.repository.findRunWithClient(
        client,
        staleSignal.workflowRunId,
      );
      if (!lockedRun) return null;
      const claimed = await this.repository.claimStaleProcessingSignal(
        client,
        staleSignal.id,
        Math.ceil(this.signalVisibilityTimeoutMs / 1000),
      );
      if (!claimed) return null;
      if (isTerminalStatus(lockedRun.status)) {
        await this.repository.markSignalConsumed(client, staleSignal.id);
        return { kind: "TERMINAL" };
      }
      return {
        kind: "RESUME",
        value: {
          run: lockedRun,
          signalId: staleSignal.id,
          signal: {
            signalType,
            correlationId: staleSignal.correlationId,
            payload: staleSignal.payload,
          },
        },
      };
    });
  }

  private async driveClaimedSignal(
    client: PoolClient,
    claim: ClaimedSignal,
  ): Promise<void> {
    const graph = await this.registry.resolve(
      claim.run.graphKey,
      claim.run.graphVersion,
    );
    const graphConfig = {
      configurable: { thread_id: claim.run.threadId },
    };
    const eventId = resumeEventId(claim.run.id, claim.signal);
    if (await this.repository.hasWorkflowEventIdWithClient(client, eventId)) {
      await this.withTransaction(client, async () => {
        await this.repository.markSignalConsumed(client, claim.signalId);
      });
      return;
    }

    let result: object | null = null;
    try {
      const readableGraph = graph as CheckpointReadableGraph;
      if (typeof readableGraph.getState === "function") {
        const snapshot = await readableGraph.getState(graphConfig);
        if (
          isRecord(snapshot) &&
          checkpointHasAdvanced(snapshot["values"], claim.signal)
        ) {
          result = checkpointResult(snapshot["values"]);
        }
      }
      if (!result) {
        const resumePayload = {
          type: claim.signal.signalType,
          correlationId: claim.signal.correlationId,
          ...claim.signal.payload,
        };
        result = await graph.invoke(
          new Command({ resume: resumePayload }) as object,
          graphConfig,
        );
        await this.afterGraphResume?.();
      }
    } catch (error) {
      if (!isSignalMismatch(error)) throw error;
      await this.withTransaction(client, async () => {
        await this.repository.markSignalFailed(
          client,
          claim.signalId,
          "SIGNAL_NOT_APPLICABLE",
        );
      });
      return;
    }
    if (!result) {
      throw new Error("WORKFLOW_CHECKPOINT_RESULT_MISSING");
    }

    await this.withTransaction(client, async () => {
      const currentRun = await this.repository.findRunWithClient(
        client,
        claim.run.id,
      );
      if (!currentRun) {
        throw new Error(`Workflow ${claim.run.id} was not found.`);
      }
      if (isTerminalStatus(currentRun.status)) {
        await this.repository.markSignalConsumed(client, claim.signalId);
        return;
      }
      if (await this.repository.hasWorkflowEventIdWithClient(client, eventId)) {
        await this.repository.markSignalConsumed(client, claim.signalId);
        return;
      }
      await this.appendEvent(
        claim.run.id,
        "workflow.resumed.v1",
        {
          signalType: claim.signal.signalType,
          correlationId: claim.signal.correlationId,
        },
        { client, identityKey: `resume:${claim.signal.signalType}:${claim.signal.correlationId}` },
      );
      await this.persistProjection(claim.run.id, result, client);
      await this.repository.markSignalConsumed(client, claim.signalId);
    });
  }

  private async withTransaction<T>(
    client: PoolClient,
    callback: () => Promise<T>,
  ): Promise<T> {
    await client.query("BEGIN");
    try {
      const result = await callback();
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }

  private async start(command: Extract<WorkflowCommand, { type: "START_WORKFLOW" }>): Promise<void> {
    const threadId = command.workflowRunId;
    await this.lock.withWorkflowLock(command.workflowRunId, async () => {
      const inserted = await this.repository.createRun({
        id: command.workflowRunId,
        projectId: command.projectId,
        userId: command.userId,
        traceId: command.traceId ?? command.workflowRunId,
        graphKey: command.graphKey,
        graphVersion: command.graphVersion,
        threadId,
      });
      const existing = await this.repository.findRun(command.workflowRunId);
      if (!existing) {
        throw new Error(`Workflow ${command.workflowRunId} was not created.`);
      }
      if (
        existing.projectId !== command.projectId ||
        existing.userId !== command.userId ||
        existing.graphKey !== command.graphKey ||
        existing.graphVersion !== command.graphVersion
      ) {
        throw new Error("WORKFLOW_COMMAND_SCOPE_MISMATCH");
      }
      if (!inserted && existing.status !== "QUEUED") {
        return;
      }
      if (
        !(await this.repository.hasWorkflowEvent(
          command.workflowRunId,
          "workflow.started.v1",
        ))
      ) {
        await this.appendEvent(
          command.workflowRunId,
          "workflow.started.v1",
          {
            graphKey: command.graphKey,
            graphVersion: command.graphVersion,
          },
          { identityKey: "started" },
        );
      }
      const graph = await this.registry.resolve(command.graphKey, command.graphVersion);
      await this.repository.updateProjection({
        id: command.workflowRunId,
        status: "RUNNING",
        currentNode: "load_project_v1",
        currentNodeVersion: 1,
        currentPhase: "STARTING",
        traceId: existing.traceId ?? command.traceId ?? command.workflowRunId,
      });
      const result = await graph.invoke(
        {
          ...command.input,
          traceId: command.traceId ?? existing.traceId ?? command.workflowRunId,
        },
        { configurable: { thread_id: threadId } },
      );
      await this.persistProjection(command.workflowRunId, result);
    });
  }

  private async cancel(workflowRunId: string, reason: string): Promise<void> {
    await this.lock.withWorkflowLock(workflowRunId, async () => {
      const run = await this.repository.findRun(workflowRunId);
      if (!run) {
        throw new Error(`Workflow ${workflowRunId} was not found.`);
      }
      if (
        run.status === "SUCCEEDED" ||
        run.status === "FAILED" ||
        run.status === "CANCELLED"
      ) {
        return;
      }
      await this.repository.cancelPendingHumanTasks(workflowRunId);
      await this.repository.updateProjection({
        id: workflowRunId,
        status: "CANCELLED",
        currentNode: "cancelled_v1",
        currentNodeVersion: 1,
        currentPhase: "CANCELLED",
        lastErrorCode: reason,
        traceId: run.traceId ?? workflowRunId,
      });
      if (
        !(await this.repository.hasWorkflowEvent(
          workflowRunId,
          "workflow.cancelled.v1",
        ))
      ) {
        await this.appendEvent(
          workflowRunId,
          "workflow.cancelled.v1",
          { reason },
          { identityKey: "cancelled" },
        );
      }
    });
  }

  private async persistProjection(
    workflowRunId: string,
    result: object,
    client?: PoolClient,
  ): Promise<void> {
    const projection = projectResult(result);
    const run = client
      ? await this.repository.findRunWithClient(client, workflowRunId)
      : await this.repository.findRun(workflowRunId);
    if (!run) {
      throw new Error(`Workflow ${workflowRunId} was not found.`);
    }
    const currentNode = phaseNode(projection.currentPhase);
    const projectionInput = {
      id: workflowRunId,
      status: projection.status,
      currentNode,
      currentNodeVersion: currentNode ? 1 : null,
      currentPhase: projection.currentPhase,
      lastErrorCode: projection.lastErrorCode,
      externalJobId: projection.externalJobId,
      traceId: run.traceId ?? workflowRunId,
    } as const;
    if (client) {
      await this.repository.updateProjectionWithClient(client, projectionInput);
    } else {
      await this.repository.updateProjection(projectionInput);
    }
    const eventName: WorkflowEventName | null =
      projection.status === "SUCCEEDED"
        ? "workflow.completed.v1"
        : projection.status === "FAILED"
        ? "workflow.failed.v1"
        : projection.status === "INTERRUPTED"
        ? "workflow.interrupted.v1"
        : projection.status === "CANCELLED"
        ? "workflow.cancelled.v1"
        : null;
    if (eventName) {
      await this.appendEvent(
        workflowRunId,
        eventName,
        {
          currentPhase: projection.currentPhase,
          lastErrorCode: projection.lastErrorCode,
        },
        {
          ...(client ? { client } : {}),
          identityKey: `projection:${projection.status}:${projection.currentPhase ?? ""}:${projection.externalJobId ?? ""}`,
        },
      );
    }
    for (const payload of projection.interrupts) {
      if (payload === null || typeof payload !== "object") continue;
      const record = payload as Record<string, unknown>;
      if (record["type"] !== "HUMAN_TASK") continue;
      const taskType = typeof record["taskType"] === "string"
        ? record["taskType"]
        : "UNKNOWN";
      const nodeName = typeof record["nodeName"] === "string"
        ? record["nodeName"]
        : "unknown";
      const humanTaskId =
        typeof record["humanTaskId"] === "string"
          ? record["humanTaskId"]
          : typeof record["correlationId"] === "string"
            ? record["correlationId"]
            : buildDeterministicUuid(`${workflowRunId}:${nodeName}`);
      const taskInput = {
        id: humanTaskId,
        workflowRunId,
        taskType,
        nodeName,
        payload: record,
      } as const;
      if (client) {
        await this.repository.upsertHumanTaskWithClient(client, taskInput);
      } else {
        await this.repository.upsertHumanTask(taskInput);
      }
      await this.appendEvent(
        workflowRunId,
        "workflow.human-task.created.v1",
        {
          humanTaskId,
          taskType,
          nodeName,
        },
        {
          ...(client ? { client } : {}),
          identityKey: `human-task:${humanTaskId}`,
        },
      );
    }
  }

  private async appendEvent(
    workflowRunId: string,
    eventName: WorkflowEventName,
    payload: Record<string, unknown>,
    options: {
      readonly client?: PoolClient;
      readonly identityKey?: string;
    } = {},
  ): Promise<void> {
    const run = options.client
      ? await this.repository.findRunWithClient(options.client, workflowRunId)
      : await this.repository.findRun(workflowRunId);
    const event = {
      id: buildDeterministicUuid(
        `${workflowRunId}:${eventName}:${options.identityKey ?? JSON.stringify(payload)}`,
      ),
      workflowRunId,
      eventName,
      payload: {
        traceId: run?.traceId ?? workflowRunId,
        workflowRunId,
        ...payload,
      },
    } as const;
    if (options.client) {
      await this.repository.appendWorkflowEventWithClient(options.client, event);
    } else {
      await this.repository.appendWorkflowEvent(event);
    }
  }
}

function isTerminalStatus(status: WorkflowRunStatus): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
}

function phaseNode(phase: string | null): string | null {
  switch (phase) {
    case "READY_TO_GENERATE":
      return "dispatch_generation_v1";
    case "WAITING_GENERATION":
      return "await_generation_v1";
    case "REVIEW_ANCHOR":
      return "human_select_anchor_v1";
    case "READY_TO_RENDER":
      return "dispatch_render_v1";
    case "WAITING_RENDER":
      return "await_render_v1";
    case "READY_TO_COMPLETE":
      return "complete_v1";
    case "COMPLETED":
      return "complete_v1";
    case "CANCELLED":
      return "cancelled_v1";
    case "FAILED":
      return "failed_v1";
    default:
      return null;
  }
}
