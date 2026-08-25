import type { Pool, PoolClient } from "pg";
import { withTransaction } from "@live-photo-studio/database";
import {
  IdempotencyConflictError,
  type SettingsStorePort,
  type SettingsTx,
  type StoredIdempotentResponse,
  type UserImageProviderRow,
} from "../ports.js";

function isUniqueViolation(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function mapProviderRow(row: Record<string, unknown>): UserImageProviderRow {
  return {
    userId: row["user_id"] as string,
    baseUrl: row["base_url"] as string,
    apiKeyCiphertext: row["api_key_ciphertext"] as string,
    model: row["model"] as string,
    enabled: row["enabled"] as boolean,
    createdAt: (row["created_at"] as Date).toISOString(),
    updatedAt: (row["updated_at"] as Date).toISOString(),
  };
}

export class PgSettingsStore implements SettingsStorePort {
  constructor(private readonly pool: Pool) {}

  async transact<T>(work: (tx: SettingsTx) => Promise<T>): Promise<T> {
    try {
      return await withTransaction(this.pool, (client) =>
        work(new PgSettingsTx(client)),
      );
    } catch (error) {
      // The idempotency primary key turns a concurrent duplicate request into
      // a typed retry signal; the application layer retries and replays.
      if (
        isUniqueViolation(error) &&
        String((error as { constraint?: unknown }).constraint ?? "").startsWith(
          "idempotency_keys_pkey",
        )
      ) {
        throw new IdempotencyConflictError();
      }
      throw error;
    }
  }
}

class PgSettingsTx implements SettingsTx {
  constructor(private readonly client: PoolClient) {}

  async upsertImageProvider(input: {
    userId: string;
    baseUrl: string;
    apiKeyCiphertext: string;
    model: string;
    enabled: boolean;
  }): Promise<UserImageProviderRow> {
    const result = await this.client.query<Record<string, unknown>>(
      `INSERT INTO user_image_providers (
         user_id, base_url, api_key_ciphertext, model, enabled
       ) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         base_url = EXCLUDED.base_url,
         api_key_ciphertext = EXCLUDED.api_key_ciphertext,
         model = EXCLUDED.model,
         enabled = EXCLUDED.enabled,
         updated_at = now()
       RETURNING user_id, base_url, api_key_ciphertext, model, enabled,
                 created_at, updated_at`,
      [
        input.userId,
        input.baseUrl,
        input.apiKeyCiphertext,
        input.model,
        input.enabled,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("user_image_providers upsert returned no row.");
    }
    return mapProviderRow(row);
  }

  async findImageProviderByUser(
    userId: string,
  ): Promise<UserImageProviderRow | null> {
    const result = await this.client.query<Record<string, unknown>>(
      `SELECT user_id, base_url, api_key_ciphertext, model, enabled,
              created_at, updated_at
         FROM user_image_providers
        WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    return row ? mapProviderRow(row) : null;
  }

  async deleteImageProviderByUser(userId: string): Promise<void> {
    await this.client.query(
      `DELETE FROM user_image_providers WHERE user_id = $1`,
      [userId],
    );
  }

  async findIdempotentResponse(
    scope: string,
    idempotencyKey: string,
    userId: string,
  ): Promise<StoredIdempotentResponse | null> {
    const result = await this.client.query<{
      request_hash: string;
      response_status: number;
      response_body: unknown;
    }>(
      `SELECT request_hash, response_status, response_body
         FROM idempotency_keys
        WHERE scope = $1 AND idempotency_key = $2 AND user_id = $3
        FOR UPDATE`,
      [scope, idempotencyKey, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      requestHash: row.request_hash,
      responseStatus: row.response_status,
      responseBody: row.response_body,
    };
  }

  async recordIdempotentResponse(input: {
    scope: string;
    idempotencyKey: string;
    userId: string;
    requestHash: string;
    responseStatus: number;
    responseBody: unknown;
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO idempotency_keys (
         scope, idempotency_key, user_id, request_hash,
         response_status, response_body
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        input.scope,
        input.idempotencyKey,
        input.userId,
        input.requestHash,
        input.responseStatus,
        JSON.stringify(input.responseBody),
      ],
    );
  }
}
