-- Body-free recovery metadata; status names remain compatible with receipt cleanup.
ALTER TABLE slack_lifecycle_intents
  ADD COLUMN IF NOT EXISTS validation_lease_token UUID,
  ADD COLUMN IF NOT EXISTS validation_lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS validation_lease_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validation_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS validation_next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  ADD COLUMN IF NOT EXISTS validation_last_error_code TEXT,
  ADD COLUMN IF NOT EXISTS validation_outcome TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='slack_lifecycle_intents'::regclass AND conname='chk_slack_validation_lease') THEN
    ALTER TABLE slack_lifecycle_intents ADD CONSTRAINT chk_slack_validation_lease CHECK (
      (validation_lease_token IS NULL AND validation_lease_owner IS NULL AND validation_lease_until IS NULL) OR
      (validation_lease_token IS NOT NULL AND validation_lease_owner IS NOT NULL AND length(trim(validation_lease_owner))>0 AND validation_lease_until IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='slack_lifecycle_intents'::regclass AND conname='chk_slack_validation_result') THEN
    ALTER TABLE slack_lifecycle_intents ADD CONSTRAINT chk_slack_validation_result CHECK (
      validation_attempts>=0 AND
      (validation_last_error_code IS NULL OR validation_last_error_code IN ('owner_busy','probe_transient','credential_uncertain','aborted','invalid_job')) AND
      (validation_outcome IS NULL OR validation_outcome IN ('valid','invalid','superseded')));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_slack_validation_due ON slack_lifecycle_intents(validation_next_attempt_at,validation_lease_until)
  WHERE status IN ('pending','failed') AND intent_type IN ('token_revocation_validation','app_uninstall_validation');
