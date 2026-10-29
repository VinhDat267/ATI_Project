# SLACK-03C1 · Bounded Read Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triển khai bounded read adapters cho đúng 8 phương thức đọc cốt lõi ban đầu của Slack cá nhân (`myslack`), xác thực 5 trường binding server-confirmed, bảo vệ quyền truy cập theo native Slack user ACL, kiểm thực chính sách F1 hai pha (pre-fetch & post-fetch re-auth với canonical 8-field policy ref), cách ly token bí mật và provenance quan sát minh bạch (transient read, retention 0).

**Architecture:**
- **Integration Boundary:** Sở hữu `packages/tool-schemas/` và `packages/tool-adapters/`. Không import `apps/chat-api/` và không sửa backend. Backend wrapper cung cấp hooks là task Backend riêng biệt.
- **Injected Hooks:** `PersonalSlackReadAdapter` nhận injected hooks qua constructor: `SlackTokenProviderHook` (lấy access token nội bộ theo binding) và `SlackReadPolicyHook` (kiểm thực chính sách F1 hai pha: pre-fetch và post-fetch re-authorization).
- **Two-Phase Policy Enforcement (F1):** Trước mọi outbound HTTP request, gọi `authorizeRead` với 5-field binding, `purpose: Exclude<SlackPolicyPurpose, 'storage'>`, `requestedRetentionDays: 0`. Quyết định thành công bắt buộc trả về canonical 8-field `SlackPolicyReference`. Sau khi await transport và parse body, gọi lại `authorizeRead` truyền `expectedPolicyReference` tiền trạm. Bất kỳ thay đổi nào (epoch, purpose, TTL, consent revoked, provider updated/config changed, hoặc regrant với revision mới) đều bị từ chối; adapter hủy payload ngay lập tức và ném `AUTH_ERROR` (fail-closed, không rò rỉ dữ liệu).
- **Native Slack ACL & Bounded Output:** Quyền đọc do user token và membership thực tế quyết định (không dùng static channel allowlist). Phân trang cursor bounded (max 100/trang); text trần là untrusted provider data.

**Tech Stack:** Node.js `^22.12.0 || >=24.0.0`, TypeScript 5.8, Vitest 3, `@wap/tool-schemas`.
**Spec:** [Slack cá nhân và trợ lý công việc](../specs/2026-10-28-slack-personal-oauth-design.md) (Mục 2, 4.4, 4.5, 8, 9.1).
**Task Cards:** [SLACK-03C1 Core Read Adapters](../../handoff/tasks/SLACK-03C1-core-read-adapters.md), [SLACK-03 Parent Task](../../handoff/tasks/SLACK-03-tool-catalog-and-source-lifecycle.md).
**Status:** DỰ THẢO KẾ HOẠCH (Docs-only; chờ Coordinator và Backend phê duyệt interface trước khi mở PR thi công).

---

## 1. Bảng 8 Phương Thức Đọc & Đối Soát Inventory

Đối soát trực tiếp từ `docs/slack/method-inventory.json` (SHA256: `e55bc180eb43c71c1131dbded5968c1e240d3424fe1314bf604139055c074f09`):

| # | Phương Thức Slack | HTTP & Rate | User Scopes Khai Báo | Inventory Disposition | Budget Phân Trang | Output Quan Sát Bounded |
|---|---|---|---|---|---|---|
| 1 | `conversations.list` | GET / t2 (20/m) | `channels:read, groups:read, im:read, mpim:read` | `probe_required` | 50 mặc định, max 100 | `channels: SlackConversationSummary[]`, `nextCursor`, `hasMore` |
| 2 | `conversations.info` | GET / t3 (50/m) | `channels:read, groups:read, im:read, mpim:read` | `probe_required` | N/A (single entity) | `channel: SlackConversationDetail` |
| 3 | `conversations.history` | GET / t3 (50/m) | `channels:history, groups:history, im:history, mpim:history` | `probe_required` | 20 mặc định, max 100 | `messages: SlackMessageObservation[]`, `nextCursor`, `hasMore` |
| 4 | `conversations.replies` | GET / t3 (50/m) | `channels:history, groups:history, im:history, mpim:history` | `probe_required` | 20 mặc định, max 100 | `messages: SlackMessageObservation[]`, `nextCursor`, `hasMore` |
| 5 | `conversations.members` | GET / t4 (100/m) | `channels:read, groups:read, im:read, mpim:read` | `probe_required` | 100 mặc định, max 100 | `memberIds: string[]`, `nextCursor`, `hasMore` |
| 6 | `users.list` | GET / t2 (20/m) | `users:read` | `probe_required` | 50 mặc định, max 100 | `members: SlackUserSummary[]`, `nextCursor`, `hasMore` |
| 7 | `users.info` | GET / t4 (100/m) | `users:read` | `probe_required` | N/A (single entity) | `user: SlackUserDetail` |
| 8 | `chat.getPermalink` | GET / t5 (Tier 5) | `null` (`userToken: undetermined`) | `probe_required` | N/A (single entity) | `permalink: string`, `channel: string` |

