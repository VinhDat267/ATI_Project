-- 0020_notion_oauth_and_digest.sql: Notion 1-click OAuth personal/workspace connections, database scope picker, and auto_digest schedules.
-- Every migration file runs again on each migrate, so each step is idempotent.

-- 1. OAuth state flow: connect_notion always belongs to one user and one live session.
ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_mode_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_mode_check CHECK (
  mode IN ('login', 'link', 'connect_gmail', 'connect_mycalendar', 'connect_mysheets', 'connect_trello', 'connect_github', 'connect_telegram', 'connect_notion')
);

ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_mode_owner_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_mode_owner_check CHECK (
  (mode = 'login' AND user_id IS NULL AND session_id IS NULL)
  OR (mode IN ('link', 'connect_gmail', 'connect_mycalendar', 'connect_mysheets', 'connect_trello', 'connect_github', 'connect_telegram', 'connect_notion') AND user_id IS NOT NULL AND session_id IS NOT NULL)
);

-- 2. Return path support for connect_notion initiated from conversation view.
ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_return_to_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_return_to_check CHECK (
  return_to IS NULL
  OR (mode IN ('connect_gmail', 'connect_mycalendar', 'connect_mysheets', 'connect_trello', 'connect_github', 'connect_telegram', 'connect_notion') AND return_to ~ '^/c/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);

-- 3. Notion personal OAuth connections (multi-workspace per user, max 10 selected databases per workspace).
CREATE TABLE IF NOT EXISTS notion_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id text NOT NULL,
  workspace_id text NOT NULL,
  workspace_name text NOT NULL,
  actor_id text NOT NULL,
  bot_id text NOT NULL DEFAULT '',
  identity_version integer NOT NULL DEFAULT 1 CHECK (identity_version > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reconnect_required', 'disconnected')),
  config text,
  allowed_databases text[] NOT NULL DEFAULT '{}',
  selected_databases jsonb NOT NULL DEFAULT '[]'::jsonb,
  scopes text[] NOT NULL DEFAULT '{}',
  is_default boolean NOT NULL DEFAULT false,
  refresh_in_flight boolean NOT NULL DEFAULT false,
  connected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, app_id, workspace_id)
);

ALTER TABLE notion_connections ADD COLUMN IF NOT EXISTS bot_id text NOT NULL DEFAULT '';
ALTER TABLE notion_connections ADD COLUMN IF NOT EXISTS selected_databases jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE notion_connections ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

ALTER TABLE notion_connections DROP CONSTRAINT IF EXISTS notion_connections_disconnected_config_check;
ALTER TABLE notion_connections ADD CONSTRAINT notion_connections_disconnected_config_check
  CHECK ((status = 'disconnected' AND config IS NULL) OR status <> 'disconnected');

ALTER TABLE notion_connections DROP CONSTRAINT IF EXISTS notion_connections_max_databases_check;
ALTER TABLE notion_connections ADD CONSTRAINT notion_connections_max_databases_check
  CHECK (
    cardinality(allowed_databases) <= 10
    AND jsonb_typeof(selected_databases) = 'array'
    AND jsonb_array_length(selected_databases) <= 10
  );

CREATE UNIQUE INDEX IF NOT EXISTS notion_identity_owner
  ON notion_connections(app_id, workspace_id, actor_id)
  WHERE status <> 'disconnected';

CREATE TABLE IF NOT EXISTS notion_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE,
  browser_hash text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  return_to text CHECK (
    return_to IS NULL
    OR return_to ~ '^/c/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

ALTER TABLE notion_oauth_states ADD COLUMN IF NOT EXISTS return_to text;
ALTER TABLE notion_oauth_states DROP CONSTRAINT IF EXISTS notion_oauth_states_return_to_check;
ALTER TABLE notion_oauth_states ADD CONSTRAINT notion_oauth_states_return_to_check CHECK (
  return_to IS NULL
  OR return_to ~ '^/c/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);

-- 4. Schedules: support kind = 'notion_digest' alongside existing digest kinds.
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'plan';
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS digest_config JSONB;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS digest_config_hash TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS digest_approved_at TIMESTAMPTZ;

ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_kind_check;
ALTER TABLE schedules ADD CONSTRAINT schedules_kind_check
  CHECK (kind IN ('plan', 'sheets_digest', 'calendar_digest', 'github_digest', 'telegram_digest', 'trello_digest', 'notion_digest'));

ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_kind_digest_check;
ALTER TABLE schedules ADD CONSTRAINT schedules_kind_digest_check CHECK (
  (kind = 'plan' AND digest_config IS NULL AND digest_config_hash IS NULL AND digest_approved_at IS NULL)
  OR (
    kind IN ('sheets_digest', 'calendar_digest', 'github_digest', 'telegram_digest', 'trello_digest', 'notion_digest')
    AND digest_config IS NOT NULL
    AND jsonb_typeof(digest_config) = 'object'
    AND digest_config_hash IS NOT NULL
    AND digest_config_hash ~ '^[0-9a-f]{64}$'
    AND digest_approved_at IS NOT NULL
  )
);

-- 5. Schedule runs: ensure digest_sent and digest_failed statuses and delivery metadata exist.
ALTER TABLE schedule_runs ADD COLUMN IF NOT EXISTS delivery JSONB;

ALTER TABLE schedule_runs DROP CONSTRAINT IF EXISTS schedule_runs_status_check;
ALTER TABLE schedule_runs ADD CONSTRAINT schedule_runs_status_check CHECK (
  status IN ('planning', 'planned', 'needs_attention', 'planning_failed', 'interrupted', 'discarded', 'missed', 'blocked', 'digest_sent', 'digest_failed')
);

ALTER TABLE schedule_runs DROP CONSTRAINT IF EXISTS schedule_runs_delivery_check;
ALTER TABLE schedule_runs ADD CONSTRAINT schedule_runs_delivery_check CHECK (
  (status = 'digest_sent' AND delivery IS NOT NULL AND jsonb_typeof(delivery) = 'object')
  OR (status <> 'digest_sent' AND delivery IS NULL)
);
