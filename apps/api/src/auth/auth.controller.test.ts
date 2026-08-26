import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { AuthConfig } from "../config.js";
import { ProblemDetailsFilter } from "../http/problem-details.filter.js";
import { WORKFLOW_TOKENS } from "../workflows/workflow-tokens.js";
import { AuthModule } from "./auth.module.js";
import { AUTH_TOKENS } from "./auth-tokens.js";
import { RequestOriginGuard } from "./request-origin.guard.js";
import { SessionAuthGuard } from "./session-auth.guard.js";
import { InMemoryAuthStore } from "./testing/in-memory-auth-store.js";

process.env["DATABASE_URL"] ??= "postgresql://unittest:invalid@localhost:5/db";
process.env["REDIS_URL"] ??= "redis://unittest.invalid:6379";

const config: AuthConfig = {
  AUTH_SESSION_TTL_SECONDS: 3600,
  AUTH_MAX_SESSIONS_PER_USER: 2,
  AUTH_COOKIE_SECURE: "false",
  AUTH_ALLOWED_ORIGINS: "http://localhost:3000",
};

@Module({
  imports: [AuthModule],
  providers: [
    RequestOriginGuard,
    SessionAuthGuard,
    { provide: APP_GUARD, useExisting: RequestOriginGuard },
    { provide: APP_GUARD, useExisting: SessionAuthGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
class AuthTestModule {}

async function createApp() {
  const store = new InMemoryAuthStore();
  const moduleRef = await Test.createTestingModule({
    imports: [AuthTestModule],
  })
    .overrideProvider(AUTH_TOKENS.config)
    .useValue(config)
    .overrideProvider(AUTH_TOKENS.store)
    .useValue(store)
    .overrideProvider(WORKFLOW_TOKENS.pool)
    .useValue({})
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, store };
}

function expectProblem(
  response: {
    status: number;
    headers: Record<string, unknown>;
    body: Record<string, unknown>;
  },
  status: number,
  code: string,
): void {
  assert.equal(response.status, status);
  assert.match(
    String(response.headers["content-type"]),
    /application\/problem\+json/u,
  );
  assert.equal(response.body["code"], code);
}

test("register, restore session and logout use an HttpOnly cookie", async () => {
  const { app } = await createApp();
  const agent = request.agent(app.getHttpServer());
  const registered = await agent
    .post("/v1/auth/register")
    .set("Origin", "http://localhost:3000")
    .send({
      email: "Owner@Example.com",
      password: "correct horse battery staple",
      displayName: "Owner",
    });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.data.user.email, "owner@example.com");
  const cookie = String(registered.headers["set-cookie"]);
  assert.match(cookie, /lps_session=/u);
  assert.match(cookie, /HttpOnly/u);
  assert.match(cookie, /SameSite=Lax/u);
  assert.doesNotMatch(cookie, /Secure/u);

  const session = await agent.get("/v1/auth/session");
  assert.equal(session.status, 200);
  assert.equal(session.body.data.user.displayName, "Owner");
  assert.match(session.body.data.expiresAt, /Z$/u);

  const signedOut = await agent
    .post("/v1/auth/logout")
    .set("Origin", "http://localhost:3000");
  assert.equal(signedOut.status, 200);
  assert.equal(signedOut.body.data.signedOut, true);
  assert.match(String(signedOut.headers["set-cookie"]), /Max-Age=0/u);

  const afterLogout = await agent.get("/v1/auth/session");
  expectProblem(afterLogout, 401, "AUTHENTICATION_REQUIRED");
  await app.close();
});

test("the legacy identity header cannot bypass cookie authentication", async () => {
  const { app } = await createApp();
  const spoofed = await request(app.getHttpServer())
    .get("/v1/auth/session")
    .set("x-user-id", "demo-user");
  expectProblem(spoofed, 401, "AUTHENTICATION_REQUIRED");

  const tampered = await request(app.getHttpServer())
    .get("/v1/auth/session")
    .set("Cookie", `lps_session=${"x".repeat(43)}`);
  expectProblem(tampered, 401, "AUTHENTICATION_REQUIRED");
  await app.close();
});

test("unsafe cross-site requests are rejected before authentication work", async () => {
  const { app, store } = await createApp();
  const response = await request(app.getHttpServer())
    .post("/v1/auth/register")
    .set("Origin", "https://evil.example")
    .set("Sec-Fetch-Site", "cross-site")
    .send({
      email: "owner@example.com",
      password: "correct horse battery staple",
      displayName: "Owner",
    });
  expectProblem(response, 403, "CSRF_REQUEST_REJECTED");
  assert.equal(store.identities.size, 0);
  await app.close();
});

test("duplicate registration is a stable conflict without credential details", async () => {
  const { app } = await createApp();
  const body = {
    email: "owner@example.com",
    password: "correct horse battery staple",
    displayName: "Owner",
  };
  const first = await request(app.getHttpServer())
    .post("/v1/auth/register")
    .set("Origin", "http://localhost:3000")
    .send(body);
  assert.equal(first.status, 201);
  const duplicate = await request(app.getHttpServer())
    .post("/v1/auth/register")
    .set("Origin", "http://localhost:3000")
    .send(body);
  expectProblem(duplicate, 409, "EMAIL_ALREADY_REGISTERED");
  assert.doesNotMatch(JSON.stringify(duplicate.body), /password|scrypt/u);
  await app.close();
});
