import assert from "node:assert/strict";
import test from "node:test";
import { generationRequestedPayloadSchema } from "./job-payloads.js";

const UUID = "00000000-0000-4000-8000-000000000001";

function validPayload(): Record<string, unknown> {
  return {
    jobId: UUID,
    workflowRunId: UUID,
    projectId: UUID,
    sourceAssetIds: [UUID],
    coverAssetId: UUID,
    revision: 0,
    traceId: UUID,
    nodeName: "dispatch_generation_v1",
    nodeVersion: 1,
    externalJobId: UUID,
  };
}

test("generation payloads without a style key still parse", () => {
  const parsed = generationRequestedPayloadSchema.parse(validPayload());
  assert.equal(parsed.styleKey, undefined);
});

test("generation payloads accept a valid style key", () => {
  const parsed = generationRequestedPayloadSchema.parse({
    ...validPayload(),
    styleKey: "cinematic",
  });
  assert.equal(parsed.styleKey, "cinematic");
});

test("generation payloads reject empty or overlong style keys", () => {
  assert.equal(
    generationRequestedPayloadSchema.safeParse({
      ...validPayload(),
      styleKey: "",
    }).success,
    false,
  );
  assert.equal(
    generationRequestedPayloadSchema.safeParse({
      ...validPayload(),
      styleKey: "x".repeat(65),
    }).success,
    false,
  );
});
