CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  title text NOT NULL DEFAULT '',
  cover_asset_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_user
  ON projects(user_id, created_at DESC);

-- Minimal asset role registry consumed by the orchestrator project read model.
-- The full media pipeline (variants, object keys, EXIF policy) lives in the
-- product edition; this baseline only tracks the workflow-facing roles.
CREATE TABLE IF NOT EXISTS asset_roles (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL,
  role text NOT NULL CHECK (
    role IN ('CONTENT', 'COVER', 'STYLE_REFERENCE', 'IDENTITY_REFERENCE')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, asset_id, role)
);

CREATE INDEX IF NOT EXISTS idx_asset_roles_project_role
  ON asset_roles(project_id, role, created_at);

CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED')
  ),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_dispatch
  ON outbox_events(status, created_at)
  WHERE status IN ('PENDING', 'PROCESSING');

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  user_id text NOT NULL,
  request_hash text NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, idempotency_key, user_id)
);
