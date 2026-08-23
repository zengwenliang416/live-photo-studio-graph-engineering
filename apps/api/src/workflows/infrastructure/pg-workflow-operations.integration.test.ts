import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import type { Pool } from "pg";
import {
  createAppPool,
  listMigrationFiles,
  runMigrations,
} from "@live-photo-studio/database";
import { workflowSignalSchema } from "@live-photo-studio/graph-contracts";
import { WorkflowOperationsService } from "../application/workflow-operations-service.js";
import { PgWorkflowOperations } from "./pg-workflow-operations.js";

const RUN_PG_TESTS = process.env.RUN_PG_TESTS === "1";
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgresql://postgres@localhost:5432/postgres";
const TEST_DB = `lps_api_wf_ops_${process.pid}_${randomUUID()
  .replaceAll("-", "")
  .slice(0, 8)}`;
const TEST_URL = databaseUrl(TEST_DB);
const MIGRATIONS_DIR = new URL(
  "../../../../../packages/database/migrations/",
  import.meta.url,
).pathname;
const USER_ID = "api-workflow-operations-test";
const OPERATOR_ID = "operator";
const OBSERVATION_TABLE = "workflow_operations_test_insert_order";

let pool: Pool | null = null;
let setupPromise: Promise<void> | null = null;

after(async () => {
  if (!RUN_PG_TESTS) return;
  if (pool) await pool.end().catch(() => undefined);

  const admin = createAppPool(ADMIN_URL);
  try {
    await admin
      .query(`DROP DATABASE IF EXISTS ${quoteIdentifier(TEST_DB)} WITH (FORCE)`)
      .catch(() => undefined);
  } finally {
    await admin.end();
  }
});

