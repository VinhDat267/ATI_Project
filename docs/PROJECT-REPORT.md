# AI Workflow Automation Platform — Project Technical Report

**Đề tài:** Đề tài 26 — AI Workflow Automation Platform  
**Môn học:** Advanced Technology Integration (ATI)  
**Ngày lập:** 29/09/2026  
**Phiên bản:** v3 (viết lại từ v2)  
**Trạng thái kỹ thuật (29/09/2026):** Nhánh hiện tại đạt 199/199 bài test v3 cục bộ, typecheck, build và smoke test launcher; chưa chứng nhận production readiness vì kiểm thử live LLM/Trello/Slack và khôi phục sau crash chưa chạy. [Kết quả khắc phục trước đó](audits/2026-09-29-v3-review/REMEDIATION-RESULTS.md) ghi mốc 198/198.

---

## Mục lục

1. [Tóm tắt Dự án](#1-tóm-tắt-dự-án)
2. [Bối cảnh & Động lực](#2-bối-cảnh--động-lực)
3. [Nguyên tắc Thiết kế](#3-nguyên-tắc-thiết-kế)
4. [Kiến trúc Hệ thống](#4-kiến-trúc-hệ-thống)
5. [AI Planner & Tool Catalog](#5-ai-planner--tool-catalog)
6. [Execution Engine & Cơ chế An toàn](#6-execution-engine--cơ-chế-an-toàn)
7. [Chat UI & Trải nghiệm Người dùng](#7-chat-ui--trải-nghiệm-người-dùng)
8. [Database & API Design](#8-database--api-design)
9. [Tiến độ Triển khai](#9-tiến-độ-triển-khai)
10. [Roadmap & Công việc Tiếp theo](#10-roadmap--công-việc-tiếp-theo)
11. [Tài liệu Tham chiếu](#11-tài-liệu-tham-chiếu)

---

## 1. Tóm tắt Dự án

**AI Workflow Automation Platform** là một hệ thống cho phép người dùng **mô tả công việc bằng ngôn ngữ tự nhiên** (tiếng Việt hoặc tiếng Anh) trong giao diện chat, sau đó AI sẽ **tự động hiểu ý định, chọn công cụ phù hợp, sinh kế hoạch nhiều bước**, và **thực thi workflow trên nhiều dịch vụ bên ngoài** (Trello, Slack, v.v.) — tất cả chỉ từ một câu chat duy nhất.

### Ví dụ minh họa

```
Người dùng gõ:
  "Tạo task cập nhật homepage cho team frontend,
   deadline thứ 6, gán Minh, báo trên Slack"

Hệ thống tự động:
  1. Tìm board "Frontend" và member "Minh" trên Trello
  2. Sinh plan 4 bước:
     step 1: trello.create_card (tạo card)
     step 2: trello.add_member  (gán Minh)
     step 3: trello.add_checklist (thêm checklist)
     step 4: slack.send_message (thông báo #frontend)
  3. Hiển thị preview → Người dùng duyệt → Thực thi
  4. Trả link card Trello + xác nhận Slack đã gửi
```

**Giá trị cốt lõi:** 1 câu chat thay thế 4–5 thao tác thủ công trên 2+ hệ thống khác nhau.

### Công nghệ chính

| Thành phần | Công nghệ |
|---|---|
| Backend | Node.js, TypeScript 5.6+, Express 5 |
| Frontend | React 19, Vite, Tailwind CSS, Zustand |
| AI/LLM | Gemini Provider qua `@google/genai`; mã nguồn mặc định `gemini-3.8-flash` nếu không đặt `GEMINI_MODEL` (chưa kiểm thử live) |
| Database | PostgreSQL (pg pool) |
| Streaming | Server-Sent Events (SSE) |
| Testing | Vitest; 199 tests v3 cục bộ và 1 smoke test launcher trên nhánh hiện tại; chưa kiểm thử live provider |
| Monorepo | npm workspaces, 6 packages v3 |

---

## 2. Bối cảnh & Động lực

### 2.1. Vấn đề của Hệ thống v2

Phiên bản v2 mang tên "AI Automation Workflow Platform" nhưng giá trị nghiệp vụ không xứng với tên gọi:

| Từ khóa | Kỳ vọng | Thực tế v2 |
|---|---|---|
| **AI** | Hiểu ngôn ngữ tự nhiên, chọn tool, lập kế hoạch thông minh | Chọn 1/3 branch cố định, 1 write tool duy nhất |
| **Automation** | Giảm đáng kể thao tác thủ công | 8 bước tương tác cho 1 card Trello |
| **Workflow** | Quy trình nhiều bước, phân nhánh, điều kiện | 1 bước duy nhất |
| **Platform** | Mở rộng được, nhiều tích hợp | Khóa cứng 1 Sheet + 1 Board, 2 user |

**Ba vấn đề cốt lõi:**

1. **Nghiệp vụ quá đơn giản** — tạo 1 Trello card, ít hơn cả 1 Zapier Zap miễn phí.
2. **Luồng vô nghĩa** — user ghi thẳng Trello nhanh hơn, không cần hệ thống trung gian.
3. **AI làm ngược** — bắt user cấu trúc hóa dữ liệu vào Google Sheet, AI chỉ kiểm bài chính tả.

### 2.2. Mục tiêu v3

Xây lại hoàn toàn application code, giữ project infrastructure (monorepo, Docker, build tools, test framework):

- User **chat bằng ngôn ngữ tự nhiên**, không điền form/sheet.
- AI **hiểu ý định, tự chọn tools, sinh plan nhiều bước**, không hardcode.
- Hệ thống **thực thi workflow trên nhiều dịch vụ** (Trello, Slack, mở rộng GitHub, Sheets).
- Giá trị rõ ràng: **1 câu chat thay 4–5 thao tác thủ công trên 2+ hệ thống**.

### 2.3. So sánh v2 → v3

| Khía cạnh | v2 | v3 |
|---|---|---|
| Đầu vào | Google Sheet có cột cố định | Chat ngôn ngữ tự nhiên |
| AI capability | 1/3 branch cố định, 1 tool | Chọn từ 11+ tools, sinh multi-step plan |
| Workflow | 1 bước | 1–10 bước trên nhiều dịch vụ |
| Services | 1 Sheet + 1 Trello | 2+ services (mở rộng qua phases) |
| AI Architecture | Flat 1-call | LLM Router → Planner → Working Memory |
| Giá trị | Âm (chậm hơn trực tiếp) | Dương (1 câu = 4–5 thao tác thủ công) |
| Xứng tên "AI Workflow Automation Platform" | Không | **Có** |

---

## 3. Nguyên tắc Thiết kế

Sáu nguyên tắc dẫn dắt mọi quyết định kỹ thuật trong v3:

1. **AI phải làm việc CỦA AI** — nhận đầu vào phi cấu trúc (ngôn ngữ tự nhiên), chuyển thành hành động có cấu trúc. Không bắt user cấu trúc hóa trước.

2. **Giá trị tỷ lệ với độ phức tạp workflow** — single-step ít giá trị, multi-step cross-service mới có giá trị thật.

3. **An toàn tỷ lệ với rủi ro** — không đồng đều cho mọi action. Read tự do, write low-risk duyệt 1 lần, write high-risk xác nhận riêng.

4. **Plan-then-Execute** — AI sinh toàn bộ plan trước, user duyệt, rồi mới chạy. Không dùng ReAct-style step-by-step (khó preview, khó kiểm soát).

5. **Mỗi phase có deliverable demoable** — không build 3 tuần rồi mới thấy kết quả.

6. **Adapter pattern** — thêm service mới = thêm 1 file adapter, không đổi core.

---

## 4. Kiến trúc Hệ thống

### 4.1. Sơ đồ Tổng thể

```
┌──────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                │
│  React 19 + Tailwind + SSE                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐          │
│  │ Chat UI  │ │ Plan     │ │ Execution│ │ Settings/ │          │
│  │ Messages │ │ Preview  │ │ Progress │ │ Onboarding│          │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘          │
└───────────────────────────┬──────────────────────────────────────┘
                            │ REST + SSE
┌───────────────────────────▼──────────────────────────────────────┐
│                          BACKEND                                │
│  Node.js + TypeScript                                           │
│                                                                 │
│  ┌────────┐ ┌─────────────────┐ ┌──────────────┐ ┌───────────┐│
│  │  Auth  │ │ Conversation Mgr│ │  AI Planner  │ │   Plan    ││
│  │  JWT   │ │ Working Memory  │ │  Router+LLM  │ │ Validator ││
│  └────────┘ └─────────────────┘ └──────────────┘ └───────────┘│
│                                                                 │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────────────┐  │
│  │  Execution   │ │   Approval   │ │     Tool Gateway       │  │
│  │  Engine      │ │   Preview    │ │  ┌───────┐ ┌────────┐  │  │
│  │  Sequential  │ │   Hash+TTL   │ │  │Trello │ │ Slack  │  │  │
│  │  Per-step DB │ │              │ │  │adapter│ │adapter │  │  │
│  └──────────────┘ └──────────────┘ │  └───────┘ └────────┘  │  │
│                                    │ (Đợt 1: 11 tools/2 svcs)│  │
│  ┌──────────────────┐              └────────────────────────┘  │
│  │    PostgreSQL     │              ┌────────────────────────┐  │
│  │ 6 tables          │              │   Tool Schemas (shared)│  │
│  │ users,convs,msgs  │              └────────────────────────┘  │
│  │ plans,steps,creds │                                          │
│  └──────────────────┘                                          │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2. Luồng xử lý chính

```
1. USER CHAT          → Người dùng gõ yêu cầu bằng ngôn ngữ tự nhiên
2. AI GATHER/CLARIFY  → AI tìm kiếm context (boards, members), hỏi nếu cần làm rõ
3. AI PLAN            → AI sinh plan nhiều bước (structured JSON) trong 1 LLM call
4. VALIDATION         → 4 lớp kiểm tra: JSON → Schema → Semantic → Security
5. PREVIEW            → Hiển thị từng bước cho user duyệt: [Duyệt] [Sửa] [Hủy]
6. USER APPROVAL      → Plan hash SHA-256, TTL 30 phút, optimistic locking
7. EXECUTION          → Chạy tuần tự, per-step state, stream progress realtime
8. RESULT             → Summary + links tới resources đã tạo
```

### 4.3. Cấu trúc Project (Monorepo)

```
ATI_Project/
├── apps/
│   ├── api/              ← v2 (read-only archive)
│   ├── web/              ← v2 (read-only archive)
│   ├── chat-api/         ← v3 Backend: Express + JWT + SSE
│   └── chat-web/         ← v3 Frontend: React 19 + Tailwind (Phase 5)
├── packages/
│   ├── dsl/              ← v2 (read-only archive)
│   ├── engine/           ← v2 (read-only archive)
│   ├── tool-schemas/     ← v3: Schema & types cho 11 tools (shared)
│   ├── tool-adapters/    ← v3: HTTP clients & SDK adapters
│   ├── planner/          ← v3: AI planner (LLM Router, Validator, Memory)
│   └── executor/         ← v3: Execution engine (Runner, Resolver, Controller)
├── db/
│   ├── migrations/       ← v2 (0001–0014)
│   └── v3/               ← v3 schema (6 tables)
├── evaluations/          ← AI evaluation framework (50 golden prompts)
└── docs/
    ├── PROJECT-REPORT.md ← Document này
    ├── team-workflow.md  ← Quy trình team & Git strategy
    └── superpowers/
        ├── specs/        ← Design spec v3 (1029 dòng, 12 sections)
        └── plans/        ← Implementation plan (28 tasks TDD)
```

### 4.4. Ranh giới — Ngoài Phạm vi

| Không làm | Lý do |
|---|---|
| Trigger tự động / scheduler | User chủ động chat |
| Visual workflow editor | AI sinh plan, không kéo thả |
| Multi-agent phức tạp | Chỉ dùng LLM Router + Planner |
| Real-time collaboration | 1 user, 1 conversation tại 1 thời điểm |
| Runtime dynamic loops | Chỉ xử lý Static DAG |
| Sửa code v2 | Giữ nguyên làm lịch sử tham chiếu |

---

## 5. AI Planner & Tool Catalog

### 5.1. Kiến trúc 2 chế độ (State Machine)

Hệ thống AI tách rõ thành 2 chế độ hoạt động:

**CHAT MODE (Gather & Clarify — multi-turn):**
- LLM hoạt động như chatbot có function calling (chỉ `search_*` tools).
- Thu thập IDs, hỏi user nếu cần làm rõ (Clarification).
- Kết quả lưu vào **Working Memory** (JSON object) và messages.
- Skip nếu user đã cung cấp đủ thông tin.

**PLAN MODE (Structured Output — 1-shot):**
- Khi đã gom đủ context → chốt, chuyển sang Plan Mode.
- **Hierarchical Planning:** LLM Router phân loại intent → xác định subset services cần dùng → giảm tải context window.
- LLM dùng **Thinking Layer** — viết reasoning trước khi output JSON plan.
- Sinh toàn bộ plan trong 1 LLM call.

**Tại sao tách:** Gather cần multi-turn (hỏi/trả lời linh hoạt). Plan cần 1-shot (toàn bộ plan để preview). Trộn 2 cái vào 1 flow tạo state machine bất định, rất khó debug.

### 5.2. Tool Catalog (Đợt 1)

**2 services, 11 tools, token-based auth:**

| Service | Auth | Tools |
|---|---|---|
| **Trello** | API key + token | `search_boards`, `search_lists`, `search_members`, `search_cards`, `get_card`, `create_card` (W), `update_card` (W), `add_member` (W), `add_checklist` (W) |
| **Slack** | Bot token | `search_channels`, `send_message` (W) |

- **(W)** = write, side effect.
- Read tools bắt buộc nhận `query` + `limit` (max 10) để tránh tràn LLM context.
- Mỗi tool định nghĩa qua `ToolDefinition` interface với `inputSchema`, `outputSchema`, `riskLevel`.

### 5.3. Plan Format

```typescript
type PlannerResponse =
  | PlanResponse          // AI sinh plan nhiều bước
  | ClarificationResponse // AI cần hỏi thêm
  | RefusalResponse;      // AI từ chối (không hỗ trợ)

interface PlanStep {
  id: string;              // "step_1"
  tool: string;            // "trello.create_card"
  description: string;     // "Tạo card Cập nhật homepage trên list To Do"
  args: Record<string, ArgValue>;
  dependsOn: string[];     // ["step_1"] — khai báo dependency
}

// Tham chiếu cross-step:
type ArgValue =
  | string | number | boolean         // literal
  | { $ref: string }                  // "step_1.output.id"
  | { $template: string };            // "Task mới: ${step_1.output.url}"
```

### 5.4. Validation Pipeline (4 lớp)

```
LLM output
  → Lớp 1: JSON parse (reject nếu invalid JSON)
  → Lớp 2: Schema validate (reject nếu thiếu/sai field type)
  → Lớp 3: Semantic validate:
      • Tool tồn tại trong catalog?
      • Args khớp tool inputSchema?
      • $ref trỏ đến step đã khai báo + field trong outputSchema?
      • DAG acyclic? (dependsOn không vòng lặp)
      • Tối đa 10 steps?
  → Lớp 4: Security validate (chặn prompt injection)
  → Fail → retry 1 lần với error message
  → Retry cũng fail → báo lỗi user, KHÔNG chạy plan sai
```

### 5.5. Name Resolution

AI resolve tên gọi thành ID thật qua `search_*` tools trong CHAT MODE:

| Case | Xử lý |
|---|---|
| Exact match (1 kết quả) | Dùng luôn, lưu vào Working Memory |
| Ambiguous (nhiều kết quả) | AI hỏi clarification |
| No match | AI hỏi: "Không tìm thấy X. Có: A, B. Chọn ai?" |

### 5.6. Provider Abstraction

```typescript
interface LLMProvider {
  generatePlan(input: {
    systemPrompt: string;
    conversationHistory: Message[];
    toolCatalog: ToolDefinition[];
    workingMemory: Record<string, any>;
    signal: AbortSignal;
  }): AsyncIterable<string>;  // streaming response
}

class GeminiProvider implements LLMProvider { ... }
```

Bắt buộc dùng **1 model duy nhất** cho dev, eval, và production để tránh prompt overfit khi đổi model.

### 5.7. Evaluation Framework

- **50 golden prompts** phủ 5 danh mục: single-step, multi-step, cross-service, clarification, refusal.
- Đánh giá tự động: tool selection accuracy, argument quality, validation pass rate.
- **Quality Gate:** Usable plan rate ≥ 70%, tool accuracy ≥ 85%.

---

## 6. Execution Engine & Cơ chế An toàn

### 6.1. Execution Lifecycle

```
CHATTING → PLANNING → VALIDATING → PREVIEWING
                                       │
                                  [User chọn]
                              ┌────────┼────────┐
                              ▼        ▼        ▼
                          [Duyệt]   [Sửa]    [Hủy]
                             │        │         │
                             ▼        │         ▼
                        EXECUTING     │     CANCELED
                             │        │
                  ┌──────────┼────────┘
                  ▼          ▼
             COMPLETED    PARTIAL     FAILED
              (all ✅)    (some ✅)   (step1 ❌)
```

### 6.2. Step Execution Flow

Mỗi step được xử lý tuần tự:

1. **Resolve references** — `$ref` và `$template` từ output steps trước.
2. **Validate resolved args** — khớp inputSchema.
3. **Call tool adapter** — inject credentials, timeout: 15s read / 30s write, `AbortSignal`.
4. **Persist step result** — ACID transaction (step result + plan status trong 1 DB transaction).
5. **Stream status** — SSE realtime cho UI.
6. **Next step** hoặc **pause** nếu failed.

### 6.3. Write Safety — Nguyên tắc UNKNOWN

Write gọi external API → side effect bên ngoài hệ thống → **không rollback được**.

| Tình huống | Response | Hành động |
|---|---|---|
| Thành công rõ | 2xx + valid body | Mark **SUCCEEDED** |
| Thất bại rõ | 4xx (client error) | Mark **FAILED**, không retry |
| Server error | 5xx | Mark **UNKNOWN**, không auto retry |
| Timeout | Không response | Mark **UNKNOWN**, không auto retry |
| Rate limit | 429 | Wait theo Retry-After, retry **1 lần** |

**UNKNOWN** hiển thị cho user với options kiểm tra thủ công — đảm bảo hệ thống không bao giờ tạo duplicate bằng cách auto retry write operations mà không biết kết quả.

### 6.4. Partial Failure Handling

```
step1: trello.create_card  → ✅ (card đã tạo, KHÔNG undo được)
step2: trello.add_member   → ❌ (member not found)
step3-4: ⏸ chưa chạy

User thấy 4 options:
  [🔄 Thử lại]      — chạy lại đúng lệnh cũ (lỗi mạng/tạm)
  [✏️ Sửa & thử lại] — chat để sửa args → chạy lại step này
  [⏭ Bỏ qua]        — skip step, tiếp bước sau
  [⏹ Dừng]           — dừng toàn bộ, giữ kết quả đã có
```

### 6.5. Credential Management

```
Model: TEAM-SHARED credentials
  • 1 bộ credentials per service cho cả team
  • Encrypted at rest: AES-256-GCM (authenticated encryption)
    Format: v1:base64(iv):base64(auth_tag):base64(ciphertext)
  • Server-side only — không bao giờ trong prompt, plan, preview, log, browser
  • Allowed Scope: Admin cấu hình whitelist boards, channels, repos
    → Requests ngoài scope bị chặn ở mức Adapter
```

### 6.6. Rate Limiting

Mỗi adapter có built-in rate limiter + **Global Rate Limiter** (shared credentials → global queue per service):

| Service | Rate Limit |
|---|---|
| Trello | 100 req / 10s |
| Slack | ~1 req/s cho `chat.postMessage` |

---

## 7. Chat UI & Trải nghiệm Người dùng

### 7.1. Layout

```
┌──────────────────────────────────────────────────────────┐
│  🔷 AI Workflow Platform          [⚙️ Settings] [+ New] │
├────────────┬─────────────────────────────────────────────┤
│            │                                             │
│ 📝 History │          CHAT AREA                          │
│ (sidebar)  │  Messages + Interactive Cards               │
│            │  + Execution Progress                       │
│ Grouped    │                                             │
│ by date    │                                             │
│            ├─────────────────────────────────────────────┤
│            │ 💬 Mô tả công việc...              [Gửi ➤] │
└────────────┴─────────────────────────────────────────────┘

Desktop: sidebar + chat side-by-side
Mobile: sidebar ẩn, hamburger menu, chat full width
```

### 7.2. 7 Loại Message trong Chat

1. **User Message** — text thuần
2. **AI Text** — markdown rendered, streaming từng chữ
3. **Gather Progress** — collapsible, hiện search tool đang gọi + kết quả
4. **Clarification** — câu hỏi + option buttons hoặc open-ended
5. **Plan Preview** — interactive card: từng step + [Duyệt][Sửa][Hủy]
6. **Execution Progress** — live update per-step: ✅ ⏳ ⏸ ❌
7. **Execution Result / Partial Failure** — summary + links + action buttons

### 7.3. SSE Streaming (12 Event Types)

```
event: thinking          (AI đang suy nghĩ)
event: gather_start      (bắt đầu tìm kiếm context)
event: gather_step       (kết quả mỗi search tool)
event: gather_done       (tìm kiếm xong)
event: text_start        (AI bắt đầu stream text)
event: text_delta        (từng đoạn text)
event: text_end          (text xong)
event: plan              (plan đã sinh)
event: clarification     (AI hỏi clarification)
event: exec_start        (bắt đầu thực thi)
event: exec_step         (kết quả mỗi step)
event: exec_done         (thực thi xong)
```

### 7.4. Tech Stack Frontend

| Lựa chọn | Lý do |
|---|---|
| React 19 | Ecosystem lớn, project cũ đã dùng |
| Vite | Build nhanh, dev experience tốt |
| Tailwind CSS | Utility-first, prototype nhanh |
| Zustand | State management nhẹ, đủ cho chat app |
| SSE (EventSource) | Đủ cho server→client streaming, đơn giản hơn WebSocket |

---

## 8. Database & API Design

### 8.1. Database Schema (6 bảng PostgreSQL)

```sql
-- Người dùng hệ thống
users (id, email, password, name, created_at)

-- Cuộc hội thoại
conversations (id, user_id, status, created_at, updated_at)
  -- status: chatting | executing | completed | canceled

-- Tin nhắn trong hội thoại
messages (id, conv_id, role, content, metadata, created_at)
  -- role: user | assistant | system | summary

-- Kế hoạch AI sinh ra
plans (id, conv_id, plan_json, plan_hash, status, expires_at, created_at)
  -- status: pending | approved | rejected | expired | executing | completed | partial | failed
  -- plan_hash: SHA-256 deterministic, verify trước execution

-- Từng bước thực thi
execution_steps (id, plan_id, step_id, tool, args_json, status, output_json, error_json, ...)
  -- status: pending | running | succeeded | failed | skipped | unknown

-- Credentials dịch vụ bên ngoài (mã hóa AES-256-GCM)
service_credentials (id, service, user_id, config, created_at)
```

### 8.2. API Endpoints

**Authentication:**
```
POST   /api/auth/login     → JWT access + refresh tokens
POST   /api/auth/refresh   → Refresh access token
GET    /api/auth/me         → User info (protected)
```

**Conversations & Messages:**
```
POST   /api/conversations                → Tạo conversation mới (protected)
GET    /api/conversations                → List conversations (protected)
GET    /api/conversations/:id            → Chi tiết + messages (protected)
POST   /api/conversations/:id/messages   → 202 Accepted (async) (protected)
GET    /api/conversations/:id/stream     → SSE stream (protected, ?token= supported)
```

**Plans & Execution:**
```
POST   /api/plans/:id/approve                      → Duyệt plan (optimistic lock)
POST   /api/executions/:planId/steps/:stepId/retry  → Retry step
POST   /api/executions/:planId/steps/:stepId/skip   → Skip step
POST   /api/executions/:planId/stop                 → Dừng execution
```

### 8.3. Concurrency Protection

- **Optimistic Locking** trên plan approval: `WHERE id = $1 AND status = 'pending'` → tránh double-approve.
- **ACID Transaction** mỗi step: persist result + update plan status trong 1 transaction.
- **SSE sequence_id + Last-Event-ID** → reconnect không mất events.

---

## 9. Tiến độ Triển khai

> Các bảng Phase và con số 117 tests bên dưới là ảnh chụp lịch sử của báo cáo nghiệm thu trước đợt rà soát lại. Chúng không chứng minh trạng thái production hiện tại. Kết quả kiểm chứng mới và các giới hạn được ghi trong [REMEDIATION-RESULTS.md](audits/2026-09-29-v3-review/REMEDIATION-RESULTS.md).

### 9.1. Tổng quan

**Tiến độ:** 20 / 28 tasks hoàn thành **(71.4%)**  
**Tests:** 89 / 89 passed **(100%)**  
**Commit cuối:** `3e18cea` — `fix(api): harden auth guards, sse query token auth, and e2e integration test`

### 9.2. Kết quả theo Phase

| Phase | Mô tả | Tasks | Trạng thái | Tests |
|---|---|---|---|---|
| **Phase 0** | Foundation & Environment | 1/1 | ✅ Hoàn thành | 1 |
| **Phase 1** | Tool Schemas & Adapters | 5/5 | ✅ Hoàn thành | 27 |
| **Phase 2a** | Database Foundation | 2/2 | ✅ Hoàn thành | 10 |
| **Phase 2b** | AI Planner Core ⭐ | 4/4 | ✅ Hoàn thành | 15 |
| **Phase 3** | Execution Engine | 3/3 | ✅ Hoàn thành | 13 |
| **Phase 4** | Chat API & SSE Stream | 5/5 | ✅ Certified | 37 |
| **Phase 5** | Chat UI (React Frontend) | 7/7 | ✅ Certified | 20 |
| **Audit G0-G5 (lịch sử)** | System Remediation (F01–F14) + PostgreSQL Docker | 14/14 được báo cáo | ⚠️ Chứng nhận cũ đã bị rà soát lại | 22 (6 Docker + 16 Probes) |
| **Phase 6** | E2E Integration & Demo | 3/3 | ✅ Ready | 3 |

### 9.3. Chi tiết Test Coverage (117 Unit/Integration Tests + 16 Acceptance Probes)

| Package | Tests | Nội dung chính |
|---|---|---|
| `@wap/tool-schemas` | 5/5 ✅ | Schema definitions, type contracts |
| `@wap/tool-adapters` | 22/22 ✅ | Trello (base, read, write), Slack, AES-256-GCM, rate limiter |
| `@wap/planner` | 14/14 ✅ | Working Memory, 4-layer validator, Hierarchical router & planner |
| `@wap/executor` | 13/13 ✅ | Reference resolver, step runner (AbortSignal timeout), execution controller |
| `@wap/chat-api` | 43/43 ✅ | JWT auth (5), DB pool (3), repositories (7), conversation routes (3), execution routes (2), SSE manager (3), HTTP E2E integration (11), **Real PostgreSQL Container Integration (6)** |
| `@wap/chat-web` | 20/20 ✅ | Chat store, useSSE hook, execution progress, plan preview, gather clarify, chat container, settings |
| `audit-acceptance` | 16/16 ✅ | Verification probes asserting all 14 audit findings remediated |
| `evaluations` | 1/1 ✅ | 50 golden prompt evaluation framework |

### 9.4. Security Hardening & Audit Remediation (Gates G0–G5)

Bảng dưới đây ghi lại các tuyên bố khắc phục ban đầu trong `REVIEW.md`. Đợt rà soát sau đó đã tái hiện các lỗ hổng còn sót và sửa thêm; không dùng bảng lịch sử này làm chứng nhận production.

| Cổng | Phát hiện | Khắc phục thực tế | Bằng chứng kiểm thử |
|---|---|---|---|
| **G0** | F01 (Auth Bypass & Config) | Xóa bỏ hoàn toàn `Bearer demo-token`; `validateEnv` chuyển sang fail-closed khi thiếu secret production | `acceptance-probes.mjs` (401 & throws) |
| **G1** | F02 (User Isolation & User Repo) | Tạo `UserRepo` với mã hóa mật khẩu PBKDF2/SHA-256; chuẩn hóa user ID sang RFC 4122 UUID; kiểm tra `user_id` sở hữu hội thoại (403 Forbidden) | `postgres-docker.test.ts` & `app-e2e.test.ts` |
| **G1** | F03 (Async Adapter Contract) | Hỗ trợ Promise trả về từ `getAdapter` trong `StepRunner`, không còn lỗi "execute is not a function" | `runner.test.ts` & `acceptance-probes.mjs` |
| **G1** | F04 (Timeout Cancellation) | Forward `AbortSignal` xuyên suốt `StepRunner` qua `TrelloAdapter` và `SlackAdapter` vào lệnh gọi `fetch` | `acceptance-probes.mjs` |
| **G2** | F05 (Allowed Scope on Writes) | Tự động lookup board cha trước khi ghi vào list/card trên Trello, từ chối ghi ngoài whitelist `allowedScope` | `acceptance-probes.mjs` |
| **G2** | F06 (Validator & Router Strictness) | Validator từ chối zero-step plans, thiếu args bắt buộc, thiếu dependsOn, và $ref sai; Router hỗ trợ từ khóa task tiếng Việt | `validator.test.ts`, `planner.test.ts` |
| **G3** | F08 (Retry State Guard) | State machine ngăn chặn thực thi lại step đã `succeeded` hoặc đang `running`; thêm lock tránh re-entrancy | `acceptance-probes.mjs` |
| **G3** | F09 (Approval Expiry & Supersession) | Tự động invalidate (supersede) các plan cũ khi có plan mới; kiểm tra `expires_at > now()` trực tiếp trong câu lệnh SQL UPDATE | `postgres-docker.test.ts` |
| **G4** | F10 (Execution Persistence) | Await toàn bộ thao tác ghi step vào PostgreSQL; cập nhật `plans.status = 'failed'` nếu persistence gặp sự cố | `acceptance-probes.mjs` |
| **G4** | F11 (Services Routes & Settings) | Thêm route `GET /api/services` và `POST /api/services/:name/test`; UI SettingsModal gọi API kiểm tra kết nối động | `acceptance-probes.mjs` & `settings.test.tsx` |
| **G4** | F12 (SSE Deduplication) | Frontend `useSSE` loại bỏ sequence trùng lặp, xử lý chuẩn xác sự kiện `text_end` và `refusal` | `acceptance-probes.mjs` & `use-sse.test.ts` |

Qua audit bởi `agency-reality-checker`, 5 lỗ hổng đã được phát hiện và sửa:

| ID | Severity | Vấn đề | Khắc phục |
|---|---|---|---|
| SEC-01 | 🔴 Critical | Login cấp token cho email bất kỳ | Loại bỏ fallback, chỉ chấp nhận valid credentials |
| SEC-02 | 🟠 High | Protected routes thiếu auth middleware | Gắn `authMiddleware` lên tất cả protected endpoints |
| SEC-03 (lịch sử, đã thay thế) | 🟠 High | SSE không hỗ trợ browser auth | Token trong URL đã bị loại bỏ; client dùng `Authorization` header và server kiểm tra quyền sở hữu hội thoại |
| REL-01 | 🟡 Medium | Thiếu global error handler | Thêm Express error middleware |
| TST-01 | 🟡 Medium | Không có real HTTP E2E tests | Tạo 11 integration tests trên ephemeral TCP port |

### 9.5. Commit History (v3 — 21 commits)

```
53e2185 chore(infra): scaffold v3 monorepo
34a44a6 feat(schemas): define v3 tool definitions
7d0e05e feat(adapters): AES-256-GCM encryption, rate limiter, base adapter
5f50428 feat(adapters): Trello base adapter + error normalization
a205424 feat(adapters): Trello search/read tools + scope enforcement
caedd28 feat(adapters): Trello write tools + unified TrelloAdapter
5b21476 feat(adapters): Slack adapter + allowed channels filtering
b74d055 feat(db): PostgreSQL v3 migration + connection pool
13c765b feat(api): database repositories + optimistic locking
e8cd4e9 feat(planner): Working Memory + Gemini LLM provider
843f52c feat(planner): 4-layer plan validator + thinking precedence
7c96415 feat(planner): hierarchical routing + 1x validation retry
03abc0d test(eval): 50-prompt evaluation framework + quality gate
210dee4 feat(executor): argument + cross-step reference resolver
c8688f7 feat(executor): step runner + AbortSignal timeout + UNKNOWN safety
3b3324e feat(executor): execution controller + partial failure recovery
9aa427a feat(api): JWT authentication + token refresh endpoints
8694adc feat(api): message ingestion returning 202 accepted
d879620 feat(api): SSE stream endpoint + sequence tracking + event replay
56767bd feat(api): execution service + adapter injection + optimistic locking
3e18cea fix(api): harden auth guards, SSE query token, e2e integration test
```

---

## 10. Roadmap & Công việc Tiếp theo

### 10.1. Tổng quan Phases

```
Phase 0 → Phase 1 → Phase 2a/2b ⭐ → Phase 3 → Phase 4 → Phase 5 → Phase 6
                     (CRITICAL)                                        │
                                                Phase 7 (OPT) → Phase 8 (OPT)
```

### 10.2. Trạng thái hiện tại và việc còn lại

**Phase 5: Chat UI (Tasks 19–25)** đã có triển khai v3 trong `apps/chat-web/` và bộ test giao diện. Đây là trạng thái mã nguồn cục bộ, chưa phải bằng chứng nghiệm thu quy trình live.

**Phase 6: E2E Integration & Demo (Tasks 26–28)** còn cần chứng minh trên đường chạy thực tế:
- Scenario 1: tạo task Trello và thông báo Slack sau khi người dùng duyệt plan.
- Scenario 2: xử lý tên mơ hồ bằng bước hỏi rõ và tra cứu thật.
- Scenario 3: phục hồi lỗi một phần, kiểm tra skip/retry và trạng thái sau restart.

Ưu tiên gần nhất là môi trường PostgreSQL v3 có thể tái tạo từ checkout mới, CI dùng DB thật, rồi kiểm thử E2E sandbox và live có kiểm soát. Xem [hướng dẫn setup v3](V3-LOCAL-SETUP.md). Các số liệu test cục bộ không thay thế bằng chứng live hoặc crash recovery.

### 10.3. Mở rộng tương lai (Optional)

**Phase 7: Đợt 2 Adapters** — GitHub (5 tools), Google Sheets (3 tools)  
**Phase 8: Đợt 3 Adapters (OAuth2)** — Gmail, Google Calendar, Notion

### 10.4. Success Criteria

**Minimum Viable Demo:**
```
1. User mở browser, đăng nhập
2. Chat: "Tạo task cập nhật homepage cho team frontend,
          deadline thứ 6, gán Minh, thông báo Slack"
3. AI gather boards + members (user thấy progress)
4. AI sinh plan 4 bước (user thấy preview)
5. User duyệt
6. Hệ thống tạo card thật + gán member + checklist + gửi Slack thật
7. User thấy link card + confirmation
```

**Metrics:**

| Metric | Target |
|---|---|
| Tool selection accuracy | ≥ 85% |
| Argument quality | ≥ 75% |
| Usable plan rate | ≥ 70% |
| System response time (→ preview) | < 15s |
| Execution time (approve → done) | < 15s |
| Evaluation suite | 50 prompts, versioned |
| Demo scenarios | 3 end-to-end |

---

## 11. Tài liệu Tham chiếu

| Document | Đường dẫn | Mô tả |
|---|---|---|
| Design Spec v3 | [`docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md`](docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md) | Đặc tả thiết kế chi tiết (1029 dòng, 12 sections) |
| Implementation Plan | [`docs/superpowers/plans/2026-09-29-ai-workflow-platform-v3.md`](docs/superpowers/plans/2026-09-29-ai-workflow-platform-v3.md) | Kế hoạch triển khai 28 tasks TDD |
| Team Workflow | [`docs/team-workflow.md`](docs/team-workflow.md) | Module ownership, Git strategy, commit conventions |
| AGENTS.md | [`AGENTS.md`](AGENTS.md) | Multi-agent engineering protocol cho repo |

---

*Tài liệu này kết hợp thiết kế ban đầu với trạng thái mã nguồn v3 tại ngày 29/09/2026. Các mốc lịch sử ở Mục 9 là snapshot lúc ghi nhận, không phải danh sách commit hiện tại.*
