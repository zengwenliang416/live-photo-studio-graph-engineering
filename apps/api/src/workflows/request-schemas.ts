import { z } from "zod";

export const startWorkflowRunRequestSchema = z
  .object({
    graphKey: z.string().min(1).max(100).default("live-photo-project"),
    graphVersion: z.string().min(1).max(20).default("v1"),
    input: z.record(z.unknown()).optional(),
  })
  .strict();

export const humanTaskDecisionRequestSchema = z
  .object({
    action: z.enum(["SELECT", "REGENERATE", "CANCEL"]),
    selectedOutputId: z.string().uuid().optional(),
    feedback: z.string().min(1).max(4000).optional(),
  })
  .strict();

export const cancelWorkflowRunRequestSchema = z
  .object({
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();
