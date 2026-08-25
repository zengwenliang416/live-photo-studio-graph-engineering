import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryObjectStorage,
  loadObjectStorageEnvironment,
  S3ObjectStorage,
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

test("mock storage issues a signed upload and records the intent", async () => {
  const storage = new InMemoryObjectStorage();
  const signed = await storage.createSignedUpload({
    objectKey: "projects/project-1/assets/asset-1.jpg",
    contentType: "image/jpeg",
    expiresInSeconds: 300,
  });

  assert.equal(
    signed.url,
    "memory://upload/projects%2Fproject-1%2Fassets%2Fasset-1.jpg",
  );
  assert.deepEqual(signed.headers, { "content-type": "image/jpeg" });
  assert.ok(Date.parse(signed.expiresAt) > Date.now());
  assert.deepEqual(storage.uploadIntents, [
    {
      objectKey: "projects/project-1/assets/asset-1.jpg",
      contentType: "image/jpeg",
      expiresInSeconds: 300,
    },
  ]);
});

test("mock storage stats stored objects and reports misses as null", async () => {
  const storage = new InMemoryObjectStorage();
  const body = new TextEncoder().encode("image-bytes");
  await storage.putObject({
    objectKey: "projects/project-1/assets/asset-1.jpg",
    body,
    contentType: "image/jpeg",
  });

  const stat = await storage.statObject(
    "projects/project-1/assets/asset-1.jpg",
  );
  assert.deepEqual(stat, {
    objectKey: "projects/project-1/assets/asset-1.jpg",
    bytes: body.byteLength,
    contentType: "image/jpeg",
  });

  assert.equal(await storage.statObject("missing/key"), null);
});

test("mock storage reads an object prefix and rejects missing objects", async () => {
  const storage = new InMemoryObjectStorage();
  await storage.putObject({
    objectKey: "projects/project-1/assets/asset-1.jpg",
    body: new TextEncoder().encode("0123456789"),
    contentType: "image/jpeg",
  });

  const prefix = await storage.readObjectPrefix(
    "projects/project-1/assets/asset-1.jpg",
    4,
  );
  assert.equal(new TextDecoder().decode(prefix), "0123");

  // maxBytes beyond the object size returns the whole object.
  const full = await storage.readObjectPrefix(
    "projects/project-1/assets/asset-1.jpg",
    64,
  );
  assert.equal(new TextDecoder().decode(full), "0123456789");

  await assert.rejects(
    storage.readObjectPrefix("missing/key", 4),
    /OBJECT_STORAGE_NOT_FOUND/u,
  );
});

test("S3 signed upload and download share the TTL bound without network calls", async () => {
  const storage = new S3ObjectStorage({
    endpoint: "http://rustfs.internal:9000",
    region: "us-east-1",
    bucket: "live-photo-studio",
    accessKeyId: "server-access",
    secretAccessKey: "server-secret",
    forcePathStyle: true,
  });

  for (const expiresInSeconds of [0, 901, 1.5]) {
    await assert.rejects(
      storage.createSignedUpload({
        objectKey: "projects/project-1/assets/asset-1.jpg",
        contentType: "image/jpeg",
        expiresInSeconds,
      }),
      /OBJECT_STORAGE_SIGNED_URL_TTL_INVALID/u,
    );
    await assert.rejects(
      storage.createSignedDownload({
        objectKey: "projects/project-1/assets/asset-1.jpg",
        expiresInSeconds,
      }),
      /OBJECT_STORAGE_SIGNED_URL_TTL_INVALID/u,
    );
  }
});

test("S3 signed upload binds content-type into the signature", async () => {
  const storage = new S3ObjectStorage({
    endpoint: "http://rustfs.internal:9000",
    region: "us-east-1",
    bucket: "live-photo-studio",
    accessKeyId: "server-access",
    secretAccessKey: "server-secret",
    forcePathStyle: true,
  });

  // getSignedUrl signs locally with the given credentials; no request is sent.
  const signed = await storage.createSignedUpload({
    objectKey: "projects/project-1/assets/asset-1.jpg",
    contentType: "image/jpeg",
    expiresInSeconds: 300,
  });
  const url = new URL(signed.url);
  assert.equal(url.hostname, "rustfs.internal");
  assert.deepEqual(signed.headers, { "content-type": "image/jpeg" });
  assert.ok(Date.parse(signed.expiresAt) > Date.now());
});
