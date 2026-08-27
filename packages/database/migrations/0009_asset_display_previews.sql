CREATE TABLE IF NOT EXISTS asset_variants (
  id uuid PRIMARY KEY,
  asset_id uuid NOT NULL REFERENCES project_assets(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  variant_type text NOT NULL CHECK (variant_type IN ('DISPLAY_PREVIEW')),
  recipe_version text NOT NULL,
  object_key text NOT NULL UNIQUE,
  content_type text NOT NULL,
  bytes integer CHECK (bytes > 0),
  status text NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, variant_type, recipe_version)
);

CREATE INDEX IF NOT EXISTS idx_asset_variants_project
  ON asset_variants(project_id, variant_type, status, created_at);

INSERT INTO outbox_events (
  id,
  aggregate_type,
  aggregate_id,
  event_type,
  payload
)
SELECT
  gen_random_uuid(),
  'asset',
  asset.id::text,
  'asset.preview.requested.v1',
  jsonb_build_object(
    'jobId', asset.id,
    'projectId', asset.project_id,
    'assetId', asset.id,
    'recipeVersion', 'display-preview.v1'
  )
FROM project_assets AS asset
WHERE asset.status = 'READY'
  AND NOT EXISTS (
    SELECT 1
    FROM asset_variants AS variant
    WHERE variant.asset_id = asset.id
      AND variant.variant_type = 'DISPLAY_PREVIEW'
      AND variant.recipe_version = 'display-preview.v1'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM outbox_events AS event
    WHERE event.aggregate_type = 'asset'
      AND event.aggregate_id = asset.id::text
      AND event.event_type = 'asset.preview.requested.v1'
  );
