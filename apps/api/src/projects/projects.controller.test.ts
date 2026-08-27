import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../app.module.js";
import type { ApiConfig } from "../config.js";
import { InMemoryProjectStore } from "./testing/in-memory-project-store.js";
import { PROJECT_TOKENS } from "./project-tokens.js";
import { InMemoryWorkflowUnit } from "../testing/in-memory-workflow-unit.js";
import type { OutboxQueuePair } from "../workflows/infrastructure/outbox-dispatcher.js";
import { WORKFLOW_TOKENS } from "../workflows/workflow-tokens.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { testSessionAuthGuard } from "../testing/test-session-auth.guard.js";

process.env["DATABASE_URL"] ??= "postgresql://unittest:invalid@localhost:5/db";
process.env["REDIS_URL"] ??= "redis://unittest.invalid:6379";
process.env["GRAPH_WORKFLOW_ENABLED"] ??= "true";

const USER = "contract-user";
const OTHER_USER = "someone-else";

async function createApp() {
  const store = new InMemoryProjectStore();
  const workflowUnit = new InMemoryWorkflowUnit();
  const fakeQueue = { add: async () => undefined, close: async () => undefined };
  const fakeQueues = {
    commands: fakeQueue,
    signals: fakeQueue,
    generationJobs: fakeQueue,
    renderJobs: fakeQueue,
    assetPreviewJobs: fakeQueue,
  } as unknown as OutboxQueuePair;

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(SessionAuthGuard)
    .useValue(testSessionAuthGuard)
    .overrideProvider(WORKFLOW_TOKENS.config)
    .useValue({
      PORT: 4000,
      DATABASE_URL: "postgresql://unittest:invalid@localhost:5/db",
      REDIS_URL: "redis://unittest.invalid:6379",
      GRAPH_COMMAND_QUEUE: "graph-commands-test",
      GRAPH_SIGNAL_QUEUE: "graph-signals-test",
      GENERATION_JOB_QUEUE: "generation-jobs-test",
      RENDER_JOB_QUEUE: "render-jobs-test",
      ASSET_PREVIEW_JOB_QUEUE: "asset-preview-jobs-test",
      OUTBOX_DISPATCH_INTERVAL_MS: 60_000,
      OUTBOX_DISPATCH_BATCH_SIZE: 10,
      OUTBOX_VISIBILITY_TIMEOUT_MS: 60_000,
      GRAPH_WORKFLOW_ENABLED: "true",
      GRAPH_WORKFLOW_CANARY_USER_IDS: "",
      GRAPH_ADMIN_USER_IDS: "operator-user",
      UPLOAD_MAX_BYTES: 20971520,
    } satisfies ApiConfig)
    .overrideProvider(WORKFLOW_TOKENS.pool)
    .useValue({})
    .overrideProvider(WORKFLOW_TOKENS.workflowUnit)
    .useValue(workflowUnit)
    .overrideProvider(WORKFLOW_TOKENS.outboxQueues)
    .useValue(fakeQueues)
    .overrideProvider(PROJECT_TOKENS.store)
    .useValue(store)
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, store };
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

test("create requires an Idempotency-Key of at least 16 characters", async () => {
  const { app } = await createApp();

  const missing = await request(app.getHttpServer())
    .post("/v1/projects")
    .set("x-user-id", USER)
    .send({});
  expectProblem(missing, 400, "IDEMPOTENCY_KEY_REQUIRED");

  const short = await request(app.getHttpServer())
    .post("/v1/projects")
    .set("x-user-id", USER)
    .set("Idempotency-Key", "too-short")
    .send({});
  expectProblem(short, 400, "IDEMPOTENCY_KEY_REQUIRED");
  await app.close();
});

test("create validates the title and trims it before storing", async () => {
  const { app } = await createApp();

  const tooLong = await request(app.getHttpServer())
    .post("/v1/projects")
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-ttl-001")
    .send({ title: "x".repeat(121) });
  expectProblem(tooLong, 422, "VALIDATION_FAILED");

  const ok = await request(app.getHttpServer())
    .post("/v1/projects")
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-ttl-002")
    .send({ title: "  trimmed title  " });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.title, "trimmed title");
  assert.ok(typeof ok.body.data.projectId === "string");
  assert.ok(typeof ok.body.data.createdAt === "string");
  await app.close();
});

test("idempotent replay returns the first response; reuse with a different body conflicts", async () => {
  const { app, store } = await createApp();

  const first = await request(app.getHttpServer())
    .post("/v1/projects")
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-idem-01")
    .send({ title: "one" });
  assert.equal(first.status, 201);

  const replay = await request(app.getHttpServer())
    .post("/v1/projects")
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-idem-01")
    .send({ title: "one" });
  assert.equal(replay.status, 201);
  assert.deepEqual(replay.body, first.body);
  assert.equal(store.projects.size, 1);

  const conflict = await request(app.getHttpServer())
    .post("/v1/projects")
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-idem-01")
    .send({ title: "two" });
  expectProblem(conflict, 409, "IDEMPOTENCY_KEY_REUSED");
  await app.close();
});

test("list returns only the caller's projects", async () => {
  const { app, store } = await createApp();
  store.seedProject({
    id: "00000000-0000-4000-8000-0000000000a1",
    userId: USER,
    title: "mine",
    coverAssetId: null,
    createdAt: new Date(Date.UTC(2026, 0, 2)).toISOString(),
  });
  store.seedProject({
    id: "00000000-0000-4000-8000-0000000000b1",
    userId: OTHER_USER,
    title: "theirs",
    coverAssetId: null,
    createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
  });

  const response = await request(app.getHttpServer())
    .get("/v1/projects")
    .set("x-user-id", USER);
  assert.equal(response.status, 200);
  assert.equal(response.body.data.items.length, 1);
  assert.equal(response.body.data.items[0].title, "mine");
  assert.equal(response.body.data.nextCursor, null);

  const badLimit = await request(app.getHttpServer())
    .get("/v1/projects?limit=abc")
    .set("x-user-id", USER);
  expectProblem(badLimit, 422, "VALIDATION_FAILED");
  await app.close();
});

test("get detail hides foreign projects behind 404", async () => {
  const { app, store } = await createApp();
  store.seedProject({
    id: "00000000-0000-4000-8000-0000000000c1",
    userId: OTHER_USER,
    title: "theirs",
    coverAssetId: null,
    createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
  });

  const foreign = await request(app.getHttpServer())
    .get("/v1/projects/00000000-0000-4000-8000-0000000000c1")
    .set("x-user-id", USER);
  expectProblem(foreign, 404, "PROJECT_NOT_FOUND");

  const missing = await request(app.getHttpServer())
    .get("/v1/projects/00000000-0000-4000-8000-0000000000ff")
    .set("x-user-id", USER);
  expectProblem(missing, 404, "PROJECT_NOT_FOUND");
  await app.close();
});
