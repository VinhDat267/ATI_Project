# Gmail và kiểu "trả lời" · Quy tắc chung cho GMAIL-01 → GMAIL-04 và ANS-01

**Đặc tả:** [Gmail theo kết nối riêng và kiểu phản hồi "trả lời"](../../superpowers/specs/2026-10-13-gmail-personal-connections-design.md), duyệt 13/10/2026. Task card chỉ chia việc và chốt chỗ nối giữa các task. Khi card và đặc tả lệch nhau, làm theo đặc tả và báo reviewer trong PR.

Đọc file này trước task card của mình.

## 1. Ai làm gì

| Task | Người làm | Phụ thuộc | Xong trước |
|---|---|---|---|
| [GMAIL-01](GMAIL-01-personal-connection.md) kết nối Gmail riêng (backend) | nhóm trưởng (`VinhDat267`) | không | 18/10 |
| [GMAIL-02](GMAIL-02-gmail-tools.md) công cụ Gmail | nhóm trưởng | GMAIL-01 | 21/10 |
| [ANS-01](ANS-01-read-answers.md) kiểu phản hồi "trả lời" | `longnguyen005` | W4-00b (cùng người, cùng `validator.ts`) | 21/10 |
| [GMAIL-03](GMAIL-03-gmail-ui.md) giao diện Gmail | `longnguyen005` | GMAIL-01 (API); GMAIL-02 (browser test, nhãn người nhận) | 23/10 |
| [GMAIL-04](GMAIL-04-measure-and-live.md) đo riêng, nghiệm thu Google thật, bật cờ | nhóm trưởng | bốn task trên | 28/10 |
| Tạo Google Cloud project cho Gmail (việc của con người, GMAIL-04 bước 1) | nhóm trưởng | không | 21/10 |

Thứ tự merge dự kiến: W4-00b → GMAIL-01 và ANS-01 (song song) → GMAIL-02 → GMAIL-03 → GMAIL-04.

## 2. Quy tắc bắt buộc

- **Hai cờ mặc định tắt:** `GMAIL_ENABLED=off`, `PLANNER_READ_ANSWERS=off`. Không PR nào trước PR bật cờ của GMAIL-04 đổi mặc định.
- **Cờ tắt thì không có gì đổi:**
  - toàn bộ test và browser test hiện có đạt không sửa assertion;
  - routing offline 116 câu cho đúng kết quả cũ;
  - `ALL_TOOLS` và `SERVICE_REGISTRY` vẫn 33 tool / 8 dịch vụ;
  - bộ golden và hash catalog trong report không đổi.
- Không bật cờ trên máy chạy buổi thử W4-03 (23–25/10).
- **TDD:** test RED commit riêng, hoặc output fail thật dán trong log. Logic DB test trên PostgreSQL thật. Hủy và hết thời gian test bằng `AbortSignal` thật. Không mock hình thức.
- **Google giả:** máy chủ HTTP cục bộ `scripts/fake-google-gmail.mjs`, cổng 0, báo sẵn sàng bằng một dòng JSON như `scripts/fake-oidc.mjs`. GMAIL-01 tạo phần OAuth (authorize, token, revoke, profile). GMAIL-02 thêm Gmail API. Test API và browser dùng chung máy chủ này.
- **Không lộ bí mật:** log, body lỗi, SSE, `report.json` không chứa access token, refresh token, `code`, `state`, `code_verifier`. Test quét các nơi này bằng một chuỗi mẫu dễ nhận (ví dụ `ya29.SENTINEL-GMAIL-TOKEN`).
- **Không gọi Google thật** trước GMAIL-04. Trong GMAIL-04 chỉ gửi thư tới địa chỉ của nhóm, theo kế hoạch người dùng duyệt đúng hash.
- **Bằng chứng thật** để ở `docs/ai-evidence/GMAIL-LIVE/` (đã ignore), không commit.
- **Đột biến:** mỗi task chạy các đột biến của phần mình ở đặc tả mục 6.3, ghi kết quả vào log. Mỗi đột biến phải bị ít nhất một test bắt.
- Mô tả PR và commit không có dòng "Generated with …" hay chữ ký AI.

