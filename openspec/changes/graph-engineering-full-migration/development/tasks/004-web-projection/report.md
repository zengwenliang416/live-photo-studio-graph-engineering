# Task Report: 004-web-projection

## Status

DONE_WITH_CONCERNS

## Files Changed

- Reviewed the route-bound project page, workflow/task hooks, SSE invalidation
  hook, centralized API client, API projection contract, and web/API tests.

## What Changed

- The page now uses the route project id and persists the workflow run id for
  refresh/reopen behavior.
- Query projections drive stage and pending-task state; SSE only invalidates
  queries. Review actions are filtered by the server task payload and writes
  reuse persisted idempotency keys.
- Candidate output ids are exposed through the API task projection and are
  submitted with SELECT decisions.

## TDD Evidence

- `pnpm --filter @live-photo-studio/web test` passed 4 tests.
- `pnpm --filter @live-photo-studio/api test` passed 19 tests.
- `pnpm check` passed build and TypeScript checks.

## Verification Commands

- `pnpm --filter @live-photo-studio/web test`
- `pnpm --filter @live-photo-studio/api test`
- `pnpm check`
- `git diff --check`

## Concerns

- The page does not yet show explicit copy separating a downloadable ZIP from
  a Live Photo already saved to the Photos library.
- No browser-based 390px accessibility or refresh/reopen E2E evidence was
  executed.
- The worktree is dirty and task acceptance has no signed receipt.

## Scope Deviations

- No web or API source file was edited by this handoff cleanup.

## Follow-up Needed

- Add the export-boundary notice, run mobile sensory and refresh/reopen checks,
  then bind results to task acceptance evidence.

## Adjudication

Projection and action gating are locally evidenced, but the user-visible
export boundary and sensory acceptance remain needs-fix.

## Stable Snapshot Revalidation (2026-08-23)

The complete Web suite passed 13/13. The complete API suite passed 30/30 and
the PostgreSQL-backed API suite passed 33/33. The repair includes stored-run
project validation, task-payload action gating, centralized export download
client behavior and explicit Web ZIP versus future iOS Importer copy.

The report remains `DONE_WITH_CONCERNS`: no real browser sensory E2E or
390px device run was executed, and the default object-storage signer still
fails closed until a private storage adapter is configured.
