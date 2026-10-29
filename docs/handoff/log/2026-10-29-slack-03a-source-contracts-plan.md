# 29/10/2026 · Hoạch Định SLACK-03A: Hợp Đồng Nguồn, ACL, Vòng Đời & Siêu Dữ Liệu Công Cụ

**Tác giả:** Integration / Schema Planning Owner (Antigravity gemini-3.8-flash-high).
**Ủy quyền:** Điều phối viên trưởng (Coordinator) chỉ định Antigravity builder hoàn thiện kế hoạch chi tiết và task card cho **SLACK-03A** (Hợp đồng vòng đời nguồn, ACL, cascade purge và siêu dữ liệu công cụ theo phương thức).
**Phạm vi phiên:** **CHỈ TÀI LIỆU KẾ HOẠCH (Documentation Planning Only)**.
**Nhánh công việc:** `VinhDat267/docs-slack-03a-source` (phân nhánh từ `integration/slack-personal-20261029` tại `b757ae0`).
**Task card cha:** [`docs/handoff/tasks/SLACK-03-tool-catalog-and-source-lifecycle.md`](../tasks/SLACK-03-tool-catalog-and-source-lifecycle.md).
**Task card bounded:** [`docs/handoff/tasks/SLACK-03A-source-contracts.md`](../tasks/SLACK-03A-source-contracts.md).
**Kế hoạch chi tiết:** [`docs/superpowers/plans/2026-10-29-slack-03a-source-contracts.md`](../../superpowers/plans/2026-10-29-slack-03a-source-contracts.md).
**Sổ cái kiểm kê 354 methods:** [`docs/superpowers/plans/slack-354-method-ledger.json`](../../superpowers/plans/slack-354-method-ledger.json).

---

## 1. Bối Cảnh Tích Hợp & Cổng Phụ Thuộc Hợp Đồng (Context & Gates)

1. **Kế thừa các hợp đồng đã được phê duyệt:**
   - Hợp đồng nền tảng SLACK-01 (`myslack-context.ts`, `myslack-policy.ts`) đã hoàn tất.
   - Hợp đồng kết nối SLACK-02A (`myslack-connection.ts`) đã được chấp thuận tại commit `6871087`.
   - Bản sửa lỗi cô lập callback SLACK-02R (`0015_slack_callback_order.sql`) đã được phê duyệt tại PR #190.
2. **Cổng phụ thuộc Backend 02B (Prerequisite Gate):**
   - Candidate PR #192 (`19e4e39c`) cho SLACK-02B đang trong đợt blocking review (hoàn thiện `returnTo` và policy revision / config matching).
   - Tầng hợp đồng thuần 03A (`packages/tool-schemas`) được thiết kế hoàn toàn độc lập với mã nguồn runtime backend, không import cơ sở dữ liệu nội bộ hay token mã hóa.
   - Các module tiêu thụ backend (03B) và adapter (03C) **bắt buộc đợi 02B được nghiệm thu và merge chính thức** trước khi thi công mã nguồn.
3. **Thỏa thuận tham chiếu chính sách với Backend (Coordinator Direction):**
   - Nhận chỉ đạo trực tiếp từ Điều phối viên trưởng qua thông điệp `msg_cc1023f0b0f3`: Thống nhất cấu trúc `SlackPolicyReference` gồm đầy đủ `SlackBinding`, `purpose`, `requestedRetentionDays`, `providerProfileId`, `configFingerprint`, `policyVersion`, và hai trường `consentRevision` / `providerRevision` dưới dạng **chuỗi số thập phân chuẩn tắc (canonical decimal strings)** để an toàn JSON (BigInt lưu trữ nội bộ repository).
   - Kiểm tra revalidation bắt buộc so khớp toàn bộ các trường này; nếu quyền bị thu hồi rồi cấp lại (kể cả khi trùng nhãn người dùng), `consentRevision` tăng lên sẽ làm vô hiệu hóa tham chiếu cũ ngay lập tức.

---

## 2. Giải Pháp Kỹ Thuật & Kiến Trúc Đã Hoạch Định (Architectural Design)

1. **Kế thừa & Mở rộng Tương thích Định danh (`myslack-context.ts`):**
   - Kế thừa trực tiếp `SlackBinding` và `SlackSourceRef` nguyên bản, tuyệt đối không tạo shadow duplicate.
   - Mở rộng `SlackResourceType` thành kiểu union bao phủ toàn bộ các thực thể Slack từ kiểm kê 354 method:
     `'conversation' | 'message' | 'file' | 'canvas' | 'list' | 'list_item' | 'bookmark' | 'reminder' | 'user' | 'usergroup' | 'subteam'`.
   - Bổ sung hàm định dạng khoá phức hợp (`formatSlackCompositeResourceKey`, `formatSlackSourceKey`) bảo đảm cách ly tuyệt đối giữa các workspace, triệt tiêu nguy cơ va chạm ID kênh hoặc người dùng trùng tên/ID giữa hai tổ chức (F2).
