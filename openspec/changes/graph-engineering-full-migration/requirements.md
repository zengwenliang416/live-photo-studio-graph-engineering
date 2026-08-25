# Requirements: graph-engineering-full-migration

## Summary

Complete the staged migration to a versioned LangGraph control plane for the
generation, human review, render and export workflow. The API, workers and web
client remain separate processes; BullMQ remains the execution plane and the
Graph orchestrator remains the only owner of Graph-path routing and phase
transitions.

## Users & Actors

- End users who start a project, review generated candidates, regenerate within
  a bounded repair budget, cancel, and download a web export package.
- API and worker processes that publish commands or facts.
- Orchestrator and operations users who recover stuck runs without editing
  checkpoint rows.

## In Scope

- Durable workflow runs bound to one `graphKey + graphVersion` and using
  `workflowRunId` as the LangGraph `thread_id`.
- Transactional Outbox delivery for workflow commands, domain jobs and Graph
  signals, with deterministic BullMQ job IDs.
- Restart-safe checkpoints, per-run single-writer locking, signal correlation,
  duplicate consumption and stale-processing recovery.
- Generation, human selection/regeneration/cancel, render and export vertical
  slices with worker facts and correlated resume signals.
- Web projection, task-payload-gated actions, idempotent writes and SSE
  invalidation.
- Observability fields/metrics, security and privacy checks, cost-safe mock
  tests, canary feature flag and rollback runbook.
- An explicitly authorized protected canary deployment on the designated
  server, triggered by the server Woodpecker CI service from `main`, using
  commit-addressed Node 24 images, dedicated PostgreSQL/Redis data, private
  object storage, Basic Auth and a proxied Cloudflare hostname.

## Out of Scope

- Real iOS PhotoKit importing and saving to the Photos library.
- Chargeable model calls in ordinary CI or tests.
- Replacing BullMQ with LangGraph scheduling.
- A general-public production launch, chargeable provider activation,
  unrestricted credential provisioning, or deletion of old graph versions
  while active runs exist.
- Full legacy product reconstruction outside the current repository snapshot.

## UI Design Impact

- Foundation spec: `openspec/specs/ui-design/design.md`
- Use the existing light-only, Simplified Chinese, mobile-first token system.
- Show stage-based progress and explicit review/error/cancel states. Do not
  use fake percentage progress or claim that a ZIP is already a Photos-library
  Live Photo.

## Theme & Locale Capability Impact

- Theme support: `light-only`
- Theme toggle policy: explicitly omit
- Internationalization: disabled
- Supported locales: `zh-CN`
- Default locale: `zh-CN`
- Prototype coverage: light mode and the default locale only

## Architecture & Database Impact

- Foundation spec: `openspec/specs/system-architecture/design.md`
- Keep API, orchestrator, AI worker and media worker independently deployable.
- Keep domain code independent from framework/provider infrastructure.
- Store media in private object storage and IDs/metadata in PostgreSQL.
- Additive migrations, immutable graph binding, transactional idempotency,
  project ownership checks and audited repair operations are required.
- Canary deployment must run application migrations and LangGraph checkpoint
  setup before replacing application containers, retain persistent data during
  rollback and keep Web/API ports bound to loopback behind Nginx.

## Frontend-Backend Data Flow Impact

- Foundation spec: `openspec/specs/frontend-backend-data-flow/design.md`
- API writes commands and Outbox rows atomically; workers write facts before
  emitting signals; Graph resumes only after correlated, schema-validated
  signals.
- Query projections are the web truth; SSE only invalidates and never carries
  final workflow state.
- Client retries safe reads or the same write key; BullMQ owns transient task
  retry and Graph owns bounded business repair loops.

## Component Architecture Impact

- Foundation spec: `openspec/specs/component-architecture/design.md`
- Keep page composition, domain review components, query hooks and API client
  boundaries separate. Presentational components must not fetch or mutate.
- Reuse the existing workflow hooks/client and extract action eligibility and
  stage derivation utilities when shared by more than one screen.

## Unresolved Gaps

- None for the current repository and documented product boundary.
