-- SLACK-06A / SLACK-06B: metadata-only proposal plan link, outbox thread_ts, and daily digest uniqueness.
ALTER TABLE slack_assistant_artifacts DROP CONSTRAINT IF EXISTS slack_assistant_artifacts_status_check;
ALTER TABLE slack_assistant_artifacts ADD CONSTRAINT slack_assistant_artifacts_status_check CHECK(status IN ('pending','needs_info','awaiting_approval','approved','rejected','running','completed','failed','stale'));
ALTER TABLE slack_assistant_artifacts ADD COLUMN IF NOT EXISTS active_plan_id uuid REFERENCES plans(id) ON DELETE SET NULL;
ALTER TABLE slack_assistant_artifacts ADD COLUMN IF NOT EXISTS local_date date;
CREATE UNIQUE INDEX IF NOT EXISTS slack_assistant_digest_day ON slack_assistant_artifacts(connection_id, local_date) WHERE kind='daily_digest_entry';
ALTER TABLE slack_write_outbox ADD COLUMN IF NOT EXISTS thread_ts text CHECK(thread_ts IS NULL OR thread_ts ~ '^[0-9]{1,10}\.[0-9]{6}$');
