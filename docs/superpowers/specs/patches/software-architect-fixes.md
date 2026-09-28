## Section 3.1: Sơ đồ hệ thống
```text
┌──────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                  │
│  React 19 + Tailwind + SSE                                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐           │
│  │ Chat UI  │ │ Plan     │ │ Execution│ │ Settings/ │           │
│  │ Messages │ │ Preview  │ │ Progress │ │ Onboarding│           │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘           │
└───────────────────────────┬──────────────────────────────────────┘
                            │ REST + SSE
┌───────────────────────────▼──────────────────────────────────────┐
│                          BACKEND                                  │
│  Node.js + TypeScript                                             │
│                                                                   │
│  ┌────────┐ ┌─────────────────┐ ┌──────────────┐ ┌───────────┐  │
│  │  Auth  │ │ Conversation Mgr│ │  AI Planner  │ │   Plan    │  │
│  │  JWT   │ │ Multi-turn state│ │  LLM + Gather│ │ Validator │  │
│  └────────┘ └─────────────────┘ └──────────────┘ └───────────┘  │
│                                                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────────────┐   │
│  │  Execution   │ │   Approval   │ │     Tool Gateway       │   │
│  │  Engine      │ │   Preview    │ │  ┌───────┐ ┌────────┐  │   │
│  │  Sequential  │ │   Hash+TTL   │ │  │Trello │ │ Slack  │  │   │
│  │  Per-step DB │ │              │ │  │adapter│ │adapter │  │   │
│  └──────────────┘ └──────────────┘ │  └───────┘ └────────┘  │   │
│                                     │(Đợt 1: 11 tools/2 svcs)│   │
│  ┌──────────────────┐               └────────────────────────┘   │
│  │    PostgreSQL     │               ┌────────────────────────┐   │
│  │ 6 tables          │               │      Tool Schemas      │   │
│  │ users,convs,msgs  │               └────────────────────────┘   │
│  │ plans,steps,creds  │                                            │
│  └──────────────────┘                                            │
└──────────────────────────────────────────────────────────────────┘
```

## Section 3.3: Cấu trúc Project
```text
ATI_Project/
├── apps/
│   ├── api/              ← code v2 (giữ nguyên, không maintain)
│   ├── web/              ← code v2
│   ├── chat-api/         ← MỚI: backend v3
│   └── chat-web/         ← MỚI: frontend v3
├── packages/
│   ├── dsl/              ← code v2
│   ├── engine/           ← code v2
│   ├── tool-schemas/     ← MỚI: định nghĩa schema và types cho tools (shared)
│   ├── tool-adapters/    ← MỚI: HTTP clients và SDK adapters (chỉ Executor dùng)
│   ├── planner/          ← MỚI: AI planner
│   └── executor/         ← MỚI: execution engine
├── db/
│   ├── migrations/       ← v2 (0001-0014)
│   └── v3/               ← MỚI: schema v3
├── prompts/              ← MỚI: versioned system prompts
├── evaluations/          ← MỚI: AI evaluation results
└── docker-compose.yml    ← tái dùng, thêm config nếu cần
```

## Section 4.2: Tool Catalog

**Đợt 1 (Phase 1) — 2 services, token-based auth, 11 tools:**

| Service | Auth | Tools |
|---|---|---|
| **Trello** | API key + token | `list_boards`, `list_lists`, `list_members`, `list_cards`, `get_card`, `create_card` (W), `update_card` (W), `add_member` (W), `add_checklist` (W) |
| **Slack** | Bot token | `list_channels`, `send_message` (W) |

Tổng Đợt 1: **6 read + 5 write = 11 tools** trên 2 services.

(W) = write, side effect.

**Đợt 2 (Phase 7) — Mở rộng dịch vụ (PAT/Service Account):**

| Service | Auth | Tools |
|---|---|---|
| **GitHub** | Personal Access Token | `list_repos`, `list_issues`, `get_issue`, `create_issue` (W), `add_label` (W) |
| **Google Sheets** | Service Account | `read_range`, `append_row` (W), `update_cell` (W) |

Tổng Đợt 2: **4 read + 4 write = 8 tools** trên 2 services bổ sung.

**Đợt 3 (Phase 8) — Mở rộng với OAuth2 infrastructure:**

| Service | Auth | Tools |
|---|---|---|
| Gmail | OAuth2 | `send_email` (W, HIGH-RISK) |
| Google Calendar | OAuth2 | `list_events`, `create_event` (W) |
| Notion | Integration token / OAuth2 | `list_databases`, `query_database`, `create_page` (W) |

## Section 5.11: Credential Management

```text
Model: TEAM-SHARED credentials
  • 1 bộ credentials per service cho cả team
  • Encrypted at rest (AES-256, key từ environment variable)
  • Server-side only — không bao giờ trong prompt, plan, preview, log, browser
  • Token expired → adapter fail → step pause → user thông báo fix

**Bảo mật & Phân quyền (Allowed Scope):**
- **Vấn đề Data Leakage:** Do sử dụng Shared Credentials, có rủi ro người dùng yêu cầu AI truy xuất các thông tin nhạy cảm (private channels, private boards) mà họ không có quyền xem.
- **Giải pháp:** Cấu hình **Allowed Scope** trong Cài đặt. Quản trị viên phải định nghĩa rõ whitelist các boards, channels, hoặc repos mà token được phép truy cập. Các requests nằm ngoài scope này sẽ bị chặn ở mức Adapter.
- Giới hạn MVP: Không có per-user OAuth. Mọi action trên external service thực hiện dưới tên token owner. Trace user trong `execution_steps.requested_by`. Rủi ro lộ dữ liệu nội bộ phải được thông báo rõ cho admin khi thiết lập.
```

