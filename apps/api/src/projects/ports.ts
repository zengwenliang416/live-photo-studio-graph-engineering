/**
 * Opaque pagination cursor over the (created_at, id) sort key, transported as
 * base64url-encoded JSON so clients treat it as an opaque string.
 */
export interface ProjectCursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface ProjectRow {
  readonly id: string;
  readonly userId: string;
  readonly title: string;
  readonly coverAssetId: string | null;
  readonly createdAt: string;
}

export interface ProjectAssetRow {
  readonly id: string;
  readonly contentType: string;
  /** Confirmed object size; null while the upload is still UPLOADING. */
  readonly bytes: number | null;
  readonly status: "UPLOADING" | "READY" | "REJECTED" | string;
  readonly createdAt: string;
  readonly previewObjectKey: string | null;
  readonly previewStatus:
    | "QUEUED"
    | "RUNNING"
    | "SUCCEEDED"
    | "FAILED"
    | null;
}

export interface ProjectLivePhotoPairRow {
  readonly id: string;
  readonly photoAssetId: string;
  readonly videoAssetId: string;
  readonly status: "PAIRED";
  readonly createdAt: string;
}

export interface ProjectPreviewSignerPort {
  sign(objectKey: string): Promise<{
    readonly url: string;
    readonly expiresAt: string;
  }>;
}

export interface StoredIdempotentResponse {
  readonly requestHash: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
}

export interface ProjectTx {
  insertProject(input: {
    id: string;
    userId: string;
    title: string;
  }): Promise<ProjectRow>;
  findProjectById(projectId: string): Promise<ProjectRow | null>;
  /**
   * Returns at most `limit` rows ordered by created_at DESC, id DESC. Callers
   * request limit + 1 and slice to detect whether another page exists.
   */
  listProjectsByUser(input: {
    userId: string;
    limit: number;
    cursor: ProjectCursor | null;
  }): Promise<readonly ProjectRow[]>;
  listAssetsByProject(projectId: string): Promise<readonly ProjectAssetRow[]>;
  listLivePhotoPairsByProject(
    projectId: string,
  ): Promise<readonly ProjectLivePhotoPairRow[]>;
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

export interface ProjectStorePort {
  transact<T>(work: (tx: ProjectTx) => Promise<T>): Promise<T>;
}

export function encodeProjectCursor(cursor: ProjectCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}
