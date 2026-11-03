-- Enforce monotonic state ordering and per-connection callback isolation for Slack OAuth
CREATE SEQUENCE IF NOT EXISTS slack_oauth_state_seq;

ALTER TABLE slack_oauth_states
  ADD COLUMN IF NOT EXISTS order_seq bigint NOT NULL DEFAULT nextval('slack_oauth_state_seq');

ALTER TABLE slack_connections
  ADD COLUMN IF NOT EXISTS last_state_order bigint NOT NULL DEFAULT 0;
