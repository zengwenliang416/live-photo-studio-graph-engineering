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

export interface ObjectStoragePort {
  putObject(input: PutObjectRequest): Promise<StoredObject>;
  createSignedDownload(
    input: SignedObjectDownloadRequest,
  ): Promise<SignedObjectDownload>;
}

export class ObjectStorageUnavailableError extends Error {
  constructor(message = "Object storage is not configured.") {
    super(message);
    this.name = "ObjectStorageUnavailableError";
  }
}
