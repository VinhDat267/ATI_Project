# SLACK-03C1 · Bounded Read Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triển khai bộ read adapters giới hạn chặt chẽ (bounded read adapters) cho đúng 8 phương thức đọc cốt lõi ban đầu của Slack cá nhân (`myslack`), xác thực 5 trường binding server-confirmed, bảo vệ quyền truy cập theo native Slack user ACL, kiểm thực chính sách F1 hai pha (pre-fetch & post-fetch), cách ly hoàn toàn token bí mật bên trong adapter và không lưu trữ dữ liệu nguồn ngoài ý muốn (transient read, retention 0).

**Architecture:**
- **Integration Boundary:** Mã nguồn thuộc sở hữu `packages/tool-schemas/` (định nghĩa schema, JSON schema validation) và `packages/tool-adapters/` (triển khai adapter, HTTP transport, mapping lỗi). Không import trực tiếp từ `apps/` và không sửa tệp Backend.
- **Injected Hooks:** `PersonalSlackReadAdapter` nhận qua constructor các hooks inject từ backend: `SlackTokenProviderHook` (lấy access token theo binding) và `SlackPolicyValidationHook` (kiểm tra F1 policy và trạng thái kết nối active).
- **Two-Phase Policy Enforcement:** Kiểm tra chính sách và trạng thái kết nối trước khi phát HTTP request (Pre-fetch), và kiểm tra lại ngay sau khi provider phản hồi (Post-fetch) trước khi giải phóng kết quả; nếu kết nối bị revoke trong thời gian chờ -> Drop kết quả và ném lỗi `AUTH_ERROR`.
- **Native Slack ACL & Bounded Outputs:** Không dùng channel allowlist tĩnh; quyền đọc do token và membership thực tế của user quyết định. Tất cả output được phân trang cursor, giới hạn ngân sách tối đa 100 items/trang, nội dung văn bản được đánh dấu là untrusted provider data.

**Tech Stack:** Node.js `^22.12.0 || >=24.0.0`, TypeScript 5.8, Vitest 3, `@wap/tool-schemas`.
**Spec:** [Slack cá nhân và trợ lý công việc](../specs/2026-10-28-slack-personal-oauth-design.md) (Mục 2, 4.4, 4.5, 8, 9.1).
**Task Cards:** [SLACK-03C1 Core Read Adapters](../../handoff/tasks/SLACK-03C1-core-read-adapters.md), [SLACK-03 Parent Task](../../handoff/tasks/SLACK-03-tool-catalog-and-source-lifecycle.md).
**Status:** DỰ THẢO KẾ HOẠCH (Docs-only; chờ Coordinator phê duyệt trước khi lập PR thi công).

---

## 1. Bảng 8 Phương Thức Đọc & Đối Soát Inventory

Đối soát trực tiếp từ `docs/slack/method-inventory.json` (SHA256: `e55bc180eb43c71c1131dbded5968c1e240d3424fe1314bf604139055c074f09`):

| # | Phương Thức Slack | HTTP & Rate | Scopes Khai Báo Trong Inventory | Inventory Disposition | Budget Phân Trang | Output Quan Sát Bounded |
|---|---|---|---|---|---|---|
| 1 | `conversations.list` | GET / t2 | `channels:read, groups:read, im:read, mpim:read` | `probe_required` | 50 mặc định, max 100 | `channels: SlackConversationSummary[]`, `nextCursor`, `hasMore` |
| 2 | `conversations.info` | GET / t3 | `channels:read, groups:read, im:read, mpim:read` | `probe_required` | N/A (single entity) | `channel: SlackConversationDetail` |
| 3 | `conversations.history` | GET / t3 | `channels:history, groups:history, im:history, mpim:history` | `probe_required` | 20 mặc định, max 100 | `messages: SlackMessageObservation[]`, `nextCursor`, `hasMore` |
| 4 | `conversations.replies` | GET / t3 | `channels:history, groups:history, im:history, mpim:history` | `probe_required` | 20 mặc định, max 100 | `messages: SlackMessageObservation[]`, `nextCursor`, `hasMore` |
| 5 | `conversations.members` | GET / t4 | `channels:read, groups:read, im:read, mpim:read` | `probe_required` | 100 mặc định, max 100 | `memberIds: string[]`, `nextCursor`, `hasMore` |
| 6 | `users.list` | GET / t2 | `users:read` | `probe_required` | 50 mặc định, max 100 | `members: SlackUserSummary[]`, `nextCursor`, `hasMore` |
| 7 | `users.info` | GET / t4 | `users:read` | `probe_required` | N/A (single entity) | `user: SlackUserDetail` |
| 8 | `chat.getPermalink` | GET / t5 | `null` (`userToken: undetermined`) | `probe_required` | N/A (single entity) | `permalink: string`, `channel: string` |

