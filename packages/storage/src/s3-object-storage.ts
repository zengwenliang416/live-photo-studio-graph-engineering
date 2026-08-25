import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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
import type { S3CompatibleObjectStorageConfig } from "./config.js";

const MAX_SIGNED_URL_TTL_SECONDS = 900;

function assertSignedUrlTtl(expiresInSeconds: number): void {
  if (
    !Number.isInteger(expiresInSeconds) ||
    expiresInSeconds < 1 ||
    expiresInSeconds > MAX_SIGNED_URL_TTL_SECONDS
  ) {
    throw new Error("OBJECT_STORAGE_SIGNED_URL_TTL_INVALID");
  }
}

function isObjectMissingError(error: unknown): boolean {
  if (error instanceof NotFound) return true;
  if (error instanceof S3ServiceException) {
    return (
      error.name === "NoSuchKey" ||
      error.name === "NotFound" ||
      error.$metadata.httpStatusCode === 404
    );
  }
  return false;
}

export class S3ObjectStorage implements ObjectStoragePort {
  private readonly client: S3Client;

  constructor(private readonly config: S3CompatibleObjectStorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async putObject(input: PutObjectRequest): Promise<StoredObject> {
    const body = Buffer.from(input.body);
    const sha256 = input.sha256 ?? sha256Hex(body);
    if (input.sha256 && input.sha256 !== sha256Hex(body)) {
      throw new Error("OBJECT_STORAGE_HASH_MISMATCH");
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.objectKey,
        Body: body,
        ContentLength: body.byteLength,
        ContentType: input.contentType,
        ...(input.contentDisposition
          ? { ContentDisposition: input.contentDisposition }
          : {}),
        Metadata: { sha256 },
      }),
    );
    return {
      objectKey: input.objectKey,
      bytes: body.byteLength,
      sha256,
    };
  }

  async createSignedDownload(
    input: SignedObjectDownloadRequest,
  ): Promise<SignedObjectDownload> {
    assertSignedUrlTtl(input.expiresInSeconds);
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: input.objectKey,
      }),
      { expiresIn: input.expiresInSeconds },
    );
    return {
      url,
      expiresAt: new Date(
        Date.now() + input.expiresInSeconds * 1000,
      ).toISOString(),
    };
  }

  async createSignedUpload(
    input: SignedObjectUploadRequest,
  ): Promise<SignedObjectUpload> {
    assertSignedUrlTtl(input.expiresInSeconds);
    // ContentType is part of the signature so the client PUT is bound to it.
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: input.objectKey,
        ContentType: input.contentType,
      }),
      { expiresIn: input.expiresInSeconds },
    );
    return {
      url,
      expiresAt: new Date(
        Date.now() + input.expiresInSeconds * 1000,
      ).toISOString(),
      headers: { "content-type": input.contentType },
    };
  }

  async statObject(objectKey: string): Promise<ObjectStat | null> {
    try {
      const output = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: objectKey,
        }),
      );
      if (output.ContentLength === undefined) {
        throw new Error("OBJECT_STORAGE_STAT_MISSING_LENGTH");
      }
      return {
        objectKey,
        bytes: output.ContentLength,
        ...(output.ContentType ? { contentType: output.ContentType } : {}),
      };
    } catch (error) {
      if (isObjectMissingError(error)) return null;
      throw error;
    }
  }

  async readObjectPrefix(
    objectKey: string,
    maxBytes: number,
  ): Promise<Uint8Array> {
    if (!Number.isInteger(maxBytes) || maxBytes < 1) {
      throw new Error("OBJECT_STORAGE_PREFIX_BYTES_INVALID");
    }
    let output;
    try {
      output = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: objectKey,
          Range: `bytes=0-${maxBytes - 1}`,
        }),
      );
    } catch (error) {
      if (isObjectMissingError(error)) {
        throw new Error("OBJECT_STORAGE_NOT_FOUND");
      }
      throw error;
    }
    if (!output.Body) {
      throw new Error("OBJECT_STORAGE_NOT_FOUND");
    }
    return output.Body.transformToByteArray();
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
