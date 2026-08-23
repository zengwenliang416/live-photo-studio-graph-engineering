# Task Brief: 006-canary-validation

## Goal

The Graph path can be enabled for a canary and rolled back to legacy without
losing active-run recovery or overstating validation.

## Parent Artifacts

- `openspec/changes/graph-engineering-full-migration/requirements.md`
- `openspec/changes/graph-engineering-full-migration/acceptance.md`
- `openspec/changes/graph-engineering-full-migration/prototype/handoff.md`

## Vertical Slice

Record canary thresholds, rollback commands, evidence artifacts and the final
ExecPlan outcomes for all unblocked checks.

## In Scope

- Update the operations runbook and ExecPlan, capture evidence JSON, and run
  install, migration, package, Graph, integration and diff checks.

## Out Of Scope

- Deploying, pushing, changing production infrastructure or deleting old graph
  versions.

## Files Allowed

- `docs/graph-engineering`, `docs/execplans`, repository scripts and validation
  command documentation.

## Interfaces / Seams

- Feature flag controls new Graph starts; rollback preserves checkpoints and
  legacy routing while active runs finish or are audited for cancellation.

## Components To Create

- Reuse the existing ExecPlan, operations runbook, package scripts and
  migration runner.

## Components To Reuse

- Extract no new product component; evidence remains small text or JSON.

## Components To Extract

- Every claimed result has an exact command and observed outcome; unavailable
  Redis/codec/provider checks remain explicitly blocked.

## API / Data Flow Contracts

- The `GRAPH_WORKFLOW_ENABLED` flag controls new Graph starts. Rollback disables
  new Graph runs, preserves active checkpoints and routes new work to legacy;
  evidence records exact commands and leaves unavailable external checks
  explicitly blocked.

## State / Error / Empty / Loading Behavior

- Loading:
- Empty: evidence files state which external verification is unavailable.
- Error: failed checks remain visible and are not marked complete.
- Disabled: rollback command disables new Graph starts.
- Permission: production-like actions remain operator-authorized only.

## TDD Requirement

- Write or update focused behavior tests before or alongside implementation.

## Verification Commands

- `pnpm install --frozen-lockfile`
- `pnpm db:migrate`
- `pnpm check`
- `pnpm test`
- `pnpm graph:check`
- `pnpm graph:test`
- `pnpm graph:demo`
- `git diff --check`

## Stop Conditions

- Scope lock mismatch.
- Missing product, architecture, data-flow, or component decision.
- Component duplication that should be extracted.

## Unsafe Assumptions

- Do not fabricate live Redis, real provider, Docker or device-level media
  results.
