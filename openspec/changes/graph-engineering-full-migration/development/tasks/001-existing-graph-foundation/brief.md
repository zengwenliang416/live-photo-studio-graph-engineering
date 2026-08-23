# Task Brief: 001-existing-graph-foundation

## Goal

The existing Graph workflow and its API command boundary remain stable while
the remaining migration slices are implemented.

## Parent Artifacts

- `openspec/changes/graph-engineering-full-migration/requirements.md`
- `openspec/changes/graph-engineering-full-migration/acceptance.md`
- `openspec/changes/graph-engineering-full-migration/prototype/handoff.md`

## Vertical Slice

Preserve the approved Graph registry, shared payload contracts, additive
migrations and API Outbox command boundary as the baseline flow.

## In Scope

- Review current graph/runtime/contract/API implementation and confirm the
  immutable graph binding, signal/job schemas and migration ordering.
- Record the verified baseline in the ExecPlan without broad refactoring.

## Out Of Scope

- New product behavior, provider changes, worker implementation and production
  infrastructure.

## Files Allowed

- `apps/api`, `apps/orchestrator`, `packages/database`,
  `packages/graph-contracts`, `packages/graph-runtime`, and relevant Graph
  documentation.

## Interfaces / Seams

- API writes commands and Outbox rows; the orchestrator consumes commands and
  signals; contracts remain the only cross-process schema source.

## Components To Create

- None. Keep the existing typed client, graph factories and framework-neutral
  runtime utilities.

## Components To Reuse

- Reuse existing idempotency/effect-key helpers and workflow repository ports;
  extract nothing unless duplication is demonstrated.

## Components To Extract

- `workflowRunId` binds to `graphKey + graphVersion`; command and signal
  payloads contain IDs and small values only.

## API / Data Flow Contracts

- API commands are persisted with their idempotency key and a transactional
  Outbox row; the orchestrator consumes only the typed command contract.
  Workflow queries read the projection tables, while LangGraph checkpoint rows
  remain private to the orchestrator.

## State / Error / Empty / Loading Behavior

- Loading:
- Empty: show the current workflow phase from the projection.
- Error: return stable problem codes and preserve idempotency behavior.
- Disabled: legacy routing remains selected when the Graph flag is off.
- Permission: validate `user_id + project_id` before writes.

## TDD Requirement

- Write or update focused behavior tests before or alongside implementation.

## Verification Commands

- `pnpm --filter @live-photo-studio/graph-contracts test`
- `pnpm --filter @live-photo-studio/graph-runtime test`
- `pnpm --filter @live-photo-studio/orchestrator test`

## Stop Conditions

- Scope lock mismatch.
- Missing product, architecture, data-flow, or component decision.
- Component duplication that should be extracted.

## Unsafe Assumptions

- Do not infer undocumented Graph state or add compatibility paths.
