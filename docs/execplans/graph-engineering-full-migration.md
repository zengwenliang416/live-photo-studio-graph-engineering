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
- [x] 2026-08-23: Established a clean installed baseline and corrected
  dependency/API drift. Recreated the missing root `package.json` and
  `pnpm-workspace.yaml`; installed with pnpm 10.20.0 on Node.js v22.19.0
  (production images stay on Node 24); generated `pnpm-lock.yaml`. Fixed two
  real drifts found by the baseline checks: workspace packages export `./dist`,
  so every documented command now builds packages first, and `ioredis` requires
  a named `Redis` import under NodeNext ESM. Updated the orchestrator Dockerfile
  to `pnpm install --frozen-lockfile` plus a topological `pnpm -r build`.
  Verified: `pnpm check`, `pnpm test`, `pnpm graph:check`, `pnpm graph:test`
  all pass; `pnpm graph:demo` prints WAITING_GENERATION → REVIEW_ANCHOR →
  WAITING_RENDER → COMPLETED. Locked versions: @langchain/langgraph 1.4.12,
  @langchain/langgraph-checkpoint-postgres 1.0.5 (@langchain/core 1.2.9),
  bullmq 6.2.0, zod 3.25.76, pg 8.23.0, ioredis 5.11.1, dotenv 17.4.2,
  typescript 5.9.3, tsx 4.23.12. Tests observed: contracts suite pass,
  graph-runtime 2/2 pass, orchestrator happy-path interrupt/resume 1/1 pass.
- [x] 2026-08-23: Added NestJS workflow command/query endpoints and feature
  flag. Recreated `apps/api` as a minimal NestJS application exposing exactly
  the five required endpoints under `/v1`, plus `GET /v1/openapi.json`. Writes
  enforce `Idempotency-Key` (>=16 chars) with transactional first-response
  storage in `idempotency_keys`; ownership is enforced per row via
  `user_id + project_id` (403) or run/user match; errors are RFC-style
  problem+json. The API never imports a compiled graph: it writes
  `workflow_runs` rows and Outbox envelopes (`START_WORKFLOW`,
  `CANCEL_WORKFLOW`, `HUMAN_TASK_COMPLETED`) in one transaction, and a new
  Outbox dispatcher (poll + `FOR UPDATE SKIP LOCKED`, visibility timeout,
  BullMQ `jobId` = outbox event id) relays them to the graph command/signal
  queues. Verified: 16/16 contract+unit tests pass covering duplicate replay,
  key-reuse conflict, unauthorized access, task state machine, feature-flag
  off switch, malformed identifiers and openapi surface; repository-wide
  build/check/test green; migrations idempotent on real PostgreSQL 16.
  Remaining for later milestones: live Redis/PostgreSQL dispatcher recovery
  integration test (planned with Milestone 3 crash-window suite).
  - [x] 2026-08-23: `packages/database` recreated (pool, transaction helper,
    SQL migration runner ignoring AppleDouble dotfiles) with additive
    `0000_product_baseline.sql` (projects, asset_roles minimal registry,
    outbox_events, idempotency_keys) that applies before the shipped
    `0001_graph_workflow_runtime.sql`; root `pnpm db:migrate` verified against
    local PostgreSQL 16 (applied 0000+0001, re-run skips both).
- [x] 2026-08-23: Orchestrator durability and projections. Added migration
  `0002_signal_visibility_timeout.sql` (`workflow_signals.updated_at`,
  `last_error_code`, stale-processing index). Extended `WorkflowRepository`
  with signal status lookup, stale claim (`updated_at` compare), stale listing,
  node step-run start/finish and workflow event append methods.
  `GraphEngine.handleSignal` now distinguishes fresh delivery, consumed
  duplicates, fresh PROCESSING (other worker owns it) and stale PROCESSING
  (re-drive exactly once under the per-run advisory lock); resume-time schema
  or correlation mismatches mark the row `FAILED/SIGNAL_NOT_APPLICABLE`
  instead of crashing recovery, while transient errors stay PROCESSING for
  visibility-timeout retry. Added `recoverStuckSignals()` plus a periodic
  recovery loop in `main.ts`. `createProductionCheckpointer` now returns a
  `DurableCheckpointer` handle whose pool is closed on shutdown.
  Integration suite `graph-engine.integration.test.ts` (operator-gated via
  `RUN_PG_TESTS=1` against real PostgreSQL 16) passes 6/6 scenarios: restart
  at every interrupt across fresh engine processes, duplicate completion
  delivery no-op, signal-persisted-before-crash recovered exactly once,
  resume-crashed-before-consumed-marker replayed without duplicate effects/
  tasks/outbox rows, concurrent duplicate signals producing one transition,
  and old-version runs resolvable after v2 registration. Repository-wide
  build/check/test green (22 unit tests + 6 integration).
- [x] 2026-08-23: Connected workflow generation requests to the generation
  service and AI Worker (minimal surface recreated in-snapshot). The API
  Outbox dispatcher now routes `workflow.generation.requested.v1` /
  `workflow.render.requested.v1` to dedicated BullMQ job queues
  (`generation-jobs` / `render-jobs`). Migration `0003_generation_domain.sql`
  adds `generation_batches` / `generation_outputs` (IDs and storage keys only,
  no binaries). `apps/worker-ai` consumes the job queue behind an
  ImageGenerationProvider port with a deterministic MockProvider; the service
  writes batch + four candidates and the correlated
  `GENERATION_BATCH_COMPLETED` signal (correlationId = jobId) in ONE
  transaction; duplicate deliveries return existing outputs and emit nothing;
  terminal failures are recorded once with a correlated `GENERATION_BATCH_FAILED`
  signal via the worker's final-attempt hook; BullMQ retries stay transient-only.
  Verified: repository-wide build/check/test green (api 17 incl. routing map);
  worker-ai integration 4/4 on PostgreSQL 16; migration applies idempotently.
  Deferred to later milestones: live-Redis end-to-end smoke (operator runbook)
  and cancellation-driven display rules (web milestone).
