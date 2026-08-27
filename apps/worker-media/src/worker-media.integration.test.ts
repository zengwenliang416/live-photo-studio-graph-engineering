import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { createAppPool, runMigrations } from "@live-photo-studio/database";
import {
  assetImageVariantRequestedPayloadSchema,
  workflowSignalSchema,
} from "@live-photo-studio/graph-contracts";
import { InMemoryObjectStorage } from "@live-photo-studio/storage";
import {
  AssetImageVariantService,
  PgAssetImageVariantStore,
  type AssetImageVariantRenderer,
} from "./asset-image-variant-service.js";
import { RenderService } from "./export-service.js";
import {
  FakeExportRenderer,
  renderRequestedPayloadSchema,
  sha256Hex,
  type ExportRenderer,
} from "./renderer.js";

const RUN_PG_TESTS = process.env.RUN_PG_TESTS === "1";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgresql://postgres@localhost:5432/postgres";
const TEST_DB = "lps_worker_media_test";
const TEST_URL = `postgresql://postgres@localhost:5432/${TEST_DB}`;
const USER_ID = "worker-media-test";

let pool: Pool | null = null;
let shared: { service: RenderService; storage: InMemoryObjectStorage } | null =
  null;

function readStoredZipEntry(zip: Uint8Array, targetName: string): Uint8Array {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= zip.byteLength) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const bodyStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(zip.subarray(nameStart, nameStart + nameLength));
    if (name === targetName) {
      return zip.slice(bodyStart, bodyStart + compressedSize);
    }
    offset = bodyStart + compressedSize;
  }
  throw new Error(`ZIP_ENTRY_NOT_FOUND:${targetName}`);
}

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

