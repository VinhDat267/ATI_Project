-- Allow per-organization workspace scoping in telegram_team_scope & telegram_team_chats.
-- Keeps 'default' (legacy), '<uuid>' (organization workspaceId), and 'personal:<uuid>' (personal override).

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'telegram_team_scope'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%default%'
  LOOP
    EXECUTE format('ALTER TABLE telegram_team_scope DROP CONSTRAINT %I', r.conname);
  END LOOP;

  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'telegram_team_chats'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%default%'
  LOOP
    EXECUTE format('ALTER TABLE telegram_team_chats DROP CONSTRAINT %I', r.conname);
  END LOOP;
END
$$;

ALTER TABLE telegram_team_scope DROP CONSTRAINT IF EXISTS telegram_team_scope_id_check;
ALTER TABLE telegram_team_scope
  ADD CONSTRAINT telegram_team_scope_id_check CHECK (
    id = 'default'
    OR id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR id ~* '^personal:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

ALTER TABLE telegram_team_chats DROP CONSTRAINT IF EXISTS telegram_team_chats_scope_id_check;
ALTER TABLE telegram_team_chats
  ADD CONSTRAINT telegram_team_chats_scope_id_check CHECK (
    scope_id = 'default'
    OR scope_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR scope_id ~* '^personal:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );
