# AI Workflow Automation Platform — Thiết kế v3

**Trạng thái: REVIEWED_AND_UPDATED**
**Ngày lập: 29/09/2026**
**Cập nhật: 29/09/2026 — Merge fixes từ 3 specialist reviewers (Software Architect 8.5/10, AI Engineer 6.5→8/10, Backend Architect 8.5/10)**
**Phương pháp: 5 sections × 2 vòng phản biện + 3 specialist reviews + merge fixes**

**Đính chính phạm vi 29/09/2026:** Chủ dự án xác nhận nền tảng phải mở rộng ngoài Trello/Slack. Mục 1.4 và Phase 7 dưới đây điều chỉnh scope và tiêu chí hoàn thành; các điểm review ở trên thuộc bản thiết kế trước cập nhật này, không chứng nhận phần mở rộng đã triển khai hoặc được review độc lập.

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

### 1.4. Phạm vi đa dịch vụ và điều kiện hoàn thành

**Mục tiêu bắt buộc:** lập kế hoạch và thực thi workflow phối hợp nhiều dịch vụ bên ngoài qua catalog công cụ và adapter có hợp đồng chung. Trello/Slack là đợt đầu để xây phần lõi; không phải phạm vi cuối cùng. Phase 7 không còn là phần có thể bỏ qua khi tuyên bố hoàn thành nền tảng.

Phạm vi hỗ trợ là các dịch vụ đã được đăng ký, có adapter, xác thực và quyền hợp lệ. Hệ thống không tự suy ra quyền gọi một API bất kỳ từ URL hoặc nội dung người dùng đưa vào hội thoại. Các nhóm dịch vụ mục tiêu gồm quản lý công việc, nhắn tin, mã nguồn và bảng tính; email, lịch và tài liệu được mở rộng theo nhu cầu.

**Tiêu chí nghiệm thu tối thiểu cho khả năng mở rộng:**

1. Có ít nhất ba dịch vụ được tích hợp; ít nhất một workflow có phụ thuộc dữ liệu giữa các bước đi qua cả ba dịch vụ, từ chat → preview → duyệt → kết quả.
2. Tên dịch vụ và năng lực được lấy từ cơ chế đăng ký chung. Thêm tích hợp không yêu cầu thêm nhánh theo tên dịch vụ trong lõi planner/executor hoặc endpoint liệt kê dịch vụ. Thay đổi tập trung ở định nghĩa tool, adapter, cấu hình xác thực/phạm vi và nơi đăng ký tích hợp.
3. Chỉ công cụ đã đăng ký và được phép trong ngữ cảnh kết nối hiện tại mới được cung cấp cho planner. Dịch vụ chưa tích hợp, chưa cấu hình hoặc không có quyền phải được chặn rõ ràng.
4. Mỗi adapter bổ sung có kiểm thử schema, quyền tài nguyên, lỗi, timeout và kết quả ghi không xác định. Có kiểm thử trình duyệt/API/PostgreSQL cho workflow ba dịch vụ; không dùng fixture để chứng minh chất lượng AI.
5. Bằng chứng sandbox và live được ghi riêng. Đóng nghiệm thu tích hợp thực tế cần kết quả từ API dịch vụ thật, định danh tài nguyên/kết quả và trạng thái DB đối chiếu được. Một adapter giả lập thứ ba chỉ xác nhận hợp đồng mở rộng.

GitHub đã được chọn làm tích hợp thứ ba. Registry, routing theo catalog và cấu hình UI tổng quát đã có mã nguồn và bằng chứng sandbox; nghiệm thu live vẫn **OPEN**. Google Sheets thuộc đợt sau. Xem [trạng thái triển khai và bằng chứng](../../MULTI-SERVICE-SCOPE.md).

