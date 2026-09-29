-- ==============================================================================
-- AI Workflow Automation Platform v3 — Core Schema Migration
-- 6 Tables & 4 Performance Indexes
-- ==============================================================================

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,              -- salted PBKDF2-SHA256 hash
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 2. Conversations Table
CREATE TABLE IF NOT EXISTS conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  status      TEXT NOT NULL DEFAULT 'chatting',
                -- chatting | executing | completed | canceled
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 3. Messages Table
CREATE TABLE IF NOT EXISTS messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conv_id     UUID NOT NULL REFERENCES conversations(id),
  role        TEXT NOT NULL,              -- user | assistant | system | summary
  content     TEXT NOT NULL,
  metadata    JSONB,                      -- { type: "gather", tool, output } etc.
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 4. Plans Table
CREATE TABLE IF NOT EXISTS plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conv_id     UUID NOT NULL REFERENCES conversations(id),
  plan_json   JSONB NOT NULL,             -- full plan steps (parsed)
  plan_text   TEXT,                       -- raw string from LLM (for hash)
  plan_hash   TEXT NOT NULL,              -- SHA-256 on plan_text or stable-stringify
  status      TEXT NOT NULL DEFAULT 'pending',
                -- pending | approved | rejected | expired
                -- | executing | completed | partial | failed
  expires_at  TIMESTAMPTZ NOT NULL,       -- 30 minutes
  decided_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 5. Execution Steps Table
CREATE TABLE IF NOT EXISTS execution_steps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       UUID NOT NULL REFERENCES plans(id),
  step_id       TEXT NOT NULL,            -- "step_1"
  tool          TEXT NOT NULL,
  args_json     JSONB NOT NULL,           -- resolved args
  status        TEXT NOT NULL DEFAULT 'pending',
                  -- pending | running | succeeded | failed | skipped | unknown
  output_json   JSONB,
  error_json    JSONB,
  requested_by  TEXT NOT NULL,            -- user_id
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  duration_ms   INTEGER
);

-- 6. Service Credentials Table
CREATE TABLE IF NOT EXISTS service_credentials (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service     TEXT NOT NULL,              -- "trello", "slack"
  user_id     UUID REFERENCES users(id), -- NULL = team-shared credentials
  config      TEXT NOT NULL,             -- encrypted format: v1:iv:tag:ciphertext
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv_id ON messages(conv_id);
CREATE INDEX IF NOT EXISTS idx_plans_conv_id ON plans(conv_id);
CREATE INDEX IF NOT EXISTS idx_execution_steps_plan_id ON execution_steps(plan_id);