*Ghi chú quan trọng về phạm vi:*
- 100% 8 phương thức trên giữ nguyên `disposition: probe_required` và `deliveryStatus: not_implemented` trong inventory. Schema và test fixture không chứng minh tính khả dụng native của Free/Pro.
- Các phương thức còn lại của nhóm cốt lõi (`conversations` còn 22, `chat` còn 12, `users` còn 10) tiếp tục là backlog mở trong SLACK-03C2, 03D, 03E; không bị loại bỏ ngầm.
- Không có thao tác ghi (write tools) hay outbox dispatch trong card này; cấm generic dispatcher `myslack.call(method, args)`.

---

## 2. Các Ràng Buộc Kiến Trúc & An Toàn Bắt Buộc

1. **Định danh Binding 5 Trường Bắt Buộc:** Mọi input request bắt buộc mang `binding: SlackBinding` (`atiUserId`, `connectionId`, `workspaceId`, `slackUserId`, `identityVersion`). Trả về lỗi `VALIDATION` nếu thiếu hoặc rỗng bất kỳ trường nào.
2. **Kiểm Thực Hai Pha F1:**
   - *Pha 1:* Gọi `policy.resolveReadPolicy(binding, purpose, 0)` và `policy.validateBindingActive(binding)` trước khi mở socket HTTP.
   - *Pha 2:* Gọi `policy.validateBindingActive(binding)` ngay sau khi nhận HTTP payload. Nếu phát hiện bị disconnect hoặc bumped version trong lúc await -> Hủy ngay kết quả, ném `AUTH_ERROR`.
3. **Transient Reads (Retention 0):** Adapter đọc thuần túy, không ghi vào `SlackSourceStore` (03B). Dữ liệu trả về gắn kèm `SlackBinding` và `SlackSourceRef` để consumer giữ provenance.
4. **Native User ACL:** Truy cập kênh theo quyền thực của user token trong workspace. Không duy trì channel allowlist tĩnh.
5. **An Toàn Transport & Ngăn Chặn Rò Rỉ:**
   - URL endpoint cố định trong mã nguồn. Cấm nhận URL từ phía caller.
   - Thiết lập `redirect: 'manual'` để ngăn cản việc rò rỉ Bearer token qua redirect không an toàn.
   - Bắt buộc gắn `AbortSignal` và giới hạn kích thước response tối đa 2MB.
   - Xử lý 429: đọc header `Retry-After`, giới hạn retry tối đa 2 lần. Không retry mù khi thất bại xác thực hoặc lỗi logic.
   - Token chỉ tồn tại trong bộ nhớ adapter khi gửi request; tuyệt đối không đưa token vào logs, schemas, kết quả DTO hay lỗi trả về.

---

## 3. Tệp Triển Khai & Interface Giao Ước

### 3.1. Injected Hooks Interface (`packages/tool-adapters/src/slack/personal-slack-types.ts`)
```ts
import type { SlackBinding } from '@wap/tool-schemas';

export interface SlackTokenProviderHook {
  getAccessToken(binding: SlackBinding, options?: { signal?: AbortSignal; forceRefresh?: boolean }): Promise<string>;
}

export type SlackReadPurpose = 'conversation_read' | 'member_lookup';

export interface SlackPolicyValidationHook {
  resolveReadPolicy(binding: SlackBinding, purpose: SlackReadPurpose, requestedRetentionDays: 0): Promise<{ allowed: boolean; reason?: string }>;
  validateBindingActive(binding: SlackBinding): Promise<boolean>;
}

export interface PersonalSlackAdapterConfig {
  tokens: SlackTokenProviderHook;
  policy: SlackPolicyValidationHook;
  apiBaseUrl?: string; // Mặc định https://slack.com/api, ghi đè bằng test fixture URL
  fetchFn?: typeof fetch;
  requestTimeoutMs?: number;
}
```

### 3.2. Bảng Tệp Cần Tạo / Chỉnh Sửa

