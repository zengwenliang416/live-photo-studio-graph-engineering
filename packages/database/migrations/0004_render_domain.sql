-- Render/export domain for the media worker. Storage keys and hashes only.
CREATE TABLE IF NOT EXISTS render_jobs (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workflow_run_id uuid,
  selected_output_id uuid NOT NULL REFERENCES generation_outputs(id),
  status text NOT NULL DEFAULT 'RUNNING' CHECK (
    status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')
  ),
  recipe_version text NOT NULL DEFAULT 'v1',
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_render_jobs_run
  ON render_jobs(workflow_run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS export_packages (
  id uuid PRIMARY KEY,
  render_job_id uuid NOT NULL UNIQUE REFERENCES render_jobs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  package_key text NOT NULL,
  cover_key text NOT NULL,
  motion_key text NOT NULL,
  manifest_key text NOT NULL,
  manifest jsonb NOT NULL,
  sha256 text NOT NULL,
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  bytes integer NOT NULL CHECK (bytes > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_export_packages_project
  ON export_packages(project_id, created_at DESC);
