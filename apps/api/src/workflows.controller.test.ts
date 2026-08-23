import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "./app.module.js";
import type { ApiConfig } from "./config.js";
import type { OutboxQueuePair } from "./workflows/infrastructure/outbox-dispatcher.js";
import { WORKFLOW_TOKENS } from "./workflows/workflow-tokens.js";
import {
  InMemoryWorkflowUnit,
} from "./testing/in-memory-workflow-unit.js";
import type { HumanTaskRow } from "./workflows/ports.js";

process.env["DATABASE_URL"] ??= "postgresql://unittest:invalid@localhost:5/db";
process.env["REDIS_URL"] ??= "redis://unittest.invalid:6379";
process.env["GRAPH_WORKFLOW_ENABLED"] ??= "true";

const USER = "contract-user";
const OTHER_USER = "someone-else";
const PROJECT_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const OUTPUT_ID = "8e2f6d2e-4f89-4a0c-9b0c-0305e82c1111";
const TASK_ID = "5a1f6d2e-4f89-4a0c-9b0c-0305e82c9099";
const RUN_ID = "7c1f6d2e-4f89-4a0c-9b0c-0305e82c7000";

function seed(unit: InMemoryWorkflowUnit): void {
  unit.seedProject(PROJECT_ID, USER);
  unit.seedRun({
    id: RUN_ID,
    projectId: PROJECT_ID,
    userId: USER,
    graphKey: "live-photo-project",
    graphVersion: "v1",
    status: "INTERRUPTED",
    currentNode: null,
    currentPhase: "REVIEW_ANCHOR",
    pendingHumanTaskId: TASK_ID,
    updatedAt: new Date().toISOString(),
  });
  const task: HumanTaskRow = {
    id: TASK_ID,
    workflowRunId: RUN_ID,
    taskType: "SELECT_ANCHOR_IMAGE",
    nodeName: "human_select_anchor_v1",
    status: "PENDING",
    allowedActions: ["SELECT", "REGENERATE", "CANCEL"],
    candidateOutputIds: [OUTPUT_ID],
    createdAt: new Date().toISOString(),
  };
  unit.seedTask(task, USER);
}

async function createApp(input?: { graphWorkflowEnabled?: string }) {
  const unit = new InMemoryWorkflowUnit();
  seed(unit);
  const fakeQueue = { add: async () => undefined, close: async () => undefined };
  const fakeQueues = {
    commands: fakeQueue,
    signals: fakeQueue,
    generationJobs: fakeQueue,
    renderJobs: fakeQueue,
  } as unknown as OutboxQueuePair;

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(WORKFLOW_TOKENS.config)
    .useValue({
      PORT: 4000,
      DATABASE_URL: "postgresql://unittest:invalid@localhost:5/db",
      REDIS_URL: "redis://unittest.invalid:6379",
      GRAPH_COMMAND_QUEUE: "graph-commands-test",
      GRAPH_SIGNAL_QUEUE: "graph-signals-test",
      GENERATION_JOB_QUEUE: "generation-jobs-test",
      RENDER_JOB_QUEUE: "render-jobs-test",
      OUTBOX_DISPATCH_INTERVAL_MS: 60_000,
      OUTBOX_DISPATCH_BATCH_SIZE: 10,
      OUTBOX_VISIBILITY_TIMEOUT_MS: 60_000,
      GRAPH_WORKFLOW_ENABLED: (input?.graphWorkflowEnabled ?? "true") as
        | "true"
        | "false",
      GRAPH_WORKFLOW_CANARY_USER_IDS: "",
      GRAPH_ADMIN_USER_IDS: "operator-user",
    } satisfies ApiConfig)
    .overrideProvider(WORKFLOW_TOKENS.pool)
    .useValue({})
    .overrideProvider(WORKFLOW_TOKENS.workflowUnit)
    .useValue(unit)
    .overrideProvider(WORKFLOW_TOKENS.outboxQueues)
    .useValue(fakeQueues)
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, unit };
}

function expectProblem(
  response: { status: number; headers: Record<string, unknown>; body: Record<string, unknown> },
  status: number,
  code: string,
): void {
  assert.equal(response.status, status);
  assert.match(
    String(response.headers["content-type"]),
    /application\/problem\+json/u,
  );
  assert.equal(response.body["code"], code);
}

test("openapi document publishes the five workflow paths", async () => {
  const { app } = await createApp();
  const response = await request(app.getHttpServer())
    .get("/v1/openapi.json")
    .set("x-user-id", USER);
  assert.equal(response.status, 200);
  const paths = Object.keys(response.body.paths);
  for (const expected of [
    "/v1/projects/{projectId}/workflow-runs",
    "/v1/workflow-runs/{workflowRunId}",
    "/v1/workflow-runs/{workflowRunId}/human-tasks",
    "/v1/human-tasks/{humanTaskId}/decisions",
    "/v1/workflow-runs/{workflowRunId}/cancel",
  ]) {
    assert.ok(paths.includes(expected), `missing ${expected}`);
  }
  await app.close();
});

