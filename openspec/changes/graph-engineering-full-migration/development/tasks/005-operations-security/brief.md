# Task Brief: 005-operations-security

## Goal

Operators can trace a workflow and investigate a stuck run without exposing
secrets, media bytes, prompts or cross-project data.

## Parent Artifacts

- `openspec/changes/graph-engineering-full-migration/requirements.md`
- `openspec/changes/graph-engineering-full-migration/acceptance.md`
- `openspec/changes/graph-engineering-full-migration/prototype/handoff.md`

## Vertical Slice

Add the smallest operational projection, structured context, redaction,
security/cost tests and triage documentation required by the Graph contracts.

## In Scope

- Propagate trace/run/project/node/job context, add bounded metrics and
  authenticated read-only triage, and test log/state redaction and ownership.

## Out Of Scope

- Production observability infrastructure, external dashboards and real
  credential provisioning.

## Files Allowed

- API/orchestrator/worker boundaries, shared contracts, tests and operations
  documentation.

## Interfaces / Seams

- API and worker logs expose IDs/durations only; admin views read projections
  and never edit checkpoint rows.

## Components To Create

- Reuse existing error mapping, repository projections and mock providers.

## Components To Reuse

- Extract shared redaction/context helpers only when multiple processes need the
  same behavior.

## Components To Extract

- Sensitive values are rejected or redacted before logs, Graph state or widget
  payloads; non-retryable provider errors do not loop.

## API / Data Flow Contracts

- Operational reads expose only projection data with trace, run, project, node
  and external-job identifiers. Repair and replay commands use an authenticated
  operator boundary and append an audit event before dispatch.

## State / Error / Empty / Loading Behavior

- Loading:
- Empty: triage explains which projection layer has no pending record.
- Error: return stable operator error codes and audit denials.
- Disabled: operational views do not enable Graph routing.
- Permission: repair and replay require the operator boundary.

## TDD Requirement

- Write or update focused behavior tests before or alongside implementation.

## Verification Commands

- `pnpm check`
- focused API, orchestrator and worker security tests
- `git diff --check`

## Stop Conditions

- Scope lock mismatch.
- Missing product, architecture, data-flow, or component decision.
- Component duplication that should be extracted.

## Unsafe Assumptions

- Do not log signed URLs, full prompts, raw provider responses, EXIF GPS or
  credentials.