- [~] 2026-08-23: Human task completion to Graph resume is proven end-to-end by
  the API decision endpoint plus the orchestrator integration suite (SELECT
  resumes the correct run; duplicates replay; stale tasks conflict). Remaining:
  expose only task-payload actions in a web review UI and bind REGENERATE to a
  bounded revision loop once `apps/web` exists.
- [ ] Connect workflow render requests to the existing render service and Media
  Worker; emit correlated export signals.
- [ ] Remove worker-owned project phase transitions on the Graph path.
- [ ] Add front-end workflow projections, SSE invalidation and human review UI.
- [ ] Add full checkpoint recovery, duplicate signal, crash window and rollback
  integration tests.
- [ ] Add observability, admin triage, cost controls, canary rollout and runbooks.
- [ ] Complete final validation and retrospective.

## Surprises and discoveries

- 2026-08-23: This working copy is a Graph-only subset of the product. The
  legacy `apps/web`, `apps/api`, `apps/worker-ai`, `apps/worker-media`,
  `packages/contracts|queue|storage|logger|prompt-kit` directories described in
  the root README do not exist here. Milestones that reference those services
  must first recreate the minimum application surface they integrate with.
- 2026-08-23: The root `package.json` and `pnpm-workspace.yaml` were absent, so
  none of `pnpm install|check|test|graph:check|graph:test|graph:demo` could run.
  They must be recreated with `pnpm -r` delegation scripts before Milestone 1
  acceptance can be observed.
- 2026-08-23: Local environment provides Node.js v22.19.0 while README and the
  orchestrator Dockerfile target Node.js 24 LTS. Baseline verification runs on
  Node 22; production images stay on Node 24. Recorded as an environment gap,
  not a code change.
- The delivered baseline intentionally had no `pnpm-lock.yaml` because the prior
  build environment could not reach the npm registry. The first successful
  install must create and commit the lockfile before production CI uses
  `--frozen-lockfile`.
- The transitional effect adapter emits workflow-specific Outbox events but does
  not assume the exact existing generation/render service schema. Integrate it
  through application ports rather than duplicating domain writes in the
  orchestrator.

## Decision log

- 2026-08-23: tsx/esbuild does not emit decorator metadata, so every Nest
  injection in `apps/api` uses explicit `@Inject(token)`; provider visibility
  is modeled with a shared `ApiDatabaseModule` instead of parent-module
  providers (Nest does not expose importer providers to imported modules).
- 2026-08-23: Ownership violations return 403 PROJECT_ACCESS_DENIED and missing
  resources 404, keeping authorization explicit for contract tests; problem+json
  content type is set explicitly because Express `res.json()` always emits
  application/json.
- 2026-08-23: The migration runner ignores dotfiles so macOS AppleDouble
  (`._*.sql`) artifacts can never be applied as migrations.
- 2026-08-23: Recreated root scripts as `check`/`test` = `pnpm -r build && pnpm
  -r check|test`, because library packages publish their public API from
  `./dist`. Building first removes stale-dist drift for every consumer. Until
  the legacy apps are recreated in this snapshot, `graph:check`/`graph:test`
  intentionally alias the full gates; narrow them when non-graph packages land.
- 2026-08-23: Use `import { Redis } from "ioredis"` in the orchestrator entry.
  Under `NodeNext` module resolution the ioredis default export is not
  constructable in ESM; the named export is the documented ESM form.
- 2026-08-23: Keep BullMQ for task execution and use LangGraph only as the control
  plane. This avoids two competing task schedulers.
- 2026-08-23: Use `workflowRunId` as `thread_id`; a project can have multiple runs.
- 2026-08-23: Store workflow query projections separately from checkpoint tables.
- 2026-08-23: Begin with `generation -> human review -> render -> export`; migrate
  upload/style subgraphs after the first slice is proven.
- 2026-08-23: Keep routing deterministic. Models may return typed recommendations,
  not arbitrary next-node names.

## Outcomes and retrospective

2026-08-23 (Milestones 1-3):

- Commands observed passing: `pnpm install`, `pnpm check`, `pnpm test`
  (contracts 2, runtime 2, api 16, orchestrator 2 = 22 pass),
  `pnpm graph:check`, `pnpm graph:test`, `pnpm graph:demo` (four phases ending
  `COMPLETED`), `RUN_PG_TESTS=1 tsx --test src/graph-engine.integration.test.ts`
  (6/6), `pnpm db:migrate` twice (apply then skip). `git diff --check` clean.
- Environment gap: local Node is v22.19.0 while the documented target is
  Node 24 LTS; all checks currently pass on 22 with engine warnings. Production
  images remain on Node 24.
- Remaining risks: dispatcher-to-BullMQ delivery is design-verified but not yet
  exercised against live Redis in CI (local Redis requires auth); milestones
  4-10 require the legacy product surface that this working copy does not
  contain and are recorded as blocked with next actions.

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
