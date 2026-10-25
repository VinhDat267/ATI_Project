-- OAUTH-01: a Gmail connection started from a conversation returns to it.
-- Every migration file runs again on each migrate, so each step is idempotent.
-- The check does not name mode: 0009 drops and re-adds the checks on mode
-- each time it runs. Only the connect_gmail start route writes return_to, and
-- only the Gmail callback reads it.
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS return_to TEXT;
ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_return_to_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_return_to_check CHECK (
  return_to IS NULL
  OR return_to ~ '^/c/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
