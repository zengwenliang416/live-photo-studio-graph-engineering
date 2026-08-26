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
import { AppShell } from "../../../components/app-shell/app-shell.js";
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
            当前会话未启用 Graph 工作流
          </h1>
          <p className={styles.intro}>
            当前部署不提供浏览器端旧流程回退，工作流必须由服务端 Graph 投影驱动。
          </p>
        </section>
      </main>
    );
  }

  if (isStarting || (workflow.isLoading && !workflow.run)) {
    return (
      <main className={styles.shell} aria-busy="true">
        <section className={styles.content} aria-labelledby="loading-title">
          <p className={styles.eyebrow}>Live Photo Studio / Session</p>
          <h1 className={styles.title} id="loading-title">
            正在恢复创作工作区
          </h1>
          <p className={styles.intro} role="status" aria-live="polite">
            正在读取服务端工作流投影，页面不会创建新的客户端阶段。
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
              无法加载当前工作流
            </h1>
            <p>
              页面没有创建任何客户端阶段。请重试查询服务端工作流投影。
            </p>
            <button
              className={`${styles.button} ${styles.buttonPrimary}`}
              type="button"
              onClick={retry}
            >
              重试
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
    <AppShell
      active="projects"
      context={`工作流 ${runId ? shortId(runId) : "pending"}`}
    >
      <main className={styles.workspace}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>Graph workflow / Server projection</p>
            <h1 className={styles.title}>让静态画面真正开始呼吸</h1>
            <p className={styles.intro}>
              生成、人工选择与媒体渲染均异步执行；刷新页面只会恢复同一个工作流运行。
            </p>
          </div>
          <div className={styles.runMeta}>
            <span>GRAPH V1</span>
            <code>{runId ? shortId(runId) : "PENDING"}</code>
          </div>
        </header>

        <ol className={styles.progress} aria-label="工作流阶段">
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
                <span>{phaseLabel(stage)}</span>
                <small>{done ? "已完成" : active ? "当前阶段" : "等待"}</small>
              </li>
            ),
          )}
        </ol>

        <div className={styles.workflowGrid}>
          <section className={styles.reviewPanel} aria-labelledby="workflow-title">
            <div className={styles.phaseRow}>
              <div>
                <span className={styles.panelIndex}>HUMAN REVIEW DESK</span>
                <h2 className={styles.sectionTitle} id="workflow-title">
                  {phaseLabel(phase)}
                </h2>
              </div>
              <span className={styles.phase}>{phase}</span>
            </div>
            <p className={styles.status} role="status" aria-live="polite">
              {workflow.run?.status === "INTERRUPTED"
                ? "当前阶段正在等待你的人工决策。"
                : "状态来自 API 投影，SSE 只负责提示页面刷新。"}
            </p>

            {workflow.allowedActions.includes("SELECT") ? (
              <fieldset className={styles.task}>
                <legend className={styles.taskLegend}>选择系列基准图</legend>
                <p className={styles.taskCopy}>
                  从候选中选定一张作为后续系列延展的视觉锚点。
                </p>
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
                      <span
                        className={styles.candidateVisual}
                        data-variant={index % 4}
                      >
                        <span>候选 {String.fromCharCode(65 + index)}</span>
                        <code>{shortId(outputId)}</code>
                      </span>
                      <span className={styles.candidateBody}>
                        <strong>光影变奏 {index + 1}</strong>
                        <small>点击卡片选择此候选作为系列视觉基准。</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <div className={styles.waitingStage}>
                <span className={styles.waitingMark} aria-hidden="true">
                  ◌
                </span>
                <h3>{phaseLabel(phase)}</h3>
                <p>工作流正在服务器端推进，页面会在状态变化时更新。</p>
              </div>
            )}
          </section>

          <aside className={styles.commandPanel}>
            <section className={styles.commandCard}>
              <span className={styles.panelIndex}>CURRENT COMMAND</span>
              <h2 className={styles.sectionTitle}>阶段操作</h2>
              <div
                className={styles.actions}
                role="group"
                aria-label="工作流操作"
              >
                {workflow.allowedActions.includes("SELECT") && (
                  <button
                    className={`${styles.button} ${styles.buttonPrimary}`}
                    type="button"
                    onClick={() => onDecide("SELECT")}
                    disabled={workflow.isMutating || !selectedOutputId}
                  >
                    确认基准图并继续
                  </button>
                )}
                {workflow.allowedActions.includes("REGENERATE") && (
                  <button
                    className={styles.button}
                    type="button"
                    onClick={() => onDecide("REGENERATE")}
                    disabled={workflow.isMutating}
                  >
                    重新生成候选
                  </button>
                )}
                {canCancel && (
                  <button
                    className={`${styles.button} ${styles.buttonDanger}`}
                    type="button"
                    onClick={() => workflow.cancel()}
                    disabled={workflow.isMutating}
                  >
                    取消工作流
                  </button>
                )}
              </div>
            </section>

            {workflow.run?.status === "SUCCEEDED" && (
              <section className={styles.commandCard}>
                <span className={styles.panelIndex}>EXPORT PACKAGE</span>
                <h2 className={styles.sectionTitle}>导出交付</h2>
                <button
                  className={`${styles.button} ${styles.buttonPrimary}`}
                  type="button"
                  onClick={() => void downloadLatestExport()}
                  disabled={isDownloading}
                >
                  {isDownloading ? "正在准备下载…" : "下载资源包"}
                </button>
              </section>
            )}

            {downloadError !== null && downloadError !== undefined && (
              <p className={styles.error} role="alert">
                {downloadError instanceof Error
                  ? downloadError.message
                  : "导出资源包暂不可用。"}
              </p>
            )}

            <section className={styles.boundaryCard}>
              <span className={styles.panelIndex}>DELIVERY BOUNDARY</span>
              <p>
                Web 结果是供未来 iOS 导入器使用的资源包，不会直接在 iPhone
                照片图库中保存原生 Live Photo。资源包由 Media Worker
                生成，并通过 API 私有下载边界交付。
              </p>
            </section>
          </aside>
        </div>
      </main>
    </AppShell>
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
