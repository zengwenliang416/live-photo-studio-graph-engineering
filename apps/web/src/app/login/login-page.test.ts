import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const styleSource = readFileSync(
  new URL("./login.module.css", import.meta.url),
  "utf8",
);

test("login page provides accessible login and registration fields", () => {
  assert.match(pageSource, /type="email"/u);
  assert.match(pageSource, /type="password"/u);
  assert.match(pageSource, /autoComplete="email"/u);
  assert.match(pageSource, /current-password/u);
  assert.match(pageSource, /new-password/u);
  assert.match(pageSource, /role="alert"/u);
  assert.match(pageSource, /aria-busy=\{isSubmitting\}/u);
});

test("login page uses the centralized cookie client and safe next routing", () => {
  assert.match(pageSource, /new WorkflowApiClient/u);
  assert.match(pageSource, /client\s*\.getAuthSession/u);
  assert.match(pageSource, /client\.login/u);
  assert.match(pageSource, /client\.register/u);
  assert.match(pageSource, /resolveSafeNext/u);
  assert.doesNotMatch(pageSource, /\blocalStorage\b/u);
  assert.doesNotMatch(pageSource, /\bfetch\(/u);
});

test("login styles preserve 390px layout and 44px controls", () => {
  assert.match(styleSource, /@media \(max-width: 390px\)/u);
  assert.match(styleSource, /min-height: 44px/u);
  assert.match(styleSource, /grid-template-columns: 1fr/u);
  assert.match(styleSource, /width: 100%/u);
});
