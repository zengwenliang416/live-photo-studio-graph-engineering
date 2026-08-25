import { z } from "zod";

export const createProjectRequestSchema = z
  .object({
    title: z.string().trim().max(120).optional().default(""),
  })
  .strict();

export const listProjectsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).optional(),
    cursor: z.string().max(512).optional(),
  })
  .strict();
