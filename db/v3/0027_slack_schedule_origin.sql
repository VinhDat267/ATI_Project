-- Source-free schedule cutover. No default or trigger certifies old or bypass writes.
-- Slack-sourced schedules keep 03B2G lineage and never receive a row here.
CREATE TABLE IF NOT EXISTS slack_schedule_origin_cutovers (
  id TEXT PRIMARY KEY CHECK (id = 'schedule-origin-v1'),
  enabled BOOLEAN NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO slack_schedule_origin_cutovers(id, enabled) VALUES ('schedule-origin-v1', true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS slack_schedule_origins (
  schedule_id UUID PRIMARY KEY REFERENCES schedules(id) ON DELETE CASCADE,
  ati_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conv_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  cutover_id TEXT NOT NULL REFERENCES slack_schedule_origin_cutovers(id),
  producer TEXT NOT NULL CHECK (producer IN ('schedule_writer', 'backfill_plain', 'physical_purge')),
  remainder_fingerprint TEXT NOT NULL CHECK (remainder_fingerprint ~ '^[a-f0-9]{64}$'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
