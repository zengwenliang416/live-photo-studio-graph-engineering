import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeterministicUuid,
  buildNodeEffectKey,
} from "./idempotency.js";

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

test("deterministic UUIDs are stable and valid", () => {
  const first = buildDeterministicUuid("workflow:task:1");
  assert.equal(first, buildDeterministicUuid("workflow:task:1"));
  assert.match(
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  assert.notEqual(first, buildDeterministicUuid("workflow:task:2"));
});
