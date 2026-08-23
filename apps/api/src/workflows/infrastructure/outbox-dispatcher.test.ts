import assert from "node:assert/strict";
import test from "node:test";
import type { Queue } from "bullmq";
import { routeEvent } from "./outbox-dispatcher.js";

function fakePair(): {
  queues: {
    commands: Queue;
    signals: Queue;
    generationJobs: Queue;
    renderJobs: Queue;
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
  assert.equal(route("workflow.generation.requested.v1"), "generation-jobs");
  assert.equal(route("workflow.render.requested.v1"), "render-jobs");
  assert.equal(route("totally.unknown.event"), null);
});
