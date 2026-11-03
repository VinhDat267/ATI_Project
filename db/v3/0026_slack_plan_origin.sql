-- Source-free plan and step cutover. No default or trigger certifies old or bypass writes.
CREATE TABLE IF NOT EXISTS slack_plan_origin_cutovers (
  id TEXT PRIMARY KEY CHECK (id = 'plan-origin-v1'),
  enabled BOOLEAN NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO slack_plan_origin_cutovers(id, enabled) VALUES ('plan-origin-v1', true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS slack_plan_origins (
  artifact_table TEXT NOT NULL CHECK (artifact_table IN ('plans', 'execution_steps')),
  artifact_id UUID NOT NULL,
  ati_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conv_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  cutover_id TEXT NOT NULL REFERENCES slack_plan_origin_cutovers(id),
  producer TEXT NOT NULL CHECK (producer IN ('plan_writer', 'step_writer', 'step_status', 'backfill_plain', 'physical_purge')),
  remainder_fingerprint TEXT NOT NULL CHECK (remainder_fingerprint ~ '^[a-f0-9]{64}$'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (artifact_table, artifact_id)
);
ALTER TABLE slack_plan_origins DROP CONSTRAINT IF EXISTS slack_plan_origins_producer_check;
ALTER TABLE slack_plan_origins ADD CONSTRAINT slack_plan_origins_producer_check
  CHECK (producer IN ('plan_writer', 'step_writer', 'step_status', 'backfill_plain', 'physical_purge'));