*Ranh giới danh mục:* Giữ nguyên `disposition: probe_required` và `deliveryStatus: not_implemented` cho toàn bộ 8 phương thức trong inventory. Không tự ý thăng cấp trạng thái native. Không có generic dispatcher `myslack.call(method, args)`. Các phương thức còn lại của nhóm cốt lõi (`conversations` còn 22, `chat` còn 12, `users` còn 10) tiếp tục là backlog mở trong 03C2, 03D, 03E. Không đăng ký vào `ALL_TOOLS` hay `SERVICE_REGISTRY`.

---

## 2. Ràng Buộc Kiến Trúc & An Toàn Bắt Buộc

1. **Server-Confirmed 5-Field Binding:** Mọi request đọc bắt buộc mang `binding: SlackBinding` (`atiUserId`, `connectionId`, `workspaceId`, `slackUserId`, `identityVersion`). Thiếu hoặc rỗng bất kỳ trường nào bị từ chối ngay lập tức trước mạng (`VALIDATION`).
2. **Kiểm Thực Hai Pha F1 Toàn Diện:**
   - *Pha 1 (Pre-fetch):* Gọi `policy.authorizeRead({ binding, purpose, requestedRetentionDays: 0 })`. Discriminated union bắt buộc trả về `{ allowed: true, policyReference: SlackPolicyReference }` với đầy đủ 8 trường chuẩn tắc. Quyết định boolean-only, thiếu trường hoặc sai lệch cấu trúc đều fail-closed (`AUTH_ERROR`).
   - *Pha 2 (Post-fetch Re-Authorization):* Sau khi nhận HTTP response và parse body, gọi lại `policy.authorizeRead({ binding, purpose, requestedRetentionDays: 0, expectedPolicyReference: prefetchRef })`. Nếu kết nối bị ngắt, identity version bị bump, consent bị thu hồi, provider bị cập nhật, config fingerprint đổi, hoặc có regrant với epoch mới trong thời gian await -> drop toàn bộ payload, làm sạch bộ nhớ, ném `AUTH_ERROR`. Không trả plaintext output.
3. **Mục Đích Đọc Hợp Lệ:** Sử dụng `SlackReadPurpose = Exclude<SlackPolicyPurpose, 'storage'>` (`'manual_lookup' | 'triage' | 'planning' | 'digest'`). Mục đích do ngữ cảnh máy chủ cung cấp, không phải do model tự quyết định.
4. **Transient Reads (Retention 0) & Chiến Lược Provenance Quan Sát:**
   - Dữ liệu 03C1 đọc tức thời (transient, retention 0), không lưu trữ bền vững vào `SlackSourceStore` (03B).
   - Với các đối tượng không có revision gốc từ Slack (channel metadata, user profile, permalink), khai báo rõ cấu trúc provenance:
     ```ts
     export interface SlackObservationProvenance {
       binding: SlackBinding;
       observedAt: string; // ISO 8601 UTC timestamp
       acquisitionPolicyReference: SlackPolicyReference; // Canonical 8-field ref từ authorizeRead (purpose + 0 TTL)
       nativeRevision?: string; // Chỉ có khi Slack trả về (ví dụ edited.ts || ts)
       observationalDigest: string; // SHA-256 của JSON payload tại thời điểm quan sát
     }
     ```
     Backend 03B1 (`ctx_0b1305c28c8f`) yêu cầu `acquisitionPolicyReference` trong observation DTO để kiểm tra `sameSlackPolicyEpoch` trước khi lưu vào `SlackSourceStore`, chống bypass qua regrant policy mới. Tuyệt đối không phát minh revision Slack giả.
   - Giữ nguyên chuỗi số thập phân chính xác của `ts` và `edited.ts` (không parse sang Float để tránh mất độ chính xác).
   - Deep link permalink phải khớp format an toàn: `^https:\/\/[a-z0-9_-]+\.slack\.com\/archives\/[A-Z0-9]+\/p[0-9]+$`.
   - Làm sạch profile người dùng: chỉ trích xuất thông tin cơ bản (`id`, `name`, `real_name`, `tz`, `is_bot`, `deleted`), không rò rỉ email, avatar hay credentials.