2. **Hợp đồng Vòng đời Nguồn, Purge Cascade & Chính sách Lưu trữ F1 (`myslack-source.ts`):**
   - `SlackSourceEntity`: DTO đại diện cho nguồn nguyên bản trong kho nguồn, tách rời khỏi token/secrets, lưu vết `observedRevision`, `capturedAt`, `expiresAt`, `tombstonedAt`, `purgedAt`.
   - `SlackDerivedCopyRef` & `SlackSourceLineage`: Lưu vết mọi bản sao phái sinh trên 7 loại đích (`chat_history_message`, `working_memory_entity`, `plan_step_arg`, `proposal_excerpt`, `daily_digest_entry`, `scheduled_workflow_arg`, `audit_log_entry`) nhằm bảo đảm năng lực purge cascade triệt để sau này (F3).
   - `SlackTombstoneRecord` & `SlackPurgeTarget`: Hợp đồng chỉ định mục tiêu purge cascade khi có các sự kiện vòng đời (`source_deleted`, `source_edited`, `channel_membership_lost`, `connection_disconnected`, `app_reinstalled`, `consent_revoked`, `retention_expired`).
   - `decideSlackSourceStore`: Cổng kiểm soát lưu trữ nguồn F1; khi `retentionDays === 0`, từ chối lưu trữ lâu dài (`zero_retention_required`); từ chối lưu khi `policyVersion` không khớp với phiên bản chính sách đang hoạt động của server.
3. **Hợp đồng Siêu Dữ Liệu Công Cụ Theo Phương Thức (`myslack-tools.ts`):**
   - Bác bỏ generic dispatcher `method + args`. Định nghĩa `SlackToolMetadata` và `SlackToolDefinition` tường minh cho từng phương thức.
   - Phân loại rõ ràng: `family` (36 nhóm), `sideEffect` (`read` | `write`), `riskLevel` (`low` | `medium` | `high`), `planTier` (`free` | `pro` | `any`), `requiredScopes`.
   - `validateSlackToolExecutionArgs`: Tách biệt tham số thực thi, bắt buộc có `binding`, tự động tước bỏ mọi trường nhạy cảm (`token`, `accessToken`, `authHeader`), trả về detached whitelisted copy.
   - Nguyên tắc bất biến: **Schemas are contracts, not authority grants**. Sự tồn tại của schema không tự cấp quyền gọi API cho runtime nếu thiếu policy validation.
4. **Bảo toàn Cô lập Danh mục Toàn cục (`index.ts`):**
   - Re-export toàn bộ hợp đồng ra entrypoint `@wap/tool-schemas`.
   - Giữ nguyên invariant: `ALL_TOOLS.some(t => t.service === 'myslack') === false` và `SERVICE_REGISTRY.some(s => s.id === 'myslack') === false`.

---

## 3. Sổ Cái Đối Soát 354 Phương Thức Slack (PR 185 Snapshot SHA 811f5dc9)

Đã đối soát 100% không để bất kỳ method family nào biến mất:
- **Tổng số canonical methods:** 354.
- **Excluded:** 101 methods (92 Enterprise trong `admin.*`, 2 `team.*`, 2 app-level ingress token `apps.*`, 1 `conversations.externalInvitePermissions.set`, 1 deprecated `files.upload`, 1 retired `rtm.start`, 1 `users.discoverableContacts.lookup`, 1 deprecated `users.setActive`).
- **Probe Required:** 253 methods (Bảo toàn trạng thái unknown/probe cho đến khi có bằng chứng native).
- **Phân bổ giai đoạn:**
  - **Phase 03C (Core):** 51 methods (`conversations` 27, `chat` 13, `users` 11).
  - **Phase 03D (Content & Interaction):** 41 methods (`search` 3, `files` 14, `pins` 3, `reactions` 4, `bookmarks` 4, `reminders` 5, `stars` 3, `dnd` 5).
  - **Phase 03E / 04 (Advanced & Governance):** 161 methods.
  - **Excluded:** 101 methods.
- Toàn bộ được kết xuất vào file sổ cái: `docs/superpowers/plans/slack-354-method-ledger.json`.

---

## 4. Danh Mục Tài Liệu Bàn Giao

1. `docs/superpowers/plans/2026-10-29-slack-03a-source-contracts.md`: Kế hoạch thi công chi tiết 5 tasks chuẩn TDD Red-Green-Refactor.
2. `docs/handoff/tasks/SLACK-03A-source-contracts.md`: Bounded task card cho SLACK-03A.
3. `docs/superpowers/plans/slack-354-method-ledger.json`: Sổ cái ánh xạ 354 methods sang family, owner, risk, sideEffect và phase.
4. `docs/handoff/log/2026-10-29-slack-03a-source-contracts-plan.md`: File nhật ký bàn giao này.

---

## 5. Kết Quả Kiểm Tra working tree & Cam Kết Tuân Thủ

| Tiêu chuẩn kiểm tra | Kết quả thực tế |
|---|---|
| Mã nguồn sản phẩm (`apps/`, `packages/`, `db/`) | Không có bất kỳ file nào bị sửa đổi |
| Tài liệu quản trị (`CURRENT-STATE.md`, `ROADMAP.md`) | Không có bất kỳ thay đổi nào |
| Tài liệu task 02 | Không sửa đổi các task card 02 |
| Định dạng cú pháp Whitespace | `git diff --check b757ae0` sạch sẽ, exit code 0 |
| Trạng thái git working tree | Sạch sẽ, chỉ gồm 4 file tài liệu mới tạo |

Kế hoạch sẵn sàng để commit, push và mở Draft PR vào `integration/slack-personal-20261029`, sau đó gửi báo cáo `worker_done` cho Điều phối viên trưởng.
