# 29/10/2026 · Hoàn Thiện Kế Hoạch Bounded Read Adapters SLACK-03C1 (8 Phương Thức Cốt Lõi)

**Ngày lập:** 29/10/2026 (Asia/Saigon)
**Tác giả:** Antigravity (Gemini 3.8 Flash High) · Integration Planning Owner
**Ủy quyền:** Coordinator điều phối và yêu cầu hiệu chỉnh toàn diện kế hoạch tài liệu (Docs-only) cho phân đoạn SLACK-03C1 sau review commit `b42d5b4b`.
**Nhánh làm việc:** `docs/slack-03c1-read-plan`
**Base commit:** `7c6c65d8` (`integration/slack-personal-20261029`).
**PR Đích:** Draft PR 197 to `integration/slack-personal-20261029`.
**Phạm vi phiên:** **CHỈ TÀI LIỆU KẾ HOẠCH (DOCS-ONLY)**. Sở hữu đúng 3 tài liệu; không sửa code sản phẩm, không sửa `CURRENT-STATE.md`, `ROADMAP.md`, `method-inventory.json`, `scripts/`, lockfiles hay bất kỳ card task nào khác. Không gọi native Slack API, không gọi model AI, không merge vào `main`.

---

## 1. Tóm Tắt Khắc Phục Các Khoảng Trống Theo Đánh Giá Của Coordinator

Phiên làm việc đã xử lý triệt để và đồng bộ trên cả 3 tài liệu (`SLACK-03C1-core-read-adapters.md`, `2026-10-29-slack-03c1-core-read-adapters.md`, và handoff log này) theo 5 yêu cầu cốt lõi:

1. **Kiểm Thực Hai Pha F1 Toàn Diện (Two-Phase Policy & Lifecycle Barrier):**
   - Loại bỏ cơ chế cũ chỉ kiểm tra `validateBindingActive` ở post-fetch (vốn không phát hiện được thay đổi consent, provider, config fingerprint hay epoch).
   - Thiết lập quy trình F1 hai pha:
     - *Pre-fetch:* Gọi `authorizeRead({ binding, purpose, requestedRetentionDays: 0 })`. Quyết định thành công bắt buộc là discriminated union `{ allowed: true, policyReference: SlackPolicyReference }` mang đầy đủ 8 trường chuẩn tắc (`binding`, `purpose`, `requestedRetentionDays`, `providerProfileId`, `configFingerprint`, `policyVersion`, `consentRevision`, `providerRevision`). Quyết định dạng boolean-only hoặc thiếu trường đều fail-closed (`AUTH_ERROR`). Ghi nhận `prefetchPolicyRef`.
     - *Post-fetch Re-Authorization:* Sau khi await transport và parse body, gọi lại `authorizeRead` truyền `expectedPolicyReference: prefetchPolicyRef`. Mọi biến động về epoch, purpose, TTL, thu hồi consent, thay đổi provider/fingerprint hoặc regrant với revision mới trong lúc await đều bị từ chối; adapter lập tức hủy payload, làm sạch bộ nhớ và ném `AUTH_ERROR`. Không giải phóng dữ liệu plaintext.
     - Xác lập rõ `requestedRetentionDays: 0` là transient read của adapter; tầng lưu trữ bền vững (persistent storage) thuộc trách nhiệm riêng biệt của 03B (`SlackSourceStore`).

2. **Chuẩn Hóa Chữ Ký Hooks & Đề Xuất Interface Cho Backend:**
   - Xóa bỏ các mục đích tự phát minh (`conversation_read`, `member_lookup`). Sử dụng chuẩn tắc:
     `SlackReadPurpose = Exclude<SlackPolicyPurpose, 'storage'>` (`'manual_lookup' | 'triage' | 'planning' | 'digest'`). Ngữ cảnh purpose do máy chủ cung cấp, không phải do mô hình tự quyết định.
   - Ghi nhận chính xác chữ ký hiện hữu của Backend:
     - `SlackTokenManager.getAccessToken(userId: string, id: string, identityVersion: number): Promise<string>`
     - `SlackPolicyService.resolveSlackModelPolicy(input: ResolveSlackModelPolicyInput): Promise<SlackPolicyDecision>`
   - Loại bỏ `forceRefresh` và options thừa trong adapter.
   - Nhận diện rõ ràng: Backend wrapper trong `apps/chat-api` chuyển đổi sang `SlackTokenProviderHook` (`getAccessToken(binding)`) và `SlackReadPolicyHook` (`authorizeRead(input)`) là **một task Backend độc lập còn thiếu**. Wrapper này chịu trách nhiệm kiểm tra 5 trường binding với PostgreSQL và bóc tách `validateSlackPolicyReference` để lọc sạch các trường legacy ngoài luồng. Đã gửi đề xuất interface tường minh cho Backend acceptance.