| Tệp | Hành Động | Trách Nhiệm |
|---|---|---|
| `packages/tool-schemas/src/myslack-read-tools.ts` | **Create** | Định nghĩa 8 ToolDefinitions, JSON Schemas, types tham số và kết quả, hàm validate đệ quy. |
| `packages/tool-schemas/src/index.ts` | **Modify** | Export schemas/types mới (bảo toàn không thêm vào `ALL_TOOLS` / `SERVICE_REGISTRY`). |
| `packages/tool-adapters/src/slack/personal-slack-types.ts` | **Create** | Chứa types nội bộ, hook interfaces (`SlackTokenProviderHook`, `SlackPolicyValidationHook`). |
| `packages/tool-adapters/src/slack/personal-slack-read-adapter.ts` | **Create** | Lớp `PersonalSlackReadAdapter` kế thừa `BaseAdapter`, thực thi 8 methods, kiểm thực 2 pha, xử lý 429/cancellation. |
| `packages/tool-adapters/src/index.ts` | **Modify** | Export `PersonalSlackReadAdapter` và hooks interfaces. |
| `packages/tool-schemas/tests/myslack-read-schemas.test.ts` | **Create** | Unit tests cho schemas, input/output validation, từ chối tham số lạ (fail-closed). |
| `packages/tool-adapters/tests/slack/personal-slack-read.test.ts` | **Create** | Integration tests với HTTP fixture stateful: 8 methods, ACL native, token isolation, race post-fetch. |

---

## 4. Kế Hoạch Triển Khai Từng Bước (Tasks)

- [ ] **Task 1: Định Nghĩa Schema & JSON Validation cho 8 Read Tools (`packages/tool-schemas`)**
  - Tạo `packages/tool-schemas/src/myslack-read-tools.ts`.
  - Định nghĩa 8 công cụ: `myslack.conversations_list`, `myslack.conversations_info`, `myslack.conversations_history`, `myslack.conversations_replies`, `myslack.conversations_members`, `myslack.users_list`, `myslack.users_info`, `myslack.chat_getPermalink`.
  - Cấu hình metadata: `sideEffect: 'read'`, `riskLevel: 'low'`, `planTier: 'any'`, `isProbeRequired: true`, `requiresBinding: true`.
  - Triển khai hàm validation tham số đệ quy fail-closed (`validateSlackReadToolArgs`).
  - Viết unit tests tại `packages/tool-schemas/tests/myslack-read-schemas.test.ts`.
  - Chạy `npx vitest run packages/tool-schemas/tests/myslack-read-schemas.test.ts` để xác nhận tests PASS.

- [ ] **Task 2: Xây Dựng Hạ Tầng Transport & Injected Hooks An Toàn (`packages/tool-adapters`)**
  - Tạo `packages/tool-adapters/src/slack/personal-slack-types.ts` định nghĩa hooks và adapter config.
  - Tạo `packages/tool-adapters/src/slack/personal-slack-read-adapter.ts` kế thừa `BaseAdapter`.
  - Cài đặt phương thức `request(method, binding, params, purpose, signal)`:
    - Kiểm tra `binding` hợp lệ.
    - Pha 1: Gọi `policy.resolveReadPolicy` và `policy.validateBindingActive`. Nếu deny -> throw `StepError('AUTH_ERROR')`.
    - Lấy token qua `tokens.getAccessToken(binding, { signal })`.
    - Gửi HTTP GET tới `${apiBaseUrl}/${method}` với header `Authorization: Bearer <token>`, `redirect: 'manual'`.
    - Bắt lỗi timeout qua `signal`, giới hạn body 2MB.
    - Xử lý HTTP 429 và `Retry-After`.
    - Pha 2: Gọi lại `policy.validateBindingActive(binding)` sau await. Nếu không active -> throw `StepError('AUTH_ERROR')`.
    - Trả về payload đã làm sạch kèm binding provenance.

- [ ] **Task 3: Hiện Thực Hóa 8 Phương Thức Đọc Bounded & Xử Lý Native ACL**
  - Cài đặt `execute(toolName, args, context)` điều hướng vào 8 phương thức:
    - `conversationsList`: Nhận `types`, `exclude_archived`, `limit`, `cursor`. Bounded pagination.
    - `conversationsInfo`: Nhận `channel`. Trả về chi tiết kênh caller có quyền xem.
    - `conversationsHistory`: Nhận `channel`, `latest`, `oldest`, `inclusive`, `limit`, `cursor`. Xác định revision qua `edited.ts || ts`.
    - `conversationsReplies`: Nhận `channel`, `ts`, phân trang thread.
    - `conversationsMembers`: Nhận `channel`, trả về `memberIds` phân trang.
    - `usersList`: Trả về danh sách thành viên workspace đã làm sạch.
    - `usersInfo`: Nhận `user` ID, trả về user profile.
    - `chatGetPermalink`: Nhận `channel`, `message_ts`, sinh safe permalink web link.
  - Mapping toàn diện mã lỗi Slack (`channel_not_found`, `not_in_channel`, `missing_scope`, `ratelimited`, `invalid_auth`) sang `StepError`.

