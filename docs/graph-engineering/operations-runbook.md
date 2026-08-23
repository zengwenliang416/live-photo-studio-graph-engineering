# Graph Operations Runbook

This runbook covers the versioned Graph control plane and its PostgreSQL
projection. It does not authorize manual edits to LangGraph checkpoint rows,
production credentials, object storage, or Photos-library assets.

## Before Deployment

1. Back up PostgreSQL and verify the restore path.
2. Apply the additive business migrations:

   ```bash
   DATABASE_URL="$DATABASE_URL" pnpm db:migrate
   DATABASE_URL="$DATABASE_URL" pnpm db:migrate
   ```

   The second run must report no newly applied migrations.
3. Run LangGraph checkpoint setup as an explicit migration action, not during
   every application start.
4. Keep `AI_PROVIDER=mock` for ordinary validation. Real provider checks need a
   separately approved budget and server-side credentials.
5. Set a non-empty `GRAPH_ADMIN_USER_IDS` allowlist before exposing the admin
   endpoints. Values are comma-separated authenticated user IDs.
6. For RustFS, configure the shared S3-compatible adapter on both API and Media
   Worker. Keep the bucket private and never place the access key or secret in
   Web/Next.js variables:

   ```dotenv
   OBJECT_STORAGE_BACKEND=s3
   OBJECT_STORAGE_ENDPOINT=https://rustfs.example.internal
   OBJECT_STORAGE_REGION=us-east-1
   OBJECT_STORAGE_BUCKET=live-photo-studio
   OBJECT_STORAGE_ACCESS_KEY_ID=<server-side-access-key>
   OBJECT_STORAGE_SECRET_ACCESS_KEY=<server-side-secret-key>
   OBJECT_STORAGE_FORCE_PATH_STYLE=true
   OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS=300
   ```

   The endpoint, bucket and credential values are deployment-specific. Do not
   guess them from an undocumented default port or commit them to the repository.
7. Deploy the API and workers with Graph command/signal publication enabled, but
   keep orchestrator consumption disabled or at zero replicas until the canary
   checks are ready.
8. Enable orchestrator consumption and verify one canary workflow from start
   through export using the API projection.

## Operator Triage

The admin view is bounded to 100 rows per related collection and reads
PostgreSQL workflow/domain projections. It does not read checkpoint tables
directly.

```bash
export API_BASE='http://localhost:4000'
export OPERATOR_USER_ID='replace-with-an-allowlisted-operator'
export WORKFLOW_RUN_ID='00000000-0000-0000-0000-000000000000'

curl --fail-with-body \
  -H "x-user-id: ${OPERATOR_USER_ID}" \
  "${API_BASE}/v1/admin/workflow-runs/${WORKFLOW_RUN_ID}/triage"
```

The response includes the run phase/status, trace metadata, pending human
tasks, correlated signals, node effects, node latency, generation/render
records, Outbox rows and bounded metrics. `oldestQueueAgeMs` is the age of the
oldest pending/processing **Outbox row** in this snapshot; it is not a live
Redis/BullMQ queue-age measurement.

Operator access is allowlist-based. A denied triage or replay attempt writes a
`workflow_admin_audit_events` row with outcome `DENIED`; it does not expose a
projection to the caller.

## Audited Signal Replay

Replay only uses the signal payload already persisted in PostgreSQL. The
operation revalidates that payload against the published signal schema, locks
the workflow run and signal, writes the `ALLOWED` audit record, marks the signal
`PROCESSING`, and writes one deterministic Outbox event in the same
transaction.

```bash
export SIGNAL_ID='00000000-0000-0000-0000-000000000000'

curl --fail-with-body \
  -X POST \
  -H "content-type: application/json" \
  -H "x-user-id: ${OPERATOR_USER_ID}" \
  -d '{"reason":"visibility timeout after worker restart"}' \
  "${API_BASE}/v1/admin/workflow-runs/${WORKFLOW_RUN_ID}/signals/${SIGNAL_ID}/replay"
```

Expected outcomes:

- `202` with `{ "data": { "status": "ACCEPTED", "eventId": "..." } }` for a
  valid `PROCESSING` or `FAILED` signal.
- `409 SIGNAL_ALREADY_CONSUMED` for a consumed signal.
- `409 SIGNAL_NOT_REPLAYABLE` for a pending or otherwise ineligible signal.
- `409 SIGNAL_PAYLOAD_INVALID` for a persisted signal that no longer satisfies
  the published schema.
