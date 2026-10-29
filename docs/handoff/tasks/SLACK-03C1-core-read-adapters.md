# SLACK-03C1 · Bounded Read Adapters cho 8 Phương Thức Cốt Lõi Slack Cá Nhân

**Trạng thái:** DỰ THẢO KẾ HOẠCH (Chờ Coordinator & Backend thẩm định interface; Docs-only, chưa thực thi code).
**Nhánh dự kiến:** `docs/slack-03c1-read-plan`
**Nền đối chiếu:** `7c6c65d8` (`integration/slack-personal-20261029`).
**PR Đích:** Draft PR to `integration/slack-personal-20261029`.
**Vai trò sở hữu:** Integration Engineer (`packages/tool-schemas/`, `packages/tool-adapters/`).
**Phụ thuộc:**
- **SLACK-01** (Foundation: `SlackBinding`, `SlackSourceRef`, `SlackModelPolicy`, fixture HTTP, offline probe) — ĐÃ XONG (`fc12e3fb`).
- **SLACK-02** (OAuth, `SlackTokenManager`, `SlackPolicyService`, connection UI) — ĐÃ TÍCH HỢP tại `7c6c65d8`.
- **SLACK-03A** (Source contracts, `SlackPolicyEpoch` & `packages/tool-schemas/src/myslack-tools.ts` dưới PR 194 / `bc8d6b69`, đã merge `57069aee`) — Sẵn sàng mở rộng canonical tool registry cho 8 read methods.
**Task cha:** [SLACK-03-tool-catalog-and-source-lifecycle](SLACK-03-tool-catalog-and-source-lifecycle.md)
**Kế hoạch chi tiết:** [Kế hoạch SLACK-03C1](../../superpowers/plans/2026-10-29-slack-03c1-core-read-adapters.md)

---

## 1. Mục tiêu và Phạm vi Nghiệp vụ (8 Read Methods Only)

Xây dựng bộ read adapters có giới hạn chặt chẽ (bounded read adapters) cho **đúng 8 phương thức đọc cốt lõi ban đầu** của Slack cá nhân (`myslack`), tuân thủ tuyệt đối quyền truy cập gốc của người dùng (native Slack user ACL), bảo vệ danh tính 5 trường bất biến (`SlackBinding`), kiểm thực chính sách F1 hai pha (pre-fetch & post-fetch re-authorization với canonical 8-field policy ref), cách ly tuyệt đối token bí mật bên trong adapter memory, và áp dụng chiến lược provenance quan sát minh bạch (transient read, retention 0).

### 1.1. Bảng 8 Phương Thức Đọc Cốt Lõi & Đối Soát Inventory
Đối soát chính xác theo `docs/slack/method-inventory.json` (SHA256: `e55bc180eb43c71c1131dbded5968c1e240d3424fe1314bf604139055c074f09`):

| Method Slack | HTTP / Tier | User Scopes Khai Báo | User Token | Inventory Disposition | Output Quan Sát Bounded |
|---|---|---|---|---|---|
| `conversations.list` | GET / t2 (20/m) | `channels:read, groups:read, im:read, mpim:read` | `documented` | `probe_required` | Danh sách kênh/hội thoại caller có quyền (`public_channel`, `private_channel`, `mpim`, `im`), phân trang cursor, budget max 100/trang. |
| `conversations.info` | GET / t3 (50/m) | `channels:read, groups:read, im:read, mpim:read` | `documented` | `probe_required` | Chi tiết hội thoại (`id`, `name`, `is_private`, `is_im`, `topic`, `purpose`, `num_members`), bảo toàn binding. |
| `conversations.history` | GET / t3 (50/m) | `channels:history, groups:history, im:history, mpim:history` | `documented` | `probe_required` | Danh sách tin nhắn phân trang; preserve exact decimal string `ts` và `edited.ts`; text trần là untrusted provider data. |
| `conversations.replies` | GET / t3 (50/m) | `channels:history, groups:history, im:history, mpim:history` | `documented` | `probe_required` | Luồng thread theo `channel` và root `ts`; phân trang cursor, budget max 100/trang; message không có replies trả `[root_message]`. |
| `conversations.members` | GET / t4 (100/m) | `channels:read, groups:read, im:read, mpim:read` | `documented` | `probe_required` | Danh sách ID thành viên trong kênh (`memberIds: string[]`), phân trang cursor, budget max 100/trang. |
| `users.list` | GET / t2 (20/m) | `users:read` | `documented` | `probe_required` | Danh sách tóm tắt người dùng trong workspace (`id`, `name`, `real_name`, `tz`, `is_bot`, `deleted`), lọc sạch profile không lộ email/credentials. |
| `users.info` | GET / t4 (100/m) | `users:read` | `documented` | `probe_required` | Chi tiết một người dùng theo `user` (ID), hồ sơ đã làm sạch, bảo toàn binding workspace. |
| `chat.getPermalink` | GET / t5 (Tier 5) | `null` (metadata không khai báo scope) | `undetermined` | `probe_required` | Deep link an toàn (`https://<ws>.slack.com/archives/<c>/p<ts>`) tới tin nhắn mà caller có quyền xem. |