3. **Mở Rộng Canonical Declared Registry Trong `myslack-tools.ts` (03A `bc8d6b69` / `57069aee`):**
   - Không tạo file schema riêng lẻ `myslack-read-tools.ts`. Thay vào đó, kế hoạch mở rộng trực tiếp `packages/tool-schemas/src/myslack-tools.ts` cho đúng 8 read methods (`conversations.list`, `conversations.info`, `conversations.history`, `conversations.replies`, `conversations.members`, `users.list`, `users.info`, `chat.getPermalink`).
   - Tái sử dụng nhất quán 3 samples hiện có (`conversations.list`, `conversations.history`, `users.info`), không để xảy ra trùng lặp định nghĩa, shadow validator hay xung đột hợp đồng.
   - Áp dụng chuẩn xác các trường của `SlackToolDefinition` hiện hữu, không tự phát minh các types không được hỗ trợ.
   - Cập nhật `validateSlackToolExecutionArgs` để từ chối mọi method không nằm trong canonical registry kể cả khi cùng family.
   - Khẳng định helper HTTP nội bộ chỉ được gọi thông qua fixed switch statement, không làm generic dispatcher. Không đăng ký vào `ALL_TOOLS` hay `SERVICE_REGISTRY`.

4. **Sửa Đổi Phân Lập Cross-Workspace, Native ACL & Scopes/Rates:**
   - Đính chính lỗi phân lập: Mismatch giữa `bindingA` và `tokenB` bị chặn ngay trước transport bởi backend wrapper hoặc fixture auth. Với kênh trùng tên `C_GENERAL`, gọi bằng `bindingB` chỉ trả về duy nhất dữ liệu của Workspace B.
   - Đính chính contract của `conversations.replies`: Khi gọi với tin nhắn hợp lệ không có câu trả lời, Slack API trả về `ok: true` kèm `messages: [root_message]`; không giả định sai là luôn ném `thread_not_found`.
   - Ghim các rate limit theo từng tier mô tả của phương thức (t2: 20/m, t3: 50/m, t4: 100/m, t5); không giả định cào bằng 50/m. Header `Retry-After` khi nhận HTTP 429 có quyền quyết định tối cao.

5. **Chiến Lược Provenance Quan Sát, An Toàn Vận Hành & Ranh Giới Fixture:**
   - Ban hành kiểu dữ liệu provenance rõ ràng cho các thực thể không có revision gốc: `SlackObservationProvenance` gồm `binding`, `observedAt: string` (ISO 8601), `nativeRevision?: string` (chỉ có khi Slack cung cấp, ví dụ `edited.ts || ts`), và `observationalDigest: string` (SHA-256). Tuyệt đối không bịa đặt revision Slack giả.
   - Bảo toàn chuỗi số thập phân nguyên vẹn cho `ts` và `edited.ts`.
   - Làm sạch hồ sơ người dùng trong `users.info` và `users.list`, cấm lộ email, avatar, token.
   - Hạn chế `apiBaseUrl` chỉ nhận native HTTPS (`https://slack.com/api`) hoặc explicit loopback fixture (`http://127.0.0.1:<port>`), cấm chuyển hướng (`redirect: 'manual'`).
   - Xử lý 429: mỗi lần retry bắt buộc phải re-authorize Pha 1 F1.
   - Phân định quyền sở hữu fixture: `scripts/fake-slack-personal.mjs` thuộc DevOps; Integration tự tạo mock server helper riêng tại `packages/tool-adapters/tests/helpers/personal-slack-mock-server.ts`. Không sửa đổi `package.json` hay lockfiles.
   - Ghi nhận rõ ràng: nghiệm thu PG / token race condition thực tế đòi hỏi joint integration tests với backend trên PostgreSQL thật, không dùng mock hook làm bằng chứng DB.

