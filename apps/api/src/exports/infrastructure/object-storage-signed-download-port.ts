import type { ObjectStoragePort } from "@live-photo-studio/storage";
import type {
  SignedDownload,
  SignedDownloadPort,
  SignedDownloadRequest,
} from "../ports.js";

export class ObjectStorageSignedDownloadPort implements SignedDownloadPort {
  constructor(private readonly storage: ObjectStoragePort) {}

  async createSignedDownload(
    input: SignedDownloadRequest,
  ): Promise<SignedDownload> {
    return this.storage.createSignedDownload({
      objectKey: input.objectKey,
      expiresInSeconds: input.expiresInSeconds,
    });
  }
}