5. **An Toàn Vận Hành & Transport:**
   - `apiBaseUrl` chỉ chấp nhận native HTTPS (`https://slack.com/api`) hoặc explicit loopback fixture (`http://127.0.0.1:<port>`, `http://localhost:<port>`).
   - Cấm chuyển hướng: cấu hình `redirect: 'manual'` tránh rò rỉ Bearer token.
   - Abortable transport: truyền `AbortSignal` thực vào `fetchFn`, giới hạn response body tối đa 2MB.
   - Rate limit 429: xử lý theo header `Retry-After`, giới hạn delay và retry tối đa 2 lần. **Mỗi lần retry bắt buộc phải re-authorize Pha 1 F1** trước khi phát lại request.

---

## 3. Tệp Triển Khai & Interface Giao Ước

### 3.1. Hook Interfaces (`packages/tool-adapters/src/slack/personal-slack-types.ts`)
```ts
import type { SlackBinding, SlackPolicyReference, SlackPolicyPurpose } from '@wap/tool-schemas';

export type SlackReadPurpose = Exclude<SlackPolicyPurpose, 'storage'>;

export type SlackPolicyHookDecision =
  | { allowed: true; policyReference: SlackPolicyReference }
  | { allowed: false; reason: string };

export interface SlackAuthorizeReadInput {
  binding: SlackBinding;
  purpose: SlackReadPurpose;
  requestedRetentionDays: 0;
  expectedPolicyReference?: SlackPolicyReference;
}

export interface SlackReadPolicyHook {
  authorizeRead(input: SlackAuthorizeReadInput): Promise<SlackPolicyHookDecision>;
}

export interface SlackTokenProviderHook {
  getAccessToken(binding: SlackBinding): Promise<string>;
}

export interface PersonalSlackAdapterConfig {
  tokens: SlackTokenProviderHook;
  policy: SlackReadPolicyHook;
  apiBaseUrl?: string;
  fetchFn?: typeof fetch;
  requestTimeoutMs?: number;
}
```

### 3.2. Bảng Tệp Cần Chỉnh Sửa / Tạo Mới

| Tệp | Hành Động | Ranh Giới & Trách Nhiệm |
|---|---|---|
| `packages/tool-schemas/src/myslack-tools.ts` | **Modify** | Mở rộng canonical registry cho đủ đúng 8 read methods, tái sử dụng nhất quán 3 samples hiện có, chuẩn hóa `SlackToolDefinition` không phát minh types lạ. |
| `packages/tool-schemas/src/index.ts` | **Modify** | Export các schemas/types đọc cập nhật (không đăng ký vào `ALL_TOOLS` / `SERVICE_REGISTRY`). |
| `packages/tool-adapters/src/slack/personal-slack-types.ts` | **Create** | Hooks interfaces (`SlackTokenProviderHook`, `SlackReadPolicyHook`), provenance types, adapter config. |
| `packages/tool-adapters/src/slack/personal-slack-read-adapter.ts` | **Create** | Lớp `PersonalSlackReadAdapter`, kiểm thực F1 hai pha, fixed switch dispatch cho 8 methods, xử lý 429 và AbortSignal. |
| `packages/tool-adapters/src/index.ts` | **Modify** | Export `PersonalSlackReadAdapter` và hooks interfaces. |
| `packages/tool-schemas/tests/myslack-tools.test.ts` | **Modify** | Tests kiểm tra canonical registry cho 8 read tools, fail-closed args validation, immutable definitions. |
| `packages/tool-adapters/tests/helpers/personal-slack-mock-server.ts` | **Create** | Local HTTP mock server thuộc sở hữu Integration (`@wap/tool-adapters`) phục vụ test fixture (không sửa `scripts/`). |
| `packages/tool-adapters/tests/slack/personal-slack-read.test.ts` | **Create** | Integration tests với mock server: F1 two-phase race, cross-workspace isolation, native ACL, 429 retry re-auth. |