---

## 2. Đề Xuất Interface Gửi Backend (Backend Acceptance Interface Proposal)

Đã đệ trình interface giao ước giữa Integration (`@wap/tool-adapters`) và Backend (`apps/chat-api`):

```ts
// packages/tool-adapters/src/slack/personal-slack-types.ts
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
```

*Nhiệm vụ của Backend Wrapper (Separate Task):*
1. Triển khai lớp wrapper thực thi 2 hooks trên trong `apps/chat-api`.
2. Kiểm tra `validateSlackBinding` và đối soát toàn bộ 5 trường binding với PostgreSQL.
3. Chuyển đổi và gọi `tokenManager.getAccessToken(binding.atiUserId, binding.connectionId, binding.identityVersion)`.
4. Gọi `policyService.resolveSlackModelPolicy` và chuẩn hóa policy reference qua `validateSlackPolicyReference` từ `@wap/tool-schemas` để đảm bảo định dạng 8 trường chuẩn tắc.

---

## 3. Danh Mục 3 Tài Liệu Được Cập Nhật

1. [`docs/handoff/tasks/SLACK-03C1-core-read-adapters.md`](../tasks/SLACK-03C1-core-read-adapters.md): Task card hoàn thiện (8 read methods, 5-field binding, two-phase F1 re-auth, Exclude<SlackPolicyPurpose, 'storage'>, canonical declared registry trong `myslack-tools.ts`, backend wrapper requirements, test matrix 14 kịch bản).
2. [`docs/superpowers/plans/2026-10-29-slack-03c1-core-read-adapters.md`](../../superpowers/plans/2026-10-29-slack-03c1-core-read-adapters.md): Kế hoạch triển khai tinh gọn (**187 dòng**, chuẩn mực `<= 260 dòng`), 4 tasks TDD, ma trận kiểm thử hành vi chi tiết.
3. [`docs/handoff/log/2026-10-29-slack-03c1-read-plan.md`](2026-10-29-slack-03c1-read-plan.md): File log bàn giao này.

---

## 4. Bằng Chứng Tự Kiểm Tra & Cổng Nghiệm Thu (Self-Verification Evidence)

| Hạng mục kiểm tra | Lệnh thực hiện | Kết quả thực tế | Trạng thái |
|---|---|---|---|
| Whitespace & Diff Cú Pháp | `git diff --check 7c6c65d8..HEAD` | Hoàn toàn sạch, không có whitespace thừa, exit code 0 | **PASS** |
| Trạng Thái Working Tree | `git status --porcelain` | Đúng 3 tệp tài liệu thuộc `docs/` | **PASS** |
| Bảo Vệ Mã Nguồn & Baseline | Kiểm tra `apps/`, `packages/`, `scripts/`, `CURRENT-STATE.md`, `ROADMAP.md` | Không có tệp nào ngoài 3 docs bị đụng chạm | **PASS** |
| Dung Lượng Kế Hoạch | Đếm dòng `2026-10-29-slack-03c1-core-read-adapters.md` | **187 dòng** (tiêu chuẩn: `<= 260 dòng`) | **PASS** |
| Đối Soát 8 Methods | Kiểm tra với `method-inventory.json` hash `e55bc180eb43c71c1131dbded5968c1e240d3424fe1314bf604139055c074f09` | Khớp 100% 8 methods, giữ nguyên `probe_required` | **PASS** |
| Kiểm Thử Sản Phẩm / Native | Vitest test suites, live API calls | Được ghi nhận rõ là **NOT_RUN** trong phiên lập kế hoạch | **PASS** |

---

## 5. Bàn Giao & Bước Tiếp Theo

1. Commit đúng 3 tệp tài liệu cập nhật lên nhánh `docs/slack-03c1-read-plan`.
2. Push cập nhật Draft PR 197 lên `origin/docs/slack-03c1-read-plan`.
3. Kiểm tra hòm thư điều phối qua `orca orchestration check`.
4. Gửi báo cáo hoàn tất qua `orca orchestration send --type worker_done` và chuyển về trạng thái nhàn rỗi (idle), chờ Coordinator và Backend phê duyệt interface proposal.
