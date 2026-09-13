-- ============================================================
-- AI Workflow Automation Platform — Schema khởi tạo
-- PostgreSQL 16 + pgvector
--
-- Nguyên tắc thiết kế xuyên suốt:
--   1. TÁCH definition (kế hoạch) khỏi runtime state (lượt chạy).
--      Không có tách bạch này thì không thể resume và không thể
--      chạy lại một kế hoạch nhiều lần.
--   2. Trace là APPEND-ONLY. step_states giữ trạng thái hiện tại,
--      step_attempts giữ lịch sử từng lần thử — không ghi đè.
--   3. Mọi chuyển trạng thái ghi xuống DB NGAY (FR-EXE-07).
--      Đây là cơ sở của resume sau crash, không phải tối ưu hoá.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "vector";     -- pgvector cho Tool Retrieval

-- ============================================================
-- ENUMs
-- ============================================================

CREATE TYPE mcp_transport   AS ENUM ('stdio', 'streamable_http');
CREATE TYPE server_status   AS ENUM ('connected', 'disconnected', 'error');

CREATE TYPE run_status      AS ENUM (
  'planning',           -- đang sinh kế hoạch
  'validating',         -- đang validate 3 tầng
  'dry_running',        -- đang chạy bước read để preview
  'awaiting_approval',  -- chờ người dùng duyệt
  'running',            -- đang thực thi
  'replanning',         -- đang sửa kế hoạch sau lỗi
  'succeeded',
  'failed',
  'rejected',           -- người dùng từ chối
  'cancelled',          -- người dùng huỷ giữa chừng
  'expired'             -- quá hạn chờ duyệt
);

CREATE TYPE step_status     AS ENUM (
  'pending', 'ready', 'running', 'succeeded',
  'failed', 'skipped',        -- condition sai
  'deduplicated'              -- idempotency key đã dùng → bỏ qua
);

CREATE TYPE side_effect_t   AS ENUM ('read', 'write');

CREATE TYPE error_class     AS ENUM (
  'transient',        -- 429, 503, timeout       → retry
  'bad_args',         -- 400, validation error   → replan cục bộ
  'bad_tool',         -- 404, tool sai           → replan cục bộ
  'bad_assumption',   -- output rỗng/sai kiểu    → replan một phần
  'fatal'             -- không phục hồi được
);

-- ============================================================
-- Người dùng
-- ============================================================

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- MCP Server và Tool Registry
-- ============================================================

CREATE TABLE mcp_servers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- slug dùng trong DSL: tool.server trỏ tới giá trị này
  slug            TEXT NOT NULL,
  display_name    TEXT NOT NULL,

  transport       mcp_transport NOT NULL,
  -- stdio: câu lệnh + tham số; streamable_http: URL
  endpoint        TEXT NOT NULL,

  -- Credential mã hoá ở tầng ứng dụng. KHÔNG bao giờ đưa vào prompt (FR-CON-07).
  auth_encrypted  BYTEA,

  status          server_status NOT NULL DEFAULT 'disconnected',
  last_error      TEXT,
  last_checked_at TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- slug phải duy nhất trong phạm vi một người dùng, vì DSL tham chiếu theo slug
  CONSTRAINT mcp_servers_user_slug_key UNIQUE (user_id, slug)
);

CREATE INDEX mcp_servers_user_idx ON mcp_servers (user_id);

-- Tool phát hiện được qua tools/list (FR-CON-03)
CREATE TABLE tools (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id     UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,

  name          TEXT NOT NULL,
  description   TEXT,
  -- JSON Schema do MCP Server khai báo — validator tầng 2 đối chiếu với cái này
  input_schema  JSONB NOT NULL,

  -- Tool Retrieval: vector + full-text (hybrid, mục 4.1)
  -- Số chiều tuỳ model embedding; 1536 là mặc định phổ biến.
  embedding     VECTOR(1536),
  search_text   TEXT GENERATED ALWAYS AS (
                  coalesce(name, '') || ' ' || coalesce(description, '')
                ) STORED,

  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Đánh dấu tool biến mất sau lần refresh; giữ lại để trace cũ không gãy
  removed_at    TIMESTAMPTZ,

  CONSTRAINT tools_server_name_key UNIQUE (server_id, name)
);

CREATE INDEX tools_server_idx ON tools (server_id) WHERE removed_at IS NULL;

