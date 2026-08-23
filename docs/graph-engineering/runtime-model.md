# Runtime Model

## Control plane versus execution plane

A graph node may be pure, database-backed, model-backed, an external job,
a router, an aggregator, a human gate or a compensation action. Nodes that
perform long work do not keep the orchestrator process blocked. They create an
idempotent external effect, emit an Outbox event and pause at an interrupt.

The worker writes its business result first, then emits a workflow signal with:

- `workflowRunId`
- `signalType`
- `correlationId`
- a small validated payload

The orchestrator acquires a per-run PostgreSQL advisory lock, inserts the signal
under a uniqueness constraint and resumes the exact `thread_id` once.

## Sources of truth

| Concern | Source of truth |
|---|---|
| Project, asset, generation, render and export facts | Domain tables |
| Workflow query status | `workflow_runs` projection |
| Node resume state | LangGraph checkpoint tables |
| External job delivery | Outbox + BullMQ |
| Binary media | RustFS S3-compatible object storage |
| User review request | `human_tasks` |

Do not query LangGraph checkpoint tables from the web application. They are an
implementation detail. API queries use the workflow projection and domain data.

## Retry ownership

- Provider connection retry: zero or one small adapter-level retry.
- BullMQ retry: transient external execution failure.
- Graph loop: business repair, such as prompt correction.
- Human gate: user-correctable input or approval.

Never multiply three retry policies for the same failure.
