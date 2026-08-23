# System Architecture & Database Spec

## Overview

Live Photo Studio is a B/S application with a Next.js web client, a NestJS
modular monolith API, PostgreSQL projections and domain facts, Redis/BullMQ
execution queues, private S3-compatible storage, an AI worker, a media worker,
and a versioned LangGraph orchestrator. LangGraph owns business routing;
BullMQ owns long-running execution.

## Application Topology

- Frontend runtime: Next.js mobile web application in `apps/web`.
- Backend runtime: NestJS API in `apps/api`; PostgreSQL is the business source
  of truth and stores workflow projections.
- API gateway or edge layer: the HTTP boundary terminates authentication and
  request validation; the browser never calls providers directly.
- Background workers: `apps/worker-ai` for image generation and `apps/worker-media`
  for normalization, rendering and export. `apps/orchestrator` is the only
  Graph routing process.
- External services: OpenAI-compatible image provider behind an adapter,
  FFmpeg/ImageMagick behind media ports, Redis/BullMQ, and private S3/MinIO.
- Local development entrypoints: `pnpm install`, `pnpm db:migrate`,
  `pnpm graph:check`, `pnpm graph:test`, `pnpm graph:demo`, and package tests.
- Production deployment shape: independently deployable web, API,
  orchestrator, AI worker and media worker processes with shared PostgreSQL,
  Redis and private object storage.

## Module Boundaries

Each module declares its responsibility, public contract, owned data and
extension points:

- `apps/web`: responsibility is workflow UI and upload interaction; public
  contract is the typed API client and page routes; owned data is UI state and
  query cache; extension points are new workflow screens and hooks.
- `apps/api`: responsibility is HTTP/auth/use-case orchestration; public
  contract is versioned REST and outbox commands; owned data is idempotency,
  workflow command projections and audit writes; extension points are
  application ports and controllers.
- `apps/orchestrator`: responsibility is Graph routing and phase transitions;
  public contract is graph factories, commands and signals; owned data is
  checkpoints, workflow projections, human tasks and node effects; extension
  points are versioned graph factories and repository ports.
- `apps/worker-ai`: responsibility is generation execution; public contract is
  generation job payloads and completion/failure facts; owned data is batches
  and outputs; extension points are provider adapters.
- `apps/worker-media`: responsibility is rendering/export execution; public
  contract is render job payloads and export facts; owned data is render jobs
  and packages; extension points are renderer adapters.
- Shared packages: responsibility is portable contracts, persistence helpers,
  queues, storage and logging; public contracts are typed ports and schemas;
  owned data is package-local implementation state; extension points are
  adapters that preserve dependency direction.

- `apps/web`: page routing, uploads, query projection and review interactions;
  depends on the API client and must not import provider or database code.
- `apps/api`: HTTP presentation, authorization, use cases, idempotency and
  Transactional Outbox; must not import compiled LangGraph graphs.
- `apps/orchestrator`: Graph factories, routing, checkpoint resume, per-run
  locks and workflow phase projection; may import LangGraph and graph runtime,
  but not UI or provider SDKs.
- `apps/worker-ai`: AI provider adapters, generation facts and completion
  signals; must not choose Graph nodes or write Graph phases.
- `apps/worker-media`: media/render adapters, export facts and completion
  signals; must not choose Graph nodes or write Graph phases.
- `packages/database`: pool, transactions and additive SQL migrations.
- `packages/graph-contracts`: Zod command, signal, job and event contracts;
  no runtime SDK dependencies.
- `packages/graph-runtime`: framework-neutral registry and idempotency helpers.
- `packages/queue`: queue names, payloads and Redis transport ports.
- `packages/storage`: private object-storage port and adapter.
- `packages/logger`: structured redacted logging.

Forbidden dependencies include domain code importing NestJS, React,
PostgreSQL, BullMQ, LangGraph, OpenAI, S3 or FFmpeg, and one bounded module
importing another module's private infrastructure.

## Frontend Architecture

- Routing: project and workflow IDs are URL state; refresh must recover from
  API projections.
- Rendering mode: server-rendered shell with client interactions where needed.
- State management: TanStack Query for server state, local component state for
  ephemeral form/review state; no binary Blob/Base64 in shared state.
- Form handling: controlled inputs with client hints and server-authoritative
  Zod validation.
- Data fetching: centralized typed API client; SSE only invalidates queries.
- Error handling: accessible text, retry/cancel actions and explicit stale-task
  conflicts.
- Design system source: `openspec/specs/ui-design/design.md` and project tokens.

## Backend Architecture

- API style: versioned REST under `/v1`, problem+json errors and `{ data }`
  success envelopes.
- Request validation: external data enters as `unknown` and is parsed with Zod
  at the boundary.
- Auth/session model: current demo boundary uses a server-provided user
  identity; production must replace it with real authentication. Every
  resource check uses `user_id + project_id`.
- Domain service boundaries: API creates commands and facts, orchestrator
  routes phases, workers execute jobs and report facts.
- Background jobs: BullMQ queues receive IDs, versions and small configuration
  only. Outbox event IDs are BullMQ job IDs.
- File/object storage: binaries stay in private S3/MinIO; PostgreSQL stores
  keys, hashes and metadata only.
- Observability: logs include service, event, timestamps, IDs and durations,
  while excluding secrets, signed URLs, Base64, GPS EXIF, full prompts and raw
  provider responses.

## API Surface

