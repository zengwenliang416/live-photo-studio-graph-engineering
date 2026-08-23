import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import type {
  WorkflowCommand,
  WorkflowRunStatus,
  WorkflowSignal,
} from "@live-photo-studio/graph-contracts";
import {
  extractInterruptPayloads,
  type CompiledWorkflowGraph,
  GraphRegistry,
} from "@live-photo-studio/graph-runtime";
import type { Pool } from "pg";
import { PostgresAdvisoryLock } from "../infrastructure/advisory-lock.js";
import { WorkflowRepository } from "../infrastructure/workflow-repository.js";

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

  constructor(
    private readonly pool: Pool,
    private readonly registry: GraphRegistry,
  ) {
    this.repository = new WorkflowRepository(pool);
    this.lock = new PostgresAdvisoryLock(pool);
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
      if (!inserted) {
        return;
      }
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
      await this.repository.markSignalConsumed(client, signal.signalId);
    });
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
  }

  private async persistProjection(workflowRunId: string, result: object): Promise<void> {
    const projection = projectResult(result);
    await this.repository.updateProjection({
      id: workflowRunId,
      status: projection.status,
      currentPhase: projection.currentPhase,
      lastErrorCode: projection.lastErrorCode,
    });
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
}
