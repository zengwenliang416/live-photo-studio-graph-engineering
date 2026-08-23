## ADDED Requirements

### Requirement: Task-payload-gated human review

The API and web client MUST expose only the actions declared by the current
human-task payload and MUST verify selected output ownership against the
workflow project.

#### Scenario: Select a valid candidate

- **WHEN** the user selects an output ID listed in the pending task payload
- **THEN** the decision is accepted once and the graph dispatches render

#### Scenario: Select a foreign candidate

- **WHEN** the user submits an output ID from another project or revision
- **THEN** the API rejects the decision without changing the task or run

### Requirement: Durable cancellation

Cancellation MUST be idempotent, MUST cancel pending human tasks, and MUST
prevent late worker signals from reopening the run.

#### Scenario: Duplicate cancel request

- **WHEN** the same cancellation command is retried with the same idempotency
  key
- **THEN** the first response is replayed and only one cancellation transition
  is recorded

#### Scenario: Cancelled run receives a late signal

- **WHEN** a cancelled run receives a valid generation or render completion
  signal
- **THEN** the signal is consumed as not applicable and no result is displayed

### Requirement: Deterministic export package

The media path MUST produce a traceable export manifest with schema and recipe
versions, hashes, durations and resource types without storing binary media in
Graph state or PostgreSQL.

#### Scenario: Export succeeds

- **WHEN** a selected output is rendered successfully
- **THEN** one export package and one completion signal are persisted with a
  stable hash and manifest

#### Scenario: Render fails permanently

- **WHEN** the renderer reports a non-retryable failure
- **THEN** one failure fact and one correlated failure signal are persisted and
  the graph enters its failure branch
