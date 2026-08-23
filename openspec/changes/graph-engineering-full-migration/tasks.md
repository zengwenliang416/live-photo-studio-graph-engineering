## 1. Existing Graph Foundation

User outcome: An existing Graph workflow keeps its immutable binding and
durable command boundary across restarts.

- [x] 1.1 Keep the versioned graph registry, immutable run binding and
  `workflowRunId` thread ID contract.
- [x] 1.2 Keep shared Zod command, signal, event and job payload contracts.
- [x] 1.3 Keep additive workflow, generation and render migrations.
- [x] 1.4 Keep API idempotency, ownership checks and Outbox command boundary.

## 2. Durable Orchestration

User outcome: A user sees one correct workflow transition even when commands or
signals are duplicated or a process crashes.

- [x] 2.1 Keep PostgreSQL advisory locking and signal visibility-timeout
  recovery.
- [x] 2.2 Keep restart, duplicate-signal, stale-recovery and old-version
  integration coverage.
- [ ] 2.3 Add bounded REGENERATE exhaustion coverage and verify the failure or
  human fallback state.
- [ ] 2.4 Add wrong-correlation rejection, cancel-late-signal handling and
  duplicate START command coverage.
- [ ] 2.5 Add Outbox completion/failure routing, malformed-payload failure and
  event-only delivery coverage.

## 3. Worker Ownership and Facts

User outcome: Generated candidates and rendered exports appear once, and worker
execution cannot silently move the workflow to another phase.

- [x] 3.1 Keep AI worker provider execution outside database transactions and
  use deterministic batch/output identities.
- [x] 3.2 Keep media worker rendering/export execution outside database
  transactions and use deterministic package identities.
- [ ] 3.3 Fix PostgreSQL integration seed parameter typing in AI and media
  worker tests.
- [ ] 3.4 Assert before and after each worker job that Graph-path
  `workflow_runs.current_phase` is unchanged.
- [ ] 3.5 Add cross-project ownership and duplicate completion assertions for
  both worker paths.

## 4. Web Projection

User outcome: A user can refresh the project page, resume review, and use only
the actions currently allowed by the server task payload.

- [x] 4.1 Keep the centralized API client, persisted idempotency keys and
  TanStack Query workflow/task projection.
- [x] 4.2 Keep task-payload-gated candidate selection, accessible cancel/error
  states and SSE invalidation behavior.
- [ ] 4.3 Add refresh/reopen and duplicate-click integration coverage for the
  project workflow page.
- [ ] 4.4 Add explicit export-package boundary copy and mobile-width
  accessibility evidence.

## 5. Operations and Security

User outcome: Operators can locate and safely triage a stuck run without
exposing media, credentials, prompts or cross-project data.

- [ ] 5.1 Propagate trace, run, project, node, external-job and provider
  request identifiers through API, Outbox, queues and workers.
- [ ] 5.2 Add metrics and an authenticated read-only triage projection for
  queue age, interrupt age, duplicate signals, node latency and failures.
- [ ] 5.3 Add redaction and security tests for cross-project access, malformed
  signals, signed URLs, Base64, prompts, EXIF and credentials.
- [ ] 5.4 Add cost controls, mock-provider defaults and explicit
  non-retryable provider error classification.

## 6. Canary and Final Validation

User outcome: The Graph path can be enabled for a canary and rolled back to the
legacy path without losing recoverability or making unsupported claims.

- [ ] 6.1 Document Graph/legacy feature-flag canary thresholds and rollback
  commands in the operations runbook.
- [ ] 6.2 Capture migration, test, phase-ownership, security and external
  blocker evidence under `docs/graph-engineering/evidence/`.
- [ ] 6.3 Run package, repository, PostgreSQL integration, graph, migration and
  diff checks with exact observed results.
- [ ] 6.4 Update the ExecPlan Progress, discoveries, decision log and Outcomes
  and retrospective with measured outcomes and genuine blockers.
