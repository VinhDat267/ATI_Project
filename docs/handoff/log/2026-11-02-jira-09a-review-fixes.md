# JIRA-09A Jira UI Review Fixes · 2026-11-02

- **Task:** `docs/handoff/tasks/JIRA-09A-ui-foundation.md`
- **Branch:** `longnguyen005/jira-09a-ui` (PR #258)
- **Nội dung xử lý theo phản hồi review:**
  1. **Ngăn rò rỉ dữ liệu khi chuyển Jira Workspace (`JiraConnection.tsx`)**:
     - `handleSelectWorkspace` và `useEffect` theo dõi `currentWorkspace.id` lập tức xóa sạch các state tạm thời: `createdInviteToken(null)`, `members([])`, `invites([])`, `sites([])`, `capabilities(null)`, `configuringSite(null)`.
     - Bổ sung `workspaceFetchSeqRef` và `activeWorkspaceIdRef` để loại bỏ phản hồi không đồng bộ đến muộn của workspace cũ (loại bỏ hoàn toàn race condition).
     - Với workspace có vai trò `member` (không phải admin), xóa triệt để dữ liệu danh sách thành viên/lời mời/site admin.
  2. **Hiển thị lỗi trung thực cho 401/503 và lỗi mạng (`JiraConnection.tsx`)**:
     - Phân loại rõ ràng các lỗi 401 (phiên đăng nhập hết hạn), 503 (dịch vụ tạm thời gián đoạn), và `fetch failed`/`TypeError` (lỗi mạng) thành `connectionError`.
     - Render badge trạng thái "Lỗi kết nối", kèm banner thông báo có nút "Thử lại" (`id="jira-retry-connection"`).
     - Tuyệt đối không hiển thị "Chưa kết nối" khi đang xảy ra lỗi kết nối mạng hoặc lỗi server (chỉ hiển thị "Chưa kết nối" khi nhận response 200 hợp lệ biểu thị trạng thái disconnected).
     - Response 404 từ `/api/connections/myjira` được coi là unconfigured/disconnected chuẩn, không gây báo lỗi giả.
  3. **Kiểm thử Browser Playwright thực tế (`apps/chat-web/tests/browser/jira-09a.spec.ts`)**:
     - Cấu hình session authentication hợp lệ (`wap_access_token`, `wap_refresh_token`, `wap_user`).
     - Kiểm thử kịch bản lỗi 503: hiển thị badge "Lỗi kết nối", xác nhận không có "Chưa kết nối", bấm "Thử lại" phục hồi thành công sang "Đã kết nối".
     - Kiểm thử luồng Connect: click `#jira-connect`, khởi tạo OAuth start, điều hướng đến `/connections/myjira/callback`, trao đổi mã một lần và tự động chuyển về `/settings#jira`.
     - Kiểm thử luồng Reload: tải lại trang Settings giữ nguyên trạng thái; tải lại trang callback sau khi URL đã được dọn sạch param hiển thị thông báo an toàn yêu cầu kết nối lại.
     - Kiểm thử luồng chuyển Workspace: tạo invite token tại Workspace 1, chuyển sang Workspace 2 kiểm tra token và dữ liệu quản trị Workspace 1 biến mất ngay lập tức.
     - Kiểm thử Stale tab & Đổi tài khoản: stale session trả về 401 kích hoạt modal hết phiên; tài khoản khác đăng nhập khi đang xử lý callback bị từ chối không gán token vào nhầm tài khoản.
     - Kiểm thử viewport 1440px / 375px, dark mode và kiểm tra chặn network ra ngoài Atlassian live.

- **Bằng chứng kiểm thử thực tế:**
  - **Focused Jira Suites**:
    `npm test -w @wap/chat-web -- tests/jira-api.test.ts tests/jira-callback.test.tsx tests/jira-connection.test.tsx tests/jira-connection-responsive.test.tsx`
    -> 4 files / 44 tests PASS (exit code 0).
  - **Settings Page Integration**:
    `npm test -w @wap/chat-web -- tests/components/settings-page.test.tsx`
    -> 1 file / 7 tests PASS (exit code 0).
  - **Toàn bộ Web Tests**:
    `npm test -w @wap/chat-web`
    -> 96 files / 1030 tests PASS (exit code 0).
  - **Typecheck v3**:
    `npm run typecheck:v3`
    -> Exit code 0.
  - **Static Guard Check**:
    `npx vitest run evaluations/generic-plumbing/static-guard.test.ts`
    -> 1 file / 2 tests PASS (exit code 0).
  - **Production Build & Security Sentinel**:
    `npm run build:v3; node scripts/test-v3-web-build-security.mjs`
    -> PASS: production build excludes credential sentinels and 7 forbidden UI claims (exit code 0).
  - **Playwright Browser Test**:
    `npx playwright test apps/chat-web/tests/browser/jira-09a.spec.ts`
    -> 1 passed (8.3s, exit code 0).
