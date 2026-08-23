# Frontend-Backend Data Flow Spec

## Overview

The client treats the API workflow projection as authoritative. User actions
create idempotent API commands; the API writes the domain/projection change and
Transactional Outbox entry in one transaction. BullMQ executes long work,
workers write facts and emit correlated signals, and the orchestrator resumes
the bound Graph run. SSE is an invalidation hint, not final state.

## Flow Index

| Flow ID | Trigger | Entry UI | API/Service | Persistence | User Result |
| --- | --- | --- | --- | --- | --- |
| `FLOW-START-WORKFLOW` | start project workflow | project page | workflow API | run + start outbox | stage changes to generation |
| `FLOW-REVIEW-ANCHOR` | select or regenerate candidate | review screen | decision API + orchestrator | human task + resume signal | render begins or bounded repair |
| `FLOW-CANCEL-WORKFLOW` | cancel workflow | project page | cancel API + orchestrator | run + cancellation event | terminal cancelled state |
| `FLOW-GENERATE` | generation command delivery | no direct UI | AI worker | batch and outputs + completion signal | candidates appear |
| `FLOW-RENDER-EXPORT` | render command delivery | export screen | media worker | render and export package + completion signal | downloadable ZIP appears |
| `FLOW-REFRESH-RECOVER` | browser refresh/reopen | project route | workflow query/SSE | projection and task query | current stage and actions restored |

## Boundary Contracts

- UI event contract: emit domain intent (`start`, `select`, `regenerate`,
  `cancel`) with IDs and no binary payload in shared state.
- Client state contract: URL owns project/run identity, TanStack Query owns
  server projections, and local component state owns transient selection and
  pending submit state.
- Request schema: centralized client sends Zod-compatible JSON and an
  `Idempotency-Key` for every write.
- Response schema: successful writes return `{ data }`; queries return bounded
  projection/task data; errors use stable code and retryability.
- Error schema: problem+json-style `{ code, message, retryable, requestId }`.
- Permission contract: API checks authenticated user ownership of project, run
  and task before any domain write.

## State Ownership

- URL state: `projectId` and, when present, `workflowRunId`.
- Local component state: candidate selection, form values, disabled/loading
  controls and modal disclosure.
- Shared client cache: TanStack Query workflow projection and human tasks.
- Server state: workflow phase/status, task payload, candidate IDs, render and
  export metadata.
- Database state: domain facts, projections, outbox, signals, checkpoints and
  audit events.
- Derived state: stage labels and permitted actions derived from server phase
  and task payload, never from multiple conflicting booleans.

## Validation Ownership

- Client-side validation: required IDs, action availability and basic lengths
  for responsive feedback.
- Server-side validation: parse all external input as `unknown`; validate
  schema, ownership, task status, correlation and selected-output relation.
- Database constraints: UUIDs, unique idempotency keys, unique signal
  correlation, effect keys and append-only event sequence.
- Cross-field or cross-entity rules: selected output must belong to the
  current task's project and generation revision; a run must use its immutable
  graph key/version.
- Error copy source: stable domain error code mapped to localized Chinese
  UI text; never expose provider or database error text.

## Error & Empty States

- Empty state: explain that no human task is pending and show the current
  workflow stage.
- Permission denied: show an access error without revealing resource details.
- Validation error: identify the field/action and leave the current projection
  unchanged.
- Network error: preserve local form state and offer safe retry.
- Server error: show request ID and a retry action only when `retryable` is true.
- Conflict/stale data: refetch the projection and explain that the task was
  already completed or cancelled.

## Loading / Optimistic / Retry Behavior

- Initial loading: show stage skeleton and accessible status text.
- Partial loading: render known projection while task/candidate data loads.
- Optimistic update: disable the submitted action; do not optimistically
  advance the workflow phase.
- Retry rule: client retries only safe reads and replays a write with the same
  idempotency key; transient execution retries belong to BullMQ.
- Cancellation rule: send one idempotent cancel command; late worker signals
  are consumed without reopening a terminal cancelled run.
- Idempotency rule: same scope/key/body replays the first response; same key
  with a different body returns conflict.
- Rollback: stop new Graph starts, preserve active checkpoints and route new
  projects to the legacy path through the feature flag; never undo a committed
  domain fact with a client retry.

## End-to-End Flow Details

### `FLOW-START-WORKFLOW`

1. The user starts the project workflow.
2. The page disables the start action and records a stable key locally.
3. The client sends graph key/version and the idempotency key.
4. API validates ownership, published graph and request schema.
5. The API inserts the run and start command in one transaction.
6. The response contains the run projection.
7. The UI follows the run route and displays generation wait.
8. Replays use the same key; queue delivery is recovered by Outbox.
9. A failed command is retryable through the durable outbox, not a second run.
10. Logs contain request/run/project IDs and duration only.

### `FLOW-REVIEW-ANCHOR`

1. The user selects, regenerates or cancels from the current task payload.
2. The UI validates that the action is allowed and disables duplicate clicks.
3. The client sends action and selected output ID when required.
4. API validates task ownership, status, payload and output relation.
5. The transaction records the decision and resume outbox.
6. The response returns the task/run projection.
7. The UI refetches and renders render wait, a new bounded task, or cancelled.
8. Same key replays; stale tasks return conflict.
9. No previous candidate or revision is overwritten.
10. The decision is audited without prompt or media bytes.

### `FLOW-GENERATE` and `FLOW-RENDER-EXPORT`

1. The outbox dispatcher publishes an ID-only BullMQ job.
2. Worker validates payload and project/run ownership.
3. Worker writes domain facts and correlated signal in one transaction.
4. The graph consumes the signal under the per-run lock and resumes once.
5. The API projection and SSE event expose the new stage.
6. Duplicate jobs/signals return existing facts and do not duplicate output or
   billing.
7. Terminal errors map to stable non-retryable product codes.
8. Logs carry external job IDs and provider request IDs without raw response.

## Async / Realtime Flows

- Queue/event source: Transactional Outbox to BullMQ command/job queues and
  `graph-signals`.
- Subscriber: orchestrator signal consumer and worker consumers.
- Retry/dead-letter behavior: BullMQ retries transient task failures; Graph
  repair loops are bounded; invalid signals are failed and audited.
- Realtime update channel: API SSE tails `workflow_events`.
- Consistency expectation: projection is eventually consistent with domain
  facts; the client refetches after every invalidation.

## Flow Do's and Don'ts

- Do keep every feature requirement traceable to a named flow.
- Do record loading, empty, error, disabled and permission states.
- Do include database and integration side effects.
- Don't let frontend and backend disagree on validation ownership.
- Don't let workers or models select arbitrary Graph nodes.
- Don't put media bytes, signed URLs, secrets or full prompts in workflow state.
