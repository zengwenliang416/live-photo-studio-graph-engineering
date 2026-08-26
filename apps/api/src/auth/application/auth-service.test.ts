import assert from "node:assert/strict";
import test from "node:test";
import type { AuthConfig } from "../../config.js";
import { ApplicationProblemError } from "../../http/problem-details.js";
import { PasswordHasher } from "../password-hasher.js";
import { InMemoryAuthStore } from "../testing/in-memory-auth-store.js";
import { AuthService } from "./auth-service.js";

const config: AuthConfig = {
  AUTH_SESSION_TTL_SECONDS: 3600,
  AUTH_MAX_SESSIONS_PER_USER: 2,
  AUTH_COOKIE_SECURE: "false",
  AUTH_ALLOWED_ORIGINS: "http://localhost:3000",
};

function fixture(now = new Date("2026-08-25T00:00:00.000Z")) {
  const store = new InMemoryAuthStore();
  let currentNow = now;
  let idCounter = 0;
  const auth = new AuthService(store, new PasswordHasher(), config, {
    now: () => currentNow,
    newUserId: () => "00000000-0000-4000-8000-000000000001",
    newSessionId: () => {
      idCounter += 1;
      return `00000000-0000-4000-8000-${String(idCounter).padStart(12, "0")}`;
    },
    newSessionToken: () => `${String(idCounter).padStart(43, "a")}`.slice(-43),
  });
  return {
    auth,
    store,
    advance(ms: number): void {
      currentNow = new Date(currentNow.getTime() + ms);
    },
  };
}

test("registration creates an authenticated session and rejects duplicate email", async () => {
  const { auth } = fixture();
  const first = await auth.register({
    email: "owner@example.com",
    password: "correct horse battery staple",
    displayName: "Owner",
  });
  assert.equal(first.response.data.user.email, "owner@example.com");
  assert.equal((await auth.authenticate(first.token)).user.userId, first.response.data.user.userId);
  await assert.rejects(
    auth.register({
      email: "owner@example.com",
      password: "another correct password",
      displayName: "Other",
    }),
    (error: unknown) =>
      error instanceof ApplicationProblemError &&
      error.code === "EMAIL_ALREADY_REGISTERED",
  );
});

test("login is generic, throttled and clears failures after success", async () => {
  const { auth, store } = fixture();
  await auth.register({
    email: "owner@example.com",
    password: "correct horse battery staple",
    displayName: "Owner",
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      auth.login({
        email: "owner@example.com",
        password: "wrong password",
      }),
      (error: unknown) =>
        error instanceof ApplicationProblemError &&
        error.code === "AUTH_INVALID_CREDENTIALS",
    );
  }
  await assert.rejects(
    auth.login({
      email: "owner@example.com",
      password: "correct horse battery staple",
    }),
    (error: unknown) =>
      error instanceof ApplicationProblemError &&
      error.code === "AUTH_LOGIN_RATE_LIMITED",
  );
  store.loginFailures.clear();
  const signedIn = await auth.login({
    email: "owner@example.com",
    password: "correct horse battery staple",
  });
  assert.equal(signedIn.response.data.user.displayName, "Owner");
  assert.equal(store.loginFailures.size, 0);
});

test("logout revokes the session and fixed expiry is enforced", async () => {
  const { auth, advance } = fixture();
  const issued = await auth.register({
    email: "owner@example.com",
    password: "correct horse battery staple",
    displayName: "Owner",
  });
  const session = await auth.authenticate(issued.token);
  await auth.logout(session.sessionId);
  await assert.rejects(
    auth.authenticate(issued.token),
    (error: unknown) =>
      error instanceof ApplicationProblemError &&
      error.code === "AUTHENTICATION_REQUIRED",
  );

  const second = await auth.login({
    email: "owner@example.com",
    password: "correct horse battery staple",
  });
  advance(3_600_001);
  await assert.rejects(auth.authenticate(second.token));
});
