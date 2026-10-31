-- Time expiry is local to a persisted acquisition, not a global source barrier.
CREATE TABLE IF NOT EXISTS slack_derived_expiry_proofs (
  source_event_key TEXT PRIMARY KEY REFERENCES slack_invalidation_receipts(source_event_key) ON DELETE CASCADE,
  derived_copy_id UUID NOT NULL REFERENCES slack_derived_copies(id) ON DELETE CASCADE,
  target_version BIGINT NOT NULL CHECK(target_version>0),
  segment_index INT NOT NULL CHECK(segment_index>=0),
  captured_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  cutoff_at TIMESTAMPTZ NOT NULL,
  snapshot JSONB NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  UNIQUE(derived_copy_id,target_version,segment_index,expires_at),
  CHECK(expires_at>captured_at),
  CHECK(cutoff_at>=expires_at)
);
CREATE INDEX IF NOT EXISTS idx_slack_derived_segment_expiry
  ON slack_derived_provenance_segments(expires_at,derived_copy_id,segment_index);
