-- SLACK-04C: private operation metadata only. Message text and credentials never enter this ledger.
CREATE TABLE IF NOT EXISTS slack_write_outbox (
  operation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_msg_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES plans(id),
  step_id text NOT NULL CHECK(length(step_id) BETWEEN 1 AND 128),
  plan_hash text NOT NULL CHECK(plan_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES users(id),
  connection_id uuid NOT NULL REFERENCES slack_connections(id),
  app_id text NOT NULL,
  workspace_id text NOT NULL,
  slack_user_id text NOT NULL,
  identity_version integer NOT NULL,
  request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  channel_id text NOT NULL,
  status text NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','dispatching','unknown','confirmed','rejected')),
  lease_token uuid NOT NULL DEFAULT gen_random_uuid(),
  lease_until timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 seconds',
  attempt_id uuid UNIQUE,
  dispatched_at timestamptz,
  provider_ts text CHECK(provider_ts IS NULL OR provider_ts ~ '^[0-9]{1,10}\.[0-9]{6}$'),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(plan_id,step_id),
  CHECK((status='prepared')=(attempt_id IS NULL)),
  CHECK((attempt_id IS NULL)=(dispatched_at IS NULL)),
  CHECK(status<>'confirmed' OR (provider_ts IS NOT NULL AND confirmed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_slack_outbox_echo ON slack_write_outbox(app_id,workspace_id,slack_user_id,channel_id,provider_ts)
  WHERE status<>'prepared';
-- Each candidate is quarantined before ACK and can never become an AI intent while unresolved.
CREATE TABLE IF NOT EXISTS slack_echo_candidates (
  receipt_id uuid PRIMARY KEY REFERENCES slack_event_receipts(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL REFERENCES slack_write_outbox(operation_id),
  native_ts text NOT NULL,
  client_msg_id uuid,
  status text NOT NULL CHECK(status IN ('pending','confirmed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
