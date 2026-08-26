import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryObjectStorage } from "@live-photo-studio/storage";
import { OpenAiCompatibleImageProvider } from "./openai-compatible-provider.js";
import { ProviderFailureError } from "./provider.js";

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  view.setUint32(12, 0x49484452); // "IHDR"
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function fakeResponse(status: number, body: unknown): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  } as unknown as Response;
}

function makeProvider(options: {
  fetchImpl: typeof fetch;
  storage?: InMemoryObjectStorage;
  baseUrl?: string;
}) {
  const storage = options.storage ?? new InMemoryObjectStorage();
  const provider = new OpenAiCompatibleImageProvider({
    baseUrl: options.baseUrl ?? "https://api.example.com/",
    apiKey: "sk-test-key",
    model: "gpt-image-2",
    storage,
    fetchImpl: options.fetchImpl,
  });
  return { provider, storage };
}

const REFERENCE = {
  bytes: new TextEncoder().encode("reference-bytes"),
  contentType: "image/jpeg",
};

function generationInput(referenceCount = 1) {
  return {
    projectId: "p1",
    revision: 2,
    count: 2,
    prompt: "compiled prompt text",
    referenceImages: Array.from({ length: referenceCount }, () => REFERENCE),
  };
}

test("successful edit posts multipart fields and stores decoded images", async () => {
  const image = pngBytes(64, 32);
  const calls: { url: unknown; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    return fakeResponse(200, {
      data: [{ b64_json: Buffer.from(image).toString("base64") }],
    });
  }) as unknown as typeof fetch;
  const { provider, storage } = makeProvider({ fetchImpl });

  const candidates = await provider.generate(generationInput(7));

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.url, "https://api.example.com/v1/images/edits");
  assert.equal(call.init?.method, "POST");
  const headers = call.init?.headers as Record<string, string>;
  assert.equal(headers["authorization"], "Bearer sk-test-key");

  const form = call.init?.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("model"), "gpt-image-2");
  assert.equal(form.get("prompt"), "compiled prompt text");
  assert.equal(form.get("size"), "1024x1024");
  // Reference uploads are capped at six.
  assert.equal(form.getAll("image[]").length, 6);

  assert.equal(candidates.length, 1);
  const candidate = candidates[0];
  assert.ok(candidate);
  assert.equal(candidate.storageKey, "projects/p1/generations/r2/0.png");
  assert.equal(candidate.width, 64);
  assert.equal(candidate.height, 32);
  assert.deepEqual(
    storage.objects.get("projects/p1/generations/r2/0.png"),
    image,
  );
  assert.equal(
    storage.contentTypes.get("projects/p1/generations/r2/0.png"),
    "image/png",
  );
});

test("base URL may include the OpenAI-compatible /v1 prefix", async () => {
  const calls: unknown[] = [];
  const fetchImpl = (async (url: unknown) => {
    calls.push(url);
    return fakeResponse(200, {
      data: [{ b64_json: Buffer.from(pngBytes(8, 8)).toString("base64") }],
    });
  }) as unknown as typeof fetch;
  const { provider } = makeProvider({
    fetchImpl,
    baseUrl: "https://api.example.com/v1/",
  });

  await provider.generate(generationInput());

  assert.deepEqual(calls, ["https://api.example.com/v1/images/edits"]);
});

test("401 and 403 map to non-retryable MODEL_AUTH_FAILED", async () => {
  for (const status of [401, 403]) {
    const fetchImpl = (async () =>
      fakeResponse(status, { error: "nope" })) as unknown as typeof fetch;
    const { provider } = makeProvider({ fetchImpl });
    await assert.rejects(
      provider.generate(generationInput()),
      (error: unknown) =>
        error instanceof ProviderFailureError &&
        error.code === "MODEL_AUTH_FAILED" &&
        error.retryable === false,
    );
  }
});

test("moderation 400 maps to non-retryable MODEL_CONTENT_BLOCKED", async () => {
  const fetchImpl = (async () =>
    fakeResponse(400, {
      error: { message: "Request rejected by content_policy moderation" },
    })) as unknown as typeof fetch;
  const { provider } = makeProvider({ fetchImpl });
  await assert.rejects(
    provider.generate(generationInput()),
    (error: unknown) =>
      error instanceof ProviderFailureError &&
      error.code === "MODEL_CONTENT_BLOCKED" &&
      error.retryable === false,
  );
});

test("429 and network failures are retryable", async () => {
  const rateLimited = (async () =>
    fakeResponse(429, { error: "slow down" })) as unknown as typeof fetch;
  const { provider } = makeProvider({ fetchImpl: rateLimited });
  await assert.rejects(
    provider.generate(generationInput()),
    (error: unknown) =>
      error instanceof ProviderFailureError && error.retryable === true,
  );

  const offline = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  const offlineProvider = makeProvider({ fetchImpl: offline }).provider;
  await assert.rejects(
    offlineProvider.generate(generationInput()),
    (error: unknown) =>
      error instanceof ProviderFailureError &&
      error.code === "MODEL_PROVIDER_UNAVAILABLE" &&
      error.retryable === true,
  );
});

test("malformed success payload maps to non-retryable MODEL_RESPONSE_INVALID", async () => {
  const fetchImpl = (async () =>
    fakeResponse(200, { unexpected: true })) as unknown as typeof fetch;
  const { provider } = makeProvider({ fetchImpl });
  await assert.rejects(
    provider.generate(generationInput()),
    (error: unknown) =>
      error instanceof ProviderFailureError &&
      error.code === "MODEL_RESPONSE_INVALID" &&
      error.retryable === false,
  );
});

test("url-only responses are rejected as an unsupported configuration", async () => {
  const fetchImpl = (async () =>
    fakeResponse(200, {
      data: [{ url: "https://images.example.com/1.png" }],
    })) as unknown as typeof fetch;
  const { provider } = makeProvider({ fetchImpl });
  await assert.rejects(
    provider.generate(generationInput()),
    (error: unknown) =>
      error instanceof ProviderFailureError &&
      error.code === "MODEL_PROVIDER_UNCONFIGURED" &&
      error.retryable === false,
  );
});
