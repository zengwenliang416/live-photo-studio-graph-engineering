import assert from "node:assert/strict";
import test from "node:test";
import { buildNodeEffectKey } from "./idempotency.js";

test("effect keys are stable across object key order", () => {
  const first = buildNodeEffectKey({
    workflowRunId: "run-1",
    nodeName: "dispatch_generation_v1",
    nodeVersion: 1,
    revision: 0,
    businessInput: { b: 2, a: 1 },
  });
  const second = buildNodeEffectKey({
    workflowRunId: "run-1",
    nodeName: "dispatch_generation_v1",
    nodeVersion: 1,
    revision: 0,
    businessInput: { a: 1, b: 2 },
  });
  assert.equal(first, second);
});

test("effect keys change when the revision changes", () => {
  const base = {
    workflowRunId: "run-1",
    nodeName: "dispatch_generation_v1",
    nodeVersion: 1,
  } as const;
  assert.notEqual(
    buildNodeEffectKey({ ...base, revision: 0 }),
    buildNodeEffectKey({ ...base, revision: 1 }),
  );
});
