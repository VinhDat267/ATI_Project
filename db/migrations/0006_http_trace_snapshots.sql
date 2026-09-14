-- API-03: immutable, short-lived snapshots backing HTTP trace cursors.
CREATE TABLE http_trace_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  attempts JSONB NOT NULL CHECK (jsonb_typeof(attempts) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX http_trace_snapshots_expiry_idx
  ON http_trace_snapshots (expires_at);
CREATE INDEX http_trace_snapshots_owner_run_idx
  ON http_trace_snapshots (user_id, run_id, created_at DESC);
