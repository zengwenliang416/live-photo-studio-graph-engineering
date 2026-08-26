import assert from "node:assert/strict";
import test from "node:test";
import {
  loginRequestSchema,
  registerRequestSchema,
} from "./auth.js";

test("registration normalizes email and trims the display name", () => {
  const parsed = registerRequestSchema.parse({
    email: "  Owner@Example.COM ",
    password: "correct horse battery staple",
    displayName: "  老大  ",
  });
  assert.equal(parsed.email, "owner@example.com");
  assert.equal(parsed.displayName, "老大");
});

test("registration rejects weak passwords and unknown fields", () => {
  assert.throws(() =>
    registerRequestSchema.parse({
      email: "owner@example.com",
      password: "short",
      displayName: "Owner",
    }),
  );
  assert.throws(() =>
    registerRequestSchema.parse({
      email: "owner@example.com",
      password: "correct horse battery staple",
      displayName: "Owner",
      role: "admin",
    }),
  );
});

test("login accepts an existing password without enforcing new-password length", () => {
  const parsed = loginRequestSchema.parse({
    email: "owner@example.com",
    password: "legacy-password",
  });
  assert.equal(parsed.password, "legacy-password");
});
