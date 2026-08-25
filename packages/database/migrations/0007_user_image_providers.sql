-- Per-user image generation provider settings. API keys are stored as
-- AES-256-GCM ciphertext (see packages/graph-runtime secret-box); plaintext
-- keys never touch the database, logs or graph state.
CREATE TABLE IF NOT EXISTS user_image_providers (
  user_id text PRIMARY KEY,
  base_url text NOT NULL,
  api_key_ciphertext text NOT NULL,
  model text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Prompt provenance for generation batches (expand phase; nullable).
ALTER TABLE generation_batches
  ADD COLUMN IF NOT EXISTS prompt_version text,
  ADD COLUMN IF NOT EXISTS prompt_hash text;