## 3. File nhiều task cùng sửa

| File | Task |
|---|---|
| `packages/tool-schemas/src/types.ts` | GMAIL-01, ANS-01 |
| `packages/planner/src/planner.ts` | GMAIL-01 (chuyển `actor`), GMAIL-02 (`observedFields`, `__labels`), ANS-01 (luồng trả lời) |
| `packages/planner/src/validator.ts` | W4-00b, GMAIL-02 (người nhận), ANS-01 (`answer`) |
| `apps/chat-api/src/services/chat-service.ts` | GMAIL-01 (`actor`, `connections`), ANS-01 (lưu câu trả lời, bọc lịch sử) |
| `apps/chat-api/src/server.ts`, `apps/chat-api/src/config/env.ts` | GMAIL-01, GMAIL-02, ANS-01 |
| kịch bản sandbox (`SANDBOX_SCENARIO`) và `scripts/test-v3-browser.mjs` | GMAIL-02 (kịch bản `gmail`), ANS-01 (kịch bản `answer`), GMAIL-03 (nhóm browser `gmail`) |
| `apps/chat-web/src/pages/Cockpit/`, `services/cockpit-moment.ts`, `hooks/use-sse.ts`, `store/chat-store.ts` | ANS-01, GMAIL-03 |

Quy tắc:
- Rebase lên `main` mới nhất trước khi mở PR và trước khi xin review lại.
- Ai merge sau thì giải xung đột. Khi giải, giữ nguyên hành vi và test của task đã merge; không sửa phần của task kia.

## 4. Chỗ nối giữa các task

Các tên và kiểu dưới đây là hợp đồng. Muốn đổi thì sửa file này trong PR của mình và báo người làm task kia.

### 4.1. Kiểu chung (GMAIL-01 tạo, `packages/tool-schemas/src/types.ts`)

```ts
export interface ToolDefinition {
  // …các trường hiện có
  /** Ghi đè KEPT_FIELDS khi ghi kết quả tra cứu vào bộ nhớ làm việc. */
  observedFields?: string[];
}

export interface ServiceDefinition {
  // …các trường hiện có
  /** Thiếu nghĩa là 'shared' (8 dịch vụ cũ). */
  connection?: 'shared' | 'personal';
}

export interface PlanConnections {
  gmail?: { credentialId: string; email: string };
}

export interface PlanResponse {
  // …các trường hiện có
  /** Chỉ server ghi, sau validator, trước khi tính plan_hash. */
  connections?: PlanConnections;
}
```

`GMAIL_SERVICE` (`registry/gmail.ts`) và `GMAIL_TOOLS` (`gmail.ts`) export từ `@wap/tool-schemas`, **không** nằm trong `ALL_TOOLS`, `TOOL_MAP` hay `SERVICE_REGISTRY`.

### 4.2. API kết nối (GMAIL-01 làm, GMAIL-03 dùng)

Mọi route dưới `/api/connections/gmail` trả **404** khi cờ tắt, **503** khi cờ bật mà Gmail chưa sẵn sàng ở sandbox. Route `start` và `DELETE` cần access token. `callback` cần access token và cookie trình duyệt `ati_gmail_browser` (path `/api/connections/gmail`).

| Route | Thành công | Lỗi |
|---|---|---|
| `POST /api/connections/gmail/start` | `200 { url }` | `401 INVALID_SESSION` |
| `POST /api/connections/gmail/callback`, body `{ code, state }` | `200 { email }` | `400` với `code` là `GMAIL_STATE_INVALID` (hết hạn, đã dùng, sai luồng, sai người/phiên/trình duyệt), `GMAIL_SCOPE_MISSING`, `GMAIL_REFRESH_TOKEN_MISSING` hoặc `GMAIL_CONNECT_FAILED`; `401 INVALID_SESSION` |
| `DELETE /api/connections/gmail` | `200 { success: true }`, kể cả khi chưa kết nối | `401 INVALID_SESSION` |

