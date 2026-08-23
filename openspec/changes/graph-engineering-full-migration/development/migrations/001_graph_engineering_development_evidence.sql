CREATE TABLE IF NOT EXISTS graph_engineering_development_evidence (
  evidence_id uuid PRIMARY KEY,
  change_id text NOT NULL,
  assertion_id text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  command text NOT NULL,
  result text NOT NULL
);
