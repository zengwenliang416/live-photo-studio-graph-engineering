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
- [x] 2026-08-23: Connected the render/export path (minimal surface recreated
  in-snapshot). Migration `0004_render_domain.sql` adds `render_jobs` and
  `export_packages` with per-artifact storage keys, a package SHA-256,
  byte count and JSONB manifest (schemaVersion/recipeVersion/entries).
  `apps/worker-media` consumes `render-jobs` behind an `ExportRenderer` port;
  a dependency-free deterministic STORE-method ZIP builder produces the
  cover/motion/manifest package so hashes are real and replay-stable. The
  export row plus the correlated `RENDER_JOB_COMPLETED` signal (correlationId
  = jobId) commit atomically; duplicate deliveries serve the existing export
  and emit nothing; terminal failures record once with `RENDER_JOB_FAILED`;
  invalid selected outputs fail fast before any domain write. The worker
  writes no project phases. Verified: repository-wide build/check/test green;
  worker-media unit 2 + integration 4/4 on PostgreSQL 16.
  Deferred honestly: the FFmpeg-backed renderer adapter behind the same port
  (real MOV encoding) plus object-storage upload of artifacts — the current
  fake renderer yields placeholder bytes with valid ZIP structure and stable
  hashes, sufficient for control-plane acceptance but not device-level media
  validation per the HEIC/Live Photo boundary in AGENTS.md.
- [x] Remove worker-owned project phase transitions on the Graph path.
- [x] 2026-08-23: Audited the remaining Graph-path phase ownership boundary.
  AI and Media Workers write domain results and correlated signals only; no
  direct `workflow_runs.current_phase` write is present in the current
  snapshot. Verified with `pnpm --filter @live-photo-studio/orchestrator check`,
  `pnpm --filter @live-photo-studio/orchestrator test`,
  `RUN_PG_TESTS=1 pnpm --filter @live-photo-studio/orchestrator test`,
  `pnpm --filter @live-photo-studio/worker-ai check`,
  `pnpm --filter @live-photo-studio/worker-media check`,
  `RUN_PG_TESTS=1 pnpm --filter @live-photo-studio/worker-ai exec tsx --test
  src/worker-ai.integration.test.ts` and the corresponding Media Worker
  command. Observed results: Orchestrator 11/11 PG tests, AI 5/5 PG tests and
  Media 5/5 PG tests passed; worker tests assert `current_phase` is unchanged.
- [~] 2026-08-23: Building the web workflow projection. Recreating the minimal
  `apps/web` surface in-snapshot: typed API client with per-action
  Idempotency-Key persistence, TanStack Query hooks where the server
  projection is the only truth, duplicate-click protection at the mutation
  layer, stage-based progress derived from `currentPhase`, task-payload-gated
  review actions, accessible cancel/error states, and Graph/legacy flag
  routing. The API gains an SSE endpoint streaming new `workflow_events` rows
  (transitional DB-tail transport) so clients invalidate queries on real
  state changes only.
- [x] 2026-08-23: Completed the phase-ownership regression milestone. SpecNav
  development entry artifacts were repaired, worker/orchestrator tests prove
  workers preserve `workflow_runs.current_phase`, bounded `REGENERATE`
  exhaustion reaches the failed terminal state, and late or incorrectly
  correlated signals cannot reopen a terminal run. The full Orchestrator PG
  suite now covers duplicate START, duplicate signals, crash-window recovery,
  concurrent delivery and rollback-safe old graph versions.
- [x] 2026-08-23: Added `docs/graph-engineering/evidence/` records for restart,
  duplicate-signal, phase-ownership, security/cost, triage and canary/rollback
  observations. A1 and A2 have direct passing evidence; A3 remains blocked by
  unavailable private-storage and production media/provider verification.
- [~] 2026-08-23: Starting the observability, operations, security and cost
  controls milestone. The current snapshot has no shared logger, storage
  package, admin read model or repair command; implementation will add only
  bounded projection queries and audited commands over existing workflow/domain
  tables, with no second orchestrator and no checkpoint-row business reads.
- [~] 2026-08-23T18:03:58+08:00: Resuming the observability/operations
  milestone from the current dirty snapshot. Shared context fields, redaction,
  operator endpoints and the PostgreSQL operations adapter are present, but
  `PgWorkflowOperations` still lacks a real PostgreSQL integration test. This
  pass will validate triage aggregation, stale/failed signal replay, audit
  ordering before replay Outbox publication, and denial auditing; then update
  the runbook and retain only evidence that was actually observed.
