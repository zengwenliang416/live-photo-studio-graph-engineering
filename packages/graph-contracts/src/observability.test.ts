import assert from "node:assert/strict";
import test from "node:test";
import {
  redactSensitive,
  safeLogEvent,
  workflowExecutionMetadataSchema,
} from "./observability.js";

test("execution metadata stays small and typed", () => {
  const parsed = workflowExecutionMetadataSchema.parse({
    traceId: "00000000-0000-4000-8000-000000000001",
    nodeName: "dispatch_generation_v1",
    nodeVersion: 1,
    externalJobId: "00000000-0000-4000-8000-000000000002",
  });
  assert.equal(parsed.nodeName, "dispatch_generation_v1");
  assert.throws(() =>
    workflowExecutionMetadataSchema.parse({ prompt: "do not persist this" }),
  );
});

test("sensitive logs redact secrets, signed URLs, prompts and binary", () => {
  const result = safeLogEvent("provider.failed", {
    traceId: "00000000-0000-4000-8000-000000000001",
    authorization: "Bearer secret",
    signedUrl: "https://storage.test/file?X-Amz-Signature=secret",
    prompt: "a complete private prompt",
    providerResponse: { raw: "secret response" },
    bytes: new Uint8Array([1, 2, 3]),
  });
  assert.equal(result["traceId"], "00000000-0000-4000-8000-000000000001");
  assert.equal(result["authorization"], "[REDACTED]");
  assert.equal(result["signedUrl"], "[REDACTED]");
  assert.equal(result["prompt"], "[REDACTED]");
  assert.equal(result["providerResponse"], "[REDACTED]");
  assert.equal(result["bytes"], "[REDACTED_BINARY]");
  assert.equal(redactSensitive("plain value"), "plain value");
});
