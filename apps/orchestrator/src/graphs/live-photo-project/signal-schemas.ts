import { z } from "zod";

export const generationSignalSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("GENERATION_BATCH_COMPLETED"),
    correlationId: z.string().min(1),
    outputIds: z.array(z.string().uuid()).min(1),
  }),
  z.object({
    type: z.literal("GENERATION_BATCH_FAILED"),
    correlationId: z.string().min(1),
    errorCode: z.string().min(1),
  }),
]);

export const anchorDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("SELECT"),
    selectedOutputId: z.string().uuid(),
    correlationId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("REGENERATE"),
    feedback: z.string().max(4000).optional(),
    correlationId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("CANCEL"),
    correlationId: z.string().uuid(),
  }),
]);

export const renderSignalSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("RENDER_JOB_COMPLETED"),
    correlationId: z.string().min(1),
    exportId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("RENDER_JOB_FAILED"),
    correlationId: z.string().min(1),
    errorCode: z.string().min(1),
  }),
]);
