import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  WorkflowApiClient,
  type ApiClientOptions,
} from "../lib/api-client.js";

export const WORKFLOW_STAGES = [
  "STARTING",
  "READY_TO_GENERATE",
  "WAITING_GENERATION",
  "REVIEW_ANCHOR",
  "READY_TO_RENDER",
  "WAITING_RENDER",
  "READY_TO_COMPLETE",
  "COMPLETED",
] as const;

export function stageIndex(phase: string | null): number {
  if (!phase) return 0;
  const index = WORKFLOW_STAGES.indexOf(
    phase as (typeof WORKFLOW_STAGES)[number],
  );
  return index === -1 ? 0 : index;
}

export interface UseWorkflowOptions extends ApiClientOptions {
  readonly workflowRunId: string;
}

/**
 * Server projection is the only truth. SSE events only invalidate queries.
 * Mutations carry stable per-action idempotency keys inside the client, so
 * duplicate clicks replay the first response instead of creating commands.
 */
export function useWorkflow(options: UseWorkflowOptions) {
  const client = new WorkflowApiClient(options);
  const queryClient = useQueryClient();

  const runQuery = useQuery({
    queryKey: ["workflow-run", options.workflowRunId],
    queryFn: () => client.getWorkflowRun(options.workflowRunId),
    refetchInterval: 5000,
  });

  const tasksQuery = useQuery({
    queryKey: ["human-tasks", options.workflowRunId],
    queryFn: () => client.listHumanTasks(options.workflowRunId),
    enabled: runQuery.data?.data.pendingHumanTaskId != null,
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({
      queryKey: ["workflow-run", options.workflowRunId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["human-tasks", options.workflowRunId],
    });
  };

  const decideMutation = useMutation({
    mutationFn: (input: { action: string; selectedOutputId?: string }) =>
      client.decide(runQuery.data?.data.pendingHumanTaskId ?? "", input),
    onSuccess: invalidate,
  });

  const cancelMutation = useMutation({
    mutationFn: () => client.cancel(options.workflowRunId),
    onSuccess: invalidate,
  });

  const pendingTaskId = runQuery.data?.data.pendingHumanTaskId ?? null;
  const pendingTask = tasksQuery.data?.data.find(
    (task) => task.humanTaskId === pendingTaskId && task.status === "PENDING",
  );

  return {
    run: runQuery.data?.data,
    isLoading: runQuery.isLoading,
    isError: runQuery.isError,
    error: runQuery.error,
    stageIndex: stageIndex(runQuery.data?.data.currentPhase ?? null),
    stages: WORKFLOW_STAGES,
    allowedActions: pendingTask?.allowedActions ?? [],
    isMutating: decideMutation.isPending || cancelMutation.isPending,
    decide: decideMutation.mutate,
    cancel: cancelMutation.mutate,
    refresh: invalidate,
  };
}
