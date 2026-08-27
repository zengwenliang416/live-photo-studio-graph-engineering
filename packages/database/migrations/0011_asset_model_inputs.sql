ALTER TABLE asset_variants
  DROP CONSTRAINT IF EXISTS asset_variants_variant_type_check;

ALTER TABLE asset_variants
  ADD CONSTRAINT asset_variants_variant_type_check
  CHECK (variant_type IN ('DISPLAY_PREVIEW', 'MODEL_INPUT'));

WITH candidates AS MATERIALIZED (
  SELECT
    asset.id AS asset_id,
    asset.project_id,
    gen_random_uuid() AS event_id
  FROM project_assets AS asset
  WHERE asset.status = 'READY'
    AND asset.content_type <> 'video/quicktime'
    AND NOT EXISTS (
      SELECT 1
      FROM asset_variants AS variant
      WHERE variant.asset_id = asset.id
        AND variant.variant_type = 'MODEL_INPUT'
        AND variant.recipe_version = 'model-input.v1'
    )
)
INSERT INTO outbox_events (
  id,
  aggregate_type,
  aggregate_id,
  event_type,
  payload
)
SELECT
  candidate.event_id,
  'asset',
  candidate.asset_id::text,
  'asset.model-input.requested.v1',
  jsonb_build_object(
    'jobId', candidate.event_id,
    'projectId', candidate.project_id,
    'assetId', candidate.asset_id,
    'recipeVersion', 'model-input.v1'
  )
FROM candidates AS candidate;