`GET /api/services`: mỗi dịch vụ thêm `connection`. Gmail chỉ có trong danh sách khi Gmail dùng được (cờ bật, đủ cấu hình OAuth và có PostgreSQL), và luôn là của chính người gọi:

```ts
interface ServiceItemAdditions {
  connection: 'shared' | 'personal';
  // chỉ khi connection === 'personal':
  personalStatus?: 'connected' | 'reconnect_required' | 'not_connected';
  email?: string;        // địa chỉ Gmail đã kết nối
  connectedAt?: string;  // ISO 8601
}
```

`GET /api/health` (công khai) thêm `gmailEnabled: boolean` khi cờ bật (`true` khi Gmail dùng được, `false` khi thiếu cấu hình). Khi cờ tắt, phản hồi giữ đúng như cũ, không có trường này; giao diện coi thiếu là `false`. (Chỉnh trong GMAIL-01: cờ tắt thì không có gì đổi.)

### 4.3. Kế hoạch và nhãn xem trước (GMAIL-01, GMAIL-02 làm; GMAIL-03 dùng)

- Kế hoạch có bước Gmail luôn có `plan.connections.gmail = { credentialId, email }`. Giao diện hiện "Gửi từ: <email>".
- `resourceLabels` (ngoài hash), GMAIL-02 điền:
  - `resourceLabels[<threadId>]` = tiêu đề luồng, theo cách các dịch vụ khác đang hiện tên tài nguyên;
  - `resourceLabels['recipient:' + <địa chỉ chữ thường>]` = `'user'` khi người dùng đã gõ địa chỉ đó, hoặc `'thread:' + <tiêu đề luồng>` khi lấy từ người tham gia của luồng.
- Giao diện:
  - `'user'` hiện "bạn đã gõ";
  - `'thread:…'` hiện "lấy từ luồng thư '…'";
  - nguồn `thread:` ở bước `gmail.send_message` hoặc `gmail.forward` có cảnh báo (đặc tả mục 4.2).
- Bước Gmail ở trạng thái `unknown` có link "Mở thư mục Đã gửi": `https://mail.google.com/mail/?authuser=<email đã encodeURIComponent>#sent`.

### 4.4. Adapter (GMAIL-01 làm phía token, GMAIL-02 làm adapter)

```ts
// GMAIL-01 cài trong apps/chat-api; adapter của GMAIL-02 chỉ dùng interface này.
export interface GmailAccessTokenProvider {
  /** Làm mới khi còn dưới 60 s hoặc khi forceRefresh. Lỗi mang `category` như adapter hiện có:
   *  AUTH_ERROR khi grant đã mất (bản ghi chuyển reconnect_required), NETWORK hoặc SERVER_ERROR khi làm mới lỗi. */
  getAccessToken(options?: { signal?: AbortSignal; forceRefresh?: boolean }): Promise<string>;
}

// apps/chat-api/src/services/adapter-factory.ts
export interface AdapterContext {
  userId?: string;
  phase: 'planning' | 'execution';
  /** Bắt buộc khi phase = 'execution' và dịch vụ là Gmail. */
  connections?: PlanConnections;
}
// getAdapterForService(serviceName: string, context?: AdapterContext): Promise<AdapterExecutor>
// new AdapterFactory({ …, createGmailAdapter?: (input: { userId: string; tokens: GmailAccessTokenProvider }) => AdapterExecutor })
```

GMAIL-01 không truyền `createGmailAdapter` trong `server.ts`; test của GMAIL-01 truyền một adapter thử ghi lại các lần gọi. GMAIL-02 truyền adapter thật (live) và adapter giả (sandbox).

