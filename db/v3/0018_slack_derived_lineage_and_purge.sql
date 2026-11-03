CREATE SEQUENCE IF NOT EXISTS slack_derived_target_version_seq AS BIGINT START 1;

CREATE TABLE IF NOT EXISTS slack_derived_copies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ati_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN (
    'chat_history_message','working_memory_entity','plan_step_arg',
    'proposal_excerpt','daily_digest_entry','scheduled_workflow_arg','audit_log_entry')),
  target_id TEXT NOT NULL CHECK (target_id <> ''),
  target_sub_id TEXT NOT NULL CHECK (target_sub_id <> ''),
  target_version BIGINT NOT NULL DEFAULT nextval('slack_derived_target_version_seq'),
  target_fingerprint TEXT NOT NULL CHECK (target_fingerprint ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired','purged')),
  retired_at TIMESTAMPTZ, retired_reason TEXT CHECK (retired_reason IS NULL OR retired_reason IN (
    'superseded','fingerprint_mismatch','manual')),
  purged_at TIMESTAMPTZ,
  purge_reason TEXT CHECK (purge_reason IS NULL OR purge_reason IN (
    'source_deleted','source_edited','channel_membership_lost','connection_disconnected',
    'app_reinstalled','consent_revoked','retention_expired','policy_changed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT uq_slack_derived_copy_version
    UNIQUE (ati_user_id, target_kind, target_id, target_sub_id, target_version),
  CONSTRAINT chk_slack_derived_copy_terminal CHECK (
    (status='active' AND retired_at IS NULL AND retired_reason IS NULL AND purged_at IS NULL AND purge_reason IS NULL) OR
    (status='retired' AND retired_at IS NOT NULL AND retired_reason IS NOT NULL AND purged_at IS NULL AND purge_reason IS NULL) OR
    (status='purged' AND purged_at IS NOT NULL AND purge_reason IS NOT NULL AND retired_at IS NULL AND retired_reason IS NULL)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_slack_derived_copy_active
  ON slack_derived_copies(ati_user_id, target_kind, target_id, target_sub_id)
  WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_slack_derived_copy_lookup
  ON slack_derived_copies(target_kind, target_id, target_sub_id, status);

CREATE TABLE IF NOT EXISTS slack_derived_provenance_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  derived_copy_id UUID NOT NULL REFERENCES slack_derived_copies(id) ON DELETE CASCADE,
  segment_index INT NOT NULL CHECK (segment_index >= 0),
  capture_hash TEXT NOT NULL CHECK (capture_hash ~ '^[0-9a-f]{64}$'),
  raw_source_id UUID, owner_source_key TEXT NOT NULL,
  resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, revision TEXT NOT NULL,
  channel_id TEXT,
  ati_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL, -- no FK: survives connection deletion for cascade purge
  workspace_id TEXT NOT NULL,
  slack_user_id TEXT NOT NULL, identity_version INT NOT NULL CHECK (identity_version > 0),
  provider_profile_id TEXT NOT NULL, config_fingerprint TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  consent_revision TEXT NOT NULL CHECK (consent_revision ~ '^[1-9][0-9]*$'),
  provider_revision TEXT NOT NULL CHECK (provider_revision ~ '^[1-9][0-9]*$'),
  acquisition_purpose TEXT NOT NULL CHECK (acquisition_purpose IN ('manual_lookup','triage','planning','digest')),
  acquisition_requested_retention_days INT NOT NULL CHECK (acquisition_requested_retention_days >= 0),
  policy_purpose TEXT NOT NULL DEFAULT 'storage' CHECK (policy_purpose='storage'),
  storage_requested_retention_days INT NOT NULL
    CHECK (storage_requested_retention_days > 0 AND storage_requested_retention_days <= 30),
  effective_retention_days INT NOT NULL
    CHECK (effective_retention_days > 0 AND effective_retention_days <= storage_requested_retention_days),
  captured_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT uq_slack_derived_segment UNIQUE (derived_copy_id, segment_index),
  CONSTRAINT chk_slack_derived_segment_ttl CHECK (
    expires_at > captured_at AND
    expires_at <= captured_at + make_interval(days => effective_retention_days) AND
    expires_at <= captured_at + INTERVAL '30 days'));
CREATE INDEX IF NOT EXISTS idx_slack_derived_segment_lookup
  ON slack_derived_provenance_segments(workspace_id, resource_type, resource_id, revision);
CREATE INDEX IF NOT EXISTS idx_slack_derived_segment_epoch
  ON slack_derived_provenance_segments(provider_profile_id, policy_version, consent_revision, provider_revision);
CREATE INDEX IF NOT EXISTS idx_slack_derived_segment_channel
  ON slack_derived_provenance_segments(workspace_id, channel_id) WHERE channel_id IS NOT NULL;
