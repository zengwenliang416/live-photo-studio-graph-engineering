CREATE TABLE IF NOT EXISTS workflow_runs (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  graph_key text NOT NULL,
  graph_version text NOT NULL,
  thread_id text NOT NULL UNIQUE,
  status text NOT NULL CHECK (
    status IN ('QUEUED', 'RUNNING', 'INTERRUPTED', 'SUCCEEDED', 'FAILED', 'CANCELLED')
  ),
  current_node text,
  current_phase text,
  last_error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_project
  ON workflow_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status
  ON workflow_runs(status, updated_at);

CREATE TABLE IF NOT EXISTS workflow_step_runs (
  id uuid PRIMARY KEY,
  workflow_run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_name text NOT NULL,
  node_version integer NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  status text NOT NULL CHECK (
    status IN ('QUEUED', 'RUNNING', 'INTERRUPTED', 'SUCCEEDED', 'FAILED', 'CANCELLED')
  ),
  external_job_id uuid,
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_run_id, node_name, attempt)
);

CREATE TABLE IF NOT EXISTS workflow_signals (
  id uuid PRIMARY KEY,
  workflow_run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  signal_type text NOT NULL,
  correlation_id text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'CONSUMED', 'FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  UNIQUE (workflow_run_id, correlation_id, signal_type)
);

CREATE INDEX IF NOT EXISTS idx_workflow_signals_pending
  ON workflow_signals(status, created_at)
  WHERE status IN ('PENDING', 'PROCESSING');

CREATE TABLE IF NOT EXISTS human_tasks (
  id uuid PRIMARY KEY,
  workflow_run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  task_type text NOT NULL,
  node_name text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (
    status IN ('PENDING', 'COMPLETED', 'CANCELLED', 'EXPIRED')
  ),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_human_tasks_active_node
  ON human_tasks(workflow_run_id, node_name, status)
  WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS workflow_node_effects (
  id uuid PRIMARY KEY,
  workflow_run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  node_name text NOT NULL,
  effect_key text NOT NULL UNIQUE,
  external_job_id uuid,
  status text NOT NULL CHECK (
    status IN ('REQUESTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')
  ),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_node_effects_run
  ON workflow_node_effects(workflow_run_id, node_name);

CREATE TABLE IF NOT EXISTS workflow_events (
  id uuid PRIMARY KEY,
  workflow_run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_events_run
  ON workflow_events(workflow_run_id, created_at);
