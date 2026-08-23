import assert from "node:assert/strict";
import test from "node:test";
import {
  redactSensitive,
  safeLogEvent,
  workflowSignalSchema,
} from "./index.js";

const UUID = "00000000-0000-4000-8000-000000000001";

function validSignal(): Record<string, unknown> {
  return {
    signalId: UUID,
    workflowRunId: UUID,
    signalType: "GENERATION_BATCH_COMPLETED",
    correlationId: UUID,
    payload: { outputIds: [UUID] },
    emittedAt: "2026-08-23T10:00:00.000Z",
  };
}

test("malformed signal matrix is rejected before queue or graph use", () => {
  const invalidSignals: readonly Record<string, unknown>[] = [
    { ...validSignal(), signalId: "not-a-uuid" },
    { ...validSignal(), signalType: "ARBITRARY_NEXT_NODE" },
    { ...validSignal(), correlationId: "" },
    { ...validSignal(), emittedAt: "not-a-timestamp" },
    { ...validSignal(), payload: [] },
  ];

  for (const invalidSignal of invalidSignals) {
    assert.equal(workflowSignalSchema.safeParse(invalidSignal).success, false);
  }
  assert.equal(workflowSignalSchema.safeParse(validSignal()).success, true);
});

test("security redaction matrix removes credential, URL, binary and metadata leaks", () => {
  const longBase64 = "A".repeat(128);
  const value = safeLogEvent("security.matrix", {
    authorization: "Bearer credential",
    credentials: { accessToken: "credential" },
    signedUrl: "https://storage.test/object?X-Amz-Signature=secret",
    prompt: "private system prompt",
    imageBase64: longBase64,
    exif: { gpsLatitude: 31.2, gpsLongitude: 121.4 },
    providerResponse: { body: "private provider response" },
    bytes: new Uint8Array([1, 2, 3]),
    safeId: UUID,
  });

  assert.equal(value["authorization"], "[REDACTED]");
  assert.deepEqual(value["credentials"], "[REDACTED]");
  assert.equal(value["signedUrl"], "[REDACTED]");
  assert.equal(value["prompt"], "[REDACTED]");
  assert.equal(value["imageBase64"], "[REDACTED]");
  assert.equal(value["exif"], "[REDACTED]");
  assert.equal(value["providerResponse"], "[REDACTED]");
  assert.equal(value["bytes"], "[REDACTED_BINARY]");
  assert.equal(value["safeId"], UUID);
  assert.equal(redactSensitive(longBase64), "[REDACTED]");
});
