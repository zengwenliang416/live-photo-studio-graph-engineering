import { z } from "zod";

export const UPLOAD_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "video/quicktime",
] as const;

export const uploadIntentRequestSchema = z
  .object({
    contentType: z.enum(UPLOAD_CONTENT_TYPES),
    bytes: z.number().int().positive(),
  })
  .strict();

export const confirmUploadRequestSchema = z
  .object({
    bytes: z.number().int().positive(),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/u, "sha256 must be 64 lowercase hex characters."),
  })
  .strict();

export const setProjectCoverRequestSchema = z
  .object({
    assetId: z.string().uuid(),
  })
  .strict();

export const createLivePhotoPairRequestSchema = z
  .object({
    photoAssetId: z.string().uuid(),
    videoAssetId: z.string().uuid(),
  })
  .strict();
