import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  createAppPool,
  runMigrations,
} from "@live-photo-studio/database";
import {
  GraphRegistry,
} from "@live-photo-studio/graph-runtime";
import type { WorkflowSignal } from "@live-photo-studio/graph-contracts";
import {
  GraphEngine,
  type GraphEngineOptions,
} from "./application/graph-engine.js";
import {
  createMemoryCheckpointer,
  createProductionCheckpointer,
} from "./checkpointer.js";
import { buildLivePhotoProjectGraphV1 } from "./graphs/live-photo-project/live-photo-project.graph.js";
import {
  PostgresProjectReadAdapter,
  PostgresWorkflowEffectAdapter,
} from "./infrastructure/postgres-effects.js";
import { WorkflowRepository } from "./infrastructure/workflow-repository.js";

const RUN_PG_TESTS = process.env.RUN_PG_TESTS === "1";
void RUN_PG_TESTS;

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgresql://postgres@localhost:5432/postgres";
const TEST_DB = "lps_graph_integration_test";
const TEST_URL = `postgresql://postgres@localhost:5432/${TEST_DB}`;

const USER_ID = "integration-user";
const PROJECT_ID = randomUUID();
const COVER_ASSET_ID = randomUUID();
const SOURCE_ASSET_ID = randomUUID();

const openPools: Pool[] = [];
let primary: {
  engine: GraphEngine;
  pool: Pool;
  repository: WorkflowRepository;
} | null = null;

const openCheckpointers: Array<{ end(): Promise<void> }> = [];

