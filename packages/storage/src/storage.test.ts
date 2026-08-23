import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryObjectStorage,
  loadObjectStorageEnvironment,
  toS3CompatibleConfig,
} from "./index.js";

test("mock storage keeps bytes private and returns a bounded fake grant", async () => {
  const storage = new InMemoryObjectStorage();
  const body = new TextEncoder().encode("private-package");
  const stored = await storage.putObject({
    objectKey: "projects/project-1/exports/job-1/package.zip",
    body,
    contentType: "application/zip",
  });

  assert.equal(stored.bytes, body.byteLength);
  assert.equal(storage.objects.get(stored.objectKey)?.byteLength, body.byteLength);

  const signed = await storage.createSignedDownload({
    objectKey: stored.objectKey,
    expiresInSeconds: 300,
  });
  assert.match(signed.url, /^https:\/\/object-storage\.test\//u);
  assert.ok(Date.parse(signed.expiresAt) > Date.now());
});

test("mock storage rejects a caller-provided hash that does not match the bytes", async () => {
  const storage = new InMemoryObjectStorage();
  await assert.rejects(
    storage.putObject({
      objectKey: "projects/project-1/exports/job-1/package.zip",
      body: new TextEncoder().encode("private-package"),
      contentType: "application/zip",
      sha256: "0".repeat(64),
    }),
    /OBJECT_STORAGE_HASH_MISMATCH/u,
  );
});

test("S3 configuration requires endpoint, bucket and server-side credentials", () => {
  const mockEnvironment = loadObjectStorageEnvironment({
    OBJECT_STORAGE_BACKEND: "mock",
    OBJECT_STORAGE_ACCESS_KEY_ID: "",
    OBJECT_STORAGE_SECRET_ACCESS_KEY: "",
  });
  assert.equal(mockEnvironment.OBJECT_STORAGE_BACKEND, "mock");

  assert.throws(
    () =>
      loadObjectStorageEnvironment({
        OBJECT_STORAGE_BACKEND: "s3",
      }),
    /OBJECT_STORAGE_ENDPOINT/u,
  );

  const environment = loadObjectStorageEnvironment({
    OBJECT_STORAGE_BACKEND: "s3",
    OBJECT_STORAGE_ENDPOINT: "http://rustfs.internal:9000",
    OBJECT_STORAGE_BUCKET: "live-photo-studio",
    OBJECT_STORAGE_ACCESS_KEY_ID: "server-access",
    OBJECT_STORAGE_SECRET_ACCESS_KEY: "server-secret",
    OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS: "300",
  });
  assert.deepEqual(toS3CompatibleConfig(environment), {
    endpoint: "http://rustfs.internal:9000",
    region: "us-east-1",
    bucket: "live-photo-studio",
    accessKeyId: "server-access",
    secretAccessKey: "server-secret",
    forcePathStyle: true,
  });
});
