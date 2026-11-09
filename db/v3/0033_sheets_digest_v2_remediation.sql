-- 0033_sheets_digest_v2_remediation.sql
-- Additive, idempotent DDL for Sheets Digest v2 remediation (zero data mutation on schedules/schedule_runs)

CREATE TABLE IF NOT EXISTS sheets_digest_v2_migration_audit (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id             UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL,
  workspace_mode          TEXT,
  workspace_id            UUID,
  previous_status         TEXT NOT NULL,
  previous_pause_reason   TEXT,
  previous_next_run_at    TIMESTAMPTZ,
  previous_schedule_ver   INTEGER NOT NULL,
  migrated_schedule_ver   INTEGER NOT NULL,
  previous_config_version INTEGER,
  previous_digest_config  JSONB NOT NULL,
  previous_config_hash    TEXT,
  outcome                 TEXT NOT NULL CONSTRAINT sheets_digest_v2_audit_outcome_check
                            CHECK (outcome IN ('upgraded_v2', 'paused_reauth_required', 'already_v2', 'inactive_preserved')),
  reason_code             TEXT NOT NULL,
  reason_detail           TEXT NOT NULL,
  migrated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  rolled_back_at          TIMESTAMPTZ,
  rollback_outcome        TEXT,
  CONSTRAINT sheets_digest_v2_audit_schedule_unique UNIQUE (schedule_id)
);

ALTER TABLE schedule_runs
  ADD COLUMN IF NOT EXISTS delivery_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_resolution TEXT,
  ADD COLUMN IF NOT EXISTS delivery_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_followup_run_id UUID REFERENCES schedule_runs(id) ON DELETE SET NULL;

ALTER TABLE schedule_runs DROP CONSTRAINT IF EXISTS schedule_runs_delivery_resolution_check;
ALTER TABLE schedule_runs ADD CONSTRAINT schedule_runs_delivery_resolution_check
  CHECK (
    delivery_resolution IS NULL
    OR delivery_resolution IN ('confirmed_sent', 'retried_new_run')
  );
