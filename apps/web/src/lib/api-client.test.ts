import assert from "node:assert/strict";
import test from "node:test";
import { WorkflowApiClient } from "./api-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as unknown as Response;
}

type Call = { method: string; path: string; key: string | undefined };

function recordingClient() {
  const calls: Call[] = [];
  const keyStore = {
    map: new Map<string, string>(),
    get(actionId: string): string | undefined {
      return this.map.get(actionId);
    },
    set(actionId: string, key: string): void {
      this.map.set(actionId, key);
    },
  };
  const client = new WorkflowApiClient({
    fetchImpl: async (_input, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({
        method: String(init?.method),
        path: String(_input),
        key: headers["idempotency-key"],
      });
      return jsonResponse({ data: { ok: true } });
    },
    baseUrl: "http://test",
    userId: "u",
    keyStore,
  });
  return { client, calls, keyStore };
}

test("duplicate start clicks reuse the same idempotency key", async () => {
  const { client, calls } = recordingClient();
  await client.startWorkflowRun("p1");
  await client.startWorkflowRun("p1");
  assert.equal(calls.length, 2);
  assert.ok(calls[0]?.key);
  assert.equal(calls[0]?.key, calls[1]?.key);
  assert.match(String(calls[0]?.path), /\/v1\/projects\/p1\/workflow-runs$/u);
});

test("decide keys are scoped per task and action", async () => {
  const { client, calls } = recordingClient();
  const body = { action: "SELECT", selectedOutputId: "o" };
  await Promise.all([
    client.decide("t1", body),
    client.decide("t1", body),
    client.decide("t2", body),
  ]);
  assert.equal(calls[0]?.key, calls[1]?.key);
  assert.notEqual(calls[0]?.key, calls[2]?.key);
});

test("problem+json responses raise typed errors", async () => {
  const client = new WorkflowApiClient({
    fetchImpl: async () =>
      ({
        ok: false,
        status: 409,
        headers: new Headers({ "content-type": "application/problem+json" }),
        json: async () => ({ code: "IDEMPOTENCY_KEY_REUSED", title: "reused" }),
      }) as unknown as Response,
    baseUrl: "http://test",
    userId: "u",
  });
  await assert.rejects(
    client.cancel("r"),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code === "IDEMPOTENCY_KEY_REUSED",
  );
});
