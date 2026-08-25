export interface UserImageProviderRow {
  readonly userId: string;
  readonly baseUrl: string;
  readonly apiKeyCiphertext: string;
  readonly model: string;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoredIdempotentResponse {
  readonly requestHash: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
}

export interface SettingsTx {
  upsertImageProvider(input: {
    userId: string;
    baseUrl: string;
    apiKeyCiphertext: string;
    model: string;
    enabled: boolean;
  }): Promise<UserImageProviderRow>;
  findImageProviderByUser(
    userId: string,
  ): Promise<UserImageProviderRow | null>;
  deleteImageProviderByUser(userId: string): Promise<void>;
  findIdempotentResponse(
    scope: string,
    idempotencyKey: string,
    userId: string,
  ): Promise<StoredIdempotentResponse | null>;
  recordIdempotentResponse(input: {
    scope: string;
    idempotencyKey: string;
    userId: string;
    requestHash: string;
    responseStatus: number;
    responseBody: unknown;
  }): Promise<void>;
}

/**
 * Thrown by infrastructure when a concurrent request inserted the same
 * idempotency record first (unique constraint race). The application service
 * retries once and then serves the stored response or a conflict.
 */
export class IdempotencyConflictError extends Error {
  constructor() {
    super("Concurrent idempotency record insertion detected.");
    this.name = "IdempotencyConflictError";
  }
}

export interface SettingsStorePort {
  transact<T>(work: (tx: SettingsTx) => Promise<T>): Promise<T>;
}
