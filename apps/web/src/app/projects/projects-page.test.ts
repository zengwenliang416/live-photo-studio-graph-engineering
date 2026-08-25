import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const styleSource = readFileSync(
  new URL("./projects.module.css", import.meta.url),
  "utf8",
);

test("projects page renders the create form with Chinese copy and busy state", () => {
  assert.match(pageSource, /项目名称/u);
  assert.match(pageSource, /创建项目/u);
  assert.match(pageSource, /aria-busy=\{createMutation\.isPending\}/u);
  assert.match(pageSource, /disabled=\{createMutation\.isPending\}/u);
  assert.match(pageSource, /htmlFor="project-title"/u);
});

test("projects page rotates the form idempotency actionId after success", () => {
  assert.match(pageSource, /useState\(\(\) => crypto\.randomUUID\(\)\)/u);
  assert.match(pageSource, /setActionId\(crypto\.randomUUID\(\)\)/u);
  assert.match(pageSource, /createProject\(/u);
});

test("projects page loads the list through the centralized client", () => {
  assert.match(pageSource, /useQuery\(/u);
  assert.match(pageSource, /listProjects\(/u);
  assert.doesNotMatch(pageSource, /\bfetch\(/u);
});

test("projects page covers empty, loading and error states in Chinese", () => {
  assert.match(pageSource, /还没有项目/u);
  assert.match(pageSource, /正在加载项目列表/u);
  assert.match(pageSource, /role="status"/u);
  assert.match(pageSource, /aria-live="polite"/u);
  assert.match(pageSource, /role="alert"/u);
  assert.match(pageSource, /重试/u);
});

test("project cards route by cover state and label untitled projects", () => {
  assert.match(pageSource, /未命名项目/u);
  assert.match(pageSource, /coverAssetId !== null/u);
  assert.match(
    pageSource,
    /`\/projects\/\$\{project\.projectId\}\/upload`/u,
  );
  assert.match(pageSource, /zh-CN/u);
});

test("projects page styles keep a 390px single column with 44px targets", () => {
  assert.match(styleSource, /@media \(max-width: 390px\)/u);
  assert.match(styleSource, /min-height: 44px/u);
  assert.match(styleSource, /grid-template-columns: 1fr/u);
  assert.match(styleSource, /:focus-visible/u);
});
