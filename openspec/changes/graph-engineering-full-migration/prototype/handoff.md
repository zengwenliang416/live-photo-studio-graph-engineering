# Prototype Handoff: graph-engineering-full-migration

## Approved Branch Variant

- Branch: `logic-state`
- Variant: `bounded-generation-review-render-v1`
- Approval: explicitly approved by the user in the current execution session.

## Screens Or Flows

- Start a workflow and dispatch one generation job.
- Consume one correlated generation completion and open the human review gate.
- SELECT dispatches one render job; render completion reaches COMPLETED.
- REGENERATE creates a new generation revision until the hard limit.
- CANCEL reaches CANCELLED and ignores late worker completion signals.

## Components To Create

- Workflow stage summary, human-task action group, candidate review grid and
  export boundary notice in the web projection.

## Components To Reuse

- Centralized typed API client, workflow query, human-task query and SSE
  invalidation hooks.

## Extraction Targets

- Shared task-action eligibility, workflow-stage derivation and stable
  idempotency-key utilities.

## API Contracts

- Versioned workflow-run start/query/cancel endpoints.
- Human-task decision endpoint with task-payload action and selected-output
  validation.
- Transactional Outbox command and correlated Graph signal payloads.

## Data Flows

- `FLOW-START-WORKFLOW`
- `FLOW-REVIEW-ANCHOR`
- `FLOW-CANCEL-WORKFLOW`
- `FLOW-GENERATE`
- `FLOW-RENDER-EXPORT`
- `FLOW-REFRESH-RECOVER`

## State Behavior

- Loading: show the current workflow stage and disable duplicate actions.
- Empty: show that no human task is pending and display the current phase.
- Error: show a stable error code, retryability and a safe next action.
- Disabled: hide actions not declared by the task payload.
- Permission: reject cross-project access without revealing resource details.

## Theme And Locale Policy

- Theme support: `light-only`
- Theme modes shown in prototype: `light`
- Theme toggle: intentionally omitted
- Internationalization: single `zh-CN` locale
- Locales shown in prototype: `zh-CN`
- Locale switcher: intentionally omitted

## Out Of Scope Items

- Real PhotoKit import, production credentials, chargeable model calls and
  production infrastructure changes.

## Required Tests

- Graph restart, duplicate signal, stale recovery and bounded repair tests.
- Worker phase-ownership, cross-project ownership and deterministic replay
  tests.
- API idempotency, task-payload gating, cancellation and stale conflict tests.
- Redaction, private storage, malformed signal and cost-safe provider tests.

## Open Risks

- Live Redis authentication, production HEIC/FFmpeg capability and real
  provider regression remain external verification items.
