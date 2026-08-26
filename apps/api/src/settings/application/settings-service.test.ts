import assert from "node:assert/strict";
import test from "node:test";
import { decryptSecret } from "@live-photo-studio/graph-runtime";
import {
  STYLE_PRESETS,
  compilePrompt,
  findStylePreset,
} from "@live-photo-studio/prompt-kit";
import { ApplicationProblemError } from "../../http/problem-details.js";
import { InMemorySettingsStore } from "../testing/in-memory-settings-store.js";
import { SettingsService } from "./settings-service.js";

const USER = "user-a";
const KEY_HEX = "0123456789abcdef".repeat(4);
const VALID_BODY = {
  baseUrl: "https://images.example.com",
  apiKey: "sk-test-1234567890abcd",
  model: "gpt-image-1",
  enabled: true,
} as const;

function makeService(
  encryptionKeyHex: string | undefined,
): { service: SettingsService; store: InMemorySettingsStore } {
  const store = new InMemorySettingsStore();
  return { service: new SettingsService(store, encryptionKeyHex), store };
}

function expectProblem(error: unknown, status: number, code: string): void {
  if (!(error instanceof ApplicationProblemError)) {
    assert.fail(`expected ApplicationProblemError, got ${String(error)}`);
  }
  assert.equal(error.status, status);
  assert.equal(error.code, code);
}

test("put encrypts the api key before it reaches the store", async () => {
  const { service, store } = makeService(KEY_HEX);
  const result = await service.putImageProvider({
    userId: USER,
    idempotencyKey: "key-put-encrypt-0001",
    body: { ...VALID_BODY },
  });
  assert.equal(result.status, 200);
  const stored = store.providers.get(USER);
  assert.ok(stored);
  assert.notEqual(stored.apiKeyCiphertext, VALID_BODY.apiKey);
  assert.equal(
    decryptSecret(stored.apiKeyCiphertext, KEY_HEX),
    VALID_BODY.apiKey,
  );
  // Neither the plaintext key nor the ciphertext may appear in the response.
  const serialized = JSON.stringify(result.body);
  assert.ok(!serialized.includes(VALID_BODY.apiKey));
  assert.ok(!serialized.includes(stored.apiKeyCiphertext));
  const data = (result.body as { data: Record<string, unknown> }).data;
  assert.equal(data["baseUrl"], VALID_BODY.baseUrl);
  assert.equal(data["model"], VALID_BODY.model);
  assert.equal(data["enabled"], true);
  assert.ok(typeof data["updatedAt"] === "string");
});

test("a second put with a new key overwrites the previous record", async () => {
  const { service, store } = makeService(KEY_HEX);
  await service.putImageProvider({
    userId: USER,
    idempotencyKey: "key-put-first-00001",
    body: { ...VALID_BODY, model: "model-one" },
  });
  const firstCiphertext = store.providers.get(USER)?.apiKeyCiphertext;
  await service.putImageProvider({
    userId: USER,
    idempotencyKey: "key-put-second-0001",
    body: { ...VALID_BODY, model: "model-two", enabled: false },
  });
  const stored = store.providers.get(USER);
  assert.ok(stored);
  assert.equal(store.providers.size, 1);
  assert.equal(stored.model, "model-two");
  assert.equal(stored.enabled, false);
  assert.notEqual(stored.apiKeyCiphertext, firstCiphertext);
});

test("get masks the key: preview holds only the last 4 characters", async () => {
  const { service } = makeService(KEY_HEX);
  await service.putImageProvider({
    userId: USER,
    idempotencyKey: "key-put-mask-000001",
    body: { ...VALID_BODY },
  });
  const result = await service.getImageProvider({ userId: USER });
  const data = (result.body as { data: Record<string, unknown> }).data;
  assert.equal(data["configured"], true);
  assert.equal(data["keyPreview"], "••••abcd");
  assert.ok(!JSON.stringify(result.body).includes(VALID_BODY.apiKey));
});

test("get reports configured:false when no record exists", async () => {
  const { service } = makeService(KEY_HEX);
  const result = await service.getImageProvider({ userId: USER });
  assert.deepEqual(result.body, { data: { configured: false } });
});

test("get degrades to a null preview when decryption fails", async () => {
  const { service, store } = makeService(KEY_HEX);
  store.seedProvider({
    userId: USER,
    baseUrl: "https://images.example.com",
    apiKeyCiphertext: "v1.invalid.invalid.invalid",
    model: "gpt-image-1",
    enabled: true,
    createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
  });
  const result = await service.getImageProvider({ userId: USER });
  const data = (result.body as { data: Record<string, unknown> }).data;
  assert.equal(data["configured"], true);
  assert.equal(data["keyPreview"], null);
  assert.ok(!JSON.stringify(result.body).includes("v1.invalid"));
});

