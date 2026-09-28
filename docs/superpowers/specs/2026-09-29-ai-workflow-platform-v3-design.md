# AI Workflow Automation Platform — Thiết kế v3

**Trạng thái: PENDING_OWNER_REVIEW**
**Ngày lập: 29/09/2026**
**Phương pháp: 5 sections × 2 vòng phản biện mỗi section**

---

## 1. Bối cảnh & Vấn đề

### 1.1. Vấn đề hệ thống hiện tại (v2)

Hệ thống v2 mang tên "AI Automation Workflow Platform" nhưng giá trị nghiệp vụ
không xứng với tên gọi. Cụ thể:

| Từ khóa | Kỳ vọng | Thực tế v2 |
|---|---|---|
| AI | Hiểu NL, chọn tool, lập kế hoạch thông minh | Chọn 1/3 branch cố định, 1 write tool duy nhất |
| Automation | Giảm đáng kể thao tác thủ công | 8 bước tương tác cho 1 card Trello |
| Workflow | Quy trình nhiều bước, phân nhánh, điều kiện | 1 bước duy nhất |
| Platform | Mở rộng được, nhiều tích hợp | Khóa cứng 1 Sheet + 1 Board, 2 user |

Ba vấn đề cốt lõi được chủ dự án xác định (28/09/2026):

1. **Nghiệp vụ quá đơn giản** — tạo 1 Trello card, ít hơn cả 1 Zapier Zap miễn phí
2. **Luồng vô nghĩa** — user ghi thẳng Trello nhanh hơn, không cần hệ thống trung gian
3. **AI làm ngược** — bắt user cấu trúc hóa dữ liệu vào Sheet, AI chỉ kiểm bài

### 1.2. Mục tiêu v3

Xây lại hệ thống từ application code, giữ project infrastructure. Mục tiêu:

- User **chat bằng ngôn ngữ tự nhiên** (tiếng Việt/Anh), không điền form/sheet
- AI **hiểu ý định, tự chọn tools, sinh plan nhiều bước**, không hardcode 1 tool
- Hệ thống **thực thi workflow trên nhiều dịch vụ** (Trello, Slack, GitHub, Sheets)
- Giá trị rõ ràng: **1 câu chat thay 4-5 thao tác thủ công trên 2+ hệ thống**

### 1.3. Đề tài & Ràng buộc

- Đề tài 26: "AI Workflow Automation Platform" — yêu cầu: mô tả workflow bằng NL,
  AI chọn và gọi API/tool
- Thời gian và scope: thoải mái theo quyết định chủ dự án
- Chiến lược kỹ thuật: viết lại application code, tái dùng project infrastructure
  (monorepo, Docker, build tools, test framework)

---

## 2. Nguyên tắc Thiết kế

1. **AI phải làm việc CỦA AI** — nhận đầu vào phi cấu trúc, chuyển thành hành
   động có cấu trúc. Không bắt user cấu trúc hóa trước.
2. **Giá trị tỷ lệ với độ phức tạp workflow** — single-step ít giá trị,
   multi-step cross-service mới có giá trị thật.
3. **An toàn tỷ lệ với rủi ro** — không đồng đều cho mọi action. Read tự do,
   write low-risk duyệt 1 lần, write high-risk xác nhận riêng.
4. **Plan-then-Execute** — AI sinh toàn bộ plan trước, user duyệt, rồi mới chạy.
   Không dùng ReAct-style step-by-step (khó preview, khó kiểm soát).
5. **Mỗi phase có deliverable demoable** — không build 3 tuần rồi mới thấy kết quả.
6. **Adapter pattern** — thêm service mới = thêm 1 file adapter, không đổi core.

---

## 3. Kiến trúc Tổng thể

### 3.1. Sơ đồ hệ thống

