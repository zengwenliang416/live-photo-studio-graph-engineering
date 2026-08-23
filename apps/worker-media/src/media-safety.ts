const MAX_PIXELS = 40_000_000;

export type MediaSafetyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string };

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function isHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const brand = String.fromCharCode(
    bytes[8] ?? 0,
    bytes[9] ?? 0,
    bytes[10] ?? 0,
    bytes[11] ?? 0,
  );
  return ["heic", "heix", "hevc", "hevx", "mif1"].includes(brand);
}

function magicMatches(mime: string, bytes: Uint8Array): boolean {
  if (mime === "image/jpeg") return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  if (mime === "image/png") {
    return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (mime === "image/heic" || mime === "image/heif") {
    return isHeif(bytes);
  }
  return false;
}

export function validateMediaInput(input: unknown): MediaSafetyResult {
  if (input === null || typeof input !== "object") {
    return { ok: false, code: "MEDIA_INPUT_INVALID" };
  }
  const record = input as Record<string, unknown>;
  const mime = record["declaredMime"];
  const bytes = record["bytes"];
  const width = record["width"];
  const height = record["height"];
  if (
    typeof mime !== "string" ||
    !(bytes instanceof Uint8Array) ||
    typeof width !== "number" ||
    typeof height !== "number"
  ) {
    return { ok: false, code: "MEDIA_INPUT_INVALID" };
  }
  if (!magicMatches(mime, bytes)) {
    return { ok: false, code: "MEDIA_MAGIC_MISMATCH" };
  }
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > MAX_PIXELS
  ) {
    return { ok: false, code: "MEDIA_PIXEL_LIMIT_EXCEEDED" };
  }
  return { ok: true };
}

export function stripSensitiveExif(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/gps|latitude|longitude|location|address/iu.test(key)) continue;
    output[key] = value;
  }
  return output;
}
