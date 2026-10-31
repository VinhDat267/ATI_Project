-- Explicit writer cutover. No row default/trigger certifies old or bypass writes.
CREATE TABLE IF NOT EXISTS slack_message_origin_cutovers (
  id TEXT PRIMARY KEY CHECK (id = 'message-origin-v1'),
  enabled BOOLEAN NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO slack_message_origin_cutovers(id,enabled) VALUES('message-origin-v1',true)
ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS slack_message_origins (
  artifact_table TEXT NOT NULL CHECK (artifact_table IN ('messages','conversations')),
  artifact_id UUID NOT NULL,
  ati_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conv_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  cutover_id TEXT NOT NULL REFERENCES slack_message_origin_cutovers(id),
  producer TEXT NOT NULL CHECK (producer IN ('message_writer','title_first_user','conversation_create','title_manual','schedule_title','backfill_covered','backfill_manual','physical_purge')),
  selectors JSONB NOT NULL CHECK (jsonb_typeof(selectors)='array'),
  remainder_fingerprint TEXT NOT NULL CHECK (remainder_fingerprint ~ '^[a-f0-9]{64}$'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(artifact_table,artifact_id)
);
-- v3 migrations are repeatable; keep the explicit producer set consistent.
ALTER TABLE slack_message_origins DROP CONSTRAINT IF EXISTS slack_message_origins_producer_check;
ALTER TABLE slack_message_origins ADD CONSTRAINT slack_message_origins_producer_check
  CHECK (producer IN ('message_writer','title_first_user','conversation_create','title_manual','schedule_title','backfill_covered','backfill_manual','physical_purge'));
