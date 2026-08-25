import { z } from "zod";
import { workflowExecutionMetadataSchema } from "./observability.js";

export const generationRequestedPayloadSchema = z.object({
  jobId: z.string().uuid(),
  workflowRunId: z.string().uuid(),
  projectId: z.string().uuid(),
  sourceAssetIds: z.array(z.string().uuid()).min(1),
  coverAssetId: z.string().uuid(),
  revision: z.number().int().min(0),
  styleKey: z.string().min(1).max(64).optional(),
}).merge(workflowExecutionMetadataSchema);

export type GenerationRequestedPayload = z.infer<
  typeof generationRequestedPayloadSchema
>;

export const renderRequestedPayloadSchema = z.object({
  jobId: z.string().uuid(),
  workflowRunId: z.string().uuid(),
  projectId: z.string().uuid(),
  selectedOutputId: z.string().uuid(),
}).merge(workflowExecutionMetadataSchema);

export type RenderRequestedPayload = z.infer<
  typeof renderRequestedPayloadSchema
>;
