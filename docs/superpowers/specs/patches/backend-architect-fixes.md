## Section 5.2: Step Execution

```typescript
interface ExecutionStep {
  id: string;
  tool: string;
  args: ResolvedArgs;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped" | "unknown";
  output: unknown | null;
  error: StepError | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}
```

Luồng chạy mỗi step:
1. Resolve references ($ref, $template) từ output steps trước
2. Validate resolved args khớp inputSchema
3. Call tool adapter (inject credentials, timeout: 15s read / 30s write). Cần gắn structured logging / request ID (trace context) để theo dõi logs trên hệ thống.
4. Validate response (linh hoạt, chấp nhận extra fields)
5. Persist step result vào DB. **ACID Transaction:** Wrap việc update step status (`execution_steps`) và plan status (`plans`) bên trong một database transaction duy nhất để đảm bảo integrity, tránh data anomaly khi crash.
6. Stream status cho UI realtime
7. Next step hoặc pause nếu failed

## Section 5.7: Plan Approval

```typescript
interface PlanApproval {
  planId: string;
  planHash: string;      // SHA-256, verify trước execution
  decision: "pending" | "approved" | "rejected" | "expired";
  expiresAt: string;     // 30 phút từ lúc tạo preview
}
```

Quy tắc:
- Plan hash bất biến — dùng thư viện `json-stable-stringify` (để canonical key order) khi serialize JSON để băm, HOẶC lưu raw string gốc trả về từ LLM vào một trường `plan_text TEXT` rồi thực hiện hash trên chuỗi này. Phải verify `sha256(data) === plan_hash` trước khi execution.
- Hết hạn 30 phút → plan expired → user tạo plan mới
- Mỗi conversation chỉ 1 plan pending tại 1 thời điểm
- "Sửa" = user chat feedback → AI sinh plan MỚI → approve plan mới

## Section 5.11: Credential Management

```
Model: TEAM-SHARED credentials
  • 1 bộ credentials per service cho cả team
  • Encrypted at rest (AES-256-GCM, key từ environment variable): Sử dụng authenticated encryption. Dữ liệu lưu sẽ tuân theo format versioned bao gồm IV và Auth Tag: `v1:base64(iv):base64(auth_tag):base64(ciphertext)`
  • Server-side only — không bao giờ trong prompt, plan, preview, log, browser
  • Token expired → adapter fail → step pause → user thông báo fix

Giới hạn MVP: không có per-user OAuth. Mọi action trên external service
thực hiện dưới tên token owner. Trace user trong execution_steps.requested_by.
```

## Section 7: Database Schema

6 bảng (Sử dụng PostgreSQL, thiết lập Database Connection Pooling để tối ưu resource):

```sql
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,              -- bcrypt hash
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  status      TEXT NOT NULL DEFAULT 'chatting',
                -- chatting | executing | completed | canceled
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conv_id     UUID NOT NULL REFERENCES conversations(id),
  role        TEXT NOT NULL,              -- user | assistant | system | summary
  content     TEXT NOT NULL,
  metadata    JSONB,                      -- { type: "gather", tool, output } etc.
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conv_id     UUID NOT NULL REFERENCES conversations(id),
  plan_json   JSONB NOT NULL,             -- toàn bộ plan steps
  plan_text   TEXT,                       -- raw string từ LLM để phục vụ plan_hash
  plan_hash   TEXT NOT NULL,              -- SHA-256, verify trước execution
  status      TEXT NOT NULL DEFAULT 'pending',
                -- pending | approved | rejected | expired
                -- | executing | completed | partial | failed
  expires_at  TIMESTAMPTZ NOT NULL,       -- 30 phút
  decided_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE execution_steps (
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

CREATE TABLE service_credentials (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service     TEXT NOT NULL,              -- "trello", "slack", "github", "sheets"
  user_id     UUID REFERENCES users(id), -- NULL = shared
  config      TEXT NOT NULL,             -- encrypted string: v1:iv:tag:ciphertext
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_messages_conv_id ON messages(conv_id);
CREATE INDEX idx_plans_conv_id ON plans(conv_id);
CREATE INDEX idx_execution_steps_plan_id ON execution_steps(plan_id);
```

## Section 8.1: Authentication

```
POST   /api/auth/login     → { access_token: "jwt...", refresh_token: "..." }
POST   /api/auth/refresh   → { access_token: "jwt..." }
GET    /api/auth/me         → { user }
```

Admin tạo tài khoản qua CLI/seed script. Không có đăng ký tự do.
- JWT Access Token cần cấu hình TTL (expiration) ngắn để đảm bảo bảo mật.
- Kết hợp Refresh token strategy, hỗ trợ thu hồi (revocation) khi cần.

## Section 8.3: Messages & Streaming

```
POST   /api/conversations/:id/messages     → 202 Accepted { messageId }
GET    /api/conversations/:id/stream       → SSE (luôn mở, per-conversation)
```

SSE tách khỏi POST. POST trả về ngay. Yêu cầu cho luồng SSE:
- **Enforce SSE-first protocol**: Client BẮT BUỘC phải kết nối SSE mở thành công TRƯỚC khi gọi POST `/messages` để không mất các event đầu tiên.
- **Reliability & Reconnect**: Mỗi event trả về đính kèm một `sequence_id` (vào field `id`). Khi bị ngắt và reconnect, client gửi `Last-Event-ID` header; server kiểm tra và push bù các events bị lỡ.
- **Memory Leak Protection**: Handler cần lắng nghe `req.on('close')` để dọn dẹp các resources, event listeners và hỗ trợ graceful shutdown.

SSE nhận events:

```
event: thinking
event: gather_start
event: gather_step      data: { tool, status, output? }
event: gather_done
event: text_start
event: text_delta       data: { delta: "..." }
event: text_end
event: plan             data: { plan }
event: clarification    data: { question, options?, context }
event: refusal          data: { reason, suggestion? }
event: exec_start
event: exec_step        data: { stepId, status, output?, error? }
event: exec_done        data: { summary }
event: error            data: { message }
event: sync             data: { full state } (sau reconnect)
```

## Section 8.4: Plans & Execution

```
POST   /api/plans/:id/approve                        → Duyệt
POST   /api/plans/:id/reject                          → Từ chối
POST   /api/executions/:planId/start                  → Bắt đầu execution
POST   /api/executions/:planId/steps/:stepId/retry    → Retry step
POST   /api/executions/:planId/steps/:stepId/skip     → Skip step
POST   /api/executions/:planId/stop                   → Dừng execution
```

**Ngăn chặn Race Condition (Double-click execution):**
- Sử dụng Optimistic Locking trong DB trên các hành động thay đổi state (ví dụ: `UPDATE plans SET status = 'approved', decided_at = now() WHERE id = $1 AND status = 'pending' RETURNING id;`). Nếu kết quả query trả về 0 rows, server từ chối request ngay lập tức, ngăn ngừa lỗi approve và execute chạy lặp 2 lần do client gửi trùng lặp.
