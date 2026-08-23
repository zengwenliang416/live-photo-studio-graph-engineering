"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkflowApiClient } from "../../../lib/api-client.js";
import { useWorkflow } from "../../../hooks/use-workflow.js";
import {
  useWorkflowEvents,
} from "../../../hooks/use-workflow-events.js";

const GRAPH_ENABLED =
  process.env["NEXT_PUBLIC_GRAPH_WORKFLOW_ENABLED"] !== "false";

function ReviewPanel(): React.JSX.Element {
  const [projectId] = useState("00000000-0000-4000-8000-000000000001");
  const runIdRef = useRef<string | null>(null);
  const [runId, setRunId] = useState<string>("");

  // Resume: the run id survives refresh via localStorage keyed by project.
  useEffect(() => {
    const storageKey = `workflow-run:${projectId}`;
    const existing = window.localStorage.getItem(storageKey);
    if (existing) {
      setRunId(existing);
      return;
    }
    void (async () => {
      try {
        const client = new WorkflowApiClient();
        const started = await client.startWorkflowRun(projectId);
        window.localStorage.setItem(storageKey, started.data.workflowRunId);
        setRunId(started.data.workflowRunId);
      } catch {
        // Start failures render through the error state below.
      }
    })();
  }, [projectId]);

  const workflow = useWorkflow({ workflowRunId: runId });
  useWorkflowEvents(runId, workflow.refresh);

  const onDecide = useCallback(
    (action: string) => {
      if (workflow.isMutating) return; // duplicate-click guard
      workflow.decide({ action });
    },
    [workflow],
  );

  const stageList = useMemo(
    () =>
      workflow.stages.map(
        (stage: string, index: number): { stage: string; active: boolean; done: boolean } => ({
          stage,
          active: index === workflow.stageIndex,
          done: index < workflow.stageIndex,
        }),
      ),
    [workflow.stages, workflow.stageIndex],
  );

  if (!GRAPH_ENABLED) {
    return (
      <main>
        <p>Legacy path is active for this session.</p>
      </main>
    );
  }

  if (workflow.isLoading && !runId) {
    return (
      <main aria-busy="true">
        <p>Loading workflow…</p>
      </main>
    );
  }
  if (workflow.isError) {
    return (
      <main role="alert">
        <p>Workflow unavailable.</p>
        <button type="button" onClick={workflow.refresh}>
          Retry
        </button>
      </main>
    );
  }

  const phase = workflow.run?.currentPhase ?? "STARTING";
  return (
    <main>
      <h1>Live Photo Studio</h1>
      <ol aria-label="Progress by stage">
        {stageList.map(
          ({ stage, active, done }: { stage: string; active: boolean; done: boolean }) => (
          <li
            key={stage}
            aria-current={active ? "step" : undefined}
            data-done={done || undefined}
          >
            {stage}
          </li>
        ))}
      </ol>

      <section aria-label={`Current phase ${phase}`}>
        <p>{phase}</p>
        <div role="group" aria-label="Review actions">
          {workflow.allowedActions.includes("SELECT") && (
            <button type="button" onClick={() => onDecide("SELECT")} disabled={workflow.isMutating}>
              Select anchor
            </button>
          )}
          {workflow.allowedActions.includes("REGENERATE") && (
            <button type="button" onClick={() => onDecide("REGENERATE")} disabled={workflow.isMutating}>
              Regenerate
            </button>
          )}
          {phase === "COMPLETED" ? null : (
            <button type="button" onClick={() => workflow.cancel()} disabled={workflow.isMutating}>
              Cancel workflow
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

export default function ProjectWorkflowPage(): React.JSX.Element {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ReviewPanel />
    </QueryClientProvider>
  );
}
