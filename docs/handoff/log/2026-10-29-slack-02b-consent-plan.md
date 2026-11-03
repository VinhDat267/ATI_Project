# 29/10/2026 · Kế hoạch Đối Soát SLACK-02B: Organization Consent & Backend Reconciliation

**Ngày lập:** 29/10/2026 (Asia/Bangkok)
**Tác giả:** Antigravity Worker (gemini-3.8-flash-high)
**Nhánh làm việc:** `docs/slack-02b-consent` (phân nhánh từ `6871087` trên `feat/slack-02a-connection-contracts`)
**Task Card:** [`docs/handoff/tasks/SLACK-02B-oauth-backend.md`](../tasks/SLACK-02B-oauth-backend.md)
**Mục đích:** Xây dựng kế hoạch đối soát chi tiết và chuẩn hóa phạm vi triển khai backend cho **SLACK-02B**, kế thừa toàn diện nền tảng OAuth từ PR #184 (`ac448dd`) và bản sửa lỗi cô lập callback 02R (`0015_slack_callback_order.sql`), tập trung thi công chính sách chấp thuận tổ chức F1, kiểm định nhà cung cấp mô hình tin cậy và giao diện vòng đời cho Phase 3.

---

## 1. Tóm Tắt Đối Soát Kiến Trúc (Architecture Reconciliation)

1. **Kế thừa & Không viết lại OAuth:**
   - Nhánh candidate PR #184 (`ac448dd`) đã có các bảng `slack_connections` và `slack_oauth_states` qua migration `0014_slack_oauth_connections.sql`.
   - Bản sửa lỗi 02R (`fix-slack-callback-isolation`) giải quyết triệt để lỗi xóa nhầm state khi kết nối đồng thời qua migration `0015_slack_callback_order.sql` (`order_seq` CAS check, xóa state cục bộ theo `(id, user_id)`).
   - SLACK-02B **tuyệt đối không tạo file migration 0014 trùng lặp**. Migration mới là đề xuất `0016_slack_processing_consents.sql`.

2. **Cập nhật Chuẩn Khả Năng (Capability Route):**
   - Khả năng kết nối Slack cá nhân được công bố qua route hiện hữu `GET /api/services` với trường `personalOAuth: ['myslack']` khi cờ `MYSLACK_ENABLED=on` và provider sẵn sàng (theo đúng luồng `useSettings.ts` của frontend), không tạo thêm trường mới tại `/api/health`.

3. **Lớp Ánh Xạ Tương Thích (Compatibility Boundary):**
   - Database hiện hữu lưu trữ: `actor_id` và `status IN ('active', 'reconnect_required', 'disconnected')`.
   - Hợp đồng chuẩn tắc SLACK-02A quy định: `slackUserId` và `status IN ('active', 'reconnect_required', 'revoked')`.
   - Backend 02B thiết lập lớp ánh xạ tại tầng Repository/Router:
     - `slackUserId: row.actor_id`
     - `status: row.status === 'disconnected' ? 'revoked' : row.status`
     - Duy trì song song trường legacy (`actorId`) trong JSON response để bảo vệ các bài test và UI hiện có từ PR #184 không bị gãy trước khi 02C cập nhật.

4. **Phạm Vi Cốt Lõi Còn Lại: F1 Organization Consent & Trusted Providers:**
   - **Bảng `slack_trusted_providers`:** Quản lý danh sách nhà cung cấp mô hình được cấp phép, cờ `verified`, `no_training` và trần lưu trữ `max_retention_days`. Mặc định server-provisioned `verified: false`.
   - **Bảng `slack_processing_consents`:** Quản lý bằng chứng chấp thuận của từng workspace cho từng provider, bắt buộc `policy_version` non-blank, hỗ trợ `retention_days >= 0` (0 = no retention).
   - **Kiểm soát phân quyền nghiêm ngặt:** Thành viên thường không thể tự cấp quyền hoặc tự nhận `noTraining`. Mọi thao tác quản trị consent bắt buộc revalidate quyền Admin trực tiếp từ Database (`users.role = 'admin'` và `users.status = 'active'`) cùng phiên hoạt động trong `auth_sessions`.
   - **Tính toán `processingReady`:** Đánh giá động 6 tiêu chí fail-closed; bất kỳ tiêu chí nào chưa đạt đều đưa về `false`.
   - **Giao diện vòng đời cho Phase 3:** Cung cấp event bus `SlackConsentChangeEvent` để Phase 3 đăng ký xóa bộ nhớ đệm / purge cached sources khi consent bị thu hồi hoặc hết hạn.

---

## 2. Danh Mục Tài Liệu Được Tạo & Cập Nhật

1. [`docs/superpowers/plans/2026-10-29-slack-02b-consent-backend.md`](../../superpowers/plans/2026-10-29-slack-02b-consent-backend.md): Bản kế hoạch chi tiết gồm 6 tasks chuẩn TDD Red-Green-Refactor, định rõ files, signatures, test assertions và commands.
2. [`docs/handoff/tasks/SLACK-02B-oauth-backend.md`](../tasks/SLACK-02B-oauth-backend.md): Cập nhật card 02B theo đúng phạm vi đối soát mới.
3. [`docs/superpowers/plans/2026-10-29-slack-02-personal-connections.md`](../../superpowers/plans/2026-10-29-slack-02-personal-connections.md): Thêm ghi chú liên kết thay thế (superseding note) cho phần 02B.
4. `docs/handoff/log/2026-10-29-slack-02b-consent-plan.md`: File log bàn giao này.

---

## 3. Các Lựa Chọn Giao Diện Cần Leader Phê Duyệt (Unresolved Choices)

1. **Vị trí lưu trữ cấu hình Provider tin cậy:** Đề xuất lưu tại bảng `slack_trusted_providers` (với migration 0016) và nạp seed mặc định từ cấu hình máy chủ, thay vì parse JSON string từ env var để đảm bảo toàn vẹn dữ liệu qua foreign key.
2. **Quy ước trường `status`:** Giữ nguyên giá trị `'disconnected'` trong database hiện có của PR #184, ánh xạ sang `'revoked'` khi xuất ra DTO chuẩn 02A để không làm hỏng migrations cũ.
3. **Phân quyền CLI Operator:** Script `apps/chat-api/src/cli/slack-consent.ts` chạy qua CLI với quyền kết nối PostgreSQL trực tiếp, đại diện cho vai trò Root Operator trong hạ tầng.

---

## 4. Trạng Thái Mã Nguồn & Bàn Giao

- **Mã nguồn:** Không có mã nguồn sản phẩm (product code) nào bị sửa đổi.
- **Tài liệu handoff:** Không chỉnh sửa `CURRENT-STATE.md` hay `ROADMAP.md`.
- **Định dạng:** Đã kiểm tra `git diff --check` đạt 0 lỗi trailing whitespace.
- **Sẵn sàng:** Mở Draft PR kế hoạch dựa trên `feat/slack-02a-connection-contracts` và bàn giao cho Điều phối viên trưởng re-review.
