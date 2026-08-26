import assert from "node:assert/strict";
import test from "node:test";
import { loadAuthConfig } from "./config.js";

test("production authentication requires Secure session cookies", () => {
  assert.throws(
    () =>
      loadAuthConfig({
        NODE_ENV: "production",
        AUTH_COOKIE_SECURE: "false",
      }),
    /AUTH_COOKIE_SECURE must be true/u,
  );

  const config = loadAuthConfig({
    NODE_ENV: "production",
    AUTH_COOKIE_SECURE: "true",
  });
  assert.equal(config.AUTH_COOKIE_SECURE, "true");
});
