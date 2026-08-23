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

The Graph contracts, runtime utilities, database schema, orchestrator process,
PostgreSQL adapters, v1 graph, demo and tests are scaffolded. The transitional
`PostgresWorkflowEffectAdapter` emits workflow Outbox events. The existing API,
AI worker and media worker still need to consume/produce those contracts. That
work is specified milestone-by-milestone in
`docs/execplans/graph-engineering-full-migration.md`.

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
