import type { ObjectStoragePort } from "@live-photo-studio/storage";
import {
  ProviderFailureError,
  type GeneratedCandidate,
  type ImageGenerationInput,
  type ImageGenerationProvider,
} from "./provider.js";

const MAX_REFERENCE_IMAGES = 6;
const FALLBACK_WIDTH = 1024;
const FALLBACK_HEIGHT = 1024;

export interface OpenAiCompatibleImageProviderOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly storage: ObjectStoragePort;
  readonly fetchImpl?: typeof fetch;
}

interface SniffedImage {
  readonly width: number;
  readonly height: number;
  readonly contentType: string;
  readonly extension: string;
}

/**
 * Speaks the OpenAI-compatible `POST /v1/images/edits` multipart contract.
 * The API key only ever lives in the Authorization header; prompts, keys and
 * raw response bodies never appear in thrown errors or logs (AGENTS.md §11).
 */
export class OpenAiCompatibleImageProvider implements ImageGenerationProvider {
  readonly name = "openai-compatible";
  readonly usesPromptPlan = true;
  readonly baseUrl: string;
  readonly model: string;

  constructor(private readonly options: OpenAiCompatibleImageProviderOptions) {
    this.baseUrl = options.baseUrl;
    this.model = options.model;
  }

  async generate(
    input: ImageGenerationInput,
  ): Promise<readonly GeneratedCandidate[]> {
    const form = new FormData();
    form.set("model", this.options.model);
    form.set("prompt", input.prompt);
    form.set("size", "1024x1024");
    for (const [index, image] of input.referenceImages
      .slice(0, MAX_REFERENCE_IMAGES)
      .entries()) {
      // Copy so the Blob never leaks a shared pool buffer beyond the view.
      const copy = new Uint8Array(image.bytes);
      form.append(
        "image[]",
        new Blob([copy.buffer as ArrayBuffer], {
          type: image.contentType,
        }),
        `reference-${index}`,
      );
    }

    const fetchImpl = this.options.fetchImpl ?? fetch;
    const endpoint = `${this.options.baseUrl.replace(/\/+$/u, "")}/v1/images/edits`;
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${this.options.apiKey}` },
        body: form,
      });
    } catch {
      throw new ProviderFailureError("MODEL_PROVIDER_UNAVAILABLE", true);
    }

    if (!response.ok) {
      throw await this.classifyHttpFailure(response);
    }

    const payload: unknown = await response.json().catch(() => undefined);
    const images = parseImageResponse(payload);
    if (images.length === 0) {
      throw new ProviderFailureError("MODEL_RESPONSE_INVALID", false);
    }

    const candidates: GeneratedCandidate[] = [];
    for (const [index, b64] of images.slice(0, input.count).entries()) {
      const bytes = decodeBase64(b64);
      if (!bytes) {
        throw new ProviderFailureError("MODEL_RESPONSE_INVALID", false);
      }
      const sniffed = sniffImage(bytes);
      const storageKey =
        `projects/${input.projectId}/generations/r${input.revision}/${index}.${sniffed.extension}`;
      await this.options.storage.putObject({
        objectKey: storageKey,
        body: bytes,
        contentType: sniffed.contentType,
      });
      candidates.push({
        storageKey,
        width: sniffed.width,
        height: sniffed.height,
      });
    }
    return candidates;
  }

  private async classifyHttpFailure(
    response: Response,
  ): Promise<ProviderFailureError> {
    if (response.status === 401 || response.status === 403) {
      return new ProviderFailureError("MODEL_AUTH_FAILED", false);
    }
    if (response.status === 429) {
      return new ProviderFailureError("MODEL_RATE_LIMITED", true);
    }
    if (response.status >= 500) {
      return new ProviderFailureError("MODEL_PROVIDER_UNAVAILABLE", true);
    }
    if (response.status === 400) {
      // The body is read only to classify moderation rejections; it is never
      // propagated into error messages or logs.
      const body = await response.text().catch(() => "");
      if (/\b(moderation|content_policy|blocked)\b/iu.test(body)) {
        return new ProviderFailureError("MODEL_CONTENT_BLOCKED", false);
      }
    }
    return new ProviderFailureError("MODEL_REQUEST_INVALID", false);
  }
}

function parseImageResponse(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const images: string[] = [];
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) {
      throw new ProviderFailureError("MODEL_RESPONSE_INVALID", false);
    }
    const record = entry as { b64_json?: unknown; url?: unknown };
    if (typeof record.b64_json === "string" && record.b64_json.length > 0) {
      images.push(record.b64_json);
      continue;
    }
    if (typeof record.url === "string") {
      // URL responses would require a second fetch with different auth and
      // retention semantics; this provider only supports b64_json output.
      throw new ProviderFailureError("MODEL_PROVIDER_UNCONFIGURED", false);
    }
    throw new ProviderFailureError("MODEL_RESPONSE_INVALID", false);
  }
  return images;
}

function decodeBase64(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/=\s]+$/u.test(value)) return null;
  try {
    return new Uint8Array(Buffer.from(value, "base64"));
  } catch {
    return null;
  }
}

function sniffImage(bytes: Uint8Array): SniffedImage {
  const png = sniffPng(bytes);
  if (png) {
    return { ...png, contentType: "image/png", extension: "png" };
  }
  const jpeg = sniffJpeg(bytes);
  if (jpeg) {
    return { ...jpeg, contentType: "image/jpeg", extension: "jpg" };
  }
  return {
    width: FALLBACK_WIDTH,
    height: FALLBACK_HEIGHT,
    contentType: "image/png",
    extension: "png",
  };
}

function sniffPng(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.byteLength < 24) return null;
  for (const [index, expected] of signature.entries()) {
    if (bytes[index] !== expected) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(12) !== 0x49484452) return null; // "IHDR"
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function sniffJpeg(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    // SOF0-15 hold the frame dimensions; C4/C8/CC are not SOF markers.
    const isSof =
      marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
}
