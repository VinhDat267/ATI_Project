# SPRINT3-PILOT · Hoàn thiện trải nghiệm ngôn ngữ nghiệp vụ (Business-First UX), đồng bộ OAuth/Digest liên dịch vụ và sửa 7 hạng mục phát hiện qua kiểm thử E2E toàn diện

**Trạng thái:** Đã thi công, kiểm định độc lập và nghiệm thu trình duyệt thực tế (`9.5 / 9.4 / 9.4 / 9.3 / 9.4` — `SHIP`), sẵn sàng merge vào `main`.
**Nhiệm vụ:** Khắc phục triệt để 7 hạng mục (`PBI-10` → `PBI-16`) phát hiện qua đợt rà soát E2E toàn diện trên nhánh `fix/sprint3-integration`:
- **PBI-10 (`apps/chat-web`):** Thay toàn bộ thuật ngữ kỹ thuật (`OAuth 1-Click`, `OAuth 2.0 · 1-Click`, `Workspace & Scope`) trên `/settings`, `/guide` và trang giới thiệu `/` bằng ngôn ngữ thân thiện với người dùng nghiệp vụ (`Đăng nhập trực tiếp · 1 chạm`, `Liên kết tài khoản nhanh & Chọn nơi làm việc`), đồng thời ẩn hai thẻ dịch vụ dùng chung `calendar` / `sheets` khi đã hiển thị thẻ cá nhân `mycalendar` / `mysheets` để tránh trùng lặp.
- **PBI-11 (`apps/chat-api`):** Bộ lập kế hoạch Sandbox (`createSandboxProvider`, `createBackupSandboxProvider`) khi không chỉ định `SANDBOX_SCENARIO` cố định luôn trả về kế hoạch 2 bước Trello + Slack ngay cả với yêu cầu chỉ dùng Slack, Jira, Notion, Telegram, Google Sheets, Google Calendar hoặc yêu cầu đặt lịch định kỳ (`schedule`).
- **PBI-12 (`apps/chat-api`):** Các route kết nối Telegram (`/api/connections/telegram`, `/callback`, `/scope`) chỉ trả mảng `chats` mà thiếu trường `selectedChats` và thiếu endpoint `GET /api/connections/telegram/chats` để đồng bộ danh sách nhóm chat đã chọn.
- **PBI-13 (`apps/chat-api`, `apps/chat-web`):** Bộ đánh giá digest (`evaluateCalendarDigestCandidate`, `analyzeSheetsDigestCandidate`) chưa đọc cấu trúc `selectedChats` của Telegram cá nhân; `ScheduleService.confirmProposal` ưu tiên nhầm `telegram_digest` trước `sheets_digest` khi yêu cầu kết hợp cả hai dịch vụ; `SheetsDigestRunner` và `CalendarDigestRunner` cần khôi phục đầy đủ runtime thực thi digest bảng tính/lịch.
- **PBI-14 (`apps/chat-api`, `apps/chat-web`):** `trelloOAuth()` chưa fallback sang `TRELLO_API_KEY` / `TRELLO_API_SECRET` và `GET /api/connections/trello` chưa trả trạng thái `connected` từ credential cá nhân khi thiếu cấu hình OAuth máy chủ; `GitHubConnection` và các route `/api/connections/github/candidate-repos`, `PUT /api/connections/github/scope` chặn người dùng có `user.role === 'member'` chọn kho lưu trữ ngay cả khi đang ở Không gian cá nhân hoặc là Quản trị viên của Không gian tổ chức.
- **PBI-15 (`apps/chat-api`):** Bọc bảo vệ `decryptCredentials` tại các đường dẫn còn lại (`JiraOAuthRepo.getConnectionStatus`, `JiraTokenManager.getAccessToken`, và `PUT /api/services/:service/scope`) để trả trạng thái `reconnect_required` / `TOKEN_REFRESH_FAILED` / HTTP `409` thay vì ném lỗi `500 Internal Server Error` khi ciphertext không giải mã được.
- **PBI-16 (`apps/chat-api`, `apps/chat-web`):** `ConversationRepo` chưa suy luận trạng thái `completed` cho hội thoại có kế hoạch đã chạy xong (`p.status = 'completed'`); dải chân trang Cockpit chưa hiển thị dịch vụ có `personalStatus === 'connected'`; trang `/history` chưa hiển thị thông báo trống và ẩn nút `"Tải thêm"` khi bộ lọc tab trạng thái có 0 hội thoại.

