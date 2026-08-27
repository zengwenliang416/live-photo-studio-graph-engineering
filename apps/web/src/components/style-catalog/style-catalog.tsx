"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  ApiProblemError,
  type StylePreset,
  WorkflowApiClient,
} from "../../lib/api-client.js";
import {
  ALL_STYLE_CATEGORIES,
  filterStylePresets,
  styleCategoryCounts,
} from "../../lib/style-catalog.js";
import styles from "./style-catalog.module.css";

interface StyleCatalogProps {
  readonly client: WorkflowApiClient;
  readonly presets: readonly StylePreset[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly onRetry: () => void;
  readonly selectedKey?: string | null;
  readonly onSelect?: (key: string) => void;
  readonly heading?: string;
  readonly mode?: "full" | "compact";
}

const FULL_BATCH_SIZE = 24;
const COMPACT_BATCH_SIZE = 8;

function promptErrorMessage(error: unknown): string {
  if (error instanceof ApiProblemError) {
    return `提示词读取失败（${error.code}）。`;
  }
  return "提示词读取失败，请检查网络后重试。";
}

export function StyleCatalog({
  client,
  presets,
  isLoading,
  isError,
  onRetry,
  selectedKey,
  onSelect,
  heading = "完整风格目录",
  mode = "full",
}: StyleCatalogProps): React.JSX.Element {
  const [category, setCategory] = useState(ALL_STYLE_CATEGORIES);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const batchSize =
    mode === "compact" ? COMPACT_BATCH_SIZE : FULL_BATCH_SIZE;
  const [visibleCount, setVisibleCount] = useState(batchSize);
  const [promptKey, setPromptKey] = useState<string | null>(null);
  const [referenceImageCount, setReferenceImageCount] = useState(1);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const categories = useMemo(
    () => styleCategoryCounts(presets),
    [presets],
  );
  const filtered = useMemo(
    () => filterStylePresets(presets, category, deferredQuery),
    [category, deferredQuery, presets],
  );
  const visiblePresets = filtered.slice(0, visibleCount);
  const remainingCount = Math.max(0, filtered.length - visiblePresets.length);
  const activePreset =
    promptKey === null
      ? null
      : (presets.find((preset) => preset.key === promptKey) ?? null);

  useEffect(() => {
    if (
      category !== ALL_STYLE_CATEGORIES &&
      !categories.some((item) => item.category === category)
    ) {
      setCategory(ALL_STYLE_CATEGORIES);
    }
  }, [categories, category]);

  useEffect(() => {
    setVisibleCount(batchSize);
  }, [batchSize, category, deferredQuery]);

  useEffect(() => {
    if (promptKey === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setPromptKey(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [promptKey]);

  const promptQuery = useQuery({
    queryKey: ["style-prompt", promptKey, referenceImageCount],
    queryFn: () =>
      client.getStylePresetPrompt(promptKey ?? "", referenceImageCount),
    enabled: promptKey !== null,
  });

  const openPrompt = (key: string): void => {
    setPromptKey(key);
    setCopyState("idle");
  };

  const closePrompt = (): void => {
    setPromptKey(null);
    setCopyState("idle");
  };

  const copyPrompt = async (): Promise<void> => {
    const prompt = promptQuery.data?.data.prompt;
    if (prompt === undefined) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <section
      className={styles.catalog}
      data-mode={mode}
      aria-labelledby="style-catalog-title"
    >
      <div className={styles.catalogHeader}>
        <div>
          <span className={styles.kicker}>STYLE LIBRARY / 视觉策略库</span>
          <h2 className={styles.heading} id="style-catalog-title">
            {heading}
          </h2>
          <p className={styles.summary}>
            共 {presets.length} 种风格，其中{" "}
            {presets.filter((preset) => preset.source !== null).length} 种来自
            OnePic 摄影写实模板。点击卡片选择，或查看实际发送给模型的完整提示词。
          </p>
        </div>
        <label className={styles.search}>
          <span>搜索风格</span>
          <input
            type="search"
            value={query}
            placeholder="名称、分类、适用场景或源 ID"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      <div className={styles.categoryRail} aria-label="风格分类">
        {categories.map((item) => (
          <button
            key={item.category}
            type="button"
            data-active={category === item.category || undefined}
            onClick={() => setCategory(item.category)}
          >
            <span>{item.category}</span>
            <strong>{item.count}</strong>
          </button>
        ))}
      </div>

      {isLoading && (
        <p className={styles.state} role="status" aria-live="polite">
          正在加载风格目录…
        </p>
      )}

      {isError && (
        <div className={styles.error} role="alert">
          <p>风格目录加载失败。</p>
          <button type="button" onClick={onRetry}>
            重试
          </button>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <div className={styles.resultBar}>
            <span>
              当前显示 <strong>{visiblePresets.length}</strong> /{" "}
              {filtered.length} 个匹配结果
            </span>
            {selectedKey !== undefined && selectedKey !== null && (
              <span>
                已选：
                {presets.find((preset) => preset.key === selectedKey)?.name ??
                  selectedKey}
              </span>
            )}
          </div>
          {filtered.length === 0 ? (
            <div className={styles.empty}>
              <strong>没有匹配的风格</strong>
              <span>调整搜索词或切换分类后再试。</span>
            </div>
          ) : (
            <div
              className={styles.grid}
              role={onSelect === undefined ? "list" : "radiogroup"}
              aria-label="生成风格"
            >
              {visiblePresets.map((preset) => {
                const isSelected = selectedKey === preset.key;
                return (
                  <article
                    className={styles.card}
                    data-selected={isSelected || undefined}
                    key={preset.key}
                  >
                    <div
                      className={styles.preview}
                      style={{
                        background: `linear-gradient(135deg, ${preset.colorPalette[0]}, ${preset.colorPalette[1]} 52%, ${preset.colorPalette[2]})`,
                      }}
                    >
                      {preset.source?.previewUrl !== null &&
                        preset.source?.previewUrl !== undefined && (
                          <img
                            src={preset.source.previewUrl}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            fetchPriority="low"
                            referrerPolicy="no-referrer"
                          />
                        )}
                      <span className={styles.category}>{preset.category}</span>
                      <span className={styles.palette} aria-hidden="true">
                        {preset.colorPalette.map((color) => (
                          <i key={color} style={{ backgroundColor: color }} />
                        ))}
                      </span>
                      {preset.source !== null && (
                        <span className={styles.origin}>
                          {preset.source.templateId}
                        </span>
                      )}
                    </div>
                    <div className={styles.cardBody}>
                      <div>
                        <h3>{preset.name}</h3>
                        <p>{preset.description}</p>
                      </div>
                      <dl>
                        <div>
                          <dt>适宜</dt>
                          <dd>{preset.recommendedFor}</dd>
                        </div>
                        <div>
                          <dt>动态</dt>
                          <dd>{preset.recommendedMotion}</dd>
                        </div>
                      </dl>
                      <div className={styles.cardActions}>
                        {onSelect !== undefined && (
                          <button
                            className={styles.selectButton}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            onClick={() => onSelect(preset.key)}
                          >
                            {isSelected ? "已选中" : "选择风格"}
                          </button>
                        )}
                        <button
                          className={styles.promptButton}
                          type="button"
                          onClick={() => openPrompt(preset.key)}
                        >
                          查看提示词
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {remainingCount > 0 && (
            <div className={styles.catalogFooter}>
              <span>还有 {remainingCount} 种风格未显示</span>
              <button
                type="button"
                onClick={() =>
                  setVisibleCount((count) => count + batchSize)
                }
              >
                再显示 {Math.min(batchSize, remainingCount)} 种
              </button>
            </div>
          )}
        </>
      )}

      {promptKey !== null && activePreset !== null && (
        <div className={styles.dialogBackdrop} onMouseDown={closePrompt}>
          <section
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="prompt-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className={styles.dialogHeader}>
              <div>
                <span className={styles.kicker}>COMPILED MODEL PROMPT</span>
                <h2 id="prompt-dialog-title">{activePreset.name}</h2>
                <p>
                  下方内容由服务端 `compilePrompt()` 实时编译，与 Worker
                  使用同一套 Prompt Kit。
                </p>
              </div>
              <button
                className={styles.closeButton}
                type="button"
                aria-label="关闭提示词"
                onClick={closePrompt}
              >
                ×
              </button>
            </header>

            <div className={styles.promptToolbar}>
              <label>
                <span>参考图数量</span>
                <select
                  value={referenceImageCount}
                  onChange={(event) =>
                    setReferenceImageCount(Number(event.target.value))
                  }
                >
                  {[1, 2, 3, 4, 5, 6].map((count) => (
                    <option key={count} value={count}>
                      {count} 张
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={promptQuery.data === undefined}
                onClick={() => void copyPrompt()}
              >
                {copyState === "copied"
                  ? "已复制"
                  : copyState === "failed"
                    ? "复制失败"
                    : "复制完整提示词"}
              </button>
            </div>

            {promptQuery.isLoading && (
              <p className={styles.state} role="status" aria-live="polite">
                正在编译提示词…
              </p>
            )}
            {promptQuery.isError && (
              <div className={styles.error} role="alert">
                <p>{promptErrorMessage(promptQuery.error)}</p>
                <button
                  type="button"
                  onClick={() => void promptQuery.refetch()}
                >
                  重试
                </button>
              </div>
            )}
            {promptQuery.data !== undefined && (
              <>
                <dl className={styles.promptMeta}>
                  <div>
                    <dt>Prompt Version</dt>
                    <dd>{promptQuery.data.data.promptVersion}</dd>
                  </div>
                  <div>
                    <dt>Compiled SHA-256</dt>
                    <dd>{promptQuery.data.data.promptHash}</dd>
                  </div>
                  {activePreset.source !== null && (
                    <div>
                      <dt>Source Prompt SHA-256</dt>
                      <dd>{activePreset.source.promptHash}</dd>
                    </div>
                  )}
                </dl>
                <pre className={styles.promptText}>
                  {promptQuery.data.data.prompt}
                </pre>
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