- [x] 2026-08-23T18:15:46+08:00: Completed the locally verifiable portion of
  the observability/operations milestone. Added the bounded authenticated
  triage/replay boundary, deterministic replay Outbox command, denial/audit
  path, context propagation and redaction/cost controls. The new PostgreSQL
  operations suite passed 4/4 against a temporary database after all six
  migrations applied. The runbook now documents curl operations, canary
  thresholds, rollback and the exact external blockers. Remaining: browser
  sensory evidence, private object-storage verification, live Redis/provider/
  codec checks and SpecNav-owned receipts.
- [~] 2026-08-23T18:32:26+08:00: Started the remaining Web and security
  acceptance work after inspecting the supplied prototype ZIP
  (`sha256=922a4c229193d90ca56cdc55653c760fea0a256584bb633998d69b6b605aa0ac`).
  The prototype is a Vite/local-mock implementation, not a production
  Next.js/Graph integration. This pass retains its obsidian/gold/editorial
  visual direction and review/export information architecture, while adding
  only server-projection-backed Web behavior and evidence; no browser-owned
  workflow repository, binary store or ZIP builder is promoted.
- [~] 2026-08-23T18:37:00+08:00: Starting the security-matrix completion pass.
  Existing ownership, worker cross-project and basic redaction tests will be
  retained. This pass adds explicit malformed-signal and sensitive-field
  matrix cases, then records the remaining real storage/provider/media/device
  blockers without weakening A3.
- [x] 2026-08-23T18:44:13+08:00: Completed the locally verifiable Web and
  security work. The Web now revalidates stored workflow runs before reuse,
  shares concurrent start requests, parses successful responses with Zod,
  keeps server projection authority, and uses scoped obsidian/gold/editorial
  styles with explicit 390px/focus/touch-target evidence. Web tests passed
  11/11. The security matrix now rejects malformed signals and redacts
  credentials, signed URLs, Base64, prompts, EXIF/GPS, provider responses and
  binary values. Graph contracts passed 6/6; PostgreSQL orchestrator, AI,
  Media and operations suites passed 11/11, 5/5, 5/5 and 4/4.
- [x] 2026-08-23T18:44:13+08:00: Completed the package/repository/Graph/
  migration/diff validation pass. `pnpm install --frozen-lockfile`,
  `pnpm check`, `pnpm test`, `pnpm graph:check`, `pnpm graph:test`,
  `pnpm graph:demo`, `DATABASE_URL=postgresql://postgres@localhost:5432/postgres
  pnpm db:migrate` and `git diff --check` all passed in this continuation.
  The migration command observed `applied:[] skipped:6`; the demo ended
  `COMPLETED`. The final retrospective and SpecNav receipts remain.
- [x] 2026-08-23T19:06:16+08:00: Completed the final validation and
  retrospective pass. Repaired the managed SpecNav Verification Runtime
  `2.0.0-alpha.2` in the explicitly selected user scope, generated
  `verify/v2/runtime-status.json` from the doctor command, initialized
  CodeGraph, and generated evidence for all six development claims. The
  repository, Graph, migration, PostgreSQL integration and diff checks were
  rerun successfully. SpecNav handoff remains blocked by its clean-snapshot
  and independent-review requirements; those blockers are recorded below.
- [~] 2026-08-23: Starting the stable-snapshot and SpecNav evidence pass after
  the user authorized a local checkpoint commit. The commit will include
  implementation, tests, migrations, documentation and OpenSpec delivery
  artifacts, while excluding CodeGraph and SpecNav session-local state. After
  the snapshot is stable, refresh system-executed receipts and regenerate task
  acceptance evidence; unsupported A3 capabilities remain blocked.
- [~] 2026-08-23: Starting the independent-review repair implementation from
  the stable snapshot. This pass addresses the concrete findings rather than
  changing acceptance metadata: re-read workflow runs after acquiring the
  per-run lock, make resume projection/event/consumed-marker writes replay-safe,
  claim AI and Media jobs before external side effects, enforce asset/output
  ownership, and add the API/Web export download boundary plus project/run and
  task-action checks. Existing system receipts are invalid until the new
  implementation HEAD is validated again.
- [~] 2026-08-23: Starting the post-repair full validation pass. The focused
  API, Web, AI Worker, Media Worker and Orchestrator checks have passed,
  including PostgreSQL integration suites; this pass runs the repository gates,
  migration replay, Graph demo, diff check and then refreshes task evidence on
  the committed implementation snapshot. Live Redis, private object storage,
  real provider/codec and iOS device checks remain external blockers.
