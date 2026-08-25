"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ApiProblemError,
  WorkflowApiClient,
} from "../../lib/api-client.js";
import styles from "./settings.module.css";

const DEFAULT_MODEL = "gpt-image-2";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiProblemError) return `${fallback}(${error.code})。`;
  return `${fallback},请稍后重试。`;
}

function SettingsPanel(): React.JSX.Element {
  const client = useMemo(() => new WorkflowApiClient(), []);
  const queryClient = useQueryClient();
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [enabled, setEnabled] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["settings", "image-provider"],
    queryFn: () => client.getImageProviderSettings(),
  });

  const settings = settingsQuery.data?.data;

  // Populate the form from the server snapshot; the apiKey box always stays
  // empty because the key is never returned in plaintext.
  useEffect(() => {
    if (!settings?.configured) return;
    setBaseUrl((prev) => (prev.length > 0 ? prev : (settings.baseUrl ?? "")));
    setModel((prev) =>
      prev !== DEFAULT_MODEL ? prev : (settings.model ?? DEFAULT_MODEL),
    );
    setEnabled(settings.enabled ?? true);
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () =>
      client.putImageProviderSettings({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
        enabled,
      }),
    onSuccess: () => {
      setApiKey("");
      setNotice("生图接口设置已保存。");
      setFormError(null);
      void queryClient.invalidateQueries({
        queryKey: ["settings", "image-provider"],
      });
    },
    onError: (error: unknown) => {
      setNotice(null);
      setFormError(errorMessage(error, "保存失败"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => client.deleteImageProviderSettings(),
    onSuccess: () => {
      setBaseUrl("");
      setApiKey("");
      setModel(DEFAULT_MODEL);
      setEnabled(true);
      setConfirmingDelete(false);
      setNotice("已删除生图接口配置,将使用服务端默认通道。");
      setFormError(null);
      void queryClient.invalidateQueries({
        queryKey: ["settings", "image-provider"],
      });
    },
    onError: (error: unknown) => {
      setConfirmingDelete(false);
      setNotice(null);
      setFormError(errorMessage(error, "删除失败"));
    },
  });

  const isBusy = saveMutation.isPending || deleteMutation.isPending;
  const canSave =
    !isBusy &&
    baseUrl.trim().length > 0 &&
    apiKey.trim().length > 0 &&
    model.trim().length > 0;

  const onSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!canSave) return;
    saveMutation.mutate();
  };

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand} aria-label="Live Photo Studio">
          <span className={styles.brandMark} aria-hidden="true">
            ◌
          </span>
          <span className={styles.brandName}>Live Photo Studio</span>
        </div>
        <Link className={styles.backLink} href="/projects">
          返回项目列表
        </Link>
      </header>

      <div className={styles.content}>
        <p className={styles.eyebrow}>生图设置</p>
        <h1 className={styles.title}>配置生图接口。</h1>
        <p className={styles.intro}>
          密钥仅在你的服务器端加密存储,浏览器不会直接调用生图接口。
        </p>

        {settingsQuery.isLoading && (
          <p className={styles.status} role="status" aria-live="polite">
            正在读取当前配置…
          </p>
        )}

        {settingsQuery.isError && (
          <div className={styles.error} role="alert">
            <p>配置读取失败,请检查网络后重试。</p>
            <button
              className={styles.button}
              type="button"
              onClick={() => void settingsQuery.refetch()}
            >
              重试
            </button>
          </div>
        )}

        {settingsQuery.isSuccess && settings?.configured === false && (
          <p className={styles.empty}>
            尚未配置生图接口。未配置时将使用服务端默认(mock)通道,适合本地开发与联调;接入真实图片模型前请先在下方完成配置。
          </p>
        )}

        {settingsQuery.isSuccess && (
          <section className={styles.panel} aria-labelledby="form-title">
            <h2 className={styles.sectionTitle} id="form-title">
              接口配置
            </h2>
            <form className={styles.form} onSubmit={onSubmit}>
              <label className={styles.label} htmlFor="provider-base-url">
                接口地址
              </label>
              <input
                className={styles.input}
                id="provider-base-url"
                name="provider-base-url"
                type="url"
                required
                placeholder="https://api.example.com/v1"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
              />

              <label className={styles.label} htmlFor="provider-api-key">
                API Key
              </label>
              <input
                className={styles.input}
                id="provider-api-key"
                name="provider-api-key"
                type="password"
                required
                autoComplete="off"
                placeholder={
                  settings?.configured === true && settings.keyPreview
                    ? `当前密钥:${settings.keyPreview}`
                    : "输入完整的 API Key"
                }
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
              <p className={styles.hint}>
                密钥不会回显;每次保存都需要重新输入完整密钥。
              </p>

              <label className={styles.label} htmlFor="provider-model">
                模型
              </label>
              <input
                className={styles.input}
                id="provider-model"
                name="provider-model"
                type="text"
                required
                placeholder={DEFAULT_MODEL}
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />

              <label className={styles.switch} htmlFor="provider-enabled">
                <input
                  id="provider-enabled"
                  name="provider-enabled"
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                启用该生图接口
              </label>

              {settings?.updatedAt !== undefined && (
                <p className={styles.hint}>
                  上次更新:{settings.updatedAt}
                </p>
              )}

              <button
                className={`${styles.button} ${styles.buttonPrimary}`}
                type="submit"
                disabled={!canSave}
                aria-busy={saveMutation.isPending}
              >
                {saveMutation.isPending ? "保存中…" : "保存设置"}
              </button>
            </form>

            {settings?.configured === true && (
              <div className={styles.dangerZone}>
                {confirmingDelete ? (
                  <>
                    <p className={styles.hint}>
                      确认删除?删除后将回退到服务端默认通道。
                    </p>
                    <div className={styles.dangerActions}>
                      <button
                        className={`${styles.button} ${styles.buttonDanger}`}
                        type="button"
                        disabled={isBusy}
                        aria-busy={deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate()}
                      >
                        {deleteMutation.isPending ? "删除中…" : "确认删除"}
                      </button>
                      <button
                        className={styles.button}
                        type="button"
                        disabled={isBusy}
                        onClick={() => setConfirmingDelete(false)}
                      >
                        取消
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    className={styles.button}
                    type="button"
                    disabled={isBusy}
                    onClick={() => setConfirmingDelete(true)}
                  >
                    删除配置
                  </button>
                )}
              </div>
            )}

            {notice !== null && (
              <p className={styles.notice} role="status" aria-live="polite">
                {notice}
              </p>
            )}
            {formError !== null && (
              <p className={styles.error} role="alert">
                {formError}
              </p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

export default function SettingsPage(): React.JSX.Element {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsPanel />
    </QueryClientProvider>
  );
}
