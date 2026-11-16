-- 0037_telegram_chat_messages.sql
-- Policy update for telegram.read_messages: supersedes the message-text prohibition in
-- 0020_telegram_update_inbox.sql ONLY for this dedicated table. Retains short-lived (24h TTL)
-- sanitized text messages exclusively for chats present in an active personal Telegram
-- connection's selectedChats allowlist. Never stores unapproved chats, bot tokens, or /start pairing state.
CREATE TABLE IF NOT EXISTS telegram_chat_messages (
  bot_key TEXT NOT NULL REFERENCES telegram_update_cursors(bot_key) ON DELETE CASCADE,
  chat_id TEXT NOT NULL CHECK (chat_id ~ '^-?[0-9]{1,20}$'),
  message_id BIGINT NOT NULL CHECK (message_id > 0),
  sender_name TEXT NOT NULL CHECK (length(sender_name) <= 200),
  text TEXT NOT NULL CHECK (length(text) <= 4000),
  sent_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (bot_key, chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS telegram_chat_messages_expiry_idx
  ON telegram_chat_messages(expires_at);

CREATE INDEX IF NOT EXISTS telegram_chat_messages_lookup_idx
  ON telegram_chat_messages(bot_key, chat_id, sent_at DESC, message_id DESC);
