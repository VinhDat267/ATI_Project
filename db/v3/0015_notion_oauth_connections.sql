-- Notion personal identities are separate from the shared bot connector.
CREATE TABLE IF NOT EXISTS notion_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id text NOT NULL,
  workspace_id text NOT NULL,
  workspace_name text NOT NULL,
  actor_id text NOT NULL,
  identity_version integer NOT NULL DEFAULT 1 CHECK (identity_version > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','reconnect_required','disconnected')),
  config text,
  allowed_databases text[] NOT NULL DEFAULT '{}',
  scopes text[] NOT NULL DEFAULT '{}',
  refresh_in_flight boolean NOT NULL DEFAULT false,
  connected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,app_id,workspace_id),
  CHECK ((status = 'disconnected' AND config IS NULL) OR status <> 'disconnected')
);
CREATE UNIQUE INDEX IF NOT EXISTS notion_identity_owner ON notion_connections(app_id,workspace_id,actor_id) WHERE status <> 'disconnected';
CREATE TABLE IF NOT EXISTS notion_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE,
  browser_hash text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