test("delete is idempotent: missing records and replays both succeed", async () => {
  const { service, store } = makeService(KEY_HEX);
  await service.putImageProvider({
    userId: USER,
    idempotencyKey: "key-put-delete-0001",
    body: { ...VALID_BODY },
  });
  const first = await service.deleteImageProvider({
    userId: USER,
    idempotencyKey: "key-delete-00000001",
  });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { data: { configured: false } });
  assert.equal(store.providers.size, 0);

  const replay = await service.deleteImageProvider({
    userId: USER,
    idempotencyKey: "key-delete-00000001",
  });
  assert.deepEqual(replay, first);

  const missing = await service.deleteImageProvider({
    userId: USER,
    idempotencyKey: "key-delete-00000002",
  });
  assert.equal(missing.status, 200);
  assert.deepEqual(missing.body, { data: { configured: false } });
});

test("put fails with 503 when the encryption key is not configured", async () => {
  const { service, store } = makeService(undefined);
  await assert.rejects(
    service.putImageProvider({
      userId: USER,
      idempotencyKey: "key-put-nokey-00001",
      body: { ...VALID_BODY },
    }),
    (error: unknown) => {
      expectProblem(error, 503, "SETTINGS_ENCRYPTION_NOT_CONFIGURED");
      return true;
    },
  );
  assert.equal(store.providers.size, 0);
});

test("idempotent replay of put returns the first response; reuse with a different body conflicts", async () => {
  const { service, store } = makeService(KEY_HEX);
  const first = await service.putImageProvider({
    userId: USER,
    idempotencyKey: "key-put-replay-0001",
    body: { ...VALID_BODY },
  });
  const replay = await service.putImageProvider({
    userId: USER,
    idempotencyKey: "key-put-replay-0001",
    body: { ...VALID_BODY },
  });
  assert.deepEqual(replay, first);
  assert.equal(store.providers.size, 1);

  await assert.rejects(
    service.putImageProvider({
      userId: USER,
      idempotencyKey: "key-put-replay-0001",
      body: { ...VALID_BODY, model: "another-model" },
    }),
    (error: unknown) => {
      expectProblem(error, 409, "IDEMPOTENCY_KEY_REUSED");
      return true;
    },
  );
});

test("listStylePresets exposes the visual style catalog without prompt internals", async () => {
  const { service } = makeService(KEY_HEX);
  const result = service.listStylePresets();
  const data = (
    result.body as {
      data: { items: Array<Record<string, unknown>> };
    }
  ).data;
  assert.equal(data.items.length, STYLE_PRESETS.length);
  for (const item of data.items) {
    assert.deepEqual(
      Object.keys(item).sort(),
      [
        "category",
        "colorPalette",
        "description",
        "key",
        "name",
        "previewStyle",
        "recommendedFor",
        "recommendedMotion",
        "source",
        "version",
      ],
    );
    assert.deepEqual(
      item["source"],
      STYLE_PRESETS.find((preset) => preset.key === item["key"])?.source ?? null,
    );
  }
});

test("getStylePresetPrompt returns metadata and the compiled prompt provenance", () => {
  const { service } = makeService(KEY_HEX);
  const preset = findStylePreset("cinematic-portrait");
  assert.ok(preset);
  const expected = compilePrompt({ preset, referenceImageCount: 1 });

  const result = service.getStylePresetPrompt({
    key: preset.key,
    referenceImageCount: 1,
  });
  assert.equal(result.status, 200);
  const data = (
    result.body as {
      data: {
        preset: Record<string, unknown>;
        prompt: string;
        promptVersion: string;
        promptHash: string;
        referenceImageCount: number;
      };
    }
  ).data;
  assert.equal(data.prompt, expected.prompt);
  assert.equal(data.promptVersion, expected.promptVersion);
  assert.equal(data.promptHash, expected.promptHash);
  assert.equal(data.referenceImageCount, 1);
  assert.equal(data.preset["key"], preset.key);
  assert.equal(data.preset["source"], null);
  assert.ok(!("visualBlueprint" in data.preset));
  assert.ok(data.prompt.includes("You receive 1 reference image(s)."));
});

test("getStylePresetPrompt normalizes imported preset provenance", () => {
  const { service } = makeService(KEY_HEX);
  const preset = STYLE_PRESETS.find((value) => value.source !== undefined);
  assert.ok(preset);
  const result = service.getStylePresetPrompt({
    key: preset.key,
    referenceImageCount: 6,
  });
  const data = (
    result.body as {
      data: { preset: { source: unknown }; referenceImageCount: number };
    }
  ).data;
  assert.deepEqual(data.preset.source, preset.source);
  assert.equal(data.referenceImageCount, 6);
});

test("getStylePresetPrompt returns a stable not-found problem", () => {
  const { service } = makeService(KEY_HEX);
  assert.throws(
    () =>
      service.getStylePresetPrompt({
        key: "does-not-exist",
        referenceImageCount: 1,
      }),
    (error: unknown) => {
      expectProblem(error, 404, "STYLE_PRESET_NOT_FOUND");
      return true;
    },
  );
});

test("getStylePresetPrompt rejects reference image counts outside 1..6", () => {
  const { service } = makeService(KEY_HEX);
  for (const referenceImageCount of [0, 7, 1.5]) {
    assert.throws(
      () =>
        service.getStylePresetPrompt({
          key: "cinematic-portrait",
          referenceImageCount,
        }),
      (error: unknown) => {
        expectProblem(error, 422, "VALIDATION_FAILED");
        return true;
      },
    );
  }
});