**Cập nhật 02/10/2026:** Chủ dự án chốt đợt mở rộng tiếp theo gồm năm dịch vụ: Google Sheets, Google Calendar, Notion, Telegram, Jira. Trước khi thêm, các chỗ còn viết cố định theo tên dịch vụ trong lõi phải được gỡ (task W3-00) để đáp ứng tiêu chí 2. Kế hoạch, mốc chốt catalog và thứ tự bỏ bớt khi thiếu thời gian xem [`docs/handoff/ROADMAP.md`](../../handoff/ROADMAP.md).

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
6. **Mở rộng theo hợp đồng tích hợp** — thêm service cần tool definitions, adapter, xác thực, phạm vi quyền, đăng ký và kiểm thử. Lõi planner/executor dùng hợp đồng chung; GitHub là tích hợp thứ ba đã qua kiểm thử sandbox, chưa qua nghiệm thu live.

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
│  │  JWT   │ │ Working Memory  │ │  Router+LLM  │ │ Validator │  │
│  └────────┘ └─────────────────┘ └──────────────┘ └───────────┘  │
│                                                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────────────┐   │
│  │  Execution   │ │   Approval   │ │     Tool Gateway       │   │
│  │  Engine      │ │   Preview    │ │  ┌───────┐ ┌────────┐  │   │
│  │  Sequential  │ │   Hash+TTL   │ │  │Trello │ │ Slack  │  │   │
│  │  Per-step DB │ │              │ │  │adapter│ │adapter │  │   │
│  └──────────────┘ └──────────────┘ │  └───────┘ └────────┘  │   │
│                                     │ (Đợt 1: 11 tools/2 svcs) │   │
│  ┌──────────────────┐               └────────────────────────┘   │
│  │    PostgreSQL     │               ┌────────────────────────┐   │
│  │ 6 tables          │               │   Tool Schemas (shared)│   │
│  │ users,convs,msgs  │               └────────────────────────┘   │
│  │ plans,steps,creds  │                                            │
│  └──────────────────┘                                            │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2. Luồng chính

