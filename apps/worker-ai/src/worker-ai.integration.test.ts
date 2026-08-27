import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { createAppPool, runMigrations } from "@live-photo-studio/database";
import { workflowSignalSchema } from "@live-photo-studio/graph-contracts";
import { InMemoryObjectStorage } from "@live-photo-studio/storage";
import {
  generationRequestedPayloadSchema,
  MockImageGenerationProvider,
} from "./provider.js";
import type { ImageGenerationProvider } from "./provider.js";
import { GenerationService } from "./generation-service.js";

const RUN_PG_TESTS = process.env.RUN_PG_TESTS === "1";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgresql://postgres@localhost:5432/postgres";
const TEST_DB = "lps_worker_ai_test";
const TEST_URL = `postgresql://postgres@localhost:5432/${TEST_DB}`;

const USER_ID = "worker-ai-test";
const PROJECT_ID = randomUUID();
const SECOND_PROJECT_ID = randomUUID();

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

class BlockingProvider implements ImageGenerationProvider {
  readonly name = "blocking-test";
  readonly estimatedCostMicros = 0;
  readonly started: Promise<void>;
  private readonly released: Promise<void>;
  private resolveStarted: () => void = () => undefined;
  private resolveReleased: () => void = () => undefined;
  private readonly delegate = new MockImageGenerationProvider();
  calls = 0;

  constructor() {
    this.started = new Promise<void>((resolve) => {
      this.resolveStarted = resolve;
    });
    this.released = new Promise<void>((resolve) => {
      this.resolveReleased = resolve;
    });
  }

  async generate(
    input: Parameters<ImageGenerationProvider["generate"]>[0],
  ) {
    this.calls += 1;
    this.resolveStarted();
    await this.released;
    return this.delegate.generate(input);
  }

  release(): void {
    this.resolveReleased();
  }
}

class CapturingPlanProvider implements ImageGenerationProvider {
  readonly name = "capturing-plan";
  readonly estimatedCostMicros = 0;
  readonly usesPromptPlan = true;
  readonly delegate = new MockImageGenerationProvider();
  calls = 0;
  referenceContentTypes: string[] = [];

  async generate(
    input: Parameters<ImageGenerationProvider["generate"]>[0],
  ) {
    this.calls += 1;
    this.referenceContentTypes = input.referenceImages.map(
      (image) => image.contentType,
    );
    return this.delegate.generate(input);
  }
}

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
  for (const id of [PROJECT_ID, SECOND_PROJECT_ID]) {
    await pool.query(
      `INSERT INTO projects (id, user_id, title)
       VALUES ($1::uuid, $2::text, 'worker-ai')`,
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
  return SECOND_PROJECT_ID;
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

async function seedAssets(
  job: ReturnType<typeof payload>,
): Promise<void> {
  const sourceAssetId = job.sourceAssetIds[0];
  assert.ok(sourceAssetId);
  await pool!.query(
    `INSERT INTO asset_roles (project_id, asset_id, role)
     VALUES ($1::uuid, $2::uuid, 'CONTENT'),
            ($1::uuid, $3::uuid, 'COVER')
     ON CONFLICT DO NOTHING`,
    [job.projectId, sourceAssetId, job.coverAssetId],
  );
  await pool!.query(
    "UPDATE projects SET cover_asset_id = $2::uuid WHERE id = $1::uuid",
    [job.projectId, job.coverAssetId],
  );
}

async function seedProjectAssetRows(
  job: ReturnType<typeof payload>,
): Promise<void> {
  const assetIds = [...new Set([job.coverAssetId, ...job.sourceAssetIds])];
  for (const assetId of assetIds) {
    await pool!.query(
      `INSERT INTO project_assets (
         id, project_id, user_id, object_key, content_type,
         declared_bytes, bytes, sha256, status, confirmed_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::text, $4, 'image/heic',
         32, 32, $5, 'READY', now()
       )`,
      [
        assetId,
        job.projectId,
        USER_ID,
        `projects/${job.projectId}/originals/${assetId}`,
        "0".repeat(64),
      ],
    );
  }
}

async function seedModelInputVariants(
  job: ReturnType<typeof payload>,
  storage: InMemoryObjectStorage,
): Promise<void> {
  await seedProjectAssetRows(job);
  const assetIds = [...new Set([job.coverAssetId, ...job.sourceAssetIds])];
  for (const assetId of assetIds) {
    const objectKey =
      `projects/${job.projectId}/variants/${assetId}/model-input.v1.jpg`;
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 1, 2, 3]);
    await storage.putObject({
      objectKey,
      body: bytes,
      contentType: "image/jpeg",
    });
    await pool!.query(
      `INSERT INTO asset_variants (
         id, asset_id, project_id, variant_type, recipe_version,
         object_key, content_type, bytes, status
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, 'MODEL_INPUT', 'model-input.v1',
         $4, 'image/jpeg', $5, 'SUCCEEDED'
       )`,
      [randomUUID(), assetId, job.projectId, objectKey, bytes.byteLength],
    );
  }
}

