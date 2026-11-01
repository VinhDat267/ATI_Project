-- 0019_jira_workspaces.sql: JIRA-03 Workspaces policy extension, memberships, invites, accounts, grants, sites, projects, audit, and conversation immutability.
-- Every migration file runs again on each migrate, so each statement is idempotent.

-- 1. ati_workspaces (Policy extension referencing unified general workspaces)
CREATE TABLE IF NOT EXISTS ati_workspaces (
  id          UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  slug        TEXT UNIQUE NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version     INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  archived_at TIMESTAMPTZ
);

-- 2. ati_workspace_memberships
CREATE TABLE IF NOT EXISTS ati_workspace_memberships (
  workspace_id  UUID NOT NULL REFERENCES ati_workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'rejected', 'removed')),
  version       INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  decided_at    TIMESTAMPTZ,
  decided_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, user_id)
);

-- 3. ati_workspace_invites
CREATE TABLE IF NOT EXISTS ati_workspace_invites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES ati_workspaces(id) ON DELETE CASCADE,
  token_hash      TEXT UNIQUE NOT NULL,
  inviter_user_id UUID NOT NULL REFERENCES users(id),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 4. jira_accounts
CREATE TABLE IF NOT EXISTS jira_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  atlassian_account_id  TEXT NOT NULL,
  display_name          TEXT,
  status                TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected')),
  identity_version      INTEGER NOT NULL DEFAULT 1 CHECK (identity_version > 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT jira_accounts_user_atlassian_uq UNIQUE (user_id, atlassian_account_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS jira_accounts_user_active_idx
  ON jira_accounts (user_id)
  WHERE status = 'connected';

CREATE UNIQUE INDEX IF NOT EXISTS jira_accounts_atlassian_active_idx
  ON jira_accounts (atlassian_account_id)
  WHERE status = 'connected';

-- 5. jira_oauth_grants
CREATE TABLE IF NOT EXISTS jira_oauth_grants (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              UUID NOT NULL REFERENCES jira_accounts(id) ON DELETE CASCADE,
  app_client_id           TEXT NOT NULL DEFAULT 'default',
  grant_kind              TEXT NOT NULL DEFAULT '3lo',
  encrypted_access_token  TEXT,
  encrypted_refresh_token TEXT,
  scopes                  TEXT[] NOT NULL DEFAULT '{}',
  token_version           INTEGER NOT NULL DEFAULT 1 CHECK (token_version > 0),
  expires_at              TIMESTAMPTZ,
  refresh_state           TEXT NOT NULL DEFAULT 'idle',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 6. jira_grant_sites
CREATE TABLE IF NOT EXISTS jira_grant_sites (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id          UUID NOT NULL REFERENCES jira_oauth_grants(id) ON DELETE CASCADE,
  cloud_id          TEXT NOT NULL,
  site_url          TEXT NOT NULL,
  site_name         TEXT NOT NULL,
  product_type      TEXT NOT NULL DEFAULT 'jira',
  last_verified_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT jira_grant_sites_grant_cloud_uq UNIQUE (grant_id, cloud_id)
);

-- 7. ati_workspace_jira_sites
CREATE TABLE IF NOT EXISTS ati_workspace_jira_sites (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES ati_workspaces(id) ON DELETE CASCADE,
  cloud_id            TEXT NOT NULL,
  site_name           TEXT NOT NULL,
  site_url            TEXT NOT NULL,
  active              BOOLEAN NOT NULL DEFAULT false,
  policy_version      INTEGER NOT NULL DEFAULT 1 CHECK (policy_version > 0),
  linked_by           UUID NOT NULL REFERENCES users(id),
  verified_admin_by   UUID REFERENCES users(id),
  admin_verified_at   TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ati_workspace_jira_sites_ws_cloud_uq UNIQUE (workspace_id, cloud_id),
  CONSTRAINT ati_workspace_jira_sites_ws_id_cloud_uq UNIQUE (workspace_id, id, cloud_id)
);

-- 8. ati_workspace_jira_projects
CREATE TABLE IF NOT EXISTS ati_workspace_jira_projects (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES ati_workspaces(id) ON DELETE CASCADE,
  site_id             UUID NOT NULL REFERENCES ati_workspace_jira_sites(id) ON DELETE CASCADE,
  cloud_id            TEXT NOT NULL,
  numeric_project_id  TEXT NOT NULL CHECK (numeric_project_id ~ '^[1-9][0-9]*$'),
  project_key         TEXT NOT NULL,
  project_name        TEXT NOT NULL,
  selected            BOOLEAN NOT NULL DEFAULT false,
  policy_version      INTEGER NOT NULL DEFAULT 1 CHECK (policy_version > 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_workspace_site_cloud FOREIGN KEY (workspace_id, site_id, cloud_id)
    REFERENCES ati_workspace_jira_sites (workspace_id, id, cloud_id) ON DELETE CASCADE,
  CONSTRAINT ati_workspace_jira_projects_ws_cloud_proj_uq UNIQUE (workspace_id, cloud_id, numeric_project_id)
);

-- 9. jira_authorization_audit
CREATE TABLE IF NOT EXISTS jira_authorization_audit (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      UUID NOT NULL REFERENCES users(id),
  workspace_id  UUID NOT NULL REFERENCES ati_workspaces(id) ON DELETE CASCADE,
  site_id       UUID REFERENCES ati_workspace_jira_sites(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  decision      TEXT NOT NULL,
  version       INTEGER NOT NULL,
  details       JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 10. conversations jira_context and immutability trigger
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS jira_context BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_jira_context_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_jira_context_check CHECK (
  jira_context = false OR (jira_context = true AND workspace_mode = 'organization' AND workspace_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_conversations_jira_context ON conversations (workspace_id, jira_context) WHERE jira_context = true;

CREATE OR REPLACE FUNCTION trg_conversations_workspace_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.workspace_id IS NOT NULL AND NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
      RAISE EXCEPTION 'conversations.workspace_id is immutable once assigned'
        USING ERRCODE = 'check_violation';
    END IF;

    IF OLD.workspace_mode IS NOT NULL AND NEW.workspace_mode IS DISTINCT FROM OLD.workspace_mode THEN
      RAISE EXCEPTION 'conversations.workspace_mode is immutable once assigned'
        USING ERRCODE = 'check_violation';
    END IF;

    IF OLD.jira_context IS NOT NULL AND NEW.jira_context IS DISTINCT FROM OLD.jira_context THEN
      RAISE EXCEPTION 'conversations.jira_context is immutable once assigned'
        USING ERRCODE = 'check_violation';
    END IF;

    IF OLD.workspace_id IS NULL AND NEW.workspace_id IS NOT NULL THEN
      RAISE EXCEPTION 'conversations.workspace_id cannot be assigned to legacy conversations'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_conversations_workspace_immutable ON conversations;
CREATE TRIGGER trg_conversations_workspace_immutable
BEFORE UPDATE ON conversations
FOR EACH ROW
EXECUTE FUNCTION trg_conversations_workspace_immutable();
