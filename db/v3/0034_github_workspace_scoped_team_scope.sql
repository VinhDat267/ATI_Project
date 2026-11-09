-- 0034_github_workspace_scoped_team_scope.sql
-- Quarantines legacy global 'default' GitHub team scope rows into immutable archive tables
-- and enforces per-workspace scope_id != 'default' while preserving all production FK and CHECK constraints.

BEGIN;

CREATE TABLE IF NOT EXISTS github_team_scope_legacy_archive (
  snapshot_id BIGSERIAL PRIMARY KEY,
  legacy_id TEXT NOT NULL,
  chosen_by UUID,
  updated_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS github_team_repos_legacy_archive (
  archive_row_id BIGSERIAL PRIMARY KEY,
  snapshot_id BIGINT NOT NULL REFERENCES github_team_scope_legacy_archive(snapshot_id) ON DELETE RESTRICT,
  id UUID NOT NULL,
  legacy_scope_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER,
  created_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
DECLARE
  v_snapshot_id BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM github_team_scope WHERE id = 'default') THEN
    INSERT INTO github_team_scope_legacy_archive (legacy_id, chosen_by, updated_at)
    SELECT id, chosen_by, updated_at
      FROM github_team_scope
     WHERE id = 'default'
    RETURNING snapshot_id INTO v_snapshot_id;

    INSERT INTO github_team_repos_legacy_archive (
      snapshot_id, id, legacy_scope_id, repo_id, full_name, name, position, created_at
    )
    SELECT
      v_snapshot_id, id, scope_id, repo_id, full_name, name, position, created_at
      FROM github_team_repos
     WHERE scope_id = 'default';

    DELETE FROM github_team_repos WHERE scope_id = 'default';
    DELETE FROM github_team_scope WHERE id = 'default';
  END IF;
END $$;

ALTER TABLE github_team_repos DROP CONSTRAINT IF EXISTS github_team_repos_scope_id_fkey;
ALTER TABLE github_team_repos DROP CONSTRAINT IF EXISTS github_team_repos_scope_id_check;
ALTER TABLE github_team_scope DROP CONSTRAINT IF EXISTS github_team_scope_id_check;

ALTER TABLE github_team_scope ALTER COLUMN id DROP DEFAULT;
ALTER TABLE github_team_repos ALTER COLUMN scope_id DROP DEFAULT;

ALTER TABLE github_team_scope
  ADD CONSTRAINT github_team_scope_id_check
  CHECK (id <> 'default' AND btrim(id) <> '');

ALTER TABLE github_team_repos
  ADD CONSTRAINT github_team_repos_scope_id_check
  CHECK (scope_id <> 'default' AND btrim(scope_id) <> '');

ALTER TABLE github_team_repos
  ADD CONSTRAINT github_team_repos_scope_id_fkey
  FOREIGN KEY (scope_id) REFERENCES github_team_scope(id) ON DELETE CASCADE;

COMMIT;
