-- A committed reservation for a non-idempotent filesystem dispatch.
-- This is a dispatch boundary, not proof that bytes reached the filesystem.
CREATE TABLE filesystem_dispatches (
  operation_id UUID PRIMARY KEY REFERENCES tool_operations(operation_id),
  user_id UUID NOT NULL REFERENCES users(id),
  run_id UUID NOT NULL REFERENCES runs(id),
  relative_path TEXT NOT NULL CHECK (char_length(relative_path) BETWEEN 1 AND 1024),
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  launch_hash TEXT NOT NULL CHECK (launch_hash ~ '^[a-f0-9]{64}$'),
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX filesystem_dispatches_run ON filesystem_dispatches(user_id, run_id);

COMMENT ON TABLE filesystem_dispatches IS
  'Committed dispatch reservation, NOT proof a filesystem write happened, NOT a receipt.';

COMMENT ON COLUMN filesystem_dispatches.dispatched_at IS
  'Reservation boundary, not observed filesystem commit time.';
