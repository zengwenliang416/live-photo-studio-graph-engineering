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

export type UploadMediaKind = "PHOTO" | "LIVE_PHOTO_VIDEO";
export type LivePhotoPairStatus =
  | "waiting"
  | "pairing"
  | "paired"
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
  mediaKind?: UploadMediaKind;
  pairGroupKey?: string;
  pairStatus?: LivePhotoPairStatus;
  pairErrorMessage?: string;
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
  "video/quicktime",
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
  ".mov": "video/quicktime",
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
    return "仅支持 JPEG、PNG、WebP、HEIC 或 Live Photo 的 MOV 组件。";
  }
  return null;
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot).toLowerCase();
}

function stemOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return (dot === -1 ? fileName : fileName.slice(0, dot)).trim().toLowerCase();
}

export function prepareUploadItems(
  files: readonly {
    key: string;
    fileName: string;
    bytes: number;
    mimeType: string;
  }[],
  batchKey: string,
): UploadItem[] {
  const items = files.map((file): UploadItem => {
    const contentType = resolveContentType(file.fileName, file.mimeType);
    const problem = validateUploadFile(
      file.fileName,
      file.bytes,
      file.mimeType,
    );
    return {
      key: file.key,
      fileName: file.fileName,
      bytes: file.bytes,
      status: problem === null ? "queued" : "failed",
      mediaKind:
        contentType === "video/quicktime" ? "LIVE_PHOTO_VIDEO" : "PHOTO",
      ...(problem === null ? {} : { errorMessage: problem }),
    };
  });
  const photosByStem = new Map<string, UploadItem[]>();
  const videosByStem = new Map<string, UploadItem[]>();
  for (const item of items) {
    if (item.status === "failed") continue;
    const stem = stemOf(item.fileName);
    if (item.mediaKind === "LIVE_PHOTO_VIDEO") {
      const list = videosByStem.get(stem) ?? [];
      list.push(item);
      videosByStem.set(stem, list);
    } else if ([".heic", ".heif"].includes(extensionOf(item.fileName))) {
      const list = photosByStem.get(stem) ?? [];
      list.push(item);
      photosByStem.set(stem, list);
    }
  }
  for (const [stem, videos] of videosByStem) {
    const photos = photosByStem.get(stem) ?? [];
    for (let index = 0; index < videos.length; index += 1) {
      const video = videos[index];
      const photo = photos[index];
      if (!video) continue;
      if (!photo) {
        video.status = "failed";
        video.errorMessage = "MOV 需与同批选择的同名 HEIC/HEIF 一起上传。";
        continue;
      }
      const pairGroupKey = `${batchKey}:${stem}:${index}`;
      video.pairGroupKey = pairGroupKey;
      video.pairStatus = "waiting";
      photo.pairGroupKey = pairGroupKey;
      photo.pairStatus = "waiting";
    }
  }
  return items;
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
    pairStatus?: LivePhotoPairStatus;
    pairErrorMessage?: string;
  } = {},
): UploadItem {
  const next: UploadItem = { ...item, status };
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
  if (patch.pairStatus !== undefined) next.pairStatus = patch.pairStatus;
  if (patch.pairErrorMessage !== undefined) {
    next.pairErrorMessage = patch.pairErrorMessage;
  } else if (
    patch.pairStatus !== undefined &&
    patch.pairStatus !== "failed"
  ) {
    delete next.pairErrorMessage;
  }
  const errorMessage =
    patch.errorMessage ??
    (status === "failed" ? item.errorMessage : undefined);
  if (errorMessage !== undefined) next.errorMessage = errorMessage;
  else delete next.errorMessage;
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
  let total = 0;
  let ready = 0;
  let failed = 0;
  let active = 0;
  for (const item of items) {
    if (
      item.mediaKind === "LIVE_PHOTO_VIDEO" &&
      item.pairGroupKey !== undefined
    ) {
      continue;
    }
    total += 1;
    if (item.pairGroupKey !== undefined) {
      if (item.status === "failed" || item.pairStatus === "failed") failed += 1;
      else if (item.status === "ready" && item.pairStatus === "paired") {
        ready += 1;
      } else active += 1;
      continue;
    }
    if (item.status === "ready") ready += 1;
    else if (item.status === "failed") failed += 1;
    else active += 1;
  }
  return { total, ready, failed, active };
}

export function firstReadyAssetId(
  items: readonly UploadItem[],
): string | null {
  for (const item of items) {
    if (
      item.mediaKind !== "LIVE_PHOTO_VIDEO" &&
      item.status === "ready" &&
      item.assetId !== undefined &&
      (item.pairGroupKey === undefined || item.pairStatus === "paired")
    ) {
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
