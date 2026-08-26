import assert from "node:assert/strict";
import test from "node:test";

import type { StylePreset } from "./api-client.js";
import {
  ALL_STYLE_CATEGORIES,
  filterStylePresets,
  styleCategoryCounts,
} from "./style-catalog.js";

const PRESETS: readonly StylePreset[] = [
  {
    key: "portrait",
    name: "电影人像",
    description: "暖色胶片肖像",
    version: "v1",
    category: "人像摄影",
    recommendedFor: "人像、旅行",
    recommendedMotion: "微距推近",
    colorPalette: ["#111111", "#777777", "#eeeeee"],
    previewStyle: "portrait",
    source: null,
  },
  {
    key: "onepic-case-1",
    name: "雨夜街头",
    description: "纪实霓虹街景",
    version: "v1",
    category: "街头纪实",
    recommendedFor: "街拍、夜景",
    recommendedMotion: "柔光呼吸",
    colorPalette: ["#101020", "#207080", "#d05070"],
    previewStyle: "onepic-case-1",
    source: {
      project: "onepic-template-studio",
      templateId: "case-1",
      promptHash: "a".repeat(64),
      previewUrl: "https://onepic.motion-cover.com/previews/case-1.webp",
    },
  },
];

test("styleCategoryCounts exposes total and stable category counts", () => {
  assert.deepEqual(styleCategoryCounts(PRESETS), [
    { category: ALL_STYLE_CATEGORIES, count: 2 },
    { category: "街头纪实", count: 1 },
    { category: "人像摄影", count: 1 },
  ]);
});

test("filterStylePresets matches category, copy and source template id", () => {
  assert.deepEqual(
    filterStylePresets(PRESETS, "街头纪实", "").map((preset) => preset.key),
    ["onepic-case-1"],
  );
  assert.deepEqual(
    filterStylePresets(PRESETS, ALL_STYLE_CATEGORIES, "胶片").map(
      (preset) => preset.key,
    ),
    ["portrait"],
  );
  assert.deepEqual(
    filterStylePresets(PRESETS, ALL_STYLE_CATEGORIES, "CASE-1").map(
      (preset) => preset.key,
    ),
    ["onepic-case-1"],
  );
});
