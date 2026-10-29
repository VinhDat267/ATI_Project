# SLACK-03C1 · Bounded Read Adapters cho 8 Phương Thức Cốt Lõi Slack Cá Nhân

**Trạng thái:** DỰ THẢO KẾ HOẠCH (Chờ Coordinator / Leader thẩm định; Docs-only, chưa thực thi code).
**Nhánh dự kiến:** `docs/slack-03c1-read-plan`
**Nền đối chiếu:** `7c6c65d8` (`integration/slack-personal-20261029`).
**PR Đích:** Draft PR to `integration/slack-personal-20261029`.
**Vai trò sở hữu:** Integration Engineer (`packages/tool-schemas/`, `packages/tool-adapters/`).
**Phụ thuộc:**
- **SLACK-01** (Foundation: `SlackBinding`, `SlackSourceRef`, `SlackModelPolicy`, fixture HTTP, offline probe) — ĐÃ XONG (`fc12e3fb`).
- **SLACK-02** (OAuth, `SlackTokenManager`, `SlackPolicyService`, connection UI) — ĐÃ TÍCH HỢP tại `7c6c65d8`.
- **SLACK-03A** (Source contracts & `SlackPolicyEpoch` dưới PR 194 / `871c5393`, `bc8d6b69`) — Interface gate: sẵn sàng đối chiếu epoch/policy reference khi coordinator duyệt.
**Task cha:** [SLACK-03-tool-catalog-and-source-lifecycle](SLACK-03-tool-catalog-and-source-lifecycle.md)
**Kế hoạch chi tiết:** [Kế hoạch SLACK-03C1](../../superpowers/plans/2026-10-29-slack-03c1-core-read-adapters.md)

---

## 1. Mục tiêu và Phạm vi Nghiệp vụ (8 Read Methods Only)

Xây dựng bộ read adapters có giới hạn chặt chẽ (bounded read adapters) cho **đúng 8 phương thức đọc cốt lõi ban đầu** của Slack cá nhân (`myslack`), tuân thủ tuyệt đối quyền truy cập gốc của người dùng (native Slack user ACL), bảo vệ danh tính 5 trường bất biến (`SlackBinding`), kiểm thực chính sách F1 hai pha (pre-fetch & post-fetch), và cách ly tuyệt đối token bí mật bên trong adapter memory.

### 1.1. Bảng 8 Phương Thức Đọc Cốt Lõi & Đối Soát Inventory
Đối soát chính xác theo `docs/slack/method-inventory.json` (SHA256: `e55bc180eb43c71c1131dbded5968c1e240d3424fe1314bf604139055c074f09`):

| Method Slack | HTTP / Tier | User Scopes Khai Báo | User Token | Inventory Disposition | Output Quan Sát Bounded |
|---|---|---|---|---|---|
| `conversations.list` | GET / t2 (20/m) | `channels:read, groups:read, im:read, mpim:read` | `documented` | `probe_required` | Danh sách kênh/hội thoại caller có quyền (`public_channel`, `private_channel`, `mpim`, `im`), phân trang cursor, budget max 100/trang. |
| `conversations.info` | GET / t3 (50/m) | `channels:read, groups:read, im:read, mpim:read` | `documented` | `probe_required` | Chi tiết hội thoại (`id`, `name`, `is_private`, `is_im`, `topic`, `purpose`, `num_members`), bảo toàn binding. |
| `conversations.history` | GET / t3 (50/m) | `channels:history, groups:history, im:history, mpim:history` | `documented` | `probe_required` | Danh sách tin nhắn phân trang; revision lấy từ `edited.ts` (nếu có) hoặc `ts`; text trần là untrusted provider data. |
| `conversations.replies` | GET / t3 (50/m) | `channels:history, groups:history, im:history, mpim:history` | `documented` | `probe_required` | Luồng thread theo `channel` và root `ts`; phân trang cursor, budget max 100/trang; kiểm tra caller có quyền xem thread. |
| `conversations.members` | GET / t4 (100/m) | `channels:read, groups:read, im:read, mpim:read` | `documented` | `probe_required` | Danh sách ID thành viên trong kênh (`memberIds: string[]`), phân trang cursor, budget max 100/trang. |
| `users.list` | GET / t2 (20/m) | `users:read` | `documented` | `probe_required` | Danh sách tóm tắt người dùng trong workspace (`id`, `name`, `real_name`, `tz`, `is_bot`, `deleted`), không rò rỉ email/chứng chỉ. |
| `users.info` | GET / t4 (100/m) | `users:read` | `documented` | `probe_required` | Chi tiết một người dùng theo `user` (ID), hiển thị hồ sơ đã làm sạch, bảo toàn binding workspace. |
| `chat.getPermalink` | GET / t5 (Tier 5) | `null` (metadata không khai báo scope) | `undetermined` | `probe_required` | Deep link an toàn (`https://<ws>.slack.com/archives/<c>/p<ts>`) tới tin nhắn mà caller có quyền xem. |

