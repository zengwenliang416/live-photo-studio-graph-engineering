## ADDED Requirements

### Requirement: Traceable workflow observability

API, Outbox, queue, orchestrator and workers MUST propagate
`traceId`, `workflowRunId`, `projectId`, node identity, external job ID and
provider request ID where available, without logging secrets or sensitive media
content.

#### Scenario: Trace follows a successful run

- **WHEN** a workflow starts and reaches export
- **THEN** the operational evidence can correlate the start, node, queue,
  worker, signal and export records through stable IDs

#### Scenario: Sensitive value reaches a logger

- **WHEN** an error contains a secret, signed URL, Base64, full prompt or raw
  provider response
- **THEN** the logger emits a redacted safe event instead of the sensitive
  value

### Requirement: Stuck workflow triage

Operations MUST be able to identify a stuck run from workflow projections,
signals, human tasks, effects, domain jobs and Outbox state without editing
LangGraph checkpoint rows directly.

#### Scenario: Signal is stale

- **WHEN** a workflow signal exceeds its visibility timeout
- **THEN** the run view identifies the stale signal and the operator can invoke
  the documented audited recovery command

#### Scenario: Repair is unauthorized

- **WHEN** a non-operator attempts an administrative replay or repair
- **THEN** the command is rejected and an audit event records the denial

### Requirement: Cost-safe model execution

Ordinary tests and CI MUST use mock or fake providers, and provider, BullMQ and
Graph retry policies MUST NOT multiply the same transient failure.

#### Scenario: Standard CI runs

- **WHEN** the repository test and Graph test commands run without production
  credentials
- **THEN** they complete using mock providers without chargeable model calls

#### Scenario: Non-retryable rejection

- **WHEN** a provider reports invalid input, content rejection or authorization
  failure
- **THEN** the worker records a stable non-retryable failure without repeated
  provider or Graph retries

### Requirement: Canary and rollback control

The Graph feature flag MUST support a canary cohort and a rollback that stops
new Graph starts, routes new projects to the legacy path, and preserves active
run checkpoints and old graph factories.

#### Scenario: Canary gate passes

- **WHEN** the canary meets the documented success, latency, cost and incident
  thresholds
- **THEN** the operator can expand Graph routing without deleting the legacy
  path

#### Scenario: Rollback gate triggers

- **WHEN** a canary threshold fails
- **THEN** new Graph starts are disabled, new projects use legacy routing, and
  active Graph runs remain recoverable or are cancelled through audited actions
