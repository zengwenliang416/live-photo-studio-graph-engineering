import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../app.module.js";
import type { ApiConfig } from "../config.js";
import { InMemoryWorkflowUnit } from "../testing/in-memory-workflow-unit.js";
import type { OutboxQueuePair } from "../workflows/infrastructure/outbox-dispatcher.js";
import { WORKFLOW_TOKENS } from "../workflows/workflow-tokens.js";
import { EXPORT_TOKENS } from "./export-tokens.js";
import type {
  ExportPackageRecord,
  ExportPackageStorePort,
  SignedDownloadPort,
  SignedDownloadRequest,
} from "./ports.js";

process.env["DATABASE_URL"] ??= "postgresql://unittest:invalid@localhost:5/db";
process.env["REDIS_URL"] ??= "redis://unittest.invalid:6379";
process.env["GRAPH_WORKFLOW_ENABLED"] ??= "true";

const USER = "export-contract-user";
const OTHER_USER = "someone-else";
const PROJECT_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const EXPORT_ID = "8e2f6d2e-4f89-4a0c-0305e82c1111";

const exportPackage: ExportPackageRecord = {
  id: EXPORT_ID,
  projectId: PROJECT_ID,
  objectKey: `projects/${PROJECT_ID}/exports/render-1/package.zip`,
  sha256: "b".repeat(64),
  durationMs: 1500,
  bytes: 64,
  createdAt: new Date().toISOString(),
};

class FakeExportPackageStore implements ExportPackageStorePort {
  readonly ownerId: string = USER;
  readonly latest: ExportPackageRecord | null = exportPackage;

  async getProjectOwnerId(): Promise<string | null> {
    return this.ownerId;
  }

  async findLatest(): Promise<ExportPackageRecord | null> {
    return this.latest;
  }
}

class FakeSigner implements SignedDownloadPort {
  readonly requests: SignedDownloadRequest[] = [];

  async createSignedDownload(input: SignedDownloadRequest) {
    this.requests.push(input);
    return {
      url: "https://storage.example.test/signed/package.zip",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
  }
}

async function createApp(): Promise<{
  app: INestApplication;
  signer: FakeSigner;
}> {
  const unit = new InMemoryWorkflowUnit();
  const fakeQueue = {
    add: async () => undefined,
    close: async () => undefined,
  };
  const fakeQueues = {
    commands: fakeQueue,
    signals: fakeQueue,
    generationJobs: fakeQueue,
    renderJobs: fakeQueue,
  } as unknown as OutboxQueuePair;
  const signer = new FakeSigner();

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
      GRAPH_WORKFLOW_ENABLED: "true",
      GRAPH_WORKFLOW_CANARY_USER_IDS: "",
      GRAPH_ADMIN_USER_IDS: "operator-user",
    } satisfies ApiConfig)
    .overrideProvider(WORKFLOW_TOKENS.pool)
    .useValue({})
    .overrideProvider(WORKFLOW_TOKENS.workflowUnit)
    .useValue(unit)
    .overrideProvider(WORKFLOW_TOKENS.outboxQueues)
    .useValue(fakeQueues)
    .overrideProvider(EXPORT_TOKENS.packageStore)
    .useValue(new FakeExportPackageStore())
    .overrideProvider(EXPORT_TOKENS.signedDownloadPort)
    .useValue(signer)
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, signer };
}

test("project export download returns a short-lived signed grant", async () => {
  const { app, signer } = await createApp();
  const response = await request(app.getHttpServer())
    .get(`/v1/projects/${PROJECT_ID}/export-packages/latest/download`)
    .set("x-user-id", USER);

  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.body.data.exportPackageId, EXPORT_ID);
  assert.equal(response.body.data.projectId, PROJECT_ID);
  assert.match(response.body.data.downloadUrl, /^https:\/\/storage/u);
  assert.equal(response.body.data.objectKey, undefined);
  assert.equal(signer.requests[0]?.objectKey, exportPackage.objectKey);
  await app.close();
});

test("project export download enforces project ownership", async () => {
  const { app, signer } = await createApp();
  const response = await request(app.getHttpServer())
    .get(`/v1/projects/${PROJECT_ID}/export-packages/latest/download`)
    .set("x-user-id", OTHER_USER);

  assert.equal(response.status, 403);
  assert.equal(response.body.code, "PROJECT_ACCESS_DENIED");
  assert.equal(signer.requests.length, 0);
  await app.close();
});
