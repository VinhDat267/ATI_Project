-- Business intent reservation and cross-run deduplication for Pilot v2.
-- Additive only.

CREATE TABLE business_reservations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_key   TEXT NOT NULL UNIQUE,
  source_key   TEXT NOT NULL,
  board_id     TEXT NOT NULL,
  run_id       UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'reserved'
               CHECK (status IN ('reserved', 'dispatched', 'confirmed', 'unknown', 'cancelled')),
  remote_id    TEXT,
  remote_url   TEXT,
  operation_id UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX business_reservations_source_idx ON business_reservations (source_key);
CREATE INDEX business_reservations_status_idx ON business_reservations (status);
CREATE INDEX business_reservations_run_idx ON business_reservations (run_id);

CREATE TRIGGER business_reservations_touch
  BEFORE UPDATE ON business_reservations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
