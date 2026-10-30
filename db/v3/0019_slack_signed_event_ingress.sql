-- SLACK-04A: body-free event receipts and durable lifecycle intents.
-- Raw request bodies, message text and tokens are never stored here. The F3 read barriers
-- live in 03B1's slack_invalidation_barriers table and are committed in the same transaction.
CREATE TABLE IF NOT EXISTS slack_event_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_app_id text NOT NULL,
  event_id text NOT NULL,
  team_id text NOT NULL,
  event_type text NOT NULL,
  event_subtype text,
  source_event_ts text,
  source_event_time timestamptz,
  event_context text,
  channel_id text,
  message_ts text,
  payload_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending_fanout'
    CHECK (status IN ('pending_fanout', 'pending_lifecycle', 'discarded', 'processed', 'failed')),
  discard_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (slack_app_id, event_id),
  CHECK (length(slack_app_id) BETWEEN 1 AND 64),
  CHECK (length(event_id) BETWEEN 1 AND 128),
  CHECK (length(team_id) BETWEEN 1 AND 64),
  CHECK (length(event_type) BETWEEN 1 AND 64),
  CHECK (event_subtype IS NULL OR length(event_subtype) BETWEEN 1 AND 64),
  CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CHECK (source_event_ts IS NULL OR source_event_ts ~ '^[0-9]{1,10}(\.[0-9]{1,6})?$'),
  CHECK (event_context IS NULL OR length(event_context) <= 1024),
  CHECK (channel_id IS NULL OR length(channel_id) <= 64),
  CHECK (message_ts IS NULL OR message_ts ~ '^[0-9]{1,10}(\.[0-9]{1,6})?$'),
  -- A live receipt must carry an immutable event time. Only a deliberately discarded
  -- malformed-timestamp event may leave both columns NULL; no Date.now() substitute exists.
  CHECK (status = 'discarded' OR (source_event_ts IS NOT NULL AND source_event_time IS NOT NULL)),
  CHECK ((status = 'discarded') = (discard_reason IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_slack_event_receipts_pending
  ON slack_event_receipts (status, created_at)
  WHERE status IN ('pending_fanout', 'pending_lifecycle');

CREATE INDEX IF NOT EXISTS idx_slack_event_receipts_created
  ON slack_event_receipts (created_at);

CREATE TABLE IF NOT EXISTS slack_lifecycle_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES slack_event_receipts(id) ON DELETE CASCADE,
  team_id text NOT NULL,
  effect_key text NOT NULL,
  intent_type text NOT NULL
    CHECK (intent_type IN ('token_revocation_validation', 'app_uninstall_validation', 'message_deleted', 'message_changed')),
  payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  UNIQUE (receipt_id, effect_key),
  CHECK (length(team_id) BETWEEN 1 AND 64),
  CHECK (length(effect_key) BETWEEN 1 AND 200)
);

CREATE INDEX IF NOT EXISTS idx_slack_lifecycle_intents_pending
  ON slack_lifecycle_intents (status, created_at)
  WHERE status = 'pending';
