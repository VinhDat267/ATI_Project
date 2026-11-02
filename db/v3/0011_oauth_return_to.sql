-- OAUTH-01: a Gmail connection started from a conversation returns to it.
-- Every migration file runs again on each migrate, so each step is idempotent.
-- 0009 drops every oauth_states check that mentions mode when it runs again;
-- this file runs after it and adds its own check back.
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS return_to TEXT;
ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_return_to_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_return_to_check CHECK (
  return_to IS NULL
  OR (mode IN ('connect_gmail', 'connect_mycalendar', 'connect_mysheets', 'connect_trello', 'connect_github', 'connect_telegram') AND return_to ~ '^/c/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
