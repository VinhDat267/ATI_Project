ALTER TABLE plans ADD COLUMN IF NOT EXISTS slack_lineage_manifest JSONB;
ALTER TABLE execution_steps ADD COLUMN IF NOT EXISTS slack_lineage_manifest JSONB;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='plans'::regclass AND conname='chk_slack_plan_manifest') THEN
    ALTER TABLE plans ADD CONSTRAINT chk_slack_plan_manifest CHECK(slack_lineage_manifest IS NULL OR jsonb_typeof(slack_lineage_manifest)='array');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='execution_steps'::regclass AND conname='chk_slack_step_manifest') THEN
    ALTER TABLE execution_steps ADD CONSTRAINT chk_slack_step_manifest CHECK(slack_lineage_manifest IS NULL OR jsonb_typeof(slack_lineage_manifest)='array');
  END IF;
END $$;

-- Metadata for fenced queue scans. Runtime authority and fingerprints are
-- independently verified against concrete locked artifacts, not this view.
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
WHERE c.target_kind='audit_log_entry' OR (c.target_kind='plan_step_arg' AND c.target_sub_id='args_json');

CREATE OR REPLACE FUNCTION slack_artifact_erased(kind TEXT,selector TEXT,payload JSONB) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE
  WHEN selector='content' THEN payload=to_jsonb('Slack content is unavailable.'::text)
  WHEN kind IN ('chat_history_message','working_memory_entity') OR left(selector,16)='resource_labels/' THEN payload IS NULL
  WHEN selector='plan_json' THEN payload='{"kind":"plan","thinking":"","summary":"Slack content is unavailable.","steps":[],"warnings":[]}'::jsonb
  WHEN selector='plan_text' THEN payload=to_jsonb('{"kind":"plan","thinking":"","summary":"Slack content is unavailable.","steps":[],"warnings":[]}'::text)
  WHEN selector='plan_hash' THEN payload=to_jsonb(encode(sha256(convert_to('{"kind":"plan","thinking":"","summary":"Slack content is unavailable.","steps":[],"warnings":[]}','UTF8')),'hex'))
  WHEN selector IN ('args_json','output_json','error_json') THEN payload='{"__slack_purged":true}'::jsonb
  ELSE false END $$;