- [x] 2026-08-23: Completed the post-repair validation pass. Quoted the
  `tsx` test glob in every package script so top-level and nested tests are
  both collected. The full ordinary suite passed with Graph contracts 6,
  Graph runtime 3, API 30, Web 13, AI Worker 3, Media Worker 4 and
  Orchestrator 4 tests; PostgreSQL suites passed API 33, AI Worker 9, Media
  Worker 13 and Orchestrator 11 tests. `pnpm graph:check`,
  `pnpm graph:test`, `pnpm graph:demo`, frozen install, migration replay and
  `git diff --check` also passed. One concurrent `graph:test` attempt exposed
  an API test runner flake and failed; the isolated fixed-concurrency suite
  and the subsequent full rerun passed, so no failure is suppressed.
- [x] 2026-08-23T20:38:44+08:00: Refreshed the current-HEAD SpecNav evidence
  after the authorized checkpoint commit. The Verification evidence runner
  replayed 29 declared task commands with `failed=0` and `overturned=0`.
  Task acceptance evidence was materialized for all six tasks against the
  then-current committed implementation snapshot; A1 and A2 remain passing
  and A3 remains failing.
- [x] 2026-08-23T20:38:44+08:00: Updated task reports, independent reviews
  and the task ledger from historical dirty-worktree blockers to current-head
  local completion states. External runtime, storage, Redis, provider, codec,
  browser sensory and device gaps remain explicit and are not promoted.
- [x] 2026-08-23T20:38:44+08:00: SpecNav development handoff returned
  `{"ok":true,"mode":"handoff","blockers":[]}` for all six tasks. This is a
  lifecycle handoff of the locally verified slices, not production or device
  acceptance.
- [x] 2026-08-23: Started and completed the RustFS object-storage completion
  slice after the
  user confirmed that a RustFS service exists on the 80 server. This slice
  replaces the fail-closed export signer and metadata-only media path with a
  generic S3-compatible storage port, a RustFS-compatible AWS SDK adapter,
  deterministic export-object uploads and short-lived private download grants.
  The default `mock` backend remains for ordinary CI. The server endpoint,
  private bucket, credentials and TLS mode remain deployment inputs; the
  current endpoint and bucket were verified in the credentialed canary recorded
  below.
- [x] 2026-08-23: Completed the locally verifiable RustFS storage slice. Added
  `packages/storage` with a generic `ObjectStoragePort`, mock/in-memory
  implementation and AWS SDK S3-compatible adapter supporting explicit
  endpoints, path-style addressing, private uploads, object SHA-256 metadata
  and presigned GET grants capped at 900 seconds. API export downloads now use
  the adapter when `OBJECT_STORAGE_BACKEND=s3`; Media Worker uploads cover,
  motion, manifest and ZIP objects before committing export metadata and
  validates returned object keys, byte counts and hashes. Verified with storage
  3/3, API 34/34, Media Worker 13/13 PostgreSQL integration tests, full
  repository checks, Graph checks, migration replay and `git diff --check`.
  At that point, the remaining external work was the credentialed RustFS
  endpoint/bucket probe, private-access check, signed-URL TTL check and
  production canary, which are recorded in the later RustFS verification entry.
- [x] 2026-08-23T23:29:27+08:00: Completed the credentialed RustFS adapter
  verification against the 80 server without modifying its deployment. The
  read-only probe found `storage.motion-cover.com` behind Nginx, backed by
  `camera-rental-rustfs`; the configured region is `us-east-1` and the current
  bucket is `camera-rental-return`. The canary ran from `packages/storage` with
  the server-side app credential injected transiently from the remote secret
  file. It uploaded a random object under
  `live-photo-studio/canary/`, verified the adapter-reported 68-byte SHA-256,
  observed unsigned GET `403`, signed GET `200` with `X-Amz-Expires=60`, and
  deleted the object. No credential, signed URL or object bytes were logged.
  The existing bucket is shared with the camera-rental deployment; a dedicated
  production bucket/policy remains an operator decision.

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
- 2026-08-23: The current snapshot already contains the minimal Web, API, AI
  Worker and Media Worker surfaces described as absent in the earlier plan
  entries. The first remaining checkbox is therefore a verification and
  boundary-hardening task, not a wholesale service recreation.
- 2026-08-23: The repository map does not currently contain the documented
  `packages/logger` or `packages/storage` packages. Redaction and storage
  boundary checks must therefore be introduced at the existing application
  seams without inventing a parallel package architecture.