### 1.2. Ranh Giới Nghiêm Ngặt & Quản Lý Backlog
1. **Bảo toàn trạng thái Inventory:** Toàn bộ 8 phương thức giữ nguyên trạng thái `disposition: probe_required` và `deliveryStatus: not_implemented` trong `method-inventory.json`. Schema và test fixture cục bộ KHÔNG PHẢI bằng chứng chấp thuận native; tuyệt đối không tự ý đánh dấu bất kỳ dòng nào trong 354 rows là đã hỗ trợ/ủy quyền.
2. **Không có Generic Dispatcher:** Nghiêm cấm tạo công cụ dạng `myslack.call(method, args)`. Adapter sử dụng fixed switch statement nội bộ cho đúng 8 methods; mọi công cụ phải có schema tham số và kết quả tường minh, không dynamic dispatch lỏng lẻo.
3. **Backlog tường minh trong Macro 03:** Các phương thức còn lại của nhóm cốt lõi (`conversations.*` còn 22 methods, `chat.*` còn 12 methods, `users.*` còn 10 methods) tiếp tục nằm trong backlog tường minh của SLACK-03 (03C2 write tools, 03D content/interactions, 03E advanced/governance), không bị bỏ quên.
4. **Cấm Ghi (No Write Dispatch):** Tuyệt đối không triển khai hoặc dispatch bất kỳ write tool nào (`chat.postMessage`, `chat.update`, `chat.delete`, v.v.) trong card này; các thao tác ghi bắt buộc phải chờ SLACK-04C với cơ chế outbox ledger và bảo vệ UNKNOWN được chấp thuận.
5. **Cách ly Catalog:** Không đăng ký tự động 8 read tools này vào `ALL_TOOLS` hay `SERVICE_REGISTRY` khi chưa có quyết định cờ `MYSLACK_ENABLED`. Catalog/routing/planner/executor là các task độc lập.

---

## 2. Quyền Sở Hữu Module & Hợp Đồng Injected Hooks

