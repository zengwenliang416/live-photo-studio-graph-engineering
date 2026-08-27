import type { ObjectStoragePort } from "@live-photo-studio/storage";
import type { ProjectPreviewSignerPort } from "../ports.js";

export class ObjectStorageProjectPreviewSigner
  implements ProjectPreviewSignerPort
{
  constructor(
    private readonly storage: ObjectStoragePort,
    private readonly ttlSeconds: number,
  ) {}

  sign(objectKey: string): Promise<{
    readonly url: string;
    readonly expiresAt: string;
  }> {
    return this.storage.createSignedDownload({
      objectKey,
      expiresInSeconds: this.ttlSeconds,
    });
  }
}
