-- 0021_jira_oauth_token.sql: Jira 3LO OAuth state modes, grant refresh tracking and status, per-site scopes.
-- Every migration file runs again on each migrate, so each statement is idempotent.

-- 1. OAuth-style state flow: connect_jira_identity and connect_jira_sites always belong to one user and one live session.
ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_mode_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_mode_check CHECK (
  mode IN (
    'login', 'link',
    'connect_gmail', 'connect_mycalendar', 'connect_mysheets',
    'connect_trello', 'connect_github', 'connect_telegram',
    'connect_jira_identity', 'connect_jira_sites'
  )
);

ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_mode_owner_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_mode_owner_check CHECK (
  (mode = 'login' AND user_id IS NULL AND session_id IS NULL)
  OR (
    mode IN (
      'link', 'connect_gmail', 'connect_mycalendar', 'connect_mysheets',
      'connect_trello', 'connect_github', 'connect_telegram',
      'connect_jira_identity', 'connect_jira_sites'
    ) AND user_id IS NOT NULL AND session_id IS NOT NULL
  )
);

-- 2. Return path support for Jira connections initiated from conversation view.
ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_return_to_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_return_to_check CHECK (
  return_to IS NULL
  OR (
    mode IN (
      'connect_gmail', 'connect_mycalendar', 'connect_mysheets',
      'connect_trello', 'connect_github', 'connect_telegram',
      'connect_jira_identity', 'connect_jira_sites'
    ) AND return_to ~ '^/c/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
);

-- 3. Jira OAuth Grants status, refresh tracking columns and check constraints.
ALTER TABLE jira_oauth_grants ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE jira_oauth_grants DROP CONSTRAINT IF EXISTS jira_oauth_grants_status_check;
ALTER TABLE jira_oauth_grants ADD CONSTRAINT jira_oauth_grants_status_check
  CHECK (status IN ('active', 'reconnect_required', 'revoked'));

ALTER TABLE jira_oauth_grants ADD COLUMN IF NOT EXISTS status_reason TEXT;
ALTER TABLE jira_oauth_grants ADD COLUMN IF NOT EXISTS refresh_attempt_id UUID;
ALTER TABLE jira_oauth_grants ADD COLUMN IF NOT EXISTS refresh_started_at TIMESTAMPTZ;

ALTER TABLE jira_oauth_grants DROP CONSTRAINT IF EXISTS jira_oauth_grants_refresh_state_check;
ALTER TABLE jira_oauth_grants ADD CONSTRAINT jira_oauth_grants_refresh_state_check
  CHECK (refresh_state IN ('idle', 'refreshing', 'failed'));

CREATE INDEX IF NOT EXISTS idx_jira_oauth_grants_account ON jira_oauth_grants (account_id);

-- 4. Jira Grant Sites per-site scopes and product_type check.
ALTER TABLE jira_grant_sites ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE jira_grant_sites DROP CONSTRAINT IF EXISTS jira_grant_sites_product_type_check;
ALTER TABLE jira_grant_sites ADD CONSTRAINT jira_grant_sites_product_type_check
  CHECK (product_type = 'jira');
