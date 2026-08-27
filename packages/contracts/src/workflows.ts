import { z } from "zod";

const workflowUuidSchema = z.string().uuid();

export const workflowCandidateViewSchema = z.object({
  outputId: workflowUuidSchema,
  previewUrl: z.string().url().nullable(),
  previewExpiresAt: z.string().datetime().nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const humanTaskViewSchema = z.object({
  humanTaskId: workflowUuidSchema,
  taskType: z.string().min(1),
  nodeName: z.string().min(1),
  status: z.string().min(1),
  allowedActions: z.array(z.string().min(1)),
  candidateOutputIds: z.array(workflowUuidSchema),
  candidates: z.array(workflowCandidateViewSchema),
  createdAt: z.string().datetime(),
});

export const humanTasksResponseSchema = z.object({
  data: z.array(humanTaskViewSchema),
});

export type WorkflowCandidateView = z.infer<
  typeof workflowCandidateViewSchema
>;
export type HumanTaskView = z.infer<typeof humanTaskViewSchema>;