**Vai trò phụ trách:** Cross-Functional Agile Scrum Squad (`scrum-backend-api-specialist`, `scrum-frontend-ux-specialist`, `scrum-qa-reality-auditor`, `demanding-customer-v2-playwright`, `scrum-git-devops-master`).
**Nhánh thi công:** `fix/sprint3-integration` (tích hợp từ `fix/sprint3-api-oauth-and-digest` và `fix/sprint3-web-business-ux` trên nền `origin/main` `2b78f4b6`).

---

## 1. Danh mục File phụ trách

| File | Hành động | Mục đích |
|---|---|---|
| `apps/chat-api/src/sandbox/scenarios.ts` | Cập nhật | Bổ sung phân tích ngữ cảnh thông minh cho `createSandboxProvider(undefined)` và `createBackupSandboxProvider()` theo dịch vụ được yêu cầu (Slack-only, Trello+Slack, Jira, Notion, Telegram, Sheets, Calendar, và đề xuất `schedule`) |
| `apps/chat-api/src/routes/connections/telegram.ts` | Cập nhật | Trả kèm `selectedChats` trong `GET /`, `POST /callback`, `PUT /scope` và bổ sung route `GET /api/connections/telegram/chats` |
| `apps/chat-api/src/services/schedules/calendar-digest-candidate.ts` | Cập nhật | Hỗ trợ đọc `selectedChats` từ kết nối Telegram cá nhân khi xác định đích nhận digest lịch |
| `apps/chat-api/src/services/schedules/calendar-digest-runner.ts` | Cập nhật | Đồng bộ gửi thông báo digest lịch qua Telegram cá nhân hoặc dùng chung |
| `apps/chat-api/src/services/schedules/sheets-digest-candidate.ts` | Cập nhật | Hỗ trợ đọc `selectedChats` từ kết nối Telegram cá nhân và bảng tính `mysheets` khi phân tích ứng viên `sheets_digest` |
| `apps/chat-api/src/services/schedules/sheets-digest-runner.ts` | Cập nhật | Khởi tạo và chạy `SheetsDigestRunner` đọc dữ liệu bảng tính và gửi tóm tắt tới Slack/Telegram |
| `apps/chat-api/src/services/schedules/schedule-service.ts` | Cập nhật | Ưu tiên phân loại `sheets_digest` và `calendar_digest` trước `telegram_digest` trong `confirmProposal` khi yêu cầu có nguồn dữ liệu bảng tính/lịch |
| `apps/chat-api/src/config/schedules-runtime.ts` | Cập nhật | Kết nối `SheetsDigestRunner` vào bộ chạy lịch định kỳ (`schedules-runtime`) |
| `apps/chat-api/src/config/env.ts` | Cập nhật | Cho phép `trelloOAuth()` fallback sang `TRELLO_API_KEY` và `TRELLO_API_SECRET` |
| `apps/chat-api/src/routes/connections/trello.ts` | Cập nhật | Cho phép đọc trạng thái kết nối Trello cá nhân đã lưu ngay cả khi máy chủ chưa khai báo biến môi trường OAuth Trello |
| `apps/chat-api/src/routes/connections/github.ts` | Cập nhật | Cho phép người dùng ở Không gian cá nhân hoặc Quản trị viên Không gian tổ chức gọi `GET /candidate-repos` và `PUT /scope` |
| `apps/chat-api/src/app.ts` | Cập nhật | Truyền `workspaceRepo` vào `createGitHubConnectionRoutes` |
| `apps/chat-api/src/server.ts` | Cập nhật | Truyền `workspaceRepo` và cấu hình runtime cho các route kết nối và lịch trình |
| `apps/chat-api/src/db/repositories/jira-oauth-repo.ts` | Cập nhật | Bọc `decryptCredentials` trong `try/catch` tại `getConnectionStatus`, trả `reconnect_required` khi không giải mã được token |
| `apps/chat-api/src/services/jira/jira-token-manager.ts` | Cập nhật | Bọc `decryptCredentials` trong `try/catch`, cập nhật trạng thái grant và ném `JiraTokenError('TOKEN_REFRESH_FAILED')` thay vì lỗi 500 |
| `apps/chat-api/src/routes/services-routes.ts` | Cập nhật | Bọc `decryptCredentials` trong `PUT /api/services/:service/scope` (trả HTTP `409` khi hỏng khóa mã hóa) và đồng bộ trạng thái dịch vụ |
| `apps/chat-api/src/db/repositories/conversation-repo.ts` | Cập nhật | Suy luận trạng thái hội thoại (`completed`, `failed`, `awaiting_approval`, `executing`) từ trạng thái kế hoạch mới nhất của cuộc trò chuyện |
| `apps/chat-api/src/services/chat-service.ts` | Cập nhật | Đồng bộ trạng thái hội thoại và thông tin dịch vụ |
| `apps/chat-api/src/services/execution-service.ts` | Cập nhật | Cập nhật thời gian/trạng thái hội thoại sau khi thực thi kế hoạch hoàn tất |
| `apps/chat-web/src/pages/Settings/SettingsPage.tsx` | Cập nhật | Việt hóa tiêu đề/phụ đề theo ngôn ngữ nghiệp vụ và ẩn thẻ `calendar`/`sheets` cũ khi đã có `mycalendar`/`mysheets` |
| `apps/chat-web/src/pages/Settings/useSettings.ts` | Cập nhật | Bổ sung đồng bộ trạng thái dịch vụ cá nhân trên trang `/settings` |
| `apps/chat-web/src/pages/Settings/GitHubConnection.tsx` | Cập nhật | Cho phép chọn kho GitHub khi ở Không gian cá nhân hoặc có vai trò quản trị trong Không gian tổ chức hiện tại |
| `apps/chat-web/src/pages/Guide/GuidePage.tsx` | Cập nhật | Thay nhãn kỹ thuật `OAuth 1-Click` bằng ngôn ngữ nghiệp vụ rõ ràng |
| `apps/chat-web/src/pages/Guide/data.tsx` | Cập nhật | Chuẩn hóa nhãn `Đăng nhập trực tiếp · 1 chạm` và hướng dẫn kết nối theo luồng `/settings` |
| `apps/chat-web/src/pages/Landing/LandingPage.tsx` | Cập nhật | Chuẩn hóa nhãn giới thiệu dịch vụ (`Đăng nhập trực tiếp · Chọn Bảng`, `Chọn Kho`, `Chọn Bảng tính`, `Chọn Lịch`, `Cá nhân`) |
| `apps/chat-web/src/pages/Cockpit/RequestMoments.tsx` | Cập nhật | Hiển thị đúng các dịch vụ đã kết nối (`connected`, `personalStatus === 'connected'`, hoặc `configured` không lỗi) ở chân trang Cockpit |
| `apps/chat-web/src/pages/History/HistoryPage.tsx` | Cập nhật | Hiển thị thông báo `"Chưa có hội thoại nào ở trạng thái này."` và ẩn nút `"Tải thêm"` khi bộ lọc tab không có kết quả |
| `apps/chat-api/tests/sprint3-pbi11-to-16a.test.ts` | Tạo mới | Bộ 15 test kiểm thử toàn diện `PBI-11`, `PBI-12`, `PBI-13`, `PBI-14A`, `PBI-15`, `PBI-16A` |
| `apps/chat-web/tests/sprint3-business-ux.test.tsx` | Tạo mới | Bộ 5 test kiểm thử giao diện `PBI-10`, `PBI-14B`, `PBI-16B` |
| `apps/chat-web/tests/guide-page.test.tsx` | Cập nhật | Đồng bộ kỳ vọng nhãn ngôn ngữ nghiệp vụ trên trang `/guide` |
| `apps/chat-web/tests/landing-orbital-redesign.test.tsx` | Cập nhật | Đồng bộ kỳ vọng nhãn ngôn ngữ nghiệp vụ trên trang `/` |
| `apps/chat-web/tests/workflow-flow-canvas.test.tsx` | Cập nhật | Đồng bộ kỳ vọng hiển thị dải dịch vụ trên Cockpit |

