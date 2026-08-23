# ADR 0010: Add a Versioned Graph Control Plane

- Status: Accepted
- Date: 2026-08-23

## Context

The product has a long-running workflow with file ingestion, image generation,
human selection, media rendering, retries and export. API controllers and
workers must not each own part of the project state machine.

## Decision

Use a versioned LangGraph.js orchestrator as the business control plane. Keep
BullMQ as the external task execution plane, PostgreSQL as the business source
of truth and Transactional Outbox as the reliable bridge. A workflow run binds
to one graph version and uses its run ID as the LangGraph thread ID.

## Consequences

Positive:

- Explicit branches, loops, interrupts and recovery.
- One owner for project phase transitions.
- Deterministic business routing around non-deterministic model calls.
- Observable node-level execution and human tasks.

Costs:

- A new orchestrator process and checkpoint schema.
- Signal correlation, locking and graph compatibility rules.
- A staged migration is required to eliminate the old worker-owned state
  transitions.

## Rejected alternatives

- BullMQ flows as the only workflow truth: insufficient for long human pauses
  and business-level versioning.
- Full microservices or Temporal immediately: excessive operational scope for
  the current product stage.
- Agent-controlled top-level routing: unsuitable for authorization, billing and
  deterministic media/export requirements.
