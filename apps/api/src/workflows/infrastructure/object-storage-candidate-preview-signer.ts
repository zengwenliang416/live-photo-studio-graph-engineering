import type { ObjectStoragePort } from "@live-photo-studio/storage";
import type { WorkflowCandidatePreviewSignerPort } from "../ports.js";

export class ObjectStorageCandidatePreviewSigner
  implements WorkflowCandidatePreviewSignerPort
{
  constructor(
    private readonly storage: ObjectStoragePort,
    private readonly expiresInSeconds: number,
  ) {}

  sign(objectKey: string): Promise<{
    readonly url: string;
    readonly expiresAt: string;
  }> {
    return this.storage.createSignedDownload({
      objectKey,
      expiresInSeconds: this.expiresInSeconds,
    });
  }
}
