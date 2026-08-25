import type { Pool } from "pg";
import { safeLogEvent } from "@live-photo-studio/graph-contracts";
import { decryptSecret } from "@live-photo-studio/graph-runtime";
import type { ObjectStoragePort } from "@live-photo-studio/storage";
import type { WorkerAiConfig } from "./config.js";
import { OpenAiCompatibleImageProvider } from "./openai-compatible-provider.js";
import {
  MockImageGenerationProvider,
  type ImageGenerationProvider,
} from "./provider.js";

export interface ResolveProviderInput {
  readonly pool: Pool;
  readonly config: WorkerAiConfig;
  readonly storage: ObjectStoragePort;
  readonly userId: string;
}

interface UserImageProviderRow {
  base_url: string;
  api_key_ciphertext: string;
  model: string;
}

/**
 * Per-user provider resolution. Priority: enabled user_image_providers row
 * (decrypting the stored key with SETTINGS_ENCRYPTION_KEY) → env-level
 * openai-compatible config → mock. Decryption or key problems degrade to the
 * next source with a warn log; ciphertext and plaintext keys never log.
 */
export async function resolveProvider(
  input: ResolveProviderInput,
): Promise<ImageGenerationProvider> {
  const { pool, config, storage, userId } = input;

  const userConfig = await pool.query<UserImageProviderRow>(
    `SELECT base_url, api_key_ciphertext, model
       FROM user_image_providers
      WHERE user_id = $1 AND enabled`,
    [userId],
  );
  const row = userConfig.rows[0];
  if (row) {
    const apiKey = tryDecrypt(row.api_key_ciphertext, config, userId);
    if (apiKey) {
      return new OpenAiCompatibleImageProvider({
        baseUrl: row.base_url,
        apiKey,
        model: row.model,
        storage,
      });
    }
  }

  if (
    config.AI_PROVIDER === "openai-compatible" &&
    config.OPENAI_COMPAT_BASE_URL &&
    config.OPENAI_COMPAT_API_KEY
  ) {
    return new OpenAiCompatibleImageProvider({
      baseUrl: config.OPENAI_COMPAT_BASE_URL,
      apiKey: config.OPENAI_COMPAT_API_KEY,
      model: config.OPENAI_IMAGE_MODEL,
      storage,
    });
  }

  return new MockImageGenerationProvider();
}

function tryDecrypt(
  ciphertext: string,
  config: WorkerAiConfig,
  userId: string,
): string | null {
  if (!config.SETTINGS_ENCRYPTION_KEY) {
    console.warn(JSON.stringify(safeLogEvent("worker_ai.provider_key_unavailable", {
      userId,
      reason: "SETTINGS_ENCRYPTION_KEY_MISSING",
    })));
    return null;
  }
  try {
    return decryptSecret(ciphertext, config.SETTINGS_ENCRYPTION_KEY);
  } catch {
    console.warn(JSON.stringify(safeLogEvent("worker_ai.provider_key_decrypt_failed", {
      userId,
      reason: "DECRYPT_FAILED",
    })));
    return null;
  }
}
