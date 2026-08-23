# Task Brief: 004-web-projection

## Goal

The user can refresh the project page, resume review and download an export
without relying on client-held workflow truth.

## Parent Artifacts

- `openspec/changes/graph-engineering-full-migration/requirements.md`
- `openspec/changes/graph-engineering-full-migration/acceptance.md`
- `openspec/changes/graph-engineering-full-migration/prototype/handoff.md`

## Vertical Slice

Verify the web projection from URL state through typed queries, SSE
invalidation, task-payload-gated actions and export boundary copy.

## In Scope

- Add refresh/reopen and duplicate-click coverage, plus mobile-width
  accessibility and explicit web ZIP/PhotoKit boundary messaging.

## Out Of Scope

- New backend ownership rules, provider integration and direct browser access
  to storage or model APIs.

## Files Allowed

- `apps/web`, the workflow API client/hooks, relevant API contract tests and
  Graph UI documentation.

## Interfaces / Seams

- URL contains project/run identity; TanStack Query owns server projections;
  SSE invalidates queries but does not become final state.

## Components To Create

- Reuse the centralized client, query hooks, task payload types and existing
  accessible controls.

## Components To Reuse

- Extract stage derivation and action eligibility only if both project and
  review surfaces consume them.

## Components To Extract

- Writes use persisted idempotency keys; selected output IDs must be listed by
  the current task and belong to the project/revision.

## API / Data Flow Contracts

- The browser reads the workflow projection through the typed API client and
  uses SSE only to invalidate queries. Human-task actions are derived from the
  current task payload and writes reuse persisted idempotency keys.

## State / Error / Empty / Loading Behavior

- Loading:
- Empty: show current stage and no-pending-task explanation.
- Error: show stable error text and safe retry/cancel action.
- Disabled: disable duplicate submit and hide undeclared task actions.
- Permission: show access denial without revealing foreign resources.

## TDD Requirement

- Write or update focused behavior tests before or alongside implementation.

## Verification Commands

- `pnpm --filter @live-photo-studio/web test`
- `pnpm --filter @live-photo-studio/api test`
- `pnpm check`

## Stop Conditions

- Scope lock mismatch.
- Missing product, architecture, data-flow, or component decision.
- Component duplication that should be extracted.

## Unsafe Assumptions

- Do not store Blob/Base64 in shared client state or treat SSE payloads as
  authoritative workflow state.
