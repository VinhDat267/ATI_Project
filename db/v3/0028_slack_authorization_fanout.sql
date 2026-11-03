-- Private routing metadata only. No message body, token, text or blocks are stored.
-- Evidence dates may be backdated or serialized through JavaScript Date. These independent
-- server-owned fences record the actual authority write, after its row lock, at SQL precision.
ALTER TABLE slack_connections ADD COLUMN IF NOT EXISTS identity_epoch_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE slack_processing_consents ADD COLUMN IF NOT EXISTS processing_effective_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE slack_trusted_providers ADD COLUMN IF NOT EXISTS processing_effective_at timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE OR REPLACE FUNCTION stamp_slack_identity_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.identity_epoch_at:=clock_timestamp(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS slack_identity_epoch_fence ON slack_connections;
CREATE TRIGGER slack_identity_epoch_fence BEFORE INSERT OR UPDATE OF user_id,app_id,workspace_id,actor_id,identity_version,connected_at
 ON slack_connections FOR EACH ROW EXECUTE FUNCTION stamp_slack_identity_epoch();
CREATE OR REPLACE FUNCTION stamp_slack_processing_effective() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.processing_effective_at:=clock_timestamp(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS slack_consent_time_fence ON slack_processing_consents;
CREATE TRIGGER slack_consent_time_fence BEFORE INSERT OR UPDATE OF status,revision,purposes,retention_days,policy_version,granted_at
 ON slack_processing_consents FOR EACH ROW EXECUTE FUNCTION stamp_slack_processing_effective();
DROP TRIGGER IF EXISTS slack_provider_time_fence ON slack_trusted_providers;
CREATE TRIGGER slack_provider_time_fence BEFORE INSERT OR UPDATE OF revision,verified,no_training,max_retention_days,configuration_fingerprint,evidence_ref,verified_by,verified_at
 ON slack_trusted_providers FOR EACH ROW EXECUTE FUNCTION stamp_slack_processing_effective();
ALTER TABLE slack_event_receipts ADD COLUMN IF NOT EXISTS fanout_lease_token uuid;
ALTER TABLE slack_event_receipts ADD COLUMN IF NOT EXISTS fanout_lease_owner text;
ALTER TABLE slack_event_receipts ADD COLUMN IF NOT EXISTS fanout_lease_until timestamptz;
ALTER TABLE slack_event_receipts ADD COLUMN IF NOT EXISTS fanout_next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE slack_event_receipts ADD COLUMN IF NOT EXISTS fanout_attempts integer NOT NULL DEFAULT 0 CHECK (fanout_attempts>=0);
ALTER TABLE slack_event_receipts ADD COLUMN IF NOT EXISTS fanout_error_code text
  CHECK (fanout_error_code IN ('authorization_failed','fanout_failed','aborted','owner_busy'));
CREATE INDEX IF NOT EXISTS idx_slack_fanout_due ON slack_event_receipts(slack_app_id,fanout_next_attempt_at,created_at)
  WHERE status IN ('pending_fanout','failed');

CREATE TABLE IF NOT EXISTS slack_fanout_runtime (
 app_id text PRIMARY KEY,
 enabled boolean NOT NULL DEFAULT false,
 processing_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 gap_detected_at timestamptz,
 version bigint NOT NULL DEFAULT 1 CHECK (version>0)
);
CREATE TABLE IF NOT EXISTS slack_processing_controls (
 connection_id uuid PRIMARY KEY REFERENCES slack_connections(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 identity_version integer NOT NULL CHECK (identity_version>0),
 enabled boolean NOT NULL DEFAULT false,
 processing_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 config_revision_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 resumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 version bigint NOT NULL DEFAULT 1 CHECK (version>0)
);
CREATE TABLE IF NOT EXISTS slack_triage_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 receipt_id uuid NOT NULL REFERENCES slack_event_receipts(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES slack_connections(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 workspace_id text NOT NULL,
 slack_user_id text NOT NULL,
 identity_version integer NOT NULL CHECK (identity_version>0),
 policy_reference jsonb NOT NULL CHECK (jsonb_typeof(policy_reference)='object'),
 processing_version bigint NOT NULL CHECK (processing_version>0),
 runtime_version bigint NOT NULL CHECK (runtime_version>0),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','cancelled')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(receipt_id,connection_id,identity_version)
);
CREATE INDEX IF NOT EXISTS idx_slack_triage_connection_pending ON slack_triage_jobs(connection_id,user_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_slack_triage_owner_pending ON slack_triage_jobs(user_id) WHERE status='pending';

-- These fences cover every existing writer, including lifecycle/reconnect and admin SQL paths.
-- Cancellation is conservative; a future content consumer still must check current authority.
CREATE OR REPLACE FUNCTION cancel_slack_triage_connection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE slack_triage_jobs SET status='cancelled' WHERE connection_id=NEW.id AND status='pending'
  AND (NEW.status<>'active' OR identity_version<>NEW.identity_version OR user_id<>NEW.user_id
   OR workspace_id<>NEW.workspace_id OR slack_user_id<>NEW.actor_id OR NEW.app_id IS DISTINCT FROM OLD.app_id);
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS slack_triage_connection_fence ON slack_connections;
CREATE TRIGGER slack_triage_connection_fence AFTER UPDATE OF status,identity_version,user_id,app_id,workspace_id,actor_id ON slack_connections
 FOR EACH ROW EXECUTE FUNCTION cancel_slack_triage_connection();

CREATE OR REPLACE FUNCTION cancel_slack_triage_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status<>'active' THEN UPDATE slack_triage_jobs SET status='cancelled' WHERE user_id=NEW.id AND status='pending'; END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS slack_triage_owner_fence ON users;
CREATE TRIGGER slack_triage_owner_fence AFTER UPDATE OF status ON users FOR EACH ROW EXECUTE FUNCTION cancel_slack_triage_owner();

CREATE OR REPLACE FUNCTION cancel_slack_triage_runtime() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE slack_triage_jobs j SET status='cancelled' FROM slack_event_receipts r WHERE r.id=j.receipt_id
  AND r.slack_app_id=NEW.app_id AND j.status='pending' AND (NOT NEW.enabled OR j.runtime_version<>NEW.version);
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS slack_triage_runtime_fence ON slack_fanout_runtime;
CREATE TRIGGER slack_triage_runtime_fence AFTER UPDATE ON slack_fanout_runtime FOR EACH ROW EXECUTE FUNCTION cancel_slack_triage_runtime();

CREATE OR REPLACE FUNCTION cancel_slack_triage_processing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE slack_triage_jobs SET status='cancelled' WHERE connection_id=NEW.connection_id AND status='pending'
  AND (NOT NEW.enabled OR identity_version<>NEW.identity_version OR processing_version<>NEW.version);
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS slack_triage_processing_fence ON slack_processing_controls;
CREATE TRIGGER slack_triage_processing_fence AFTER UPDATE ON slack_processing_controls FOR EACH ROW EXECUTE FUNCTION cancel_slack_triage_processing();
