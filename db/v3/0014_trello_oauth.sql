-- 0014_trello_oauth.sql: Trello OAuth personal connections and team board scope.
-- Every migration file runs again on each migrate, so each step is idempotent.

-- 1. A sixth OAuth flow: connect_trello always belongs to one user and one live session.
ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_mode_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_mode_check CHECK (
  mode IN ('login', 'link', 'connect_gmail', 'connect_mycalendar', 'connect_mysheets', 'connect_trello', 'connect_github', 'connect_telegram')
);

ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_mode_owner_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_mode_owner_check CHECK (
  (mode = 'login' AND user_id IS NULL AND session_id IS NULL)
  OR (mode IN ('link', 'connect_gmail', 'connect_mycalendar', 'connect_mysheets', 'connect_trello', 'connect_github', 'connect_telegram') AND user_id IS NOT NULL AND session_id IS NOT NULL));

-- 2. Return path support for connect_trello initiated from conversation view.
ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_return_to_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_return_to_check CHECK (
  return_to IS NULL
  OR (mode IN ('connect_gmail', 'connect_mycalendar', 'connect_mysheets', 'connect_trello', 'connect_github', 'connect_telegram') AND return_to ~ '^/c/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));

-- 3. Xoá credential Trello dùng chung (user_id IS NULL)
DELETE FROM service_credentials WHERE service = 'trello' AND user_id IS NULL;

-- 4. Trello personal connection constraint: never a shared credential
ALTER TABLE service_credentials DROP CONSTRAINT IF EXISTS service_credentials_trello_owner_check;
ALTER TABLE service_credentials ADD CONSTRAINT service_credentials_trello_owner_check CHECK (service <> 'trello' OR user_id IS NOT NULL);

-- 5. Team board scope: exactly one scope row for the team
CREATE TABLE IF NOT EXISTS trello_team_scope (
  id TEXT PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  workspace_id TEXT NOT NULL,
  workspace_name TEXT NOT NULL,
  chosen_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trello_team_scope_workspace_uq UNIQUE (id, workspace_id)
);

-- 6. Team boards: at most 10 boards belonging to the same workspace
CREATE TABLE IF NOT EXISTS trello_team_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id TEXT NOT NULL DEFAULT 'default' CHECK (scope_id = 'default'),
  workspace_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  board_name TEXT NOT NULL,
  position INTEGER CHECK (position IS NULL OR (position BETWEEN 1 AND 10)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_trello_team_boards_scope
    FOREIGN KEY (scope_id, workspace_id)
    REFERENCES trello_team_scope (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT trello_team_boards_scope_board_unique UNIQUE (scope_id, board_id)
);

CREATE OR REPLACE FUNCTION check_trello_team_boards_constraints()
RETURNS TRIGGER AS $$
DECLARE
  scope_ws TEXT;
  board_count INT;
BEGIN
  SELECT workspace_id INTO scope_ws FROM trello_team_scope WHERE id = NEW.scope_id;
  IF scope_ws IS NULL THEN
    RAISE EXCEPTION 'trello_team_scope % does not exist', NEW.scope_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.workspace_id <> scope_ws THEN
    RAISE EXCEPTION 'board workspace_id % does not match scope workspace_id %', NEW.workspace_id, scope_ws
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO board_count FROM trello_team_boards WHERE scope_id = NEW.scope_id;
  IF board_count > 10 THEN
    RAISE EXCEPTION 'trello_team_boards cannot have more than 10 boards for scope %', NEW.scope_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_trello_team_boards_constraints ON trello_team_boards;
CREATE CONSTRAINT TRIGGER trg_check_trello_team_boards_constraints
AFTER INSERT OR UPDATE ON trello_team_boards
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION check_trello_team_boards_constraints();
