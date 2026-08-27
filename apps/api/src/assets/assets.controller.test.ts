import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { InMemoryObjectStorage } from "@live-photo-studio/storage";
import { AppModule } from "../app.module.js";
import type { ApiConfig } from "../config.js";
import { PROJECT_TOKENS } from "../projects/project-tokens.js";
import { InMemoryProjectStore } from "../projects/testing/in-memory-project-store.js";
import { InMemoryWorkflowUnit } from "../testing/in-memory-workflow-unit.js";
import type { OutboxQueuePair } from "../workflows/infrastructure/outbox-dispatcher.js";
import { WORKFLOW_TOKENS } from "../workflows/workflow-tokens.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { testSessionAuthGuard } from "../testing/test-session-auth.guard.js";
import { ASSET_TOKENS } from "./asset-tokens.js";
import { InMemoryAssetStore } from "./testing/in-memory-asset-store.js";

process.env["DATABASE_URL"] ??= "postgresql://unittest:invalid@localhost:5/db";
process.env["REDIS_URL"] ??= "redis://unittest.invalid:6379";
process.env["GRAPH_WORKFLOW_ENABLED"] ??= "true";

const USER = "contract-user";
const PROJECT_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const ASSET_ID = "8e2f6d2e-4f89-4a0c-9b0c-0305e82c1111";

async function createApp() {
  const assetStore = new InMemoryAssetStore();
  assetStore.seedProject(PROJECT_ID, USER);
  const objectStorage = new InMemoryObjectStorage();
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
    .useValue(new InMemoryWorkflowUnit())
    .overrideProvider(WORKFLOW_TOKENS.outboxQueues)
    .useValue(fakeQueues)
    .overrideProvider(PROJECT_TOKENS.store)
    .useValue(new InMemoryProjectStore())
    .overrideProvider(ASSET_TOKENS.store)
    .useValue(assetStore)
    .overrideProvider(ASSET_TOKENS.objectStorage)
    .useValue(objectStorage)
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, assetStore, objectStorage };
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

test("upload intent requires an Idempotency-Key of at least 16 characters", async () => {
  const { app } = await createApp();

  const missing = await request(app.getHttpServer())
    .post(`/v1/projects/${PROJECT_ID}/upload-intents`)
    .set("x-user-id", USER)
    .send({ contentType: "image/jpeg", bytes: 128 });
  expectProblem(missing, 400, "IDEMPOTENCY_KEY_REQUIRED");

  const short = await request(app.getHttpServer())
    .post(`/v1/projects/${PROJECT_ID}/upload-intents`)
    .set("x-user-id", USER)
    .set("Idempotency-Key", "too-short")
    .send({ contentType: "image/jpeg", bytes: 128 });
  expectProblem(short, 400, "IDEMPOTENCY_KEY_REQUIRED");
  await app.close();
});

test("upload intent validates the body and signs an upload URL", async () => {
  const { app } = await createApp();

  const badType = await request(app.getHttpServer())
    .post(`/v1/projects/${PROJECT_ID}/upload-intents`)
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-intent-01")
    .send({ contentType: "image/gif", bytes: 128 });
  expectProblem(badType, 422, "VALIDATION_FAILED");

  const badBytes = await request(app.getHttpServer())
    .post(`/v1/projects/${PROJECT_ID}/upload-intents`)
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-intent-02")
    .send({ contentType: "image/jpeg", bytes: 0 });
  expectProblem(badBytes, 422, "VALIDATION_FAILED");

  const ok = await request(app.getHttpServer())
    .post(`/v1/projects/${PROJECT_ID}/upload-intents`)
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-intent-03")
    .send({ contentType: "image/jpeg", bytes: 128 });
  assert.equal(ok.status, 201);
  assert.ok(typeof ok.body.data.assetId === "string");
  assert.ok(typeof ok.body.data.uploadUrl === "string");
  assert.equal(ok.body.data.uploadHeaders["content-type"], "image/jpeg");
  assert.ok(typeof ok.body.data.expiresAt === "string");
  await app.close();
});

test("confirm and cover require idempotency keys and valid bodies", async () => {
  const { app } = await createApp();

  const confirmMissingKey = await request(app.getHttpServer())
    .post(`/v1/assets/${ASSET_ID}/confirm`)
    .set("x-user-id", USER)
    .send({ bytes: 128, sha256: "0".repeat(64) });
  expectProblem(confirmMissingKey, 400, "IDEMPOTENCY_KEY_REQUIRED");

  const confirmBadHash = await request(app.getHttpServer())
    .post(`/v1/assets/${ASSET_ID}/confirm`)
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-confirm-01")
    .send({ bytes: 128, sha256: "not-hex" });
  expectProblem(confirmBadHash, 422, "VALIDATION_FAILED");

  const coverMissingKey = await request(app.getHttpServer())
    .post(`/v1/projects/${PROJECT_ID}/cover`)
    .set("x-user-id", USER)
    .send({ assetId: ASSET_ID });
  expectProblem(coverMissingKey, 400, "IDEMPOTENCY_KEY_REQUIRED");

  const coverBadAsset = await request(app.getHttpServer())
    .post(`/v1/projects/${PROJECT_ID}/cover`)
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-cover-0001")
    .send({ assetId: "not-a-uuid" });
  expectProblem(coverBadAsset, 422, "VALIDATION_FAILED");
  await app.close();
});
