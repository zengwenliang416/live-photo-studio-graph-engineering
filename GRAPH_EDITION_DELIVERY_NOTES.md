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

## Deliberately left to the ExecPlan

The existing NestJS public API, AI Worker, Media Worker and Next.js UI are not
silently rewired in this delivery. They need repository-specific integration,
contract generation and regression testing. The full implementation sequence and
acceptance criteria are in:

`docs/execplans/graph-engineering-full-migration.md`

This avoids shipping two competing project state machines without completing the
cutover and rollback work.

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
