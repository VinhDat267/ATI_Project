-- B/local contract repair. Apply after 0001; enum additions must COMMIT before use.
-- NOT_RUN on PostgreSQL in the remediation session; see db/DATABASE.md.
ALTER TYPE run_status ADD VALUE IF NOT EXISTS 'refused';
ALTER TYPE run_status ADD VALUE IF NOT EXISTS 'needs_input';
ALTER TYPE run_status ADD VALUE IF NOT EXISTS 'reconciliation_required';

BEGIN;
ALTER TABLE workflow_versions ADD CONSTRAINT workflow_versions_id_workflow UNIQUE (id, workflow_id);
ALTER TABLE workflows ADD CONSTRAINT workflows_id_user UNIQUE (id, user_id);

ALTER TABLE runs ALTER COLUMN workflow_version_id DROP NOT NULL;
ALTER TABLE runs ADD COLUMN workflow_id UUID REFERENCES workflows(id);
ALTER TABLE runs ADD COLUMN source_prompt TEXT;
ALTER TABLE runs ADD COLUMN planner_result JSONB;
ALTER TABLE runs ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE runs ADD COLUMN next_event_seq INT NOT NULL DEFAULT 1 CHECK (next_event_seq > 0);
ALTER TABLE runs ADD COLUMN cancel_requested_at TIMESTAMPTZ;
UPDATE runs r SET workflow_id = v.workflow_id, source_prompt = w.source_prompt
  FROM workflow_versions v JOIN workflows w ON w.id = v.workflow_id
  WHERE v.id = r.workflow_version_id;
UPDATE runs r SET next_event_seq = COALESCE((SELECT max(e.seq) + 1 FROM run_events e WHERE e.run_id = r.id), 1);
ALTER TABLE runs ALTER COLUMN workflow_id SET NOT NULL;
ALTER TABLE runs ALTER COLUMN source_prompt SET NOT NULL;
ALTER TABLE runs ALTER COLUMN time_zone SET DEFAULT 'Asia/Ho_Chi_Minh';
ALTER TABLE runs ADD CONSTRAINT runs_owner_workflow FOREIGN KEY (workflow_id, user_id) REFERENCES workflows(id, user_id);
ALTER TABLE runs ADD CONSTRAINT runs_version_workflow FOREIGN KEY (workflow_version_id, workflow_id) REFERENCES workflow_versions(id, workflow_id);
ALTER TABLE runs ADD CONSTRAINT runs_executable_version CHECK (
  status::text NOT IN ('dry_running','awaiting_approval','running','replanning','succeeded') OR workflow_version_id IS NOT NULL
);

-- Raw discovery without reviewed policy stays unusable.
ALTER TABLE tools ADD COLUMN output_schema JSONB;
ALTER TABLE tools ADD COLUMN reviewed_side_effect side_effect_t;
ALTER TABLE tools ADD COLUMN policy_version TEXT;
ALTER TABLE tools ADD COLUMN server_artifact_hash TEXT;
ALTER TABLE tools ADD CONSTRAINT tools_reviewed_contract CHECK (
  (policy_version IS NULL AND reviewed_side_effect IS NULL)
  OR (policy_version IS NOT NULL AND reviewed_side_effect IS NOT NULL AND output_schema IS NOT NULL)
);

-- Existing approvals did not bind a payload; invalidate them, never infer consent.
UPDATE approvals SET decision = 'superseded' WHERE decision IN ('pending','approved');
ALTER TABLE approvals ADD COLUMN workflow_version_id UUID REFERENCES workflow_versions(id);
ALTER TABLE approvals ADD COLUMN snapshot_hash TEXT;
UPDATE approvals a SET workflow_version_id = r.workflow_version_id FROM runs r WHERE r.id = a.run_id;
ALTER TABLE approvals ADD CONSTRAINT approvals_decision CHECK (decision IN ('pending','approved','rejected','expired','superseded'));
ALTER TABLE approvals ADD CONSTRAINT approvals_bound_snapshot CHECK (
  decision NOT IN ('pending','approved') OR
  (workflow_version_id IS NOT NULL AND snapshot_hash IS NOT NULL AND snapshot_hash ~ '^[a-f0-9]{64}$')
);

-- Legacy success-only keys cannot establish whether an interrupted call committed.
-- Keep the historical table for inspection; B/local never uses it to authorize/dedupe new writes.
COMMENT ON TABLE idempotency_records IS 'LEGACY: read only history. New write protocol uses tool_operations.';
CREATE TABLE tool_operations (
  operation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  run_id UUID NOT NULL REFERENCES runs(id),
  workflow_version_id UUID NOT NULL REFERENCES workflow_versions(id),
  step_id TEXT NOT NULL,
  tool_server TEXT NOT NULL, tool_name TEXT NOT NULL, policy_version TEXT NOT NULL,
  intent_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  resolved_args JSONB NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved','in_flight','succeeded','known_failed','unknown')),
  receiver_mode TEXT NOT NULL CHECK (receiver_mode IN ('local_transaction','receiver_idempotent','non_idempotent')),
  result JSONB, error_message TEXT, claimed_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, workflow_version_id, step_id)
);

ALTER TABLE step_attempts ADD COLUMN workflow_version_id UUID REFERENCES workflow_versions(id);
ALTER TABLE step_attempts ADD COLUMN tool_snapshot JSONB;
ALTER TABLE step_attempts ADD COLUMN operation_id UUID REFERENCES tool_operations(operation_id);
ALTER TABLE step_attempts ADD COLUMN outcome_certainty TEXT CHECK (outcome_certainty IN ('before_dispatch','known_not_applied','confirmed','unknown'));
-- Do not backfill historical attempts with the CURRENT plan: that would fabricate old tool identity.
COMMENT ON COLUMN step_attempts.tool_snapshot IS 'New attempts require immutable server/tool/policy/input/output schema snapshot. NULL denotes legacy unknown.';

CREATE TABLE run_outbox (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES runs(id),
  event_seq INT NOT NULL,
  job_kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, event_seq, job_kind),
  FOREIGN KEY (run_id, event_seq) REFERENCES run_events(run_id, seq)
);
COMMIT;
