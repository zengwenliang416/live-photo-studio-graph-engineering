import assert from "node:assert/strict";
import test from "node:test";
import { defineGraphNode } from "./node-definition.js";

test("side-effect nodes must be idempotent", () => {
  assert.throws(() =>
    defineGraphNode({
      name: "unsafe_node_v1",
      version: 1,
      kind: "EXTERNAL_JOB",
      reads: [],
      writes: [],
      sideEffect: true,
      idempotent: false,
    }),
  );
});

test("pure nodes can be non-idempotent by declaration", () => {
  const definition = defineGraphNode({
    name: "route_node_v1",
    version: 1,
    kind: "ROUTER",
    reads: ["currentPhase"],
    writes: [],
    sideEffect: false,
    idempotent: false,
  });
  assert.equal(definition.name, "route_node_v1");
});
