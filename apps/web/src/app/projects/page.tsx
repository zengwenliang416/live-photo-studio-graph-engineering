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

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand} aria-label="Live Photo Studio">
          <span className={styles.brandMark} aria-hidden="true">
            ◌
          </span>
          <span className={styles.brandName}>Live Photo Studio</span>
        </div>
      </header>

      <div className={styles.content}>
        <p className={styles.eyebrow}>我的项目</p>
        <h1 className={styles.title}>从一组照片开始。</h1>
        <p className={styles.intro}>
          创建一个项目,上传照片并选择封面,然后进入生成工作流。
        </p>

        <section className={styles.panel} aria-labelledby="create-title">
          <h2 className={styles.sectionTitle} id="create-title">
            创建项目
          </h2>
          <form className={styles.form} onSubmit={onSubmit}>
            <label className={styles.label} htmlFor="project-title">
              项目名称(可选)
            </label>
            <input
              className={styles.input}
              id="project-title"
              name="project-title"
              type="text"
              maxLength={80}
              placeholder="例如:周末旅行"
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
          </form>
          {formError !== null && (
            <p className={styles.error} role="alert">
              {formError}
            </p>
          )}
        </section>

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
          <p className={styles.empty}>
            还没有项目。先在上方创建一个项目,然后上传照片开始制作。
          </p>
        )}

        {projects.length > 0 && (
          <ul className={styles.list} aria-label="项目列表">
            {projects.map((project) => (
              <li key={project.projectId}>
                <Link className={styles.card} href={projectHref(project)}>
                  <span className={styles.cardTitle}>
                    {displayTitle(project)}
                  </span>
                  <span className={styles.cardMeta}>
                    创建于 {formatCreatedAt(project.createdAt)}
                  </span>
                  <span className={styles.cardHint}>
                    {project.coverAssetId !== null
                      ? "进入生成工作流"
                      : "继续上传素材"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
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
