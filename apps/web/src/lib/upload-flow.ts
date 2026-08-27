/**
 * Pure upload-flow helpers for the upload page. The page owns the File
 * objects and the API calls; everything here is deterministic and testable.
 */

export type FileUploadStatus =
  | "queued"
  | "intending"
  | "uploading"
  | "confirming"
  | "ready"
  | "failed";

export interface UploadItem {
  key: string;
  fileName: string;
  bytes: number;
  status: FileUploadStatus;
  assetId?: string;
  errorMessage?: string;
  previewUrl?: string | null;
  previewStatus?: "PROCESSING" | "READY" | "FAILED" | "UNAVAILABLE";
}

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_CONCURRENCY = 3;

export const UPLOAD_STATUS_LABELS: Readonly<Record<FileUploadStatus, string>> = {
  queued: "排队中",
  intending: "申请上传",
  uploading: "上传中",
  confirming: "校验中",
  ready: "已就绪",
  failed: "失败",
};

const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

// HEIC files often arrive with an empty MIME type, so the extension is the
// fallback signal — the server still verifies magic bytes on ingest.
const EXTENSION_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

export function resolveContentType(
  fileName: string,
  mimeType: string,
): string | null {
  const normalized = mimeType.trim().toLowerCase();
  if (ALLOWED_CONTENT_TYPES.has(normalized)) return normalized;
  const dot = fileName.lastIndexOf(".");
  if (dot === -1) return null;
  return EXTENSION_CONTENT_TYPES[fileName.slice(dot).toLowerCase()] ?? null;
}

/** Returns a Chinese validation message, or null when the file is acceptable. */
export function validateUploadFile(
  fileName: string,
  bytes: number,
  mimeType: string,
): string | null {
  if (bytes <= 0) return "文件内容为空。";
  if (bytes > MAX_UPLOAD_BYTES) return "文件超过 20MiB 上限。";
  if (resolveContentType(fileName, mimeType) === null) {
    return "仅支持 JPEG、PNG、WebP 或 HEIC 图片。";
  }
  return null;
}

/**
 * Advances an item to a new status. The asset id, once known, is sticky;
 * the error message is kept only on the failed status.
 */
export function advanceUploadItem(
  item: UploadItem,
  status: FileUploadStatus,
  patch: {
    assetId?: string;
    errorMessage?: string;
    previewUrl?: string | null;
    previewStatus?: "PROCESSING" | "READY" | "FAILED" | "UNAVAILABLE";
  } = {},
): UploadItem {
  const next: UploadItem = {
    key: item.key,
    fileName: item.fileName,
    bytes: item.bytes,
    status,
  };
  const assetId = patch.assetId ?? item.assetId;
  if (assetId !== undefined) next.assetId = assetId;
  const previewUrl =
    "previewUrl" in patch ? patch.previewUrl : item.previewUrl;
  if (previewUrl !== undefined) next.previewUrl = previewUrl;
  const previewStatus =
    "previewStatus" in patch ? patch.previewStatus : item.previewStatus;
  if (previewStatus !== undefined) {
    next.previewStatus = previewStatus;
  }
  const errorMessage =
    patch.errorMessage ??
    (status === "failed" ? item.errorMessage : undefined);
  if (errorMessage !== undefined) next.errorMessage = errorMessage;
  return next;
}

export interface UploadSummary {
  readonly total: number;
  readonly ready: number;
  readonly failed: number;
  readonly active: number;
}

export function summarizeUploads(
  items: readonly UploadItem[],
): UploadSummary {
  let ready = 0;
  let failed = 0;
  let active = 0;
  for (const item of items) {
    if (item.status === "ready") ready += 1;
    else if (item.status === "failed") failed += 1;
    else active += 1;
  }
  return { total: items.length, ready, failed, active };
}

export function firstReadyAssetId(
  items: readonly UploadItem[],
): string | null {
  for (const item of items) {
    if (item.status === "ready" && item.assetId !== undefined) {
      return item.assetId;
    }
  }
  return null;
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