- 2026-08-23: The first SpecNav handoff contract run after resuming the work
  reports missing runtime-status receipt authority, incomplete task-ledger
  statuses, scaffold placeholders and no executed validation evidence. These
  are delivery-control-plane blockers; they must be repaired from real command
  output and cannot be resolved by marking source milestones complete.
- 2026-08-23: `PgWorkflowOperations` already restricts every triage collection
  to 100 rows and revalidates persisted signal payloads before replay, but
  those SQL paths were only covered by port-level tests. A real PostgreSQL
  fixture is required before the operations milestone can be accepted.
- 2026-08-23: The operations integration fixture confirmed that all six current
  migrations apply to a temporary PostgreSQL 16.11 database, and the replay
  trigger observed the audit insert before the replay Outbox insert in the
  same transaction.
- 2026-08-23: The Graph demo failure was a real strict-schema mismatch in the
  human-task resume payload. The demo now supplies the deterministic
  `humanTaskId` correlation and reaches `COMPLETED`; the signal schema was not
  weakened.
- 2026-08-23: A direct unauthenticated local Redis probe returned
  `NOAUTH Authentication required`. The runbook records the credentialed
  operator command without retaining credentials or claiming a live smoke pass.
- 2026-08-23: The supplied prototype ZIP is a standalone Vite + React
  high-fidelity mock. It imports a browser-side workflow orchestrator,
  persists project/domain state in localStorage/IndexedDB and creates a demo ZIP
  in the browser. Its UI stages also exceed the currently published
  `live-photo-project:v1` graph. Only its visual tokens, shell structure,
  candidate-review layout and export-boundary copy are compatible with this
  repository.
- 2026-08-23: SpecNav Verification Runtime scope selection was required before
  a trusted runtime status could be produced. The project selected the existing
  user scope explicitly and repaired the locked `2.0.0-alpha.2` runtime. The
  repair verified five locked packages, Chromium and headless Chromium
  revision `1234`, and FFmpeg revision `1011`; the doctor passed on local Node
  `v22.19.0` with only the expected unconfigured Midscene-provider warning.
- 2026-08-23: CodeGraph CLI `1.3.1` initialized a 91-file index with 948 nodes
  and 2,316 edges. Evidence queries matched all six development claims and the
  claims report returned `verified_claims=6`, `unverified_claims=0`. The index
  is local tooling state and is not a substitute for the signed Verification
  2.0 task receipts.
- 2026-08-23: The SpecNav task-acceptance generator rejects the current
  implementation snapshot because the worktree contains uncommitted production
  changes. The user initially prohibited committing or pushing this work, so no
  task `acceptance.json`, review approval, or green handoff was fabricated at
  that time. The user later authorized a local checkpoint commit; push,
  deployment and production infrastructure changes remain prohibited.
- 2026-08-23: The independent review found that a PostgreSQL advisory lock alone
  is insufficient when the run projection is read before lock acquisition:
  recovery must re-read the run using the lock-held transaction before deciding
  whether a stale signal is still applicable. It also found that provider/
  renderer idempotency requires a durable claim before the external call; a
  deterministic output ID alone prevents duplicate rows, not duplicate paid or
  expensive side effects.
- 2026-08-23: The worker claim repair uses the existing generation/render job
  rows and uniqueness constraints to prevent concurrent duplicate provider or
  renderer calls. A process crash after an external side effect and before the
  domain commit still requires a future claim lease/token protocol; this
  remains a documented risk rather than an unverified acceptance claim.
- 2026-08-23: The original package test command used an unquoted
  `src/**/*.test.ts` glob. On this shell that omitted top-level test files from
  ordinary package runs. Quoting the glob delegates recursive expansion to
  `tsx` and restored complete collection without weakening or skipping tests.
- 2026-08-23: Current-head task acceptance is generated only after the
  implementation checkpoint, signed receipts and independent review artifacts
  agree on the same namespaced task assertions. The task-level approvals do
  not override the parent `acceptance.json` status of A3=`failing`.
- 2026-08-23: RustFS is S3-compatible, so the application must not introduce
  RustFS-specific business ports or a second storage abstraction. The adapter
  will use the AWS SDK S3 client with an explicit endpoint and path-style
  addressing, while application code depends only on the repository's
  `ObjectStoragePort`. This keeps local fake tests and a future S3-compatible
  provider on the same boundary.
