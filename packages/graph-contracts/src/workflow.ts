import { z } from "zod";
import { workflowExecutionMetadataSchema } from "./observability.js";

export const workflowRunStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "INTERRUPTED",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);

export type WorkflowRunStatus = z.infer<typeof workflowRunStatusSchema>;

const workflowIdentitySchema = z.object({
  workflowRunId: z.string().uuid(),
  graphKey: z.string().min(1),
  graphVersion: z.string().min(1),
});

export const startWorkflowCommandSchema = workflowIdentitySchema.extend({
  type: z.literal("START_WORKFLOW"),
  commandId: z.string().uuid(),
  projectId: z.string().uuid(),
  userId: z.string().min(1),
  input: z.record(z.unknown()),
  requestedAt: z.string().datetime(),
}).merge(workflowExecutionMetadataSchema);

export const cancelWorkflowCommandSchema = workflowIdentitySchema.pick({
  workflowRunId: true,
}).extend({
  type: z.literal("CANCEL_WORKFLOW"),
  commandId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  userId: z.string().min(1).optional(),
  reason: z.string().min(1).max(500).optional(),
  requestedAt: z.string().datetime(),
}).merge(workflowExecutionMetadataSchema);

export const workflowCommandSchema = z.discriminatedUnion("type", [
  startWorkflowCommandSchema,
  cancelWorkflowCommandSchema,
]);

export type WorkflowCommand = z.infer<typeof workflowCommandSchema>;

export const graphSignalTypeSchema = z.enum([
  "GENERATION_BATCH_COMPLETED",
  "GENERATION_BATCH_FAILED",
  "RENDER_JOB_COMPLETED",
  "RENDER_JOB_FAILED",
  "HUMAN_TASK_COMPLETED",
  "ASSET_INGEST_COMPLETED",
  "ASSET_INGEST_FAILED",
]);

export const workflowSignalSchema = z.object({
  signalId: z.string().uuid(),
  workflowRunId: z.string().uuid(),
  signalType: graphSignalTypeSchema,
  correlationId: z.string().min(1),
  payload: z.record(z.unknown()),
  emittedAt: z.string().datetime(),
}).merge(workflowExecutionMetadataSchema);

export type WorkflowSignal = z.infer<typeof workflowSignalSchema>;

export const humanTaskTypeSchema = z.enum([
  "REVIEW_STYLE_PROFILE",
  "SELECT_ANCHOR_IMAGE",
  "REVIEW_IMAGE_SERIES",
  "FIX_UPLOAD_INPUT",
  "REVIEW_EXPORT_REPAIR",
]);

export const humanTaskActionSchema = z.enum([
  "APPROVE",
  "SELECT",
  "REGENERATE",
  "CHANGE_STYLE",
  "RETRY",
  "REUPLOAD",
  "CANCEL",
]);

export const humanTaskDecisionSchema = z.object({
  humanTaskId: z.string().uuid(),
  workflowRunId: z.string().uuid(),
  action: humanTaskActionSchema,
  selectedOutputId: z.string().uuid().optional(),
  feedback: z.string().max(4000).optional(),
  submittedBy: z.string().min(1),
  submittedAt: z.string().datetime(),
});

export type HumanTaskDecision = z.infer<typeof humanTaskDecisionSchema>;

export const workflowProjectionSchema = z.object({
  workflowRunId: z.string().uuid(),
  projectId: z.string().uuid(),
  graphKey: z.string(),
  graphVersion: z.string(),
  status: workflowRunStatusSchema,
  currentNode: z.string().nullable(),
  currentPhase: z.string().nullable(),
  pendingHumanTaskId: z.string().uuid().nullable(),
  updatedAt: z.string().datetime(),
});

export type WorkflowProjection = z.infer<typeof workflowProjectionSchema>;