Chỗ đặt sau GMAIL-01:
- `GmailAccessTokenProvider` export từ `@wap/tool-adapters` (`packages/tool-adapters/src/gmail/token-provider.ts`), vì adapter của GMAIL-02 nằm trong package này và không import được `chat-api`;
- `AdapterFactory` nhận thêm `gmailTokens` (`GmailTokenManager`) và có `clearPersonal(userId)`;
- lỗi của factory với Gmail là `StepError` loại `AUTH_ERROR` (thiếu người, chưa kết nối, kết nối đã đổi) hoặc `VALIDATION` (máy chủ chưa nối adapter Gmail), để bước ghi báo thất bại chứ không thành `unknown`.
- Lưu ý cho GMAIL-02: executor đổi `NETWORK`/`SERVER_ERROR` của tool ghi thành `unknown`. Lỗi làm mới token xảy ra trước khi gửi (bên trong `adapter.execute`) không được để lộ ra dưới dạng `NETWORK`/`SERVER_ERROR`, nếu không bước đó thành "chưa rõ kết quả" dù Gmail chưa nhận gì.

### 4.5. Kiểu "trả lời" (ANS-01 làm; GMAIL-03, GMAIL-04 dùng)

```ts
export interface AnswerLookup { tool: string; query?: string; resultCount: number; links: string[] }
export interface AnswerResponse { kind: 'answer'; text: string; lookups: AnswerLookup[]; usedDirectory: string[] }
export type PlannerResponse = PlanResponse | ClarificationResponse | RefusalResponse | AnswerResponse;
```

- SSE: sự kiện `answer` với `{ conversationId, text, lookups, usedDirectory, replyToMessageId, requestId? }`.
- Tin nhắn lưu: `role = 'assistant'`, `metadata = { type: 'answer', lookups, usedDirectory, … }`.
- `AIPlanner` thêm tuỳ chọn `readAnswers?: boolean` (mặc định `false`). GMAIL-04 dùng tuỳ chọn này cho `EVAL_SET=answers`.

## 5. Các ca dễ bị bỏ sót (reviewer kiểm riêng)

Mỗi ca có test ở task được ghi trong ngoặc.

1. Địa chỉ viết hoa khác nhau, có khoảng trắng hai đầu, hoặc dạng `"Tên" <a@b.com>`. Kỳ vọng: chuẩn hoá chữ thường, bỏ khoảng trắng, từ chối tên hiển thị; grounding so sánh không phân biệt hoa thường (GMAIL-02).
2. Tiêu đề và nội dung tiếng Việt có dấu, emoji, chạm giới hạn độ dài. Kỳ vọng: RFC 2047 giải mã đúng; cắt theo ký tự, không cắt giữa cặp UTF-16 (GMAIL-02).
3. Người dùng kết nối một Gmail khác email đăng nhập ATI, hoặc kết nối lại đúng địa chỉ cũ. Kỳ vọng: giao diện hiện địa chỉ Gmail; `credentialId` đổi nên kế hoạch cũ dừng ở bước Gmail (GMAIL-01).
4. Hai tab cùng bấm "Kết nối Gmail", hoặc callback về sau khi người dùng đã ngắt kết nối hay đăng xuất. Kỳ vọng: state dùng một lần; phản hồi muộn không ghi đè trạng thái mới, không giành điều hướng (GMAIL-01, GMAIL-03).
5. Câu chỉ đọc khi mọi tra cứu đều lỗi, hoặc dịch vụ chưa kết nối. Kỳ vọng: hỏi lại hoặc từ chối, không trả lời bằng trí nhớ của model (ANS-01).
6. Trả lời hoặc chuyển tiếp một luồng chỉ có bản nháp. Kỳ vọng: `VALIDATION` trước khi gửi, câu lỗi nói rõ (GMAIL-02).