- 2026-08-23: The RustFS adapter is selected independently in API and Media
  Worker startup from `OBJECT_STORAGE_*` settings. This avoids putting storage
  credentials into Graph contracts or worker job payloads, and keeps the mock
  provider available for ordinary CI. A real RustFS run must configure the same
  private bucket and endpoint in both processes.
- 2026-08-23: Use the existing 80-server RustFS only for an ephemeral canary
  until the application bucket boundary is approved. The canary uses the
  server-side app credential, a random `live-photo-studio/canary/` key and
  explicit deletion; production must either provision a dedicated bucket and
  policy or document the shared-bucket prefix/ownership controls.

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
- 2026-08-23: Operations triage will query bounded workflow projections and
  correlated domain jobs, not LangGraph checkpoint rows. Repair/replay will be a
  versioned, audited Outbox command with deterministic effect keys and explicit
  ownership checks.
- 2026-08-23: Implement object storage as a shared `packages/storage` adapter
  rather than embedding AWS SDK calls in API or Media Worker. `OBJECT_STORAGE_*`
  settings select `mock` or `s3`; `s3` requires an explicit endpoint, bucket and
  server-side credentials. Media uploads deterministic package objects before
  committing the export row; retries reuse the same keys and bytes. API signs
  only persisted object keys and enforces the configured short TTL. No signed
  URL or binary enters PostgreSQL, Graph state or logs.
- 2026-08-23: Use `workflowRunId` as `thread_id`; a project can have multiple runs.
- 2026-08-23: Store workflow query projections separately from checkpoint tables.
- 2026-08-23: Begin with `generation -> human review -> render -> export`; migrate
  upload/style subgraphs after the first slice is proven.
- 2026-08-23: Keep routing deterministic. Models may return typed recommendations,
  not arbitrary next-node names.
- 2026-08-23: Administrative signal replay is limited to persisted
  `PROCESSING`/`FAILED` signals and reuses the original validated payload. The
  audit row and the deterministic replay Outbox event are written in the same
  transaction, with the audit insert preceding the Outbox insert; consumed or
  otherwise non-replayable signals are rejected and audited.
- 2026-08-23: The operations projection names the current Outbox backlog age
  `oldestQueueAgeMs` for API compatibility, but documentation explicitly
  qualifies it as pending/processing Outbox age rather than Redis queue age.
- 2026-08-23: Keep workflow-run resumption as a Web session concern only:
  localStorage may retain a workflow run UUID and per-action idempotency keys,
  but server projections remain authoritative and all workflow writes continue
  through the centralized API client. A stored run is revalidated before a new
  run is started; only a confirmed 404 is eligible for replacement.
- 2026-08-23: Port the prototype's visual language through a scoped CSS module
  and semantic page structure rather than importing its Vite router, mock
  repositories, client-side phase transitions or browser ZIP generation.
- 2026-08-23: Use the explicitly selected user-scoped Verification Runtime
  rather than silently choosing the project scope, because the project runtime
  candidate was absent and the user scope was already available. Keep the
  runtime status as generated command output and do not hand-author a signed
  receipt.
- 2026-08-23: Preserve the dirty-worktree boundary for this no-commit task.
  SpecNav task acceptance and independent review approvals require a clean
  implementation snapshot; the correct outcome is an explicit delivery
  blocker, not a temporary stash, synthetic commit, or manually approved
  receipt.
- 2026-08-23: Use a local checkpoint commit as the stable implementation
  snapshot now that the user has explicitly authorized commits. Exclude
  CodeGraph and SpecNav session-local state through repository ignore rules;
  retain `.specnav.json` as project-level configuration. Do not push, deploy or
  modify production infrastructure.
- 2026-08-23: The installed SpecNav marketplace is under
  `/Users/wenliang_zeng/.codex/plugins/cache/specnav-marketplace`; the paths
  recorded in the generated workflow state omit that marketplace segment.
  The first receipt attempt failed with `MODULE_NOT_FOUND`, then the actual
  scripts were located and invoked. The receipt runner also expects executable
  commands in task `context.json.test_paths`, while the generated contexts
  contained file globs; those contexts are being corrected without changing
  product code.
- 2026-08-23: Task acceptance mappings use namespaced subclaims whose parent
  IDs are the frozen A1/A2/A3 assertions: foundation, durable orchestration,
  Web projection and canary validation contribute A1; worker facts contribute
  A2; operations/security contributes A3. The A3 parent remains failing until
  private storage, live Redis, real provider/codec and device checks are
  available.
