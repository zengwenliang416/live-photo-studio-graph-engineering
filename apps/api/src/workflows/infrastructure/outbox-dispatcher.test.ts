import assert from "node:assert/strict";
import test from "node:test";
import type { Queue } from "bullmq";
import type { Pool } from "pg";
import {
  OutboxDispatcher,
  OutboxPayloadError,
  parseRoutedPayload,
  routeEvent,
} from "./outbox-dispatcher.js";

function fakePair(): {
  queues: {
    commands: Queue;
    signals: Queue;
    generationJobs: Queue;
    renderJobs: Queue;
    assetPreviewJobs: Queue;
  };
  names: Map<Queue, string>;
} {
  const names = new Map<Queue, string>();
  const make = (name: string): Queue => {
    const queue = { name } as unknown as Queue;
    names.set(queue, name);
    return queue;
  };
  return {
    queues: {
      commands: make("graph-commands"),
      signals: make("graph-signals"),
      generationJobs: make("generation-jobs"),
      renderJobs: make("render-jobs"),
      assetPreviewJobs: make("asset-preview-jobs"),
    },
    names,
  };
}

test("outbox routing maps domain events to their transport queues", () => {
  const { queues, names } = fakePair();
  const route = (eventType: string): string | null => {
    const queue = routeEvent(eventType, queues);
    return queue ? (names.get(queue) ?? null) : null;
  };
  assert.equal(route("START_WORKFLOW"), "graph-commands");
  assert.equal(route("CANCEL_WORKFLOW"), "graph-commands");
  assert.equal(route("HUMAN_TASK_COMPLETED"), "graph-signals");
  assert.equal(route("GENERATION_BATCH_COMPLETED"), "graph-signals");
  assert.equal(route("GENERATION_BATCH_FAILED"), "graph-signals");
  assert.equal(route("RENDER_JOB_COMPLETED"), "graph-signals");
  assert.equal(route("RENDER_JOB_FAILED"), "graph-signals");
  assert.equal(route("workflow.generation.requested.v1"), "generation-jobs");
  assert.equal(route("workflow.render.requested.v1"), "render-jobs");
  assert.equal(route("asset.preview.requested.v1"), "asset-preview-jobs");
  assert.equal(route("workflow.completed.v1"), null);
  assert.equal(route("workflow.failed.v1"), null);
  assert.equal(route("totally.unknown.event"), null);
});

test("outbox payload parsing rejects malformed signals before queue publication", () => {
  assert.throws(
    () => parseRoutedPayload("GENERATION_BATCH_COMPLETED", {
      signalId: "not-a-uuid",
    }),
    (error: unknown) => error instanceof OutboxPayloadError,
  );
});

test("event-only workflow completion payloads are not treated as queue jobs", () => {
  assert.deepEqual(
    parseRoutedPayload("workflow.completed.v1", {
      currentPhase: "COMPLETED",
    }),
    { currentPhase: "COMPLETED" },
  );
});

test("dispatcher recovers events that an older deployment marked unknown", async () => {
  const poolQueries: Array<{
    text: string;
    values: readonly unknown[] | undefined;
  }> = [];
  const client = {
    async query(text: string): Promise<{
      rows: unknown[];
      rowCount: number;
    }> {
      return {
        rows: [],
        rowCount: text.includes("SELECT id, event_type") ? 0 : 1,
      };
    },
    release(): void {},
  };
  const pool = {
    async query(
      text: string,
      values?: readonly unknown[],
    ): Promise<{ rows: unknown[]; rowCount: number }> {
      poolQueries.push({ text, values });
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      return client;
    },
  } as unknown as Pool;
  const { queues } = fakePair();
  const dispatcher = new OutboxDispatcher(pool, queues, {
    intervalMs: 500,
    batchSize: 20,
    visibilityTimeoutMs: 60_000,
  });

  await dispatcher.tick();

  const recovery = poolQueries[0];
  assert.ok(recovery);
  assert.match(recovery.text, /last_error_code = 'UNKNOWN_EVENT_TYPE'/u);
  const routedTypes = recovery.values?.[1];
  assert.ok(Array.isArray(routedTypes));
  assert.ok(routedTypes.includes("asset.preview.requested.v1"));
});