*Ghi chú Backend Wrapper:* Backend wrapper trong `apps/chat-api` chuyển đổi `SlackTokenManager.getAccessToken(userId, id, identityVersion)` và `SlackPolicyService.resolveSlackModelPolicy(...)` sang hook interfaces trên là một task Backend độc lập, cần được Coordinator phê duyệt interface trước khi thi công.

---

## 4. Kế Hoạch Triển Khai Từng Bước (Tasks)

- [ ] **Task 1: Mở Rộng Canonical Tool Registry 8 Read Methods (`packages/tool-schemas`)**
  - Mở rộng `packages/tool-schemas/src/myslack-tools.ts`: giữ nguyên/tái sử dụng 3 samples (`conversations.list`, `conversations.history`, `users.info`) và bổ sung 5 definitions còn lại (`conversations.info`, `conversations.replies`, `conversations.members`, `users.list`, `chat.getPermalink`).
  - Đảm bảo metadata khớp chính xác `SlackToolDefinition` hiện hữu (`sideEffect: 'read'`, `riskLevel: 'low'`, `planTier: 'any'`, `isProbeRequired: true`, `requiresBinding: true`).
  - Cập nhật hàm validate execution args `validateSlackToolExecutionArgs` để từ chối mọi method không thuộc canonical registry kể cả cùng family.
  - Cập nhật tests tại `packages/tool-schemas/tests/myslack-tools.test.ts` và chạy `npx vitest run packages/tool-schemas/tests/myslack-tools.test.ts`.

- [ ] **Task 2: Xây Dựng Injected Hooks & Two-Phase F1 Transport (`packages/tool-adapters`)**
  - Tạo `packages/tool-adapters/src/slack/personal-slack-types.ts` với `SlackTokenProviderHook`, `SlackReadPolicyHook`, `SlackObservationProvenance`.
  - Tạo `packages/tool-adapters/src/slack/personal-slack-read-adapter.ts` kế thừa `BaseAdapter`.
  - Cài đặt phương thức private request:
    - Pha 1: `policy.authorizeRead({ binding, purpose, requestedRetentionDays: 0 })`. Bắt buộc nhận canonical `policyReference`.
    - Lấy token qua `tokens.getAccessToken(binding)` (private memory only).
    - Fetch GET tới endpoint với Bearer token, `redirect: 'manual'`, timeout qua `AbortSignal`, body budget 2MB.
    - Xử lý 429: đọc `Retry-After`, delay có thể hủy; mỗi lần retry gọi lại Pha 1 `authorizeRead`.
    - Pha 2: `policy.authorizeRead({ binding, purpose, requestedRetentionDays: 0, expectedPolicyReference: prefetchRef })`.
    - Nếu Pha 2 fail -> drop payload, xóa bộ nhớ, ném `AUTH_ERROR`.
    - Gắn provenance quan sát (`SlackObservationProvenance`) kèm binding vào kết quả.

- [ ] **Task 3: Triển Khai 8 Read Methods Qua Fixed Switch Dispatcher**
  - Trong `execute(toolName, args, context)`, dispatch qua fixed switch statement cho đúng 8 methods; không dùng dynamic reflection.
  - Xử lý `conversations.replies`: nếu gọi với message không có reply, trả về `[root_message]` theo đúng hành vi Slack API (không giả định sai là luôn `thread_not_found`).
  - Bảo toàn chuỗi số thập phân của `ts` và `edited.ts`.
  - Làm sạch profile trong `users.info` và `users.list`.
  - Sinh và kiểm thực permalink an toàn cho `chat.getPermalink`.
  - Map các lỗi provider (`channel_not_found`, `not_in_channel`, `missing_scope`, `invalid_auth`, `ratelimited`) sang `StepError`.

- [ ] **Task 4: Xây Dựng Package Mock Helper & Bộ Kiểm Thử Tích Hợp**
  - Tạo helper fixture `packages/tool-adapters/tests/helpers/personal-slack-mock-server.ts` (không sửa `scripts/fake-slack-personal.mjs`).
  - Viết bộ test `packages/tool-adapters/tests/slack/personal-slack-read.test.ts` kiểm thử toàn bộ 14 kịch bản trong ma trận kiểm thử Section 5.
  - Chạy `npm test -w @wap/tool-adapters` xác nhận toàn bộ test suites đạt kết quả xanh.

