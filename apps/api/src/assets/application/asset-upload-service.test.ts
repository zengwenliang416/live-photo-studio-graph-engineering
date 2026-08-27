import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { InMemoryObjectStorage } from "@live-photo-studio/storage";
import { ApplicationProblemError } from "../../http/problem-details.js";
import { InMemoryAssetStore } from "../testing/in-memory-asset-store.js";
import {
  AssetUploadService,
  type UseCaseResult,
} from "./asset-upload-service.js";

const USER = "contract-user";
const OTHER_USER = "someone-else";
const PROJECT_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const KEY = "idem-key-0000000001";

function setup(input?: { uploadMaxBytes?: number }) {
  const store = new InMemoryAssetStore();
  store.seedProject(PROJECT_ID, USER);
  const storage = new InMemoryObjectStorage();
  const service = new AssetUploadService(store, storage, {
    uploadMaxBytes: input?.uploadMaxBytes ?? 1024,
    signedUploadTtlSeconds: 300,
  });
  return { store, storage, service };
}

function jpegBytes(total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
}

function heicBytes(total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  bytes.set([0x00, 0x00, 0x00, 0x18], 0);
  bytes.set(Buffer.from("ftyp", "ascii"), 4);
  bytes.set(Buffer.from("heic", "ascii"), 8);
  return bytes;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assetIdOf(result: UseCaseResult): string {
  return (result.body as { data: { assetId: string } }).data.assetId;
}

async function expectProblem(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApplicationProblemError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

test("upload intent inserts an UPLOADING asset and signs outside the transaction", async () => {
  const { store, storage, service } = setup();
  const result = await service.createUploadIntent({
    projectId: PROJECT_ID,
    userId: USER,
    idempotencyKey: KEY,
    body: { contentType: "image/jpeg", bytes: 128 },
  });
  assert.equal(result.status, 201);
  const data = (result.body as {
    data: {
      assetId: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
      expiresAt: string;
    };
  }).data;
  const asset = store.assets.get(data.assetId);
  assert.ok(asset);
  assert.equal(asset.status, "UPLOADING");
  assert.equal(asset.declaredBytes, 128);
  assert.equal(
    asset.objectKey,
    `projects/${PROJECT_ID}/originals/${data.assetId}`,
  );
  const intent = storage.uploadIntents[0];
  assert.ok(intent);
  assert.equal(intent.objectKey, asset.objectKey);
  assert.equal(intent.contentType, "image/jpeg");
  assert.equal(intent.expiresInSeconds, 300);
  assert.equal(data.uploadHeaders["content-type"], "image/jpeg");
});

test("upload intent rejects oversize declarations and foreign projects", async () => {
  const { service } = setup({ uploadMaxBytes: 100 });
  await expectProblem(
    service.createUploadIntent({
      projectId: PROJECT_ID,
      userId: USER,
      idempotencyKey: KEY,
      body: { contentType: "image/png", bytes: 101 },
    }),
    422,
    "UPLOAD_TOO_LARGE",
  );
  await expectProblem(
    service.createUploadIntent({
      projectId: PROJECT_ID,
      userId: OTHER_USER,
      idempotencyKey: KEY,
      body: { contentType: "image/png", bytes: 10 },
    }),
    404,
    "PROJECT_NOT_FOUND",
  );
  await expectProblem(
    service.createUploadIntent({
      projectId: "00000000-0000-4000-8000-0000000000ff",
      userId: USER,
      idempotencyKey: KEY,
      body: { contentType: "image/png", bytes: 10 },
    }),
    404,
    "PROJECT_NOT_FOUND",
  );
});

test("upload intent replay returns the same asset and re-mints the URL", async () => {
  const { store, storage, service } = setup();
  const first = await service.createUploadIntent({
    projectId: PROJECT_ID,
    userId: USER,
    idempotencyKey: KEY,
    body: { contentType: "image/webp", bytes: 64 },
  });
  const replay = await service.createUploadIntent({
    projectId: PROJECT_ID,
    userId: USER,
    idempotencyKey: KEY,
    body: { contentType: "image/webp", bytes: 64 },
  });
  assert.equal(assetIdOf(replay), assetIdOf(first));
  assert.equal(store.assets.size, 1);
  assert.equal(storage.uploadIntents.length, 2);
  await expectProblem(
    service.createUploadIntent({
      projectId: PROJECT_ID,
      userId: USER,
      idempotencyKey: KEY,
      body: { contentType: "image/webp", bytes: 65 },
    }),
    409,
    "IDEMPOTENCY_KEY_REUSED",
  );
});

async function seedUploadedAsset(
  contentType: "image/jpeg" | "image/heic" = "image/jpeg",
  bytes: Uint8Array = jpegBytes(128),
) {
  const context = setup();
  const intent = await context.service.createUploadIntent({
    projectId: PROJECT_ID,
    userId: USER,
    idempotencyKey: `${KEY}-intent`,
    body: { contentType, bytes: bytes.byteLength },
  });
  const assetId = assetIdOf(intent);
  const asset = context.store.assets.get(assetId);
  assert.ok(asset);
  await context.storage.putObject({
    objectKey: asset.objectKey,
    body: bytes,
    contentType,
  });
  return { ...context, assetId, asset, bytes };
}

test("confirm verifies the object and marks the asset READY with CONTENT role", async () => {
  const { store, service, assetId, bytes } = await seedUploadedAsset();
  const result = await service.confirmUpload({
    assetId,
    userId: USER,
    idempotencyKey: KEY,
    body: { bytes: bytes.byteLength, sha256: sha256Hex(bytes) },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { data: { assetId, status: "READY" } });
  const asset = store.assets.get(assetId);
  assert.equal(asset?.status, "READY");
  assert.equal(asset?.bytes, bytes.byteLength);
  assert.deepEqual(store.rolesOf(assetId), ["CONTENT"]);
  assert.deepEqual(
    store.previewRequests.map((request) => ({
      assetId: request.assetId,
      projectId: request.projectId,
    })),
    [{ assetId, projectId: PROJECT_ID }],
  );
});

test("confirm recognizes HEIC ftyp brands", async () => {
  const bytes = heicBytes(64);
  const { store, service, assetId } = await seedUploadedAsset(
    "image/heic",
    bytes,
  );
  const result = await service.confirmUpload({
    assetId,
    userId: USER,
    idempotencyKey: KEY,
    body: { bytes: bytes.byteLength, sha256: sha256Hex(bytes) },
  });
  assert.equal(result.status, 200);
  assert.equal(store.assets.get(assetId)?.status, "READY");
});

test("confirm reports missing objects and size mismatches", async () => {
  const missing = setup();
  const intent = await missing.service.createUploadIntent({
    projectId: PROJECT_ID,
    userId: USER,
    idempotencyKey: `${KEY}-intent`,
    body: { contentType: "image/jpeg", bytes: 32 },
  });
  await expectProblem(
    missing.service.confirmUpload({
      assetId: assetIdOf(intent),
      userId: USER,
      idempotencyKey: KEY,
      body: { bytes: 32, sha256: "0".repeat(64) },
    }),
    409,
    "ASSET_OBJECT_MISSING",
  );

  const mismatch = await seedUploadedAsset("image/jpeg", jpegBytes(48));
  await expectProblem(
    mismatch.service.confirmUpload({
      assetId: mismatch.assetId,
      userId: USER,
      idempotencyKey: KEY,
      body: { bytes: 47, sha256: "0".repeat(64) },
    }),
    422,
    "ASSET_SIZE_MISMATCH",
  );
});

test("confirm rejects content mismatches and settles the asset as REJECTED", async () => {
  // Declared image/png but the stored bytes are a JPEG.
  const bytes = jpegBytes(64);
  const { store, service, assetId, asset } = await (async () => {
    const context = setup();
    const intent = await context.service.createUploadIntent({
      projectId: PROJECT_ID,
      userId: USER,
      idempotencyKey: `${KEY}-intent`,
      body: { contentType: "image/png", bytes: bytes.byteLength },
    });
    const id = assetIdOf(intent);
    const row = context.store.assets.get(id);
    assert.ok(row);
    await context.storage.putObject({
      objectKey: row.objectKey,
      body: bytes,
      contentType: "image/png",
    });
    return { ...context, assetId: id, asset: row };
  })();
  assert.ok(asset);
  await expectProblem(
    service.confirmUpload({
      assetId,
      userId: USER,
      idempotencyKey: KEY,
      body: { bytes: bytes.byteLength, sha256: sha256Hex(bytes) },
    }),
    422,
    "ASSET_CONTENT_MISMATCH",
  );
  assert.equal(store.assets.get(assetId)?.status, "REJECTED");
  // Success-only idempotency recording: the replay recomputes and the settled
  // asset now deterministically answers ASSET_REJECTED.
  await expectProblem(
    service.confirmUpload({
      assetId,
      userId: USER,
      idempotencyKey: KEY,
      body: { bytes: bytes.byteLength, sha256: sha256Hex(bytes) },
    }),
    409,
    "ASSET_REJECTED",
  );
});

test("confirm hides foreign assets and replays recorded responses", async () => {
  const { service, assetId, bytes } = await seedUploadedAsset();
  await expectProblem(
    service.confirmUpload({
      assetId,
      userId: OTHER_USER,
      idempotencyKey: KEY,
      body: { bytes: bytes.byteLength, sha256: sha256Hex(bytes) },
    }),
    404,
    "ASSET_NOT_FOUND",
  );

  const sha = sha256Hex(bytes);
  const first = await service.confirmUpload({
    assetId,
    userId: USER,
    idempotencyKey: KEY,
    body: { bytes: bytes.byteLength, sha256: sha },
  });
  const replay = await service.confirmUpload({
    assetId,
    userId: USER,
    idempotencyKey: KEY,
    body: { bytes: bytes.byteLength, sha256: sha },
  });
  assert.deepEqual(replay.body, first.body);
  await expectProblem(
    service.confirmUpload({
      assetId,
      userId: USER,
      idempotencyKey: `${KEY}-other`,
      body: { bytes: bytes.byteLength, sha256: sha },
    }),
    409,
    "ASSET_ALREADY_CONFIRMED",
  );
});

test("cover requires an owned project and a READY asset", async () => {
  const { store, service, assetId, bytes } = await seedUploadedAsset();
  await expectProblem(
    service.setProjectCover({
      projectId: PROJECT_ID,
      userId: OTHER_USER,
      idempotencyKey: KEY,
      body: { assetId },
    }),
    404,
    "PROJECT_NOT_FOUND",
  );
  await expectProblem(
    service.setProjectCover({
      projectId: PROJECT_ID,
      userId: USER,
      idempotencyKey: KEY,
      body: { assetId },
    }),
    422,
    "ASSET_NOT_READY",
  );
  await expectProblem(
    service.setProjectCover({
      projectId: PROJECT_ID,
      userId: USER,
      idempotencyKey: KEY,
      body: { assetId: "00000000-0000-4000-8000-0000000000ee" },
    }),
    404,
    "ASSET_NOT_FOUND",
  );

  await service.confirmUpload({
    assetId,
    userId: USER,
    idempotencyKey: `${KEY}-confirm`,
    body: { bytes: bytes.byteLength, sha256: sha256Hex(bytes) },
  });
  const result = await service.setProjectCover({
    projectId: PROJECT_ID,
    userId: USER,
    idempotencyKey: KEY,
    body: { assetId },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    data: { projectId: PROJECT_ID, coverAssetId: assetId },
  });
  assert.equal(store.covers.get(PROJECT_ID), assetId);
  assert.deepEqual(store.rolesOf(assetId), ["CONTENT", "COVER"]);

  const replay = await service.setProjectCover({
    projectId: PROJECT_ID,
    userId: USER,
    idempotencyKey: KEY,
    body: { assetId },
  });
  assert.deepEqual(replay.body, result.body);
});
