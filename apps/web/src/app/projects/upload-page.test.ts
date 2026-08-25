import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  advanceUploadItem,
  firstReadyAssetId,
  MAX_UPLOAD_BYTES,
  resolveContentType,
  sha256Hex,
  summarizeUploads,
  validateUploadFile,
  type UploadItem,
} from "../../lib/upload-flow.js";

const pageSource = readFileSync(
  new URL("./[projectId]/upload/page.tsx", import.meta.url),
  "utf8",
);
const styleSource = readFileSync(
  new URL("./[projectId]/upload/upload.module.css", import.meta.url),
  "utf8",
);

test("upload page never starts a workflow run itself", () => {
  assert.doesNotMatch(pageSource, /startWorkflowRun/u);
  assert.match(pageSource, /router\.push\(`\/projects\/\$\{projectId\}`\)/u);
});

test("upload page wires the intent, signed PUT and confirm pipeline", () => {
  assert.match(pageSource, /createUploadIntent/u);
  assert.match(pageSource, /uploadToSignedUrl/u);
  assert.match(pageSource, /confirmAsset/u);
  assert.match(pageSource, /sha256Hex/u);
  assert.match(pageSource, /setProjectCover/u);
  assert.doesNotMatch(pageSource, /\bfetch\(/u);
});

test("upload page keeps the explicit file status state machine", () => {
  assert.match(pageSource, /FileUploadStatus/u);
  assert.match(pageSource, /advanceUploadItem/u);
  assert.match(pageSource, /aria-live="polite"/u);
  assert.match(pageSource, /role="alert"/u);
  assert.match(pageSource, /重试/u);
  assert.match(pageSource, /设为封面/u);
  assert.match(pageSource, /开始生成/u);
});

test("upload page states the iOS importer boundary in Chinese", () => {
  assert.match(pageSource, /iOS 导入器/u);
  assert.match(pageSource, /不会把 Live Photo 直接保存到 iPhone 相册/u);
});

test("upload page file input accepts the supported formats", () => {
  assert.match(
    pageSource,
    /accept=\{ACCEPT_ATTRIBUTE\}/u,
  );
  assert.match(
    pageSource,
    /image\/jpeg,image\/png,image\/webp,\.heic,\.heif/u,
  );
  assert.match(pageSource, /multiple/u);
  assert.match(pageSource, /htmlFor="asset-files"/u);
});

test("upload page styles stay usable at 390px with 44px targets", () => {
  assert.match(styleSource, /@media \(max-width: 390px\)/u);
  assert.match(styleSource, /min-height: 44px/u);
  assert.match(styleSource, /grid-template-columns: 1fr/u);
  assert.match(styleSource, /:focus-visible/u);
});

test("validateUploadFile enforces the size limit", () => {
  assert.equal(
    validateUploadFile("a.jpg", MAX_UPLOAD_BYTES + 1, "image/jpeg"),
    "文件超过 20MiB 上限。",
  );
  assert.equal(validateUploadFile("a.jpg", MAX_UPLOAD_BYTES, "image/jpeg"), null);
  assert.equal(validateUploadFile("a.jpg", 0, "image/jpeg"), "文件内容为空。");
});

test("validateUploadFile rejects unsupported types", () => {
  assert.equal(
    validateUploadFile("a.gif", 10, "image/gif"),
    "仅支持 JPEG、PNG、WebP 或 HEIC 图片。",
  );
});

test("resolveContentType falls back to the extension for HEIC", () => {
  assert.equal(resolveContentType("photo.HEIC", ""), "image/heic");
  assert.equal(resolveContentType("photo.heif", ""), "image/heif");
  assert.equal(resolveContentType("photo.png", ""), "image/png");
  assert.equal(resolveContentType("photo.jpg", "image/jpeg"), "image/jpeg");
  assert.equal(resolveContentType("photo", ""), null);
});

test("advanceUploadItem keeps the asset id and scopes errors to failed", () => {
  const base: UploadItem = {
    key: "k1",
    fileName: "a.jpg",
    bytes: 10,
    status: "queued",
  };
  const intending = advanceUploadItem(base, "intending");
  assert.equal(intending.status, "intending");
  assert.equal(intending.assetId, undefined);

  const uploading = advanceUploadItem(intending, "uploading", {
    assetId: "asset-1",
  });
  const confirming = advanceUploadItem(uploading, "confirming");
  assert.equal(confirming.assetId, "asset-1");

  const ready = advanceUploadItem(confirming, "ready");
  assert.equal(ready.assetId, "asset-1");
  assert.equal(ready.errorMessage, undefined);

  const failed = advanceUploadItem(confirming, "failed", {
    errorMessage: "上传失败。",
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.assetId, "asset-1");
  assert.equal(failed.errorMessage, "上传失败。");

  const retried = advanceUploadItem(failed, "intending");
  assert.equal(retried.errorMessage, undefined);
  assert.equal(retried.assetId, "asset-1");
});

test("summarizeUploads and firstReadyAssetId derive the page summary", () => {
  const items: UploadItem[] = [
    { key: "1", fileName: "a.jpg", bytes: 1, status: "ready", assetId: "ra" },
    { key: "2", fileName: "b.jpg", bytes: 1, status: "uploading" },
    { key: "3", fileName: "c.jpg", bytes: 1, status: "failed" },
    { key: "4", fileName: "d.jpg", bytes: 1, status: "ready", assetId: "rb" },
  ];
  assert.deepEqual(summarizeUploads(items), {
    total: 4,
    ready: 2,
    failed: 1,
    active: 1,
  });
  assert.equal(firstReadyAssetId(items), "ra");
  assert.equal(firstReadyAssetId([]), null);
});

test("sha256Hex hashes to lowercase hex", async () => {
  const data = new TextEncoder().encode("abc").buffer as ArrayBuffer;
  assert.equal(
    await sha256Hex(data),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
