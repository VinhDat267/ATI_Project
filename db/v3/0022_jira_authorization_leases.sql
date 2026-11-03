-- 0022_jira_authorization_leases.sql: Durable tracking for Jira authorization leases.
-- Every migration runs repeatedly on runner start, each statement must be idempotent.

CREATE TABLE IF NOT EXISTS jira_authorization_leases (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id                TEXT UNIQUE NOT NULL,
  workspace_id            UUID NOT NULL REFERENCES ati_workspaces(id) ON DELETE CASCADE,
  cloud_id                TEXT NOT NULL,
  ati_user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jira_account_id         UUID NOT NULL REFERENCES jira_accounts(id) ON DELETE CASCADE,
  atlassian_account_id    TEXT NOT NULL,
  grant_id                UUID NOT NULL REFERENCES jira_oauth_grants(id) ON DELETE CASCADE,
  membership_version      INTEGER NOT NULL CHECK (membership_version > 0),
  identity_version        INTEGER NOT NULL CHECK (identity_version > 0),
  workspace_version       INTEGER NOT NULL CHECK (workspace_version > 0),
  site_policy_version     INTEGER NOT NULL CHECK (site_policy_version > 0),
  project_id              TEXT CHECK (project_id IS NULL OR project_id ~ '^[1-9][0-9]*$'),
  project_policy_version  INTEGER CHECK (project_policy_version IS NULL OR project_policy_version > 0),
  ttl_ms                  INTEGER NOT NULL CHECK (ttl_ms > 0 AND ttl_ms <= 60000),
  acquired_at             TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at              TIMESTAMPTZ NOT NULL,
  released_at             TIMESTAMPTZ,
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'expired', 'revoked')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_jira_leases_expiry CHECK (expires_at > acquired_at)
);

-- Compound partial index for active lease lookups that filters out expired rows efficiently
CREATE INDEX IF NOT EXISTS idx_jira_leases_active
  ON jira_authorization_leases (workspace_id, cloud_id, expires_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_jira_leases_user
  ON jira_authorization_leases (ati_user_id, status);
