import type { StylePreset } from "./api-client.js";

export const ALL_STYLE_CATEGORIES = "全部风格";

export interface StyleCategoryCount {
  readonly category: string;
  readonly count: number;
}

export function styleCategoryCounts(
  presets: readonly StylePreset[],
): readonly StyleCategoryCount[] {
  const counts = new Map<string, number>();
  for (const preset of presets) {
    counts.set(preset.category, (counts.get(preset.category) ?? 0) + 1);
  }
  return [
    { category: ALL_STYLE_CATEGORIES, count: presets.length },
    ...Array.from(counts, ([category, count]) => ({ category, count })).sort(
      (left, right) =>
        right.count - left.count ||
        left.category.localeCompare(right.category, "zh-CN"),
    ),
  ];
}

export function filterStylePresets(
  presets: readonly StylePreset[],
  category: string,
  query: string,
): readonly StylePreset[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  return presets.filter((preset) => {
    if (
      category !== ALL_STYLE_CATEGORIES &&
      preset.category !== category
    ) {
      return false;
    }
    if (normalizedQuery.length === 0) return true;
    return [
      preset.name,
      preset.description,
      preset.category,
      preset.recommendedFor,
      preset.source?.templateId ?? "",
    ].some((value) =>
      value.toLocaleLowerCase("zh-CN").includes(normalizedQuery),
    );
  });
}
