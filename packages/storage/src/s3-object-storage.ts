import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  ObjectStoragePort,
  PutObjectRequest,
  SignedObjectDownload,
  SignedObjectDownloadRequest,
  StoredObject,
} from "./ports.js";
import type { S3CompatibleObjectStorageConfig } from "./config.js";

const MAX_SIGNED_URL_TTL_SECONDS = 900;

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
    if (
      !Number.isInteger(input.expiresInSeconds) ||
      input.expiresInSeconds < 1 ||
      input.expiresInSeconds > MAX_SIGNED_URL_TTL_SECONDS
    ) {
      throw new Error("OBJECT_STORAGE_SIGNED_URL_TTL_INVALID");
    }
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
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