### 1.2. Ranh Giới Nghiêm Ngặt & Quản Lý Backlog
1. **Bảo toàn trạng thái Inventory:** Toàn bộ 8 phương thức giữ nguyên trạng thái `disposition: probe_required` và `deliveryStatus: not_implemented` trong `method-inventory.json`. Schema và test fixture cục bộ KHÔNG PHẢI bằng chứng chấp thuận native; tuyệt đối không tự ý đánh dấu bất kỳ dòng nào trong 354 rows là đã hỗ trợ/ủy quyền.
2. **Không có Generic Dispatcher:** Nghiêm cấm tạo công cụ dạng `myslack.call(method, args)`. Mọi công cụ phải có schema tham số và kết quả tường minh, không chấp nhận dynamic dispatch lỏng lẻo.
3. **Backlog tường minh trong Macro 03:** Các phương thức còn lại của nhóm cốt lõi (`conversations.*` còn 22 methods, `chat.*` còn 12 methods, `users.*` còn 10 methods) tiếp tục nằm trong backlog tường minh của SLACK-03 (03C2 write tools, 03D content/interactions, 03E advanced/governance), không bị bỏ quên.
4. **Cấm Ghi (No Write Dispatch):** Tuyệt đối không triển khai hoặc dispatch bất kỳ write tool nào (`chat.postMessage`, `chat.update`, `chat.delete`, v.v.) trong card này; các thao tác ghi bắt buộc phải chờ SLACK-04C với cơ chế outbox ledger và bảo vệ UNKNOWN được chấp thuận.
5. **Cách ly Catalog:** Không đăng ký tự động 8 read tools này vào `ALL_TOOLS` hay `SERVICE_REGISTRY` khi chưa có quyết định cờ `MYSLACK_ENABLED`. Catalog/routing/planner/executor là các task độc lập.

---

## 2. Quyền Sở Hữu Module & Hợp Đồng Injected Hooks

Tuân thủ nghiêm ngặt ranh giới sở hữu tại [Team Workflow](../../team-workflow.md):
- **Phạm vi Integration:** Chỉ sở hữu `packages/tool-schemas/` và `packages/tool-adapters/`.
- **Không xâm phạm Backend:** Tuyệt đối không import mã nguồn từ `apps/chat-api/` vào `packages/` và không chỉnh sửa bất kỳ tệp nào trong `apps/` hay `db/`.
- **Hạ tầng Injected Hooks (Dependency Inversion):** Để sử dụng `SlackTokenManager` và `SlackPolicyService` đã có của 02B Backend, `PersonalSlackReadAdapter` nhận các hooks được inject qua config khi khởi tạo:

