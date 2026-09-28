## Section 3.2: Luồng chính
```
1. USER CHAT (CHAT MODE)
   "Tạo task cập nhật homepage cho team frontend, deadline thứ 6, gán Minh, báo trên Slack"

2. AI GATHER & CLARIFY (CHAT MODE - Multi-turn)
   - Tích hợp bảo vệ Prompt Injection: kiểm tra intent an toàn trước khi xử lý.
   - Nếu AI cần context → gọi search tools: search_members(query="Minh", limit=5), search_lists(...)
   - Hiển thị progress realtime cho user.
   - Nếu Ambiguous (nhiều kết quả) → AI hỏi Clarification. User trả lời.
   - Quá trình này lặp lại cho đến khi AI gom ĐỦ context. Skip nếu user cung cấp đủ thông tin.

3. AI PLAN (PLAN MODE - 1-shot structured output)
   - Khi đã ĐỦ context, hệ thống chốt lại và chuyển sang chế độ Plan Mode.
   - Hierarchical Planning: LLM Router chọn service subset trước, giảm số tools đưa vào context.
   - Sinh plan JSON nhiều bước trong 1 LLM call, có self-correction/thinking giải thích logic.
   Ví dụ plan:
     step1: trello.create_card(title=..., due=..., listId=...)
     step2: trello.add_member(cardId=$step1.output.id, memberId="m1")
     step3: trello.add_checklist(cardId=$step1.output.id, items=[...])
     step4: slack.send_message(channel=#frontend, text="Task mới: $step1.output.url")

4. VALIDATION (4 lớp)
   JSON parse → Schema validate → Semantic validate (tool tồn tại, refs hợp lệ, DAG acyclic) → Security validate.
   Fail → retry 1 lần với error message → vẫn fail → báo lỗi user.

5. PREVIEW (interactive card trong chat)
   Hiển thị từng bước với tool, args, mô tả.
   High-risk tools (gmail.send_email) có preview chi tiết riêng.
   [Duyệt] [Sửa] [Hủy]

6. USER APPROVAL
   Approve gắn với plan hash (SHA-256, bất biến).
   TTL 30 phút.
   "Sửa" = chat feedback → AI sinh plan mới → preview mới.

7. EXECUTION (tuần tự, per-step state)
   Chạy từng step → resolve references runtime → lưu output DB.
   Stream progress realtime cho user.
   Partial failure → pause → user chọn retry/fix/skip/stop.

8. RESULT
   Summary + links tới resources đã tạo.
   AI hiểu execution state → có thể thảo luận tiếp về kết quả/lỗi.
```

## Section 3.4: Ranh giới — Không làm gì
- Không có trigger tự động / scheduler (user chủ động chat)
- Không có visual workflow editor (AI sinh plan, không kéo thả)
- Không có multi-agent phức tạp (chỉ dùng LLM Router + Planner là đủ)
- Không có real-time collaboration (1 user, 1 conversation tại 1 thời điểm)
- Không có runtime conditional branching trong plan (xử lý qua clarification)
- **Không hỗ trợ runtime dynamic loops**: Hệ thống chỉ xử lý Static DAG, không hỗ trợ vòng lặp tự động lúc chạy. Ví dụ: yêu cầu "Xóa tất cả cards nhãn Done" sẽ bị refuse hoặc yêu cầu chia nhỏ vì AI cần biết chính xác ID từng phần tử lúc lập Plan. Những yêu cầu số lượng không xác định sẽ không được hỗ trợ.
- Không maintain hoặc sửa code v2

## Section 4.1: Kỹ thuật sinh plan
**Kiến trúc xử lý rõ ràng (State Machine):**
Hệ thống được chia làm hai chế độ (Mode) với ranh giới tách biệt:

- **Phase 1 — CHAT MODE (Gather/Clarify multi-turn):**
  - **Prompt Injection Protection:** Dùng LLM nhẹ (hoặc regex filter) đánh giá an toàn intent đầu vào.
  - LLM hoạt động như chatbot thông thường có function calling (chỉ dùng `search_*` tools có giới hạn data).
  - Thu thập IDs, hỏi user nếu cần làm rõ (Clarification). Trạng thái này có thể lặp nhiều lượt chat.
  - Skip ngay phase này nếu user đã cung cấp đủ thông tin.
- **Phase 2 — PLAN MODE (1-shot structured output):**
  - Khi đã gom đủ context (IDs, Params), hệ thống chốt lại context và chuyển sang PLAN MODE.
  - **Hierarchical Planning:** Đầu tiên gọi **LLM Router** phân loại intent và xác định subset services cần dùng (vd: chỉ lấy tools của Trello + Slack), giảm tải context window.
  - **Planner LLM:** Được cung cấp subset tools, system prompt chứa **few-shot examples**, và schema rõ ràng.
  - LLM sử dụng cơ chế **Self-Correction layer (Thinking layer)** để phân tích logic trước khi output JSON plan. Bắt buộc sinh ra toàn bộ plan trong 1 call duy nhất.

## Section 4.2: Tool Catalog
**Đợt 1 — 4 services, token-based auth, ~18 tools:**

