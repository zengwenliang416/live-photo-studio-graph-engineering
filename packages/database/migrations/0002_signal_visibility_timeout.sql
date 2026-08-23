ALTER TABLE workflow_signals
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE workflow_signals
  ADD COLUMN IF NOT EXISTS last_error_code text;

CREATE INDEX IF NOT EXISTS idx_workflow_signals_processing_stale
  ON workflow_signals(status, updated_at)
  WHERE status = 'PROCESSING';
