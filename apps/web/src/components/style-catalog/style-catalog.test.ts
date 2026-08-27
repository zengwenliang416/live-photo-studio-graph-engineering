import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./style-catalog.tsx", import.meta.url), "utf8");
const css = readFileSync(
  new URL("./style-catalog.module.css", import.meta.url),
  "utf8",
);

test("style catalog supports search, category counts and selection", () => {
  assert.match(source, /useDeferredValue/u);
  assert.match(source, /styleCategoryCounts/u);
  assert.match(source, /filterStylePresets/u);
  assert.match(source, /type="search"/u);
  assert.match(source, /"radiogroup"/u);
  assert.match(source, /role="radio"/u);
  assert.match(source, /aria-checked/u);
  assert.match(source, /data-mode=\{mode\}/u);
  assert.match(source, /COMPACT_BATCH_SIZE = 8/u);
  assert.match(source, /FULL_BATCH_SIZE = 24/u);
  assert.match(source, /visiblePresets/u);
  assert.match(source, /再显示/u);
});

test("style catalog exposes the actual compiled model prompt", () => {
  assert.match(source, /getStylePresetPrompt/u);
  assert.match(source, /查看提示词/u);
  assert.match(source, /role="dialog"/u);
  assert.match(source, /promptVersion/u);
  assert.match(source, /promptHash/u);
  assert.match(source, /Source Prompt SHA-256/u);
  assert.match(source, /复制完整提示词/u);
  assert.match(source, /referenceImageCount/u);
});

test("style catalog uses a desktop grid and remains usable at 390px", () => {
  assert.match(
    css,
    /grid-template-columns: repeat\(auto-fill, minmax\(230px, 1fr\)\)/u,
  );
  assert.match(css, /@media \(max-width: 390px\)/u);
  assert.match(css, /min-height: 44px/u);
  assert.match(css, /grid-template-columns: 1fr/u);
  assert.match(css, /:focus-visible/u);
  assert.match(css, /content-visibility: auto/u);
  assert.match(css, /contain-intrinsic-size: 330px/u);
  assert.match(css, /\.catalog\[data-mode="compact"\]/u);
  assert.match(css, /container: compact-style-catalog \/ inline-size/u);
  assert.match(css, /@container compact-style-catalog \(min-width: 620px\)/u);
  assert.match(css, /grid-template-columns: 128px minmax\(0, 1fr\)/u);
  assert.match(css, /position: absolute/u);
});
