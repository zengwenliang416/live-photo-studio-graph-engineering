import { z } from "zod";

const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export const stylePresetSourceSchema = z
  .object({
    project: z.literal("onepic-template-studio"),
    templateId: z.string().min(1),
    promptHash: sha256HexSchema,
    previewUrl: z.string().url().nullable(),
  })
  .strict();

export const stylePresetMetadataSchema = z
  .object({
    key: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    version: z.string().min(1),
    category: z.string().min(1),
    recommendedFor: z.string().min(1),
    recommendedMotion: z.string().min(1),
    colorPalette: z
      .tuple([z.string(), z.string(), z.string()])
      .readonly(),
    previewStyle: z.string().min(1),
    source: stylePresetSourceSchema.nullable(),
  })
  .strict();

export const stylePresetsResponseSchema = z
  .object({
    data: z
      .object({
        items: z.array(stylePresetMetadataSchema),
      })
      .strict(),
  })
  .strict();

export const stylePresetPromptQuerySchema = z
  .object({
    referenceImageCount: z.coerce.number().int().min(1).max(6).default(1),
  })
  .strict();

export const stylePresetPromptResponseSchema = z
  .object({
    data: z
      .object({
        preset: stylePresetMetadataSchema,
        prompt: z.string().min(1),
        promptVersion: z.string().min(1),
        promptHash: sha256HexSchema,
        referenceImageCount: z.number().int().min(1).max(6),
      })
      .strict(),
  })
  .strict();

export type StylePresetSource = z.infer<typeof stylePresetSourceSchema>;
export type StylePresetMetadata = z.infer<typeof stylePresetMetadataSchema>;
export type StylePresetsResponse = z.infer<typeof stylePresetsResponseSchema>;
export type StylePresetPromptQuery = z.infer<
  typeof stylePresetPromptQuerySchema
>;
export type StylePresetPromptResponse = z.infer<
  typeof stylePresetPromptResponseSchema
>;