Tuân thủ nghiêm ngặt ranh giới sở hữu tại [Team Workflow](../../team-workflow.md):
- **Phạm vi Integration:** Chỉ sở hữu `packages/tool-schemas/` và `packages/tool-adapters/`.
- **Không xâm phạm Backend:** Tuyệt đối không import mã nguồn từ `apps/chat-api/` vào `packages/` và không chỉnh sửa bất kỳ tệp nào trong `apps/` hay `db/`.
- **Hạ tầng Injected Hooks (Dependency Inversion):**
  Trong `packages/tool-adapters/src/slack/personal-slack-types.ts`:

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
  apiBaseUrl?: string; // native https://slack.com/api hoặc explicit loopback http://127.0.0.1:<port>
  fetchFn?: typeof fetch;
  requestTimeoutMs?: number; // mặc định 10.000ms
}
```

### 2.1. Nhận Diện Backend Wrapper Task Độc Lập (Thiếu Hiện Tại)
Hiện tại, backend (`apps/chat-api`) có các chữ ký thực tế:
- `SlackTokenManager.getAccessToken(userId: string, id: string, identityVersion: number): Promise<string>`
- `SlackPolicyService.resolveSlackModelPolicy(input: ResolveSlackModelPolicyInput): Promise<SlackPolicyDecision>`

Backend API hiện tại KHÔNG nhận trực tiếp `SlackBinding` hay options object. Do đó, việc triển khai wrapper chuyển đổi từ backend sang `SlackTokenProviderHook` và `SlackReadPolicyHook` là **một task Backend độc lập** (thuộc vai trò Backend Developer).
Wrapper này có trách nhiệm:
1. Đối soát đầy đủ 5 trường của `SlackBinding` (`atiUserId`, `connectionId`, `workspaceId`, `slackUserId`, `identityVersion`) với dòng kết nối trong PostgreSQL.
2. Gọi `SlackTokenManager.getAccessToken(binding.atiUserId, binding.connectionId, binding.identityVersion)`.
3. Gọi `SlackPolicyService.resolveSlackModelPolicy` và chuyển đổi policy reference qua `validateSlackPolicyReference` (từ `@wap/tool-schemas`) để loại bỏ các trường legacy ngoài luồng (`providerId`, `configurationFingerprint`, v.v.), đảm bảo trả về đúng 8 trường chuẩn tắc của `SlackPolicyReference`.
4. Không để lộ token ra DTO công khai.

---

## 3. Nguyên Tắc Thiết Kế Kỹ Thuật (Architecture & Security Guardrails)

1. **Server-Confirmed 5-Field Binding Bắt Buộc:** Mọi request đọc bắt buộc phải mang đầy đủ 5 trường định danh: `atiUserId`, `connectionId`, `workspaceId`, `slackUserId`, `identityVersion`. Không bao giờ tự ý chọn token đầu tiên trong DB, không rebind theo tên, không cho phép hoán đổi workspace giữa chừng.
2. **Kiểm Thực Hai Pha F1 Toàn Diện (Two-Phase Policy & Lifecycle Barrier):**
   - **Pha 1 (Pre-transport):** Trước khi phát bất kỳ outbound HTTP request nào, gọi `policy.authorizeRead({ binding, purpose, requestedRetentionDays: 0 })`. Quyết định thành công bắt buộc trả về canonical 8-field `SlackPolicyReference`. Mọi quyết định boolean-only, thiếu trường hoặc sai lệch cấu trúc đều fail-closed (`AUTH_ERROR`). Adapter lưu trữ `prefetchPolicyRef` làm tham chiếu kỳ vọng.
   - **Pha 2 (Post-transport Re-Authorization):** Sau khi nhận HTTP response từ Slack provider và parse body (trong thời gian await provider có thể mất 200–500ms), adapter gọi lại `policy.authorizeRead({ binding, purpose, requestedRetentionDays: 0, expectedPolicyReference: prefetchPolicyRef })`. Nếu trong khoảng thời gian chờ mà kết nối bị ngắt, identity version bị bump, consent bị thu hồi, provider bị cập nhật, configuration fingerprint thay đổi, hoặc có regrant với epoch mới -> Lập tức hủy bỏ toàn bộ kết quả vừa đọc, làm sạch bộ nhớ và ném lỗi `AUTH_ERROR`. Tuyệt đối không giải phóng dữ liệu plaintext khi đã mất quyền.
3. **Retention 0 & Chiến Lược Provenance Quan Sát (Transient Reads):**
   - Mọi thao tác đọc của 03C1 đều có `requestedRetentionDays: 0`. Chúng không cấu thành `SlackSourceEntity` trong `SlackSourceStore` (03B) và không lưu dữ liệu nguồn bền vững vào DB.
   - Với các tài nguyên không có revision cập nhật gốc từ Slack (channel metadata, user profile, permalink), adapter áp dụng declared provenance type:
     ```ts
     export interface SlackObservationProvenance {
       binding: SlackBinding;
       observedAt: string; // ISO 8601 UTC timestamp
       acquisitionPolicyReference: SlackPolicyReference; // canonical 8-field ref từ authorizeRead (purpose + 0 TTL)
       nativeRevision?: string; // chỉ có khi Slack trả về (ví dụ edited.ts || ts)
       observationalDigest: string; // SHA-256 của JSON payload tại thời điểm quan sát
     }
     ```
     Backend 03B1 (`ctx_0b1305c28c8f`) yêu cầu `acquisitionPolicyReference` trong observation DTO để kiểm tra `sameSlackPolicyEpoch` trước khi lưu vào `SlackSourceStore`, chống bypass qua regrant policy mới. Tuyệt đối không tự bịa đặt revision gốc của Slack.
   - Giữ nguyên chuỗi số thập phân chính xác của `ts` và `edited.ts` (không parse sang float để chống sai số IEEE 754).
4. **Native ACL - Không Có Channel Allowlist:** Quyền đọc kênh công khai, kênh riêng, DM, nhóm DM được quyết định thuần túy bởi quyền thực tế của user token trên Slack (native Slack membership/ACL). Nếu user không có quyền vào kênh, Slack trả về `channel_not_found` hoặc `not_in_channel`; adapter map chính xác thành lỗi bảo mật tương ứng.
5. **Contract Của `conversations.replies`:** Khi gọi với tin nhắn hợp lệ không có câu trả lời trong thread, Slack trả về `ok: true` với `messages: [root_message]`. Adapter tuân thủ đúng hợp đồng provider này, không giả định sai là luôn ném `thread_not_found`.
6. **Endpoint Cố Định, An Toàn BaseURL & Bảo Vệ Bearer:**
   - `apiBaseUrl` chỉ cho phép native HTTPS (`https://slack.com/api`) hoặc explicit loopback fixture (`http://127.0.0.1:<port>`, `http://localhost:<port>`).
   - Cấm chuyển hướng: cấu hình `redirect: 'manual'` để ngăn rò rỉ Authorization header sang bên thứ ba.
   - Deep link permalink được kiểm tra cấu trúc an toàn: `https://<workspace>.slack.com/archives/<channel>/p<ts>`.
   - Lọc sạch profile người dùng: chỉ trả thông tin cơ bản (`id`, `name`, `real_name`, `tz`, `is_bot`, `deleted`), cấm lộ email, avatar hay credentials.
