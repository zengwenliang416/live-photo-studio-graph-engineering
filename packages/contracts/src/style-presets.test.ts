import assert from "node:assert/strict";
import test from "node:test";
import {
  stylePresetMetadataSchema,
  stylePresetPromptQuerySchema,
  stylePresetPromptResponseSchema,
  stylePresetSourceSchema,
  stylePresetsResponseSchema,
} from "./style-presets.js";

const source = {
  project: "onepic-template-studio",
  templateId: "framework-029",
  promptHash: "a".repeat(64),
  previewUrl: null,
} as const;

const metadata = {
  key: "cinematic-portrait",
  name: "电影感人像",
  description: "浅景深与暖金侧光。",
  version: "v1",
  category: "电影胶片",
  recommendedFor: "人像、旅行、纪实",
  recommendedMotion: "微距推近",
  colorPalette: ["#1e252b", "#a76c43", "#e9c89a"],
  previewStyle: "cinematic-film",
  source: null,
} as const;

test("style metadata accepts normalized source provenance or null", () => {
  assert.deepEqual(stylePresetSourceSchema.parse(source), source);
  assert.deepEqual(stylePresetMetadataSchema.parse(metadata), metadata);
  assert.deepEqual(
    stylePresetMetadataSchema.parse({ ...metadata, source }),
    { ...metadata, source },
  );
});

test("style list and prompt response schemas keep the data envelope", () => {
  const listResponse = stylePresetsResponseSchema.parse({
    data: { items: [metadata] },
  });
  assert.equal(listResponse.data.items[0]?.key, metadata.key);

  const promptResponse = stylePresetPromptResponseSchema.parse({
    data: {
      preset: metadata,
      prompt: "[System / Prompt]\n...",
      promptVersion: "cinematic-portrait@v1+style-extension.v1",
      promptHash: "b".repeat(64),
      referenceImageCount: 1,
    },
  });
  assert.equal(promptResponse.data.referenceImageCount, 1);
});

test("prompt query defaults to one image and enforces the inclusive 1..6 range", () => {
  assert.deepEqual(stylePresetPromptQuerySchema.parse({}), {
    referenceImageCount: 1,
  });
  assert.equal(
    stylePresetPromptQuerySchema.parse({ referenceImageCount: "6" })
      .referenceImageCount,
    6,
  );
  for (const value of [0, 7, 1.5, "not-a-number"]) {
    assert.throws(() =>
      stylePresetPromptQuerySchema.parse({ referenceImageCount: value }),
    );
  }
});
