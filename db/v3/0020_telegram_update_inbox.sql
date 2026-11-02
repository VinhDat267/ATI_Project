-- Acknowledged Telegram updates must survive callback polls and process restarts.
-- Payloads contain only pairing-state hashes and the identity/chat metadata needed
-- by pairing/discovery, never ordinary message text or the raw OAuth state.
CREATE TABLE IF NOT EXISTS telegram_update_cursors (
  bot_key TEXT PRIMARY KEY,
  next_update_id BIGINT CHECK (next_update_id >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_update_inbox (
  bot_key TEXT NOT NULL REFERENCES telegram_update_cursors(bot_key) ON DELETE CASCADE,
  update_id BIGINT NOT NULL CHECK (update_id >= 0),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (bot_key, update_id)
);
CREATE INDEX IF NOT EXISTS telegram_update_inbox_expiry_idx ON telegram_update_inbox(expires_at);