- [ ] **Task 4: Mở Rộng Stateful HTTP Fixture & Kiểm Thử Tích Hợp Toàn Diện**
  - Mở rộng fixture `scripts/fake-slack-personal.mjs` để hỗ trợ đầy đủ 8 read methods, multi-actor (`T_FREE`, `T_PRO`, Actor A, B, Colleague), private channel/DM access control, và fault injection (delay, 429, revoke).
  - Viết bộ test tích hợp `packages/tool-adapters/tests/slack/personal-slack-read.test.ts`.
  - Kiểm thử 12 ca kiểm thử hành vi trong ma trận (Section 5).
  - Đảm bảo toàn bộ test suites của `@wap/tool-adapters` chạy thành công bằng lệnh `npm test -w @wap/tool-adapters`.

---

## 5. Ma Trận Kiểm Thử Hành Vi & Không Hồi Quy (Behavior Test Matrix)

| STT | Kịch Bản Kiểm Thử | Đầu Vào / Điều Kiện | Kết Quả Mong Đợi |
|---|---|---|---|
| 1 | **Binding Validation** | Input thiếu `identityVersion` hoặc rỗng `connectionId` | Ném lỗi `VALIDATION` trước khi gọi hook/mạng |
| 2 | **Pre-fetch F1 Denial** | Hook policy trả về `{ allowed: false, reason: 'consent_missing' }` | Trả lỗi `AUTH_ERROR`, 0 HTTP request phát ra |
| 3 | **Post-fetch Revoke Race** | Delay fixture 50ms; đổi mock state sang revoked trong lúc fetch | Hủy payload, ném `AUTH_ERROR`, không trả dữ liệu |
| 4 | **Cross-Workspace Isolation** | Gọi `C_GENERAL` của Workspace A bằng token của Workspace B | Trả về dữ liệu của A, không trộn lẫn dữ liệu của B |
| 5 | **Native ACL - Private Channel** | Actor A (thành viên `G_PRIVATE`) vs Colleague (không thuộc kênh) | Actor A đọc được; Colleague nhận `channel_not_found` |
| 6 | **Native ACL - DM** | Đọc `D_PRIVATE` bằng actor không tham gia | Nhận `channel_not_found` / `missing_scope` |
| 7 | **Thread Replies Integrity** | Gọi `conversations.replies` với `ts` của một tin nhắn thường | Nhận lỗi `thread_not_found` |
| 8 | **Pagination Budget Enforcement** | Truyền `limit: 200` (vượt trần 100) hoặc `limit: -5` | Clamp về 100 hoặc reject; phân trang trả đúng số lượng |
| 9 | **Sanitized Profile Output** | `users.list` và `users.info` | Trả về profile đã làm sạch; không rò rỉ token/email |
| 10 | **Safe Permalink Format** | `chat.getPermalink` với kênh và timestamp hợp lệ | Trả link chuẩn web `https://.../archives/.../p...` |
| 11 | **AbortSignal Cancellation** | Trigger `abortController.abort()` trước hoặc giữa request | Socket đóng ngay lập tức, trả lỗi `NETWORK` / aborted |
| 12 | **Rate Limit 429 & Retry-After** | Fixture trả 429 + `Retry-After: 1` | Chờ 1s và retry thành công; vượt 2 lần thì ném `RATE_LIMIT` |

---

## 6. Cổng Bằng Chứng & Nghiệm Thu (Evidence Gates)

> Vì đây là phiên lập kế hoạch tài liệu (Docs-only), các bài test mã nguồn được giữ nguyên trạng thái `[Proposed: not run]`.

1. **Kiểm tra Whitespace và Diff sạch:**
   ```powershell
   git diff --check 7c6c65d8..HEAD
   ```
2. **Kiểm tra Ranh giới Files & Module Ownership:**
   ```powershell
   git status --short
   # Chỉ hiển thị đúng 3 tệp tài liệu: 1 task card, 1 plan, 1 handoff log.
   ```
3. **[Proposed: not run] Lệnh kiểm thử thi công khi mở PR code:**
   ```powershell
   npx vitest run packages/tool-schemas/tests/myslack-read-schemas.test.ts
   npx vitest run packages/tool-adapters/tests/slack/personal-slack-read.test.ts
   npm run typecheck:v3
   ```
