# SLACK-02B · Backend Hợp nhất OAuth & Chính sách Chấp thuận Tổ chức (F1 Backend)

**Trạng thái:** kế hoạch đã đối soát và cập nhật (chờ leader review)
**Nhánh gợi ý:** `feat/slack-02b-oauth-backend` · **Nền:** `6871087` (hoặc `ac448dd` sau khi merge PR #184 & 02R)
**Vai trò sở hữu:** Backend Engineer (sở hữu `apps/chat-api/`, `db/v3/` và scripts liên quan)
**Phụ thuộc:** SLACK-02A (contracts chuẩn tại `packages/tool-schemas`), PR #184 + 02R callback isolation
**Task cha:** [SLACK-02-personal-connections](SLACK-02-personal-connections.md)
**Kế hoạch chi tiết:** [Kế hoạch Triển khai 02B Backend & Consent](../../superpowers/plans/2026-10-29-slack-02b-consent-backend.md).

---

## 1. Mục tiêu và Phạm vi

Triển khai phần backend còn lại của SLACK-02, trọng tâm là **Chính sách Chấp thuận của Tổ chức (F1 Organization Consent)**, kiểm định nhà cung cấp mô hình tin cậy (Trusted Providers), tính toán metadata sẵn sàng (`processingReady`), thiết lập ranh giới tương thích với PR #184 + 02R và giao diện vòng đời cho Phase 3:
1. **Kế thừa & Không viết lại OAuth:**
   - Tái sử dụng bảng `slack_connections` và `slack_oauth_states` từ PR #184 (`ac448dd`).
   - Tái sử dụng migration `0015_slack_callback_order.sql` từ bản sửa lỗi cô lập callback 02R (`order_seq` CAS check và xóa state cục bộ theo `(id, user_id)`).
   - Tuyệt đối không tạo file migration `0014` trùng lặp. Migration tiếp theo là `0016_slack_processing_consents.sql`.
2. **Chính sách Chấp thuận Tổ chức (F1) & Quản Trị Tin Cậy:**
   - Bảng `slack_processing_consents`: Quản lý chấp thuận xử lý dữ liệu của tổ chức với `policy_version`, `status` (`pending` / `granted` / `revoked`), `retention_days >= 0`, `evidence_ref`, `authorized_by`, `granted_at`, `revoked_at`.
   - Bảng `slack_trusted_providers`: Lưu cấu hình nhà cung cấp tin cậy với cờ `verified`, `no_training` và trần lưu trữ `max_retention_days`.
   - Cung cấp Operator CLI (`apps/chat-api/src/cli/slack-consent.ts`) và Admin API routes (`/api/admin/connections/myslack/:workspaceId/consent...`) với kiểm tra phân quyền revalidation trực tiếp từ DB. Thành viên thường và request body từ client không thể tự tạo lòng tin.
3. **Tính toán `processingReady` & Lớp Ánh Xạ Tương Thích:**
   - Đánh giá động `processingReady` dựa trên 6 tiêu chí đồng thời (fail-closed).
   - Ánh xạ chuẩn: DB `actor_id` -> canonical `slackUserId`; DB `disconnected` -> canonical `revoked`.
   - Giữ nguyên các trường legacy để không làm gãy UI hay tests hiện hữu trước khi 02C thi công.
   - Xuất capability qua `GET /api/services` (`personalOAuth: ['myslack']`).
4. **Giao diện Vòng đời & Purge Event cho Phase 3:**
   - Thiết lập interface sự kiện nội bộ `SlackConsentChangeEvent` để Phase 3 đăng ký lắng nghe và kích hoạt xóa dữ liệu nguồn/bộ nhớ đệm tin nhắn khi consent bị thu hồi hoặc hết hạn lưu trữ.

---

## 2. Chi Tiết File Cần Tạo và Cập Nhật

### 2.1. File Tạo Mới
1. `db/v3/0016_slack_processing_consents.sql`:
   - Tạo bảng `slack_trusted_providers` (cấu hình provider tin cậy, mặc định `verified: false`).
   - Tạo bảng `slack_processing_consents` (lưu vết chấp thuận của workspace cho từng provider).
2. `apps/chat-api/src/db/repositories/slack-consent-repo.ts`:
   - Tra cứu và cập nhật consent, kiểm tra CAS, ghi nhận `revoked_at`.
3. `apps/chat-api/src/config/slack-policy-env.ts`:
   - Đọc cấu hình danh sách provider mặc định từ biến môi trường máy chủ.
4. `apps/chat-api/src/cli/slack-consent.ts`:
   - CLI script cho Operator: `grant`, `revoke`, `list` consents.
5. `apps/chat-api/src/routes/connections/slack-admin.ts`:
   - Router Express quản trị consent: `GET /api/admin/connections/myslack/:workspaceId/consents`, `POST .../consent`, `POST .../consent/revoke`.
   - Kiểm tra revalidation DB `users.role = 'admin'` và session còn hiệu lực trong `auth_sessions`.
6. `apps/chat-api/src/services/slack/consent-lifecycle.ts`:
   - Event bus / listener interface cho các thay đổi trạng thái chấp thuận phục vụ Phase 3.

### 2.2. File Cập Nhật
1. `apps/chat-api/src/db/repositories/slack-connection-repo.ts`:
   - Bổ sung hàm tính toán metadata `processingReady` kết hợp từ trạng thái kết nối và consent repo.
   - Thêm lớp ánh xạ trường `actor_id` <-> `slackUserId`, `disconnected` <-> `revoked`.
2. `apps/chat-api/src/routes/connections/slack.ts`:
   - Trả về envelope danh sách `{ connections: SlackConnectionPublicInfo[] }` chuẩn 02A kèm legacy fields.
3. `apps/chat-api/src/app.ts`:
   - Mount router `slack-admin.ts` khi cờ `MYSLACK_ENABLED=on`.

### 2.3. File Kiểm Thử
1. `apps/chat-api/tests/db/slack-consent-repo.test.ts`: Kiểm thử repo consent trên PostgreSQL thật.
2. `apps/chat-api/tests/routes/slack-admin-consent.test.ts`: Kiểm thử bảo mật role admin, từ chối member thường (403), audit log.
3. `apps/chat-api/tests/cli/slack-consent-cli.test.ts`: Kiểm thử lệnh CLI operator.
4. `apps/chat-api/tests/routes/slack-compatibility.test.ts`: Kiểm thử lớp ánh xạ tương thích và dynamic `processingReady`.
5. `apps/chat-api/tests/services/slack-consent-lifecycle.test.ts`: Kiểm thử event purge khi thu hồi consent.

---

## 3. Tiêu Chí Nghiệm Thu

- [ ] Migration `0016_slack_processing_consents.sql` thực thi an toàn, idempotent trên PostgreSQL.
- [ ] Thành viên thường (`role = 'member'`) không thể tự cấp quyền hoặc thay đổi cờ `noTraining` (luôn trả về 403 `ADMIN_REQUIRED`).
- [ ] `processingReady` chỉ true khi thỏa mãn đồng thời 6 điều kiện; chuyển ngay về `false` khi consent bị thu hồi.
- [ ] Khả năng kết nối được công bố qua `GET /api/services` (`personalOAuth: ['myslack']`).
- [ ] Các tests hiện hữu của PR #184 và 02R tiếp tục pass 100% nhờ lớp tương thích.
- [ ] Không có secret hay token nào bị lọt vào log, exception hay API responses.
- [ ] `npm run typecheck` đạt exit code 0; `git diff --check` đạt 0 lỗi whitespace.
