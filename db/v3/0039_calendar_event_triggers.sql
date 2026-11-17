-- 0039_calendar_event_triggers.sql: Proactive event-aware Google Calendar triggers (pre-meeting reminders & change watch) and atomic single-winner dispatch dedupe barrier.
CREATE TABLE IF NOT EXISTS calendar_event_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('pre_meeting_reminder', 'event_change_watch')),
  credential_id UUID NOT NULL,
  calendar_ids JSONB NOT NULL CHECK (jsonb_typeof(calendar_ids) = 'array' AND jsonb_array_length(calendar_ids) BETWEEN 1 AND 5),
  lead_minutes INT NOT NULL DEFAULT 15 CHECK (lead_minutes BETWEEN 1 AND 1440),
  destination JSONB NOT NULL CHECK (jsonb_typeof(destination) = 'object'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'blocked')),
  pause_reason TEXT,
  snapshot JSONB,
  watch_channel_id TEXT,
  watch_resource_id TEXT,
  watch_expiration TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calendar_trigger_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_id UUID NOT NULL REFERENCES calendar_event_triggers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 256),
  event_id TEXT,
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('pending', 'sent', 'failed')),
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  UNIQUE (trigger_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS calendar_event_triggers_user_idx
  ON calendar_event_triggers(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS calendar_event_triggers_active_idx
  ON calendar_event_triggers(status) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS calendar_event_triggers_watch_idx
  ON calendar_event_triggers(watch_channel_id) WHERE watch_channel_id IS NOT NULL;
