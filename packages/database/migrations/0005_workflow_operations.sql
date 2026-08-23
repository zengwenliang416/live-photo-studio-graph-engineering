-- Operational context and audited repair state. These columns contain IDs,
-- bounded counters and provider metadata only; media bytes stay in storage.
ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS trace_id text,
  ADD COLUMN IF NOT EXISTS current_node_version integer,
  ADD COLUMN IF NOT EXISTS last_external_job_id uuid,
  ADD COLUMN IF NOT EXISTS provider_request_id text;

ALTER TABLE workflow_signals
  ADD COLUMN IF NOT EXISTS trace_id text,
  ADD COLUMN IF NOT EXISTS node_name text,
  ADD COLUMN IF NOT EXISTS node_version integer,
  ADD COLUMN IF NOT EXISTS external_job_id uuid,
  ADD COLUMN IF NOT EXISTS provider_request_id text,
  ADD COLUMN IF NOT EXISTS duplicate_count integer NOT NULL DEFAULT 0;

ALTER TABLE workflow_node_effects
  ADD COLUMN IF NOT EXISTS trace_id text,
  ADD COLUMN IF NOT EXISTS node_version integer,
  ADD COLUMN IF NOT EXISTS provider_request_id text;

ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS trace_id text,
  ADD COLUMN IF NOT EXISTS node_name text,
  ADD COLUMN IF NOT EXISTS node_version integer,
  ADD COLUMN IF NOT EXISTS external_job_id uuid,
  ADD COLUMN IF NOT EXISTS provider_request_id text;

ALTER TABLE generation_batches
  ADD COLUMN IF NOT EXISTS trace_id text,
  ADD COLUMN IF NOT EXISTS provider_request_id text,
  ADD COLUMN IF NOT EXISTS cost_micros bigint NOT NULL DEFAULT 0;

ALTER TABLE render_jobs
  ADD COLUMN IF NOT EXISTS trace_id text,
  ADD COLUMN IF NOT EXISTS external_job_id uuid,
  ADD COLUMN IF NOT EXISTS provider_request_id text;

CREATE INDEX IF NOT EXISTS idx_workflow_runs_trace
  ON workflow_runs(trace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_signals_trace
  ON workflow_signals(trace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS workflow_admin_audit_events (
  id uuid PRIMARY KEY,
  operator_id text NOT NULL,
  workflow_run_id uuid REFERENCES workflow_runs(id) ON DELETE SET NULL,
  action text NOT NULL,
  command_version text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('ALLOWED', 'DENIED', 'REJECTED')),
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_admin_audit_run
  ON workflow_admin_audit_events(workflow_run_id, created_at DESC);
