import {
  IdempotencyConflictError,
  type SettingsStorePort,
  type SettingsTx,
  type StoredIdempotentResponse,
  type UserImageProviderRow,
} from "../ports.js";

function idempotencyRecordKey(
  scope: string,
  idempotencyKey: string,
  userId: string,
): string {
  return `${userId}::${scope}::${idempotencyKey}`;
}

/**
 * Mirrors the SQL semantics the application service relies on:
 * primary-key upsert on user_id and unique idempotency records.
 */
export class InMemorySettingsStore implements SettingsStorePort {
  readonly providers = new Map<string, UserImageProviderRow>();
  readonly idempotency = new Map<string, StoredIdempotentResponse>();

  seedProvider(row: UserImageProviderRow): void {
    this.providers.set(row.userId, row);
  }

  async transact<T>(work: (tx: SettingsTx) => Promise<T>): Promise<T> {
    return work(this.buildTx());
  }

  private buildTx(): SettingsTx {
    const state = this;
    return {
      async upsertImageProvider(input): Promise<UserImageProviderRow> {
        const existing = state.providers.get(input.userId);
        const row: UserImageProviderRow = {
          userId: input.userId,
          baseUrl: input.baseUrl,
          apiKeyCiphertext: input.apiKeyCiphertext,
          model: input.model,
          enabled: input.enabled,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        state.providers.set(row.userId, row);
        return row;
      },
      async findImageProviderByUser(userId) {
        return state.providers.get(userId) ?? null;
      },
      async deleteImageProviderByUser(userId): Promise<void> {
        state.providers.delete(userId);
      },
      async findIdempotentResponse(scope, key, userId) {
        return (
          state.idempotency.get(idempotencyRecordKey(scope, key, userId)) ??
          null
        );
      },
      async recordIdempotentResponse(input): Promise<void> {
        const recordKey = idempotencyRecordKey(
          input.scope,
          input.idempotencyKey,
          input.userId,
        );
        if (state.idempotency.has(recordKey)) {
          throw new IdempotencyConflictError();
        }
        state.idempotency.set(recordKey, {
          requestHash: input.requestHash,
          responseStatus: input.responseStatus,
          responseBody: input.responseBody,
        });
      },
    };
  }
}