-- HNSW cho vector search. Dùng cosine vì embedding đã chuẩn hoá.
CREATE INDEX tools_embedding_idx ON tools
  USING hnsw (embedding vector_cosine_ops);

-- Full-text cho thành phần BM25 của hybrid retrieval
CREATE INDEX tools_search_idx ON tools
  USING gin (to_tsvector('simple', search_text));

-- ============================================================
-- Workflow: definition
-- ============================================================

CREATE TABLE workflows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  source_prompt TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at   TIMESTAMPTZ
);

CREATE INDEX workflows_user_idx ON workflows (user_id, created_at DESC);

-- Mỗi lần sinh/sửa kế hoạch tạo một version mới. Bất biến sau khi tạo.
-- Nhờ vậy trace cũ luôn trỏ đúng kế hoạch đã chạy, kể cả sau replan.
CREATE TABLE workflow_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id   UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version_no    INT  NOT NULL,

  -- Workflow Plan đã qua cả 3 tầng validate, đúng Zod schema
  plan          JSONB NOT NULL,

  -- Kế hoạch này sinh ra từ đâu: 'initial' | 'replan' | 'manual_edit'
  origin        TEXT NOT NULL DEFAULT 'initial',
  parent_id     UUID REFERENCES workflow_versions(id) ON DELETE SET NULL,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT workflow_versions_no_key UNIQUE (workflow_id, version_no)
);

CREATE INDEX workflow_versions_workflow_idx
  ON workflow_versions (workflow_id, version_no DESC);

-- ============================================================
-- Runs: runtime state
-- ============================================================

CREATE TABLE runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow_version_id UUID NOT NULL REFERENCES workflow_versions(id) ON DELETE CASCADE,

  status              run_status NOT NULL DEFAULT 'planning',

  -- Giá trị inputs người dùng cung cấp cho lượt chạy này
  inputs              JSONB NOT NULL DEFAULT '{}',

  -- Chụp lại toàn bộ biến runtime lúc bắt đầu (FR-PLN-08).
  -- Chụp một lần để resume sau crash vẫn dùng đúng mốc thời gian cũ,
  -- không bị nhảy sang tuần khác.
  runtime             JSONB NOT NULL DEFAULT '{}',

  replan_count        SMALLINT NOT NULL DEFAULT 0,
  error_message       TEXT,

  -- Worker đang giữ run này; dùng để phát hiện run mồ côi sau crash
  claimed_by          TEXT,
  claimed_at          TIMESTAMPTZ,
  heartbeat_at        TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ
);

CREATE INDEX runs_user_idx    ON runs (user_id, created_at DESC);
CREATE INDEX runs_version_idx ON runs (workflow_version_id);

-- Truy vấn resume sau khởi động lại (FR-EXE-10): tìm run còn dở
CREATE INDEX runs_active_idx ON runs (status, heartbeat_at)
  WHERE status IN ('running', 'replanning', 'dry_running');

-- ============================================================
-- Trạng thái từng bước
-- ============================================================

CREATE TABLE step_states (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,

  -- Khớp với Step.id trong DSL
  step_id       TEXT NOT NULL,

  status        step_status NOT NULL DEFAULT 'pending',
  side_effect   side_effect_t NOT NULL,

  attempts      SMALLINT NOT NULL DEFAULT 0,

  -- Output cuối cùng, dùng để resolve ${steps.X.output...} cho bước sau
  output        JSONB,

  last_error       TEXT,
  last_error_class error_class,

  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,

  CONSTRAINT step_states_run_step_key UNIQUE (run_id, step_id)
);

CREATE INDEX step_states_run_idx ON step_states (run_id);

-- Lịch sử từng LẦN THỬ — append-only, không bao giờ ghi đè.
-- Đây là nguồn dữ liệu cho màn hình trace (FR-TRC-01).
CREATE TABLE step_attempts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_state_id UUID NOT NULL REFERENCES step_states(id) ON DELETE CASCADE,

  attempt_no    SMALLINT NOT NULL,

  -- Args SAU khi resolve ${...} — quan trọng khi debug
  resolved_args JSONB,
  result        JSONB,

  error_message TEXT,
  error_class   error_class,

  duration_ms   INT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,

  CONSTRAINT step_attempts_no_key UNIQUE (step_state_id, attempt_no)
);

CREATE INDEX step_attempts_state_idx ON step_attempts (step_state_id, attempt_no);

-- ============================================================
-- Idempotency (FR-EXE-06)
-- ============================================================