| Service | Auth | Tools |
|---|---|---|
| **Trello** | API key + token | `search_boards` (query, limit), `search_lists` (query, limit), `search_members` (query, limit), `search_cards`, `get_card`, `create_card` (W), `update_card` (W), `add_member` (W), `add_checklist` (W) |
| **Slack** | Bot token | `search_channels` (query, limit), `send_message` (W) |
| **GitHub** | Personal Access Token | `search_repos`, `search_issues`, `get_issue`, `create_issue` (W), `add_label` (W) |
| **Google Sheets** | Service Account | `read_range`, `append_row` (W), `update_cell` (W) |

*Lưu ý: Thay thế toàn bộ các hàm `list_*` thành `search_*`. Các tools đọc data BẮT BUỘC phải nhận tham số `query` và `limit` (max 10) để tránh tràn LLM context.*

(W) = write, side effect.

**Đợt 2 (OPTIONAL, Phase 7) — Cần OAuth2 infrastructure:**
| Service | Auth | Tools |
|---|---|---|
| Gmail | OAuth2 | `send_email` (W, HIGH-RISK) |
| Google Calendar | OAuth2 | `search_events`, `create_event` (W) |
| Notion | Integration token / OAuth2 | `search_databases`, `query_database`, `create_page` (W) |

## Section 4.4: Plan Format
```typescript
type PlannerResponse =
  | PlanResponse
  | ClarificationResponse
  | RefusalResponse;

interface PlanResponse {
  kind: "plan";
  thinking: string;          // Self-Correction layer: LLM diễn giải logic, step dependencies và data format trước khi xuất JSON
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

## Section 4.5: Validation Pipeline & Few-Shot Prompting
Để giải quyết việc LLM sinh biến số `$ref` cross-step khó khăn và tránh hallucinate:
1. **Few-shot examples:** System prompt BẮT BUỘC chứa 3-5 ví dụ JSON plan hoàn chỉnh minh họa chuẩn xác cách dùng `$ref` và khai báo rõ output schema của từng tool (vd: *"trello.create_card returns {id: string, url: string}"*).
2. **Thinking Layer:** LLM viết giải thích logic vào trường `thinking` trước khi list danh sách `steps`.

**Quy trình Validation (4 lớp):**
```text
LLM output
  → Lớp 1: JSON parse (reject nếu invalid JSON)
  → Lớp 2: Schema validate (reject nếu thiếu/sai field type)
  → Lớp 3: Semantic validate:
      • Tool tồn tại trong subset catalog không?
      • Args khớp tool inputSchema?
      • $ref trỏ đến step đã khai báo + field tồn tại trong outputSchema?
      • DAG acyclic? (depends_on không vòng lặp)
      • Tối đa 10 steps?
  → Lớp 4: Security validate (chặn prompt injection escape/override config)
  → Fail bất kỳ lớp nào → retry 1 lần với error message trong prompt
  → Retry cũng fail → báo lỗi cho user, KHÔNG chạy plan sai
```

## Section 4.8: Provider Abstraction
```typescript
interface LLMProvider {
  generatePlan(input: {
    systemPrompt: string;
    conversationHistory: Message[];
    toolCatalog: ToolDefinition[];
    workingMemory: Record<string, any>; // Thay thế text summary
    signal: AbortSignal;
  }): AsyncIterable<string>;  // streaming response
}

class GeminiProvider implements LLMProvider { ... }
class OpenAIProvider implements LLMProvider { ... }
```

**Chính sách Model đồng nhất:**
- Bắt buộc dùng **1 model duy nhất** cho toàn bộ vòng đời: development, evaluation, và production.
- Tránh tình trạng prompt overfit (viết prompt trên model nhỏ/nhanh rồi deploy/evaluate trên model lớn sẽ làm sai lệch cấu trúc).
- Đề xuất dùng `gemini-1.5-pro` hoặc model có reasoning tốt tương đương để xử lý Plan Mode (vì tính chất phức tạp của JSON schema và rules). LLM Router ở Chat Mode có thể dùng model nhanh hơn (như Flash).

## Section 4.9: Context & Working Memory Management
Việc tóm tắt hội thoại bằng text sẽ làm mất State (vd IDs của board hay member). Cải tiến quản lý Context:

- **Working Memory (JSON Object):**
  - Hệ thống duy trì một Working Memory lưu các entities đã được resolve qua công cụ `search_*` dưới dạng JSON rõ ràng.
  - Ví dụ: `{"board": {"name": "Frontend", "id": "abc123"}, "members": [{"name":"Minh", "id":"m1"}]}`
- Khi conversation vượt 10 messages:
  - KHÔNG nén các dữ liệu quan trọng thành văn bản.
  - LLM chỉ tóm tắt *ngữ cảnh hội thoại* (User muốn làm gì, mục tiêu cuối cùng).
  - Data IDs tiếp tục được lưu giữ an toàn trong Working Memory.
- Mỗi LLM Planner call gửi: System prompt (kèm few-shot examples) + Tool Catalog (subset) + Working Memory (JSON) + Conversation Summary + 10 messages gần nhất + Execution State.
