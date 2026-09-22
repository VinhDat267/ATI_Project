-- Pilot v2 profile and source snapshots
-- Additive only.

ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS profile TEXT NOT NULL DEFAULT 'b-local';

CREATE TABLE pilot_profiles (
  id          TEXT PRIMARY KEY,
  config      JSONB NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER pilot_profiles_touch
  BEFORE UPDATE ON pilot_profiles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE source_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  source_key        TEXT NOT NULL,
  source_revision   TEXT NOT NULL,
  raw_data          JSONB NOT NULL,
  checklist_version TEXT NOT NULL,
  checklist_result  JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX source_snapshots_run_idx ON source_snapshots (run_id);
CREATE INDEX source_snapshots_key_rev_idx ON source_snapshots (source_key, source_revision);
