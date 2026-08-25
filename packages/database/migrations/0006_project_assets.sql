-- Project asset uploads. Tracks declared vs confirmed object sizes so the
-- ingest flow can verify presigned uploads before marking an asset READY.
CREATE TABLE IF NOT EXISTS project_assets (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  object_key text NOT NULL UNIQUE,
  content_type text NOT NULL,
  declared_bytes integer NOT NULL CHECK (declared_bytes > 0),
  bytes integer CHECK (bytes > 0),
  sha256 text,
  status text NOT NULL DEFAULT 'UPLOADING'
    CHECK (status IN ('UPLOADING','READY','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_project_assets_project
  ON project_assets(project_id, created_at);