```
1. USER CHAT (CHAT MODE)
   "Tạo task cập nhật homepage cho team frontend,
    deadline thứ 6, gán Minh, báo trên Slack"

2. AI GATHER & CLARIFY (CHAT MODE - Multi-turn)
   - Prompt Injection Protection: kiểm tra intent an toàn trước khi xử lý.
   - Nếu AI cần context → gọi search tools: search_members(query="Minh", limit=5)
   - Hiển thị gather progress realtime cho user.
   - Nếu ambiguous → AI hỏi Clarification. User trả lời.
   - Quá trình lặp lại cho đến khi AI gom ĐỦ context. Skip nếu user cung cấp đủ.

3. AI PLAN (PLAN MODE - 1-shot structured output)
   - Khi đã ĐỦ context, hệ thống chốt và chuyển sang Plan Mode.
   - Hierarchical Planning: LLM Router chọn service subset trước.
   - Sinh plan JSON nhiều bước trong 1 LLM call, có thinking/self-correction.
   Ví dụ plan:
     step1: trello.create_card(title=..., due=..., listId=...)
     step2: trello.add_member(cardId=$step1.output.id, memberId="m1")
     step3: trello.add_checklist(cardId=$step1.output.id, items=[...])
     step4: slack.send_message(channel=#frontend, text="Task mới: $step1.output.url")

4. VALIDATION (4 lớp)
   JSON parse → Schema validate → Semantic validate → Security validate
   Fail → retry 1 lần với error message → vẫn fail → báo lỗi user

5. PREVIEW (interactive card trong chat)
   Hiển thị từng bước với tool, args, mô tả
   High-risk tools (gmail.send_email) có preview chi tiết riêng
   [Duyệt] [Sửa] [Hủy]

6. USER APPROVAL
   Approve gắn với plan hash (SHA-256, deterministic via json-stable-stringify)
   TTL 30 phút
   "Sửa" = chat feedback → AI sinh plan mới → preview mới

7. EXECUTION (tuần tự, per-step state, ACID transactions)
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
│   ├── tool-schemas/     ← MỚI: schema & types cho tools (shared giữa planner+executor)
│   ├── tool-adapters/    ← MỚI: HTTP clients & SDK adapters (chỉ executor dùng)
│   ├── planner/          ← MỚI: AI planner (import tool-schemas, KHÔNG import tool-adapters)
│   └── executor/         ← MỚI: execution engine (import cả tool-schemas + tool-adapters)
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
- Không có multi-agent phức tạp (chỉ dùng LLM Router + Planner)
- Không có real-time collaboration (1 user, 1 conversation tại 1 thời điểm)
- Không có runtime conditional branching trong plan (xử lý qua clarification)
- **Không hỗ trợ runtime dynamic loops**: Hệ thống chỉ xử lý Static DAG. Yêu cầu
  "xóa tất cả cards nhãn Done" sẽ bị refuse vì AI cần biết chính xác ID từng phần
  tử lúc lập Plan. Số lượng không xác định → không hỗ trợ.
- Không maintain hoặc sửa code v2

---

## 4. AI Planner & Tool Catalog

### 4.1. Kỹ thuật sinh plan

**Kiến trúc 2 chế độ (State Machine rõ ràng):**

- **CHAT MODE (Gather/Clarify multi-turn):**
  - **Prompt Injection Protection:** Dùng LLM nhẹ hoặc regex filter đánh giá an
    toàn intent đầu vào trước khi xử lý.
  - LLM hoạt động như chatbot có function calling (chỉ `search_*` tools có limit).
  - Thu thập IDs, hỏi user nếu cần làm rõ (Clarification). Lặp nhiều lượt.
  - Kết quả lưu vào Working Memory (JSON object) và messages (role="system").
  - Skip ngay nếu user đã cung cấp đủ thông tin.

- **PLAN MODE (1-shot structured output):**
  - Khi đã gom đủ context → chốt lại, chuyển sang PLAN MODE.
  - **Hierarchical Planning:** LLM Router phân loại intent → xác định subset
    services cần dùng (VD: chỉ Trello + Slack) → giảm tải context window.
  - **Planner LLM:** Nhận subset tools + system prompt (kèm few-shot examples)
    + Working Memory.
  - LLM dùng **Self-Correction/Thinking layer** — viết reasoning trước khi
    output JSON plan. Bắt buộc sinh toàn bộ plan trong 1 call.

**Tại sao 2 chế độ:** Gather cần multi-turn (hỏi/trả lời linh hoạt). Plan cần
1-shot (toàn bộ plan để preview). Trộn 2 cái vào 1 flow tạo state machine bất
định, rất khó debug.

### 4.2. Tool Catalog

**Đợt 1 (Phase 1) — 2 services, token-based auth, 11 tools:**

| Service | Auth | Tools |
|---|---|---|
| **Trello** | API key + token | `search_boards` (query, limit), `search_lists` (query, limit), `search_members` (query, limit), `search_cards` (query, limit), `get_card`, `create_card` (W), `update_card` (W), `add_member` (W), `add_checklist` (W) |
| **Slack** | Bot token | `search_channels` (query, limit), `send_message` (W) |

Tổng Đợt 1: **6 read + 5 write = 11 tools** trên 2 services.

(W) = write, side effect.

*Read tools BẮT BUỘC nhận tham số `query` + `limit` (max 10) để tránh tràn LLM
context. Không có tool `list_*` trả toàn bộ data.*

**Đợt 2 (Phase 7) — Khả năng mở rộng bắt buộc và catalog ứng viên (PAT/Service Account):**

Ít nhất một trong các tích hợp bổ sung phải được hoàn thiện để đóng tiêu chí mục 1.4. Bảng dưới là catalog dự kiến; không xác nhận cả hai đã có mã nguồn.

| Service | Auth | Tools |
|---|---|---|
| **GitHub** | Personal Access Token | `search_repos`, `search_issues`, `get_issue`, `create_issue` (W), `add_label` (W) |
| **Google Sheets** | Service Account | `read_range`, `append_row` (W), `update_cell` (W) |

Tổng Đợt 2: **4 read + 4 write = 8 tools** trên 2 services.

**Đợt 3 (Phase 8, OPTIONAL) — Cần OAuth2 infrastructure:**

| Service | Auth | Tools |
|---|---|---|
| Gmail | OAuth2 | `send_email` (W, HIGH-RISK) |
| Google Calendar | OAuth2 | `search_events`, `create_event` (W) |
| Notion | Integration token / OAuth2 | `search_databases`, `query_database`, `create_page` (W) |

### 4.3. Tool Definition Schema

```typescript
interface ToolDefinition {
  name: string;                   // "trello.create_card"
  service: string;                // "trello"
  description: string;            // mô tả cho AI hiểu khi nào dùng
  sideEffect: "read" | "write";
  riskLevel: "low" | "medium" | "high";
  inputSchema: JSONSchema;        // args cần truyền
  outputSchema: JSONSchema;       // output trả về — MÔ TẢ RÕ trong prompt
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
  thinking: string;          // Self-Correction: LLM giải thích logic, dependencies
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

### 4.5. Validation Pipeline (4 lớp) & Few-Shot Prompting

Để giải quyết LLM sinh `$ref` cross-step khó và tránh hallucinate:

1. **Few-shot examples:** System prompt BẮT BUỘC chứa 3-5 ví dụ JSON plan hoàn
   chỉnh minh họa cách dùng `$ref`. Khai báo rõ output schema per tool:
   *"trello.create_card returns {id: string, url: string}"*
2. **Thinking Layer:** LLM viết reasoning vào trường `thinking` TRƯỚC khi list steps.

**Validation (4 lớp):**

```
LLM output
  → Lớp 1: JSON parse (reject nếu invalid JSON)
  → Lớp 2: Schema validate (reject nếu thiếu/sai field type)
  → Lớp 3: Semantic validate:
      • Tool tồn tại trong subset catalog?
      • Args khớp tool inputSchema?
      • $ref trỏ đến step đã khai báo + field trong outputSchema?
      • DAG acyclic? (depends_on không vòng lặp)
      • Tối đa 10 steps?
  → Lớp 4: Security validate (chặn prompt injection escape/override)
  → Fail bất kỳ lớp → retry 1 lần với error message
  → Retry cũng fail → báo lỗi user, KHÔNG chạy plan sai
```

### 4.6. Name Resolution

AI resolve tên gọi thành ID thật qua `search_*` tools trong CHAT MODE:

| Case | Xử lý |
|---|---|
| Exact match (1 kết quả) | Dùng luôn, lưu vào Working Memory |
| Ambiguous (nhiều kết quả) | AI hỏi clarification |
| No match | AI hỏi: "Không tìm thấy X. Có: A, B. Chọn ai?" |
| Fuzzy match | AI hỏi: "Bạn có phải muốn nói X?" |

Name resolution xảy ra TRƯỚC Plan Mode. Plan chỉ chứa ID từ Working Memory.

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
    workingMemory: Record<string, any>;  // Entities đã resolve
    signal: AbortSignal;
  }): AsyncIterable<string>;  // streaming response
}

