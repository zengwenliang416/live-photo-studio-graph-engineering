export type AssetStatus = "UPLOADING" | "READY" | "REJECTED";
export type ConfirmedAssetRole = "CONTENT" | "LIVE_PHOTO_VIDEO";

export interface LivePhotoPairRow {
  readonly id: string;
  readonly projectId: string;
  readonly photoAssetId: string;
  readonly videoAssetId: string;
  readonly status: "PAIRED";
  readonly createdAt: string;
}

export interface AssetRow {
  readonly id: string;
  readonly projectId: string;
  readonly userId: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly declaredBytes: number;
  /** Confirmed object size; null while the upload is still UPLOADING. */
  readonly bytes: number | null;
  readonly sha256: string | null;
  readonly status: AssetStatus;
  readonly createdAt: string;
}

export interface StoredIdempotentResponse {
  readonly requestHash: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
}

export interface AssetTx {
  /** Throws PROJECT_NOT_FOUND when the project is missing or foreign. */
  assertProjectOwner(projectId: string, userId: string): Promise<void>;
  insertAsset(input: {
    id: string;
    projectId: string;
    userId: string;
    objectKey: string;
    contentType: string;
    declaredBytes: number;
  }): Promise<void>;
  findAssetById(assetId: string): Promise<AssetRow | null>;
  /** Transitions UPLOADING → READY and registers its role atomically. */
  markAssetReady(
    assetId: string,
    bytes: number,
    sha256: string,
    role: ConfirmedAssetRole,
  ): Promise<boolean>;
  insertAssetPreviewRequest(input: {
    eventId: string;
    assetId: string;
    projectId: string;
  }): Promise<void>;
  /** Transitions UPLOADING → REJECTED; a no-op once the asset settled. */
  markAssetRejected(assetId: string): Promise<void>;
  /** Sets projects.cover_asset_id and registers the COVER role atomically. */
  setProjectCover(projectId: string, assetId: string): Promise<void>;
  insertLivePhotoPair(input: {
    id: string;
    projectId: string;
    photoAssetId: string;
    videoAssetId: string;
  }): Promise<LivePhotoPairRow>;
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

export interface AssetStorePort {
  transact<T>(work: (tx: AssetTx) => Promise<T>): Promise<T>;
}
