"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type ProjectSummary,
  WorkflowApiClient,
} from "../../lib/api-client.js";
import { AppShell } from "../../components/app-shell/app-shell.js";
import styles from "./projects.module.css";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function displayTitle(project: ProjectSummary): string {
  return project.title.trim().length > 0 ? project.title : "未命名项目";
}

function projectHref(project: ProjectSummary): string {
  return project.coverAssetId !== null
    ? `/projects/${project.projectId}`
    : `/projects/${project.projectId}/upload`;
}

function ProjectsPanel(): React.JSX.Element {
  const client = useMemo(() => new WorkflowApiClient(), []);
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  // One idempotency actionId per form instance: double clicks and retries
  // replay the first create, while a fresh form is never merged into an old
  // idempotency record. The key rotates after every successful submit.
  const [actionId, setActionId] = useState(() => crypto.randomUUID());
  const [formError, setFormError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => client.listProjects({ limit: 50 }),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const trimmed = title.trim();
      return client.createProject(
        trimmed.length > 0 ? trimmed : undefined,
        actionId,
      );
    },
    onSuccess: () => {
      setTitle("");
      setActionId(crypto.randomUUID());
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: () => {
      setFormError("创建项目失败,请稍后重试。");
    },
  });

  const onSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (createMutation.isPending) return;
    createMutation.mutate();
  };

  const projects = listQuery.data?.data.items ?? [];
  const readyProjects = projects.filter(
    (project) => project.coverAssetId !== null,
  ).length;

  return (
    <AppShell active="projects" context="项目库">
      <main className={styles.workspace}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>Projects / Creative workspace</p>
            <h1 className={styles.title}>我的系列项目</h1>
            <p className={styles.intro}>
              在一个桌面工作台中管理素材、风格策略、生成审核与最终导出。
            </p>
          </div>
          <Link className={styles.settingsLink} href="/settings">
            管理生图通道
          </Link>
        </header>

        <section className={styles.overview} aria-label="项目概览">
          <div className={styles.createPanel}>
            <div>
              <span className={styles.panelIndex}>NEW SERIES</span>
              <h2 className={styles.sectionTitle} id="create-title">
                创建新系列
              </h2>
              <p className={styles.panelCopy}>
                命名后立即进入素材工作区，可继续上传并选择风格。
              </p>
            </div>
            <form
              className={styles.form}
              onSubmit={onSubmit}
              aria-labelledby="create-title"
            >
              <label className={styles.label} htmlFor="project-title">
                项目名称
              </label>
              <div className={styles.formRow}>
                <input
                  className={styles.input}
                  id="project-title"
                  name="project-title"
                  type="text"
                  maxLength={80}
                  placeholder="例如：海风电影日记"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <button
                  className={`${styles.button} ${styles.buttonPrimary}`}
                  type="submit"
                  disabled={createMutation.isPending}
                  aria-busy={createMutation.isPending}
                >
                  {createMutation.isPending ? "创建中…" : "创建项目"}
                </button>
              </div>
            </form>
            {formError !== null && (
              <p className={styles.error} role="alert">
                {formError}
              </p>
            )}
          </div>

          <div className={styles.metrics} aria-label="项目统计">
            <div>
              <strong>{projects.length}</strong>
              <span>全部项目</span>
            </div>
            <div>
              <strong>{readyProjects}</strong>
              <span>已进入工作流</span>
            </div>
            <div>
              <strong>{projects.length - readyProjects}</strong>
              <span>待整理素材</span>
            </div>
          </div>
        </section>

        <div className={styles.libraryHeader}>
          <div>
            <span className={styles.panelIndex}>LIBRARY</span>
            <h2 className={styles.sectionTitle}>项目库</h2>
          </div>
          <span className={styles.libraryCount}>{projects.length} 个系列</span>
        </div>

        {listQuery.isLoading && (
          <p className={styles.status} role="status" aria-live="polite">
            正在加载项目列表…
          </p>
        )}

        {listQuery.isError && (
          <div className={styles.error} role="alert">
            <p>项目列表加载失败,请检查网络后重试。</p>
            <button
              className={styles.button}
              type="button"
              onClick={() => void listQuery.refetch()}
            >
              重试
            </button>
          </div>
        )}

        {listQuery.isSuccess && projects.length === 0 && (
          <div className={styles.empty}>
            <span className={styles.emptyMark} aria-hidden="true">
              ◌
            </span>
            <h2>还没有系列项目</h2>
            <p>先在上方创建一个项目，再上传照片开始制作。</p>
          </div>
        )}

        {projects.length > 0 && (
          <ul className={styles.list} aria-label="项目列表">
            {projects.map((project, index) => (
              <li key={project.projectId}>
                <Link className={styles.card} href={projectHref(project)}>
                  <span className={styles.cardVisual} data-variant={index % 6}>
                    <span className={styles.cardStatus}>
                      {project.coverAssetId !== null ? "生成工作流" : "素材整理"}
                    </span>
                    <span className={styles.cardOrdinal}>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </span>
                  <span className={styles.cardBody}>
                    <span className={styles.cardTitle}>
                      {displayTitle(project)}
                    </span>
                    <span className={styles.cardMeta}>
                      创建于 {formatCreatedAt(project.createdAt)}
                    </span>
                    <span className={styles.cardHint}>
                      {project.coverAssetId !== null
                        ? "继续生成与审核"
                        : "继续上传与选择封面"}
                      <span aria-hidden="true"> →</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  );
}

export default function ProjectsPage(): React.JSX.Element {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ProjectsPanel />
    </QueryClientProvider>
  );
}
