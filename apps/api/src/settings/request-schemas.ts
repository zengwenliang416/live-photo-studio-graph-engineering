import { stylePresetPromptQuerySchema } from "@live-photo-studio/contracts";
import { z } from "zod";

export { stylePresetPromptQuerySchema };

export const upsertImageProviderRequestSchema = z
  .object({
    baseUrl: z.string().url().max(512),
    apiKey: z.string().min(8).max(256),
    model: z.string().min(1).max(128),
    enabled: z.boolean().optional().default(true),
  })
  .strict();