## Section 5.12: Rate Limiting per Adapter

Mỗi adapter built-in rate limiter theo spec service:
- Trello: 100 req / 10s
- Slack: ~1 req/s cho chat.postMessage
- GitHub: 5000 req / hour
- Google APIs: varies

**Global Rate Limiter:** Do sử dụng Shared Credentials, khi nhiều user đồng thời sử dụng hệ thống, cần cấu hình một global queue hoặc global rate limiter cho mỗi service thay vì per-instance để tránh đụng trần giới hạn API của nhà cung cấp.

Throttle → wait + retry (read) hoặc wait + retry 1x (write).

## Section 9.2: Chi tiết từng Phase

**Phase 0: Foundation**
- Tái dùng infrastructure (monorepo, Docker, build tools)
- Tạo workspace mới (chat-api, chat-web, packages mới)
- Auth module (users, login, JWT middleware)
- Health check endpoint
- **Setup test accounts** (Trello board test, Slack workspace test) — blocker cho Phase 1
- Demo: `curl /api/auth/login` → JWT

**Phase 1: Tool Catalog & Adapters (Đợt 1)**
- Tool registry (static config, schema definitions trong `tool-schemas`)
- Adapter interface chuẩn hóa (trong `tool-adapters`)
- **2 adapters:** Trello (9 tools), Slack (2 tools)
- Rate limiter per adapter + Global rate limiter
- Connection test endpoint
- Credential storage (encrypted, có Allowed Scope)
- Unit tests cho mỗi adapter (mock API)
- Demo: `curl` → tạo card thật + gửi Slack thật

**Phase 2: Data & AI Planner ⭐ (CRITICAL)**
*Phase 2a: DB Foundation (Chuyển từ Phase 4 lên)*
- PostgreSQL schema v3 (6 tables, 1 migration)
- Database repositories cho users, conversations, messages, plans, execution_steps, service_credentials
- Context management (lưu và lấy history/summary từ DB)

*Phase 2b: AI Planner Core*
- LLM provider abstraction (Gemini adapter)
- System prompt v1
- Gather phase (function calling read tools)
- Plan generation (structured output)
- 3-layer validation
- Clarification + Refusal flows
- Name resolution
- Retry 1x nếu plan invalid
- Prompt versioning
- Evaluation framework: 50 test prompts
- Demo (CLI): gõ NL → sinh plan nhiều bước → validate pass

**Phase 2 Gate:**
- ✅ PASS: usable plan rate ≥ 70%, tool accuracy ≥ 85% → tiếp Phase 3
- ⚠️ MARGINAL: 60-70% → thêm sprint cải thiện prompt
- ❌ FAIL: < 60% → giảm catalog, đơn giản hóa format, tăng examples

**Phase 3: Execution Engine**
- Sequential executor (theo depends_on)
- Reference resolution runtime ($ref, $template)
- Error classification (6 categories)
- Partial failure handling (pause + 4 user options)
- Write safety (UNKNOWN status, no auto retry writes)
- Per-step state persistence (crash recovery)
- Intent dedup
- Overall timeout (3 phút)
- Integration tests (mock adapters + real DB)
- Demo (CLI): chạy plan → tạo resources thật → report

**Phase 4: Chat API + SSE**
- Conversation CRUD + per-user isolation
- Message endpoint (POST → 202, async processing)
- SSE stream endpoint (12 event types)
- Plan approval/rejection
- Execution control (start/retry/skip/stop)
- Context management (summarize >10 messages)
- Execution state injection vào LLM context
- Sửa plan bằng chat
- Service management endpoints
- Demo: Postman full flow → SSE stream → kết quả thật

**Phase 5: Chat UI**
- Login page
- Chat layout (sidebar + chat area)
- 7 message components
- Plan Preview (interactive + approve/edit/cancel)
- Execution Progress (live per-step)
- Partial Failure (retry/fix/skip/stop)
- SSE hook (auto-reconnect, sync)
- Optimistic updates
- Settings page + connection wizard (kèm UI cấu hình Allowed Scope)
- Onboarding page
- Empty state (dynamic suggestion chips)
- Responsive (desktop + mobile)
- Progressive loading (thinking → gather → stream)
- Demo: **FULL END-TO-END** trong browser

**Phase 6: Polish, Evaluation & Documentation**
- 3 demo scenarios end-to-end:
  - Quản lý dự án (Trello + Slack)
  - Sprint Planning (Trello + Slack)
  - Workflow Automation (Trello + Slack)
- Final evaluation report (50 prompts, versioned)
- Error handling demos
- Performance metrics
- README + API docs + architecture docs

**Phase 7 (OPTIONAL): Đợt 2 Adapters**
- GitHub adapter (5 tools)
- Google Sheets adapter (3 tools)
- Integration vào planner và execution flow

**Phase 8 (OPTIONAL): Đợt 3 Adapters (OAuth2)**
- OAuth2 infrastructure (consent screen, token refresh)
- Gmail adapter (HIGH-RISK, extra confirmation UX)
- Calendar adapter
- Notion adapter
- Cần Phase 1-6 hoàn thành tốt trước
