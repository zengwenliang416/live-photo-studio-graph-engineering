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
  assert.match(pageSource, /future iOS Importer/u);
  assert.match(pageSource, /does not save a Live Photo directly/u);
  assert.match(pageSource, /Photos library/u);
});

test("project page keeps workflow authority on the server", () => {
  assert.match(pageSource, /server projection/u);
  assert.match(pageSource, /resolveWorkflowRunId/u);
  assert.doesNotMatch(pageSource, /mockWorkflowOrchestrator|DemoZipBuilder|indexedDB/u);
});

test("mobile accessibility and focus evidence is present in the scoped design module", () => {
  assert.match(styleSource, /@media \(max-width: 390px\)/u);
  assert.match(styleSource, /min-height: 44px/u);
  assert.match(styleSource, /:focus-visible/u);
  assert.match(styleSource, /prefers-reduced-motion/u);
});
