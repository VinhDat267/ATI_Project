-- MYCALENDAR-01: Google Calendar cá nhân as each member's own connection.
-- Every migration file runs again on each migrate, so each step is idempotent.

-- 1. A fourth OAuth flow: connect_mycalendar always belongs to one user and one live session.
ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_mode_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_mode_check CHECK (
  mode IN ('login', 'link', 'connect_gmail', 'connect_mycalendar', 'connect_mysheets', 'connect_trello', 'connect_github', 'connect_telegram')
);

ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_mode_owner_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_mode_owner_check CHECK (
  (mode = 'login' AND user_id IS NULL AND session_id IS NULL)
  OR (mode IN ('link', 'connect_gmail', 'connect_mycalendar', 'connect_mysheets', 'connect_trello', 'connect_github', 'connect_telegram') AND user_id IS NOT NULL AND session_id IS NOT NULL));

-- 2. Return path support for connect_mycalendar initiated from conversation view.
ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_return_to_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_return_to_check CHECK (
  return_to IS NULL
  OR (mode IN ('connect_gmail', 'connect_mycalendar', 'connect_mysheets', 'connect_trello', 'connect_github', 'connect_telegram') AND return_to ~ '^/c/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));

-- 3. MyCalendar never has a shared (NULL owner) credential.
ALTER TABLE service_credentials DROP CONSTRAINT IF EXISTS service_credentials_mycalendar_owner_check;
ALTER TABLE service_credentials ADD CONSTRAINT service_credentials_mycalendar_owner_check CHECK (service <> 'mycalendar' OR user_id IS NOT NULL);
