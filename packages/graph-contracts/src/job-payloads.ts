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

export const assetPreviewRequestedPayloadSchema = z.object({
  jobId: z.string().uuid(),
  projectId: z.string().uuid(),
  assetId: z.string().uuid(),
  recipeVersion: z.literal("display-preview.v1"),
});

export type AssetPreviewRequestedPayload = z.infer<
  typeof assetPreviewRequestedPayloadSchema
>;

export const assetModelInputRequestedPayloadSchema = z.object({
  jobId: z.string().uuid(),
  projectId: z.string().uuid(),
  assetId: z.string().uuid(),
  recipeVersion: z.literal("model-input.v1"),
});

export type AssetModelInputRequestedPayload = z.infer<
  typeof assetModelInputRequestedPayloadSchema
>;

export const assetImageVariantRequestedPayloadSchema = z.union([
  assetPreviewRequestedPayloadSchema,
  assetModelInputRequestedPayloadSchema,
]);

export type AssetImageVariantRequestedPayload = z.infer<
  typeof assetImageVariantRequestedPayloadSchema
>;
