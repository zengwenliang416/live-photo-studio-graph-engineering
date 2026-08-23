import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { createAppPool, runMigrations } from "@live-photo-studio/database";
import { workflowSignalSchema } from "@live-photo-studio/graph-contracts";
import {
  generationRequestedPayloadSchema,
  MockImageGenerationProvider,
} from "./provider.js";
import { GenerationService } from "./generation-service.js";

const RUN_PG_TESTS = process.env.RUN_PG_TESTS === "1";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgresql://postgres@localhost:5432/postgres";
const TEST_DB = "lps_worker_ai_test";
const TEST_URL = `postgresql://postgres@localhost:5432/${TEST_DB}`;

const USER_ID = "worker-ai-test";
const PROJECT_ID = randomUUID();

let pool: Pool | null = null;

after(async () => {
  if (pool) await pool.end().catch(() => undefined);
  const admin = createAppPool(ADMIN_URL);
  try {
    await admin
      .query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`)
      .catch(() => undefined);
  } finally {
    await admin.end();
  }
});

let shared: { service: GenerationService; projectId: string } | null = null;

async function harness(): Promise<{
  service: GenerationService;
  projectId: string;
}> {
  if (shared) return shared;
  const admin = createAppPool(ADMIN_URL);
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }
  const bootstrap = createAppPool(TEST_URL);
  try {
    const migrationsDir = new URL(
      "../../../packages/database/migrations/",
      import.meta.url,
    );
    const applied = await runMigrations(bootstrap, migrationsDir.pathname);
    assert.ok(applied.applied.length >= 4, "all migrations should apply");
  } finally {
    await bootstrap.end();
  }
  pool = createAppPool(TEST_URL);
  // One extra project so every test uses its own aggregate scope while
  // sharing a single database for the whole file.
  const secondProject = randomUUID();
  for (const id of [PROJECT_ID, secondProject]) {
    await pool.query(
      `INSERT INTO projects (id, user_id, title) VALUES ($1, $2, 'worker-ai')`,
      [id, USER_ID],
    );
  }
  shared = {
    service: new GenerationService(pool, new MockImageGenerationProvider()),
    projectId: PROJECT_ID,
  };
  return shared;
}

function otherProjectId(): string {
  return `${PROJECT_ID}`;
}

function payload(projectId: string) {
  return generationRequestedPayloadSchema.parse({
    jobId: randomUUID(),
    workflowRunId: randomUUID(),
    projectId,
    sourceAssetIds: [randomUUID()],
    coverAssetId: randomUUID(),
    revision: 0,
  });
}

if (!RUN_PG_TESTS) {
  test("worker-ai integration suite requires RUN_PG_TESTS=1 plus local PostgreSQL", () => {
    assert.equal(RUN_PG_TESTS, false);
  });
} else {
  test("mock provider produces deterministic candidates", async () => {
    const provider = new MockImageGenerationProvider();
    const first = await provider.generate({
      projectId: "p",
      sourceAssetIds: ["s"],
      coverAssetId: "c",
      revision: 3,
      count: 4,
    });
    assert.equal(first.length, 4);
    assert.deepEqual(first[0], {
      storageKey: "projects/p/generations/r3/0.png",
      width: 1024,
      height: 1024,
    });
  });

  test("process writes one batch with four outputs and a correlated signal", async () => {
    const { service, projectId } = await harness();
    const job = payload(projectId);

    const result = await service.process(job);
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.outputIds.length, 4);

    const batch = await pool!.query<{ status: string }>(
      "SELECT status FROM generation_batches WHERE id = $1",
      [job.jobId],
    );
    assert.equal(batch.rows[0]?.status, "SUCCEEDED");

    const signals = await pool!.query<{ payload: unknown }>(
      "SELECT payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'GENERATION_BATCH_COMPLETED'",
      [job.workflowRunId],
    );
    assert.equal(signals.rows.length, 1);
    const signal = workflowSignalSchema.parse(signals.rows[0]?.payload);
    assert.equal(signal.correlationId, job.jobId);
    assert.deepEqual(signal.payload["outputIds"], result.outputIds);
  });

  test("duplicate delivery is idempotent and emits nothing", async () => {
    const { service, projectId } = await harness();
    const job = payload(projectId);

    const first = await service.process(job);
    const replay = await service.process(job);
    assert.equal(replay.status, "ALREADY_DONE");
    assert.deepEqual(replay.outputIds, first.outputIds);

    const counts = await pool!.query<{ batches: string; outbox: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM generation_batches WHERE id = $1) AS batches,
         (SELECT COUNT(*)::text FROM outbox_events WHERE aggregate_id = $2) AS outbox`,
      [job.jobId, job.workflowRunId],
    );
    assert.equal(counts.rows[0]?.batches, "1");
    assert.equal(counts.rows[0]?.outbox, "1");
  });

  test("fail records once and emits the correlated failure signal", async () => {
    const { service, projectId } = await harness();
    const job = payload(projectId);
    const runId = job.workflowRunId;

    await service.fail({ ...job, workflowRunId: runId }, "CONTENT_REJECTED");
    await service.fail({ ...job, workflowRunId: runId }, "CONTENT_REJECTED");

    const batch = await pool!.query<{ status: string; error_code: string | null }>(
      "SELECT status, error_code FROM generation_batches WHERE id = $1",
      [job.jobId],
    );
    assert.equal(batch.rows[0]?.status, "FAILED");
    assert.equal(batch.rows[0]?.error_code, "CONTENT_REJECTED");

    const failedSignals = await pool!.query<{ payload: unknown }>(
      "SELECT payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'GENERATION_BATCH_FAILED'",
      [runId],
    );
    assert.equal(failedSignals.rows.length, 1);
    const signal = workflowSignalSchema.parse(failedSignals.rows[0]?.payload);
    assert.equal(signal.signalType, "GENERATION_BATCH_FAILED");
    assert.deepEqual(signal.payload["errorCode"], "CONTENT_REJECTED");
  });
}
