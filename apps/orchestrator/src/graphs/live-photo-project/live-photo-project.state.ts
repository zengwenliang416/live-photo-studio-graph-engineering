import { Annotation } from "@langchain/langgraph";
import { z } from "zod";

const uniqueStrings = (current: string[], incoming: string[]): string[] =>
  [...new Set([...current, ...incoming])];

export const LivePhotoProjectState = Annotation.Root({
  workflowRunId: Annotation<string>(),
  projectId: Annotation<string>(),
  userId: Annotation<string>(),
  traceId: Annotation<string | undefined>(),
  graphKey: Annotation<string>(),
  graphVersion: Annotation<string>(),

  sourceAssetIds: Annotation<string[]>({
    reducer: uniqueStrings,
    default: () => [],
  }),
  coverAssetId: Annotation<string | undefined>(),
  styleKey: Annotation<string | undefined>(),
  styleReferenceAssetIds: Annotation<string[]>({
    reducer: uniqueStrings,
    default: () => [],
  }),
  identityReferenceAssetIds: Annotation<string[]>({
    reducer: uniqueStrings,
    default: () => [],
  }),

  currentPhase: Annotation<string>({
    reducer: (_current, incoming) => incoming,
    default: () => "STARTING",
  }),
  maxRepairAttempts: Annotation<number>({
    reducer: (_current, incoming) => incoming,
    default: () => 2,
  }),
  generationRevision: Annotation<number>({
    reducer: (_current, incoming) => incoming,
    default: () => 0,
  }),
  pendingHumanTaskId: Annotation<string | undefined>(),
  candidateOutputIds: Annotation<string[]>({
    reducer: uniqueStrings,
    default: () => [],
  }),
  selectedAnchorOutputId: Annotation<string | undefined>(),
  pendingExternalJobId: Annotation<string | undefined>(),
  reviewAction: Annotation<"SELECT" | "REGENERATE" | "CANCEL" | undefined>(),
  renderJobId: Annotation<string | undefined>(),
  exportId: Annotation<string | undefined>(),
  lastErrorCode: Annotation<string | undefined>(),
});

export type LivePhotoProjectStateValue = typeof LivePhotoProjectState.State;
export type LivePhotoProjectStateUpdate = typeof LivePhotoProjectState.Update;

export const livePhotoProjectStartInputSchema = z.object({
  workflowRunId: z.string().uuid(),
  projectId: z.string().uuid(),
  userId: z.string().min(1),
  traceId: z.string().uuid().optional(),
  graphKey: z.literal("live-photo-project"),
  graphVersion: z.literal("v1"),
  sourceAssetIds: z.array(z.string().uuid()).min(1),
  coverAssetId: z.string().uuid(),
  styleKey: z.string().min(1).max(64).optional(),
  styleReferenceAssetIds: z.array(z.string().uuid()).default([]),
  identityReferenceAssetIds: z.array(z.string().uuid()).default([]),
  maxRepairAttempts: z.number().int().min(0).max(10).default(2),
});

export type LivePhotoProjectStartInput = z.infer<
  typeof livePhotoProjectStartInputSchema
>;
