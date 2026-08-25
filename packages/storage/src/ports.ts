export interface PutObjectRequest {
  readonly objectKey: string;
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly contentDisposition?: string;
  readonly sha256?: string;
}

export interface StoredObject {
  readonly objectKey: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface SignedObjectDownloadRequest {
  readonly objectKey: string;
  readonly expiresInSeconds: number;
}

export interface SignedObjectDownload {
  readonly url: string;
  readonly expiresAt: string;
}

export interface SignedObjectUploadRequest {
  readonly objectKey: string;
  readonly contentType: string;
  readonly expiresInSeconds: number;
}

export interface SignedObjectUpload {
  readonly url: string;
  readonly expiresAt: string;
  // Headers the client must send on the PUT (at minimum content-type).
  readonly headers: Record<string, string>;
}

export interface ObjectStat {
  readonly objectKey: string;
  readonly bytes: number;
  readonly contentType?: string;
}

export interface ObjectStoragePort {
  putObject(input: PutObjectRequest): Promise<StoredObject>;
  createSignedDownload(
    input: SignedObjectDownloadRequest,
  ): Promise<SignedObjectDownload>;
  createSignedUpload(
    input: SignedObjectUploadRequest,
  ): Promise<SignedObjectUpload>;
  statObject(objectKey: string): Promise<ObjectStat | null>;
  readObjectPrefix(objectKey: string, maxBytes: number): Promise<Uint8Array>;
  getObject(objectKey: string): Promise<Uint8Array>;
}

// Upper bound for full-object reads so a model-input fetch cannot buffer an
// unbounded object into worker memory.
export const GET_OBJECT_MAX_BYTES = 25 * 1024 * 1024;

export class ObjectStorageUnavailableError extends Error {
  constructor(message = "Object storage is not configured.") {
    super(message);
    this.name = "ObjectStorageUnavailableError";
  }
}
