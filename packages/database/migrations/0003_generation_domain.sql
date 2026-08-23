-- Generation domain for the AI worker. IDs and small values only: binaries
-- live in object storage, referenced here by storage keys.
CREATE TABLE IF NOT EXISTS generation_batches (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workflow_run_id uuid,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  status text NOT NULL DEFAULT 'RUNNING' CHECK (
    status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')
  ),
  provider text NOT NULL DEFAULT 'mock',
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generation_batches_project
  ON generation_batches(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_batches_run
  ON generation_batches(workflow_run_id, revision);

CREATE TABLE IF NOT EXISTS generation_outputs (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES generation_batches(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generation_outputs_batch
  ON generation_outputs(batch_id, created_at);
