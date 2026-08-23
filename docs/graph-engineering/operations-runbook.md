# Graph Operations Runbook

## Before deployment

1. Back up PostgreSQL.
2. Apply the business workflow migration.
3. Run LangGraph checkpoint setup as an explicit migration action, not on every
   application start.
4. Deploy the orchestrator with command consumption disabled or zero replicas.
5. Deploy API and worker signal producers.
6. Enable orchestrator consumption and verify one canary workflow.

## Stuck workflow triage

Check, in order:

1. `workflow_runs.status`, `current_phase`, `last_error_code`.
2. Pending `human_tasks`.
3. Pending or processing `workflow_signals`.
4. `workflow_node_effects` and its external job ID.
5. Domain generation/render job status.
6. Outbox delivery and BullMQ job state.
7. The matching LangGraph thread/checkpoint.

Never edit checkpoint rows manually. Repair the business fact or signal through
a versioned administrative command with an audit event.

## Duplicate completion event

The `(workflow_run_id, correlation_id, signal_type)` uniqueness constraint must
turn a duplicate into a no-op. Verify no duplicate billing or output rows were
created before manually retrying.

## Rollback

Keep the old API path available behind a feature flag until the Graph path has
passed canary and replay tests. Stop new graph runs before scaling the
orchestrator to zero. Do not delete old graph code while interrupted runs exist.
