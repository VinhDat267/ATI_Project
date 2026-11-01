-- Durable assistant metadata. Slack source bytes are confined to registered artifact bodies.
CREATE TABLE IF NOT EXISTS slack_workspace_configs (
 connection_id uuid PRIMARY KEY REFERENCES slack_connections(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 identity_version integer NOT NULL CHECK(identity_version>0),
 config_json jsonb NOT NULL CHECK(jsonb_typeof(config_json)='object'),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 paused_reason text CHECK(paused_reason IN ('budget_exceeded','backlog_full')),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS slack_followed_threads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 connection_id uuid NOT NULL REFERENCES slack_connections(id) ON DELETE CASCADE,
 identity_version integer NOT NULL,channel_id text NOT NULL,thread_ts text NOT NULL,
 followed_at timestamptz NOT NULL DEFAULT clock_timestamp(),unfollowed_at timestamptz,
 CHECK(unfollowed_at IS NULL OR unfollowed_at>=followed_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS slack_followed_open ON slack_followed_threads(connection_id,identity_version,channel_id,thread_ts) WHERE unfollowed_at IS NULL;
ALTER TABLE slack_event_receipts ADD COLUMN IF NOT EXISTS thread_ts text;
ALTER TABLE slack_triage_jobs DROP CONSTRAINT IF EXISTS slack_triage_jobs_status_check;
ALTER TABLE slack_triage_jobs ADD CONSTRAINT slack_triage_jobs_status_check CHECK(status IN ('pending','running','held_budget','needs_attention','cancelled','decided'));
ALTER TABLE slack_triage_jobs ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '30 seconds');
ALTER TABLE slack_triage_jobs ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '24 hours');
ALTER TABLE slack_triage_jobs ADD COLUMN IF NOT EXISTS lease_token uuid;
ALTER TABLE slack_triage_jobs ADD COLUMN IF NOT EXISTS lease_owner text;
ALTER TABLE slack_triage_jobs ADD COLUMN IF NOT EXISTS lease_until timestamptz;
ALTER TABLE slack_triage_jobs ADD COLUMN IF NOT EXISTS claimed_config_version bigint;
ALTER TABLE slack_triage_jobs ADD COLUMN IF NOT EXISTS batch_job_ids uuid[];
ALTER TABLE slack_triage_jobs ADD COLUMN IF NOT EXISTS held_until timestamptz;
ALTER TABLE slack_triage_jobs ADD COLUMN IF NOT EXISTS attention_code text CHECK(attention_code IN ('expired','source_unavailable','model_failed','context_limit'));
CREATE UNIQUE INDEX IF NOT EXISTS slack_triage_one_running ON slack_triage_jobs(connection_id) WHERE status='running';
CREATE INDEX IF NOT EXISTS slack_triage_due ON slack_triage_jobs(available_at,created_at,id) WHERE status IN ('pending','running','held_budget');
CREATE TABLE IF NOT EXISTS slack_triage_decisions (
 job_id uuid PRIMARY KEY REFERENCES slack_triage_jobs(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('no_action','proposal','needs_clarification')),
 config_version bigint NOT NULL CHECK(config_version>0),
 decided_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS slack_assistant_budget_usage (
 connection_id uuid NOT NULL REFERENCES slack_connections(id) ON DELETE CASCADE,
 period_kind text NOT NULL CHECK(period_kind IN ('day','month')),period_start date NOT NULL,
 calls integer NOT NULL DEFAULT 0 CHECK(calls>=0),
 reserved_tokens bigint NOT NULL DEFAULT 0 CHECK(reserved_tokens>=0),
 actual_tokens bigint CHECK(actual_tokens>=0),
 reported_calls integer NOT NULL DEFAULT 0 CHECK(reported_calls>=0),
 PRIMARY KEY(connection_id,period_kind,period_start)
);
-- Extend cancellation to running and held work. It must never survive a lost authority epoch.
CREATE OR REPLACE FUNCTION cancel_slack_triage_connection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE slack_triage_jobs SET status='cancelled' WHERE connection_id=NEW.id AND status IN ('pending','running','held_budget')
 AND (NEW.status<>'active' OR identity_version<>NEW.identity_version OR user_id<>NEW.user_id OR workspace_id<>NEW.workspace_id OR slack_user_id<>NEW.actor_id OR NEW.app_id IS DISTINCT FROM OLD.app_id);
 IF NEW.status<>'active' OR NEW.identity_version<>OLD.identity_version OR NEW.user_id<>OLD.user_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.actor_id<>OLD.actor_id OR NEW.app_id IS DISTINCT FROM OLD.app_id THEN
 UPDATE slack_workspace_configs SET config_json=jsonb_set(config_json,'{enabled}','false'),identity_version=NEW.identity_version,version=version+1,updated_at=clock_timestamp() WHERE connection_id=NEW.id;
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION cancel_slack_triage_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status<>'active' THEN UPDATE slack_triage_jobs SET status='cancelled' WHERE user_id=NEW.id AND status IN ('pending','running','held_budget'); END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION cancel_slack_triage_runtime() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE slack_triage_jobs j SET status='cancelled' FROM slack_event_receipts r WHERE r.id=j.receipt_id AND r.slack_app_id=NEW.app_id
 AND j.status IN ('pending','running','held_budget') AND (NOT NEW.enabled OR j.runtime_version<>NEW.version);
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION cancel_slack_triage_processing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE slack_triage_jobs SET status='cancelled' WHERE connection_id=NEW.connection_id AND status IN ('pending','running','held_budget')
 AND (NOT NEW.enabled OR identity_version<>NEW.identity_version OR processing_version<>NEW.version);
 RETURN NEW;
END; $$;

ALTER TABLE slack_event_receipts DROP CONSTRAINT IF EXISTS slack_event_receipts_fanout_error_code_check;
ALTER TABLE slack_event_receipts ADD CONSTRAINT slack_event_receipts_fanout_error_code_check
 CHECK(fanout_error_code IN ('authorization_failed','fanout_failed','aborted','owner_busy','backlog_full'));

CREATE TABLE IF NOT EXISTS slack_assistant_artifacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('proposal_excerpt','daily_digest_entry')),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES slack_connections(id) ON DELETE CASCADE,
 workspace_id text NOT NULL,slack_user_id text NOT NULL,identity_version integer NOT NULL,
 conv_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 config_version bigint NOT NULL CHECK(config_version>0),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),payload_revision bigint NOT NULL DEFAULT 1 CHECK(payload_revision>0),
 status text NOT NULL CHECK(status IN ('pending','needs_info','approved','rejected','running','completed','failed','stale')),
 dedupe_hash text NOT NULL CHECK(dedupe_hash~'^[a-f0-9]{64}$'),
 body_json jsonb NOT NULL CHECK(jsonb_typeof(body_json)='object'),
 review_expires_at timestamptz NOT NULL DEFAULT(clock_timestamp()+interval '7 days'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(connection_id,kind,dedupe_hash)
);
CREATE INDEX IF NOT EXISTS slack_assistant_artifacts_owner ON slack_assistant_artifacts(user_id,connection_id,created_at DESC,id);
CREATE OR REPLACE VIEW slack_derived_artifact_payloads AS
SELECT c.id AS copy_id,m.conv_id,v.user_id AS owner_id,NULL::uuid AS plan_id,
  slack_message_selector_value(m.content,m.metadata,c.target_kind,c.target_sub_id) AS payload