- [~] 2026-08-23: Starting an independent-review repair milestone after the
  stable-snapshot review identified implementation gaps that cannot be closed
  by lifecycle metadata alone. The repair scope is limited to lock-time run
  revalidation and valid consumed-marker crash coverage, worker asset/output
  ownership plus concurrent duplicate claims, and Web export/download,
  project/run session validation and task-payload action gating. Existing
  system receipts are invalidated by any implementation change and must be
  regenerated on the new HEAD.
- 2026-08-23: The repair keeps the existing Graph/BullMQ split. A worker claim
  is a domain execution lease represented by the existing job row status and
  uniqueness constraints; it does not move routing into BullMQ or LangGraph.
  Export download returns a short-lived signed URL through an application port
  and does not persist signed URLs or media bytes in PostgreSQL.
- 2026-08-23: Treat the corrected package test scripts as part of the
  repository verification contract. A passing root test command is not valid
  evidence if the shell can silently omit top-level test files.
- 2026-08-23: Preserve append-only historical failures in `validation-log.jsonl`
  and evidence logs. Current-head passes supersede stale command-time claims
  for the reviewed snapshot, but no failed external check may be rewritten as
  a pass.

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

This section is updated after each production-like acceptance run; the final
state is recorded below.

2026-08-23 (Milestone 8/9 continuation):

- At `2026-08-23T18:03:58+08:00`, the next acceptance pass was started from
  the existing dirty worktree. The final rerun below supersedes the earlier
  command-time counts and records the current source state.
- Live Redis publication is still externally blocked by local `NOAUTH
  Authentication required`; real FFmpeg/object-storage/HEIC/device validation
  remains outside the fake renderer and ordinary CI boundary.
- SpecNav handoff is not yet accepted: after runtime repair and CodeGraph
  evidence generation, its remaining blockers are incomplete task-ledger
  lifecycle statuses, missing task acceptance artifacts, non-approved
  independent review verdicts, and the dirty implementation snapshot required
  by the no-commit constraint.

2026-08-23 (Operations and control-plane continuation):

- Observed passing commands in this continuation: API `22/22`, Web `5/5`
  after the export-boundary regression test, Graph contracts `4/4`, Graph
  runtime `3/3`, AI worker `3/3`, Media worker `4/4`, orchestrator local `4/4`,
  orchestrator PostgreSQL `11/11`, AI worker PostgreSQL `5/5`, Media worker
  PostgreSQL `5/5`, and PostgreSQL operations `4/4`.
- `pnpm --filter @live-photo-studio/orchestrator demo` now prints
  `WAITING_GENERATION`, `REVIEW_ANCHOR`, `WAITING_RENDER`, `COMPLETED` after
  the deterministic human-task correlation fix.
- The operations integration suite verified bounded 100-row projections,
  replay schema/state rejection, audit-before-Outbox insertion order and
  non-operator denial auditing. Evidence is under
  `docs/graph-engineering/evidence/`.
- At that point, the remaining acceptance gaps were explicit: browser
  refresh/reopen and 390px sensory evidence, complete signed-URL/private-
  bucket checks, live Redis/BullMQ publication, real provider/FFmpeg/HEIC/
  device validation, and SpecNav verification receipts/task acceptance
  artifacts. The final repository gates were rerun successfully below.

2026-08-23 (Prototype and Web continuation):

- The supplied prototype was inspected read-only and was not copied into the
  production Web path. Its SHA-256 and file-level findings are recorded above.
- The current Web snapshot has no project browser test renderer or approved
  Verification 2.0 browser case plan. The managed Verification Runtime is
  installed, but no project browser/sensory case was executed; the framework-
  neutral session/idempotency tests and static 390px/focus/export evidence
  therefore remain the honest local boundary.

2026-08-23 (Final validation and retrospective):

- Observed passing commands: `pnpm install --frozen-lockfile`, `pnpm check`,
  `pnpm test`, `pnpm graph:check`, `pnpm graph:test`, `pnpm graph:demo`,
  `DATABASE_URL=postgresql://postgres@localhost:5432/postgres pnpm db:migrate`,
  and `git diff --check`. The migration command reported `applied:[]` and
  `skipped:6`; the demo reported
  `WAITING_GENERATION -> REVIEW_ANCHOR -> WAITING_RENDER -> COMPLETED`.
- Current PostgreSQL integration results: Orchestrator `11/11`, AI Worker
  `7/7`, Media Worker `8/8`, and API operations `26/26`. The tests cover
  restart, duplicate START and signals, wrong correlation, late cancellation
  signals, stale recovery, consumed-marker crash replay, old graph versions,
  bounded regeneration, worker ownership, deterministic exports, refresh and
  duplicate-click session behavior, operations replay/audit ordering, and
  redaction/cost controls.