class GeminiProvider implements LLMProvider { ... }
class OpenAIProvider implements LLMProvider { ... }
```

**Chính sách Model đồng nhất:**
- Bắt buộc dùng **1 model duy nhất** cho dev, eval, và production (tránh prompt
  overfit khi đổi model).
- Đề xuất: `gemini-1.5-pro` hoặc tương đương cho Plan Mode. LLM Router ở Chat
  Mode có thể dùng model nhanh hơn (Flash).

### 4.9. Context & Working Memory Management

**Working Memory (JSON Object):**
- Hệ thống duy trì Working Memory lưu entities đã resolve qua `search_*`:
  `{"board": {"name": "Frontend", "id": "abc123"}, "members": [{"name":"Minh", "id":"m1"}]}`
- Khi conversation vượt 10 messages:
  - KHÔNG nén data quan trọng (IDs, params) vào text summary
  - LLM chỉ tóm tắt *ngữ cảnh hội thoại* (user muốn gì, mục tiêu)
  - Data IDs giữ an toàn trong Working Memory
- Mỗi LLM Planner call gửi: System prompt (kèm few-shot) + Tool Catalog (subset)
  + Working Memory + Conversation Summary + 10 messages gần nhất + Execution State

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
3. Call tool adapter (inject credentials, timeout: 15s read / 30s write). Gắn
   structured logging / request ID (trace context).
4. Validate response (linh hoạt, chấp nhận extra fields)
5. **ACID Transaction:** Persist step result + update plan status trong 1 DB
   transaction duy nhất → tránh data anomaly khi crash
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
| Low | create_card, add_member, add_checklist, update_card, create_issue, add_label | Approval 1 lần cho toàn bộ plan |
| Medium | send_message, update_cell, append_row | Approval plan + highlight trong preview |
| High | send_email (Đợt 3) | Preview nội dung đầy đủ + xác nhận riêng per step |

### 5.7. Plan Approval

```typescript
interface PlanApproval {
  planId: string;
  planHash: string;      // SHA-256, verify trước execution
  decision: "pending" | "approved" | "rejected" | "expired";
  expiresAt: string;     // 30 phút từ lúc tạo preview
}
```

Quy tắc:
- Plan hash dùng `json-stable-stringify` (canonical key order) để đảm bảo
  deterministic. HOẶC lưu raw string gốc từ LLM vào `plan_text TEXT`, hash trên
  string đó.
- Verify `sha256(data) === plan_hash` trước execution
- Hết hạn 30 phút → plan expired → user tạo plan mới
- Mỗi conversation chỉ 1 plan pending tại 1 thời điểm
- "Sửa" = user chat feedback → AI sinh plan MỚI → approve plan mới

### 5.8. Crash Recovery

- Mỗi step status persisted vào DB ngay khi thay đổi. Executor phải `await` ghi `running` thành công trước khi gọi adapter; ghi chưa xong hoặc thất bại thì không dispatch. Bất biến này bảo đảm step còn `pending` sau đối soát chưa từng được gửi tới dịch vụ.
- Khi server khởi động lại sau khi tiến trình thực thi cũ đã dừng, đối soát PostgreSQL trong một transaction trước khi nhận request. Phạm vi là các plan `approved`, `executing`, `stopping`, `partial`, `unknown`, `reconciliation_required`; không sửa plan chờ duyệt hoặc đã kết thúc. Cơ chế này áp dụng cho một API instance, chưa cung cấp lease/fencing cho nhiều replica.
- Step `running` bị gián đoạn, dù read hay write, chuyển thành `unknown`, ghi lý do restart và thời điểm hoàn tất. Giữ nguyên các step `pending`, `succeeded`, `skipped`, `failed`. Không tự retry step hoặc tiếp tục plan khi startup.
- Plan có step `unknown` chuyển thành `reconciliation_required`. Với plan `approved`, `executing`, `stopping`, `unknown` không còn `running`/`unknown`: nếu snapshot đầy đủ, hash và `plan_text`/`plan_json` hợp lệ, mọi dòng khớp step của plan đã duyệt và đều `succeeded`/`skipped`, đổi plan thành `completed` mà không gọi adapter. Các trường hợp khác chuyển thành `reconciliation_required`, kể cả chưa có dòng step hoặc mọi step còn `pending`. Không tạo step `unknown` giả để biểu diễn trường hợp chưa bắt đầu. Plan `partial` chỉ có lỗi đã rõ (`failed`, không có `unknown`/`running`) giữ nguyên `partial`.
- Đối soát phải idempotent; log chỉ chứa id plan và số step vừa chuyển thành `unknown`, không chứa argument/output. Nếu transaction lỗi, rollback và không mở HTTP listener.
- API trạng thái trả `pausedStepId` của step `unknown` đầu tiên theo thứ tự plan; với plan `partial` chỉ có lỗi đã rõ, trả step `failed` đầu tiên. Thông báo user kiểm tra; step `unknown` không được retry. Khôi phục controller và thao tác skip/stop là W2-02. W2-05 thêm `POST /api/executions/:planId/continue` cho plan `reconciliation_required`: snapshot phải đầy đủ, khớp plan đã duyệt và hash hợp lệ, không có `unknown`/`running`/`failed`, còn ít nhất một `pending`. Claim bằng cùng CAS của W2-02, đọc lại và kiểm tra snapshot sau claim, dựng controller từ trạng thái/output đã lưu rồi chỉ chạy `pending`. Plan chưa có dòng step, snapshot thiếu/trùng/không hợp lệ hoặc không đúng trạng thái bị từ chối 409; sai owner trả 403. Snapshot không đủ điều kiện Continue vẫn cho Stop. Không tự tạo dòng step khi khôi phục.
- W2-02 dựng lại controller từ đủ các dòng step khớp plan đã duyệt; giữ status/output của step `succeeded` để phân giải `$ref`/`$template`, không chạy lại step `succeeded`/`skipped`. Trước khi tiếp tục, kiểm tra hash và tính nhất quán `plan_text`/`plan_json`, kiểm tra quyền sở hữu. Snapshot thiếu, trùng hoặc còn `running` bị từ chối 409 trước khi dispatch; vẫn cho Stop an toàn. Không tự chạy một step `failed`/`unknown` khác khi tiếp tục: dừng ở đó để chờ quyết định tiếp theo.
- Khôi phục mới phải claim plan bằng SQL CAS theo owner, hash, status và revision của dòng plan (`xmin` PostgreSQL), rồi đọc lại step từ DB trước dispatch. Request tranh chấp/stale trả 409. Claim không thay thế lease/fencing nhiều replica; executor cũ phải đã dừng. Plan đã duyệt `partial` có lỗi rõ cho retry/skip; `reconciliation_required` có UNKNOWN cho skip hoặc Stop. Stop sau restart đóng plan thành `stopped`, giữ nguyên bằng chứng UNKNOWN và mọi step chưa chạy; Stop một lệnh đang chạy vẫn dùng AbortSignal và giữ `reconciliation_required` nếu kết quả ghi không rõ.
- API `GET /api/conversations/:convId/executions/latest` chỉ trả execution của chủ hội thoại, kể cả execution đã kết thúc: `{ plan, execution, steps, recoveryActions }`. `plan` gồm nội dung đã lưu với `id`, `convId`, `status`; `execution` gồm `status`, `pausedStepId` nếu có; mỗi step gồm `stepId`, `tool`, `status`, `output`, `error`, `startedAt`, `completedAt`, `durationMs`. `recoveryActions` là `['skip','stop']` cho UNKNOWN, `['retry','skip','stop']` cho partial lỗi rõ, `['continue','stop']` cho snapshot đủ điều kiện W2-05, `['stop']` cho dữ liệu chưa bắt đầu/không hợp lệ cần đối soát, và `[]` khi đã kết thúc. UI chỉ hiện "Chạy tiếp các bước còn lại" khi có `continue`, giải thích không có kết quả chưa rõ và bước còn lại chưa từng được gửi; khi request đang chạy thì khóa thao tác và tải lại snapshot sau kết quả, không báo hoàn thành lạc quan. API snapshot không tự chạy adapter và là hợp đồng để W2-04 tải lại UI; không đổi endpoint plan pending hiện có.

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
  • Encrypted at rest: AES-256-GCM (authenticated encryption)
    Format versioned: v1:base64(iv):base64(auth_tag):base64(ciphertext)
  • Server-side only — không bao giờ trong prompt, plan, preview, log, browser
  • Token expired → adapter fail → step pause → user thông báo fix

Bảo mật & Phân quyền (Allowed Scope):
  • Rủi ro Data Leakage: Shared credentials → user có thể yêu cầu AI truy xuất
    dữ liệu nhạy cảm (private channels, private boards)
  • Giải pháp: Admin cấu hình Allowed Scope — whitelist boards, channels, repos
    mà token được phép truy cập. Requests ngoài scope bị chặn ở mức Adapter.
  • Giới hạn MVP: không có per-user OAuth. Trace user trong
    execution_steps.requested_by. Rủi ro phải thông báo rõ cho admin khi setup.
```

