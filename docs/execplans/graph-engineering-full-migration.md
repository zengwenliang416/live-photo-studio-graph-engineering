# Execute the Full Graph Engineering Migration

This ExecPlan is a living document. Maintain it according to `PLANS.md`.

## Purpose and user-visible outcome

Migrate the Live Photo Studio from loosely coordinated API/worker status changes
to a versioned, durable Graph control plane. A user must be able to upload
assets, generate candidates, leave the site, return to select an image, render a
Live Photo package and recover from process restarts or duplicate worker events.
The existing non-Graph path remains available behind a feature flag during the
migration.

## Progress

- [x] 2026-08-23: Added `packages/graph-contracts` with versioned command, signal,
  event, human-task and node metadata schemas.
- [x] 2026-08-23: Added `packages/graph-runtime` with graph registry, stable effect
  keys, interrupt extraction and workflow errors.
- [x] 2026-08-23: Added `packages/database/migrations/0001_graph_workflow_runtime.sql` for workflow
  projections, signals, human tasks, node effects and audit events.
- [x] 2026-08-23: Added `apps/orchestrator`, PostgreSQL checkpointer wiring, a v1
  generation-review-render graph, PostgreSQL adapters, an in-memory demo and
  route/resume tests.
- [ ] Establish a clean installed baseline and correct any dependency/API drift.
- [ ] Add NestJS workflow command/query endpoints and feature flags.
- [ ] Connect workflow generation requests to the existing generation service and
  AI Worker; make workers emit correlated completion/failure signals.
- [ ] Connect human task completion to Graph resume with authorization and
  idempotency.
- [ ] Connect workflow render requests to the existing render service and Media
  Worker; emit correlated export signals.
- [ ] Remove worker-owned project phase transitions on the Graph path.
- [ ] Add front-end workflow projections, SSE invalidation and human review UI.
- [ ] Add full checkpoint recovery, duplicate signal, crash window and rollback
  integration tests.
- [ ] Add observability, admin triage, cost controls, canary rollout and runbooks.
- [ ] Complete final validation and retrospective.

## Surprises and discoveries

- The delivered baseline intentionally had no `pnpm-lock.yaml` because the prior
  build environment could not reach the npm registry. The first successful
  install must create and commit the lockfile before production CI uses
  `--frozen-lockfile`.
- The transitional effect adapter emits workflow-specific Outbox events but does
  not assume the exact existing generation/render service schema. Integrate it
  through application ports rather than duplicating domain writes in the
  orchestrator.

## Decision log

- 2026-08-23: Keep BullMQ for task execution and use LangGraph only as the control
  plane. This avoids two competing task schedulers.
- 2026-08-23: Use `workflowRunId` as `thread_id`; a project can have multiple runs.
- 2026-08-23: Store workflow query projections separately from checkpoint tables.
- 2026-08-23: Begin with `generation -> human review -> render -> export`; migrate
  upload/style subgraphs after the first slice is proven.
- 2026-08-23: Keep routing deterministic. Models may return typed recommendations,
  not arbitrary next-node names.

## Outcomes and retrospective

Not complete. Update this section after every production-like acceptance run.

## Repository context and orientation

- `apps/web`: Next.js mobile web UI.
- `apps/api`: NestJS modular monolith and public command/query boundary.
- `apps/orchestrator`: new Graph command/signal consumers and graph factories.
- `apps/worker-ai`: executes model work; must emit facts, not route workflows.
- `apps/worker-media`: executes HEIC/FFmpeg work; must emit facts, not route.
- `packages/database`: migrations and transaction helpers.
- `packages/queue`: BullMQ and Outbox transport.
- `packages/graph-contracts`: portable workflow schemas.
- `packages/graph-runtime`: framework-neutral Graph utilities.
- `docs/graph-engineering`: architecture and operations guidance.

## Architecture invariants

1. Only the orchestrator chooses the next business phase on the Graph path.
2. API and workers update domain facts; they publish commands/signals through a
   Transactional Outbox.