test("start returns 202 and writes one command; auth failures are problem+json", async () => {
  const { app, unit } = await createApp();

  const unauthorized = await request(app.getHttpServer())
    .post(`/v1/projects/${PROJECT_ID}/workflow-runs`)
    .set("Idempotency-Key", "contract-key-start-01")
    .send({});
  expectProblem(unauthorized, 401, "AUTHENTICATION_REQUIRED");

  const forbidden = await request(app.getHttpServer())
    .post(`/v1/projects/${PROJECT_ID}/workflow-runs`)
    .set("x-user-id", OTHER_USER)
    .set("Idempotency-Key", "contract-key-start-02")
    .send({});
  expectProblem(forbidden, 403, "PROJECT_ACCESS_DENIED");

  const ok = await request(app.getHttpServer())
    .post(`/v1/projects/${PROJECT_ID}/workflow-runs`)
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-start-03")
    .send({});
  assert.equal(ok.status, 202);
  assert.equal(ok.body.data.status, "QUEUED");
  assert.ok(unit.runs.has(ok.body.data.workflowRunId));
  assert.equal(unit.outbox.length, 1);
  await app.close();
});

test("idempotent replay returns the first response; reuse with a different body conflicts", async () => {
  const { app } = await createApp();

  const first = await request(app.getHttpServer())
    .post(`/v1/projects/${PROJECT_ID}/workflow-runs`)
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-start-04")
    .send({});
  const replay = await request(app.getHttpServer())
    .post(`/v1/projects/${PROJECT_ID}/workflow-runs`)
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-start-04")
    .send({});
  assert.deepEqual(replay.body, first.body);
  assert.equal(replay.status, 202);

  const conflict = await request(app.getHttpServer())
    .post(`/v1/projects/${PROJECT_ID}/workflow-runs`)
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-start-04")
    .send({ graphVersion: "v2" });
  expectProblem(conflict, 409, "IDEMPOTENCY_KEY_REUSED");

  const missingKey = await request(app.getHttpServer())
    .post(`/v1/projects/${PROJECT_ID}/workflow-runs`)
    .set("x-user-id", USER)
    .send({});
  expectProblem(missingKey, 400, "IDEMPOTENCY_KEY_REQUIRED");
  await app.close();
});

test("decision endpoint validates action, ownership and pending state", async () => {
  const { app } = await createApp();

  const forbidden = await request(app.getHttpServer())
    .post(`/v1/human-tasks/${TASK_ID}/decisions`)
    .set("x-user-id", OTHER_USER)
    .set("Idempotency-Key", "contract-key-decide-01")
    .send({ action: "CANCEL" });
  expectProblem(forbidden, 403, "PROJECT_ACCESS_DENIED");

  const invalidCandidate = await request(app.getHttpServer())
    .post(`/v1/human-tasks/${TASK_ID}/decisions`)
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-decide-02")
    .send({
      action: "SELECT",
      selectedOutputId: "00000000-0000-4000-8000-000000000000",
    });
  expectProblem(invalidCandidate, 422, "VALIDATION_FAILED");

  const ok = await request(app.getHttpServer())
    .post(`/v1/human-tasks/${TASK_ID}/decisions`)
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-decide-03")
    .send({ action: "SELECT", selectedOutputId: OUTPUT_ID });
  assert.equal(ok.status, 202);
  assert.equal(ok.body.data.status, "COMPLETED");

  const stale = await request(app.getHttpServer())
    .post(`/v1/human-tasks/${TASK_ID}/decisions`)
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-decide-04")
    .send({ action: "CANCEL" });
  expectProblem(stale, 409, "HUMAN_TASK_NOT_PENDING");

  const tasks = await request(app.getHttpServer())
    .get(`/v1/workflow-runs/${RUN_ID}/human-tasks`)
    .set("x-user-id", USER);
  assert.equal(tasks.status, 200);
  assert.deepEqual(tasks.body.data[0].allowedActions, [
    "SELECT",
    "REGENERATE",
    "CANCEL",
  ]);
  await app.close();
});

test("cancel enqueues through the projection boundary", async () => {
  const { app, unit } = await createApp();
  const ok = await request(app.getHttpServer())
    .post(`/v1/workflow-runs/${RUN_ID}/cancel`)
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-cancel-01")
    .send({ reason: "CONTRACT_TEST" });
  assert.equal(ok.status, 202);
  assert.equal(ok.body.data.status, "CANCELLING");
  assert.equal(unit.outbox.length, 1);

  const notFound = await request(app.getHttpServer())
    .post("/v1/workflow-runs/00000000-0000-4000-8000-000000000001/cancel")
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-cancel-02")
    .send({});
  expectProblem(notFound, 404, "WORKFLOW_RUN_NOT_FOUND");
  await app.close();
});

test("malformed identifiers are rejected as validation problems", async () => {
  const { app } = await createApp();
  const badParam = await request(app.getHttpServer())
    .get("/v1/workflow-runs/not-a-uuid")
    .set("x-user-id", USER);
  expectProblem(badParam, 422, "VALIDATION_FAILED");
  await app.close();
});

test("disabling the feature flag hides write endpoints", async () => {
  const { app } = await createApp({ graphWorkflowEnabled: "false" });
  const disabled = await request(app.getHttpServer())
    .post(`/v1/projects/${PROJECT_ID}/workflow-runs`)
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-flag-01")
    .send({});
  expectProblem(disabled, 404, "WORKFLOW_FEATURE_DISABLED");
  await app.close();
});
