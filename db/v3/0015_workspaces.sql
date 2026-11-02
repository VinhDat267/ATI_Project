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

DO $$
DECLARE
  v_admin_id UUID;
  v_ws_id    UUID;
  v_invite   TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM workspaces) THEN
    SELECT id INTO v_admin_id
      FROM users
      WHERE status = 'active' AND role = 'admin'
      ORDER BY created_at ASC, id ASC
      LIMIT 1;

    IF v_admin_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM service_credentials WHERE user_id IS NULL AND workspace_id IS NULL)
      OR EXISTS (SELECT 1 FROM trello_team_scope WHERE id = 'default')
    ) THEN
      v_invite := 'ATI-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4))
                        || '-' || upper(substr(md5(clock_timestamp()::text || random()::text), 1, 4));
      INSERT INTO workspaces (name, invite_code, require_approval, created_by)
        VALUES ('Không gian Chung', v_invite, true, v_admin_id)
        RETURNING id INTO v_ws_id;

      INSERT INTO workspace_members (workspace_id, user_id, role, status)
        SELECT v_ws_id, u.id, CASE WHEN u.role = 'admin' THEN 'admin' ELSE 'member' END, 'active'
        FROM users u
        WHERE u.status = 'active'
        ON CONFLICT (workspace_id, user_id) DO NOTHING;

      UPDATE service_credentials
        SET workspace_id = v_ws_id
        WHERE user_id IS NULL AND workspace_id IS NULL;

      INSERT INTO trello_team_scope (id, workspace_id, workspace_name, chosen_by, updated_at)
        SELECT v_ws_id::text, s.workspace_id, s.workspace_name, s.chosen_by, s.updated_at
        FROM trello_team_scope s
        WHERE s.id = 'default'
        ON CONFLICT (id) DO NOTHING;

      INSERT INTO trello_team_boards (scope_id, workspace_id, board_id, board_name, position, created_at)
        SELECT v_ws_id::text, b.workspace_id, b.board_id, b.board_name, b.position, b.created_at
        FROM trello_team_boards b
        WHERE b.scope_id = 'default'
        ON CONFLICT DO NOTHING;

      UPDATE conversations
        SET workspace_mode = 'organization', workspace_id = v_ws_id
        WHERE workspace_mode = 'legacy' AND workspace_id IS NULL
          AND user_id IN (SELECT user_id FROM workspace_members WHERE workspace_id = v_ws_id);

      UPDATE schedules
        SET workspace_mode = 'organization', workspace_id = v_ws_id
        WHERE workspace_mode = 'legacy' AND workspace_id IS NULL
          AND user_id IN (SELECT user_id FROM workspace_members WHERE workspace_id = v_ws_id);
    END IF;
  END IF;
END $$;