7. **Giới Hạn Bounded & Rate Limit An Toàn:**
   - Hạn mức kích thước body response tối đa 2MB.
   - Truyền `AbortSignal` thực vào `fetchFn` để hủy kết nối ngay khi caller timeout.
   - Giới hạn budget phân trang: mặc định 20–50 items/trang, tối đa 100 items/trang. Trả về `nextCursor` và `hasMore`.
   - Xử lý Rate Limit: Bắt HTTP 429 và đọc header `Retry-After`. Retry tối đa 2 lần với backoff có thể hủy. **Mỗi lần retry bắt buộc phải re-authorize Pha 1 F1** trước khi phát lại request.

---

## 4. Tệp Thay Đổi Dự Kiến & Chữ Ký Schema/Adapter

| Thao Tác | Đường Dẫn Tệp | Mục Đích & Nội Dung |
|---|---|---|
| **Modify** | `packages/tool-schemas/src/myslack-tools.ts` | Mở rộng canonical declared registry cho đúng 8 read methods, tái sử dụng nhất quán 3 samples hiện có (`conversations.list`, `conversations.history`, `users.info`), sử dụng đúng `SlackToolDefinition` fields hiện hữu, cập nhật `validateSlackToolExecutionArgs` fail-closed. |
| **Modify** | `packages/tool-schemas/src/index.ts` | Export các types/schemas đọc cập nhật từ `myslack-tools.ts` (không đụng vào `ALL_TOOLS`/`SERVICE_REGISTRY`). |
| **Create** | `packages/tool-adapters/src/slack/personal-slack-types.ts` | Các types nội bộ, interfaces injected hooks (`SlackTokenProviderHook`, `SlackReadPolicyHook`), provenance types, và config adapter. |
| **Create** | `packages/tool-adapters/src/slack/personal-slack-read-adapter.ts` | Triển khai `PersonalSlackReadAdapter` kế thừa `BaseAdapter`, thực thi 8 methods qua fixed switch, kiểm thực F1 hai pha, xử lý 429 retry re-auth, AbortSignal và mapping lỗi. |
| **Modify** | `packages/tool-adapters/src/index.ts` | Export `PersonalSlackReadAdapter` và hooks interfaces. |
| **Modify** | `packages/tool-schemas/tests/myslack-tools.test.ts` | Tests kiểm tra canonical registry cho 8 read tools, validation đệ quy fail-closed, từ chối tham số lạ và binding thiếu. |
| **Create** | `packages/tool-adapters/tests/helpers/personal-slack-mock-server.ts` | Local HTTP mock server thuộc sở hữu Integration (`@wap/tool-adapters`) phục vụ test fixture (tuyệt đối không sửa `scripts/fake-slack-personal.mjs`). |
| **Create** | `packages/tool-adapters/tests/slack/personal-slack-read.test.ts` | Integration tests với local mock server: 8 methods, kiểm thực F1 hai pha (consent revoked, provider updated, regrant while active), cross-workspace isolation, native ACL, 429 retry re-auth. |

---

## 5. Ma Trận Kiểm Thử Hành Vi & Cổng Bằng Chứng

> Mọi kiểm thử thực tế được thực hiện bằng Vitest (`npm test -w @wap/tool-adapters`), sử dụng HTTP Mock Server cục bộ mô phỏng chính xác multi-actor (`T_FREE`, `T_PRO`, actors A, B, Colleague). Trong phiên Docs-only hiện tại, tất cả các lệnh kiểm thử sản phẩm được đánh dấu `[Proposed: not run]`. Nghiệm thu database / concurrency thực tế đòi hỏi joint test giữa Backend và Integration trên PostgreSQL thật, không dùng mock hook làm bằng chứng DB.