### 5.12. Rate Limiting

Mỗi adapter built-in rate limiter theo spec service:
- Trello: 100 req / 10s
- Slack: ~1 req/s cho chat.postMessage
- GitHub: 5000 req / hour
- Google APIs: varies

**Global Rate Limiter:** Do dùng Shared Credentials, cần global queue cho mỗi
service thay vì per-instance → tránh đụng trần API khi nhiều users concurrent.

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
3. **Gather Progress** — collapsible, hiện search tool đang gọi + kết quả
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

1. Hiển thị service cards với nút [Kết nối] + step-by-step wizard
2. Mỗi service: hướng dẫn với screenshot chỉ chỗ copy API key
3. Nút [Kiểm tra kết nối] verify credentials thật
4. Cần kết nối ≥1 service để vào chat

### 6.5. Empty State

Dynamic suggestion chips dựa trên connected services — chỉ hiện suggestions
khả thi (có Trello → gợi ý Trello, có Trello + Slack → gợi ý cross-service).

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

6 bảng (PostgreSQL, sử dụng Connection Pooling):

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
  plan_json   JSONB NOT NULL,             -- toàn bộ plan steps (parsed)
  plan_text   TEXT,                       -- raw string gốc từ LLM (cho hash)
  plan_hash   TEXT NOT NULL,              -- SHA-256 trên plan_text hoặc stable-stringify
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
  service     TEXT NOT NULL,              -- "trello", "slack"
  user_id     UUID REFERENCES users(id), -- NULL = shared
  config      TEXT NOT NULL,             -- encrypted: v1:iv:tag:ciphertext
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Performance Indexes
CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_messages_conv_id ON messages(conv_id);
CREATE INDEX idx_plans_conv_id ON plans(conv_id);
CREATE INDEX idx_execution_steps_plan_id ON execution_steps(plan_id);
```

---

## 8. API Design

### 8.1. Authentication

```
POST   /api/auth/login     → { access_token: "jwt...", refresh_token: "..." }
POST   /api/auth/refresh   → { access_token: "jwt..." }
GET    /api/auth/me         → { user }
```

Admin tạo tài khoản qua CLI/seed script. Không có đăng ký tự do.
JWT Access Token có TTL ngắn. Refresh token hỗ trợ revocation khi cần.

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

SSE tách khỏi POST. POST trả về ngay.

**SSE Reliability:**
- **Enforce SSE-first:** Client BẮT BUỘC mở SSE thành công TRƯỚC khi POST /messages
- **Event sequencing:** Mỗi event gắn `sequence_id`. Khi reconnect, client gửi
  `Last-Event-ID` → server push bù events bị mất.
- **Memory leak protection:** Handler lắng nghe `req.on('close')` dọn resources.
  Hỗ trợ graceful shutdown.

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

### 8.4. Plans & Execution

```
POST   /api/plans/:id/approve                        → Duyệt
POST   /api/plans/:id/reject                          → Từ chối
POST   /api/executions/:planId/start                  → Bắt đầu execution
POST   /api/executions/:planId/steps/:stepId/retry    → Retry step
POST   /api/executions/:planId/steps/:stepId/skip     → Skip step
POST   /api/executions/:planId/stop                   → Dừng execution
```

**Race Condition Protection (Optimistic Locking):**
```sql
UPDATE plans SET status = 'approved', decided_at = now()
WHERE id = $1 AND status = 'pending' RETURNING id;
-- Row count = 0 → đã approved/rejected → abort, không execute lặp
```

### 8.5. Services

```
GET    /api/services                        → List services + trạng thái
POST   /api/services/:name/connect          → Lưu credentials
POST   /api/services/:name/test             → Test connection
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
Phase 0 → Phase 1 → Phase 2a/2b ⭐ → Phase 3 → Phase 4 → Phase 5 → Phase 6
                     (CRITICAL)                                        │
                                                Phase 7 (REQUIRED) → Phase 8 (OPT)