- `403 OPERATOR_ACCESS_REQUIRED` for a non-allowlisted authenticated caller.

Do not replay a signal by editing `workflow_signals`, `outbox_events` or
checkpoint rows manually. Before replay, confirm the external job and domain
fact are still safe to re-drive; workers must remain idempotent.

## Stuck Workflow Triage Order

1. `workflow_runs.status`, `current_phase`, `current_node`,
   `last_error_code` and `updated_at`.
2. Pending `human_tasks` and their task-declared allowed actions.
3. Pending or processing `workflow_signals`, including correlation ID and
   visibility age.
4. `workflow_node_effects`, deterministic effect key and external job ID.
5. Generation/render domain job status and error code.
6. Pending/processing Outbox delivery, attempt count and last error.
7. The matching LangGraph thread/checkpoint, only through the orchestrator
   runtime.

The same transient failure must not be retried independently by LangGraph,
BullMQ and the provider adapter. Graph repair loops are bounded; BullMQ owns
transient execution retry; invalid input, authorization failure and content
rejection are not transient retries.

## Canary

The API canary gate is configured with:

```dotenv
GRAPH_WORKFLOW_ENABLED=true
GRAPH_WORKFLOW_CANARY_USER_IDS=user-a,user-b
GRAPH_ADMIN_USER_IDS=operator-a
```

When the canary list is non-empty, only those authenticated user IDs can create,
decide or cancel Graph workflow runs. Other authenticated callers receive
`503 LEGACY_WORKFLOW_ROUTE_REQUIRED`. This repository snapshot does not contain
a complete legacy workflow route, so that response is a deliberate integration
boundary, not proof that a legacy fallback is available locally.

Before enabling a wider cohort, record these operator thresholds and compare
them with the same observation window on the legacy path:

- workflow terminal failure rate;
- duplicate signal count and stale-signal age;
- p95 time from start to generation completion, human decision and export;
- model cost per successful export;
- render failure rate and support incidents.

The implementation exposes bounded projection data and counters but does not
automatically calculate a production canary verdict. Do not mark a canary
successful without recording the measured window, cohort, sample size and
rollback decision.

## Rollback

Rollback stops new Graph writes first and preserves recoverability:

```bash
# 1. Stop new Graph workflow writes at the API boundary.
export GRAPH_WORKFLOW_ENABLED=false

# 2. Restart/redeploy the API with the changed environment.
# 3. Scale the orchestrator command/signal consumer to zero.
# 4. Keep old graph factories and checkpoint tables intact.
```

With the current API behavior, disabled Graph writes return
`404 WORKFLOW_FEATURE_DISABLED`; the snapshot does not implement an internal
legacy route. If a legacy service exists in the deployment environment, route
new projects there at the deployment/router layer and document that external
route explicitly. Do not represent the local `404` as a working legacy
fallback.

For active Graph runs, either let idempotent work drain, or cancel through the
authorized workflow command path. Do not delete interrupted runs, old graph
factories, checkpoint tables, domain facts, or Outbox rows during rollback.
Keep each run's original `graphKey + graphVersion` binding until no active or
interrupted run references it.

## External Verification Blockers

The following checks require environment capabilities not supplied by ordinary
CI and must remain explicitly blocked when unavailable:

- Live Redis/BullMQ publication. A local unauthenticated probe currently returns
  `NOAUTH Authentication required`; rerun with approved credentials only:

  ```bash
  redis-cli -u "$REDIS_URL" ping
  ```

- Real OpenAI/provider regression. Use a separate budget-limited job; never put
  the key in browser variables or logs.
- Real RustFS private-bucket, object upload and signed-URL TTL verification.
  Use a credentialed operator shell to run `aws s3api head-bucket` against
  `OBJECT_STORAGE_ENDPOINT`, then execute one approved canary workflow and
  verify the package key exists privately, the recorded SHA-256 matches the
  object bytes, and the signed URL expires within the configured TTL. Do not
  paste credentials or signed URLs into logs or chat.
- Real FFmpeg/ImageMagick/libheif capability, HEIC input validation and device
  playback. The current media renderer uses deterministic fake bytes for
  control-plane tests.
- iOS PhotoKit import. A Web ZIP is a downloadable resource package for a
  future iOS Importer; it is not an asset already saved to the iPhone Photos
  library.

Record blocked commands and their exact error without converting them to
passing acceptance evidence.
