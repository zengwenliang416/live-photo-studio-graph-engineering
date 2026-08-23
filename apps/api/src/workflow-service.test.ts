import assert from "node:assert/strict";
import test from "node:test";
import {
  workflowCommandSchema,
  workflowSignalSchema,
} from "@live-photo-studio/graph-contracts";
import { WorkflowService } from "./workflows/application/workflow-service.js";
import { InMemoryWorkflowUnit } from "./testing/in-memory-workflow-unit.js";

const USER = "user-a";
const OTHER_USER = "user-b";
const PROJECT_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

function createService() {
  const unit = new InMemoryWorkflowUnit();
  unit.seedProject(PROJECT_ID, USER);
  const service = new WorkflowService(unit);
  return { unit, service };
}

const startBody = { graphKey: "live-photo-project", graphVersion: "v1" };

test("start writes run plus outbox command in one transaction", async () => {
  const { unit, service } = createService();
  const result = await service.startWorkflowRun({
    projectId: PROJECT_ID,
    userId: USER,
    idempotencyKey: "key-start-00000001",
    body: startBody,
  });
  assert.equal(result.status, 202);
  const body = result.body as { data: { workflowRunId: string; status: string } };
  assert.equal(body.data.status, "QUEUED");
  assert.equal(unit.runs.size, 1);
  assert.equal(unit.outbox.length, 1);
  // The envelope must satisfy the published cross-process contract.
  workflowCommandSchema.parse(unit.outbox[0]?.payload);
});

test("duplicate start with the same key replays the first response", async () => {
  const { unit, service } = createService();
  const first = await service.startWorkflowRun({
    projectId: PROJECT_ID,
    userId: USER,
    idempotencyKey: "key-start-00000002",
    body: startBody,
  });
  const replay = await service.startWorkflowRun({
    projectId: PROJECT_ID,
    userId: USER,
    idempotencyKey: "key-start-00000002",
    body: startBody,
  });
  assert.deepEqual(replay.body, first.body);
  assert.equal(replay.status, first.status);
  assert.equal(unit.runs.size, 1);
  assert.equal(unit.outbox.length, 1);
});

test("reusing a key with a different body conflicts without side effects", async () => {
  const { unit, service } = createService();
  await service.startWorkflowRun({
    projectId: PROJECT_ID,
    userId: USER,
    idempotencyKey: "key-start-00000003",
    body: startBody,
  });
  await assert.rejects(
    service.startWorkflowRun({
      projectId: PROJECT_ID,
      userId: USER,
      idempotencyKey: "key-start-00000003",
      body: { ...startBody, graphVersion: "v9" },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { code?: string }).code, "IDEMPOTENCY_KEY_REUSED");
      return true;
    },
  );
  assert.equal(unit.runs.size, 1);
  assert.equal(unit.outbox.length, 1);
});

test("unauthorized project access creates nothing", async () => {
  const { unit, service } = createService();
  await assert.rejects(
    service.startWorkflowRun({
      projectId: PROJECT_ID,
      userId: OTHER_USER,
      idempotencyKey: "key-start-00000004",
      body: startBody,
    }),
    (error: unknown) => {
      assert.equal(
        (error as Error & { code?: string }).code,
        "PROJECT_ACCESS_DENIED",
      );
      return true;
    },
  );
  assert.equal(unit.runs.size, 0);
  assert.equal(unit.outbox.length, 0);
});

function seedPendingTask(unit: InMemoryWorkflowUnit, runId: string) {
  const taskId = "5a1f6d2e-4f89-4a0c-9b0c-0305e82c9099";
  unit.seedRun({
    id: runId,
    projectId: PROJECT_ID,
    userId: USER,
    graphKey: "live-photo-project",
    graphVersion: "v1",
    status: "INTERRUPTED",
    currentNode: null,
    currentPhase: "REVIEW_ANCHOR",
    pendingHumanTaskId: taskId,
    updatedAt: new Date().toISOString(),
  });
  unit.seedTask(
    {
      id: taskId,
      workflowRunId: runId,
      taskType: "SELECT_ANCHOR_IMAGE",
      nodeName: "human_select_anchor_v1",
      status: "PENDING",
      allowedActions: ["SELECT", "REGENERATE", "CANCEL"],
      candidateOutputIds: ["8e2f6d2e-4f89-4a0c-9b0c-0305e82c1111"],
      createdAt: new Date().toISOString(),
    },
    USER,
  );
  return taskId;
}

const OUTPUT_ID = "8e2f6d2e-4f89-4a0c-9b0c-0305e82c1111";

