import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const styleSource = readFileSync(
  new URL("./settings.module.css", import.meta.url),
  "utf8",
);

test("settings page renders the provider form with labels and Chinese copy", () => {
  assert.match(pageSource, /配置生图接口/u);
  assert.match(pageSource, /接口地址/u);
  assert.match(pageSource, /API Key/u);
  assert.match(pageSource, /模型/u);
  assert.match(pageSource, /启用该生图接口/u);
  assert.match(pageSource, /保存设置/u);
  assert.match(pageSource, /删除配置/u);
  assert.match(pageSource, /htmlFor="provider-base-url"/u);
  assert.match(pageSource, /htmlFor="provider-api-key"/u);
  assert.match(pageSource, /htmlFor="provider-model"/u);
  assert.match(pageSource, /htmlFor="provider-enabled"/u);
  assert.match(pageSource, /type="url"/u);
  assert.match(pageSource, /type="password"/u);
});

test("settings page never echoes the key and states the browser boundary", () => {
  assert.match(pageSource, /密钥不会回显/u);
  assert.match(pageSource, /keyPreview/u);
  assert.match(pageSource, /浏览器不会直接调用生图接口/u);
});

test("settings page guides unconfigured users to the server default", () => {
  assert.match(pageSource, /尚未配置生图接口/u);
  assert.match(pageSource, /服务端默认\(mock\)通道/u);
});

test("settings page requires a full key before saving and double-confirms delete", () => {
  assert.match(pageSource, /apiKey\.trim\(\)\.length > 0/u);
  assert.match(pageSource, /disabled=\{!canSave\}/u);
  assert.match(pageSource, /confirmingDelete/u);
  assert.match(pageSource, /确认删除/u);
});

test("settings page uses the centralized client with status and alert regions", () => {
  assert.match(pageSource, /getImageProviderSettings/u);
  assert.match(pageSource, /putImageProviderSettings/u);
  assert.match(pageSource, /deleteImageProviderSettings/u);
  assert.match(pageSource, /role="status"/u);
  assert.match(pageSource, /aria-live="polite"/u);
  assert.match(pageSource, /role="alert"/u);
  assert.match(pageSource, /aria-busy=\{saveMutation\.isPending\}/u);
  assert.doesNotMatch(pageSource, /\bfetch\(/u);
});

test("settings page styles stay usable at 390px with 44px targets", () => {
  assert.match(styleSource, /@media \(max-width: 390px\)/u);
  assert.match(styleSource, /min-height: 44px/u);
  assert.match(styleSource, /grid-template-columns: 1fr/u);
  assert.match(styleSource, /:focus-visible/u);
});
