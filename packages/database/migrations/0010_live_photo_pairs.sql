ALTER TABLE asset_roles
  DROP CONSTRAINT IF EXISTS asset_roles_role_check;

ALTER TABLE asset_roles
  ADD CONSTRAINT asset_roles_role_check CHECK (
    role IN (
      'CONTENT',
      'COVER',
      'STYLE_REFERENCE',
      'IDENTITY_REFERENCE',
      'LIVE_PHOTO_VIDEO'
    )
  );

ALTER TABLE project_assets
  ADD CONSTRAINT project_assets_project_id_id_key UNIQUE (project_id, id);

CREATE TABLE live_photo_pairs (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  photo_asset_id uuid NOT NULL,
  video_asset_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PAIRED' CHECK (status IN ('PAIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_photo_pairs_photo_project_fk
    FOREIGN KEY (project_id, photo_asset_id)
    REFERENCES project_assets(project_id, id)
    ON DELETE CASCADE,
  CONSTRAINT live_photo_pairs_video_project_fk
    FOREIGN KEY (project_id, video_asset_id)
    REFERENCES project_assets(project_id, id)
    ON DELETE CASCADE,
  CONSTRAINT live_photo_pairs_photo_unique UNIQUE (photo_asset_id),
  CONSTRAINT live_photo_pairs_video_unique UNIQUE (video_asset_id),
  CONSTRAINT live_photo_pairs_distinct_assets CHECK (
    photo_asset_id <> video_asset_id
  )
);

CREATE INDEX idx_live_photo_pairs_project
  ON live_photo_pairs(project_id, created_at);
