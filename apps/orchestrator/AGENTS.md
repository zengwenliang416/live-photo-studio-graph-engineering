# Orchestrator Agent Instructions

The orchestrator is the only component allowed to decide the next business phase.

## Required invariants

- `workflowRunId` is the LangGraph `thread_id`; never use `projectId` as the thread ID.
- A workflow run is permanently bound to `graphKey + graphVersion` at creation.
- Published node names are stable API. Do not rename or remove them while runs exist.
- Every side effect before or after `interrupt()` must be idempotent and keyed with `buildNodeEffectKey`.
- Graph state stores IDs and small structured values only. Never store binary media, Base64, clients, secrets, signed URLs or full provider responses.
- Workers report facts through signals; workers never choose the next graph node or update the project phase directly.
- Resume signals must be schema-validated, correlated to the pending job and consumed once.
- All loops require a hard upper bound and a human fallback.
- Configure transient retries in one layer only. Do not multiply LangGraph, BullMQ and provider retries.
- Use PostgreSQL advisory locking or an equivalent single-writer mechanism per workflow run.

## Change procedure

1. Read `docs/execplans/graph-engineering-full-migration.md`.
2. Update the living plan before and after every milestone.
3. Add route tests for every branch and checkpoint-resume tests for every interrupt.
4. Keep old graph versions registered until no active run references them.
5. Record compatibility decisions in an ADR.