| Route or RPC | Owner | Input | Output | Auth | Side Effects |
| --- | --- | --- | --- | --- | --- |
| `POST /v1/projects/:projectId/workflow-runs` | API workflows | graph key/version | accepted workflow run | project owner + idempotency key | workflow row + start outbox |
| `GET /v1/workflow-runs/:workflowRunId` | API workflows | run ID | workflow projection | run owner | none |
| `GET /v1/workflow-runs/:workflowRunId/human-tasks` | API workflows | run ID | bounded task list | run owner | none |
| `POST /v1/human-tasks/:humanTaskId/decisions` | API workflows | action + selected output | decision result | task/run owner + idempotency key | task update + resume outbox |
| `POST /v1/workflow-runs/:workflowRunId/cancel` | API workflows | empty or reason | cancellation result | run owner + idempotency key | run update + cancel outbox |
| `GET /v1/workflow-runs/:workflowRunId/events` | API workflows | run ID + cursor | SSE invalidation events | run owner | none |

## Database Model

| Entity | Purpose | Owner | Fields | Relationships | Indexes | Constraints | Lifecycle | Migration | Retention/Deletion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `projects` | product scope and ownership | API/domain | UUID, user ID, status | owns assets and workflow runs | user/status | UUID and owner checks | active to deleted | additive baseline migration | mark deleted, async cleanup |
| `workflow_runs` | query projection of a graph run | orchestrator | run ID, project/user, graph key/version, phase, status, error | belongs to project | project/status, state | immutable graph binding | queued to terminal | additive graph migrations | retain audit and terminal metadata |
| `workflow_signals` | durable resume deliveries | orchestrator | run ID, type, correlation, payload, status | belongs to run | pending/updated | unique run/correlation/type | pending/processing/consumed/failed | visibility-timeout migration | retain bounded operational history |
| `human_tasks` | user review gate | orchestrator | task ID, run ID, type, payload, status | belongs to run | run/status | one pending task per effect | pending to completed/cancelled | graph runtime migration | retain decision audit |
| `workflow_node_effects` | idempotent node side effects | orchestrator | effect key, node, external job ID | belongs to run | effect key | unique effect key | created/completed | graph runtime migration | retain for replay window |
| `workflow_events` | API projection event stream | API/orchestrator | run ID, event type, payload | belongs to run | run/sequence | monotonic sequence | append-only | graph runtime migration | retain per product policy |
| `outbox_events` | transactional command/signal bridge | API/workers | event ID, type, payload, status | references domain facts | status/visibility | unique event ID | pending to sent/failed | baseline migration | retain delivery audit |
| `generation_batches` / `generation_outputs` | AI facts and candidate metadata | AI worker | IDs, job IDs, storage keys, hashes | batch owns outputs | batch/project | deterministic job/output IDs | queued to terminal | generation migration | delete objects asynchronously |
| `render_jobs` / `export_packages` | media facts and export metadata | media worker | selected output, recipe, manifest, hash | render owns package | run/status | deterministic job/package IDs | queued to terminal | render migration | delete objects asynchronously |

## Permissions & Security

- User roles: authenticated project user and separately authenticated
  read-only/repair operator.
- Permission checks: every command and human decision validates the project
  owner and the run/task relation; admin repair commands are audited.
- Data isolation: use `user_id + project_id`, never resource ID alone.
- Secret handling: provider, database, Redis and object-storage credentials are
  server-side environment or secret-manager values and never enter Graph state.
- Audit logging: cancellations, decisions, replay and repair actions include
  actor, run, request and result IDs without sensitive payloads.
- Abuse cases: oversized uploads, cross-project task submission, replayed
  commands, leaked signed URLs, prompt/log leakage and unbounded retries.

## Integration Boundaries

- Third-party APIs: image provider and media binaries are behind application
  ports and adapters.
- Webhooks: none required for the v1 graph.
- Queues: BullMQ carries outbox commands, generation jobs, render jobs and
  graph signals; consumers are idempotent.
- Email/SMS/push: not in the current migration.
- Payments: credit reservation/settlement/refund stays in the application
  boundary and is idempotent; no production billing call is required in CI.
- Analytics: operational metrics and traces only; no raw media or prompt
  telemetry.

## Operational Constraints

- Performance constraints: no synchronous AI, FFmpeg or large-file transfer
  in HTTP; queue payloads contain IDs and small values.
- Availability expectations: restart-safe graph checkpoints, durable outbox
  publication and recoverable processing signals.
- Migration rules: additive SQL migrations only; checkpoint setup is an
  explicit operator action.
- Backup/restore: back up PostgreSQL before migration and preserve old graph
  factories while active runs reference them.
- Feature flag rules: `GRAPH_WORKFLOW_ENABLED` selects the Graph path; legacy
  routing remains available until canary and rollback criteria pass.
- Rollback constraints: stop new Graph runs, drain or cancel active runs via
  audited commands, route new projects to legacy, and never delete checkpoints
  or graph versions during emergency rollback.

## Architecture Do's and Don'ts

- Do keep module ownership and phase ownership explicit.
- Do bind each run to one graph key and version and use the run ID as
  LangGraph `thread_id`.
- Do write domain facts before emitting correlated signals.
- Do update this spec when a feature changes architecture.
- Don't create a second orchestrator or replace BullMQ with Graph scheduling.
- Don't let workers choose next nodes or write Graph-path phases.
- Don't store media, Base64, signed URLs, secrets or full prompts in Graph
  state.