- The managed Verification Runtime doctor returned `ok:true`, `readiness=ready`,
  `runtime_version=2.0.0-alpha.2`, `runtime_scope=user`, and
  `fallback_used=false`. It emitted only the unconfigured Midscene-provider
  warning; no Midscene-backed sensory case was executed.
- CodeGraph `1.3.1` indexed 91 files, 948 nodes and 2,316 edges. The claims
  report returned all six development claims verified with no unverified claims
  or CodeGraph blockers.
- The repository remains intentionally uncommitted and dirty because the user
  prohibited commit/push/deploy. SpecNav's task-acceptance generator therefore
  rejects the implementation snapshot before it can create signed task
  acceptance artifacts. The six task review files remain `needs-fix`, the task
  ledger has no `spec_review_passed`, `quality_review_passed` or `complete`
  entries, and the Verification 2.0 case plan/receipts were not fabricated.
- Acceptance A1 and A2 are locally passing. A3 remains `failing` because live
  private object storage, signed-URL TTL, Redis/BullMQ publication, real
  provider, production codec/HEIC and iOS device/PhotoKit behavior were not
  available for this run. Local Node `v22.19.0` is also below the declared
  `>=24` engine and pnpm reported an ignored `sharp` build script.

2026-08-23 (Stable snapshot pass):

- The user authorized a local checkpoint commit after the final validation
  rerun. Local CodeGraph, root SpecNav runtime state and
  `openspec/.specnav/` session state remain excluded from the repository
  snapshot by `.gitignore`; `.specnav.json` remains project configuration.
- The checkpoint commit and the subsequent system-executed receipts are still
  pending in this pass. Handoff is not claimed until the owning SpecNav
  contract returns `ok:true`.

2026-08-23 (Independent-review repair and final validation):

- Implemented the reviewed repair slice: lock-time workflow-run reload,
  replay-safe Graph projection/event/consumed-marker writes, durable
  pre-side-effect claims for AI and Media jobs, asset/output scope checks,
  export download boundary, project/run session validation and task-payload
  action gating. Workers still emit facts and correlated signals only; they do
  not write Graph-path project phases.
- Fixed package test discovery by quoting `src/**/*.test.ts`. The final
  ordinary suite passed 63 tests across the workspace: contracts 6, runtime 3,
  API 30, Web 13, AI Worker 3, Media Worker 4 and Orchestrator 4. The final
  PostgreSQL suites passed API 33, AI Worker 9, Media Worker 13 and
  Orchestrator 11.
- Final commands observed passing: `pnpm install --frozen-lockfile`,
  `pnpm check`, `pnpm test`, `pnpm graph:check`, `pnpm graph:test`,
  `pnpm graph:demo`, `DATABASE_URL=postgresql://postgres@localhost:5432/postgres
  pnpm db:migrate` and `git diff --check`. Migration replay reported
  `applied:[]` and `skipped:6`; the demo reached
  `WAITING_GENERATION -> REVIEW_ANCHOR -> WAITING_RENDER -> COMPLETED`.
- One concurrent `pnpm graph:test` attempt failed in an API cancellation test
  with `400 !== 202`; the same complete API suite passed with
  `--test-concurrency=1`, and the next full `pnpm graph:test` passed. This is
  retained as a test-runner stability observation, not hidden.
- Remaining risks/blockers: Node `v22.19.0` is below the declared `>=24`,
  pnpm ignored the `sharp` build script, local Redis requires authentication,
  the default download signer intentionally fails closed, and private
  storage, signed-URL TTL, live Redis/BullMQ, real model/provider, FFmpeg/
  ImageMagick/libheif/HEIC and iOS PhotoKit/device validation were not run.
  A3 remains `failing`; no browser sensory E2E was executed.

2026-08-23 (Current-head SpecNav acceptance):

