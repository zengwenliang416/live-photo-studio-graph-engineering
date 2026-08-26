# User Authentication ExecPlan

## 1. Purpose and user-visible outcome

Replace the demo `x-user-id` trust boundary with a production-oriented
email/password authentication flow. Users can register, sign in, restore an
HttpOnly-cookie session, sign out, and access only resources owned by their
authenticated user ID.

## 2. Progress checklist with timestamps

- [x] 2026-08-25: Inspected repository rules, active SpecNav state, current
  deployment topology, database migrations, API guard, Web API client and tests.
- [x] 2026-08-25: Added shared request/response contracts and an append-only authentication
  migration.
- [x] 2026-08-25: Implemented password hashing, session persistence, authentication routes,
  CSRF origin checks and the global session guard.
- [x] 2026-08-25: Replaced the Web demo header with credentialed cookie requests and added
  sign-in, registration, session restore and sign-out UX.
- [x] 2026-08-25: Added unit, controller, security and responsive source tests.
- [x] 2026-08-25: Ran focused checks, PostgreSQL migration verification,
  real API/browser E2E, and repository-wide build/check/test.
- [x] 2026-08-26: Deployed email authentication through GitHub and Woodpecker,
  removed production Nginx Basic Auth, and passed the public registration,
  session, protected-resource and logout smoke checks.

## 3. Surprises and discoveries

- The repository map names `packages/contracts`, but the package did not exist;
  HTTP schemas were local to API/Web while graph-only schemas lived in
  `packages/graph-contracts`.
- Existing production Basic Auth protects the canary but does not establish an
  application user. The API still accepts a caller-controlled `x-user-id`.
- Existing business tables store `user_id` as text. UUID user IDs can therefore
  be adopted without rewriting production data or historical migrations.
- macOS Headless Chrome does not honor a 390px CSS viewport from
  `--window-size` alone. CDP device metrics were required for accurate responsive
  layout measurements.
- The local runtime is Node 22.19.0 while the repository declares Node 24 or
  newer. All checks passed, but production and CI acceptance must use the
  declared Node version.

## 4. Decision log

- Use email/password credentials and opaque server-side sessions rather than a
  browser JWT. This keeps revocation authoritative and secrets out of browser
  storage.
- Use Node's built-in `scrypt` with per-password random salts. Avoiding a new
  native dependency keeps the existing container build deterministic.
- Store only SHA-256 hashes of random session tokens. A database disclosure
  does not directly yield usable cookies.
- Use HttpOnly, SameSite=Lax cookies plus Origin/Sec-Fetch-Site checks for
  unsafe requests. Production enables the Secure attribute.
- Keep password reset and email verification out of this slice because the
  repository has no outbound-email identity provider. No insecure token-return
  endpoint or fake delivery path will be added.

## 5. Outcomes and retrospective

The demo identity header is no longer part of the production authentication
boundary. Registration and login issue opaque server-side sessions through an
HttpOnly cookie; protected controllers derive `userId` from the validated
session, and cross-user resource access remains denied.

Validation completed:

- Contracts tests: 3 passed.
- API tests: 79 passed.
- Web tests: 62 passed.
- Repository-wide `pnpm check` and `pnpm test`: passed.
- API and Web production builds: passed.
- PostgreSQL 16: migrations `0000` through `0008` applied successfully, and a
  second migration run skipped all nine recorded migrations.
- Real API E2E: registration, session restore, project creation, cross-user
  denial, forged `x-user-id` rejection, cross-site request rejection and logout
  all returned the expected statuses.
- Browser E2E at a CDP-emulated 390x844 viewport: registration returned 201,
  session restore returned 200, the user reached `/projects`, logout returned
  200, and the revoked session returned 401 before redirecting to `/login`.
- Responsive measurements showed no horizontal overflow and all authentication
  inputs and buttons were at least 44px high.

Password reset and email verification remain intentionally absent until an
outbound email identity provider and secure delivery contract exist. Production
now uses application email authentication without an Nginx Basic Auth layer.

## 6. Repository context and orientation

- `packages/contracts`: shared HTTP authentication schemas.
- `packages/database/migrations`: append-only PostgreSQL schema.
- `apps/api/src/auth`: authentication application and infrastructure boundary.
- `apps/web/src/app/login`: registration and sign-in experience.
- `apps/web/src/lib/api-client.ts`: centralized cookie-authenticated API access.

## 7. Architecture invariants

- Browsers never choose or submit a business `userId`.
- Passwords and raw session tokens are never logged or persisted.
- Resource ownership remains enforced in existing application services.
- Authentication database work stays outside domain and graph packages.
- Production migration is append-only; historical migrations are untouched.

## 8. Milestones and implementation narrative

1. Establish shared schemas and persistent users, credentials, sessions and
   login throttles.
2. Replace `DemoUserGuard` with a cookie session guard and public auth routes.
3. Move Web calls to `credentials: include`, add login/register/logout, and
   redirect unauthenticated users without storing tokens client-side.
4. Prove validation, hashing, session expiry/revocation, brute-force throttling,
   cross-user denial and 390px accessibility.

## 9. Concrete commands

```bash
pnpm --filter @live-photo-studio/contracts test
pnpm --filter @live-photo-studio/api test
pnpm --filter @live-photo-studio/web test
pnpm --filter @live-photo-studio/api check
pnpm --filter @live-photo-studio/web check
pnpm --filter @live-photo-studio/web build
pnpm check
pnpm test
git diff --check
```

## 10. Validation and acceptance criteria

- Missing, unknown, expired and revoked sessions return
  `401 AUTHENTICATION_REQUIRED`.
- Registration normalizes email and rejects duplicates without exposing
  credentials.
- Login returns one generic invalid-credential error and rate-limits repeated
  failures.
- Successful auth sets an HttpOnly cookie; logout revokes and clears it.
- Browser API calls contain no `x-user-id` and include credentials.
- Existing cross-user project/asset/workflow tests continue to pass.

## 11. Idempotence, recovery and rollback

Migration `0008` uses create-if-missing statements and is recorded by the
existing migration runner. Application rollback can restore the prior image,
but a rollback to a pre-authentication image must also restore the saved Nginx
Basic Auth configuration before traffic is admitted. Database tables may remain
unused after rollback.

## 12. Interfaces and dependencies

- No new third-party runtime dependency is required.
- `@live-photo-studio/contracts` depends only on Zod.
- API auth infrastructure depends on PostgreSQL through the existing pool.

## 13. Security, privacy and cost controls

- Scrypt parameters are versioned in the stored hash.
- Session tokens use 256 bits of randomness and only their hashes are stored.
- Cookies are HttpOnly, SameSite=Lax and Secure in production.
- Unsafe cross-site browser requests are rejected.
- Login failures are throttled without logging the submitted email/password.
- Production startup rejects `AUTH_COOKIE_SECURE=false`.
- Authentication uses no paid external provider.

## 14. Artifacts and operational notes

Production must set `AUTH_COOKIE_SECURE=true`, `AUTH_ALLOWED_ORIGINS` to the
public origin and a suitable session TTL. The public Nginx route no longer
references an htpasswd file; live registration, session restoration,
authenticated project listing and logout are release smoke checks.
`GRAPH_WORKFLOW_CANARY_USER_IDS` must be empty or contain real authenticated
user UUIDs; the former `demo-user` value is not a valid account. The application
throttle is account-scoped; the trusted production ingress must also enforce an
IP-level rate limit for authentication endpoints rather than deriving client
identity from untrusted forwarding headers inside the API.
