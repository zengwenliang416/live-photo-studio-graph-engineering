import assert from "node:assert/strict";
import test from "node:test";
import { resolveSafeNext } from "./auth-session.js";

test("safe next accepts only same-origin relative application paths", () => {
  assert.equal(resolveSafeNext("/projects/123?tab=review"), "/projects/123?tab=review");
  assert.equal(resolveSafeNext("https://evil.example"), "/projects");
  assert.equal(resolveSafeNext("//evil.example/path"), "/projects");
  assert.equal(resolveSafeNext("/\\evil.example"), "/projects");
  assert.equal(resolveSafeNext("/%2e%2e//evil.example"), "/projects");
  assert.equal(resolveSafeNext(null), "/projects");
});