-- Phạm vi khoá là (user_id, key) — xem DATABASE.md mục "Phạm vi
-- idempotency" để hiểu vì sao không chọn (run_id, key).
CREATE TABLE idempotency_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  key           TEXT NOT NULL,

  run_id        UUID REFERENCES runs(id) ON DELETE SET NULL,
  step_id       TEXT,

  -- Lưu kết quả để lần sau trả về ngay, không cần gọi lại tool
  result        JSONB,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT idempotency_user_key UNIQUE (user_id, key)
);

CREATE INDEX idempotency_run_idx ON idempotency_records (run_id);

-- ============================================================
-- Duyệt dry-run
-- ============================================================

CREATE TABLE approvals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,

  -- Bản preview hiển thị cho người dùng: bước read đã chạy (kèm dữ liệu thật),
  -- bước write kèm args đã resolve
  preview       JSONB NOT NULL,

  -- 'pending' | 'approved' | 'rejected' | 'expired'
  decision      TEXT NOT NULL DEFAULT 'pending',
  decided_at    TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX approvals_run_pending_idx ON approvals (run_id)
  WHERE decision = 'pending';

-- ============================================================
-- Sự kiện — nguồn cho WebSocket và cho việc phát lại
-- ============================================================

CREATE TABLE run_events (
  id         BIGSERIAL PRIMARY KEY,
  run_id     UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,

  -- seq tăng dần trong phạm vi run; client dùng để phát hiện mất gói
  seq        INT  NOT NULL,

  -- 'run.status' | 'step.started' | 'step.attempt' | 'step.succeeded'
  -- | 'step.failed' | 'step.retrying' | 'step.skipped' | 'replan.started' ...
  type       TEXT NOT NULL,
  payload    JSONB NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT run_events_seq_key UNIQUE (run_id, seq)
);

CREATE INDEX run_events_run_idx ON run_events (run_id, seq);

-- ============================================================
-- Số liệu cho thí nghiệm (mục 8.2)
-- ============================================================

-- Mỗi lần gọi LLM sinh kế hoạch — kể cả các vòng sửa lỗi (FR-VAL-09)
CREATE TABLE planning_attempts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,

  attempt_no     SMALLINT NOT NULL,

  -- 'one_shot' | 'incremental'  → phục vụ thí nghiệm 2
  strategy       TEXT NOT NULL,

  -- Tool đưa vào context lần này (id), để đối chiếu với tool thực sự dùng
  candidate_tool_ids UUID[] NOT NULL DEFAULT '{}',

  raw_output     JSONB,
  passed         BOOLEAN NOT NULL,
  -- Lỗi validate theo tầng: {"schema": [...], "tool": [...], "graph": [...]}
  validation_errors JSONB,

  prompt_tokens     INT,
  completion_tokens INT,
  latency_ms        INT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT planning_attempts_no_key UNIQUE (run_id, attempt_no)
);

-- Mỗi lần chạy Tool Retrieval → phục vụ thí nghiệm 1 (Recall@K)
CREATE TABLE retrieval_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID REFERENCES runs(id) ON DELETE CASCADE,

  query_text      TEXT NOT NULL,
  -- Sub-intent sau query expansion
  sub_intents     TEXT[] NOT NULL DEFAULT '{}',

  -- 'none' | 'semantic' | 'semantic_qe' | 'hybrid_qe'
  variant         TEXT NOT NULL,
  top_k           SMALLINT NOT NULL,

  -- Tool trả về, theo thứ tự xếp hạng
  retrieved_tool_ids UUID[] NOT NULL DEFAULT '{}',
  -- Tool đúng (gán nhãn thủ công) — để tính Recall@K
  ground_truth_tool_ids UUID[],

  total_tools_in_registry INT NOT NULL,
  latency_ms      INT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX retrieval_logs_variant_idx ON retrieval_logs (variant, created_at DESC);

-- Bộ test case cố định (mục 8.3) — để chạy lại thí nghiệm nhiều lần
CREATE TABLE test_cases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label           TEXT NOT NULL,
  -- 'simple' | 'medium' | 'complex'
  complexity      TEXT NOT NULL,
  prompt          TEXT NOT NULL,
  -- Kế hoạch chuẩn do người đánh giá viết tay
  expected_plan   JSONB,
  expected_tool_names TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Trigger: tự cập nhật updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mcp_servers_touch
  BEFORE UPDATE ON mcp_servers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