after(async () => {
  for (const checkpointer of openCheckpointers) {
    await checkpointer.end().catch(() => undefined);
  }
  for (const pool of openPools) {
    await pool.end().catch(() => undefined);
  }
  const admin = createAppPool(ADMIN_URL);
  try {
    await admin
      .query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`)
      .catch(() => undefined);
  } finally {
    await admin.end();
  }
});

async function buildEngine(
  options: GraphEngineOptions = {},
): Promise<{ engine: GraphEngine; pool: Pool }> {
  const durable = await createProductionCheckpointer({
    connectionString: TEST_URL,
    setup: false,
  });
  openCheckpointers.push(durable);
  const checkpointer = durable.saver;
  const pool = createAppPool(TEST_URL);
  openPools.push(pool);
  const registry = new GraphRegistry();
  registry.register("live-photo-project", "v1", () =>
    buildLivePhotoProjectGraphV1({
      projects: new PostgresProjectReadAdapter(pool),
      effects: new PostgresWorkflowEffectAdapter(pool),
      checkpointer,
    }),
  );
  return {
    engine: new GraphEngine(pool, registry, {
      signalVisibilityTimeoutMs: 1000,
      ...options,
    }),
    pool,
  };
}

async function setupDatabase(): Promise<void> {
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
    assert.ok(applied.applied.length >= 3, "all migrations should apply");
  } finally {
    await bootstrap.end();
  }
  const bootstrapSaver = await createProductionCheckpointer({
    connectionString: TEST_URL,
    setup: true,
  });
  openCheckpointers.push(bootstrapSaver);

  const bundle = await buildEngine();
  primary = {
    engine: bundle.engine,
    pool: bundle.pool,
    repository: new WorkflowRepository(bundle.pool),
  };
  await primary.pool.query(
    `INSERT INTO projects (id, user_id, title, cover_asset_id)
     VALUES ($1, $2, 'integration', $3) ON CONFLICT (id) DO NOTHING`,
    [PROJECT_ID, USER_ID, COVER_ASSET_ID],
  );
  await primary.pool.query(
    `INSERT INTO asset_roles (project_id, asset_id, role)
     VALUES ($1, $3, 'CONTENT'), ($1, $2, 'COVER')
     ON CONFLICT DO NOTHING`,
    [PROJECT_ID, COVER_ASSET_ID, SOURCE_ASSET_ID],
  );
}

async function harness(): Promise<{
  engineA: GraphEngine;
  pool: Pool;
  repository: WorkflowRepository;
}> {
  if (!primary) await setupDatabase();
  if (!primary) throw new Error("integration bootstrap failed");
  return { engineA: primary.engine, pool: primary.pool, repository: primary.repository };
}

function startCommand(workflowRunId: string) {
  return {
    type: "START_WORKFLOW",
    commandId: randomUUID(),
    workflowRunId,
    projectId: PROJECT_ID,
    userId: USER_ID,
    graphKey: "live-photo-project",
    graphVersion: "v1",
    input: {
      workflowRunId,
      projectId: PROJECT_ID,
      userId: USER_ID,
      graphKey: "live-photo-project",
      graphVersion: "v1",
      sourceAssetIds: [SOURCE_ASSET_ID],
      coverAssetId: COVER_ASSET_ID,
    },
    requestedAt: new Date().toISOString(),
  } as const;
}

async function effectJobId(
  pool: Pool,
  workflowRunId: string,
  nodeName: string,
): Promise<string> {
  const result = await pool.query<{ external_job_id: string }>(
    `SELECT external_job_id FROM workflow_node_effects
      WHERE workflow_run_id = $1 AND node_name = $2
      ORDER BY created_at ASC LIMIT 1`,
    [workflowRunId, nodeName],
  );
  const row = result.rows[0];
  if (!row?.external_job_id) {
    throw new Error(`${nodeName} effect row missing`);
  }
  return row.external_job_id;
}

function externalSignal(input: {
  workflowRunId: string;
  correlationId: string;
  payload: Record<string, unknown>;
}) {
  const rawType = input.payload["type"];
  return {
    signalId: randomUUID(),
    workflowRunId: input.workflowRunId,
    signalType: typeof rawType === "string"
      ? (rawType as WorkflowSignal["signalType"])
      : "HUMAN_TASK_COMPLETED" as const,
    correlationId: input.correlationId,
    payload: input.payload,
    emittedAt: new Date().toISOString(),
  } as const;
}

async function runStateLabel(
  pool: Pool,
  workflowRunId: string,
): Promise<string> {
  const result = await pool.query<{
    current_phase: string | null;
    status: string;
  }>("SELECT current_phase, status FROM workflow_runs WHERE id = $1", [
    workflowRunId,
  ]);
  const row = result.rows[0];
  if (!row) throw new Error(`run ${workflowRunId} missing`);
  return `${row.status}:${row.current_phase ?? ""}`;
}

if (!RUN_PG_TESTS) {
  test("graph integration suite requires RUN_PG_TESTS=1 plus local PostgreSQL", () => {
    assert.equal(RUN_PG_TESTS, false);
  });
} else {
  test("restart at every interrupt drives one clean transition chain", async () => {
    const h = await harness();
    const workflowRunId = randomUUID();
    await h.engineA.handleCommand(startCommand(workflowRunId));
    assert.match(await runStateLabel(h.pool, workflowRunId), /^INTERRUPTED:WAITING_GENERATION$/);

    // Process restart before the first resume: a brand-new engine resumes
    // from the durable checkpoint.
    let next = await buildEngine();
    const jobId = await effectJobId(h.pool, workflowRunId, "dispatch_generation_v1");
    const outputId = randomUUID();
    await next.engine.handleSignal(externalSignal({
      workflowRunId,
      correlationId: jobId,
      payload: { type: "GENERATION_BATCH_COMPLETED", outputIds: [outputId] },
    }));
    assert.match(await runStateLabel(h.pool, workflowRunId), /^INTERRUPTED:REVIEW_ANCHOR$/);

    const tasks = await h.pool.query<{ id: string }>(
      "SELECT id FROM human_tasks WHERE workflow_run_id = $1 AND status = 'PENDING'",
      [workflowRunId],
    );
    const taskId = tasks.rows[0]?.id;
    assert.ok(taskId, "pending human task expected");

    // Restart again before the human-decision resume.
    next = await buildEngine();
    await next.engine.handleSignal(externalSignal({
      workflowRunId,
      correlationId: taskId,
      payload: { action: "SELECT", selectedOutputId: outputId },
    }));
    assert.match(await runStateLabel(h.pool, workflowRunId), /^INTERRUPTED:WAITING_RENDER$/);

    const renderJobId = await effectJobId(h.pool, workflowRunId, "dispatch_render_v1");
    const exportId = randomUUID();
    await next.engine.handleSignal(externalSignal({
      workflowRunId,
      correlationId: renderJobId,
      payload: { type: "RENDER_JOB_COMPLETED", exportId },
    }));

    assert.match(await runStateLabel(h.pool, workflowRunId), /^SUCCEEDED:COMPLETED$/);

    const effectDupes = await h.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM (
         SELECT effect_key FROM workflow_node_effects
          WHERE workflow_run_id = $1 GROUP BY effect_key HAVING COUNT(*) > 1) d`,
      [workflowRunId],
    );
    assert.equal(effectDupes.rows[0]?.count, "0");

    const events = await h.pool.query<{ event_name: string }>(
      "SELECT event_name FROM workflow_events WHERE workflow_run_id = $1 ORDER BY created_at ASC",
      [workflowRunId],
    );
    const names = events.rows.map((row) => row.event_name);
    assert.ok(names.includes("workflow.started.v1"));
    assert.ok(names.includes("workflow.interrupted.v1"));
    assert.ok(names.includes("workflow.resumed.v1"));
    assert.ok(names.includes("workflow.completed.v1"));
  });

  test("duplicate completion delivery is a no-op", async () => {
    const h = await harness();
    const workflowRunId = randomUUID();
    await h.engineA.handleCommand(startCommand(workflowRunId));
    const jobId = await effectJobId(h.pool, workflowRunId, "dispatch_generation_v1");
    const firstOutputId = randomUUID();
    const delivery = externalSignal({
      workflowRunId,
      correlationId: jobId,
      payload: { type: "GENERATION_BATCH_COMPLETED", outputIds: [firstOutputId] },
    });
    await h.engineA.handleSignal(delivery);
    await h.engineA.handleSignal({
      ...delivery,
      signalId: randomUUID(),
      payload: {
        type: "GENERATION_BATCH_COMPLETED",
        outputIds: [randomUUID()],
      },
    });

    assert.match(await runStateLabel(h.pool, workflowRunId), /^INTERRUPTED:REVIEW_ANCHOR$/);
    const duplicate = await h.pool.query<{ duplicate_count: number }>(
      `SELECT duplicate_count
         FROM workflow_signals
        WHERE workflow_run_id = $1 AND correlation_id = $2`,
      [workflowRunId, jobId],
    );
    assert.equal(duplicate.rows[0]?.duplicate_count, 1);
    const outbox = await h.pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'workflow.generation.requested.v1'",
      [workflowRunId],
    );
    assert.equal(outbox.rows[0]?.count, "1");
    const task = await h.pool.query<{ candidate_output_ids: string[] }>(
      "SELECT payload->'candidateOutputIds' AS candidate_output_ids FROM human_tasks WHERE workflow_run_id = $1 AND status = 'PENDING'",
      [workflowRunId],
    );
    assert.deepEqual(task.rows[0]?.candidate_output_ids, [firstOutputId]);
  });

  test("duplicate START commands create one run and one generation effect", async () => {
    const h = await harness();
    const workflowRunId = randomUUID();
    const command = startCommand(workflowRunId);
    await h.engineA.handleCommand(command);
    await h.engineA.handleCommand(command);

    const rows = await h.pool.query<{ runs: string; effects: string; outbox: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM workflow_runs WHERE id = $1) AS runs,
         (SELECT COUNT(*)::text FROM workflow_node_effects WHERE workflow_run_id = $1) AS effects,
         (SELECT COUNT(*)::text FROM outbox_events WHERE aggregate_id = $1::text
            AND event_type = 'workflow.generation.requested.v1') AS outbox`,
      [workflowRunId],
    );
    assert.deepEqual(rows.rows[0], { runs: "1", effects: "1", outbox: "1" });
    assert.match(await runStateLabel(h.pool, workflowRunId), /^INTERRUPTED:WAITING_GENERATION$/);
  });

  test("wrong-correlation signals fail explicitly and late signals cannot reopen cancellation", async () => {
    const h = await harness();
    const workflowRunId = randomUUID();
    await h.engineA.handleCommand(startCommand(workflowRunId));
    const generationJobId = await effectJobId(h.pool, workflowRunId, "dispatch_generation_v1");

    await h.engineA.handleSignal(externalSignal({
      workflowRunId,
      correlationId: randomUUID(),
      payload: {
        type: "GENERATION_BATCH_COMPLETED",
        outputIds: [randomUUID()],
      },
    }));
    assert.match(await runStateLabel(h.pool, workflowRunId), /^INTERRUPTED:WAITING_GENERATION$/);

    const rejected = await h.pool.query<{ status: string; last_error_code: string | null }>(
      `SELECT status, last_error_code
         FROM workflow_signals
        WHERE workflow_run_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [workflowRunId],
    );
    assert.deepEqual(rejected.rows[0], {
      status: "FAILED",
      last_error_code: "SIGNAL_NOT_APPLICABLE",
    });

    await h.engineA.handleCommand({
      type: "CANCEL_WORKFLOW",
      commandId: randomUUID(),
      workflowRunId,
      reason: "TEST_CANCEL",
      requestedAt: new Date().toISOString(),
    });
    assert.match(await runStateLabel(h.pool, workflowRunId), /^CANCELLED:CANCELLED$/);

    await h.engineA.handleSignal(externalSignal({
      workflowRunId,
      correlationId: generationJobId,
      payload: {
        type: "GENERATION_BATCH_COMPLETED",
        outputIds: [randomUUID()],
      },
    }));
    assert.match(await runStateLabel(h.pool, workflowRunId), /^CANCELLED:CANCELLED$/);
    const late = await h.pool.query<{ status: string }>(
      `SELECT status
         FROM workflow_signals
        WHERE workflow_run_id = $1 AND correlation_id = $2`,
      [workflowRunId, generationJobId],
    );
    assert.equal(late.rows[0]?.status, "CONSUMED");
  });

  test("a signal persisted before a crash is recovered exactly once", async () => {
    const h = await harness();
    const workflowRunId = randomUUID();
    await h.engineA.handleCommand(startCommand(workflowRunId));
    const jobId = await effectJobId(h.pool, workflowRunId, "dispatch_generation_v1");

    await h.pool.query(
      `INSERT INTO workflow_signals (
         id, workflow_run_id, signal_type, correlation_id, payload, status, updated_at
       ) VALUES ($1, $2, 'GENERATION_BATCH_COMPLETED', $3, $4::jsonb, 'PROCESSING',
                 now() - interval '10 minutes')`,
      [
        randomUUID(),
        workflowRunId,
        jobId,
        JSON.stringify({ type: "GENERATION_BATCH_COMPLETED", outputIds: [randomUUID()] }),
      ],
    );

    const { engine } = await buildEngine();
    const recovered = await engine.recoverStuckSignals();
    assert.ok(recovered >= 1);
    assert.match(await runStateLabel(h.pool, workflowRunId), /^INTERRUPTED:REVIEW_ANCHOR$/);

    const secondPass = await engine.recoverStuckSignals();
    assert.equal(secondPass, 0);
  });

  test("concurrent duplicate signals produce a single transition", async () => {
    const h = await harness();
    const workflowRunId = randomUUID();
    await h.engineA.handleCommand(startCommand(workflowRunId));
    const jobId = await effectJobId(h.pool, workflowRunId, "dispatch_generation_v1");
    const delivery = externalSignal({
      workflowRunId,
      correlationId: jobId,
      payload: { type: "GENERATION_BATCH_COMPLETED", outputIds: [randomUUID()] },
    });
    await Promise.allSettled([
      h.engineA.handleSignal(delivery),
      h.engineA.handleSignal(delivery),
    ]);

    assert.match(await runStateLabel(h.pool, workflowRunId), /^INTERRUPTED:REVIEW_ANCHOR$/);
    const tasks = await h.pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM human_tasks WHERE workflow_run_id = $1 AND status = 'PENDING'",
      [workflowRunId],
    );
    assert.equal(tasks.rows[0]?.count, "1");
  });

  test("a crash after the graph checkpoint advances is recovered from PROCESSING", async () => {
    const h = await harness();
    const workflowRunId = randomUUID();
    await h.engineA.handleCommand(startCommand(workflowRunId));
    const jobId = await effectJobId(h.pool, workflowRunId, "dispatch_generation_v1");
    const delivery = externalSignal({
      workflowRunId,
      correlationId: jobId,
      payload: { type: "GENERATION_BATCH_COMPLETED", outputIds: [randomUUID()] },
    });

    let shouldCrash = true;
    const crashing = await buildEngine({
      afterGraphResume: () => {
        if (shouldCrash) {
          shouldCrash = false;
          throw new Error("SIMULATED_RESUME_CRASH");
        }
      },
    });
    await assert.rejects(
      crashing.engine.handleSignal(delivery),
      /SIMULATED_RESUME_CRASH/,
    );

    const processing = await h.pool.query<{
      status: string;
      current_phase: string | null;
    }>(
      `SELECT s.status, r.current_phase
         FROM workflow_signals s
         JOIN workflow_runs r ON r.id = s.workflow_run_id
        WHERE s.workflow_run_id = $1 AND s.correlation_id = $2`,
      [workflowRunId, jobId],
    );
    assert.deepEqual(processing.rows[0], {
      status: "PROCESSING",
      current_phase: "WAITING_GENERATION",
    });

    // The claim is durable, while the graph checkpoint has already advanced.
    // Aging the row models the visibility timeout that makes it recoverable.
    await h.pool.query(
      `UPDATE workflow_signals
          SET status = 'PROCESSING', updated_at = now() - interval '10 minutes'
        WHERE workflow_run_id = $1 AND correlation_id = $2`,
      [workflowRunId, jobId],
    );

    const { engine } = await buildEngine();
    const recovered = await engine.recoverStuckSignals();
    assert.ok(recovered >= 1);

    // The replay must not duplicate any business artifact.
    assert.match(await runStateLabel(h.pool, workflowRunId), /^INTERRUPTED:REVIEW_ANCHOR$/);
    const artifacts = await h.pool.query<{ effects: string; tasks: string; outbox: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM workflow_node_effects WHERE workflow_run_id = $1) AS effects,
         (SELECT COUNT(*)::text FROM human_tasks WHERE workflow_run_id = $1) AS tasks,
         (SELECT COUNT(*)::text FROM outbox_events WHERE aggregate_id = $2) AS outbox`,
      [workflowRunId, workflowRunId],
    );
    const counts = artifacts.rows[0];
    assert.equal(counts?.effects, "1");
    assert.equal(counts?.tasks, "1");
    assert.equal(counts?.outbox, "1");

    const secondPass = await engine.recoverStuckSignals();
    assert.equal(secondPass, 0);
  });

  test("runs bound to an old version stay resolvable after v2 registration", async () => {
    const h = await harness();
    // One checkpointer instance per engine lifetime: every resolve() must
    // share the same durable thread store.
    const memoryCheckpointer = createMemoryCheckpointer();
    const registry = new GraphRegistry();
    registry.register("live-photo-project", "v1", () =>
      buildLivePhotoProjectGraphV1({
        projects: new PostgresProjectReadAdapter(h.pool),
        effects: new PostgresWorkflowEffectAdapter(h.pool),
        checkpointer: memoryCheckpointer,
      }),
    );
    registry.register("live-photo-project", "v2", () => ({
      invoke: async () => ({}),
    }));
    const engine = new GraphEngine(h.pool, registry, {
      signalVisibilityTimeoutMs: 1000,
    });
    const workflowRunId = randomUUID();
    await engine.handleCommand(startCommand(workflowRunId));
    const jobId = await effectJobId(h.pool, workflowRunId, "dispatch_generation_v1");
    await engine.handleSignal(externalSignal({
      workflowRunId,
      correlationId: jobId,
      payload: { type: "GENERATION_BATCH_COMPLETED", outputIds: [randomUUID()] },
    }));
    assert.match(await runStateLabel(h.pool, workflowRunId), /^INTERRUPTED:REVIEW_ANCHOR$/);
  });
}
