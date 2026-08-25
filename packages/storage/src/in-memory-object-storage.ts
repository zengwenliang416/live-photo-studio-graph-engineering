import { createHash } from "node:crypto";
import { GET_OBJECT_MAX_BYTES } from "./ports.js";
import type {
  ObjectStat,
  ObjectStoragePort,
  PutObjectRequest,
  SignedObjectDownload,
  SignedObjectDownloadRequest,
  SignedObjectUpload,
  SignedObjectUploadRequest,
  StoredObject,
} from "./ports.js";

export class InMemoryObjectStorage implements ObjectStoragePort {
  readonly objects = new Map<string, Uint8Array>();
  readonly contentTypes = new Map<string, string>();
  // Recorded signed-upload intents so tests can assert what was requested.
  readonly uploadIntents: SignedObjectUploadRequest[] = [];

  async putObject(input: PutObjectRequest): Promise<StoredObject> {
    const body = new Uint8Array(input.body);
    const sha256 = sha256Hex(body);
    if (input.sha256 && input.sha256 !== sha256) {
      throw new Error("OBJECT_STORAGE_HASH_MISMATCH");
    }
    this.objects.set(input.objectKey, body);
    this.contentTypes.set(input.objectKey, input.contentType);
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

  async createSignedUpload(
    input: SignedObjectUploadRequest,
  ): Promise<SignedObjectUpload> {
    this.uploadIntents.push(input);
    return {
      url: `memory://upload/${encodeURIComponent(input.objectKey)}`,
      expiresAt: new Date(
        Date.now() + input.expiresInSeconds * 1000,
      ).toISOString(),
      headers: { "content-type": input.contentType },
    };
  }

  async statObject(objectKey: string): Promise<ObjectStat | null> {
    const body = this.objects.get(objectKey);
    if (!body) return null;
    const contentType = this.contentTypes.get(objectKey);
    return {
      objectKey,
      bytes: body.byteLength,
      ...(contentType ? { contentType } : {}),
    };
  }

  async readObjectPrefix(
    objectKey: string,
    maxBytes: number,
  ): Promise<Uint8Array> {
    const body = this.objects.get(objectKey);
    if (!body) {
      throw new Error("OBJECT_STORAGE_NOT_FOUND");
    }
    return body.subarray(0, Math.min(maxBytes, body.byteLength));
  }

  async getObject(objectKey: string): Promise<Uint8Array> {
    const body = this.objects.get(objectKey);
    if (!body) {
      throw new Error("OBJECT_STORAGE_NOT_FOUND");
    }
    if (body.byteLength > GET_OBJECT_MAX_BYTES) {
      throw new Error("OBJECT_STORAGE_TOO_LARGE");
    }
    return new Uint8Array(body);
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
