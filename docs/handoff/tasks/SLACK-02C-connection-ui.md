# SLACK-02C · Giao diện Cài đặt Đa Workspace & Callback View (Frontend)

**Trạng thái:** chờ triển khai  
**Nhánh gợi ý:** `feat/slack-02c-connection-ui` · **Nền:** `fc12e3fb`  
**Vai trò sở hữu:** Frontend Engineer (sở hữu `apps/chat-web/` và file chạy browser test `scripts/test-v3-browser.mjs`)  
**Phụ thuộc:** SLACK-02A (contracts), SLACK-02B (API endpoints)  
**Task cha:** [SLACK-02-personal-connections](SLACK-02-personal-connections.md)  
**Kế hoạch chi tiết:** Task 6 trong [Kế hoạch SLACK-02](../../superpowers/plans/2026-10-29-slack-02-personal-connections.md).

---

## 1. Mục tiêu và Phạm vi

Thi công giao diện người dùng trên web (`apps/chat-web`) cho tính năng kết nối Slack cá nhân đa workspace:
- Thẻ dịch vụ `PersonalMySlack` trong mục "Của riêng bạn" tại trang Cài đặt (`/settings`).
- Hỗ trợ hiển thị danh sách nhiều workspace đã kết nối của người dùng.
- Thao tác kết nối thêm workspace mới và ngắt kết nối từng workspace có modal xác nhận.
- Trang Callback (`/connections/myslack/callback`) xử lý kết quả trả về từ Slack và hỗ trợ quay lại hội thoại gốc qua `returnTo`.
- Kiểm thử hiển thị trên 1440px (Desktop), 375px (Mobile) và cả 2 chế độ Sáng / Tối.

---

## 2. Chi Tiết File Cần Tạo và Cập Nhật

### 2.1. File Tạo Mới: `apps/chat-web/src/pages/Settings/PersonalMySlack.tsx`
- Nhận prop danh sách các kết nối Slack `connections: SlackConnectionPublicInfo[]`.
- Hiển thị danh sách từng workspace:
  - Tên Workspace, Logo Slack, Tên người dùng Slack (`slackUserLabel`).
  - Badge trạng thái:
    - `Đã kết nối` (xanh lá) khi `status === 'active'` và `consentStatus === 'granted'`.
    - `Chờ cho phép xử lý` (vàng hổ phách) khi `status === 'active'` nhưng `consentStatus !== 'granted'`.
    - `Cần kết nối lại` (đỏ) khi `status === 'reconnect_required'`.
  - Nút hành động cho từng workspace:
    - Nút "Ngắt kết nối" (mở modal CockpitDialog xác nhận trước khi thực hiện).
    - Nút "Kết nối lại" khi ở trạng thái `reconnect_required`.
- Nút chung: **"Kết nối Workspace Slack"** (bắt đầu luồng OAuth thêm workspace mới).
- Trạng thái trống (empty state): "Chưa có workspace nào được kết nối."

### 2.2. File Tạo Mới: `apps/chat-web/src/views/MySlackCallbackView.tsx`
- Đọc `code`, `state`, `error` từ URL query parameters.
- Kiểm tra cookie trình duyệt và gọi `apiClient.completeSlackConnection(code, state)`.
- Hiển thị trạng thái "Đang hoàn tất kết nối Slack...".
- Xử lý các mã lỗi thân thiện:
  - `SLACK_STATE_INVALID`: "Phiên kết nối đã hết hạn hoặc không hợp lệ. Vui lòng thử lại."
  - `SLACK_SCOPE_MISSING`: "Chưa cấp đủ quyền đọc và thao tác cho ATI."
  - `SLACK_IDENTITY_CONFLICT`: "Tài khoản Slack này trong workspace đã được kết nối bởi một tài khoản ATI khác."
  - `SLACK_CONNECT_FAILED`: "Không thể hoàn tất kết nối. Hãy kiểm tra mạng và thử lại."
- Khi thành công:
  - Nếu có `returnTo` hợp lệ (`/c/<uuid>`): Chuyển hướng quay lại hội thoại chat.
  - Nếu không: Chuyển hướng về `/settings#myslack`.

### 2.3. Dịch Vụ & Helpers: `apps/chat-web/src/services/myslack-connection.ts`
- Quản lý session owner, chuyển hướng tới Slack URL, parse lỗi callback.

### 2.4. Hook Kích Hoạt Cờ: `apps/chat-web/src/hooks/use-myslack-enabled.ts`
- Đọc `apiClient.getRuntime()`, kiểm tra `myslackEnabled === true`.
- Khi cờ tắt: Không hiển thị `PersonalMySlack` trong Settings, không mount route callback.

### 2.5. Cập Nhật Các Files Hệ Thống
1. `apps/chat-web/src/routes.ts`: Thêm route `myslack-callback` (`/connections/myslack/callback`).
2. `apps/chat-web/src/services/api-client.ts`: Thêm các hàm `startSlackConnection`, `completeSlackConnection`, `getSlackConnections`, `disconnectSlackConnection`.
3. `apps/chat-web/src/pages/Settings/SettingsPage.tsx`: Nhúng `PersonalMySlack` vào section "Của riêng bạn".
4. `apps/chat-web/src/App.tsx`: Định tuyến tới `MySlackCallbackView`.

---

## 3. Kiểm Thử Giao Diện & Bằng Chứng

1. **Unit & Integration Tests (`apps/chat-web/tests/`):**
   - `myslack-ui.test.tsx`:
     - Render danh sách nhiều workspace (2 workspace hiển thị đúng tên và trạng thái độc lập).
     - Click ngắt kết nối hiển thị modal xác nhận.
     - Click kết nối lại gọi đúng API.
     - Cờ `MYSLACK_ENABLED=off` ẩn hoàn toàn component.
   - `myslack-callback.test.tsx`:
     - Xử lý thành công chuyển hướng về `/settings#myslack` hoặc `returnTo`.
     - Hiển thị đầy đủ thông báo lỗi cho các trường hợp lỗi backend.
2. **End-to-End Browser Tests:**
   - Cập nhật kịch bản kiểm thử giao diện cho Slack callback và Settings trong `scripts/test-v3-browser.mjs` (bảo toàn tất cả các group test cũ).

---

## 4. Tiêu Chí Nghiệm Thu
- [ ] Giao diện hỗ trợ mượt mà người dùng có 0, 1 hoặc nhiều workspace Slack.
- [ ] Responsive hoàn hảo tại 1440px và 375px; hỗ trợ theme sáng và tối không vỡ layout.
- [ ] Không có lỗi console hoặc warning React runtime.
- [ ] Mọi test frontend trong `npm test -w apps/chat-web` đều PASS.
