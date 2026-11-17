ALTER TABLE calendar_event_triggers
  ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS approved_config_hash TEXT,
  ADD COLUMN IF NOT EXISTS evaluation_id UUID,
  ADD COLUMN IF NOT EXISTS evaluation_expires_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'calendar_trigger_dispatches'::regclass AND conname = 'calendar_trigger_dispatches_status_v2_check') THEN
    ALTER TABLE calendar_trigger_dispatches
      ADD CONSTRAINT calendar_trigger_dispatches_status_v2_check
      CHECK (delivery_status IN ('pending', 'sent', 'failed', 'needs_attention'));
    ALTER TABLE calendar_trigger_dispatches
      DROP CONSTRAINT IF EXISTS calendar_trigger_dispatches_delivery_status_check;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS calendar_trigger_dispatches_pending_idx
  ON calendar_trigger_dispatches(created_at) WHERE delivery_status = 'pending';

CREATE TABLE IF NOT EXISTS calendar_trigger_consumed_previews (
  id UUID PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Keep provider identifiers after a rule is deleted so the next poll can stop its channel.
CREATE TABLE IF NOT EXISTS calendar_trigger_watch_channels (
  channel_id UUID PRIMARY KEY,
  trigger_id UUID REFERENCES calendar_event_triggers(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id UUID NOT NULL,
  calendar_id TEXT NOT NULL,
  callback_url TEXT NOT NULL,
  resource_id TEXT,
  requested_at TIMESTAMPTZ NOT NULL,
  registered_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  retire_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS calendar_trigger_watch_channels_trigger_idx
  ON calendar_trigger_watch_channels(trigger_id, calendar_id);
