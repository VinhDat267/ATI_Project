-- 0037_telegram_cache_and_trello_token_locks.sql
-- Idempotent additive migration for Scope 2:
-- 1. Bounded encrypted chat message cache shared across coordinated Telegram getUpdates pollers.
-- 2. Multi-process PostgreSQL refresh-rotation lock & expiry columns on service_credentials (Trello OAuth).

CREATE TABLE IF NOT EXISTS telegram_chat_message_cache (
  bot_key TEXT NOT NULL REFERENCES telegram_update_cursors(bot_key) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  message_id BIGINT NOT NULL CHECK (message_id >= 1),
  message_date BIGINT NOT NULL CHECK (message_date >= 0),
  payload TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (bot_key, chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS telegram_chat_message_cache_chat_idx
  ON telegram_chat_message_cache (bot_key, chat_id, expires_at DESC, message_date DESC, message_id DESC);

CREATE INDEX IF NOT EXISTS telegram_chat_message_cache_expiry_idx
  ON telegram_chat_message_cache (expires_at);

ALTER TABLE service_credentials ADD COLUMN IF NOT EXISTS refresh_state TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE service_credentials ADD COLUMN IF NOT EXISTS refresh_attempt_id UUID;
ALTER TABLE service_credentials ADD COLUMN IF NOT EXISTS refresh_started_at TIMESTAMPTZ;
ALTER TABLE service_credentials ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE service_credentials ADD COLUMN IF NOT EXISTS status_reason TEXT;
ALTER TABLE service_credentials ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'service_credentials_refresh_state_check'
       AND conrelid = 'service_credentials'::regclass
  ) THEN
    ALTER TABLE service_credentials
      ADD CONSTRAINT service_credentials_refresh_state_check
      CHECK (refresh_state IN ('idle', 'refreshing', 'failed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'service_credentials_token_version_check'
       AND conrelid = 'service_credentials'::regclass
  ) THEN
    ALTER TABLE service_credentials
      ADD CONSTRAINT service_credentials_token_version_check
      CHECK (token_version > 0);
  END IF;
END $$;