async function seedWorkflowRun(
  projectId: string,
  workflowRunId: string,
): Promise<void> {
  await pool!.query(
    `INSERT INTO workflow_runs (
       id, project_id, user_id, graph_key, graph_version, thread_id,
       current_phase, status
     ) VALUES (
       $1::uuid, $2::uuid, $3::text, 'live-photo-project', 'v1',
       $1::text, 'WAITING_GENERATION', 'INTERRUPTED'
     )`,
    [workflowRunId, projectId, USER_ID],
  );
}

async function workflowPhase(workflowRunId: string): Promise<string | null> {
  const result = await pool!.query<{ current_phase: string | null }>(
    "SELECT current_phase FROM workflow_runs WHERE id = $1::uuid",
    [workflowRunId],
  );
  return result.rows[0]?.current_phase ?? null;
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
      revision: 3,
      count: 4,
      prompt: "",
      referenceImages: [],
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
    await seedWorkflowRun(projectId, job.workflowRunId);
    await seedAssets(job);
    const phaseBefore = await workflowPhase(job.workflowRunId);

    const result = await service.process(job);
    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.outputIds.length, 4);
    assert.equal(phaseBefore, "WAITING_GENERATION");
    assert.equal(await workflowPhase(job.workflowRunId), phaseBefore);

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

  test("prompt providers read JPEG model-input variants instead of HEIC originals", async () => {
    await harness();
    const job = payload(PROJECT_ID);
    const storage = new InMemoryObjectStorage();
    const provider = new CapturingPlanProvider();
    const service = new GenerationService(
      pool!,
      new MockImageGenerationProvider(),
      4,
      0,
      {
        storage,
        resolveProvider: async () => provider,
      },
    );
    await seedWorkflowRun(PROJECT_ID, job.workflowRunId);
    await seedModelInputVariants(job, storage);
    await seedAssets(job);

    const result = await service.process(job);

    assert.equal(result.status, "SUCCEEDED");
    assert.equal(provider.calls, 1);
    assert.deepEqual(provider.referenceContentTypes, [
      "image/jpeg",
      "image/jpeg",
    ]);
  });

  test("prompt providers fail before dispatch when model inputs are not ready", async () => {
    await harness();
    const job = payload(PROJECT_ID);
    const storage = new InMemoryObjectStorage();
    const provider = new CapturingPlanProvider();
    const service = new GenerationService(
      pool!,
      new MockImageGenerationProvider(),
      4,
      0,
      {
        storage,
        resolveProvider: async () => provider,
      },
    );
    await seedWorkflowRun(PROJECT_ID, job.workflowRunId);
    await seedProjectAssetRows(job);
    await seedAssets(job);

    const result = await service.process(job);

    assert.equal(result.status, "FAILED");
    assert.equal(provider.calls, 0);
    const batch = await pool!.query<{ error_code: string | null }>(
      "SELECT error_code FROM generation_batches WHERE id = $1::uuid",
      [job.jobId],
    );
    assert.equal(
      batch.rows[0]?.error_code,
      "ASSET_MODEL_INPUT_NOT_READY",
    );
  });

  test("duplicate delivery is idempotent and emits nothing", async () => {
    const { service, projectId } = await harness();
    const job = payload(projectId);
    await seedWorkflowRun(projectId, job.workflowRunId);
    await seedAssets(job);

    const first = await service.process(job);
    const replay = await service.process(job);
    assert.equal(replay.status, "ALREADY_DONE");
    assert.deepEqual(replay.outputIds, first.outputIds);

    const counts = await pool!.query<{
      batches: string;
      outputs: string;
      signals: string;
    }>(
      `SELECT
         (SELECT COUNT(*)::text FROM generation_batches WHERE id = $1::uuid) AS batches,
         (SELECT COUNT(*)::text FROM generation_outputs WHERE batch_id = $1::uuid) AS outputs,
         (SELECT COUNT(*)::text
            FROM outbox_events
           WHERE aggregate_id = $2::text
             AND event_type = 'GENERATION_BATCH_COMPLETED') AS signals`,
      [job.jobId, job.workflowRunId],
    );
    assert.equal(counts.rows[0]?.batches, "1");
    assert.equal(counts.rows[0]?.outputs, "4");
    assert.equal(counts.rows[0]?.signals, "1");
  });

  test("concurrent duplicate delivery claims the batch before one provider call", async () => {
    const { projectId } = await harness();
    const provider = new BlockingProvider();
    const service = new GenerationService(pool!, provider);
    const job = payload(projectId);
    await seedWorkflowRun(projectId, job.workflowRunId);
    await seedAssets(job);

    const first = service.process(job);
    await provider.started;
    const duplicate = service.process(job);
    const duplicateResult = await duplicate;
    provider.release();
    const firstResult = await first;

    assert.equal(provider.calls, 1);
    assert.equal(duplicateResult.status, "IN_PROGRESS");
    assert.equal(firstResult.status, "SUCCEEDED");
    assert.equal(firstResult.outputIds.length, 4);
  });

  test("rejects an asset from another project before calling the provider", async () => {
    const { projectId } = await harness();
    const provider = new BlockingProvider();
    const service = new GenerationService(pool!, provider);
    const foreignJob = payload(otherProjectId());
    const job = payload(projectId);
    await seedWorkflowRun(projectId, job.workflowRunId);
    await seedAssets(foreignJob);

    await assert.rejects(
      service.process({
        ...job,
        sourceAssetIds: foreignJob.sourceAssetIds,
        coverAssetId: foreignJob.coverAssetId,
      }),
      /ASSET_PROJECT_MISMATCH/u,
    );

    assert.equal(provider.calls, 0);
    const batches = await pool!.query(
      "SELECT 1 FROM generation_batches WHERE id = $1::uuid",
      [job.jobId],
    );
    assert.equal(batches.rowCount, 0);
  });

  test("rejects a job whose workflow run belongs to another project", async () => {
    const { service, projectId } = await harness();
    const job = payload(otherProjectId());
    await seedWorkflowRun(projectId, job.workflowRunId);

    await assert.rejects(
      service.process(job),
      /WORKFLOW_PROJECT_MISMATCH/u,
    );

    const rows = await pool!.query<{ batches: string; signals: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM generation_batches WHERE id = $1::uuid) AS batches,
         (SELECT COUNT(*)::text FROM outbox_events WHERE aggregate_id = $2::text) AS signals`,
      [job.jobId, job.workflowRunId],
    );
    assert.equal(rows.rows[0]?.batches, "0");
    assert.equal(rows.rows[0]?.signals, "0");
  });

  test("fail records once and emits the correlated failure signal", async () => {
    const { service, projectId } = await harness();
    const job = payload(projectId);
    const runId = job.workflowRunId;
    await seedWorkflowRun(projectId, runId);

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
