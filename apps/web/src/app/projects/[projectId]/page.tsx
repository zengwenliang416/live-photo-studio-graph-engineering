"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import {
  type WorkflowAction,
  WorkflowApiClient,
} from "../../../lib/api-client.js";
import { resolveWorkflowRunId } from "../../../lib/workflow-session.js";
import { useWorkflow } from "../../../hooks/use-workflow.js";
import { useWorkflowEvents } from "../../../hooks/use-workflow-events.js";
import { AccountActions } from "../../../components/auth/account-actions.js";
import styles from "./project-workflow.module.css";

const GRAPH_ENABLED =
  process.env["NEXT_PUBLIC_GRAPH_WORKFLOW_ENABLED"] !== "false";

const PHASE_LABELS: Readonly<Record<string, string>> = {
  STARTING: "准备工作流",
  READY_TO_GENERATE: "准备生成",
  WAITING_GENERATION: "等待生成",
  REVIEW_ANCHOR: "选择封面",
  READY_TO_RENDER: "准备渲染",
  WAITING_RENDER: "等待渲染",
  READY_TO_COMPLETE: "准备导出",
  COMPLETED: "已完成",
};

function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase] ?? phase;
}

function shortId(value: string): string {
  return value.slice(0, 8);
}

function ReviewPanel(): React.JSX.Element {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId ?? "";
  const [runId, setRunId] = useState<string>("");
  const [selectedOutputId, setSelectedOutputId] = useState<string>("");
  const [isStarting, setIsStarting] = useState(true);
  const [sessionError, setSessionError] = useState<unknown>(null);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [downloadError, setDownloadError] = useState<unknown>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRunId("");
    setSessionError(null);

    if (!projectId) {
      setIsStarting(false);
      return () => {
        cancelled = true;
      };
    }

    setIsStarting(true);
    const client = new WorkflowApiClient();
    void resolveWorkflowRunId(client, projectId)
      .then((resolvedRunId) => {
        if (!cancelled) setRunId(resolvedRunId);
      })
      .catch((error: unknown) => {
        if (!cancelled) setSessionError(error);
      })
      .finally(() => {
        if (!cancelled) setIsStarting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, sessionAttempt]);

  const workflow = useWorkflow({ workflowRunId: runId });
  useWorkflowEvents(runId, workflow.refresh);

  useEffect(() => {
    setSelectedOutputId(workflow.candidateOutputIds[0] ?? "");
  }, [workflow.candidateOutputIds]);

  const retry = useCallback(() => {
    if (sessionError) {
      setSessionAttempt((attempt) => attempt + 1);
      return;
    }
    workflow.refresh();
  }, [sessionError, workflow]);

  const downloadLatestExport = useCallback(async () => {
    if (isDownloading || !projectId) return;
    setDownloadError(null);
    setIsDownloading(true);
    try {
      const client = new WorkflowApiClient();
      const result = await client.getLatestExportDownload(projectId);
      window.location.assign(result.data.downloadUrl);
    } catch (error: unknown) {
      setDownloadError(error);
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading, projectId]);

  const onDecide = useCallback(
    (action: WorkflowAction) => {
      if (workflow.isMutating || !workflow.allowedActions.includes(action)) return;
      if (action === "SELECT") {
        if (!selectedOutputId) return;
        workflow.decide({ action, selectedOutputId });
        return;
      }
      workflow.decide({ action });
    },
    [selectedOutputId, workflow],
  );

  const stageList = useMemo(
    () =>
      workflow.stages.map(
        (stage: string, index: number): {
          stage: string;
          active: boolean;
          done: boolean;
        } => ({
          stage,
          active: index === workflow.stageIndex,
          done: index < workflow.stageIndex,
        }),
      ),
    [workflow.stageIndex, workflow.stages],
  );

  if (!GRAPH_ENABLED) {
    return (
      <main className={styles.shell}>
        <section className={styles.content} aria-labelledby="legacy-title">
          <p className={styles.eyebrow}>Legacy route</p>
          <h1 className={styles.title} id="legacy-title">
            Legacy path is active
          </h1>
          <p className={styles.intro}>
            This session is not in the Graph canary cohort. The local snapshot
            does not claim to provide a legacy fallback implementation.
          </p>
        </section>
      </main>
    );
  }

  if (isStarting || (workflow.isLoading && !workflow.run)) {
    return (
      <main className={styles.shell} aria-busy="true">
        <section className={styles.content} aria-labelledby="loading-title">
          <p className={styles.eyebrow}>Live Photo Studio</p>
          <h1 className={styles.title} id="loading-title">
            Reopening your studio session
          </h1>
          <p className={styles.intro} role="status" aria-live="polite">
            The server projection is being checked before this page resumes.
          </p>
        </section>
      </main>
    );
  }

  if (sessionError || workflow.isError) {
    return (
      <main className={styles.shell}>
        <section className={styles.content} aria-labelledby="error-title">
          <p className={styles.eyebrow}>Workflow unavailable</p>
          <div className={styles.error} role="alert">
            <h1 className={styles.sectionTitle} id="error-title">
              We could not load this workflow
            </h1>
            <p>
              No client-side phase was created. Retry to query the server
              projection again.
            </p>
            <button
              className={`${styles.button} ${styles.buttonPrimary}`}
              type="button"
              onClick={retry}
            >
              Retry
            </button>
          </div>
        </section>
      </main>
    );
  }

  const phase = workflow.run?.currentPhase ?? "STARTING";
  const terminal =
    workflow.run?.status === "SUCCEEDED" ||
    workflow.run?.status === "FAILED" ||
    workflow.run?.status === "CANCELLED";
  const canCancel =
    !terminal && workflow.allowedActions.includes("CANCEL");

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand} aria-label="Live Photo Studio">
          <span className={styles.brandMark} aria-hidden="true">
            ◌
          </span>
          <span className={styles.brandName}>Live Photo Studio</span>
          <span className={styles.badge}>Graph v1</span>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.headerMeta}>
            run {runId ? shortId(runId) : "pending"}
          </span>
          <AccountActions />
        </div>
      </header>

      <div className={styles.content}>
        <p className={styles.eyebrow}>Project workflow / server projection</p>
        <h1 className={styles.title}>Make the still image feel alive.</h1>
        <p className={styles.intro}>
          Generation, human selection and media rendering run asynchronously.
          Refreshing this page reopens the same workflow run instead of
          inventing a new client-side phase.
        </p>

        <ol className={styles.progress} aria-label="Progress by stage">
          {stageList.map(
            ({
              stage,
              active,
              done,
            }: {
              stage: string;
              active: boolean;
              done: boolean;
            }) => (
              <li
                className={styles.progressItem}
                key={stage}
                aria-current={active ? "step" : undefined}
                data-done={done || undefined}
              >
                {phaseLabel(stage)}
              </li>
            ),
          )}
        </ol>

        <section className={styles.panel} aria-labelledby="workflow-title">
          <div className={styles.phaseRow}>
            <h2 className={styles.sectionTitle} id="workflow-title">
              {phaseLabel(phase)}
            </h2>
            <span className={styles.phase}>{phase}</span>
          </div>
          <p className={styles.status} role="status" aria-live="polite">
            {workflow.run?.status === "INTERRUPTED"
              ? "This step is waiting for your decision."
              : "The workflow state comes from the API projection; SSE only refreshes this view."}
          </p>

          {workflow.allowedActions.includes("SELECT") && (
            <fieldset className={styles.task}>
              <legend className={styles.taskLegend}>
                Select an anchor image
              </legend>
              <div className={styles.candidateList}>
                {workflow.candidateOutputIds.map((outputId, index) => (
                  <label className={styles.candidate} key={outputId}>
                    <input
                      type="radio"
                      name="anchor-output"
                      value={outputId}
                      checked={selectedOutputId === outputId}
                      onChange={() => setSelectedOutputId(outputId)}
                    />
                    <span>Candidate {index + 1}</span>
                    <code className={styles.candidateCode}>
                      {shortId(outputId)}
                    </code>
                  </label>
                ))}
              </div>
              <button
                className={`${styles.button} ${styles.buttonPrimary}`}
                type="button"
                onClick={() => onDecide("SELECT")}
                disabled={workflow.isMutating || !selectedOutputId}
              >
                Select anchor
              </button>
            </fieldset>
          )}

          <div
            className={styles.actions}
            role="group"
            aria-label="Workflow actions"
          >
            {workflow.allowedActions.includes("REGENERATE") && (
              <button
                className={styles.button}
                type="button"
                onClick={() => onDecide("REGENERATE")}
                disabled={workflow.isMutating}
              >
                Regenerate
              </button>
            )}
            {canCancel && (
              <button
                className={`${styles.button} ${styles.buttonDanger}`}
                type="button"
                onClick={() => workflow.cancel()}
                disabled={workflow.isMutating}
              >
                Cancel workflow
              </button>
            )}
          </div>

          {workflow.run?.status === "SUCCEEDED" && (
            <div className={styles.actions}>
              <button
                className={`${styles.button} ${styles.buttonPrimary}`}
                type="button"
                onClick={() => void downloadLatestExport()}
                disabled={isDownloading}
              >
                {isDownloading
                  ? "Preparing download..."
                  : "Download resource package"}
              </button>
            </div>
          )}
          {downloadError !== null && downloadError !== undefined && (
            <p className={styles.error} role="alert">
              {downloadError instanceof Error
                ? downloadError.message
                : "The export download is not available yet."}
            </p>
          )}

          <p className={styles.notice}>
            The Web result is a downloadable resource package for a future iOS Importer. The Web export does not save a Live Photo directly to the iPhone Photos library as a native Live Photo. This page never creates a browser ZIP; completed exports come from the Media Worker and are delivered through the API&apos;s private download boundary.
          </p>
        </section>
      </div>
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
