import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { encryptSecret } from "@live-photo-studio/graph-runtime";
import { InMemoryObjectStorage } from "@live-photo-studio/storage";
import {
  workerAiConfigSchema,
  type WorkerAiConfig,
} from "./config.js";
import { OpenAiCompatibleImageProvider } from "./openai-compatible-provider.js";
import { MockImageGenerationProvider } from "./provider.js";
import { resolveProvider } from "./provider-resolver.js";

const KEY_HEX = "a".repeat(64);

function makeConfig(overrides: Record<string, string> = {}): WorkerAiConfig {
  return workerAiConfigSchema.parse({
    DATABASE_URL: "postgresql://localhost:5432/lps",
    REDIS_URL: "redis://localhost:6379",
    ...overrides,
  });
}

function fakePool(row: {
  base_url: string;
  api_key_ciphertext: string;
  model: string;
} | null): Pool {
  return {
    query: async () => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 }),
  } as unknown as Pool;
}

function silenceWarn(): () => void {
  const original = console.warn;
  console.warn = () => undefined;
  return () => {
    console.warn = original;
  };
}

test("enabled user row with a decryptable key wins over env config", async () => {
  const provider = await resolveProvider({
    pool: fakePool({
      base_url: "https://user.example.com",
      api_key_ciphertext: encryptSecret("sk-user-key", KEY_HEX),
      model: "user-model",
    }),
    config: makeConfig({
      SETTINGS_ENCRYPTION_KEY: KEY_HEX,
      AI_PROVIDER: "openai-compatible",
      OPENAI_COMPAT_BASE_URL: "https://env.example.com",
      OPENAI_COMPAT_API_KEY: "sk-env-key",
    }),
    storage: new InMemoryObjectStorage(),
    userId: "user-1",
  });
  assert.ok(provider instanceof OpenAiCompatibleImageProvider);
  assert.equal(provider.baseUrl, "https://user.example.com");
  assert.equal(provider.model, "user-model");
});

test("user row falls back to env config when the encryption key is missing", async () => {
  const restore = silenceWarn();
  try {
    const provider = await resolveProvider({
      pool: fakePool({
        base_url: "https://user.example.com",
        api_key_ciphertext: encryptSecret("sk-user-key", KEY_HEX),
        model: "user-model",
      }),
      config: makeConfig({
        AI_PROVIDER: "openai-compatible",
        OPENAI_COMPAT_BASE_URL: "https://env.example.com",
        OPENAI_COMPAT_API_KEY: "sk-env-key",
      }),
      storage: new InMemoryObjectStorage(),
      userId: "user-1",
    });
    assert.ok(provider instanceof OpenAiCompatibleImageProvider);
    assert.equal(provider.baseUrl, "https://env.example.com");
  } finally {
    restore();
  }
});

test("undecryptable user row degrades to mock without env config", async () => {
  const restore = silenceWarn();
  try {
    const provider = await resolveProvider({
      pool: fakePool({
        base_url: "https://user.example.com",
        api_key_ciphertext: "corrupt-ciphertext",
        model: "user-model",
      }),
      config: makeConfig({ SETTINGS_ENCRYPTION_KEY: KEY_HEX }),
      storage: new InMemoryObjectStorage(),
      userId: "user-1",
    });
    assert.ok(provider instanceof MockImageGenerationProvider);
  } finally {
    restore();
  }
});

test("env config is used when the user has no row", async () => {
  const provider = await resolveProvider({
    pool: fakePool(null),
    config: makeConfig({
      AI_PROVIDER: "openai-compatible",
      OPENAI_COMPAT_BASE_URL: "https://env.example.com",
      OPENAI_COMPAT_API_KEY: "sk-env-key",
    }),
    storage: new InMemoryObjectStorage(),
    userId: "user-2",
  });
  assert.ok(provider instanceof OpenAiCompatibleImageProvider);
  assert.equal(provider.baseUrl, "https://env.example.com");
  assert.equal(provider.model, "gpt-image-2");
});

test("env credentials are ignored while AI_PROVIDER stays mock", async () => {
  const provider = await resolveProvider({
    pool: fakePool(null),
    config: makeConfig({
      OPENAI_COMPAT_BASE_URL: "https://env.example.com",
      OPENAI_COMPAT_API_KEY: "sk-env-key",
    }),
    storage: new InMemoryObjectStorage(),
    userId: "user-2",
  });
  assert.ok(provider instanceof MockImageGenerationProvider);
});

test("default resolution is the mock provider", async () => {
  const provider = await resolveProvider({
    pool: fakePool(null),
    config: makeConfig(),
    storage: new InMemoryObjectStorage(),
    userId: "user-3",
  });
  assert.ok(provider instanceof MockImageGenerationProvider);
});