```ts
// packages/tool-adapters/src/slack/personal-slack-types.ts
import type { SlackBinding } from '@wap/tool-schemas';

export interface SlackTokenProviderHook {
  getAccessToken(
    binding: SlackBinding,
    options?: { signal?: AbortSignal; forceRefresh?: boolean }
  ): Promise<string>;
}

export type SlackReadPurpose = 'conversation_read' | 'member_lookup';

export interface SlackPolicyHookDecision {
  allowed: boolean;
  reason?: string;
  policyReference?: Record<string, unknown>;
}

export interface SlackPolicyValidationHook {
  resolveReadPolicy(
    binding: SlackBinding,
    purpose: SlackReadPurpose,
    requestedRetentionDays: 0
  ): Promise<SlackPolicyHookDecision>;
  validateBindingActive(binding: SlackBinding): Promise<boolean>;
}

export interface PersonalSlackAdapterConfig {
  tokens: SlackTokenProviderHook;
  policy: SlackPolicyValidationHook;
  apiBaseUrl?: string; // Dành cho stateful test fixture
  fetchFn?: typeof fetch;
  requestTimeoutMs?: number; // Mặc định 10.000ms
}
```

*Quy tắc an ninh token:* Token truy cập chỉ được yield bên trong bộ nhớ nội bộ của adapter tại thời điểm dispatch HTTP request qua header `Authorization: Bearer <token>`. Tuyệt đối không xuất hiện token trong kết quả trả về, DTO công khai, schemas, logs, hoặc context của mô hình.

---

## 3. Nguyên Tắc Thiết Kế Kỹ Thuật (Architecture & Security Guardrails)

1. **Server-Confirmed 5-Field Binding Bắt Buộc:** Mọi request đọc bắt buộc phải mang đầy đủ 5 trường định danh: `atiUserId`, `connectionId`, `workspaceId`, `slackUserId`, `identityVersion`. Không bao giờ tự ý chọn token đầu tiên trong DB, không rebind theo tên, không cho phép hoán đổi workspace giữa chừng.
2. **Kiểm Thực Hai Pha F1 (Two-Phase Policy & Lifecycle Check):**
   - **Pha 1 (Pre-transport):** Trước khi gửi request ra mạng, gọi `policy.resolveReadPolicy(binding, purpose, 0)` và `policy.validateBindingActive(binding)`. Nếu kết nối bị revoke, đổi identity version, hoặc thiếu consent tổ chức -> Từ chối ngay lập tức với `StepError({ category: 'AUTH_ERROR' })` trước transport.
   - **Pha 2 (Post-transport Revalidation):** Sau khi nhận HTTP response từ Slack provider (trong thời gian await provider có thể mất 200–500ms), adapter gọi lại `policy.validateBindingActive(binding)`. Nếu trong khoảng thời gian chờ mà kết nối bị ngắt, identity version bị bump, hoặc consent bị thu hồi -> Lập tức hủy bỏ toàn bộ kết quả vừa đọc, làm sạch bộ nhớ và ném lỗi `AUTH_ERROR`. Không giải phóng dữ liệu đã bị mất quyền.
