-- GMAIL-01: Gmail as each member's own connection.
-- Every migration file runs again on each migrate, so each step is idempotent.

-- 1. A third OAuth flow. login has no owner; link and connect_gmail always belong
--    to one user and one live session. Drop the 0007 checks on mode by
--    definition (they were unnamed) and add named replacements.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT con.conname FROM pg_constraint con
    WHERE con.conrelid = 'oauth_states'::regclass AND con.contype = 'c' AND pg_get_constraintdef(con.oid) LIKE '%mode%'
  LOOP
    EXECUTE format('ALTER TABLE oauth_states DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_mode_check CHECK (mode IN ('login', 'link', 'connect_gmail'));
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_mode_owner_check CHECK (
  (mode = 'login' AND user_id IS NULL AND session_id IS NULL)
  OR (mode IN ('link', 'connect_gmail') AND user_id IS NOT NULL AND session_id IS NOT NULL));

-- 2. Connection health outside the encrypted config: these are not secrets.
ALTER TABLE service_credentials ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CONSTRAINT service_credentials_status_check CHECK (status IN ('active', 'reconnect_required'));
ALTER TABLE service_credentials ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

-- 3. Gmail never has a shared (NULL owner) credential.
ALTER TABLE service_credentials DROP CONSTRAINT IF EXISTS service_credentials_gmail_owner_check;
ALTER TABLE service_credentials ADD CONSTRAINT service_credentials_gmail_owner_check CHECK (service <> 'gmail' OR user_id IS NOT NULL);
