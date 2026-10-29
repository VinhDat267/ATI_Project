-- Migration 0016: F1 Organization Consent, Trusted Providers, and Policy Events for Slack
CREATE TABLE IF NOT EXISTS slack_trusted_providers (
  id text PRIMARY KEY,
  name text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  no_training boolean NOT NULL DEFAULT false,
  max_retention_days integer NOT NULL DEFAULT 0 CHECK (max_retention_days >= 0),
  configuration_fingerprint text NOT NULL,
  evidence_ref text,
  verified_by text,
  verified_at timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_slack_trusted_providers_verified CHECK (
    verified = false OR (
      no_training = true AND
      evidence_ref IS NOT NULL AND trim(evidence_ref) <> '' AND
      verified_by IS NOT NULL AND trim(verified_by) <> '' AND
      verified_at IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS slack_processing_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  provider_id text NOT NULL REFERENCES slack_trusted_providers(id) ON DELETE RESTRICT,
  policy_version text NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'granted', 'revoked')),
  purposes text[] NOT NULL DEFAULT '{}',
  retention_days integer NOT NULL DEFAULT 0 CHECK (retention_days >= 0),
  organization_representative text,
  evidence_ref text,
  recorded_by text,
  granted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, provider_id),
  CONSTRAINT chk_slack_processing_consents_granted CHECK (
    status <> 'granted' OR (
      organization_representative IS NOT NULL AND trim(organization_representative) <> '' AND
      evidence_ref IS NOT NULL AND trim(evidence_ref) <> '' AND
      recorded_by IS NOT NULL AND trim(recorded_by) <> '' AND
      granted_at IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS slack_policy_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  provider_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('consent_granted', 'consent_revoked', 'provider_attested', 'provider_updated')),
  policy_version text NOT NULL,
  consent_revision bigint NOT NULL,
  provider_revision bigint,
  reason text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slack_processing_consents_lookup
  ON slack_processing_consents(workspace_id, provider_id);

CREATE INDEX IF NOT EXISTS idx_slack_policy_events_lookup
  ON slack_policy_events(workspace_id, provider_id, occurred_at DESC);
