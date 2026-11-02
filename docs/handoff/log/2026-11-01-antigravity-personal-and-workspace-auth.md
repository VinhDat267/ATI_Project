# 01/11/2026 — Personal Entry Auth & Multi-Organization Workspaces

**Nhánh:** `feat/personal-and-workspace-auth`. **Base:** `2afa4881`.
**Đặc tả:** [`docs/superpowers/specs/2026-11-01-personal-and-workspace-auth-design.md`](../../superpowers/specs/2026-11-01-personal-and-workspace-auth-design.md).
**Kế hoạch:** [`docs/superpowers/plans/2026-11-01-personal-and-workspace-auth.md`](../../superpowers/plans/2026-11-01-personal-and-workspace-auth.md).

## Kết quả

- **Xác thực vào thẳng Không gian Cá nhân:** tự động kích hoạt `users.status = 'active'` và khởi tạo phiên đăng nhập ngay khi xác minh email (`POST /api/auth/verify-email`) hoặc đăng nhập Google (`POST /api/auth/google/callback`); trả mã lỗi chuyên biệt `403 EMAIL_NOT_VERIFIED` khi đăng nhập mật khẩu trước khi xác minh email.
- **Đa không gian làm việc (`0015_workspaces.sql`):** tạo bảng `workspaces` (`invite_code`, `require_approval`), `workspace_members` (`role`, `status`), mở rộng `conversations`, `schedules`, `service_credentials`, `trello_team_scope`, `trello_team_boards`; bổ sung khối di trú dữ liệu idempotent chuyển người dùng đang hoạt động và dữ liệu chung hiện hữu vào tổ chức mặc định `"Không gian Chung"` khi nâng cấp từ cơ sở dữ liệu cũ.
- **Cô lập ngữ cảnh Backend & AI Planner:** middleware `X-Workspace-Id` (`personal` mặc định khi ứng dụng có `workspaceRepo`, `<uuid>` cho tổ chức, `legacy` cho các bài kiểm thử cũ không cấu hình `workspaceRepo`); cô lập tuyệt đối `CredentialRepo`, `TrelloTeamRepo`, `ConversationRepo`, `ScheduleRepo`, `ScheduleService`, `AdapterFactory`, `services-routes` health-check cache, `ChatService`, `ExecutionService`, `GET /api/conversations/:id/stream` và `Planner` / `GatherSearch`.
- **Giao diện Frontend (`@wap/chat-web`):** `WorkspaceSwitcher` trên `MainNav.tsx`, Context Pill trên `RequestMoments.tsx` và `SettingsPage.tsx`, Thẻ Mã mời Tổ chức trên `UsersPage.tsx` (sao chép mã/link mời, đổi mã, công tắc duyệt, chấp thuận tất cả, từ chối), cô lập `wap_active_workspace_id:<userId>` theo từng tài khoản, đồng bộ đa tab và tự động thoát hội thoại đang mở về `/` khi chuyển đổi không gian làm việc.

## Bằng chứng

| Kiểm tra | Output thực tế |
|---|---|
| `npm run typecheck:v3` | `exit 0` |
| `npm test -w @wap/planner` | `27/27 files` (`381/381 tests PASS`), `exit 0` |
| `npm test -w @wap/chat-api` | `111/111 files` (`821/821 tests PASS` trên PostgreSQL 16 thật), `exit 0` |
| `npm test -w @wap/chat-web` | `81/81 files` (`908/908 tests PASS`), `exit 0` |
| **Tổng cộng** | **219/219 test files — 2.110/2.110 tests PASS, 0 fail** |
