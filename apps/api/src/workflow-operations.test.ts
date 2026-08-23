import assert from "node:assert/strict";
import test from "node:test";
import {
  WorkflowOperationsService,
  type WorkflowOperationsPort,
  type WorkflowTriage,
} from "./workflows/application/workflow-operations-service.js";

const RUN_ID = "7c1f6d2e-4f89-4a0c-9b0c-0305e82c7000";

const triage: WorkflowTriage = {
  workflowRunId: RUN_ID,
  projectId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  traceId: RUN_ID,
  status: "INTERRUPTED",
  currentPhase: "WAITING_GENERATION",
  currentNode: "await_generation_v1",
  currentNodeVersion: 1,
  lastErrorCode: null,
  updatedAt: new Date().toISOString(),
  humanTasks: [],
  signals: [],
  effects: [],
  nodeRuns: [],
  generationJobs: [],
  renderJobs: [],
  outbox: [],
  metrics: {
    interruptAgeMs: 10,
    oldestQueueAgeMs: 20,
    duplicateSignalCount: 1,
    renderFailureCount: 0,
    modelCostMicros: 0,
  },
};

class FakeOperations implements WorkflowOperationsPort {
  readonly audits: Array<Record<string, unknown>> = [];
  replayCount = 0;

  async getTriage(): Promise<WorkflowTriage> {
    return triage;
  }

  async recordAudit(input: Record<string, unknown>): Promise<void> {
    this.audits.push(input);
  }

  async replaySignal(): Promise<{
    readonly status: "ACCEPTED";
    readonly eventId: string;
  }> {
    this.replayCount += 1;
    return { status: "ACCEPTED", eventId: RUN_ID };
  }
}

test("operator triage returns bounded projection data", async () => {
  const port = new FakeOperations();
  const service = new WorkflowOperationsService(port, ["operator"]);
  const result = await service.getTriage({
    operatorId: "operator",
    workflowRunId: RUN_ID,
  });
  assert.equal(result.data.currentNode, "await_generation_v1");
  assert.equal(result.data.metrics.modelCostMicros, 0);
});

test("non-operator triage and replay are denied and audited", async () => {
  const port = new FakeOperations();
  const service = new WorkflowOperationsService(port, ["operator"]);
  await assert.rejects(
    service.getTriage({ operatorId: "user", workflowRunId: RUN_ID }),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code === "OPERATOR_ACCESS_REQUIRED",
  );
  await assert.rejects(
    service.replaySignal({
      operatorId: "user",
      workflowRunId: RUN_ID,
      signalId: RUN_ID,
      reason: "stale signal",
    }),
    /operator/i,
  );
  assert.equal(port.audits.length, 2);
  assert.equal(port.audits[0]?.["outcome"], "DENIED");
});

test("operator replay delegates a versioned command", async () => {
  const port = new FakeOperations();
  const service = new WorkflowOperationsService(port, ["operator"]);
  const result = await service.replaySignal({
    operatorId: "operator",
    workflowRunId: RUN_ID,
    signalId: RUN_ID,
    reason: "visibility timeout",
  });
  assert.equal(result.data.status, "ACCEPTED");
  assert.equal(port.replayCount, 1);
});
