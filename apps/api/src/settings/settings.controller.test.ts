import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { STYLE_PRESETS, compilePrompt } from "@live-photo-studio/prompt-kit";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../app.module.js";
import type { ApiConfig } from "../config.js";
import { InMemoryProjectStore } from "../projects/testing/in-memory-project-store.js";
import { PROJECT_TOKENS } from "../projects/project-tokens.js";
import { InMemoryWorkflowUnit } from "../testing/in-memory-workflow-unit.js";
import type { OutboxQueuePair } from "../workflows/infrastructure/outbox-dispatcher.js";
import { WORKFLOW_TOKENS } from "../workflows/workflow-tokens.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { testSessionAuthGuard } from "../testing/test-session-auth.guard.js";
import { SETTING_TOKENS } from "./setting-tokens.js";
import { InMemorySettingsStore } from "./testing/in-memory-settings-store.js";

process.env["DATABASE_URL"] ??= "postgresql://unittest:invalid@localhost:5/db";
process.env["REDIS_URL"] ??= "redis://unittest.invalid:6379";
process.env["GRAPH_WORKFLOW_ENABLED"] ??= "true";

const USER = "contract-user";
const KEY_HEX = "0123456789abcdef".repeat(4);

async function createApp() {
  const store = new InMemorySettingsStore();
  const workflowUnit = new InMemoryWorkflowUnit();
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
      OUTBOX_DISPATCH_INTERVAL_MS: 60_000,
      OUTBOX_DISPATCH_BATCH_SIZE: 10,
      OUTBOX_VISIBILITY_TIMEOUT_MS: 60_000,
      GRAPH_WORKFLOW_ENABLED: "true",
      GRAPH_WORKFLOW_CANARY_USER_IDS: "",
      GRAPH_ADMIN_USER_IDS: "operator-user",
      UPLOAD_MAX_BYTES: 20971520,
      SETTINGS_ENCRYPTION_KEY: KEY_HEX,
    } satisfies ApiConfig)
    .overrideProvider(WORKFLOW_TOKENS.pool)
    .useValue({})
    .overrideProvider(WORKFLOW_TOKENS.workflowUnit)
    .useValue(workflowUnit)
    .overrideProvider(WORKFLOW_TOKENS.outboxQueues)
    .useValue(fakeQueues)
    .overrideProvider(PROJECT_TOKENS.store)
    .useValue(new InMemoryProjectStore())
    .overrideProvider(SETTING_TOKENS.store)
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

test("put requires an Idempotency-Key of at least 16 characters", async () => {
  const { app } = await createApp();

  const missing = await request(app.getHttpServer())
    .put("/v1/settings/image-provider")
    .set("x-user-id", USER)
    .send({
      baseUrl: "https://images.example.com",
      apiKey: "sk-test-1234567890abcd",
      model: "gpt-image-1",
    });
  expectProblem(missing, 400, "IDEMPOTENCY_KEY_REQUIRED");

  const missingDelete = await request(app.getHttpServer())
    .delete("/v1/settings/image-provider")
    .set("x-user-id", USER);
  expectProblem(missingDelete, 400, "IDEMPOTENCY_KEY_REQUIRED");
  await app.close();
});

test("put rejects invalid bodies with 422", async () => {
  const { app } = await createApp();

  const shortKey = await request(app.getHttpServer())
    .put("/v1/settings/image-provider")
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-put-001")
    .send({
      baseUrl: "https://images.example.com",
      apiKey: "short",
      model: "gpt-image-1",
    });
  expectProblem(shortKey, 422, "VALIDATION_FAILED");

  const unknownField = await request(app.getHttpServer())
    .put("/v1/settings/image-provider")
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-put-002")
    .send({
      baseUrl: "https://images.example.com",
      apiKey: "sk-test-1234567890abcd",
      model: "gpt-image-1",
      unexpected: true,
    });
  expectProblem(unknownField, 422, "VALIDATION_FAILED");

  const badUrl = await request(app.getHttpServer())
    .put("/v1/settings/image-provider")
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-put-003")
    .send({
      baseUrl: "not-a-url",
      apiKey: "sk-test-1234567890abcd",
      model: "gpt-image-1",
    });
  expectProblem(badUrl, 422, "VALIDATION_FAILED");
  await app.close();
});

