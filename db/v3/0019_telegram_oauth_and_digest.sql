-- 0019_telegram_oauth_and_digest.sql: Telegram 1-click pairing (connect_telegram), team chat scope, and auto_digest schedules.
-- Every migration file runs again on each migrate, so each step is idempotent.

-- 1. OAuth-style state flow: connect_telegram always belongs to one user and one live session.
ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_mode_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_mode_check CHECK (
  mode IN ('login', 'link', 'connect_gmail', 'connect_mycalendar', 'connect_mysheets', 'connect_trello', 'connect_github', 'connect_telegram')
);

ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_mode_owner_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_mode_owner_check CHECK (
  (mode = 'login' AND user_id IS NULL AND session_id IS NULL)
  OR (mode IN ('link', 'connect_gmail', 'connect_mycalendar', 'connect_mysheets', 'connect_trello', 'connect_github', 'connect_telegram') AND user_id IS NOT NULL AND session_id IS NOT NULL)
);

-- 2. Return path support for connect_telegram initiated from conversation view.
ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_return_to_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_return_to_check CHECK (
  return_to IS NULL
  OR (mode IN ('connect_gmail', 'connect_mycalendar', 'connect_mysheets', 'connect_trello', 'connect_github', 'connect_telegram') AND return_to ~ '^/c/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);

-- 3. Remove shared Telegram credentials (user_id IS NULL) and enforce personal ownership.
DELETE FROM service_credentials WHERE service = 'telegram' AND user_id IS NULL;

ALTER TABLE service_credentials DROP CONSTRAINT IF EXISTS service_credentials_telegram_owner_check;
ALTER TABLE service_credentials ADD CONSTRAINT service_credentials_telegram_owner_check CHECK (service <> 'telegram' OR user_id IS NOT NULL);

-- 4. Team chat scope: single row for the team + at most 10 shared group/channel chats.
CREATE TABLE IF NOT EXISTS telegram_team_scope (
  id TEXT PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  chosen_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_team_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id TEXT NOT NULL DEFAULT 'default' CHECK (scope_id = 'default') REFERENCES telegram_team_scope(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  title TEXT NOT NULL,
  chat_type TEXT NOT NULL DEFAULT 'supergroup' CHECK (chat_type IN ('private', 'group', 'supergroup', 'channel')),
  position INTEGER CHECK (position IS NULL OR (position BETWEEN 1 AND 10)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT telegram_team_chats_scope_chat_unique UNIQUE (scope_id, chat_id)
);

CREATE OR REPLACE FUNCTION check_telegram_team_chats_constraints()
RETURNS TRIGGER AS $$
DECLARE
  chat_count INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM telegram_team_scope WHERE id = NEW.scope_id) THEN
    RAISE EXCEPTION 'telegram_team_scope % does not exist', NEW.scope_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT count(*) INTO chat_count FROM telegram_team_chats WHERE scope_id = NEW.scope_id;
  IF chat_count > 10 THEN
    RAISE EXCEPTION 'telegram_team_chats cannot have more than 10 chats for scope %', NEW.scope_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_telegram_team_chats_constraints ON telegram_team_chats;
CREATE CONSTRAINT TRIGGER trg_check_telegram_team_chats_constraints
AFTER INSERT OR UPDATE ON telegram_team_chats
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION check_telegram_team_chats_constraints();

-- 5. Schedules: support kind = 'telegram_digest' alongside 'plan', 'sheets_digest', 'calendar_digest', 'github_digest'.
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'plan';
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS digest_config JSONB;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS digest_config_hash TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS digest_approved_at TIMESTAMPTZ;

ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_kind_check;
ALTER TABLE schedules ADD CONSTRAINT schedules_kind_check
  CHECK (kind IN ('plan', 'sheets_digest', 'calendar_digest', 'github_digest', 'telegram_digest'));

ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_kind_digest_check;
ALTER TABLE schedules ADD CONSTRAINT schedules_kind_digest_check CHECK (
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

-- 6. Schedule runs: support digest_sent and digest_failed statuses and delivery metadata.
ALTER TABLE schedule_runs ADD COLUMN IF NOT EXISTS delivery JSONB;

ALTER TABLE schedule_runs DROP CONSTRAINT IF EXISTS schedule_runs_status_check;
ALTER TABLE schedule_runs ADD CONSTRAINT schedule_runs_status_check CHECK (
  status IN ('planning', 'planned', 'needs_attention', 'planning_failed', 'interrupted', 'discarded', 'missed', 'blocked', 'digest_sent', 'digest_failed')
);

ALTER TABLE schedule_runs DROP CONSTRAINT IF EXISTS schedule_runs_delivery_check;
ALTER TABLE schedule_runs ADD CONSTRAINT schedule_runs_delivery_check CHECK (
  (status = 'digest_sent' AND delivery IS NOT NULL AND jsonb_typeof(delivery) = 'object')
  OR (status <> 'digest_sent' AND delivery IS NULL)
);