3. **Retention 0 & Tính Tạm Thời (Transient Reads):** Mọi thao tác đọc của 03C1 đều có `requestedRetentionDays: 0`. Chúng không cấu thành `SlackSourceEntity` trong `SlackSourceStore` (03B) và không lưu dữ liệu nguồn bền vững vào DB. Các consumer tương lai (03B2/03B3) phải bảo toàn toàn bộ 5 trường binding và provenance khi chuyển tiếp dữ liệu lên UI/Model.
4. **Native ACL - Không Có Channel Allowlist:** Không sử dụng danh sách kênh cho phép tĩnh (channel allowlist). Quyền đọc kênh công khai, kênh riêng, DM, nhóm DM được quyết định thuần túy bởi quyền thực tế của user token trên Slack (native Slack membership/ACL). Nếu user không có quyền vào kênh, Slack trả về `channel_not_found` hoặc `not_in_channel`; adapter map chính xác thành lỗi bảo mật tương ứng.
5. **Endpoint Cố Định & Bảo Vệ Bearer:** Request chỉ được gửi tới các endpoint cố định được khai báo trước (`https://slack.com/api/<method>`). Không cho phép caller truyền URL tùy ý. Tắt tự động chuyển hướng (`redirect: 'manual'`) để tránh rò rỉ Authorization header sang bên thứ ba.
6. **Giới Hạn Bounded & An Toàn Vận Hành:**
   - Hạn mức kích thước body response tối đa 2MB (tránh cạn kiệt RAM).
   - Truyền `AbortSignal` thực vào `fetchFn` để hủy kết nối ngay khi caller timeout.
   - Giới hạn budget phân trang: mặc định 20–50 items/trang, tối đa 100 items/trang. Reject các limit âm hoặc quá 100.
   - Xử lý Rate Limit: Bắt HTTP 429 và đọc header `Retry-After`. Chỉ retry tối đa 2 lần cho các lỗi mạng quá cảnh an toàn. Tuyệt đối không retry vô hạn. Token refresh là checkpoint một lần duy nhất do backend quản lý, adapter không tự ý replay refresh token.
7. **Làm Sạch Dữ Liệu Nguồn (Sanitization & Safe Links):**
   - Nội dung text từ Slack luôn được coi là dữ liệu không đáng tin (untrusted provider text).
   - Deep link permalink được kiểm tra cấu trúc an toàn: `https://<workspace>.slack.com/archives/<channel>/p<ts>`.
   - Revision nguồn: Sử dụng `edited.ts` (nếu tin nhắn đã qua chỉnh sửa) hoặc `ts` ban đầu.

---

## 4. Tệp Thay Đổi Dự Kiến & Chữ Ký Schema/Adapter

| Thao Tác | Đường Dẫn Tệp | Mục Đích & Nội Dung |
|---|---|---|
| **Create** | `packages/tool-schemas/src/myslack-read-tools.ts` | Định nghĩa schema JSON chuẩn tắc cho 8 công cụ đọc (`myslack.conversations_list`, `conversations_info`, `conversations_history`, `conversations_replies`, `conversations_members`, `users_list`, `users_info`, `chat_getPermalink`), validator tham số đệ quy fail-closed. |
| **Create** | `packages/tool-adapters/src/slack/personal-slack-types.ts` | Các types nội bộ, interfaces injected hooks (`SlackTokenProviderHook`, `SlackPolicyValidationHook`), và config adapter. |
| **Create** | `packages/tool-adapters/src/slack/personal-slack-read-adapter.ts` | Triển khai `PersonalSlackReadAdapter` kế thừa `BaseAdapter`, thực thi 8 methods, kiểm thực 2 pha, xử lý 429, AbortSignal và mapping lỗi. |
| **Modify** | `packages/tool-schemas/src/index.ts` | Export các types/schemas đọc mới từ `myslack-read-tools.js` (không đụng vào `ALL_TOOLS`/`SERVICE_REGISTRY`). |
| **Modify** | `packages/tool-adapters/src/index.ts` | Export `PersonalSlackReadAdapter` và hooks interfaces. |
| **Tests** | `packages/tool-schemas/tests/myslack-read-schemas.test.ts` | Unit tests kiểm tra tính bất biến của schema, validation đệ quy, từ chối tham số lạ và binding thiếu. |
| **Tests** | `packages/tool-adapters/tests/slack/personal-slack-read.test.ts` | Integration tests với HTTP fixture stateful mở rộng, kiểm tra 8 methods, phân quyền, race condition khi revoke giữa response, AbortSignal, 429 retry. |

---

## 5. Ma Trận Kiểm Thử Hành Vi & Cổng Bằng Chứng

