# 2026-11-02 · antigravity · Sprint 2 Pilot — Gia cố giải mã credential, kênh Slack Sandbox, giữ ngữ cảnh tạo/tham gia tổ chức & ổn định bộ test frontend

- **Đã làm:**
  - **(1) PBI-06 — Giữ nguyên ngữ cảnh trang khi tạo hoặc tham gia tổ chức mới (`apps/chat-web`):** Cập nhật `handleCreateOrg` và `handleJoinOrg` trong `apps/chat-web/src/components/layout/WorkspaceSwitcher.tsx` để gọi `navigateAfterWorkspaceChange(true)` / `navigateAfterWorkspaceChange(false)` thay vì `navigate('/')` cứng. Người dùng đang ở `/settings` hoặc `/history` khi tạo tổ chức mới hoặc nhập mã mời vẫn ở lại đúng trang hiện tại và danh sách dịch vụ/lịch trình tự động tải lại theo không gian mới.
  - **(2) PBI-07 — Bọc bảo vệ `decryptCredentials` trên toàn bộ đường dẫn đọc DB còn lại (`apps/chat-api`):** Bổ sung `try/catch` khi giải mã credential trong `loadRegisteredServicesFromDb` (`apps/chat-api/src/services/registered-services.ts`), `AdapterFactory.getAdapterForService` (`apps/chat-api/src/services/adapter-factory.ts`), và `loadTelegramPersonalState` (`apps/chat-api/src/routes/connections/telegram.ts`). Khi gặp dòng credential có khóa mã hóa cũ hoặc dữ liệu hỏng, hệ thống ghi log cảnh báo và coi dịch vụ chưa cấu hình / chưa kết nối thay vì làm sập request với lỗi HTTP 500.
  - **(3) PBI-08 — Bổ sung danh sách kênh Slack mặc định cho Sandbox (`apps/chat-api`):** Cập nhật `apps/chat-api/src/sandbox/fake-results/slack.ts` để `slack.search_channels` trong chế độ Sandbox mặc định trả về 5 kênh mẫu (`#general`, `#random`, `#deploys`, `#bugs`, `#product`) và hỗ trợ lọc theo `query` (kể cả khi `query` có tiền tố `#` như `"#general"`), giúp luồng lập kế hoạch liên dịch vụ Trello + Slack chạy thông suốt.
  - **(4) PBI-09 — Ổn định thời gian chờ cho toàn bộ bộ test `apps/chat-web`:** Cập nhật `testTimeout: 15000` và `hookTimeout: 15000` trong `apps/chat-web/vite.config.ts` cùng timeout 15000ms cho test tích hợp đa trạng thái trong `apps/chat-web/tests/fe-05b-parity-b.test.tsx`, giúp toàn bộ 95 file test (`986 tests`) của `apps/chat-web` chạy song song đạt 100% PASS.

- **PR / commit:** Nhánh `fix/sprint2-integration` (tích hợp từ `16932755` và `be180130` trên nền `origin/main` `6219ec2c` tại `d26e6322`). Không sửa `CURRENT-STATE.md` hay `ROADMAP.md` trên nhánh PR.

- **Kiểm tra đã chạy (lệnh và kết quả):**
  - `npx vitest run apps/chat-api/tests/routes/jira-workspace-conversations.test.ts apps/chat-api/tests/config/sandbox-plumbing.test.ts apps/chat-api/tests/services/adapter-factory.test.ts apps/chat-api/tests/routes/services-security.test.ts` — 4 test files passed, 78 tests passed.
  - `Push-Location apps/chat-web; npx vitest run tests/fe-05b-parity-b.test.tsx tests/sprint1-workspace-switch.test.tsx; Pop-Location` — 2 test files passed, 31 tests passed (toàn bộ `apps/chat-web`: 95 test files passed, 986 tests passed).
  - `npm run test:eval:v3` — 25 test files passed, 406 tests passed (bao gồm `evaluations/generic-plumbing/static-guard.test.ts`).
  - `npm run typecheck:v3` — exit code 0.
  - `npm run build:v3 && node scripts/test-v3-web-build-security.mjs` — exit code 0 (`PASS: production build excludes credential sentinels and 7 forbidden UI claims`).
  - Kiểm thử trình duyệt thực tế (`demanding-customer-v2-playwright` trên `http://127.0.0.1:5175` + PostgreSQL 16): **PASS (`PBI-06`, `PBI-07`, `PBI-08`)**, `0 console.error`, `0 pageerror`, `0 HTTP 500`.

- **Chưa làm / vấn đề phát hiện:** Không còn lỗi tồn đọng trong phạm vi 4 PBIs của Sprint 2.

- **Việc tiếp theo đề xuất:** Mở PR từ `fix/sprint2-integration` vào `main`, chờ GitHub Actions CI xanh 100% rồi merge vào `main` và cập nhật `CURRENT-STATE.md` / `ROADMAP.md` sau khi merge.
