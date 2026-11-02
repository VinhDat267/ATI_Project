# JIRA-09A Jira UI Race Condition and Error Status Fixes · 2026-11-02

- **Task:** `docs/handoff/tasks/JIRA-09A-ui-foundation.md`
- **Branch:** `longnguyen005/jira-09a-ui` (PR #258)
- **Nội dung xử lý theo phản hồi người dùng:**
  1. **Ngăn chặn rò rỉ mã mời khi phản hồi tạo mã mời đến muộn (`JiraConnection.tsx`)**:
     - Khi người dùng bấm "Tạo mã mời" ở Workspace A và nhanh chóng chuyển sang Workspace B, phản hồi bất đồng bộ từ `jiraApi.createInvite` đến muộn trước đây vẫn gọi `setCreatedInviteToken(res.inviteToken)` do chỉ kiểm tra `mounted.current`.
     - Đã thêm chốt chặn `activeWorkspaceIdRef.current === targetWsId` cho `handleCreateInvite` (line 420) và toàn bộ các thao tác bất đồng bộ theo workspace (`handleMemberDecision`, `handleRevokeInvite`, `handleLinkSite`, `handleToggleSiteActive`, `handleOpenProjectConfig`, `handleSaveProjects`).
     - Khi phản hồi của workspace cũ trả về sau khi người dùng đã chuyển sang workspace mới, mã mời và các cập nhật chi tiết của workspace cũ sẽ bị bỏ qua hoàn toàn, không hiển thị trên workspace mới.
  2. **Hiển thị đúng "Lỗi kết nối" cho các mã lỗi HTTP 403, 429, 500 (`JiraConnection.tsx`)**:
     - Trước đây, logic `catch` trong `fetchConnection` chỉ kiểm tra `status === 401 || status === 503 || isNetwork`, còn tất cả các mã lỗi khác (bao gồm 403 Forbidden, 429 Rate Limit, 500 Internal Server Error) đều rơi vào nhánh `else` gán `connectionState: 'disconnected'` và xoá trắng `connectionError`.
     - Điều này khiến giao diện hiển thị sai lệch thành badge "Chưa kết nối" thay vì báo lỗi cho người dùng.
     - Đã sửa lại: chỉ HTTP 404 (chưa cấu hình endpoint) mới được coi là `disconnected`; tất cả các lỗi HTTP (401, 403, 429, 500, 502, 503, 504) cùng lỗi mạng đều đặt `connectionError` và kích hoạt badge "Lỗi kết nối", kèm thông điệp chi tiết và nút "Thử lại".
     - Cập nhật hàm `mapErrorMessage` để định dạng chính xác thông báo tiếng Việt thân thiện cho 403 ("Bạn không có quyền thực hiện thao tác hoặc truy cập kết nối Jira này."), 429 ("Atlassian đang giới hạn tần suất yêu cầu. Vui lòng thử lại sau."), và >= 500 ("Có lỗi xảy ra từ máy chủ Jira. Vui lòng thử lại sau."), đồng thời ưu tiên chuỗi `err.data.error` từ máy chủ nếu có.
  3. **Hiển thị tên và ID tài khoản Atlassian khi `connectionState === 'scope_required'` (`JiraConnection.tsx`)**:
     - Mở rộng điều kiện hiển thị thông tin danh tính: `(isConnected || isIdentityConnected || isScopeRequired)`.
     - Hiển thị cả tên tài khoản Atlassian (`displayName`) và mã định danh tài khoản Atlassian (`atlassianAccountId` gắn nhãn "ID tài khoản Atlassian"), cùng Jira Account ID nếu có.
  4. **Kiểm thử bổ sung**:
     - Vitest `apps/chat-web/tests/jira-connection.test.tsx`:
       - Thêm test `displays connection error on 403, 429, and 500 instead of "Chưa kết nối"`.
       - Thêm test `ignores late-arriving createInvite response from workspace A after switching to workspace B`.
       - Thêm test `renders scope_required state with Atlassian name, account ID, badge and allows authorizing sites`.
     - Playwright `apps/chat-web/tests/browser/jira-09a.spec.ts`:
       - Bổ sung xác thực trình duyệt thực tế cho chuỗi lỗi 500, 429, 403, và 503 đảm bảo hiển thị đúng badge "Lỗi kết nối", thông báo lỗi tương ứng, nút "Thử lại", và tuyệt đối không hiện "Chưa kết nối".
       - Bổ sung xác thực trạng thái `scope_required`: hiển thị badge "Cần cấp quyền site", tên tài khoản Atlassian, ID tài khoản Atlassian, và nút "Cấp quyền Jira site".
       - Bổ sung kịch bản giữ phản hồi tạo mã mời đang chờ (`holdInviteResponse = true`), chuyển sang Workspace 2, sau đó mới trả phản hồi và xác nhận mã mời không bao giờ xuất hiện ở Workspace 2.

- **Bằng chứng kiểm thử thực tế:**
  - **Focused Jira Suites**:
    `npm test -w @wap/chat-web -- tests/jira-api.test.ts tests/jira-callback.test.tsx tests/jira-connection.test.tsx tests/jira-connection-responsive.test.tsx`
    -> 4 files / 47 tests PASS (exit code 0).
  - **Settings Page Integration**:
    `npm test -w @wap/chat-web -- tests/components/settings-page.test.tsx`
    -> 1 file / 7 tests PASS (exit code 0).
  - **Toàn bộ Web Tests**:
    `npm test -w @wap/chat-web`
    -> 96 files / 1033 tests PASS (exit code 0).
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
    -> 1 passed (4.9s, exit code 0).
