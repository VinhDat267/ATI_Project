-- 0015_workspaces.sql: Multi-organization workspaces and isolated workspace context.
-- Every migration file runs again on each migrate, so each step is idempotent.

CREATE TABLE IF NOT EXISTS workspaces (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  invite_code      TEXT UNIQUE NOT NULL,
  require_approval BOOLEAN NOT NULL DEFAULT true,
  created_by       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON workspace_members(user_id);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS workspace_mode TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_workspace_mode_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_workspace_mode_check CHECK (
  workspace_mode IN ('legacy', 'personal', 'organization')
  AND ((workspace_mode = 'organization' AND workspace_id IS NOT NULL) OR (workspace_mode IN ('legacy', 'personal') AND workspace_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_conversations_workspace_id ON conversations(workspace_id);

ALTER TABLE schedules ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS workspace_mode TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_workspace_mode_check;
ALTER TABLE schedules ADD CONSTRAINT schedules_workspace_mode_check CHECK (
  workspace_mode IN ('legacy', 'personal', 'organization')
  AND ((workspace_mode = 'organization' AND workspace_id IS NOT NULL) OR (workspace_mode IN ('legacy', 'personal') AND workspace_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_schedules_workspace_id ON schedules(workspace_id);

ALTER TABLE service_credentials ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_service_credentials_workspace_id ON service_credentials(workspace_id);

DROP INDEX IF EXISTS ux_service_credentials_service_owner;
CREATE UNIQUE INDEX IF NOT EXISTS ux_service_credentials_service_owner
  ON service_credentials (service, user_id, workspace_id) NULLS NOT DISTINCT;

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT con.conname FROM pg_constraint con
    WHERE con.conrelid = 'trello_team_scope'::regclass AND con.contype = 'c' AND pg_get_constraintdef(con.oid) LIKE '%default%'
  LOOP
    EXECUTE format('ALTER TABLE trello_team_scope DROP CONSTRAINT %I', c.conname);
  END LOOP;
  FOR c IN SELECT con.conname FROM pg_constraint con
    WHERE con.conrelid = 'trello_team_boards'::regclass AND con.contype = 'c' AND pg_get_constraintdef(con.oid) LIKE '%default%'
  LOOP
    EXECUTE format('ALTER TABLE trello_team_boards DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE trello_team_scope DROP CONSTRAINT IF EXISTS trello_team_scope_id_check;
ALTER TABLE trello_team_scope ADD CONSTRAINT trello_team_scope_id_check CHECK (
  id = 'default'
  OR id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR id ~* '^personal:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);

ALTER TABLE trello_team_boards DROP CONSTRAINT IF EXISTS trello_team_boards_scope_id_check;
ALTER TABLE trello_team_boards ADD CONSTRAINT trello_team_boards_scope_id_check CHECK (
  scope_id = 'default'
  OR scope_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR scope_id ~* '^personal:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);
