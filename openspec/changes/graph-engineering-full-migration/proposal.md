## Why

The current workflow can coordinate generation, human review, media rendering
and export only through loosely coupled API and worker behavior. That makes
restart recovery, duplicate completion handling, phase ownership and rollback
hard to prove. This change completes the staged Graph control-plane migration
now that the versioned graph, API boundary, workers and web projection exist in
the repository.

## What Changes

- Complete the generation, human review, render and export path through the
  versioned LangGraph orchestrator.
- Keep BullMQ as the long-running execution plane and use Transactional Outbox
  for commands and correlated resume signals.
- Make workflow runs immutable with respect to `graphKey + graphVersion` and
  use `workflowRunId` as the LangGraph `thread_id`.
- Add restart, duplicate-signal, stale-recovery, cancellation, bounded-repair
  and cross-project ownership tests.
- Prove that AI and media workers write facts and signals but do not own
  Graph-path phase transitions.
- Add observability, privacy, security, cost, canary and rollback evidence and
  runbooks without requiring chargeable providers or production credentials.
- Preserve the legacy path behind a feature flag until canary acceptance;
  remove obsolete phase writes only after the documented rollback gate.

## Capabilities

### New Capabilities

- `versioned-workflow-control-plane`: durable graph routing, immutable graph
  version binding, interrupts, bounded repair and terminal states.
- `durable-workflow-signals`: transactional commands, correlated signals,
  idempotent effects, per-run locking and stale-processing recovery.
- `workflow-review-and-export`: generation candidates, task-payload-gated
  review, render jobs, deterministic export metadata and web projection.
- `workflow-operations`: trace context, metrics, admin triage, security/cost
  controls, canary rollout and rollback procedures.

### Modified Capabilities

- None. Existing product behavior is preserved while its orchestration and
  recovery contracts become explicit.

## Impact

Affected areas are `apps/orchestrator`, `apps/api`, `apps/worker-ai`,
`apps/worker-media`, `apps/web`, `packages/graph-contracts`,
`packages/graph-runtime`, `packages/database`, the additive migrations and
Graph engineering documentation. The change does not add a second scheduler,
move binaries into PostgreSQL, expose provider credentials, or require a
production service.