---

## 2. Tiêu chí nghiệm thu (Checklist)

- [x] **PBI-10 (Business-First UX & Deduplication):** Không còn nhãn kỹ thuật `OAuth 1-Click` / `OAuth 2.0 · 1-Click` trên `/settings`, `/guide`, `/`; không còn hiển thị trùng lặp hai thẻ Google Calendar hoặc hai thẻ Google Sheets trên `/settings`.
- [x] **PBI-11 (Adaptive Sandbox Planner):** Khi gửi yêu cầu chỉ dùng Slack, Jira, Notion, Telegram, Sheets, Calendar hoặc yêu cầu đặt lịch định kỳ trong chế độ Sandbox mặc định, hệ thống sinh đúng kế hoạch/đề xuất lịch tương ứng với dịch vụ trong câu lệnh.
- [x] **PBI-12 (Telegram `selectedChats` & `/chats` Alias):** `GET /api/connections/telegram`, `POST /callback`, `PUT /scope` trả đầy đủ `selectedChats` cùng `chats`, và `GET /api/connections/telegram/chats` trả HTTP `200`.
- [x] **PBI-13 (Digest Priority & Telegram `selectedChats` Support):** `evaluateCalendarDigestCandidate` và `analyzeSheetsDigestCandidate` nhận diện đúng `selectedChats` của Telegram; `ScheduleService.confirmProposal` chọn đúng `sheets_digest` khi yêu cầu kết hợp Sheets + Telegram; `SheetsDigestRunner` được kích hoạt đầy đủ.
- [x] **PBI-14 (Trello OAuth Fallback & GitHub Workspace-Aware Scope):** `trelloOAuth()` hỗ trợ fallback `TRELLO_API_KEY`/`TRELLO_API_SECRET`; người dùng ở Không gian cá nhân hoặc Quản trị viên Không gian tổ chức chọn và lưu được kho GitHub (`GET /candidate-repos`, `PUT /scope`).
- [x] **PBI-15 (Resilient `decryptCredentials` in Jira & Scope Update):** `JiraOAuthRepo.getConnectionStatus`, `JiraTokenManager.getAccessToken` và `PUT /api/services/:service/scope` xử lý an toàn khi ciphertext hỏng mà không trả lỗi 500.
- [x] **PBI-16 (Conversation Completed Status, Cockpit Footer & History Filter Empty State):** Hội thoại đã chạy xong kế hoạch hiển thị trạng thái `Hoàn thành` (`completed`), chân trang Cockpit hiển thị đúng dịch vụ cá nhân đã kết nối, và bộ lọc trống trên `/history` hiển thị thông báo rõ ràng kèm ẩn nút `"Tải thêm"`.

