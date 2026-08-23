import { z } from "zod";

export const workflowEventNameSchema = z.enum([
  "workflow.started.v1",
  "workflow.interrupted.v1",
  "workflow.resumed.v1",
  "workflow.completed.v1",
  "workflow.failed.v1",
  "workflow.cancelled.v1",
  "workflow.human-task.created.v1",
  "workflow.node.started.v1",
  "workflow.node.completed.v1",
  "workflow.node.failed.v1",
]);

export const workflowEventSchema = z.object({
  eventId: z.string().uuid(),
  eventName: workflowEventNameSchema,
  workflowRunId: z.string().uuid(),
  projectId: z.string().uuid(),
  graphKey: z.string(),
  graphVersion: z.string(),
  occurredAt: z.string().datetime(),
  payload: z.record(z.unknown()),
});

export type WorkflowEvent = z.infer<typeof workflowEventSchema>;
