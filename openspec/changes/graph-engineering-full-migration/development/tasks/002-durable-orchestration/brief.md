# Task Brief: 002-durable-orchestration

## Goal

The user sees one correct workflow transition when the orchestrator restarts or
receives duplicate, stale or incorrectly correlated signals.

## Parent Artifacts

- `openspec/changes/graph-engineering-full-migration/requirements.md`
- `openspec/changes/graph-engineering-full-migration/acceptance.md`
- `openspec/changes/graph-engineering-full-migration/prototype/handoff.md`

## Vertical Slice

Complete the durable resume and signal boundary from a worker completion or
human decision through the per-run lock to the Graph transition.

## In Scope

- Add bounded REGENERATE exhaustion, wrong-correlation rejection, late-signal
  handling, duplicate START coverage and Outbox payload/event-only tests.

## Out Of Scope

- Worker provider behavior, real Redis authentication and new production
  orchestration processes.

## Files Allowed

- `apps/orchestrator`, `apps/api`, `packages/graph-contracts`, and focused
  Graph/Outbox tests.

## Interfaces / Seams

- The signal row is claimed with visibility timeout, validated against the
  pending job/task and resumed under the workflow-run advisory lock.

## Components To Create

- Reuse `GraphEngine`, repository signal state, existing effect keys and
  current graph node definitions.

## Components To Reuse

- Extract no new abstraction unless a duplicate transition or correlation
  validator is demonstrated.

## Components To Extract

- Duplicate delivery is a no-op; stale processing is recoverable; terminal
  phases consume late signals without reopening the run.

## API / Data Flow Contracts

- A signal is accepted only after Zod validation, per-run locking, pending-job
  correlation and one-time consumption. Duplicate deliveries are no-ops;
  stale processing rows are reclaimed after the visibility timeout.

## State / Error / Empty / Loading Behavior

- Loading:
- Empty: no pending task means the projection remains authoritative.
- Error: invalid correlation is non-retryable; transient failures remain
  recoverable.
- Disabled: no Graph transition is attempted when the flag selects legacy.
- Permission: only the run owner or audited operator can issue a command.

## TDD Requirement

- Write or update focused behavior tests before or alongside implementation.

## Verification Commands

- `pnpm --filter @live-photo-studio/orchestrator test`
- `RUN_PG_TESTS=1 pnpm --filter @live-photo-studio/orchestrator test`
- `pnpm --filter @live-photo-studio/api test`

## Stop Conditions

- Scope lock mismatch.
- Missing product, architecture, data-flow, or component decision.
- Component duplication that should be extracted.

## Unsafe Assumptions

- Do not multiply retry ownership across Graph, BullMQ and provider layers.
