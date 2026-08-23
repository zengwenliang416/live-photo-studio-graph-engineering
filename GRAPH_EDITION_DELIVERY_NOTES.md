# Graph Engineering Edition Delivery Notes

Generated: 2026-08-23

## Added in this edition

- `apps/orchestrator` with a versioned LangGraph.js v1 workflow.
- PostgreSQL and in-memory checkpointer wiring.
- Durable workflow projection, signal, human-task and effect schema.
- PostgreSQL advisory locking and signal de-duplication scaffolding.
- Shared `graph-contracts` and `graph-runtime` packages.
- Idempotent generation/render Outbox effect adapter.
- In-memory happy-path demo and graph tests.
- Graph architecture docs, ADR, operations runbook and node authoring guide.
- Root and nested `AGENTS.md` Graph rules.
- `PLANS.md`, a full living ExecPlan and ready-to-run Codex prompts/scripts.

## Current integration state

The minimal end-to-end Graph control-plane slice is now integrated and tested:

- NestJS API writes workflow commands/decisions/cancel requests and Outbox
  records transactionally; it never invokes a compiled graph directly.
- AI Worker and Media Worker consume execution jobs, persist domain facts and
  emit correlated signals without changing Graph-path project phases.
- Next.js Web uses the API client, TanStack Query projection, SSE invalidation,
  stable idempotency keys and a server-validated refresh/reopen session helper.
- Operations triage/replay is bounded, authenticated, audited and backed by
  PostgreSQL integration coverage.

The full implementation sequence and acceptance criteria remain in:

`docs/execplans/graph-engineering-full-migration.md`

The project still does not claim private object storage, live Redis/BullMQ,
real provider/media codec or iOS PhotoKit verification without those external
capabilities.

## Prototype boundary

`/Users/wenliang_zeng/Downloads/live-photo-studio (2).zip` was inspected
read-only. Its visual tokens, shell structure, candidate-review composition and
Photos boundary copy are reference material. Its Vite router, browser-side mock
orchestrator, localStorage/IndexedDB domain repositories and browser ZIP builder
are deliberately not copied into the production path. See
`docs/graph-engineering/evidence/prototype-boundary.json`.

## Verification required on a development machine

The prior delivery did not have a lockfile because npm registry access was
unavailable in its build environment. After extracting this edition, run:

```bash
corepack enable
pnpm install
pnpm check
pnpm test
pnpm graph:check
pnpm graph:test
pnpm graph:demo
```

Resolve actual dependency/API drift, commit `pnpm-lock.yaml`, and only then make
CI/Docker installs frozen. The generated Graph code has not been represented as
production-ready until those commands and the migration integration tests pass.

## Database migration

`packages/database/migrations/0001_graph_workflow_runtime.sql`
