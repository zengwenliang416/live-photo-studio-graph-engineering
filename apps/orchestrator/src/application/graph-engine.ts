import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import type {
  WorkflowCommand,
  WorkflowEventName,
  WorkflowRunStatus,
  WorkflowSignal,
} from "@live-photo-studio/graph-contracts";
import {
  extractInterruptPayloads,
  type CompiledWorkflowGraph,
  GraphRegistry,
  WorkflowSignalMismatchError,
} from "@live-photo-studio/graph-runtime";
import { graphSignalTypeSchema } from "@live-photo-studio/graph-contracts";
import type { Pool } from "pg";
import { PostgresAdvisoryLock } from "../infrastructure/advisory-lock.js";
import { WorkflowRepository } from "../infrastructure/workflow-repository.js";

export interface GraphEngineOptions {
  /** How long a PROCESSING signal may stay untouched before it is re-driven. */
  readonly signalVisibilityTimeoutMs?: number;
  /** Upper bound for one recovery scan. */
  readonly recoveryBatchSize?: number;
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
  readonly interrupts: readonly unknown[];
}

function projectResult(result: object): WorkflowResultProjection {
  const record = result as Record<string, unknown>;
  const phase = typeof record["currentPhase"] === "string"
    ? record["currentPhase"]
    : null;
  const errorCode = typeof record["lastErrorCode"] === "string"
    ? record["lastErrorCode"]
    : null;
  const interrupts = extractInterruptPayloads(result);
  let status: WorkflowRunStatus = interrupts.length > 0 ? "INTERRUPTED" : "RUNNING";
  if (phase === "COMPLETED") status = "SUCCEEDED";
  if (phase === "FAILED") status = "FAILED";
  if (phase === "CANCELLED") status = "CANCELLED";
  return { status, currentPhase: phase, lastErrorCode: errorCode, interrupts };
}

export class GraphEngine {
  private readonly repository: WorkflowRepository;
  private readonly lock: PostgresAdvisoryLock;
  private readonly signalVisibilityTimeoutMs: number;
  private readonly recoveryBatchSize: number;