FROM slack_derived_copies c JOIN messages m ON m.id::text=c.target_id JOIN conversations v ON v.id=m.conv_id
WHERE c.target_kind IN ('chat_history_message','working_memory_entity')
UNION ALL
SELECT c.id,p.conv_id,v.user_id,p.id,
  CASE WHEN left(c.target_sub_id,16)='resource_labels/' THEN p.resource_labels->slack_selector_decode(substr(c.target_sub_id,17))
  ELSE to_jsonb(p)->c.target_sub_id END
FROM slack_derived_copies c JOIN plans p ON p.id::text=c.target_id JOIN conversations v ON v.id=p.conv_id
WHERE c.target_kind='plan_step_arg' AND c.target_sub_id<>'args_json'
UNION ALL
SELECT c.id,p.conv_id,v.user_id,p.id,to_jsonb(s)->c.target_sub_id
FROM slack_derived_copies c JOIN execution_steps s ON s.id::text=c.target_id JOIN plans p ON p.id=s.plan_id JOIN conversations v ON v.id=p.conv_id
WHERE c.target_kind='audit_log_entry' OR (c.target_kind='plan_step_arg' AND c.target_sub_id='args_json')
UNION ALL
SELECT c.id,s.conv_id,s.user_id,NULL::uuid,to_jsonb(s)->c.target_sub_id
FROM slack_derived_copies c JOIN schedules s ON s.id::text=c.target_id
WHERE c.target_kind='scheduled_workflow_arg' AND c.target_sub_id IN ('name','request','recurrence')
UNION ALL
SELECT c.id,s.conv_id,s.user_id,NULL::uuid,to_jsonb(r)->c.target_sub_id
FROM slack_derived_copies c JOIN schedule_runs r ON r.id::text=c.target_id JOIN schedules s ON s.id=r.schedule_id
WHERE c.target_kind='scheduled_workflow_arg' AND c.target_sub_id='error'
UNION ALL
SELECT c.id,v.id,v.user_id,NULL::uuid,to_jsonb(v.title)
FROM slack_derived_copies c JOIN conversations v ON v.id::text=c.target_id
WHERE c.target_kind='scheduled_workflow_arg' AND c.target_sub_id='title'
UNION ALL
SELECT c.id,a.conv_id,a.user_id,NULL::uuid,a.body_json
FROM slack_derived_copies c JOIN slack_assistant_artifacts a ON a.id::text=c.target_id
WHERE c.target_kind IN ('proposal_excerpt','daily_digest_entry') AND a.kind=c.target_kind AND c.target_sub_id='body_json';