```
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
│  └──────────────┘ └──────────────┘ │  ├───────┤ ├────────┤  │   │
│                                     │  │GitHub │ │Sheets  │  │   │
│                                     │  │adapter│ │adapter │  │   │
│  ┌──────────────────┐               │  └───────┘ └────────┘  │   │
│  │    PostgreSQL     │               └────────────────────────┘   │
│  │ 6 tables          │                                            │
│  │ users,convs,msgs  │ ┌─────────────────┐                      │
│  │ plans,steps,creds  │ │  Tool Catalog   │                      │
│  └──────────────────┘ │  18+ tools/4 svcs │                      │
│                        └─────────────────┘                       │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2. Luồng chính

```
1. USER CHAT
   "Tạo task cập nhật homepage cho team frontend,
    deadline thứ 6, gán Minh, báo trên Slack"

2. AI GATHER (function calling, read-only, tùy chọn)
   Nếu AI cần context → gọi read tools: list_members, list_lists
   Hiển thị gather progress realtime cho user
   Skip nếu user cung cấp đủ thông tin

3. AI PLAN (structured output, 1 LLM call)
   Sinh plan JSON nhiều bước HOẶC clarification HOẶC refusal
   Ví dụ plan:
     step1: trello.create_card(title=..., due=..., listId=...)
     step2: trello.add_member(cardId=$step1.output.id, memberId="m1")
     step3: trello.add_checklist(cardId=$step1.output.id, items=[...])
     step4: slack.send_message(channel=#frontend, text="Task mới: $step1.output.url")

4. VALIDATION (3 lớp)
   JSON parse → Schema validate → Semantic validate (tool tồn tại, refs hợp lệ, DAG acyclic)
   Fail → retry 1 lần với error message → vẫn fail → báo lỗi user

5. PREVIEW (interactive card trong chat)
   Hiển thị từng bước với tool, args, mô tả
   High-risk tools (gmail.send_email) có preview chi tiết riêng
   [Duyệt] [Sửa] [Hủy]

6. USER APPROVAL
   Approve gắn với plan hash (SHA-256, bất biến)
   TTL 30 phút
   "Sửa" = chat feedback → AI sinh plan mới → preview mới

7. EXECUTION (tuần tự, per-step state)
   Chạy từng step → resolve references runtime → lưu output DB
   Stream progress realtime cho user
   Partial failure → pause → user chọn retry/fix/skip/stop

8. RESULT
   Summary + links tới resources đã tạo
   AI hiểu execution state → có thể thảo luận tiếp về kết quả/lỗi
```

### 3.3. Cấu trúc Project

```
ATI_Project/
├── apps/
│   ├── api/              ← code v2 (giữ nguyên, không maintain)
│   ├── web/              ← code v2
│   ├── chat-api/         ← MỚI: backend v3
│   └── chat-web/         ← MỚI: frontend v3
├── packages/
│   ├── dsl/              ← code v2
│   ├── engine/           ← code v2
│   ├── tools/            ← MỚI: tool catalog + adapters
│   ├── planner/          ← MỚI: AI planner
│   └── executor/         ← MỚI: execution engine
├── db/
│   ├── migrations/       ← v2 (0001-0014)
│   └── v3/               ← MỚI: schema v3
├── prompts/              ← MỚI: versioned system prompts
├── evaluations/          ← MỚI: AI evaluation results
└── docker-compose.yml    ← tái dùng, thêm config nếu cần
```

### 3.4. Ranh giới — Không làm gì

- Không có trigger tự động / scheduler (user chủ động chat)
- Không có visual workflow editor (AI sinh plan, không kéo thả)
- Không có multi-agent (1 planner đủ)
- Không có real-time collaboration (1 user, 1 conversation tại 1 thời điểm)
- Không có runtime conditional branching trong plan (xử lý qua clarification)
- Không maintain hoặc sửa code v2

---

## 4. AI Planner & Tool Catalog

### 4.1. Kỹ thuật sinh plan

**Hybrid approach:**
- **Phase 1 — Gather (function calling, read-only, tùy chọn):** AI gọi read tools
  để thu thập context (list_members, list_lists). Kết quả lưu vào messages
  (role="system") để trace. Hiển thị progress cho user. Skip nếu đủ context.
- **Phase 2 — Plan (structured output):** AI sinh toàn bộ plan JSON trong 1 LLM
  call. Dùng `response_schema` (Gemini) hoặc `response_format` (OpenAI) để
  enforce format.

**Tại sao hybrid:** Nếu AI sinh plan mà không biết listId hay memberId thật, nó
sẽ hallucinate. Gather trước → plan chính xác hơn. Nhưng gather tùy chọn — nếu
user cung cấp đủ info thì skip để tiết kiệm calls.

### 4.2. Tool Catalog

**Đợt 1 — 4 services, token-based auth, ~18 tools:**

| Service | Auth | Tools |
|---|---|---|
| **Trello** | API key + token | `list_boards`, `list_lists`, `list_members`, `list_cards`, `get_card`, `create_card` (W), `update_card` (W), `add_member` (W), `add_checklist` (W) |
| **Slack** | Bot token | `list_channels`, `send_message` (W) |
| **GitHub** | Personal Access Token | `list_repos`, `list_issues`, `get_issue`, `create_issue` (W), `add_label` (W) |
| **Google Sheets** | Service Account | `read_range`, `append_row` (W), `update_cell` (W) |

Tổng Đợt 1: **13 read + 5 write (Trello) + 1 write (Slack) + 2 write (GitHub) + 2 write (Sheets) = 13 read + 10 write = 23 tools** trên 4 services.

(W) = write, side effect.

**Đợt 2 (OPTIONAL, Phase 7) — Cần OAuth2 infrastructure:**

| Service | Auth | Tools |
|---|---|---|
| Gmail | OAuth2 | `send_email` (W, HIGH-RISK) |
| Google Calendar | OAuth2 | `list_events`, `create_event` (W) |
| Notion | Integration token / OAuth2 | `list_databases`, `query_database`, `create_page` (W) |

### 4.3. Tool Definition Schema

```typescript
interface ToolDefinition {
  name: string;                   // "trello.create_card"
  service: string;                // "trello"
  description: string;            // mô tả cho AI hiểu khi nào dùng
  sideEffect: "read" | "write";
  riskLevel: "low" | "medium" | "high"; // high = extra confirmation
  inputSchema: JSONSchema;        // args cần truyền
  outputSchema: JSONSchema;       // output trả về (cho AI reference)
  examples?: Example[];           // tùy chọn, chỉ cho tool dễ nhầm
}
```

### 4.4. Plan Format

```typescript
type PlannerResponse =
  | PlanResponse
  | ClarificationResponse
  | RefusalResponse;

interface PlanResponse {
  kind: "plan";
  summary: string;           // "Tạo task, gán Minh, thông báo Slack"
  steps: PlanStep[];          // 1-10 bước
  warnings: string[];         // "Board chỉ có 2 members"
}

interface PlanStep {
  id: string;                 // "step_1"
  tool: string;               // "trello.create_card" — phải có trong catalog
  description: string;        // "Tạo card Cập nhật homepage trên list To Do"
  args: Record<string, ArgValue>;
  dependsOn: string[];        // ["step_1"] — khai báo dependency rõ ràng
}

type ArgValue =
  | string | number | boolean                    // literal
  | { $ref: string }                              // "step_1.output.id"
  | { $template: string };                        // "Task mới: ${step_1.output.url}"

interface ClarificationResponse {
  kind: "clarification";
  question: string;
  options?: string[];          // null = open-ended (user gõ tự do)
  context: string;
}

interface RefusalResponse {
  kind: "refusal";
  reason: string;
  suggestion?: string;         // "Bạn có thể gửi Slack thay thế"
}
```

### 4.5. Validation Pipeline (3 lớp)

```
LLM output
  → Lớp 1: JSON parse (reject nếu invalid JSON)
  → Lớp 2: Schema validate (reject nếu thiếu/sai field type)
  → Lớp 3: Semantic validate:
      • Tool tồn tại trong catalog?
      • Args khớp tool inputSchema?
      • $ref trỏ đến step đã khai báo + field tồn tại trong outputSchema?
      • DAG acyclic? (depends_on không vòng lặp)
      • Tối đa 10 steps?
  → Fail bất kỳ lớp nào → retry 1 lần với error message trong prompt
  → Retry cũng fail → báo lỗi cho user, KHÔNG chạy plan sai
```

### 4.6. Name Resolution

AI resolve tên gọi (tên người, tên board, tên channel) thành ID thật trong gather
phase:

| Case | Xử lý |
|---|---|
| Exact match (1 kết quả) | Dùng luôn |
| Ambiguous (nhiều kết quả) | AI hỏi clarification |
| No match | AI hỏi: "Không tìm thấy X. Có: A, B. Chọn ai?" |
| Fuzzy match | AI hỏi: "Bạn có phải muốn nói X?" |

Name resolution xảy ra **trước** khi sinh plan. Plan chỉ chứa ID đã xác nhận.

### 4.7. AI chủ động đề xuất

Khi user nói đơn giản ("tạo card"), AI đề xuất thêm bước **1 lần duy nhất, dạng
nhẹ**:

```
AI: "Tôi sẽ tạo card 'Cập nhật homepage' trên list To Do.
     💡 Bạn có muốn thêm: gán member, deadline, hoặc thông báo Slack?
     Hoặc bấm [Duyệt] để chỉ tạo card."
```

User nói "không" hoặc bấm Duyệt → AI chạy đúng 1 step. Tôn trọng ý định user.

### 4.8. Provider Abstraction

```typescript
interface LLMProvider {
  generatePlan(input: {
    systemPrompt: string;
    conversationHistory: Message[];
    toolCatalog: ToolDefinition[];
    signal: AbortSignal;
  }): AsyncIterable<string>;  // streaming response
}

class GeminiProvider implements LLMProvider { ... }
class OpenAIProvider implements LLMProvider { ... }
```

Chọn provider qua config. Gemini Flash cho development, Gemini Pro cho evaluation
và demo.

### 4.9. Context Management

Khi conversation vượt 10 messages:
- Gọi LLM tóm tắt messages 1-N thành 1 đoạn ngắn
- Giữ nguyên 10 messages gần nhất (đầy đủ)
- Tóm tắt lưu vào messages table (role="summary")
- Execution state inject vào context khi user chat sau execution

Mỗi LLM call gửi: system prompt (~1500 tokens) + tool catalog (~2000 tokens) +
summary + 10 messages gần nhất + execution state = ~5000-8000 tokens.

### 4.10. Prompt Versioning

```
prompts/
├── v001-initial.md
├── v002-add-examples.md
└── current.md → symlink

evaluations/
├── v001-results.json   ← 38/50 pass (76%)
├── v002-results.json   ← 43/50 pass (86%)
```

Commit prompt + evaluation results cùng nhau.

---

## 5. Execution Engine & Safety

### 5.1. Execution Lifecycle

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

### 5.2. Step Execution

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
3. Call tool adapter (inject credentials, timeout: 15s read / 30s write)
4. Validate response (linh hoạt, chấp nhận extra fields)
5. Persist step result vào DB
6. Stream status cho UI realtime
7. Next step hoặc pause nếu failed

### 5.3. Error Classification

| Category | Ví dụ | Xử lý |
|---|---|---|
| AUTH_ERROR | Token hết hạn, key revoked | Pause toàn bộ. Thông báo user fix credentials |
| NOT_FOUND | Board/member/channel không tồn tại | Step FAILED. User: retry/fix/skip/stop |
| VALIDATION | Args sai type, field thiếu | Step FAILED. Lỗi plan, cần AI fix |
| RATE_LIMIT | 429 Too Many Requests | Read: wait + auto retry. Write: wait + retry 1x |
| NETWORK | Timeout, DNS fail | Read: retry 2x. Write: xem mục 5.4 |
| SERVER_ERROR | 500, 502, 503 | Read: retry 1x. Write: xem mục 5.4 |
| UNKNOWN | Response không parse được | Ghi UNKNOWN, user xử lý thủ công |

### 5.4. Write Safety

Write gọi external API → side effect bên ngoài hệ thống → không rollback được.

| Tình huống | Response | Hành động |
|---|---|---|
| Thành công rõ | 2xx + valid body | Mark SUCCEEDED |
| Thất bại rõ | 4xx (client error) | Mark FAILED, không retry |
| Server error | 5xx | Mark **UNKNOWN**, không auto retry |
| Timeout | Không response | Mark **UNKNOWN**, không auto retry |
| Rate limit | 429 | Wait theo Retry-After, retry **1 lần** |

UNKNOWN hiển thị cho user với options kiểm tra thủ công.

### 5.5. Partial Failure Handling

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

"Sửa & thử lại" chỉ chạy lại **step bị fail**, không tạo lại toàn bộ plan.

### 5.6. Write Risk Levels

| Risk | Tools | Safety |
|---|---|---|
| Low | create_card, add_member, add_checklist, update_card, append_row, create_page, create_issue, add_label | Approval 1 lần cho toàn bộ plan |
| Medium | send_message, update_cell | Approval plan + highlight trong preview |
| High | send_email (Đợt 2) | Preview nội dung đầy đủ + xác nhận riêng per step |

### 5.7. Plan Approval

```typescript
interface PlanApproval {
  planId: string;
  planHash: string;      // SHA-256 của plan JSON, verify trước execution
  decision: "pending" | "approved" | "rejected" | "expired";
  expiresAt: string;     // 30 phút từ lúc tạo preview
}
```

Quy tắc:
- Plan hash bất biến — verify `sha256(plan_json) === plan_hash` trước execution
- Hết hạn 30 phút → plan expired → user tạo plan mới
- Mỗi conversation chỉ 1 plan pending tại 1 thời điểm
- "Sửa" = user chat feedback → AI sinh plan MỚI → approve plan mới

### 5.8. Crash Recovery

- Mỗi step status persisted vào DB ngay khi thay đổi
- Server restart → tìm plans có status="executing"
- Step đang "running" khi crash: read → auto retry, write → mark UNKNOWN
- Thông báo user kiểm tra

### 5.9. Intent Dedup

Trước khi execute write step, kiểm DB: step cùng tool + cùng args chính
(title + listId) đã succeeded trong 1 giờ qua? Nếu có → cảnh báo user, không
chặn cứng.

### 5.10. Timeouts

- Per-step: 15s read, 30s write
- Overall: 3 phút cho toàn bộ execution. Vượt → pause + thông báo user

### 5.11. Credential Management

```
Model: TEAM-SHARED credentials
  • 1 bộ credentials per service cho cả team
  • Encrypted at rest (AES-256, key từ environment variable)
  • Server-side only — không bao giờ trong prompt, plan, preview, log, browser
  • Token expired → adapter fail → step pause → user thông báo fix

Giới hạn MVP: không có per-user OAuth. Mọi action trên external service
thực hiện dưới tên token owner. Trace user trong execution_steps.requested_by.
```

### 5.12. Rate Limiting per Adapter

Mỗi adapter built-in rate limiter theo spec service:
- Trello: 100 req / 10s
- Slack: ~1 req/s cho chat.postMessage
- GitHub: 5000 req / hour
- Google APIs: varies

Throttle → wait + retry (read) hoặc wait + retry 1x (write).

---

## 6. Chat UI & User Experience

### 6.1. Layout

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

### 6.2. Message Types

7 loại message trong chat:

1. **User Message** — text thuần
2. **AI Text** — markdown rendered, streaming từng chữ
3. **Gather Progress** — collapsible, hiện read tool đang gọi + kết quả
4. **Clarification** — câu hỏi + option buttons (nếu có) hoặc open-ended
5. **Plan Preview** — interactive card: từng step + [Duyệt][Sửa][Hủy]
6. **Execution Progress** — live update per-step: ✅ ⏳ ⏸ ❌
7. **Execution Result / Partial Failure** — summary + links + action buttons

### 6.3. Progressive Loading States

```
User gửi message:
  → Typing indicator (● ● ●)
  → Nếu gather: replace với gather progress
  → Khi AI stream: text hiện từng chữ
  → Khi stream xong: plan preview card xuất hiện
```

Mỗi transition smooth, không nhảy đột ngột.

### 6.4. Onboarding (lần đầu)

1. Hiển thị 4 service cards với nút [Kết nối]
2. Mỗi service: step-by-step wizard với screenshot hướng dẫn lấy API key
3. Nút [Kiểm tra kết nối] verify credentials thật
4. Cần kết nối ≥1 service để vào chat

### 6.5. Empty State

Dynamic suggestion chips dựa trên connected services:

```typescript
// Chỉ hiện suggestions khả thi:
// Nếu chỉ có Trello → không hiện gợi ý Slack
// Nếu có Trello + Slack → hiện gợi ý cross-service
```

### 6.6. Optimistic Updates

User bấm Gửi → message hiện ngay (màu nhạt + ⏳) → POST confirm → đổi sang
bình thường. POST fail → đổi sang đỏ + ❌ + [Gửi lại].

### 6.7. SSE Reconnect

- SSE auto-reconnect khi mất mạng (browser EventSource tự retry)
- Reconnect → server gửi `event: sync` với current state
- Execution chạy server-side, KHÔNG dừng vì client disconnect
- User đóng browser → quay lại → render đúng state từ DB

### 6.8. Service Disconnect Mid-chat

AI gather fail vì token hết hạn → AI trả message rõ ràng:
"⚠️ Không thể kết nối Trello. Vào Cài đặt để kiểm tra."
Không trả error kỹ thuật khó hiểu.

### 6.9. Tech Stack

| Lựa chọn | Lý do |
|---|---|
| React 19 | Ecosystem lớn, project cũ đã dùng |
| Vite | Build nhanh, dev experience tốt |
| Tailwind CSS | Utility-first, prototype nhanh |
| Zustand | State management nhẹ, đủ cho chat app |
| SSE (EventSource) | Đủ cho server→client streaming, đơn giản hơn WebSocket |
| Tự viết chat components | UI library quá generic cho custom chat cards |

---

## 7. Database Schema

6 bảng:

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
  config      BYTEA NOT NULL,            -- encrypted JSON (AES-256)
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

---

## 8. API Design

### 8.1. Authentication

```
POST   /api/auth/login     → { token: "jwt..." }
GET    /api/auth/me         → { user }
```

Admin tạo tài khoản qua CLI/seed script. Không có đăng ký tự do.

### 8.2. Conversations

```
POST   /api/conversations                 → Tạo conversation mới
GET    /api/conversations                  → List (sidebar, per-user)
GET    /api/conversations/:id              → Chi tiết + messages + plans
DELETE /api/conversations/:id              → Soft delete
```

### 8.3. Messages & Streaming

```
POST   /api/conversations/:id/messages     → 202 Accepted { messageId }
GET    /api/conversations/:id/stream       → SSE (luôn mở, per-conversation)
```

SSE tách khỏi POST. POST trả về ngay. SSE nhận events:

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

### 8.4. Plans & Execution

```
POST   /api/plans/:id/approve                        → Duyệt
POST   /api/plans/:id/reject                          → Từ chối
POST   /api/executions/:planId/start                  → Bắt đầu execution
POST   /api/executions/:planId/steps/:stepId/retry    → Retry step
POST   /api/executions/:planId/steps/:stepId/skip     → Skip step
POST   /api/executions/:planId/stop                   → Dừng execution
```

### 8.5. Services

```
GET    /api/services                        → List services + trạng thái
POST   /api/services/:name/connect          → Lưu credentials
POST   /api/services/:name/test             → Test connection (gọi 1 read tool)
DELETE /api/services/:name                  → Xóa credentials
```

### 8.6. Settings

```
POST   /api/settings/llm                    → Cấu hình LLM provider + API key
```

---

## 9. Roadmap

### 9.1. Tổng quan

```
Phase 0 → Phase 1 → Phase 2 ⭐ → Phase 3 → Phase 4 → Phase 5 → Phase 6
                     (CRITICAL)                                    │
                                                          Phase 7 (OPTIONAL)
```

### 9.2. Chi tiết từng Phase

**Phase 0: Foundation**
- Tái dùng infrastructure (monorepo, Docker, build tools)
- Tạo workspace mới (chat-api, chat-web, packages mới)
- PostgreSQL schema v3 (6 tables, 1 migration)
- Auth module (users, login, JWT middleware)
- Health check endpoint
- **Setup test accounts** (Trello board test, Slack workspace test, GitHub repo test,
  Sheets test) — blocker cho Phase 1
- Demo: `curl /api/auth/login` → JWT

**Phase 1: Tool Catalog & Adapters**
- Tool registry (static config, schema definitions)
- Adapter interface chuẩn hóa
- 4 adapters: Trello (9 tools), Slack (2), GitHub (5), Sheets (3)
- Rate limiter per adapter
- Connection test endpoint
- Credential storage (encrypted)
- Unit tests cho mỗi adapter (mock API)
- Demo: `curl` → tạo card thật + gửi Slack thật

**Phase 2: AI Planner ⭐ (CRITICAL)**
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
- Settings page + connection wizard
- Onboarding page
- Empty state (dynamic suggestion chips)
- Responsive (desktop + mobile)
- Progressive loading (thinking → gather → stream)
- Demo: **FULL END-TO-END** trong browser

**Phase 6: Polish, Evaluation & Documentation**
- 3 demo scenarios end-to-end:
  - Quản lý dự án (Trello + Slack)
  - Bug tracking (GitHub + Slack)
  - Data entry (Sheets + Trello)
- Final evaluation report (50 prompts, versioned)
- Error handling demos
- Performance metrics
- README + API docs + architecture docs

**Phase 7 (OPTIONAL): Đợt 2 Adapters**
- OAuth2 infrastructure (consent screen, token refresh)
- Gmail adapter (HIGH-RISK, extra confirmation UX)
- Calendar adapter
- Notion adapter
- Cần Phase 1-6 hoàn thành tốt trước

### 9.3. Testing Strategy

```
┌─────────────────────┐
│   E2E Tests (5-10)  │ ← Phase 6: 3 demo scenarios automated
├─────────────────────┤
│ Integration (20-30) │ ← Phase 3-4: real DB + mock adapters
├─────────────────────┤
│ Unit Tests (100+)   │ ← Phase 1-2: adapters, validator, resolver
├─────────────────────┤
│ AI Eval (50)        │ ← Phase 2: prompt test suite, versioned
└─────────────────────┘

Tổng: ~150-200 tests
```

---

## 10. Success Criteria

### 10.1. Minimum Viable Demo

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

### 10.2. Metrics

| Metric | Target |
|---|---|
| Tool selection accuracy | ≥ 85% |
| Argument quality | ≥ 75% |
| Usable plan rate (user không reject) | ≥ 70% |
| System response time (→ preview) | < 15s |
| Execution time (approve → done) | < 15s |
| Evaluation suite | 50 prompts, versioned |
| Demo scenarios | 3 end-to-end trên real services |

---

## 11. Risks & Mitigations

| Risk | Xác suất | Impact | Mitigation |
|---|---|---|---|
| AI sinh plan sai/kém | Cao | 🔴 | Phase 2 gate. Không tiến nếu accuracy < 60% |
| LLM rate limit/cost | TB | 🟡 | Flash cho dev, Pro cho eval. Cache gather. |
| External API thay đổi | Thấp | 🟡 | Adapter pattern isolate. Output schema linh hoạt |
| Test account setup phức tạp | TB | 🟡 | Setup trong Phase 0, trước khi code |
| UI phức tạp hơn dự kiến | TB | 🟡 | SSE state machine. Components nhỏ, độc lập |
| Scope creep | Cao | 🟡 | Giữ đúng phases. Phase 7 là OPTIONAL |
| Prompt regression | TB | 🟡 | Prompt versioning + evaluation tracking |

---

## 12. So sánh v2 vs. v3

| Khía cạnh | v2 | v3 |
|---|---|---|
| Đầu vào | Google Sheet có cột cố định | Chat ngôn ngữ tự nhiên |
| AI capability | 1/3 branch cố định, 1 tool | Chọn từ 18+ tools, sinh multi-step plan |
| Workflow | 1 bước | 1-10 bước trên nhiều dịch vụ |
| Services | 1 Sheet + 1 Trello | 4+ services (Trello, Slack, GitHub, Sheets) |
| Giá trị | Âm (chậm hơn trực tiếp) | Dương (1 câu = 4-5 thao tác thủ công) |
| Safety model | 14 migrations, TTL/hash/ledger/reconciliation | 6 tables, plan hash + step-level state |
| Xứng tên "AI Workflow Automation Platform" | Không | Có |