> Mọi kiểm thử thực tế được thực hiện bằng Vitest (`npm test -w @wap/tool-adapters`), sử dụng HTTP Fixture stateful mô phỏng chính xác multi-actor (`T_FREE`, `T_PRO`, actors A, B, Colleague). Trong phiên Docs-only hiện tại, tất cả các lệnh kiểm thử sản phẩm được đánh dấu `[Proposed: not run]`.

### 5.1. Ma Trận Kịch Bản Kiểm Thử
1. **Binding Validation:** Từ chối ngay trước transport nếu thiếu bất kỳ trường nào trong 5 trường của `SlackBinding` (`atiUserId`, `connectionId`, `workspaceId`, `slackUserId`, `identityVersion`).
2. **Pre-fetch F1 Denial:** Khi `policy.resolveReadPolicy` trả về `{ allowed: false }` hoặc `validateBindingActive` trả về `false`, adapter trả về `StepError` (`AUTH_ERROR`), không phát HTTP request.
3. **Post-fetch Revalidation Race:** Fixture trì hoãn response 50ms; trong khoảng thời gian đó hook giả lập kết nối bị revoke / identityVersion bị đổi -> Adapter drop toàn bộ dữ liệu nhận được và ném `AUTH_ERROR`.
4. **Channel Isolation & Cross-Workspace Collision:** Workspace A và Workspace B đều có kênh `C_GENERAL`; gọi bằng token của A chỉ trả về dữ liệu kênh của A, không đọc được dữ liệu của B.
5. **Native ACL Enforcement:**
   - Kênh public: Actor A và B đều đọc được.
   - Kênh private `G_PRIVATE`: Chỉ thành viên có quyền (Actor A) đọc được; Colleague gọi trả về `channel_not_found` / `missing_scope`.
   - DM `D_PRIVATE`: Chỉ người tham gia đọc được.
6. **Thread Replies Integrity:** Gọi `conversations.replies` với `ts` không phải root thread trả về lỗi `thread_not_found`.
7. **Pagination Budgeting:** Cursor phân trang trả đúng số lượng trong limit (budget max 100); limit âm hoặc không hợp lệ bị từ chối; `nextCursor` rỗng khi hết trang.
8. **Sanitized User Details:** `users.list` và `users.info` trả về thông tin profile đã lọc sạch, không chứa email nhạy cảm hoặc token.
9. **Chat Permalink Generation:** `chat.getPermalink` trả về link chuẩn web format `https://.../archives/.../p...`.
10. **AbortSignal Cancellation:** Kích hoạt `AbortController.abort()` trước hoặc trong khi fetch -> Adapter hủy request ngay lập tức, trả lỗi `NETWORK` / aborted.
11. **HTTP 429 & Retry-After Handling:** Fixture trả 429 kèm `Retry-After: 1` -> Adapter chờ và retry thành công ở lần thứ 2; nếu quá số lần retry tối đa -> Ném `RATE_LIMIT`.
12. **No Credentials in Output/Errors:** Quét toàn bộ payload kết quả, error details và logs để xác nhận không chứa Bearer token hoặc secret key.

### 5.2. Lệnh Kiểm Tra Cổng Bằng Chứng (Evidence Gates)
```powershell
# [Proposed: not run] Kiểm tra Schemas thuần:
# npx vitest run packages/tool-schemas/tests/myslack-read-schemas.test.ts

# [Proposed: not run] Kiểm tra Adapter với Stateful Fixture:
# npx vitest run packages/tool-adapters/tests/slack/personal-slack-read.test.ts

# [Proposed: not run] Typecheck toàn hệ thống:
# npm run typecheck:v3

# [Docs-only Verification Gate - Chạy thực tế trong phiên lập kế hoạch]:
# git diff --check 7c6c65d8..HEAD
```

---

## 6. Kết quả (Dành cho Agent Thi công)

*(Phần này để trống cho agent thi công ghi lại kết quả RED→GREEN, commit hashes, test logs và evidence sau khi hoàn thành thi công mã nguồn).*