function databaseUrl(databaseName: string): string {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function requirePool(): Pool {
  if (!pool) throw new Error("PostgreSQL integration database is not ready");
  return pool;
}

function errorHasCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

async function setupDatabase(): Promise<void> {
  const admin = createAppPool(ADMIN_URL);
  try {
    await admin.query(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(TEST_DB)} WITH (FORCE)`,
    );
    await admin.query(`CREATE DATABASE ${quoteIdentifier(TEST_DB)}`);
  } finally {
    await admin.end();
  }

  const bootstrap = createAppPool(TEST_URL);
  try {
    const migrationFiles = listMigrationFiles(MIGRATIONS_DIR);
    const applied = await runMigrations(bootstrap, MIGRATIONS_DIR);
    assert.deepEqual(applied.applied, migrationFiles);
    assert.equal(applied.skipped.length, 0);
  } finally {
    await bootstrap.end();
  }

  pool = createAppPool(TEST_URL);
  await installInsertOrderObserver(requirePool());
}

async function database(): Promise<Pool> {
  if (!setupPromise) setupPromise = setupDatabase();
  await setupPromise;
  return requirePool();
}

async function installInsertOrderObserver(databasePool: Pool): Promise<void> {
  await databasePool.query(`
    CREATE TABLE ${OBSERVATION_TABLE} (
      sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      table_name text NOT NULL,
      row_id uuid NOT NULL,
      workflow_run_id text NOT NULL
    );

    CREATE OR REPLACE FUNCTION workflow_operations_test_record_audit_insert()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO ${OBSERVATION_TABLE} (table_name, row_id, workflow_run_id)
      VALUES (TG_TABLE_NAME, NEW.id, NEW.workflow_run_id::text);
      RETURN NEW;
    END;
    $$;

    CREATE OR REPLACE FUNCTION workflow_operations_test_record_outbox_insert()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      INSERT INTO ${OBSERVATION_TABLE} (table_name, row_id, workflow_run_id)
      VALUES (TG_TABLE_NAME, NEW.id, NEW.aggregate_id);
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER workflow_operations_test_audit_insert
    AFTER INSERT ON workflow_admin_audit_events
    FOR EACH ROW
    EXECUTE FUNCTION workflow_operations_test_record_audit_insert();

    CREATE TRIGGER workflow_operations_test_outbox_insert
    AFTER INSERT ON outbox_events
    FOR EACH ROW
    EXECUTE FUNCTION workflow_operations_test_record_outbox_insert();
  `);
}

type RunFixture = {
  readonly projectId: string;
  readonly workflowRunId: string;
  readonly traceId: string;
};

async function seedRun(databasePool: Pool): Promise<RunFixture> {
  const projectId = randomUUID();
  const workflowRunId = randomUUID();
  const traceId = randomUUID();

  await databasePool.query(
    `INSERT INTO projects (id, user_id, title)
     VALUES ($1::uuid, $2::text, 'workflow operations integration')`,
    [projectId, USER_ID],
  );
  await databasePool.query(
    `INSERT INTO workflow_runs (
       id, project_id, user_id, trace_id, graph_key, graph_version, thread_id,
       status, current_node, current_phase, current_node_version,
       last_error_code, updated_at
     ) VALUES (
       $1::uuid, $2::uuid, $3::text, $4::text, 'live-photo-project', 'v1',
       $1::text, 'INTERRUPTED', 'review_anchor_v1', 'REVIEW_ANCHOR', 2,
       'TEST_ERROR', now() - interval '50 seconds'
     )`,
    [workflowRunId, projectId, USER_ID, traceId],
  );

  return { projectId, workflowRunId, traceId };
}

async function seedSignal(
  databasePool: Pool,
  input: {
    readonly workflowRunId: string;
    readonly traceId: string;
    readonly status: "PENDING" | "PROCESSING" | "CONSUMED" | "FAILED";
    readonly signalType: string;
    readonly payload: Record<string, unknown>;
    readonly signalId?: string;
    readonly correlationId?: string;
  },
): Promise<string> {
  const signalId = input.signalId ?? randomUUID();
  const correlationId = input.correlationId ?? `replay-${signalId}`;

  await databasePool.query(
    `INSERT INTO workflow_signals (
       id, workflow_run_id, signal_type, correlation_id, payload, status,
       created_at, updated_at, trace_id, node_name, node_version,
       external_job_id, provider_request_id, duplicate_count
     ) VALUES (
       $1::uuid, $2::uuid, $3::text, $4::text, $5::jsonb, $6::text,
       now() - interval '20 seconds', now() - interval '10 seconds',
       $7::text, 'replay_node_v1', 1, gen_random_uuid(),
       'provider-replay-fixture', 0
     )`,
    [
      signalId,
      input.workflowRunId,
      input.signalType,
      correlationId,
      JSON.stringify(input.payload),
      input.status,
      input.traceId,
    ],
  );

  return signalId;
}

async function seedTriageFixture(
  databasePool: Pool,
): Promise<{
  readonly run: RunFixture;
  readonly humanTaskId: string;
  readonly signalId: string;
  readonly effectKey: string;
  readonly generationJobId: string;
  readonly outputId: string;
  readonly renderJobId: string;
  readonly outboxEventId: string;
}> {
  const run = await seedRun(databasePool);
  const humanTaskId = randomUUID();
  const signalId = randomUUID();
  const effectKey = `dispatch_generation_v1:${run.workflowRunId}`;
  const generationJobId = randomUUID();
  const outputId = randomUUID();
  const renderJobId = randomUUID();
  const outboxEventId = randomUUID();

  await databasePool.query(
    `INSERT INTO generation_batches (
       id, project_id, workflow_run_id, revision, status, provider,
       trace_id, provider_request_id, cost_micros, created_at, updated_at
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, 3, 'SUCCEEDED', 'mock',
       $4::text, 'provider-generation-fixture', 1234,
       now() - interval '1000 seconds', now() - interval '999 seconds'
     )`,
    [generationJobId, run.projectId, run.workflowRunId, run.traceId],
  );
  await databasePool.query(
    `INSERT INTO generation_outputs (
       id, batch_id, storage_key, width, height
     ) VALUES ($1::uuid, $2::uuid, 'fixture/output.png', 1024, 1024)`,
    [outputId, generationJobId],
  );
  await databasePool.query(
    `INSERT INTO render_jobs (
       id, project_id, workflow_run_id, selected_output_id, status,
       recipe_version, trace_id, external_job_id, provider_request_id,
       created_at, updated_at
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'RUNNING', 'recipe.v1',
       $5::text, gen_random_uuid(), 'provider-render-fixture',
       now() - interval '1000 seconds', now() - interval '999 seconds'
     )`,
    [
      renderJobId,
      run.projectId,
      run.workflowRunId,
      outputId,
      run.traceId,
    ],
  );
  await databasePool.query(
    `INSERT INTO human_tasks (
       id, workflow_run_id, task_type, node_name, payload, status, created_at
     ) VALUES
       ($1::uuid, $2::uuid, 'SELECT_ANCHOR_IMAGE', 'review_anchor_v1',
        $3::jsonb, 'PENDING', now() - interval '900 seconds'),
       (gen_random_uuid(), $2::uuid, 'REVIEW_EXPORT_REPAIR',
        'review_export_repair_v1', '{"allowedActions":["CANCEL"]}'::jsonb,
        'COMPLETED', now() - interval '800 seconds')`,
    [
      humanTaskId,
      run.workflowRunId,
      JSON.stringify({
        allowedActions: ["SELECT", "REGENERATE", "CANCEL"],
        candidateOutputIds: [outputId],
      }),
    ],
  );
  await databasePool.query(
    `INSERT INTO workflow_signals (
       id, workflow_run_id, signal_type, correlation_id, payload, status,
       created_at, updated_at, last_error_code, trace_id, node_name,
       node_version, external_job_id, provider_request_id, duplicate_count
     ) VALUES (
       $1::uuid, $2::uuid, 'GENERATION_BATCH_COMPLETED', 'generation-fixture',
       $3::jsonb, 'PROCESSING', now() - interval '1000 seconds',
       now() - interval '999 seconds', 'TIMEOUT', $4::text,
       'dispatch_generation_v1', 1, $5::uuid, 'provider-signal-fixture', 2
     )`,
    [
      signalId,
      run.workflowRunId,
      JSON.stringify({
        type: "GENERATION_BATCH_COMPLETED",
        outputIds: [outputId],
      }),
      run.traceId,
      generationJobId,
    ],
  );
  await databasePool.query(
    `INSERT INTO workflow_node_effects (
       id, workflow_run_id, node_name, effect_key, external_job_id, status,
       result, trace_id, node_version, provider_request_id,
       created_at, updated_at
     ) VALUES (
       $1::uuid, $2::uuid, 'dispatch_generation_v1', $3::text, $4::uuid,
       'RUNNING', NULL, $5::text, 1, 'provider-effect-fixture',
       now() - interval '1000 seconds', now() - interval '999 seconds'
     )`,
    [
      randomUUID(),
      run.workflowRunId,
      effectKey,
      generationJobId,
      run.traceId,
    ],
  );
  await databasePool.query(
    `INSERT INTO workflow_step_runs (
       id, workflow_run_id, node_name, node_version, attempt, status,
       external_job_id, started_at, completed_at, created_at
     ) VALUES (
       $1::uuid, $2::uuid, 'dispatch_generation_v1', 1, 1, 'SUCCEEDED',
       $3::uuid, now() - interval '2 seconds', now() - interval '1 second',
       now() - interval '1000 seconds'
     )`,
    [randomUUID(), run.workflowRunId, generationJobId],
  );
  await databasePool.query(
    `INSERT INTO outbox_events (
       id, aggregate_type, aggregate_id, event_type, payload, status,
       attempts, trace_id, node_name, node_version, external_job_id,
       provider_request_id, created_at, updated_at
     ) VALUES (
       $1::uuid, 'workflow', $2::text, 'workflow.triage.fixture.v1',
       '{"fixture":true}'::jsonb, 'PENDING', 3, $3::text,
       'dispatch_generation_v1', 1, $4::uuid, 'provider-outbox-fixture',
       now() - interval '1000 seconds', now() - interval '999 seconds'
     )`,
    [outboxEventId, run.workflowRunId, run.traceId, generationJobId],
  );

  await databasePool.query(
    `INSERT INTO workflow_signals (
       id, workflow_run_id, signal_type, correlation_id, payload, status,
       created_at, updated_at, trace_id, node_name, node_version,
       external_job_id, provider_request_id, duplicate_count
     )
     SELECT
       gen_random_uuid(), $1::uuid, 'GENERATION_BATCH_COMPLETED',
       'bounded-correlation-' || n,
       jsonb_build_object(
         'type', 'GENERATION_BATCH_COMPLETED',
         'outputIds', jsonb_build_array($2::text)
       ),
       'PENDING',
       now() - ((101 - n) * interval '1 second'),
       now() - ((101 - n) * interval '1 second'),
       $3::text, 'bounded_signal_node_v1', 1, gen_random_uuid(),
       'provider-bounded-signal', (n % 2)
     FROM generate_series(1, 100) AS series(n)`,
    [run.workflowRunId, outputId, run.traceId],
  );
  await databasePool.query(
    `INSERT INTO workflow_node_effects (
       id, workflow_run_id, node_name, effect_key, external_job_id, status,
       result, trace_id, node_version, provider_request_id,
       created_at, updated_at
     )
     SELECT
       gen_random_uuid(), $1::uuid, 'bounded_effect_node_' || n,
       'bounded-effect-' || n, gen_random_uuid(), 'SUCCEEDED', NULL,
       $2::text, 1, 'provider-bounded-effect',
       now() - ((101 - n) * interval '1 second'),
       now() - ((101 - n) * interval '1 second')
     FROM generate_series(1, 100) AS series(n)`,
    [run.workflowRunId, run.traceId],
  );
  await databasePool.query(
    `INSERT INTO workflow_step_runs (
       id, workflow_run_id, node_name, node_version, attempt, status,
       external_job_id, started_at, completed_at, created_at
     )
     SELECT
       gen_random_uuid(), $1::uuid, 'bounded_step_node_' || n, 1, 1,
       'SUCCEEDED', gen_random_uuid(), now() - interval '2 seconds',
       now() - interval '1 second',
       now() - ((101 - n) * interval '1 second')
     FROM generate_series(1, 100) AS series(n)`,
    [run.workflowRunId],
  );
  await databasePool.query(
    `INSERT INTO generation_batches (
       id, project_id, workflow_run_id, revision, status, provider,
       error_code, trace_id, provider_request_id, cost_micros,
       created_at, updated_at
     )
     SELECT
       gen_random_uuid(), $1::uuid, $2::uuid, n, 'SUCCEEDED', 'mock',
       NULL, $3::text, 'provider-bounded-generation', n,
       now() - ((101 - n) * interval '1 second'),
       now() - ((101 - n) * interval '1 second')
     FROM generate_series(1, 100) AS series(n)`,
    [run.projectId, run.workflowRunId, run.traceId],
  );
  await databasePool.query(
    `INSERT INTO render_jobs (
       id, project_id, workflow_run_id, selected_output_id, status,
       recipe_version, error_code, trace_id, external_job_id,
       provider_request_id, created_at, updated_at
     )
     SELECT
       gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid,
       CASE WHEN n = 1 THEN 'FAILED' ELSE 'SUCCEEDED' END,
       'recipe.v1', CASE WHEN n = 1 THEN 'RENDER_FAILED' ELSE NULL END,
       $4::text, gen_random_uuid(), 'provider-bounded-render',
       now() - ((101 - n) * interval '1 second'),
       now() - ((101 - n) * interval '1 second')
     FROM generate_series(1, 100) AS series(n)`,
    [run.projectId, run.workflowRunId, outputId, run.traceId],
  );
  await databasePool.query(
    `INSERT INTO outbox_events (
       id, aggregate_type, aggregate_id, event_type, payload, status,
       attempts, last_error_code, trace_id, node_name, node_version,
       external_job_id, provider_request_id, created_at, updated_at
     )
     SELECT
       gen_random_uuid(), 'workflow', $1::text,
       'workflow.bounded.' || n || '.v1',
       jsonb_build_object('index', n),
       CASE WHEN n = 1 THEN 'PROCESSING' ELSE 'SENT' END,
       n, CASE WHEN n = 1 THEN 'DISPATCH_TIMEOUT' ELSE NULL END,
       $2::text, 'bounded_outbox_node_v1', 1, gen_random_uuid(),
       'provider-bounded-outbox',
       now() - ((101 - n) * interval '1 second'),
       now() - ((101 - n) * interval '1 second')
     FROM generate_series(1, 100) AS series(n)`,
    [run.workflowRunId, run.traceId],
  );

  return {
    run,
    humanTaskId,
    signalId,
    effectKey,
    generationJobId,
    outputId,
    renderJobId,
    outboxEventId,
  };
}

async function seedReplaySignal(
  databasePool: Pool,
  input: {
    readonly run: RunFixture;
    readonly status: "PENDING" | "PROCESSING" | "CONSUMED" | "FAILED";
    readonly signalType: string;
    readonly payload: Record<string, unknown>;
  },
): Promise<string> {
  return seedSignal(databasePool, {
    workflowRunId: input.run.workflowRunId,
    traceId: input.run.traceId,
    status: input.status,
    signalType: input.signalType,
    payload: input.payload,
  });
}

if (!RUN_PG_TESTS) {
  test("workflow operations PostgreSQL integration requires RUN_PG_TESTS=1 plus local PostgreSQL", () => {
    assert.equal(RUN_PG_TESTS, false);
  });
} else {
  test("getTriage returns bounded workflow and operations aggregates", async () => {
    const databasePool = await database();
    const fixture = await seedTriageFixture(databasePool);
    const operations = new PgWorkflowOperations(databasePool);

    const triage = await operations.getTriage(fixture.run.workflowRunId);

    assert.ok(triage);
    assert.equal(triage.workflowRunId, fixture.run.workflowRunId);
    assert.equal(triage.projectId, fixture.run.projectId);
    assert.equal(triage.traceId, fixture.run.traceId);
    assert.equal(triage.status, "INTERRUPTED");
    assert.equal(triage.currentPhase, "REVIEW_ANCHOR");
    assert.equal(triage.currentNode, "review_anchor_v1");
    assert.equal(triage.currentNodeVersion, 2);
    assert.equal(triage.lastErrorCode, "TEST_ERROR");

    assert.equal(triage.humanTasks.length, 2);
    assert.equal(triage.humanTasks[0]?.humanTaskId, fixture.humanTaskId);
    assert.deepEqual(triage.humanTasks[0]?.candidateOutputIds, [
      fixture.outputId,
    ]);
    assert.deepEqual(triage.humanTasks[0]?.allowedActions, [
      "SELECT",
      "REGENERATE",
      "CANCEL",
    ]);

    assert.equal(triage.signals.length, 100);
    assert.equal(triage.signals[0]?.signalId, fixture.signalId);
    assert.equal(triage.signals[0]?.duplicateCount, 2);
    assert.equal(triage.signals[0]?.lastErrorCode, "TIMEOUT");
    assert.equal(triage.signals[0]?.externalJobId, fixture.generationJobId);

    assert.equal(triage.effects.length, 100);
    assert.equal(triage.effects[0]?.effectKey, fixture.effectKey);
    assert.equal(triage.effects[0]?.externalJobId, fixture.generationJobId);

    assert.equal(triage.nodeRuns.length, 100);
    assert.equal(triage.nodeRuns[0]?.nodeName, "dispatch_generation_v1");
    assert.ok((triage.nodeRuns[0]?.latencyMs ?? 0) >= 1000);

    assert.equal(triage.generationJobs.length, 100);
    assert.equal(triage.generationJobs[0]?.jobId, fixture.generationJobId);
    assert.equal(triage.generationJobs[0]?.costMicros, 1234);

    assert.equal(triage.renderJobs.length, 100);
    assert.equal(triage.renderJobs[0]?.jobId, fixture.renderJobId);
    assert.equal(triage.renderJobs[0]?.selectedOutputId, fixture.outputId);

    assert.equal(triage.outbox.length, 100);
    assert.equal(triage.outbox[0]?.eventId, fixture.outboxEventId);
    assert.equal(triage.outbox[0]?.status, "PENDING");
    assert.equal(triage.outbox[0]?.attempts, 3);

    assert.ok((triage.metrics.interruptAgeMs ?? 0) >= 0);
    assert.ok((triage.metrics.oldestQueueAgeMs ?? 0) >= 1000);
    assert.ok(triage.metrics.duplicateSignalCount >= 2);
    assert.ok(triage.metrics.renderFailureCount >= 1);
    assert.ok(triage.metrics.modelCostMicros >= 1234);
  });

  test("replay validates signal schema and rejects conflicting states", async () => {
    const databasePool = await database();
    const run = await seedRun(databasePool);
    const operations = new PgWorkflowOperations(databasePool);
    const invalidSignalId = await seedReplaySignal(databasePool, {
      run,
      status: "FAILED",
      signalType: "NOT_A_SIGNAL",
      payload: { type: "NOT_A_SIGNAL" },
    });
    const pendingSignalId = await seedReplaySignal(databasePool, {
      run,
      status: "PENDING",
      signalType: "GENERATION_BATCH_COMPLETED",
      payload: { type: "GENERATION_BATCH_COMPLETED", outputIds: [] },
    });
    const consumedSignalId = await seedReplaySignal(databasePool, {
      run,
      status: "CONSUMED",
      signalType: "GENERATION_BATCH_COMPLETED",
      payload: { type: "GENERATION_BATCH_COMPLETED", outputIds: [] },
    });

    const invalid = await operations.replaySignal({
      operatorId: OPERATOR_ID,
      workflowRunId: run.workflowRunId,
      signalId: invalidSignalId,
      commandVersion: "v1",
      reason: "invalid schema fixture",
    });
    const pending = await operations.replaySignal({
      operatorId: OPERATOR_ID,
      workflowRunId: run.workflowRunId,
      signalId: pendingSignalId,
      commandVersion: "v1",
      reason: "pending state fixture",
    });
    const consumed = await operations.replaySignal({
      operatorId: OPERATOR_ID,
      workflowRunId: run.workflowRunId,
      signalId: consumedSignalId,
      commandVersion: "v1",
      reason: "consumed state fixture",
    });

    assert.deepEqual(invalid, {
      status: "CONFLICT",
      code: "SIGNAL_PAYLOAD_INVALID",
    });
    assert.deepEqual(pending, {
      status: "CONFLICT",
      code: "SIGNAL_NOT_REPLAYABLE",
    });
    assert.deepEqual(consumed, {
      status: "CONFLICT",
      code: "SIGNAL_ALREADY_CONSUMED",
    });

    const outbox = await databasePool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM outbox_events
        WHERE aggregate_id = $1::text`,
      [run.workflowRunId],
    );
    assert.equal(outbox.rows[0]?.count, "0");

    const audits = await databasePool.query<{ outcome: string; reason: string }>(
      `SELECT outcome, reason
         FROM workflow_admin_audit_events
        WHERE workflow_run_id = $1::uuid
        ORDER BY created_at ASC`,
      [run.workflowRunId],
    );
    assert.equal(audits.rows.length, 3);
    assert.deepEqual(
      audits.rows.map((row) => `${row.outcome}:${row.reason}`).sort(),
      [
        "REJECTED:SIGNAL_ALREADY_CONSUMED",
        "REJECTED:SIGNAL_NOT_REPLAYABLE",
        "REJECTED:SIGNAL_PAYLOAD_INVALID",
      ],
    );
  });

  test("replay makes audit insertion observable before its Outbox insertion", async () => {
    const databasePool = await database();
    const run = await seedRun(databasePool);
    const signalId = await seedReplaySignal(databasePool, {
      run,
      status: "FAILED",
      signalType: "GENERATION_BATCH_COMPLETED",
      payload: {
        type: "GENERATION_BATCH_COMPLETED",
        outputIds: [randomUUID()],
      },
    });
    const operations = new PgWorkflowOperations(databasePool);

    await databasePool.query(
      `TRUNCATE TABLE ${OBSERVATION_TABLE} RESTART IDENTITY`,
    );
    const result = await operations.replaySignal({
      operatorId: OPERATOR_ID,
      workflowRunId: run.workflowRunId,
      signalId,
      commandVersion: "v1",
      reason: "replay order fixture",
    });

    if (result === null || result.status !== "ACCEPTED") {
      throw new Error("accepted replay result expected");
    }
    assert.equal(result.status, "ACCEPTED");

    const observations = await databasePool.query<{
      sequence: string;
      table_name: string;
      row_id: string;
    }>(
      `SELECT sequence::text, table_name, row_id::text
         FROM ${OBSERVATION_TABLE}
        WHERE workflow_run_id = $1::text
        ORDER BY sequence ASC`,
      [run.workflowRunId],
    );
    assert.deepEqual(
      observations.rows.map((row) => row.table_name),
      ["workflow_admin_audit_events", "outbox_events"],
    );
    assert.equal(observations.rows[1]?.row_id, result.eventId);

    const audit = await databasePool.query<{ outcome: string; event_id: string }>(
      `SELECT outcome, payload->>'eventId' AS event_id
         FROM workflow_admin_audit_events
        WHERE workflow_run_id = $1::uuid
          AND action = 'SIGNAL_REPLAY'`,
      [run.workflowRunId],
    );
    assert.equal(audit.rows.length, 1);
    assert.deepEqual(audit.rows[0], {
      outcome: "ALLOWED",
      event_id: result.eventId,
    });

    const outbox = await databasePool.query<{
      event_type: string;
      status: string;
      payload: unknown;
    }>(
      `SELECT event_type, status, payload
         FROM outbox_events
        WHERE id = $1::uuid`,
      [result.eventId],
    );
    assert.equal(outbox.rows.length, 1);
    assert.equal(outbox.rows[0]?.event_type, "GENERATION_BATCH_COMPLETED");
    assert.equal(outbox.rows[0]?.status, "PENDING");
    const replayedSignal = workflowSignalSchema.parse(outbox.rows[0]?.payload);
    assert.equal(replayedSignal.signalId, signalId);

    const signal = await databasePool.query<{ status: string }>(
      "SELECT status FROM workflow_signals WHERE id = $1::uuid",
      [signalId],
    );
    assert.equal(signal.rows[0]?.status, "PROCESSING");
  });

  test("non-operator denial is persisted through PgWorkflowOperations.recordAudit", async () => {
    const databasePool = await database();
    const run = await seedRun(databasePool);
    const service = new WorkflowOperationsService(
      new PgWorkflowOperations(databasePool),
      [OPERATOR_ID],
    );

    await assert.rejects(
      service.getTriage({
        operatorId: "viewer",
        workflowRunId: run.workflowRunId,
      }),
      (error: unknown) => errorHasCode(error, "OPERATOR_ACCESS_REQUIRED"),
    );

    const audit = await databasePool.query<{
      action: string;
      command_version: string;
      outcome: string;
      reason: string;
    }>(
      `SELECT action, command_version, outcome, reason
         FROM workflow_admin_audit_events
        WHERE operator_id = 'viewer'
          AND workflow_run_id = $1::uuid`,
      [run.workflowRunId],
    );
    assert.deepEqual(audit.rows, [
      {
        action: "TRIAGE_READ",
        command_version: "v1",
        outcome: "DENIED",
        reason: "OPERATOR_REQUIRED",
      },
    ]);
  });
}
