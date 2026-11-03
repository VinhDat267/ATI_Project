# JIRA-09A Jira UI Foundation · 2026-11-02

- **Task:** `docs/handoff/tasks/JIRA-09A-ui-foundation.md`
- **Plan:** `docs/superpowers/plans/2026-11-02-jira-09a-ui-foundation.md`
- **Branch:** `longnguyen005/jira-09a-ui`; PR mở dưới tài khoản GitHub `longnguyen005`, chờ reviewer độc lập nghiệm thu, không tự merge.
- **Phạm vi triển khai:**
  - `apps/chat-web/src/services/jira-api.ts`: Typed Jira API facade kết nối đầy đủ các endpoint JIRA-03–05 (`/api/connections/myjira/*`, `/api/jira-workspaces/*`, `/api/jira-workspace-join-requests`). Bổ sung `isRetry: true` ở bước trao đổi callback để chặn 401 retry replay.
  - `apps/chat-web/src/services/jira-connection.ts`: Helper quản lý session owner, chuyển hướng Atlassian OAuth, xác thực return path an toàn và chuẩn hóa thông báo lỗi Jira.
  - `apps/chat-web/src/views/JiraCallbackView.tsx`: Xử lý OAuth callback một lần (one-use). Dùng `useLayoutEffect` xóa ngay query parameters (`code`, `state`) trên thanh URL để ngăn replay khi reload hoặc stale tab; kiểm tra session owner tránh hoàn tất callback của tài khoản khác; ánh xạ mã lỗi định danh chi tiết (401 auth, 403 native permission denied / membership required, 409 stale version, 429 rate limit, 503 unavailable); tuyệt đối không tự động gửi lại tin nhắn hay tự động phê duyệt kế hoạch.
  - `apps/chat-web/src/pages/Settings/JiraConnection.tsx`: Thẻ kết nối danh tính cá nhân (`disconnected`, `identity_connected`, `scope_required`, `reconnect_required`, `connected`), đồng bộ site, ngắt kết nối an toàn; quản lý Jira workspace riêng biệt với org workspace (nhập token xin gia nhập, hiển thị vai trò admin/member và phiên bản CAS); các thao tác quản trị Jira workspace (duyệt/từ chối/loại bỏ thành viên theo CAS version, tạo/thu hồi mã mời, liên kết site, bật/tắt site active, cấu hình project keys theo version); hiển thị danh mục capabilities; nút bắt đầu hội thoại Jira trong Cockpit bị khóa kèm ghi chú chờ JIRA-08.
  - `apps/chat-web/src/routes.ts`, `apps/chat-web/src/hooks/use-route.ts`, `apps/chat-web/src/App.tsx`, `apps/chat-web/src/pages/Settings/SettingsPage.tsx`: Định tuyến `/connections/myjira/callback` và tích hợp giao diện Settings.
  - `apps/chat-web/tests/jira-api.test.ts`, `apps/chat-web/tests/jira-callback.test.tsx`, `apps/chat-web/tests/jira-connection.test.tsx`, `apps/chat-web/tests/jira-connection-responsive.test.tsx`, `apps/chat-web/tests/browser/jira-09a.spec.ts`: Bộ test toàn diện từ facade, callback, component states, responsive 1440px/375px, light/dark theme, refresh, delayed callback, user switching tới browser spec Playwright.
- **Bằng chứng kiểm thử thực tế:**
  - Focused Jira test suite:
    `npm test -w @wap/chat-web -- tests/jira-api.test.ts tests/jira-callback.test.tsx tests/jira-connection.test.tsx tests/jira-connection-responsive.test.tsx`
    -> 4 files / 41 tests PASS, exit 0.
  - Settings Page integration:
    `npm test -w @wap/chat-web -- tests/components/settings-page.test.tsx`
    -> 1 file / 7 tests PASS, exit 0.
  - Toàn bộ suite chat-web:
    `npm test -w @wap/chat-web`
    -> 96 files / 1027 tests PASS, exit 0.
  - Static Guard (kiểm soát ranh giới generic plumbing):
    `npx vitest run evaluations/generic-plumbing/static-guard.test.ts`
    -> 1 file / 2 tests PASS, exit 0.
  - TypeScript build & typecheck:
    `npm run typecheck:v3`
    -> Exit 0.
  - Production build & security audit:
    `npm run build:v3; node scripts/test-v3-web-build-security.mjs`
    -> PASS: production build excludes credential sentinels and 7 forbidden UI claims, exit 0.
- **Giới hạn và bước tiếp theo:**
  - Nút bắt đầu hội thoại Jira trong Cockpit chủ động hiển thị trạng thái disabled kèm ghi chú chờ JIRA-08 (khi backend/planner mở cờ `MYJIRA_ENABLED` và cho phép thực thi live cockpit).
  - Không sửa đổi bất kỳ code nào ngoài `apps/chat-web/` và handoff docs của task này.
  - Không sửa `CURRENT-STATE.md` và `ROADMAP.md` (chỉ reviewer cập nhật sau khi merge).