test("put then get round-trips without ever exposing the api key", async () => {
  const { app, store } = await createApp();

  const put = await request(app.getHttpServer())
    .put("/v1/settings/image-provider")
    .set("x-user-id", USER)
    .set("Idempotency-Key", "contract-key-put-010")
    .send({
      baseUrl: "https://images.example.com",
      apiKey: "sk-test-1234567890abcd",
      model: "gpt-image-1",
    });
  assert.equal(put.status, 200);
  assert.ok(!JSON.stringify(put.body).includes("sk-test-1234567890abcd"));

  const get = await request(app.getHttpServer())
    .get("/v1/settings/image-provider")
    .set("x-user-id", USER);
  assert.equal(get.status, 200);
  assert.equal(get.body.data.configured, true);
  assert.equal(get.body.data.keyPreview, "••••abcd");
  assert.ok(!JSON.stringify(get.body).includes("sk-test-1234567890abcd"));
  assert.ok(store.providers.get(USER));
  await app.close();
});

test("style presets endpoint lists the complete visual catalog", async () => {
  const { app } = await createApp();

  const response = await request(app.getHttpServer())
    .get("/v1/style-presets")
    .set("x-user-id", USER);
  assert.equal(response.status, 200);
  const items = response.body.data.items as Array<Record<string, unknown>>;
  assert.equal(items.length, STYLE_PRESETS.length);
  for (const item of items) {
    assert.ok(typeof item["key"] === "string");
    assert.ok(typeof item["name"] === "string");
    assert.ok(typeof item["version"] === "string");
    assert.ok(typeof item["category"] === "string");
    assert.ok(Array.isArray(item["colorPalette"]));
    assert.ok(typeof item["previewStyle"] === "string");
    assert.ok("source" in item);
    assert.ok(item["source"] === null || typeof item["source"] === "object");
  }
  await app.close();
});

test("style preset prompt endpoint returns the compiled prompt for an authenticated user", async () => {
  const { app } = await createApp();
  const preset = STYLE_PRESETS[0];
  assert.ok(preset);
  const response = await request(app.getHttpServer())
    .get(`/v1/style-presets/${preset.key}/prompt?referenceImageCount=3`)
    .set("x-user-id", USER);

  assert.equal(response.status, 200);
  const expected = compilePrompt({ preset, referenceImageCount: 3 });
  assert.deepEqual(response.body.data.preset.source, null);
  assert.equal(response.body.data.preset.key, preset.key);
  assert.equal(response.body.data.prompt, expected.prompt);
  assert.equal(response.body.data.promptVersion, expected.promptVersion);
  assert.equal(response.body.data.promptHash, expected.promptHash);
  assert.equal(response.body.data.referenceImageCount, 3);
  await app.close();
});

test("style preset prompt endpoint defaults the reference image count to one", async () => {
  const { app } = await createApp();
  const preset = STYLE_PRESETS[0];
  assert.ok(preset);
  const response = await request(app.getHttpServer())
    .get(`/v1/style-presets/${preset.key}/prompt`)
    .set("x-user-id", USER);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.referenceImageCount, 1);
  assert.match(response.body.data.prompt, /You receive 1 reference image\(s\)\./u);
  await app.close();
});

test("style preset prompt endpoint rejects invalid reference image counts with 422", async () => {
  const { app } = await createApp();
  for (const value of ["0", "7", "1.5", "not-a-number"]) {
    const response = await request(app.getHttpServer())
      .get(
        `/v1/style-presets/cinematic-portrait/prompt?referenceImageCount=${value}`,
      )
      .set("x-user-id", USER);
    expectProblem(response, 422, "VALIDATION_FAILED");
  }
  await app.close();
});

test("style preset prompt endpoint returns a stable 404 for an unknown key", async () => {
  const { app } = await createApp();
  const response = await request(app.getHttpServer())
    .get("/v1/style-presets/not-a-real-style/prompt")
    .set("x-user-id", USER);
  expectProblem(response, 404, "STYLE_PRESET_NOT_FOUND");
  await app.close();
});

test("style preset prompt endpoint requires authentication", async () => {
  const { app } = await createApp();
  const response = await request(app.getHttpServer()).get(
    "/v1/style-presets/cinematic-portrait/prompt",
  );
  expectProblem(response, 401, "AUTHENTICATION_REQUIRED");
  await app.close();
});