```

### 9.2. Chi tiết từng Phase

**Phase 0: Foundation**
- Tái dùng infrastructure (monorepo, Docker, build tools)
- Tạo workspace mới (chat-api, chat-web, packages mới)
- Auth module (users, login, JWT + refresh middleware)
- Health check endpoint
- **Setup test accounts** (Trello board test, Slack workspace test) — blocker Phase 1
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

*Phase 2a: DB Foundation*
- PostgreSQL schema v3 (6 tables, 1 migration)
- DB repositories cho users, conversations, messages, plans, execution_steps, creds
- Context management (lưu/lấy history, Working Memory từ DB)

*Phase 2b: AI Planner Core*
- LLM provider abstraction (Gemini adapter)
- System prompt v1 (kèm few-shot examples)
- Chat Mode: gather (search tools) + clarification flow
- Plan Mode: structured output + thinking layer
- LLM Router (hierarchical planning)
- 4-layer validation
- Name resolution
- Working Memory management
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
- Per-step state persistence (crash recovery, ACID transactions)
- Intent dedup
- Overall timeout (3 phút)
- Integration tests (mock adapters + real DB)
- Demo (CLI): chạy plan → tạo resources thật → report

**Phase 4: Chat API + SSE**
- Conversation CRUD + per-user isolation
- Message endpoint (POST → 202, async processing)
- SSE stream endpoint (12 event types, sequence_id, Last-Event-ID)
- Plan approval/rejection (optimistic locking)
- Execution control (start/retry/skip/stop)
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
- SSE hook (auto-reconnect, sync, sequence tracking)
- Optimistic updates
- Settings page + connection wizard (kèm Allowed Scope config)
- Onboarding page
- Empty state (dynamic suggestion chips)
- Responsive (desktop + mobile)
- Progressive loading (thinking → gather → stream)
- Demo: **FULL END-TO-END** trong browser

**Phase 6: Polish, Evaluation & Documentation**
- 3 demo scenarios end-to-end (Trello + Slack workflows)
- Final evaluation report (50 prompts, versioned)
- Error handling demos
- Performance metrics
- README + API docs + architecture docs

**Phase 7 (REQUIRED): Tổng quát hóa tích hợp và workflow ba dịch vụ**
- Registry cho metadata dịch vụ, tool catalog, adapter và kiểm tra cấu hình/phạm vi.
- Routing/gather, API dịch vụ và cấu hình UI dùng hợp đồng mở rộng; giữ tương thích Trello/Slack.
- Hoàn thiện tối thiểu một adapter thứ ba; GitHub (5 tools) hoặc Google Sheets (3 tools) là các ứng viên.
- Kiểm chứng workflow có phụ thuộc dữ liệu qua ba dịch vụ và các ca thiếu quyền, timeout, lỗi một phần.
- Đóng các tiêu chí mục 1.4 bằng evidence thực tế; các tích hợp còn lại tiếp tục theo nguồn lực.

**Phase 8 (OPTIONAL): Đợt 3 Adapters (OAuth2)**
- OAuth2 infrastructure (consent screen, token refresh)
- Gmail adapter (HIGH-RISK, extra confirmation UX)
- Calendar adapter
- Notion adapter

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

Demo dưới đây là mốc của đợt đầu với hai dịch vụ. Nghiệm thu toàn bộ phạm vi nền tảng còn phải đạt Phase 7 và mục 1.4.

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
| Demo scenarios | 3 end-to-end trên real services; ít nhất một workflow đi qua ba dịch vụ theo mục 1.4 |

---

## 11. Risks & Mitigations

| Risk | Xác suất | Impact | Mitigation |
|---|---|---|---|
| AI sinh plan sai/kém | Cao | 🔴 | Phase 2 gate. Thinking layer + few-shot. Không tiến nếu < 60% |
| LLM rate limit/cost | TB | 🟡 | 1 model xuyên suốt. Cache gather. Working Memory giảm calls |
| External API thay đổi | Thấp | 🟡 | Adapter pattern isolate. Output schema linh hoạt |
| Test account setup | TB | 🟡 | Setup trong Phase 0, trước khi code |
| UI phức tạp | TB | 🟡 | SSE state machine. Components nhỏ, độc lập |
| Scope creep | Cao | 🟡 | Đợt 1 có 2 services; Phase 7 bắt buộc chứng minh mở rộng với dịch vụ thứ ba. Số tích hợp tiếp theo và Phase 8 được giới hạn theo nguồn lực |
| Prompt regression | TB | 🟡 | Prompt versioning + evaluation tracking |
| Data leakage (shared creds) | TB | 🟡 | Allowed Scope whitelist. Document rủi ro |
| Plan hash non-deterministic | TB | 🟡 | json-stable-stringify hoặc plan_text raw |
| SSE race conditions | TB | 🟡 | sequence_id + Last-Event-ID + SSE-first protocol |

---

## 12. So sánh v2 vs. v3

| Khía cạnh | v2 | v3 |
|---|---|---|
| Đầu vào | Google Sheet có cột cố định | Chat ngôn ngữ tự nhiên |
| AI capability | 1/3 branch cố định, 1 tool | Chọn từ 11+ tools, sinh multi-step plan |
| Workflow | 1 bước | 1-10 bước trên nhiều dịch vụ |
| Services | 1 Sheet + 1 Trello | 2+ services (mở rộng qua phases) |
| AI Architecture | Flat 1-call | LLM Router + Planner + Working Memory |
| Giá trị | Âm (chậm hơn trực tiếp) | Dương (1 câu = 4-5 thao tác thủ công) |
| Safety model | 14 migrations, TTL/hash/ledger/reconciliation | 6 tables, plan hash + ACID + optimistic locking |
| Xứng tên "AI Workflow Automation Platform" | Không | Có |
