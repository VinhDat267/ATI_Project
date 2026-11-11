-- 0036_notion_oauth_durability.sql
-- Bounded Notion N2-B OAuth durability migration (partial D08 approval ONLY).
-- Scope restriction: adds nullable notion_connections.auth_failure_code with
-- allowlisted diagnostic/recovery codes ONLY. Unapproved D08 schedule snapshot
-- fields (schedules.digest_authorization) and archive/org routing changes are
-- intentionally excluded from this migration.

ALTER TABLE notion_connections
  ADD COLUMN IF NOT EXISTS auth_failure_code text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'notion_connections_auth_failure_code_check'
       AND conrelid = 'notion_connections'::regclass
  ) THEN
    ALTER TABLE notion_connections
      ADD CONSTRAINT notion_connections_auth_failure_code_check
      CHECK (
        auth_failure_code IS NULL
        OR auth_failure_code IN (
          'access_rejected',
          'refresh_retryable',
          'rotation_unknown',
          'grant_rejected',
          'client_misconfigured',
          'identity_mismatch'
        )
      );
  END IF;
END $$;
