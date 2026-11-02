# Bàn giao: GitHub OAuth cá nhân, phạm vi repo của nhóm và chế độ Bản tin tự động (`auto_digest`)

- **Ngày:** 2026-11-01
- **Nhánh:** `feat/github-oauth-and-digest`
- **Đặc tả & Kế hoạch:**
  - `docs/superpowers/specs/2026-11-01-github-digest-and-oauth-design.md`
  - `docs/superpowers/plans/2026-11-01-github-oauth-and-digest.md`

## Thay đổi
- **Task 1 — Cấu hình OAuth GitHub (`apps/chat-api/src/config/env.ts`, `apps/chat-api/tests/config/github-env.test.ts`):**
  - Đọc và chuẩn hoá `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_OAUTH_REDIRECT_URI`, `GITHUB_API_BASE_URL`, `GITHUB_OAUTH_AUTHORIZE_URL`, `GITHUB_OAUTH_TOKEN_URL`; chặn host loopback/private khi `RUNTIME_MODE=live`.
- **Task 2 — Schema PostgreSQL 0018 & Repository (`db/v3/0018_github_oauth_and_digest.sql`, `apps/chat-api/src/db/repositories/github-team-repo.ts`, `apps/chat-api/src/db/repositories/schedule-repo.ts`):**
  - Thêm bảng `github_team_scope`, mở rộng `oauth_states_mode_check` với `'connect_github'`, mở rộng `schedules` (`approval_mode`, `digest_config`, `digest_config_hash`, `schedules_digest_mode_check`, `schedules_digest_hash_check`) và `schedule_runs` (`digest_sent`, `digest_skipped`, `digest_failed`).
  - Triển khai `GitHubTeamScopeRepository` và mở rộng `ScheduleRepository` hỗ trợ `approvalMode`, `digestConfig`, `digestConfigHash`, `recordDigestRunOutcome`, và loại trừ `digest_sent`/`digest_skipped`/`digest_failed` khỏi `hasOpenRun` cũng như `recoverRunsAfterRestart`.
- **Task 3 — GitHub OAuth Client & Token Manager (`apps/chat-api/src/services/github/oauth-client.ts`, `apps/chat-api/src/services/github/token-manager.ts`):**
  - Đổi authorization code lấy access token, đọc identity `/user`, liệt kê `/user/repos`, mã hoá/giải mã credential cá nhân, chuyển trạng thái `reconnect_required` khi token gặp HTTP 401.
- **Task 4 — Route OAuth cá nhân, chọn repo nhóm và chặn PAT dùng chung (`apps/chat-api/src/routes/connections/github.ts`, `apps/chat-api/src/routes/services-routes.ts`):**
  - Triển khai `/api/connections/github` (`GET`, `/start`, `/callback`, `/repos`, `PUT /scope`, `DELETE`), trả `410 PERSONAL_OAUTH_REQUIRED` cho `POST/PUT /api/services/github/credentials` và `PUT /api/services/github/scope`, đồng thời đính kèm `personalStatus`/`username`/`connectedAt` trong `GET /api/services`.
- **Task 5 — Nâng cấp `GitHubAdapter` (`packages/tool-adapters/src/github/github-adapter.ts`):**
  - Hỗ trợ `baseUrl` cấu hình được (phục vụ OAuth fixture local) và bổ sung tự động `is:issue`/`is:pr` trong `github.search_issues` nếu query chưa có qualifier, giữ nguyên 5 tool `github.*` trong `ALL_TOOLS`.
- **Task 6 — Gắn kết nối GitHub cá nhân vào kế hoạch & thực thi (`apps/chat-api/src/services/github/connection-reference.ts`, `apps/chat-api/src/services/chat-service.ts`, `apps/chat-api/src/services/adapter-factory.ts`):**
  - Gắn `connections.github` (`credentialId`, `username`, `allowedRepos`) trước khi tính `plan_hash`, chỉ mở `github.*` cho planner khi thành viên đã kết nối và có quyền tối thiểu 1 repo của nhóm, kiểm tra khớp `credentialId` và tập repo lúc chạy, không cho phép dùng PAT `github` dùng chung.
