## Context

The repository already contains a versioned `live-photo-project:v1` graph,
PostgreSQL workflow projections, an Outbox dispatcher, AI and media workers,
and a web projection. The remaining migration work is cross-cutting: it must
prove ownership boundaries, make resume and duplicate delivery behavior
restart-safe, and document the operational path from feature flag to rollback.
The product boundary is a web export package for a future iOS importer, not
direct PhotoKit persistence.

## Goals / Non-Goals

**Goals:**

- Keep LangGraph as the control plane and BullMQ as the execution plane.
- Bind each run to an immutable graph key/version and use the run ID as the
  LangGraph thread ID.
- Make commands, worker facts, signals and Graph side effects replay-safe.
- Preserve project ownership, private storage, redacted observability and
  mock-provider cost safety.
- Provide testable canary, triage and rollback procedures while the legacy path
  remains available.
- Deploy the authorized canary through the designated server's Woodpecker CI
  service with Basic Auth, same-origin Nginx routing and Cloudflare proxying.

**Non-Goals:**

- Replace BullMQ with Graph scheduling.
- Add real iOS PhotoKit import or require chargeable model calls.
- Rewrite unrelated product modules or perform a general-public production
  launch.
- Remove old graph factories or legacy phase writes before the cutover gate.

## Decisions

1. **One routing owner.** `apps/orchestrator` is the only process that chooses
   the next Graph phase. API and workers publish commands or facts through the
   Outbox. This is preferred over distributed status writes because it gives
   one deterministic state machine and makes replay behavior auditable.
2. **Durable bridge.** PostgreSQL Outbox rows are the handoff from API/workers
   to BullMQ. The Outbox event ID is the BullMQ `jobId`, and every payload is
   parsed from `unknown` with the shared Zod contracts. This is preferred over
   direct `queue.add()` because database writes and delivery intent remain
   atomic.
3. **Single-writer resume.** The orchestrator acquires a PostgreSQL advisory
   lock per workflow run, claims a signal with a visibility timeout, validates
   its correlation and resumes the exact `workflowRunId` once. This is
   preferred over process-local locks because restarts and multiple replicas
   must share the same ownership rule.
4. **Facts before signals.** AI and media workers commit domain facts first and
   emit a correlated completion/failure signal in the same transaction.
   Duplicate jobs return the existing deterministic fact. This is preferred
   over phase writes in workers because workers do not own business routing.
5. **Bounded repair.** Human regeneration increments a persisted revision and
   stops at `maxRepairAttempts`, routing to a terminal failure or human
   fallback. This is preferred over unbounded automatic loops because model
   repair cost and user wait time need a hard limit.
6. **Projection-driven web UI.** The web client reads workflow projections and
   human-task payloads through the centralized API client. SSE only invalidates
   queries. This is preferred over client-held workflow state because refresh
   and reconnect must recover from the server.
7. **Flagged cutover.** `GRAPH_WORKFLOW_ENABLED` controls new Graph starts.
   Canary evidence compares success, latency, cost and support incidents; the
   rollback path stops new Graph starts and routes new work to legacy without
   deleting checkpoints or old graph factories.
8. **Protected canary deployment.** Woodpecker builds one Node 24 image named
   from the Git commit, runs additive migrations and checkpoint setup, then
   replaces the five application processes through Compose. Nginx exposes only
   a Basic Auth-protected same-origin hostname through Cloudflare; PostgreSQL,
   Redis and object-storage data survive application rollback.

## Risks / Trade-offs

- [Duplicate delivery] Outbox confirmation can fail after queue publish ->
  deterministic job IDs and consumer idempotency make republish safe.
- [Stale signal ownership] A crashed consumer can leave a signal processing ->
  visibility timeout and explicit stale recovery allow one controlled re-drive.
- [Graph compatibility] Active runs may reference old nodes or state fields ->
  graph factories remain registered and breaking changes use a new version.
- [Retry multiplication] Provider, BullMQ and Graph loops can multiply cost ->
  provider retries are narrow, BullMQ owns transient execution retry, and
  Graph owns bounded business repair.
- [Incomplete external verification] Local Redis may require authentication
  and real media tooling may be unavailable -> keep fake adapters, operator
  commands and honest blocked evidence.
- [Legacy divergence] The flag can expose two paths during canary -> record
  rollout criteria and rollback ownership in the operations runbook.
- [Canary exposure] The application still uses demo `x-user-id` identity and a
  deterministic placeholder media renderer -> require Basic Auth, mock
  provider mode and explicit canary copy; do not present it as a public
  production service or real PhotoKit output.

## Migration Plan

1. Finish worker phase-ownership regression tests and fix PostgreSQL integration
   seed typing.
2. Complete Graph, Outbox and API/web/worker contract tests for duplicate,
   cancellation, correlation and bounded repair behavior.
3. Add structured observability fields, safe admin triage read models and
   security/cost regression tests.
4. Apply additive migrations, run package and repository checks, and capture
   evidence under `docs/graph-engineering/evidence/`.
5. Enable the Graph flag for a canary cohort, compare the documented metrics,
   and keep legacy routing available.
6. Deploy the protected canary through Woodpecker, verify unauthenticated
   denial, authenticated Web/API health, private storage CORS and commit-image
   release records.
7. If rollback criteria trigger, stop new Graph starts, route new projects to
   legacy, let active Graph runs finish or cancel through audited commands, and
   retain old graph versions.

## Open Questions

None for the current repository scope. Live Redis authentication, production
HEIC/FFmpeg capability, real provider regression and iOS PhotoKit import remain
explicit external work outside ordinary CI and must not be fabricated.
