# Graph Engineering Architecture

This edition adds a versioned Graph control plane without replacing the existing
Next.js, NestJS, PostgreSQL, Redis/BullMQ, object-storage, AI-worker or
media-worker execution plane.

## Ownership model

- **Graph Orchestrator** decides the next business phase.
- **NestJS API** authenticates users, creates commands and exposes query models.
- **BullMQ** schedules long-running work and isolates concurrency.
- **AI Worker** reports generation facts; it does not route the workflow.
- **Media Worker** reports render facts; it does not route the workflow.
- **PostgreSQL** stores business facts, workflow projections and durable signals.
- **LangGraph checkpointer** stores resumable internal graph state.
- **S3/MinIO** stores all binary assets.

## Included v1 graph

`live-photo-project:v1` implements the first migration slice:

```text
START
  -> load_project_v1
  -> dispatch_generation_v1
  -> await_generation_v1       [external interrupt]
  -> human_select_anchor_v1     [human interrupt]
       -> regenerate -> dispatch_generation_v1
       -> cancel     -> cancelled_v1 -> END
       -> select     -> dispatch_render_v1
  -> await_render_v1             [external interrupt]
  -> complete_v1
  -> END
```

The graph uses idempotent effect keys before external dispatch, correlation IDs
for resume signals and a fixed graph version per workflow run.

## Migration status

The Graph contracts, runtime utilities, additive database schema, orchestrator
process, PostgreSQL adapters, API command boundary, AI Worker, Media Worker,
Web projection and operations triage are integrated for the v1 control-plane
slice. The current local path is mock-provider and deterministic-renderer safe:
it proves routing, persistence, restart recovery, duplicate delivery handling,
ownership and redaction without requiring chargeable provider calls.

The supplied high-fidelity Vite prototype is a visual and information
architecture reference only. Its obsidian/gold/editorial tokens, shell,
candidate review and export-boundary copy are compatible with the Web path.
Its browser-side mock orchestrator, localStorage/IndexedDB domain stores,
custom router and browser ZIP builder are not production integrations. The
current Next.js page keeps the API projection as the only workflow truth.

Remaining external verification is deliberately explicit in
`docs/execplans/graph-engineering-full-migration.md`: private S3/MinIO and
signed URL TTLs, live Redis/BullMQ publication, real provider calls,
FFmpeg/ImageMagick/libheif/HEIC capability and iOS device/PhotoKit behavior.

## Local verification after dependency installation

```bash
pnpm install
pnpm db:migrate
pnpm graph:check
pnpm graph:test
pnpm graph:demo
```

The demo uses an in-memory checkpointer and fake external effects. Production
uses the PostgreSQL checkpointer and must run checkpoint setup explicitly during
a controlled migration step.

## New database migration

`packages/database/migrations/0001_graph_workflow_runtime.sql`