### 5.1. Ma Trận Kịch Bản Kiểm Thử
1. **Binding Validation:** Từ chối ngay trước transport nếu thiếu bất kỳ trường nào trong 5 trường của `SlackBinding` (`atiUserId`, `connectionId`, `workspaceId`, `slackUserId`, `identityVersion`).
2. **Pre-fetch F1 Denial:** Khi `policy.authorizeRead` trả về `{ allowed: false, reason: 'consent_missing' }`, adapter trả về `StepError` (`AUTH_ERROR`), 0 HTTP request phát ra.
3. **Malformed F1 Decision:** Khi `policy.authorizeRead` trả về `allowed: true` nhưng thiếu hoặc sai lệch canonical 8-field `policyReference` -> Fail-closed, ném `AUTH_ERROR`, không phát request.
4. **Post-fetch Consent Revoked Race:** Mock server trì hoãn response 50ms; trong khoảng thời gian đó hook giả lập consent bị thu hồi -> Adapter drop toàn bộ dữ liệu nhận được, làm sạch bộ nhớ và ném `AUTH_ERROR`. Không trả plaintext output.
5. **Post-fetch Provider Updated / Config Fingerprint Changed:** Mock server trì hoãn 50ms; cấu hình provider hoặc config fingerprint bị thay đổi -> Post-fetch re-authorization fail do lệch policy epoch -> Drop payload, ném `AUTH_ERROR`.
6. **Post-fetch Regrant While Active:** Mock server trì hoãn 50ms; admin cấp lại consent với revision mới trong khi kết nối vẫn active -> Post-fetch re-authorization fail do epoch mismatch -> Drop payload, ném `AUTH_ERROR`.
7. **Cross-Workspace Token Mismatch:** Thực thi `bindingA` nhưng token provider trả token của Workspace B -> Bị chặn trước transport bởi backend wrapper / fixture auth.
8. **Cross-Workspace Colliding Channel:** Workspace A và Workspace B đều có kênh `C_GENERAL`; gọi bằng `bindingB` chỉ trả về dữ liệu kênh của Workspace B, tuyệt đối không lộ kênh của A.
9. **Native ACL Enforcement:**
   - Kênh public: Actor A và B đều đọc được.
   - Kênh private `G_PRIVATE`: Chỉ thành viên có quyền (Actor A) đọc được; Colleague gọi trả về `channel_not_found` / `missing_scope`.
   - DM `D_PRIVATE`: Chỉ người tham gia đọc được.
10. **Thread Replies Contract:** Gọi `conversations.replies` với `ts` của một tin nhắn hợp lệ không có câu trả lời -> Trả về `ok: true` kèm `messages: [root_message]` theo đúng hành vi Slack API.
11. **Exact Decimal Timestamp Preservation:** Tin nhắn mang timestamp `ts: '1712345678.000200'` và `edited.ts` được bảo toàn nguyên vẹn chuỗi số thập phân, không parse sang float.
12. **Sanitized Profile & Safe Deep Link:** `users.list` và `users.info` trả về thông tin profile đã lọc sạch (không rò rỉ email/token); `chat.getPermalink` sinh URL chuẩn `https://.../archives/.../p...`.
13. **AbortSignal Cancellation:** Kích hoạt `AbortController.abort()` trước hoặc trong khi fetch -> Adapter hủy request ngay lập tức, trả lỗi `NETWORK` / aborted.
14. **HTTP 429 Retry Re-Authorizes F1:** Mock server trả 429 kèm `Retry-After: 1` -> Chờ delay và gọi lại `authorizeRead` trước khi retry; nếu consent bị thu hồi trong lúc chờ -> Dừng retry ngay lập tức; nếu quá số lần retry tối đa -> Ném `RATE_LIMIT`.

### 5.2. Lệnh Kiểm Tra Cổng Bằng Chứng (Evidence Gates)
```powershell
# [Proposed: not run] Kiểm tra Schemas thuần:
# npx vitest run packages/tool-schemas/tests/myslack-tools.test.ts

# [Proposed: not run] Kiểm tra Adapter với Local Mock Server:
# npx vitest run packages/tool-adapters/tests/slack/personal-slack-read.test.ts

# [Proposed: not run] Typecheck toàn hệ thống:
# npm run typecheck:v3

# [Docs-only Verification Gate - Chạy thực tế trong phiên lập kế hoạch]:
# git diff --check 7c6c65d8..HEAD
```

---

## 6. Kết quả (Dành cho Agent Thi công)

*(Phần này để trống cho agent thi công ghi lại kết quả RED→GREEN, commit hashes, test logs và evidence sau khi hoàn thành thi công mã nguồn).*