test("SELECT decision completes the task and emits one correlated signal", async () => {
  const runId = "7c1f6d2e-4f89-4a0c-9b0c-0305e82c7000";
  const { unit, service } = createService();
  const taskId = seedPendingTask(unit, runId);

  const result = await service.submitHumanTaskDecision({
    humanTaskId: taskId,
    userId: USER,
    idempotencyKey: "key-decide-0000001",
    body: { action: "SELECT", selectedOutputId: OUTPUT_ID },
  });

  assert.equal(result.status, 202);
  const stored = unit.tasks.get(taskId)?.task.status;
  assert.equal(stored, "COMPLETED");
  assert.equal(unit.completedTaskResults.length, 1);
  assert.equal(unit.outbox.length, 1);
  const signal = workflowSignalSchema.parse(unit.outbox[0]?.payload);
  assert.equal(signal.signalType, "HUMAN_TASK_COMPLETED");
  assert.equal(signal.correlationId, taskId);
  assert.deepEqual(signal.payload["selectedOutputId"], OUTPUT_ID);
});

test("duplicate decision replays; different key on completed task conflicts", async () => {
  const runId = "7c1f6d2e-4f89-4a0c-9b0c-0305e82c7001";
  const { unit, service } = createService();
  const taskId = seedPendingTask(unit, runId);

  const first = await service.submitHumanTaskDecision({
    humanTaskId: taskId,
    userId: USER,
    idempotencyKey: "key-decide-0000002",
    body: { action: "CANCEL" },
  });
  const replay = await service.submitHumanTaskDecision({
    humanTaskId: taskId,
    userId: USER,
    idempotencyKey: "key-decide-0000002",
    body: { action: "CANCEL" },
  });
  assert.deepEqual(replay.body, first.body);
  assert.equal(unit.outbox.length, 1);

  await assert.rejects(
    service.submitHumanTaskDecision({
      humanTaskId: taskId,
      userId: USER,
      idempotencyKey: "key-decide-0000003",
      body: { action: "CANCEL" },
    }),
    (error: unknown) => {
      assert.equal(
        (error as Error & { code?: string }).code,
        "HUMAN_TASK_NOT_PENDING",
      );
      return true;
    },
  );
  assert.equal(unit.outbox.length, 1);
});

test("actions outside the task payload are rejected", async () => {
  const runId = "7c1f6d2e-4f89-4a0c-9b0c-0305e82c7002";
  const { unit, service } = createService();
  const taskId = seedPendingTask(unit, runId);

  await assert.rejects(
    service.submitHumanTaskDecision({
      humanTaskId: taskId,
      userId: USER,
      idempotencyKey: "key-decide-0000004",
      body: { feedback: "not an allowed action" } as never,
    }),
  );
  assert.equal(unit.tasks.get(taskId)?.task.status, "PENDING");
});

test("cancel enqueues a cancel command once per key and guards terminal runs", async () => {
  const runId = "7c1f6d2e-4f89-4a0c-9b0c-0305e82c7003";
  const { unit, service } = createService();
  seedPendingTask(unit, runId);

  await service.cancelWorkflowRun({
    workflowRunId: runId,
    userId: USER,
    idempotencyKey: "key-cancel-0000001",
    body: { reason: "USER_REQUESTED" },
  });
  await service.cancelWorkflowRun({
    workflowRunId: runId,
    userId: USER,
    idempotencyKey: "key-cancel-0000001",
    body: { reason: "USER_REQUESTED" },
  });
  assert.equal(unit.outbox.length, 1);
  const command = workflowCommandSchema.parse(unit.outbox[0]?.payload);
  assert.equal(command.type, "CANCEL_WORKFLOW");

  unit.runs.set(runId, { ...unit.runs.get(runId)!, status: "SUCCEEDED" });
  await assert.rejects(
    service.cancelWorkflowRun({
      workflowRunId: runId,
      userId: USER,
      idempotencyKey: "key-cancel-0000002",
      body: {},
    }),
    (error: unknown) => {
      assert.equal(
        (error as Error & { code?: string }).code,
        "WORKFLOW_RUN_TERMINAL",
      );
      return true;
    },
  );
});

test("get projection enforces ownership and exposes pending task", async () => {
  const runId = "7c1f6d2e-4f89-4a0c-9b0c-0305e82c7004";
  const { unit, service } = createService();
  const taskId = seedPendingTask(unit, runId);

  const owner = await service.getWorkflowRun({ workflowRunId: runId, userId: USER });
  const data = (owner.body as { data: Record<string, unknown> }).data;
  assert.equal(data["pendingHumanTaskId"], taskId);
  assert.equal(data["status"], "INTERRUPTED");

  await assert.rejects(
    service.getWorkflowRun({ workflowRunId: runId, userId: OTHER_USER }),
    (error: unknown) => {
      assert.equal(
        (error as Error & { code?: string }).code,
        "PROJECT_ACCESS_DENIED",
      );
      return true;
    },
  );

  await assert.rejects(
    service.listHumanTasks({ workflowRunId: "9c1f6d2e-4f89-4a0c-9b0c-0305e82c9999", userId: USER }),
    (error: unknown) => {
      assert.equal(
        (error as Error & { code?: string }).code,
        "WORKFLOW_RUN_NOT_FOUND",
      );
      return true;
    },
  );
});
