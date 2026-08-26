"use client";

import { useEffect, useMemo, useState } from "react";
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
import { AppShell } from "../../components/app-shell/app-shell.js";
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
    <AppShell active="settings" context="生图设置">
      <main className={styles.workspace}>
        <header className={styles.pageHeader}>
          <p className={styles.eyebrow}>Settings / Provider channel</p>
          <h1 className={styles.title}>生图服务设置</h1>
          <p className={styles.intro}>
            配置个人图片模型通道。密钥只在服务器端加密存储，浏览器不会直接调用生图接口。
          </p>
        </header>

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

        {settingsQuery.isSuccess && (
          <div className={styles.settingsGrid}>
            <aside className={styles.contextPanel}>
              <span className={styles.panelIndex}>CHANNEL STATUS</span>
              <h2 className={styles.sectionTitle}>当前通道</h2>
              <div
                className={styles.channelStatus}
                data-configured={settings?.configured || undefined}
              >
                <span className={styles.statusDot} aria-hidden="true" />
                <div>
                  <strong>
                    {settings?.configured === true
                      ? "个人通道已配置"
                      : "使用服务端默认通道"}
                  </strong>
                  <p>
                    {settings?.configured === true
                      ? `${settings.model ?? DEFAULT_MODEL} · ${
                          settings.enabled === false ? "已停用" : "已启用"
                        }`
                      : "默认 mock 通道适合本地开发与无费用联调。"}
                  </p>
                </div>
              </div>
              <dl className={styles.securityList}>
                <div>
                  <dt>密钥边界</dt>
                  <dd>仅服务端 AES-256-GCM 加密存储</dd>
                </div>
                <div>
                  <dt>浏览器边界</dt>
                  <dd>前端不会持有或直连模型密钥</dd>
                </div>
                <div>
                  <dt>工作流边界</dt>
                  <dd>AI 调用只在异步 Worker 中执行</dd>
                </div>
              </dl>
              {settings?.updatedAt !== undefined && (
                <p className={styles.updatedAt}>
                  上次更新：{settings.updatedAt}
                </p>
              )}
            </aside>

            <section className={styles.panel} aria-labelledby="form-title">
              <div className={styles.panelHeader}>
                <div>
                  <span className={styles.panelIndex}>PROVIDER CONFIGURATION</span>
                  <h2 className={styles.sectionTitle} id="form-title">
                    接口配置
                  </h2>
                </div>
                <span className={styles.keyState}>
                  {settings?.configured === true
                    ? `密钥 ${settings.keyPreview ?? "已保存"}`
                    : "尚未保存密钥"}
                </span>
              </div>
              <form className={styles.form} onSubmit={onSubmit}>
                <div className={styles.field}>
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
                  <p className={styles.hint}>
                    使用 OpenAI 兼容的服务端 Base URL。
                  </p>
                </div>

                <div className={styles.field}>
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
                    密钥不会回显；每次保存都需要重新输入完整密钥。
                  </p>
                </div>

                <div className={styles.field}>
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
                  <p className={styles.hint}>
                    生产环境优先固定经过验证的模型 Snapshot。
                  </p>
                </div>

                <label className={styles.switch} htmlFor="provider-enabled">
                  <span>
                    <strong>启用该生图接口</strong>
                    <small>停用后工作流回退到服务端默认通道。</small>
                  </span>
                  <input
                    id="provider-enabled"
                    name="provider-enabled"
                    type="checkbox"
                    checked={enabled}
                    onChange={(event) => setEnabled(event.target.checked)}
                  />
                </label>

                <button
                  className={`${styles.button} ${styles.buttonPrimary}`}
                  type="submit"
                  disabled={!canSave}
                  aria-busy={saveMutation.isPending}
                >
                  {saveMutation.isPending ? "保存中…" : "保存接口设置"}
                </button>
              </form>

              {settings?.configured === true && (
                <div className={styles.dangerZone}>
                  {confirmingDelete ? (
                    <>
                      <p className={styles.hint}>
                        确认删除？删除后将回退到服务端默认通道。
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
          </div>
        )}
      </main>
    </AppShell>
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
