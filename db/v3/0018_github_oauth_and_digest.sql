-- 0018_github_oauth_and_digest.sql: Personal GitHub OAuth connections, team repository scope, and auto_digest schedule mode.
-- Every migration file runs again on each migrate, so each step is idempotent.

-- 1. OAuth flow mode: connect_github always belongs to one user and one live session.
ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_mode_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_mode_check CHECK (
  mode IN ('login', 'link', 'connect_gmail', 'connect_mycalendar', 'connect_mysheets', 'connect_trello', 'connect_github')
);

ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_mode_owner_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_mode_owner_check CHECK (
  (mode = 'login' AND user_id IS NULL AND session_id IS NULL)
  OR (mode IN ('link', 'connect_gmail', 'connect_mycalendar', 'connect_mysheets', 'connect_trello', 'connect_github')
      AND user_id IS NOT NULL AND session_id IS NOT NULL)
);

-- 2. Return path support for connect_github initiated from conversation view.
ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_return_to_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_return_to_check CHECK (
  return_to IS NULL
  OR (mode IN ('connect_gmail', 'connect_mycalendar', 'connect_mysheets', 'connect_trello', 'connect_github')
      AND return_to ~ '^/c/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);

-- 3. Remove legacy shared GitHub PAT credentials (user_id IS NULL) and enforce personal owner.
DELETE FROM service_credentials WHERE service = 'github' AND user_id IS NULL;

ALTER TABLE service_credentials DROP CONSTRAINT IF EXISTS service_credentials_github_owner_check;
ALTER TABLE service_credentials ADD CONSTRAINT service_credentials_github_owner_check
  CHECK (service <> 'github' OR user_id IS NOT NULL);

-- 4. Team repository scope (1..10 repositories selected by admin).
CREATE TABLE IF NOT EXISTS github_team_scope (
  id TEXT PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  chosen_by UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS github_team_repos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id TEXT NOT NULL DEFAULT 'default' CHECK (scope_id = 'default')
    REFERENCES github_team_scope(id) ON DELETE CASCADE,
  repo_id TEXT NOT NULL,
  full_name TEXT NOT NULL CHECK (full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  name TEXT NOT NULL,
  position INTEGER CHECK (position IS NULL OR (position BETWEEN 1 AND 10)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT github_team_repos_scope_repo_unique UNIQUE (scope_id, full_name)
);

CREATE OR REPLACE FUNCTION check_github_team_repos_constraints()
RETURNS TRIGGER AS $$
DECLARE
  repo_count INT;
BEGIN
  SELECT count(*) INTO repo_count FROM github_team_repos WHERE scope_id = NEW.scope_id;
  IF repo_count > 10 THEN
    RAISE EXCEPTION 'github_team_repos cannot have more than 10 repositories for scope %', NEW.scope_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_github_team_repos_constraints ON github_team_repos;
CREATE CONSTRAINT TRIGGER trg_check_github_team_repos_constraints
AFTER INSERT OR UPDATE ON github_team_repos
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW
EXECUTE FUNCTION check_github_team_repos_constraints();

-- 5. Schedules: execution mode choice ('plan' vs 'sheets_digest' | 'calendar_digest' | 'github_digest' | 'telegram_digest').
ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'plan',
  ADD COLUMN IF NOT EXISTS digest_config JSONB,
  ADD COLUMN IF NOT EXISTS digest_config_hash TEXT,
  ADD COLUMN IF NOT EXISTS digest_approved_at TIMESTAMPTZ;

ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_kind_check;
ALTER TABLE schedules ADD CONSTRAINT schedules_kind_check
  CHECK (kind IN ('plan', 'sheets_digest', 'calendar_digest', 'github_digest', 'telegram_digest'));

ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_kind_digest_check;
ALTER TABLE schedules ADD CONSTRAINT schedules_kind_digest_check CHECK (
  (kind = 'plan' AND digest_config IS NULL AND digest_config_hash IS NULL AND digest_approved_at IS NULL)
  OR (
    kind IN ('sheets_digest', 'calendar_digest', 'github_digest', 'telegram_digest')
    AND digest_config IS NOT NULL
    AND jsonb_typeof(digest_config) = 'object'
    AND digest_config_hash IS NOT NULL
    AND digest_config_hash ~ '^[0-9a-f]{64}$'
    AND digest_approved_at IS NOT NULL
  )
);

-- 6. Schedule runs: support digest_sent and digest_failed statuses with delivery receipt.
ALTER TABLE schedule_runs DROP CONSTRAINT IF EXISTS schedule_runs_status_check;
ALTER TABLE schedule_runs ADD CONSTRAINT schedule_runs_status_check CHECK (
  status IN (
    'planning', 'planned', 'needs_attention', 'planning_failed',
    'interrupted', 'discarded', 'missed', 'blocked',
    'digest_sent', 'digest_failed'
  )
);

ALTER TABLE schedule_runs
  ADD COLUMN IF NOT EXISTS delivery JSONB;

ALTER TABLE schedule_runs DROP CONSTRAINT IF EXISTS schedule_runs_delivery_check;
ALTER TABLE schedule_runs ADD CONSTRAINT schedule_runs_delivery_check CHECK (
  (status = 'digest_sent' AND delivery IS NOT NULL AND jsonb_typeof(delivery) = 'object')
  OR (status <> 'digest_sent' AND delivery IS NULL)
);
