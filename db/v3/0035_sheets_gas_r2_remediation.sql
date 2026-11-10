-- 0035_sheets_gas_r2_remediation.sql
-- Additive schema extensions for Google Sheets R2 audit remediation:
-- 1. GAS-08: Immutable per-run dispatch config and hash snapshot on schedule_runs.
-- 2. GAS-10: Cross-worker durable lease table for serialized deduplicated Sheets appends.

ALTER TABLE schedule_runs
  ADD COLUMN IF NOT EXISTS dispatched_config JSONB,
  ADD COLUMN IF NOT EXISTS dispatched_config_hash TEXT;

CREATE OR REPLACE FUNCTION capture_schedule_run_dispatched_config()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.dispatched_config IS NULL THEN
    SELECT s.digest_config, s.digest_config_hash
      INTO NEW.dispatched_config, NEW.dispatched_config_hash
      FROM schedules s
     WHERE s.id = NEW.schedule_id
       AND s.version = NEW.schedule_version
       AND s.kind = 'sheets_digest';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schedule_runs_capture_dispatched_config ON schedule_runs;
CREATE TRIGGER trg_schedule_runs_capture_dispatched_config
BEFORE INSERT OR UPDATE ON schedule_runs
FOR EACH ROW
EXECUTE FUNCTION capture_schedule_run_dispatched_config();

CREATE TABLE IF NOT EXISTS sheets_append_leases (
  scope_key TEXT PRIMARY KEY CHECK (btrim(scope_key) <> ''),
  spreadsheet_id TEXT NOT NULL CHECK (btrim(spreadsheet_id) <> ''),
  sheet_title TEXT NOT NULL CHECK (btrim(sheet_title) <> ''),
  lease_id TEXT NOT NULL CHECK (btrim(lease_id) <> ''),
  owner_id TEXT NOT NULL CHECK (btrim(owner_id) <> ''),
  fencing_token BIGINT NOT NULL DEFAULT 1 CHECK (fencing_token >= 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unknown_outcome')),
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  unknown_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_sheets_append_leases_expires_at
  ON sheets_append_leases (expires_at);
