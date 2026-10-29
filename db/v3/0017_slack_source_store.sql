-- 0017_slack_source_store.sql
-- SLACK-03B1: Raw source store, durable invalidation receipts, barriers, and intents

-- 1. Bảng lưu trữ nguồn thô (Raw-only <= 7 ngày, khóa capture vật lý UUID)
CREATE TABLE IF NOT EXISTS slack_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_source_key TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES slack_connections(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  slack_user_id TEXT NOT NULL,
  identity_version INT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  policy_epoch_hash TEXT NOT NULL,
  policy_requested_retention_days INT NOT NULL,
  retention_days INT NOT NULL,
  policy_ref JSONB NOT NULL,
  untrusted_content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  tombstoned_at TIMESTAMPTZ,
  tombstone_reason TEXT,
  purged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_slack_sources_requested_retention CHECK (policy_requested_retention_days > 0),
  CONSTRAINT chk_slack_sources_retention_days CHECK (retention_days > 0 AND retention_days <= 7 AND retention_days <= policy_requested_retention_days),
  CONSTRAINT chk_slack_sources_raw_retention CHECK (expires_at > captured_at AND expires_at <= captured_at + make_interval(days => retention_days))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_slack_sources_active_epoch
  ON slack_sources(owner_source_key, policy_epoch_hash) WHERE purged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_slack_sources_expiration
  ON slack_sources(expires_at) WHERE purged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_slack_sources_lookup
  ON slack_sources(user_id, connection_id, resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_slack_sources_workspace
  ON slack_sources(workspace_id, resource_type, resource_id);

-- 2. Bảng biên nhận sự kiện vô hiệu hóa (Idempotent Event Receipt Store)
CREATE TABLE IF NOT EXISTS slack_invalidation_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_event_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Bảng rào chắn đọc tức thì (Durable Read Barriers)
CREATE TABLE IF NOT EXISTS slack_invalidation_barriers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_event_key TEXT NOT NULL,
  effect_key TEXT NOT NULL,
  barrier_type TEXT NOT NULL CHECK (barrier_type IN ('binding', 'channel', 'epoch', 'resource', 'provisional_auth')),
  workspace_id TEXT NOT NULL,
  connection_id UUID REFERENCES slack_connections(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  slack_user_id TEXT,
  identity_version INT,
  channel_id TEXT,
  resource_type TEXT,
  resource_id TEXT,
  min_valid_revision TEXT,
  deleted BOOLEAN NOT NULL DEFAULT false,
  epoch_hash TEXT,
  epoch_json JSONB,
  provisional BOOLEAN NOT NULL DEFAULT false,
  provisional_action TEXT,
  provisional_source_event_key TEXT,
  credential_fingerprint TEXT,
  reason TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_slack_barriers_source_effect UNIQUE(source_event_key, effect_key)
);
CREATE INDEX IF NOT EXISTS idx_slack_barriers_active
  ON slack_invalidation_barriers(workspace_id, barrier_type) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_slack_barriers_connection
  ON slack_invalidation_barriers(connection_id, identity_version) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_slack_barriers_resource
  ON slack_invalidation_barriers(workspace_id, resource_type, resource_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_slack_barriers_epoch
  ON slack_invalidation_barriers(epoch_hash) WHERE active = true;

-- 4. Hàng đợi ý định vô hiệu hóa bền vững (Durable Invalidation Queue)
CREATE TABLE IF NOT EXISTS slack_invalidation_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_event_key TEXT NOT NULL,
  effect_key TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  purge_target JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  leased_until TIMESTAMPTZ,
  worker_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT uq_slack_intents_source_effect_target UNIQUE(source_event_key, effect_key, target_kind)
);
CREATE INDEX IF NOT EXISTS idx_slack_intents_claim
  ON slack_invalidation_intents(status, leased_until) WHERE status IN ('pending', 'failed');
