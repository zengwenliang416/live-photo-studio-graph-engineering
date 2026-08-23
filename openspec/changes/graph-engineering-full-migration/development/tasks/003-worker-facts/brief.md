# Task Brief: 003-worker-facts

## Goal

Generated candidates and export packages are created once, and workers report
facts without writing Graph-path phases.

## Parent Artifacts

- `openspec/changes/graph-engineering-full-migration/requirements.md`
- `openspec/changes/graph-engineering-full-migration/acceptance.md`
- `openspec/changes/graph-engineering-full-migration/prototype/handoff.md`

## Vertical Slice

Complete the AI and media worker fact/signal boundary, including PostgreSQL
integration seeds, ownership checks and phase-ownership regression assertions.

## In Scope

- Cast integration seed parameters consistently, assert `current_phase` is
  unchanged around worker execution, and cover duplicate/cross-project jobs.

## Out Of Scope

- Real provider credentials, production media codecs and object-storage upload.

## Files Allowed

- `apps/worker-ai`, `apps/worker-media`, `packages/database`,
  `packages/graph-contracts`, and their integration tests.

## Interfaces / Seams

- Workers validate IDs and ownership, write facts, then emit one correlated
  completion/failure signal through the transactional boundary.

## Components To Create

- Reuse the provider and renderer ports, deterministic output/package IDs and
  existing mock/fake adapters.

## Components To Reuse

- Keep domain facts and workflow routing separate; do not add worker phase
  helpers.

## Components To Extract

- Job payloads contain IDs, versions and small configuration; no media bytes,
  Base64, signed URLs or provider responses enter Graph state.

## API / Data Flow Contracts

- Worker jobs carry IDs, versions and bounded configuration. The worker commits
  the domain fact before publishing one correlated completion or failure signal
  through the transactional boundary; no worker write changes the Graph phase.

## State / Error / Empty / Loading Behavior

- Loading:
- Empty: duplicate delivery reuses the existing fact.
- Error: invalid input/content rejection is non-retryable and mapped to a
  stable product code.
- Disabled: the legacy path remains independent of Graph signals.
- Permission: workflow run, project and output ownership are checked together.

## TDD Requirement

- Write or update focused behavior tests before or alongside implementation.

## Verification Commands

- `RUN_PG_TESTS=1 pnpm --filter @live-photo-studio/worker-ai test`
- `RUN_PG_TESTS=1 pnpm --filter @live-photo-studio/worker-media test`
- `pnpm --filter @live-photo-studio/worker-ai test`
- `pnpm --filter @live-photo-studio/worker-media test`

## Stop Conditions

- Scope lock mismatch.
- Missing product, architecture, data-flow, or component decision.
- Component duplication that should be extracted.

## Unsafe Assumptions

- Do not use real provider calls or claim HEIC/FFmpeg/device acceptance without
  the required external runtime.
