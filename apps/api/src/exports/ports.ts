export interface ExportPackageRecord {
  readonly id: string;
  readonly projectId: string;
  readonly objectKey: string;
  readonly sha256: string;
  readonly durationMs: number;
  readonly bytes: number;
  readonly createdAt: string;
}

export interface ExportPackageStorePort {
  getProjectOwnerId(projectId: string): Promise<string | null>;
  findLatest(projectId: string): Promise<ExportPackageRecord | null>;
}

export interface SignedDownloadRequest {
  readonly exportPackageId: string;
  readonly projectId: string;
  readonly objectKey: string;
  readonly expiresInSeconds: number;
}

export interface SignedDownload {
  readonly url: string;
  readonly expiresAt: string;
}

export interface SignedDownloadPort {
  createSignedDownload(input: SignedDownloadRequest): Promise<SignedDownload>;
}

export class SignedDownloadUnavailableError extends Error {
  constructor() {
    super("A signed download adapter is not configured.");
    this.name = "SignedDownloadUnavailableError";
  }
}
