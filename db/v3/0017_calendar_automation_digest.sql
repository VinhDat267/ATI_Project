-- 0017_calendar_automation_digest.sql: Calendar auto_digest schedule mode and delivery receipts.
-- Every migration file runs again on each migrate, so each step is idempotent.

-- 1. Schedules: execution mode choice ('plan' vs 'sheets_digest' | 'calendar_digest' | 'github_digest' | 'telegram_digest').
ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'plan',
  ADD COLUMN IF NOT EXISTS digest_config JSONB,
  ADD COLUMN IF NOT EXISTS digest_config_hash TEXT,
  ADD COLUMN IF NOT EXISTS digest_approved_at TIMESTAMPTZ;

ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_kind_check;
ALTER TABLE schedules ADD CONSTRAINT schedules_kind_check
  CHECK (kind IN ('plan', 'sheets_digest', 'calendar_digest', 'github_digest', 'telegram_digest'));

ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_kind_digest_check;
ALTER TABLE schedules ADD CONSTRAINT schedules_kind_digest_check
  CHECK (
    (kind = 'plan' AND digest_config IS NULL AND digest_config_hash IS NULL AND digest_approved_at IS NULL)
    OR (
      kind IN ('sheets_digest', 'calendar_digest', 'github_digest', 'telegram_digest')
      AND digest_config IS NOT NULL
      AND jsonb_typeof(digest_config) = 'object'
      AND digest_config_hash IS NOT NULL
      AND digest_config_hash ~ '^[0-9a-f]{64}$'
      AND digest_approved_at IS NOT NULL
    )
  );

-- 2. Schedule runs: support digest_sent and digest_failed statuses with delivery receipt.
ALTER TABLE schedule_runs
  ADD COLUMN IF NOT EXISTS delivery JSONB;

ALTER TABLE schedule_runs DROP CONSTRAINT IF EXISTS schedule_runs_status_check;
ALTER TABLE schedule_runs ADD CONSTRAINT schedule_runs_status_check
  CHECK (status IN (
    'planning',
    'planned',
    'needs_attention',
    'planning_failed',
    'missed',
    'blocked',
    'interrupted',
    'discarded',
    'digest_sent',
    'digest_failed'
  ));

ALTER TABLE schedule_runs DROP CONSTRAINT IF EXISTS schedule_runs_delivery_check;
ALTER TABLE schedule_runs ADD CONSTRAINT schedule_runs_delivery_check
  CHECK (
    (status = 'digest_sent' AND delivery IS NOT NULL AND jsonb_typeof(delivery) = 'object')
    OR (status <> 'digest_sent' AND delivery IS NULL)
  );
