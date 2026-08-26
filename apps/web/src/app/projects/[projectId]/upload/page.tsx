"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  ApiProblemError,
  WorkflowApiClient,
} from "../../../../lib/api-client.js";
import { workflowRunStorageKey } from "../../../../lib/workflow-session.js";
import { AppShell } from "../../../../components/app-shell/app-shell.js";
import {
  advanceUploadItem,
  firstReadyAssetId,
  MAX_UPLOAD_CONCURRENCY,
  resolveContentType,
  sha256Hex,
  summarizeUploads,
  UPLOAD_STATUS_LABELS,
  validateUploadFile,
  type FileUploadStatus,
  type UploadItem,
} from "../../../../lib/upload-flow.js";
import styles from "./upload.module.css";

const ACCEPT_ATTRIBUTE = "image/jpeg,image/png,image/webp,.heic,.heif";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${bytes} B`;
}

function uploadErrorMessage(error: unknown): string {
  if (error instanceof ApiProblemError) {
    return `上传失败(${error.code})。`;
  }
  return "上传失败,请检查网络后重试。";
}

function UploadPanel(): React.JSX.Element {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId ?? "";
  const router = useRouter();
  const client = useMemo(() => new WorkflowApiClient(), []);

  // File blobs stay in a ref, never in React state or web storage.
  const filesRef = useRef(new Map<string, File>());
  const queueRef = useRef<string[]>([]);
  const inFlightRef = useRef(0);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [coverAssetId, setCoverAssetId] = useState<string | null>(null);
  const [confirmedCoverAssetId, setConfirmedCoverAssetId] = useState<
    string | null
  >(null);
  const [isSettingCover, setIsSettingCover] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [styleKey, setStyleKey] = useState<string | null>(null);
  const [styleCategory, setStyleCategory] = useState("全部");
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => client.getProject(projectId),
    enabled: projectId.length > 0,
  });

  const stylePresetsQuery = useQuery({
    queryKey: ["style-presets"],
    queryFn: () => client.listStylePresets(),
  });
  const stylePresets = stylePresetsQuery.data?.data.items ?? [];
  const styleCategories = [
    "全部",
    ...Array.from(new Set(stylePresets.map((preset) => preset.category))),
  ];
  const filteredStylePresets =
    styleCategory === "全部"
      ? stylePresets
      : stylePresets.filter((preset) => preset.category === styleCategory);

  // Default to the first preset once the list arrives.
  useEffect(() => {
    setStyleKey((prev) => prev ?? stylePresets[0]?.key ?? null);
  }, [stylePresets]);

  // Refresh recovery: assets already READY on the server reappear as
  // non-retryable items and the stored cover is preselected.
  useEffect(() => {
    const detail = projectQuery.data?.data;
    if (!detail) return;
    if (detail.coverAssetId !== null) {
      setCoverAssetId((prev) => prev ?? detail.coverAssetId);
      setConfirmedCoverAssetId((prev) => prev ?? detail.coverAssetId);
    }
    setItems((prev) => {
      const known = new Set(
        prev
          .map((item) => item.assetId)
          .filter((id): id is string => id !== undefined),
      );
      const restored: UploadItem[] = [];
      for (const asset of detail.assets) {
        if (asset.status !== "READY" || known.has(asset.assetId)) continue;
        restored.push({
          key: `remote:${asset.assetId}`,
          fileName: `已上传素材 ${asset.assetId.slice(0, 8)}`,
          bytes: asset.bytes ?? 0,
          status: "ready",
          assetId: asset.assetId,
        });
      }
      return restored.length > 0 ? [...prev, ...restored] : prev;
    });
  }, [projectQuery.data]);

  const patchItem = useCallback(
    (
      key: string,
      status: FileUploadStatus,
      patch: { assetId?: string; errorMessage?: string } = {},
    ): void => {
      setItems((prev) =>
        prev.map((item) =>
          item.key === key ? advanceUploadItem(item, status, patch) : item,
        ),
      );
    },
    [],
  );

  const processFile = useCallback(
    async (key: string): Promise<void> => {
      const file = filesRef.current.get(key);
      if (!file || projectId.length === 0) return;
      patchItem(key, "intending");
      try {
        const contentType = resolveContentType(file.name, file.type);
        if (contentType === null) {
          throw new ApiProblemError(400, "UNSUPPORTED_TYPE", "unsupported");
        }
        const intent = await client.createUploadIntent(projectId, {
          contentType,
          bytes: file.size,
          fileName: file.name,
        });
        const assetId = intent.data.assetId;
        patchItem(key, "uploading", { assetId });
        await client.uploadToSignedUrl(
          intent.data.uploadUrl,
          intent.data.uploadHeaders,
          file,
        );
        patchItem(key, "confirming", { assetId });
        const sha256 = await sha256Hex(await file.arrayBuffer());
        await client.confirmAsset(assetId, { bytes: file.size, sha256 });
        patchItem(key, "ready", { assetId });
      } catch (error: unknown) {
        patchItem(key, "failed", { errorMessage: uploadErrorMessage(error) });
      }
    },
    [client, patchItem, projectId],
  );

  const pump = useCallback((): void => {
    while (
      inFlightRef.current < MAX_UPLOAD_CONCURRENCY &&
      queueRef.current.length > 0
    ) {
      const key = queueRef.current.shift();
      if (key === undefined) break;
      inFlightRef.current += 1;
      void processFile(key)
        .catch(() => undefined)
        .finally(() => {
          inFlightRef.current -= 1;
          pump();
        });
    }
  }, [processFile]);

  const selectCover = useCallback(
    async (assetId: string): Promise<void> => {
      if (isSettingCover || projectId.length === 0) return;
      setCoverAssetId(assetId);
      setCoverError(null);
      setIsSettingCover(true);
      try {
        await client.setProjectCover(projectId, assetId);
        setConfirmedCoverAssetId(assetId);
      } catch (error: unknown) {
        setCoverError(
          error instanceof ApiProblemError
            ? `设置封面失败(${error.code})。`
            : "设置封面失败,请重试。",
        );
      } finally {
        setIsSettingCover(false);
      }
    },
    [client, isSettingCover, projectId],
  );

  // Default the cover to the first ready item so the main button unlocks
  // without an extra click; a failed auto-attempt stays selected and the
  // user can pick another radio to retry.
  useEffect(() => {
    if (coverAssetId !== null || isSettingCover) return;
    const first = firstReadyAssetId(items);
    if (first !== null) void selectCover(first);
  }, [coverAssetId, isSettingCover, items, selectCover]);

  const onFilesSelected = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    const queuedKeys: string[] = [];
    setItems((prev) => {
      const additions = files.map((file): UploadItem => {
        const key = crypto.randomUUID();
        const problem = validateUploadFile(file.name, file.size, file.type);
        if (problem === null) {
          filesRef.current.set(key, file);
          queuedKeys.push(key);
          return {
            key,
            fileName: file.name,
            bytes: file.size,
            status: "queued",
          };
        }
        return {
          key,
          fileName: file.name,
          bytes: file.size,
          status: "failed",
          errorMessage: problem,
        };
      });
      return [...prev, ...additions];
    });
    queueRef.current.push(...queuedKeys);
    pump();
  };

  const retryItem = (key: string): void => {
    if (!filesRef.current.has(key)) return;
    queueRef.current.push(key);
    pump();
  };

  const summary = summarizeUploads(items);
  const canStart =
    summary.ready >= 1 &&
    confirmedCoverAssetId !== null &&
    items.some(
      (item) =>
        item.status === "ready" && item.assetId === confirmedCoverAssetId,
    );

  const startGeneration = async (): Promise<void> => {
    if (!canStart || isStarting) return;
    setIsStarting(true);
    setStartError(null);
    try {
      const started = await client.startWorkflowRun(
        projectId,
        styleKey === null ? undefined : { styleKey },
      );
      window.localStorage.setItem(
        workflowRunStorageKey(projectId),
        started.data.workflowRunId,
      );
      router.push(`/projects/${projectId}`);
    } catch (error: unknown) {
      setStartError(
        error instanceof ApiProblemError
          ? `启动工作流失败(${error.code})。`
          : "启动工作流失败,请检查网络后重试。",
      );
      setIsStarting(false);
    }
  };

  if (projectQuery.isLoading) {
    return (
      <main className={styles.shell} aria-busy="true">
        <div className={styles.content}>
          <p className={styles.status} role="status" aria-live="polite">
            正在加载项目信息…
          </p>
        </div>
      </main>
    );
  }

  if (projectQuery.isError) {
    return (
      <main className={styles.shell}>
        <div className={styles.content}>
          <div className={styles.error} role="alert">
            <h1 className={styles.sectionTitle}>项目加载失败</h1>
            <p>无法读取项目信息,请检查网络后重试。</p>
            <button
              className={styles.button}
              type="button"
              onClick={() => void projectQuery.refetch()}
            >
              重试
            </button>
          </div>
        </div>
      </main>
    );
  }

  const projectTitle = projectQuery.data?.data.title.trim().length
    ? projectQuery.data.data.title
    : "未命名项目";

  return (
    <AppShell active="projects" context={projectTitle}>
      <main className={styles.workspace}>
        <header className={styles.pageHeader}>
          <div>
            <Link className={styles.backLink} href="/projects">
              ← 返回项目库
            </Link>
            <p className={styles.eyebrow}>Asset desk / Style catalog</p>
            <h1 className={styles.title}>{projectTitle}</h1>
            <p className={styles.intro}>
              左侧整理上传素材与封面，右侧从专业风格目录中确定系列视觉策略。
            </p>
          </div>
          <div className={styles.headerStats} aria-label="上传摘要">
            <div>
              <strong>{summary.ready}</strong>
              <span>已就绪</span>
            </div>
            <div>
              <strong>{summary.active}</strong>
              <span>处理中</span>
            </div>
            <div>
              <strong>{summary.failed}</strong>
              <span>失败</span>
            </div>
          </div>
        </header>

        <div className={styles.studioGrid}>
          <div className={styles.mediaColumn}>
            <section className={styles.panel} aria-labelledby="picker-title">
              <div className={styles.panelHeading}>
                <div>
                  <span className={styles.panelIndex}>01 / SOURCE ASSETS</span>
                  <h2 className={styles.sectionTitle} id="picker-title">
                    素材工作区
                  </h2>
                </div>
                <span className={styles.supported}>HEIC · JPEG · PNG · WEBP</span>
              </div>
              <label className={styles.dropzone} htmlFor="asset-files">
                <span className={styles.dropzoneMark} aria-hidden="true">
                  +
                </span>
                <strong>点击选择照片，或将多张素材拖放到这里</strong>
                <span>单个文件不超过 20MiB，上传后可指定一张主封面。</span>
              </label>
              <input
                className={styles.fileInput}
                id="asset-files"
                name="asset-files"
                type="file"
                multiple
                accept={ACCEPT_ATTRIBUTE}
                onChange={onFilesSelected}
              />
            </section>

            <section className={styles.panel} aria-labelledby="list-title">
              <div className={styles.panelHeading}>
                <div>
                  <span className={styles.panelIndex}>02 / ASSET QUEUE</span>
                  <h2 className={styles.sectionTitle} id="list-title">
                    素材与封面
                  </h2>
                </div>
                <span className={styles.supported}>
                  {summary.total} 个文件
                </span>
              </div>
              {items.length === 0 ? (
                <div className={styles.emptyQueue}>
                  <span aria-hidden="true">◫</span>
                  <p>素材会在这里以桌面网格呈现，并显示上传与封面状态。</p>
                </div>
              ) : (
                <>
                  <p className={styles.status} role="status" aria-live="polite">
                    {summary.ready} 个已就绪，{summary.active} 个处理中，
                    {summary.failed} 个失败。
                  </p>
                  <ul className={styles.list} aria-label="上传文件列表">
                    {items.map((item, index) => (
                      <li className={styles.item} key={item.key}>
                        <div
                          className={styles.assetPreview}
                          data-variant={index % 5}
                          aria-hidden="true"
                        >
                          <span>{String(index + 1).padStart(2, "0")}</span>
                        </div>
                        <div className={styles.itemMain}>
                          <span className={styles.itemName}>{item.fileName}</span>
                          <span className={styles.itemMeta}>
                            {formatBytes(item.bytes)} ·{" "}
                            {UPLOAD_STATUS_LABELS[item.status]}
                          </span>
                          {item.status === "failed" && (
                            <span className={styles.itemError} role="alert">
                              {item.errorMessage ?? "上传失败。"}
                            </span>
                          )}
                        </div>
                        <div className={styles.itemActions}>
                          {item.status === "ready" &&
                            item.assetId !== undefined && (
                              <label className={styles.coverChoice}>
                                <input
                                  type="radio"
                                  name="cover-asset"
                                  value={item.assetId}
                                  checked={coverAssetId === item.assetId}
                                  disabled={isSettingCover}
                                  onChange={() => {
                                    const assetId = item.assetId;
                                    if (assetId !== undefined) {
                                      void selectCover(assetId);
                                    }
                                  }}
                                />
                                设为封面
                              </label>
                            )}
                          {item.status === "failed" &&
                            filesRef.current.has(item.key) && (
                              <button
                                className={styles.button}
                                type="button"
                                onClick={() => retryItem(item.key)}
                              >
                                重试
                              </button>
                            )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {coverError !== null && (
                <p className={styles.error} role="alert">
                  {coverError}
                </p>
              )}
            </section>
          </div>

          <aside className={styles.inspector}>
            <section className={styles.panel} aria-labelledby="style-title">
              <div className={styles.panelHeading}>
                <div>
                  <span className={styles.panelIndex}>03 / STYLE STRATEGY</span>
                  <h2 className={styles.sectionTitle} id="style-title">
                    选择风格
                  </h2>
                </div>
                <span className={styles.supported}>
                  {stylePresets.length} 种
                </span>
              </div>
              <div className={styles.categoryTabs} aria-label="风格分类">
                {styleCategories.map((category) => (
                  <button
                    className={styles.categoryTab}
                    data-active={styleCategory === category || undefined}
                    key={category}
                    type="button"
                    onClick={() => setStyleCategory(category)}
                  >
                    {category}
                  </button>
                ))}
              </div>
              {stylePresetsQuery.isLoading && (
                <p className={styles.status} role="status" aria-live="polite">
                  正在加载风格列表…
                </p>
              )}
              {stylePresetsQuery.isError && (
                <div className={styles.error} role="alert">
                  <p>风格列表加载失败,不影响上传;可重试后再开始生成。</p>
                  <button
                    className={styles.button}
                    type="button"
                    onClick={() => void stylePresetsQuery.refetch()}
                  >
                    重试
                  </button>
                </div>
              )}
              {filteredStylePresets.length > 0 && (
                <div
                  className={styles.styleGroup}
                  role="radiogroup"
                  aria-label="生成风格"
                >
                  {filteredStylePresets.map((preset) => (
                    <label className={styles.styleCard} key={preset.key}>
                      <input
                        type="radio"
                        name="style-preset"
                        value={preset.key}
                        checked={styleKey === preset.key}
                        onChange={() => setStyleKey(preset.key)}
                      />
                      <span
                        className={styles.stylePreview}
                        data-preview={preset.previewStyle}
                      >
                        <span className={styles.styleCategory}>
                          {preset.category}
                        </span>
                        <span className={styles.palette}>
                          {preset.colorPalette.map((color) => (
                            <span
                              key={color}
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </span>
                      </span>
                      <span className={styles.styleBody}>
                        <span className={styles.styleName}>{preset.name}</span>
                        <span className={styles.styleDescription}>
                          {preset.description}
                        </span>
                        <span className={styles.styleMeta}>
                          适宜：{preset.recommendedFor}
                        </span>
                        <span className={styles.styleMotion}>
                          推荐动态：{preset.recommendedMotion}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </section>

            <section className={`${styles.panel} ${styles.actionPanel}`}>
              <div>
                <span className={styles.panelIndex}>04 / DISPATCH</span>
                <h2 className={styles.sectionTitle}>启动生成</h2>
                <p className={styles.hint}>
                  生成任务会异步进入 Graph 工作流，刷新页面不会创建新的运行。
                </p>
              </div>
              <button
                className={`${styles.button} ${styles.buttonPrimary}`}
                type="button"
                disabled={!canStart || isStarting}
                aria-busy={isStarting}
                onClick={() => void startGeneration()}
              >
                {isStarting ? "正在启动…" : "确认风格并开始生成"}
              </button>
              {!canStart && (
                <p className={styles.hint}>
                  至少成功上传一张图片并完成封面设置后,才能开始生成。
                </p>
              )}
              {startError !== null && (
                <p className={styles.error} role="alert">
                  {startError}
                </p>
              )}
              <p className={styles.notice}>
                最终结果以资源包形式导出，供 iOS 导入器使用；Web
                端不会把 Live Photo 直接保存到 iPhone 相册。
              </p>
            </section>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}

export default function ProjectUploadPage(): React.JSX.Element {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <UploadPanel />
    </QueryClientProvider>
  );
}