- `node /Users/wenliang_zeng/.codex/plugins/cache/specnav-marketplace/specnav-verification/0.3.0/scripts/evidence-runner.js refresh-current-head --change graph-engineering-full-migration` replayed 29 formal task commands with `failed=0`, `overturned=0`.
- `node /Users/wenliang_zeng/.codex/plugins/cache/specnav-marketplace/specnav-development/0.3.0/scripts/task-acceptance-evidence.js write --project /Volumes/zwl/open_sources/live-photo-studio-graph-engineering --change graph-engineering-full-migration --force` materialized six task acceptance artifacts bound to the reviewed committed implementation snapshot.
- `node /Users/wenliang_zeng/.codex/plugins/cache/specnav-marketplace/specnav-development/0.3.0/scripts/development-contract.js --mode handoff --json` returned `ok=true`, with no blockers or warnings.
- The parent acceptance contract remains intentionally mixed: A1=`passing`, A2=`passing`, A3=`failing`. The remaining A3 and production-like gaps are private storage/signed URL TTL, authenticated Redis/BullMQ, real provider and media codecs, browser sensory validation and iOS PhotoKit/device behavior.

2026-08-23 (RustFS storage slice):

- `pnpm install` and the subsequent frozen-lockfile install completed with the
  repository's existing Node `v22.19.0` engine warning and ignored `sharp`
  build-script warning; no credentials were used or persisted.
- `pnpm check`, `pnpm test`, `pnpm graph:check`, `pnpm graph:test`,
  `pnpm graph:demo`, `DATABASE_URL=postgresql://postgres@localhost:5432/postgres
  pnpm db:migrate` and `git diff --check` passed. Migration replay reported
  `applied:[]` and `skipped:6`; the Graph demo ended
  `WAITING_GENERATION -> REVIEW_ANCHOR -> WAITING_RENDER -> COMPLETED`.
- PostgreSQL integration commands observed passing on this HEAD:
  `RUN_PG_TESTS=1 pnpm --filter @live-photo-studio/api test` (34/34),
  `RUN_PG_TESTS=1 pnpm --filter @live-photo-studio/worker-ai test` (9/9),
  `RUN_PG_TESTS=1 pnpm --filter @live-photo-studio/worker-media test`
  (13/13), and `RUN_PG_TESTS=1 pnpm --filter
  @live-photo-studio/orchestrator test` (11/11).
- The private RustFS server was not contacted in this pass because its exact
  endpoint, bucket and credential source were not supplied to the repository
  process. A3 remains failing for live private-object, signed-URL and canary
  acceptance; local fake and PostgreSQL evidence is not substituted for it.

2026-08-23 (Credentialed RustFS verification):

- Read-only server commands observed RustFS health `200` on the remote
  `9000/9001` endpoints and identified Nginx `storage.motion-cover.com` as the
  public S3-compatible entry. The application bucket and region were read as
  `camera-rental-return` and `us-east-1`; credential values were not printed.
- `curl -ksS -I --max-time 10 https://storage.motion-cover.com/health` returned
  HTTP `200`; an unsigned S3-root request returned HTTP `403`.
- The first local canary invocation from the repository root failed before any
  network request because Node could not resolve `@aws-sdk/client-s3` from the
  root eval context (`ERR_MODULE_NOT_FOUND`). No object was created. Rerunning
  the same adapter logic from `packages/storage` passed.
- The passing canary result was: `uploadedBytes=68`,
  `sha256Verified=true`, `unsignedStatus=403`, `signedStatus=200`,
  `signedTtlSeconds=60`, `cleanup=true`. This clears the live adapter/private
  access/signed-TTL check for the observed RustFS bucket, but A3 remains
  failing for dedicated application bucket policy, live Redis/BullMQ,
  real provider and media codec/HEIC checks, browser sensory validation and
  iOS PhotoKit/device behavior.

2026-08-23T23:35:14+08:00 (Post-RustFS documentation validation):

- `openspec validate --all --strict --no-interactive --json` returned one valid
  change with no issues. Evidence JSON parsing and `git diff --check` passed.
- `pnpm check`, `pnpm test`, `pnpm graph:check`, `pnpm graph:test`,
  `pnpm graph:demo`, and
  `DATABASE_URL=postgresql://postgres@localhost:5432/postgres pnpm db:migrate`
  passed. The migration replay reported `applied=[] skipped=6`; the demo
  reached `WAITING_GENERATION -> REVIEW_ANCHOR -> WAITING_RENDER -> COMPLETED`.
- Ordinary tests passed with storage `3/3`, Graph contracts `6/6`, Graph runtime
  `3/3`, API `31/31`, Web `13/13`, AI Worker `3/3`, Media Worker `4/4` and
  Orchestrator `4/4`. PostgreSQL suites passed API `34/34`, AI Worker `9/9`,
  Media Worker `13/13` and Orchestrator `11/11`.
- The repository still reports the known Node `v22.19.0` versus declared
  `>=24` engine warning and pnpm's ignored `sharp` build-script warning. No
  new test or implementation failure was observed.

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
