import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("./projects/[projectId]/page.tsx", import.meta.url),
  "utf8",
);
const styleSource = readFileSync(
  new URL("./projects/[projectId]/project-workflow.module.css", import.meta.url),
  "utf8",
);

test("project page states the Web ZIP and Photos-library boundary", () => {
  assert.match(pageSource, /iOS 导入器/u);
  assert.match(pageSource, /不会直接在 iPhone/u);
  assert.match(pageSource, /照片图库/u);
});

test("project page keeps workflow authority on the server", () => {
  assert.match(pageSource, /Server projection/u);
  assert.match(pageSource, /resolveWorkflowRunId/u);
  assert.match(pageSource, /getLatestExportDownload/u);
  assert.match(pageSource, /allowedActions\.includes\("CANCEL"\)/u);
  assert.doesNotMatch(pageSource, /mockWorkflowOrchestrator|DemoZipBuilder|indexedDB/u);
});

test("desktop workbench and mobile accessibility evidence are both present", () => {
  assert.match(styleSource, /grid-template-columns: minmax\(0, 1\.4fr\)/u);
  assert.match(styleSource, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/u);
  assert.match(styleSource, /@media \(max-width: 390px\)/u);
  assert.match(styleSource, /min-height: 44px/u);
  assert.match(styleSource, /:focus-visible/u);
  assert.match(styleSource, /prefers-reduced-motion/u);
});