---

## 5. Ma Trận Kiểm Thử Hành Vi & Không Hồi Quy (Behavior Test Matrix)

| STT | Kịch Bản Kiểm Thử | Điều Kiện / Đầu Vào | Kết Quả Mong Đợi |
|---|---|---|---|
| 1 | **Binding Validation** | Input thiếu `identityVersion` hoặc rỗng `connectionId` | Ném lỗi `VALIDATION` trước khi gọi hook hoặc mạng |
| 2 | **Pre-fetch F1 Denial** | `authorizeRead` trả về `{ allowed: false, reason: 'consent_missing' }` | Ném `AUTH_ERROR`, 0 HTTP request được phát ra |
| 3 | **Malformed F1 Decision** | `authorizeRead` trả về `allowed: true` nhưng thiếu canonical policyReference | Fail-closed, ném `AUTH_ERROR`, 0 HTTP request |
| 4 | **Post-fetch Consent Revoked** | Mock server delay 50ms; consent bị thu hồi trong lúc await | Drop payload, xóa bộ nhớ, ném `AUTH_ERROR`, không trả plaintext |
| 5 | **Post-fetch Provider Updated** | Mock server delay 50ms; provider revision / config fingerprint đổi | Drop payload, ném `AUTH_ERROR` do lệch policy epoch |
| 6 | **Post-fetch Regrant While Active** | Mock server delay 50ms; admin cấp lại consent với revision mới | Drop payload, ném `AUTH_ERROR` do không khớp expectedPolicyReference |
| 7 | **Cross-Workspace Token Mismatch** | Thực thi với `bindingA` nhưng token manager trả token của Workspace B | Bị chặn trước transport bởi backend wrapper / fixture auth |
| 8 | **Cross-Workspace Colliding Channel** | 2 workspaces cùng có `C_GENERAL`; đọc bằng `bindingB` | Chỉ trả về dữ liệu của Workspace B, tuyệt đối không lộ dữ liệu A |
| 9 | **Native ACL: Private & DM** | Đọc kênh private / DM bằng caller không có quyền | Provider trả `channel_not_found` / `not_in_channel` -> map `StepError` |
| 10 | **Replies Root Contract** | `conversations.replies` với valid message không có replies | Trả về `[root_message]` thành công theo đúng Slack API contract |
| 11 | **Exact Decimal Timestamp** | Tin nhắn có `ts: '1712345678.000200'` và `edited.ts` | Giữ nguyên exact decimal string, không bị làm tròn |
| 12 | **Sanitized User Profile** | Gọi `users.info` / `users.list` | Trả về thông tin công khai an toàn; không chứa email, avatar, token |
| 13 | **AbortSignal Cancellation** | Trigger `AbortController.abort()` trước hoặc giữa request | Socket đóng ngay lập tức, trả lỗi `NETWORK` / aborted |
| 14 | **429 Retry Re-authorizes F1** | Mock server trả 429 kèm `Retry-After: 1` | Chờ delay và gọi lại `authorizeRead` trước khi retry; vượt trần ném `RATE_LIMIT` |

---

## 6. Cổng Bằng Chứng & Nghiệm Thu (Evidence Gates)

> Phiên lập kế hoạch tài liệu (Docs-only): các lệnh kiểm thử mã nguồn được ghi rõ là `[Proposed: not run]`. Nghiệm thu database / concurrency thực tế đòi hỏi joint test giữa Backend và Integration trên PostgreSQL thật, không dùng mock hook làm bằng chứng DB.

1. **Kiểm tra Whitespace & Diff sạch:**
   ```powershell
   git diff --check 7c6c65d8..HEAD
   ```
2. **Kiểm tra Ranh giới Files & Module Ownership:**
   ```powershell
   git status --short
   # Chỉ hiển thị đúng 3 tệp tài liệu: task card, implementation plan, handoff log.
   ```
3. **[Proposed: not run] Lệnh kiểm thử khi mở PR thi công code:**
   ```powershell
   npx vitest run packages/tool-schemas/tests/myslack-tools.test.ts
   npx vitest run packages/tool-adapters/tests/slack/personal-slack-read.test.ts
   npm run typecheck:v3
   ```