---

## 3. Lệnh kiểm tra

```powershell
npx vitest run evaluations/generic-plumbing/static-guard.test.ts
npm run typecheck:v3
npx --prefix apps/chat-api vitest run tests/sprint3-pbi11-to-16a.test.ts
Push-Location apps/chat-web; npx vitest run tests/sprint3-business-ux.test.tsx tests/guide-page.test.tsx tests/landing-orbital-redesign.test.tsx tests/workflow-flow-canvas.test.tsx; Pop-Location
npm --prefix apps/chat-web run build
node scripts/test-v3-web-build-security.mjs
```

---

## 4. Kết quả

- **Commit triển khai:** `5a0ad270` (`fix/sprint3-api-oauth-and-digest`), `d96c62d5` (`fix/sprint3-web-business-ux`), hợp nhất tại `bb59e21d` và đồng bộ với `origin/main` (`2b78f4b6`, PR #254) tại `8716ef1c`.
- **Kiểm thử tự động (Vitest + Static Guard + Build Security):**
  - `apps/chat-api/tests/sprint3-pbi11-to-16a.test.ts`: **1 test file, 15/15 tests PASS**.
  - `apps/chat-web/tests/sprint3-business-ux.test.tsx` (+ `guide-page.test.tsx`, `landing-orbital-redesign.test.tsx`, `workflow-flow-canvas.test.tsx`): **4 test files, 29/29 tests PASS**.
  - `evaluations/generic-plumbing/static-guard.test.ts`: **1 test file, 2/2 tests PASS**.
  - `npm run typecheck:v3`, `npm --prefix apps/chat-web run build`, `node scripts/test-v3-web-build-security.mjs`: **exit code 0**.
- **Nghiệm thu độc lập & Trình duyệt thực tế:**
  - Reviewer độc lập kiểm định mã nguồn và bằng chứng test: **APPROVED (PASS)** cho cả backend và frontend.
  - Kiểm thử trình duyệt thực tế (`http://127.0.0.1:5175` + PostgreSQL 16 thật): **7/7 PBIs PASS**, `0 console.error`, `0 pageerror`, `0 HTTP 500`, điểm đánh giá 5 trục đạt **`9.5 / 9.4 / 9.4 / 9.3 / 9.4` — `SHIP`**.