- **Task 7 — Chọn chế độ lịch chạy (`manual` vs `auto_digest`) lúc xác nhận đề xuất (`apps/chat-api/src/services/schedules/github-digest-candidate.ts`, `apps/chat-api/src/services/schedules/schedule-service.ts`):**
  - Phát hiện đề xuất bản tin GitHub → Slack đủ điều kiện (`digestCandidate`), kiểm tra ràng buộc `approvalMode: 'auto_digest'` lúc xác nhận, đồng bộ `digest_config` & `digest_config_hash` khi đổi giờ định kỳ, và tự hạ về `manual` khi cập nhật kế hoạch sang thao tác ghi.
- **Task 8 — Thực thi tự động lượt chạy `auto_digest` (`apps/chat-api/src/services/schedules/github-digest-runner.ts`, `apps/chat-api/src/services/schedules/schedule-runner.ts`):**
  - Tìm nạp Issues & PRs từ GitHub API cá nhân, tổng hợp bản tin tiếng Việt (hoặc định dạng deterministically khi model lỗi), kiểm tra lại trạng thái lịch & `digest_config_hash` ngay trước khi gọi `slack.post_message`, ghi nhận `digest_sent`, `digest_skipped` hoặc `digest_failed` (tự tạm dừng sau 3 lần lỗi liên tiếp).
- **Task 9 — Giao diện Web Cài đặt, Callback, Thẻ từ chối và Chọn chế độ lịch (`apps/chat-web/src/pages/Settings/GitHubConnection.tsx`, `apps/chat-web/src/views/GitHubCallbackView.tsx`, `apps/chat-web/src/pages/Responses/ResponseMoment.tsx`, `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx`, `apps/chat-web/src/pages/Cockpit/ScheduleRunRecovery.tsx`):**
  - Thêm thẻ kết nối GitHub cá nhân và chọn tối đa 10 repo cho Admin, trang callback `/settings/github/callback`, nút `#github-connect` trên thẻ từ chối, bộ chọn 2 chế độ trên thẻ đề xuất lịch chạy và hiển thị nhãn `Đã tự gửi bản tin`/`Không có cập nhật mới`/`Tự gửi bản tin thất bại`.
- **Task 10 — Sandbox, Static Guard & Kiểm thử E2E trình duyệt (`apps/chat-api/src/sandbox/fake-results/github.ts`, `apps/chat-web/tests/browser/github-oauth-and-digest.spec.ts`, `evaluations/generic-plumbing/static-guard.test.ts`):**
  - Hoàn thiện sandbox fake results cho 5 tool `github.*`, kịch bản đề xuất lịch bản tin GitHub trong sandbox `schedule`, và kiểm thử E2E Chromium thật nối suốt từ Admin chọn repo → Member kết nối từ thẻ từ chối → chọn chế độ `Tự tổng hợp & gửi Slack` → chạy ngay → nhận `Đã tự gửi bản tin`.

## Kiểm thử
- `npm run typecheck:v3`: exit code 0.
- `npm run check:local:v3`: exit code 0
  - `@wap/tool-schemas`: 17 files, 341 passed
  - `@wap/tool-adapters`: 19 files, 458 passed + 32 Node probe tests passed
  - `@wap/planner`: 27 files, 381 passed
  - `@wap/executor`: 5 files, 42 passed
  - `@wap/chat-api`: 118 files, 843 passed
  - `@wap/chat-web`: 82 files, 905 passed
  - `evaluations`: 25 files, 406 passed
  - `build:v3` + `test-v3-web-build-security` + `test:launcher:v3` (1 passed) + Node scripts (66 passed)
- `npm run test:browser:v3 -- tests/browser/github-oauth-and-digest.spec.ts`: 1 passed (Chromium + PostgreSQL 16 thật).