  constructor(
    private readonly pool: Pool,
    private readonly registry: GraphRegistry,
    options: GraphEngineOptions = {},
  ) {
    this.repository = new WorkflowRepository(pool);
    this.lock = new PostgresAdvisoryLock(pool);
    this.signalVisibilityTimeoutMs = options.signalVisibilityTimeoutMs ?? 60_000;
    this.recoveryBatchSize = options.recoveryBatchSize ?? 50;
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
    await this.lock.withWorkflowLock(run.id, async (client) => {
      const inserted = await this.repository.registerSignal(client, {
        signalId: signal.signalId,
        workflowRunId: signal.workflowRunId,
        signalType: signal.signalType,
        correlationId: signal.correlationId,
        payload: signal.payload,
      });
      let signalId = signal.signalId;
      if (!inserted) {
        // The uniqueness constraint found an earlier copy of this signal.
        const existing = await this.repository.findSignalStatus(
          client,
          run.id,
          signal.correlationId,
          signal.signalType,
        );
        if (!existing || existing.status === "CONSUMED") {
          return; // duplicate delivery after successful consumption
        }
        const claimed = await this.repository.claimStaleProcessingSignal(
          client,
          existing.id,
          Math.ceil(this.signalVisibilityTimeoutMs / 1000),
        );
        if (!claimed) {
          return; // fresh PROCESSING: another worker owns the resume
        }
        signalId = existing.id;
      }
      const rejected = await this.tryDriveResume(run, signal);
      if (rejected) {
        await this.repository.markSignalFailed(
          client,
          signalId,
          "SIGNAL_NOT_APPLICABLE",
        );
        return;
      }
      await this.repository.markSignalConsumed(client, signalId);
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
      const resumed = await this.lock.withWorkflowLock(run.id, async (client) => {
        const claimed = await this.repository.claimStaleProcessingSignal(
          client,
          staleSignal.id,
          Math.ceil(this.signalVisibilityTimeoutMs / 1000),
        );
        if (!claimed) return false;
        const rejected = await this.tryDriveResume(run, {
          signalType: parsedType.data,
          correlationId: staleSignal.correlationId,
          payload: staleSignal.payload,
        });
        if (rejected) {
          await this.repository.markSignalFailed(
            client,
            staleSignal.id,
            "SIGNAL_NOT_APPLICABLE",
          );
          return true;
        }
        await this.repository.markSignalConsumed(client, staleSignal.id);
        return true;
      });
      if (resumed) recovered += 1;
    }
    return recovered;
  }

  /**
   * Drives one resume. Returns true when the signal cannot apply to the
   * current pending interrupt (stale/mismatched delivery); those are marked
   * FAILED instead of crashing recovery. Transient errors propagate so the
   * row stays PROCESSING for visibility-timeout retry.
   */
  private async tryDriveResume(
    run: { id: string; graphKey: string; graphVersion: string; threadId: string },
    signal: ResumeSignal,
  ): Promise<boolean> {
    try {
      await this.driveResume(run, signal);
      return false;
    } catch (error) {
      if (
        error instanceof WorkflowSignalMismatchError ||
        (error !== null &&
          typeof error === "object" &&
          Array.isArray((error as { issues?: unknown }).issues))
      ) {
        return true;
      }
      throw error;
    }
  }

  private async driveResume(
    run: { id: string; graphKey: string; graphVersion: string; threadId: string },
    signal: ResumeSignal,
  ): Promise<void> {
    await this.appendEvent(run.id, "workflow.resumed.v1", {
      signalType: signal.signalType,
      correlationId: signal.correlationId,
    });
    const graph = await this.registry.resolve(run.graphKey, run.graphVersion);
    const resumePayload = {
      type: signal.signalType,
      correlationId: signal.correlationId,
      ...signal.payload,
    };
    const result = await graph.invoke(
      new Command({ resume: resumePayload }) as object,
      { configurable: { thread_id: run.threadId } },
    );
    await this.persistProjection(run.id, result);
  }

  private async start(command: Extract<WorkflowCommand, { type: "START_WORKFLOW" }>): Promise<void> {
    const threadId = command.workflowRunId;
    await this.repository.createRun({
      id: command.workflowRunId,
      projectId: command.projectId,
      userId: command.userId,
      graphKey: command.graphKey,
      graphVersion: command.graphVersion,
      threadId,
    });
    await this.appendEvent(command.workflowRunId, "workflow.started.v1", {
      graphKey: command.graphKey,
      graphVersion: command.graphVersion,
    });
    await this.lock.withWorkflowLock(command.workflowRunId, async () => {
      const graph = await this.registry.resolve(command.graphKey, command.graphVersion);
      await this.repository.updateProjection({
        id: command.workflowRunId,
        status: "RUNNING",
        currentPhase: "STARTING",
      });
      const result = await graph.invoke(
        command.input,
        { configurable: { thread_id: threadId } },
      );
      await this.persistProjection(command.workflowRunId, result);
    });
  }

  private async cancel(workflowRunId: string, reason: string): Promise<void> {
    await this.repository.updateProjection({
      id: workflowRunId,
      status: "CANCELLED",
      currentPhase: "CANCELLED",
      lastErrorCode: reason,
    });
    await this.appendEvent(workflowRunId, "workflow.cancelled.v1", { reason });
  }

  private async persistProjection(workflowRunId: string, result: object): Promise<void> {
    const projection = projectResult(result);
    await this.repository.updateProjection({
      id: workflowRunId,
      status: projection.status,
      currentPhase: projection.currentPhase,
      lastErrorCode: projection.lastErrorCode,
    });
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
      await this.appendEvent(workflowRunId, eventName, {
        currentPhase: projection.currentPhase,
        lastErrorCode: projection.lastErrorCode,
      });
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
      await this.repository.upsertHumanTask({
        id: randomUUID(),
        workflowRunId,
        taskType,
        nodeName,
        payload: record,
      });
    }
  }

  private async appendEvent(
    workflowRunId: string,
    eventName: WorkflowEventName,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.repository.appendWorkflowEvent({
      id: randomUUID(),
      workflowRunId,
      eventName,
      payload,
    });
  }
}
