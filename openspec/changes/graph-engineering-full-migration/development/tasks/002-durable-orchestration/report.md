# Task Report: 002-durable-orchestration

## Status

DONE_WITH_CONCERNS

## Files Changed

- Reviewed `apps/orchestrator/src/application/graph-engine.ts`,
  `apps/orchestrator/src/graphs/live-photo-project/`,
  `apps/orchestrator/src/graph-engine.integration.test.ts`, and the API
  Outbox dispatcher/service changes in the shared dirty worktree.

## What Changed

- The current tests and implementation cover per-run locking, duplicate
  START/completion delivery, stale signal recovery, wrong correlation,
  cancellation followed by a late worker signal, bounded REGENERATE, and
  event-only/malformed Outbox routing.
- Graph-path phase transitions remain in the orchestrator; worker completion
  is represented as a correlated signal.

## TDD Evidence

- `pnpm --filter @live-photo-studio/orchestrator test` passed 4 tests without
  PostgreSQL.
- `RUN_PG_TESTS=1 pnpm --filter @live-photo-studio/orchestrator test` passed
  11 tests, including restart, duplicate, stale-recovery, correlation, and
  version-binding cases.
- `pnpm --filter @live-photo-studio/api test` passed 19 tests, including
  malformed payload and event-only delivery cases.

## Verification Commands

- `pnpm --filter @live-photo-studio/orchestrator test`
- `RUN_PG_TESTS=1 pnpm --filter @live-photo-studio/orchestrator test`
- `pnpm --filter @live-photo-studio/api test`
- `pnpm graph:demo` (failed in the human-review resume path because the demo
  payload omitted `correlationId`)

## Concerns

- `pnpm graph:demo` is a reproducible runtime failure and prevents claiming
  the documented demo path is complete.
- The parent A1 restart/duplicate assertion remains `failing` until the
  verification stage records its own evidence.
- The source owner is still changing the implementation, so task acceptance
  cannot be signed against this worktree.

## Scope Deviations

- No source or ExecPlan files were edited by this handoff cleanup.

## Follow-up Needed

- Correct the demo human-task resume payload, rerun the demo, and obtain signed
  verification evidence on a stable source revision.

## Adjudication

Passing focused and PostgreSQL tests do not override the failed demo or the
missing verification receipt; the task remains needs-fix.