async function seedOutput(
  client: Pool,
  projectId: string = randomUUID(),
): Promise<{ projectId: string; outputId: string; workflowRunId: string }> {
  const workflowRunId = randomUUID();
  const batchId = randomUUID();
  const outputId = randomUUID();
  const photoAssetId = randomUUID();
  const videoAssetId = randomUUID();
  const pairId = randomUUID();
  await client.query(
    `INSERT INTO projects (id, user_id, cover_asset_id)
     VALUES ($1::uuid, $2::text, NULL)
     ON CONFLICT (id) DO NOTHING`,
    [projectId, USER_ID],
  );
  await client.query(
    `INSERT INTO project_assets (
       id, project_id, user_id, object_key, content_type,
       declared_bytes, bytes, sha256, status, confirmed_at
     ) VALUES
       ($1::uuid, $3::uuid, $4::text, $5, 'image/heic',
        3, 3, $7, 'READY', now()),
       ($2::uuid, $3::uuid, $4::text, $6, 'video/quicktime',
        12, 12, $8, 'READY', now())`,
    [
      photoAssetId,
      videoAssetId,
      projectId,
      USER_ID,
      `projects/${projectId}/originals/${photoAssetId}`,
      `projects/${projectId}/originals/${videoAssetId}`,
      "1".repeat(64),
      "2".repeat(64),
    ],
  );
  await client.query(
    "UPDATE projects SET cover_asset_id = $2::uuid WHERE id = $1::uuid",
    [projectId, photoAssetId],
  );
  await client.query(
    `INSERT INTO live_photo_pairs (
       id, project_id, photo_asset_id, video_asset_id
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
    [pairId, projectId, photoAssetId, videoAssetId],
  );
  await client.query(
    `INSERT INTO workflow_runs (
       id, project_id, user_id, graph_key, graph_version, thread_id,
       current_phase, status
     ) VALUES (
       $1::uuid, $2::uuid, $3::text, 'live-photo-project', 'v1',
       $1::text, 'WAITING_RENDER', 'INTERRUPTED'
     )`,
    [workflowRunId, projectId, USER_ID],
  );
  await client.query(
    `INSERT INTO generation_batches (id, project_id, workflow_run_id, status)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'SUCCEEDED')`,
    [batchId, projectId, workflowRunId],
  );
  await client.query(
    `INSERT INTO generation_outputs (id, batch_id, storage_key, width, height)
     VALUES ($1::uuid, $2::uuid, 'k', 100, 100)`,
    [outputId, batchId],
  );
  return { projectId, outputId, workflowRunId };
}

async function workflowPhase(workflowRunId: string): Promise<string | null> {
  const result = await pool!.query<{ current_phase: string | null }>(
    "SELECT current_phase FROM workflow_runs WHERE id = $1::uuid",
    [workflowRunId],
  );
  return result.rows[0]?.current_phase ?? null;
}

async function harness(): Promise<RenderService> {
  if (shared) return shared.service;
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
    assert.ok(applied.applied.length >= 5, "all migrations should apply");
  } finally {
    await bootstrap.end();
  }
  pool = createAppPool(TEST_URL);
  const storage = new InMemoryObjectStorage();
  shared = { service: new RenderService(pool, undefined, storage), storage };
  return shared.service;
}

function payload(input: {
  projectId: string;
  outputId: string;
  workflowRunId: string;
}): ReturnType<typeof renderRequestedPayloadSchema.parse> {
  return renderRequestedPayloadSchema.parse({
    jobId: randomUUID(),
    workflowRunId: input.workflowRunId,
    projectId: input.projectId,
    selectedOutputId: input.outputId,
  });
}

class CountingRenderer implements ExportRenderer {
  readonly recipeVersion = "v1";
  private readonly delegate = new FakeExportRenderer();
  calls = 0;

  render(input: Parameters<ExportRenderer["render"]>[0]) {
    this.calls += 1;
    return this.delegate.render(input);
  }
}

class BlockingRenderer extends CountingRenderer {
  readonly started: Promise<void>;
  private readonly released: Promise<void>;
  private resolveStarted: (() => void) | null = null;
  private resolveReleased: (() => void) | null = null;

  constructor() {
    super();
    this.started = new Promise<void>((resolve) => {
      this.resolveStarted = () => resolve();
    });
    this.released = new Promise<void>((resolve) => {
      this.resolveReleased = () => resolve();
    });
  }

  override async render(input: Parameters<ExportRenderer["render"]>[0]) {
    this.calls += 1;
    this.resolveStarted?.();
    await this.released;
    return new FakeExportRenderer().render(input);
  }

  release(): void {
    this.resolveReleased?.();
  }
}

class StaticImageVariantRenderer implements AssetImageVariantRenderer {
  readonly sizes: string[] = [];

  async render(
    _input: Uint8Array,
    _contentType: string,
    recipe: { readonly size: string },
  ): Promise<Uint8Array> {
    this.sizes.push(recipe.size);
    return Uint8Array.from([0xff, 0xd8, 0xff, 1, 2, 3]);
  }
}

if (!RUN_PG_TESTS) {
  test("worker-media integration suite requires RUN_PG_TESTS=1 plus local PostgreSQL", () => {
    assert.equal(RUN_PG_TESTS, false);
  });
} else {
  test("model-input variant uses a separate JPEG object and is replay-safe", async () => {
    await harness();
    const projectId = randomUUID();
    const assetId = randomUUID();
    const originalKey = `projects/${projectId}/originals/${assetId}`;
    await pool!.query(
      `INSERT INTO projects (id, user_id)
       VALUES ($1::uuid, $2::text)`,
      [projectId, USER_ID],
    );
    await pool!.query(
      `INSERT INTO project_assets (
         id, project_id, user_id, object_key, content_type,
         declared_bytes, bytes, sha256, status, confirmed_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::text, $4, 'image/heic',
         3, 3, $5, 'READY', now()
       )`,
      [assetId, projectId, USER_ID, originalKey, "0".repeat(64)],
    );
    await shared!.storage.putObject({
      objectKey: originalKey,
      body: Uint8Array.from([1, 2, 3]),
      contentType: "image/heic",
    });
    const renderer = new StaticImageVariantRenderer();
    const service = new AssetImageVariantService(
      new PgAssetImageVariantStore(pool!),
      shared!.storage,
      renderer,
    );
    const job = assetImageVariantRequestedPayloadSchema.parse({
      jobId: randomUUID(),
      projectId,
      assetId,
      recipeVersion: "model-input.v1",
    });

    assert.equal(await service.process(job), "SUCCEEDED");
    assert.equal(await service.process(job), "ALREADY_DONE");
    assert.deepEqual(renderer.sizes, ["2048x2048"]);

    const variant = await pool!.query<{
      variant_type: string;
      recipe_version: string;
      object_key: string;
      content_type: string;
      status: string;
    }>(
      `SELECT variant_type, recipe_version, object_key, content_type, status
         FROM asset_variants
        WHERE asset_id = $1::uuid`,
      [assetId],
    );
    assert.deepEqual(variant.rows[0], {
      variant_type: "MODEL_INPUT",
      recipe_version: "model-input.v1",
      object_key:
        `projects/${projectId}/variants/${assetId}/model-input.v1.jpg`,
      content_type: "image/jpeg",
      status: "SUCCEEDED",
    });
  });

  test("render produces one export with stable hash and correlated signal", async () => {
    const service = await harness();
    const seeded = await seedOutput(pool!);
    const job = payload(seeded);
    const phaseBefore = await workflowPhase(job.workflowRunId);
    const objectCountBefore = shared?.storage.objects.size ?? 0;

    const result = await service.process(job);
    assert.equal(result.status, "SUCCEEDED");
    assert.ok(result.exportId);
    assert.equal(phaseBefore, "WAITING_RENDER");
    assert.equal(await workflowPhase(job.workflowRunId), phaseBefore);

    const row = await pool!.query<{
      sha256: string;
      bytes: number;
      manifest: Record<string, unknown>;
    }>(
      `SELECT sha256, bytes, manifest FROM export_packages WHERE id = $1`,
      [result.exportId],
    );
    const record = row.rows[0];
    assert.ok(record && record.bytes > 0);
    assert.equal(String(record.manifest["schemaVersion"]), "1");
    assert.equal(shared?.storage.objects.size, objectCountBefore + 4);
    const packageKey = `projects/${seeded.projectId}/exports/${job.jobId}/package.zip`;
    const storedPackage = shared?.storage.objects.get(packageKey);
    assert.ok(storedPackage);
    assert.equal(sha256Hex(storedPackage), record.sha256);
    const packagedManifest = JSON.parse(
      new TextDecoder().decode(
        readStoredZipEntry(storedPackage, "manifest.json"),
      ),
    ) as Record<string, unknown>;
    assert.equal(packagedManifest["schemaVersion"], "1");
    assert.equal(packagedManifest["recipeVersion"], "v1");
    assert.deepEqual(packagedManifest["entries"], [
      "cover.jpg",
      "motion.mov",
      "manifest.json",
    ]);
    assert.equal(packagedManifest["packageSha256"], undefined);
    assert.equal(record.manifest["packageSha256"], record.sha256);

    // Deterministic renderer: a fresh job over the same input yields the
    // identical package hash.
    const secondJob = payload({
      projectId: seeded.projectId,
      outputId: seeded.outputId,
      workflowRunId: seeded.workflowRunId,
    });
    const replay = await service.process(secondJob);
    assert.equal(replay.status, "SUCCEEDED");
    const second = await pool!.query<{ sha256: string }>(
      "SELECT sha256 FROM export_packages WHERE id = $1",
      [replay.exportId],
    );
    assert.equal(second.rows[0]?.sha256, record.sha256);

    const signals = await pool!.query<{ payload: unknown }>(
      `SELECT payload
         FROM outbox_events
        WHERE aggregate_id = $1::text
          AND event_type = 'RENDER_JOB_COMPLETED'
          AND payload->>'correlationId' = $2::text`,
      [job.workflowRunId, job.jobId],
    );
    assert.equal(signals.rows.length, 1);
    const signal = workflowSignalSchema.parse(signals.rows[0]?.payload);
    assert.equal(signal.correlationId, job.jobId);
    assert.deepEqual(signal.payload["exportId"], result.exportId);

    // sha256 recorded equals hash over deterministic rebuild via fake bytes
    assert.match(record.sha256, /^[0-9a-f]{64}$/u);
    void sha256Hex;
  });

  test("duplicate delivery of the same render job is ignored", async () => {
    const service = await harness();
    const seeded = await seedOutput(pool!);
    const job = payload(seeded);

    const first = await service.process(job);
    const objectCountAfterFirst = shared?.storage.objects.size;
    const duplicate = await service.process(job);
    assert.equal(duplicate.status, "ALREADY_DONE");
    assert.equal(duplicate.exportId, first.exportId);
    assert.equal(shared?.storage.objects.size, objectCountAfterFirst);

    const counts = await pool!.query<{
      jobs: string;
      packages: string;
      signals: string;
    }>(
      `SELECT
         (SELECT COUNT(*)::text FROM render_jobs WHERE id = $1::uuid) AS jobs,
         (SELECT COUNT(*)::text FROM export_packages WHERE render_job_id = $1::uuid) AS packages,
         (SELECT COUNT(*)::text
            FROM outbox_events
           WHERE aggregate_id = $2::text
             AND event_type = 'RENDER_JOB_COMPLETED') AS signals`,
      [job.jobId, job.workflowRunId],
    );
    assert.equal(counts.rows[0]?.jobs, "1");
    assert.equal(counts.rows[0]?.packages, "1");
    assert.equal(counts.rows[0]?.signals, "1");
  });

  test("concurrent duplicate delivery claims before rendering", async () => {
    await harness();
    const seeded = await seedOutput(pool!);
    const job = payload(seeded);
    const renderer = new BlockingRenderer();
    const service = new RenderService(pool!, renderer);

    const firstPromise = service.process(job);
    await renderer.started;

    const duplicate = await service.process(job);
    assert.equal(duplicate.status, "IN_PROGRESS");
    assert.equal(renderer.calls, 1);

    renderer.release();
    const first = await firstPromise;
    assert.equal(first.status, "SUCCEEDED");
  });

  test("rejects a selected output from another project before rendering", async () => {
    await harness();
    const owner = await seedOutput(pool!);
    const foreign = await seedOutput(pool!);
    const renderer = new CountingRenderer();
    const service = new RenderService(pool!, renderer);
    const job = payload({
      projectId: owner.projectId,
      workflowRunId: owner.workflowRunId,
      outputId: foreign.outputId,
    });

    await assert.rejects(
      service.process(job),
      /SELECTED_OUTPUT_NOT_FOUND/u,
    );
    assert.equal(renderer.calls, 0);
  });

  test("rejects a selected output from another workflow run before rendering", async () => {
    await harness();
    const owner = await seedOutput(pool!);
    const otherRun = await seedOutput(pool!, owner.projectId);
    const renderer = new CountingRenderer();
    const service = new RenderService(pool!, renderer);
    const job = payload({
      projectId: owner.projectId,
      workflowRunId: owner.workflowRunId,
      outputId: otherRun.outputId,
    });

    await assert.rejects(
      service.process(job),
      /SELECTED_OUTPUT_NOT_FOUND/u,
    );
    assert.equal(renderer.calls, 0);
  });

  test("rejects rendering when the project cover has no paired MOV", async () => {
    await harness();
    const seeded = await seedOutput(pool!);
    await pool!.query(
      "DELETE FROM live_photo_pairs WHERE project_id = $1::uuid",
      [seeded.projectId],
    );
    const renderer = new CountingRenderer();
    const service = new RenderService(pool!, renderer);

    await assert.rejects(
      service.process(payload(seeded)),
      /LIVE_PHOTO_VIDEO_NOT_FOUND/u,
    );
    assert.equal(renderer.calls, 0);
  });

  test("rejects a job with an unknown workflow correlation", async () => {
    const service = await harness();
    const seeded = await seedOutput(pool!);
    const job = payload({
      projectId: seeded.projectId,
      outputId: seeded.outputId,
      workflowRunId: randomUUID(),
    });

    await assert.rejects(
      service.process(job),
      /WORKFLOW_PROJECT_MISMATCH/u,
    );

    const rows = await pool!.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM render_jobs WHERE id = $1::uuid",
      [job.jobId],
    );
    assert.equal(rows.rows[0]?.count, "0");
  });

  test("failure path records once and emits the failure signal", async () => {
    const service = await harness();
    const seeded = await seedOutput(pool!);
    const job = payload(seeded);
    const runId = job.workflowRunId;

    await service.fail(job, "RENDER_FAILED");
    await service.fail(job, "RENDER_FAILED");

    const job_ = await pool!.query<{ status: string; error_code: string | null }>(
      "SELECT status, error_code FROM render_jobs WHERE id = $1",
      [job.jobId],
    );
    assert.equal(job_.rows[0]?.status, "FAILED");
    assert.equal(job_.rows[0]?.error_code, "RENDER_FAILED");

    const failedSignals = await pool!.query<{ payload: unknown }>(
      "SELECT payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'RENDER_JOB_FAILED'",
      [runId],
    );
    assert.equal(failedSignals.rows.length, 1);
    const signal = workflowSignalSchema.parse(failedSignals.rows[0]?.payload);
    assert.deepEqual(signal.payload["errorCode"], "RENDER_FAILED");
  });

  test("failure path rejects a selected output outside the workflow scope", async () => {
    const service = await harness();
    const owner = await seedOutput(pool!);
    const foreign = await seedOutput(pool!);
    const job = payload({
      projectId: owner.projectId,
      workflowRunId: owner.workflowRunId,
      outputId: foreign.outputId,
    });

    await assert.rejects(
      service.fail(job, "RENDER_FAILED"),
      /SELECTED_OUTPUT_NOT_FOUND/u,
    );
    const rows = await pool!.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM render_jobs WHERE id = $1",
      [job.jobId],
    );
    assert.equal(rows.rows[0]?.count, "0");
  });

  test("failure path rejects a render job scope collision", async () => {
    const service = await harness();
    const owner = await seedOutput(pool!);
    const foreign = await seedOutput(pool!);
    const job = payload(owner);
    await service.fail(job, "RENDER_FAILED");

    const conflictingJob = renderRequestedPayloadSchema.parse({
      jobId: job.jobId,
      projectId: foreign.projectId,
      workflowRunId: foreign.workflowRunId,
      selectedOutputId: foreign.outputId,
    });
    await assert.rejects(
      service.fail(conflictingJob, "RENDER_FAILED"),
      /RENDER_JOB_SCOPE_MISMATCH/u,
    );
  });

  test("unknown selected output fails fast without partial writes", async () => {
    const service = await harness();
    const seeded = await seedOutput(pool!);
    const job = payload({
      projectId: seeded.projectId,
      outputId: randomUUID(),
      workflowRunId: seeded.workflowRunId,
    });
    await assert.rejects(service.process(job), /SELECTED_OUTPUT_NOT_FOUND/u);
    const rows = await pool!.query(
      "SELECT 1 FROM render_jobs WHERE id = $1",
      [job.jobId],
    );
    assert.equal(rows.rowCount, 0);
  });
}