CREATE OR REPLACE FUNCTION slack_artifact_erased(kind TEXT,selector TEXT,payload JSONB) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE
  WHEN kind='scheduled_workflow_arg' THEN CASE WHEN selector='recurrence' THEN payload='{}'::jsonb ELSE payload=to_jsonb('Slack content is unavailable.'::text) END
  WHEN selector='content' THEN payload=to_jsonb('Slack content is unavailable.'::text)
  WHEN kind IN ('chat_history_message','working_memory_entity') OR left(selector,16)='resource_labels/' THEN payload IS NULL
  WHEN selector='plan_json' THEN payload='{"kind":"plan","thinking":"","summary":"Slack content is unavailable.","steps":[],"warnings":[]}'::jsonb
  WHEN selector='plan_text' THEN payload=to_jsonb('{"kind":"plan","thinking":"","summary":"Slack content is unavailable.","steps":[],"warnings":[]}'::text)
  WHEN selector='plan_hash' THEN payload=to_jsonb(encode(sha256(convert_to('{"kind":"plan","thinking":"","summary":"Slack content is unavailable.","steps":[],"warnings":[]}','UTF8')),'hex'))
  WHEN selector IN ('body_json','args_json','output_json','error_json') THEN payload='{"__slack_purged":true}'::jsonb
  ELSE false END $$;

CREATE TABLE IF NOT EXISTS slack_assistant_model_attempts (
 id bigserial PRIMARY KEY,
 job_id uuid NOT NULL REFERENCES slack_triage_jobs(id) ON DELETE CASCADE,
 lease_token uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES slack_connections(id) ON DELETE CASCADE,
 day_start date NOT NULL,month_start date NOT NULL,
 reserved_tokens bigint NOT NULL CHECK(reserved_tokens>0),actual_tokens bigint CHECK(actual_tokens>=0),
 reported_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS slack_assistant_attempt_lease ON slack_assistant_model_attempts(job_id,lease_token,id DESC);

-- The receipt, not a delayed fanout/migration, starts both queue clocks.
CREATE OR REPLACE FUNCTION stamp_slack_triage_window() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE received timestamptz;
BEGIN
 SELECT created_at INTO received FROM slack_event_receipts WHERE id=NEW.receipt_id;
 IF received IS NULL THEN RAISE EXCEPTION 'SLACK_TRIAGE_RECEIPT_NOT_FOUND'; END IF;
 NEW.available_at:=received+interval '30 seconds';NEW.expires_at:=received+interval '24 hours';
 IF NEW.status='pending' AND NEW.expires_at<=clock_timestamp() THEN NEW.status:='needs_attention';NEW.attention_code:='expired'; END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS slack_triage_window ON slack_triage_jobs;
CREATE TRIGGER slack_triage_window BEFORE INSERT ON slack_triage_jobs FOR EACH ROW EXECUTE FUNCTION stamp_slack_triage_window();
WITH cut AS MATERIALIZED(SELECT clock_timestamp() AS at)
UPDATE slack_triage_jobs j SET available_at=LEAST(j.available_at,r.created_at+interval '30 seconds'),
 expires_at=LEAST(j.expires_at,r.created_at+interval '24 hours'),
 status=CASE WHEN j.status IN ('pending','running','held_budget') AND LEAST(j.expires_at,r.created_at+interval '24 hours')<=cut.at THEN 'needs_attention' ELSE j.status END,
 attention_code=CASE WHEN j.status IN ('pending','running','held_budget') AND LEAST(j.expires_at,r.created_at+interval '24 hours')<=cut.at THEN 'expired' ELSE j.attention_code END,
 lease_token=CASE WHEN LEAST(j.expires_at,r.created_at+interval '24 hours')<=cut.at THEN NULL ELSE j.lease_token END,
 lease_owner=CASE WHEN LEAST(j.expires_at,r.created_at+interval '24 hours')<=cut.at THEN NULL ELSE j.lease_owner END,
 lease_until=CASE WHEN LEAST(j.expires_at,r.created_at+interval '24 hours')<=cut.at THEN NULL ELSE j.lease_until END
FROM slack_event_receipts r,cut WHERE r.id=j.receipt_id;
