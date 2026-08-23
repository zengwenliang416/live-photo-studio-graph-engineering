import { createHash } from "node:crypto";
import type {
  ObjectStoragePort,
  PutObjectRequest,
  SignedObjectDownload,
  SignedObjectDownloadRequest,
  StoredObject,
} from "./ports.js";

export class InMemoryObjectStorage implements ObjectStoragePort {
  readonly objects = new Map<string, Uint8Array>();

  async putObject(input: PutObjectRequest): Promise<StoredObject> {
    const body = new Uint8Array(input.body);
    const sha256 = sha256Hex(body);
    if (input.sha256 && input.sha256 !== sha256) {
      throw new Error("OBJECT_STORAGE_HASH_MISMATCH");
    }
    this.objects.set(input.objectKey, body);
    return {
      objectKey: input.objectKey,
      bytes: body.byteLength,
      sha256,
    };
  }

  async createSignedDownload(
    input: SignedObjectDownloadRequest,
  ): Promise<SignedObjectDownload> {
    if (!this.objects.has(input.objectKey)) {
      throw new Error("OBJECT_NOT_FOUND");
    }
    const expiresAt = new Date(
      Date.now() + input.expiresInSeconds * 1000,
    ).toISOString();
    return {
      url: `https://object-storage.test/${encodeURIComponent(input.objectKey)}`,
      expiresAt,
    };
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