3. Every side effect is idempotent and has a stable effect key.
4. Signals are correlated, schema-validated and consumed once under a per-run
   lock.
5. Graph state contains IDs and small structured values only.
6. Every loop is bounded and has a human fallback.
7. A run is bound to an immutable graph version.
8. No production credential or network call is required for ordinary CI.

## Milestone 1: Baseline and dependency lock

From the repository root, inspect all governing `AGENTS.md` files. Install with
Corepack and pnpm. Resolve only real type/API incompatibilities; do not weaken
strict compiler options. Verify existing non-Graph tests first, then run:

```bash
corepack enable
pnpm install
pnpm check
pnpm test
pnpm graph:check
pnpm graph:test
pnpm graph:demo
```

Create and commit `pnpm-lock.yaml`. Change CI and Docker install commands to
`pnpm install --frozen-lockfile` only after the lockfile exists. Record package
versions and any LangGraph API adjustment in this plan.

Acceptance: all existing checks plus the Graph checks pass, and `graph:demo`
prints the four phases ending in `COMPLETED`.

## Milestone 2: Workflow API boundary

Add a `workflows` NestJS module with application ports, not direct LangGraph
imports. Required endpoints:

- `POST /v1/projects/:projectId/workflow-runs`
- `GET /v1/workflow-runs/:workflowRunId`
- `GET /v1/workflow-runs/:workflowRunId/human-tasks`
- `POST /v1/human-tasks/:humanTaskId/decisions`
- `POST /v1/workflow-runs/:workflowRunId/cancel`

All writes require authorization, `Idempotency-Key`, Zod validation and a
transaction that writes the domain record plus Outbox command/signal. The API
may not invoke a compiled graph directly. Add OpenAPI contract tests and
problem+json errors.

Acceptance: duplicate start/decision requests return the first result; a reused
key with a different body returns conflict; unauthorized project access is
rejected; queue unavailability after commit is recovered through Outbox.

## Milestone 3: Orchestrator durability and projections

Finish repository methods for node run records, workflow events and human task
completion. Add a signal dispatcher that maps domain Outbox events to the
`graph-signals` queue. Use PostgreSQL advisory locking per run. Treat checkpoint
setup as a migration job, not an application-start side effect.

Add integration tests covering:

- process restart at each interrupt;
- duplicate signal delivery;
- signal inserted before resume crash;
- resume succeeded before consumed marker crash;
- two concurrent signals for one run;
- old graph version resumed after v2 registration.

Acceptance: each scenario produces one business transition and no duplicate
billing/output/effect row.

## Milestone 4: Generation migration

Replace the transitional `workflow.generation.requested.v1` bridge with an
application adapter that calls the existing generation use case idempotently.
The generation transaction must create jobs, reserve credits and write Outbox.
AI Worker completion writes outputs first, then emits either
`GENERATION_BATCH_COMPLETED` or `GENERATION_BATCH_FAILED` with the generation job
ID as correlation ID.

Remove direct Graph-path project status changes from generation services and
workers. Keep the legacy path behind `GRAPH_WORKFLOW_ENABLED` until cutover.

Acceptance: four mock candidates are generated, one completion signal resumes the
correct run, duplicate completion is a no-op, cancellation does not display late
results, and credits are settled once.

## Milestone 5: Human review migration

Persist a human task whenever the graph interrupts at `SELECT_ANCHOR_IMAGE`.
Expose only actions allowed by the task payload. Complete task and publish resume
signal in one transaction. Verify selected output ownership and project access.

Add a bounded regenerate loop. Preserve each generation revision and selected
style anchor. Do not overwrite prior outputs.

Acceptance: SELECT advances to render; REGENERATE creates exactly one new batch;
CANCEL reaches the cancelled terminal state; stale or already-completed tasks
return conflict.

## Milestone 6: Render and export migration

Adapt `workflow.render.requested.v1` to the existing render use case. Media Worker
must create deterministic cover, MOV, manifest and ZIP variants, validate hashes,
write domain results and emit a correlated render completion/failure signal.
It must not set the project phase directly on the Graph path.

Acceptance: selected output produces one export package; duplicate render signals
are ignored; failure reaches the failure branch; retry reuses safe inputs without
overwriting the original asset.

## Milestone 7: Web workflow projection

Add generated API client methods and TanStack Query hooks. SSE events invalidate
queries; SSE payloads are not treated as final state. Use XState only for local UI
substates. The server workflow projection selects the visible step.

Implement:

- resumable project page after refresh;
- task-specific review actions;
- stage-based progress instead of fake percentages;
- accessible loading/error/cancel states;
- legacy/Graph feature flag routing.

Acceptance: close the browser at generation wait, reopen and continue selection;
refresh during render and recover; duplicate clicks do not create duplicate
commands.

## Milestone 8: Observability and operations

Propagate `traceId`, `workflowRunId`, `projectId`, `nodeName`, `nodeVersion`,
`externalJobId` and provider request ID across API, Outbox, queue and workers.
Add metrics for node latency, interrupt age, duplicate signals, queue age, model
cost, render failure and stuck runs. Add an authenticated admin read-only graph
view and audited repair commands.

Acceptance: one trace follows start through export; a stuck workflow can be
identified using the operations runbook without reading checkpoint rows directly.

## Milestone 9: Security, privacy and cost controls

Verify private buckets, signed URL TTLs, MIME magic-byte validation, pixel limits,
EXIF stripping for model inputs, log redaction and project ownership on every
workflow command. Keep the OpenAI key server-side. Use mock providers in CI and a
separate budget-limited model regression job.

Acceptance: security tests cover cross-project task submission, malformed signal,
oversized upload, prompt/log leakage and replayed command. No binary or signed URL
appears in Graph state or logs.

## Milestone 10: Cutover and cleanup

Run a canary cohort with `GRAPH_WORKFLOW_ENABLED`. Compare success rate, latency,
cost and support incidents to the legacy path. Drain interrupted old graph
versions before removing them. Remove legacy project-phase writes only after
rollback criteria are met.

Acceptance: canary and rollback exercises pass, documentation is current, all
checks pass with a frozen lockfile, and `Outcomes and retrospective` records
measured results and remaining risks.

## Concrete execution rules

At each milestone:

1. Inspect current code and tests before editing.
2. Update this plan's Progress and discoveries.
3. Implement the smallest end-to-end slice.
4. Run the narrow test, then package tests, then repository checks.
5. Review `git diff --check`, migrations and generated contracts.
6. Keep unrelated formatting out of the diff.
7. Do not proceed past a failing milestone by deleting or weakening tests.

## Validation and acceptance

The final repository must pass the documented install, migration, typecheck,
unit, integration, media and E2E commands. It must demonstrate a restart-safe
workflow using mock providers and include an operator-verifiable canary and
rollback path. Real OpenAI generation is an optional protected regression run,
not a prerequisite for standard CI.

## Idempotence, recovery and rollback

All start, decision, cancel, generation, render and signal operations have stable
idempotency keys or unique constraints. Migrations are additive until cutover.
Feature flags retain the legacy path. Rollback stops new Graph runs, lets active
runs finish or cancels them through audited commands, and routes new projects to
the legacy path. Never delete checkpoint tables or old graph factories as part
of an emergency rollback.

## Interfaces and dependencies

- LangGraph is confined to `apps/orchestrator`.
- Graph contracts are portable Zod schemas.
- NestJS communicates by commands and query projections.
- BullMQ transports commands/signals and existing jobs.
- PostgreSQL transactions plus Outbox provide reliable publication.
- Workers consume domain jobs and emit workflow signals.
- OpenAI and media providers stay behind existing application ports.

## Artifacts and operational notes

Keep architecture diagrams, API contract snapshots, migration output, test logs
and canary results under `docs/graph-engineering/evidence/` using small text or
JSON summaries. Do not commit credentials, binary test media or full provider
responses.
