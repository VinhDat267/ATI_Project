# SPRINT1-PILOT · Sửa 5 lỗi Playwright trên luồng Landing → Cockpit → Settings → History

**Trạng thái:** Đã thi công, kiểm định độc lập (Reality Auditor + Playwright Live Browser Round 2 `5/5 PASS`), sẵn sàng merge vào `main`.
**Nhiệm vụ:** Khắc phục triệt để 5 lỗi phát hiện qua kiểm thử trình duyệt thực tế (`demanding-customer-v2-playwright`) trên nhánh tích hợp `fix/sprint1-integration`:
- **PBI-01 (`apps/chat-api`):** `GET /api/services` bị crash `500 Internal Server Error` khi một dòng credential dùng chung trong `service_credentials` không giải mã được bằng `ENCRYPTION_KEY` hiện tại, hoặc khi OAuth cá nhân (`trello`, `github`, `telegram`) đã kết nối nhưng chưa chọn phạm vi tài nguyên (`scope_required`).
- **PBI-02 (`packages/planner`, `packages/tool-schemas`, `apps/chat-api`, `apps/chat-web`):** Regex gather trong `AIPlanner` bắt nhầm tên dịch vụ (`Trello`, `Google Sheets`, `Slack`, `GitHub`, `Jira`, `Notion`, `Calendar`, `Gmail`, `Telegram`) hoặc từ chỉ bảng tính (`bảng tính ...`) thành tên bảng Trello (`trello.search_boards`), đồng thời regex Trello bỏ sót tên bảng có gạch nối bắt đầu bằng `tinh-` (ví dụ `tinh-nang`). Khi dịch vụ OAuth cá nhân ở trạng thái `scope_required`, `ResponseMoment` hiển thị thông báo hướng dẫn người dùng chọn phạm vi tài nguyên.
- **PBI-03 (`apps/chat-api`, `apps/chat-web`):** Mở lại cuộc trò chuyện đã lưu (Reopen Conversation) từ Sidebar hiển thị màn hình trắng hoặc replay lại thẻ `PlanMoment` đã từ chối/hết hạn do SSE buffer không xóa sự kiện `plan` khi từ chối và `useConversationHistory` không xử lý trạng thái plan đã kết thúc (`rejected`, `expired`, `superseded`).
- **PBI-04 (`apps/chat-web`):** Chuyển đổi không gian làm việc (Workspace Switcher) giữa Không gian cá nhân và Không gian tổ chức làm điều hướng cưỡng bức về `/`, xóa mất trang hiện tại (`/settings`, `/history`, `/users`), hoặc giữ danh sách thành viên/lịch trình cũ khi không gian mới không có quyền/dữ liệu.
- **PBI-05 (`apps/chat-web`):** Trang `/history` không hiển thị mục **Lịch định kỳ** (`#history-schedules`) và trạng thái trống hướng dẫn người dùng khi danh sách lịch trình rỗng (`schedules.length === 0`).

**Vai trò phụ trách:** Cross-Functional Agile Scrum Squad (`scrum-backend-api-specialist`, `scrum-planner-schema-specialist`, `scrum-frontend-ux-specialist`, `scrum-qa-reality-auditor`, `demanding-customer-v2-playwright`, `scrum-git-devops-master`).
**Nhánh thi công:** `fix/sprint1-integration` (tích hợp từ `fix/sprint1-api-services`, `fix/sprint1-planner-gather`, `fix/sprint1-web-ux`).

---

## 1. Danh mục File phụ trách

| File | Hành động | Mục đích |
|---|---|---|
| `apps/chat-api/src/app.ts` | Cập nhật | Truyền `trelloTeamRepo` và `githubTeamRepo` vào `createServicesRoutes` để kiểm tra phạm vi tài nguyên OAuth |
| `apps/chat-api/src/routes/services-routes.ts` | Cập nhật | Bọc `decryptCredentials` trong `try/catch` cho mỗi dịch vụ dùng chung; tính toán `personalStatus = 'scope_required'` cho `trello`, `github`, `telegram` khi chưa chọn board/repo/chat; bọc `teamRepo.get()` trong `try/catch` |
| `apps/chat-api/src/routes/execution-routes.ts` | Cập nhật | Khi `POST /api/plans/:id/reject` thành công, gọi `executionService.clearPlanEvents?.(plan.conv_id, planId)` để xóa sự kiện `plan` khỏi bộ đệm SSE và tương thích an toàn với các partial test spy |
| `apps/chat-api/tests/routes/jira-workspace-conversations.test.ts` | Cập nhật | Bổ sung `clearPlanEvents: vi.fn()` vào `executionServiceSpy` để khớp hoàn toàn với contract `ExecutionService` |
| `apps/chat-api/src/services/execution-service.ts` | Cập nhật | Thêm phương thức `clearPlanEvents(convId, planId)` ủy quyền xuống `sseManager` |
| `apps/chat-api/src/sse/sse-manager.ts` | Cập nhật | Thêm `clearPlanEvents(convId, planId)` lọc bỏ các sự kiện `plan` khớp `planId` (kể cả payload object lẫn chuỗi JSON) trong bộ đệm SSE |
| `packages/planner/src/planner.ts` | Cập nhật | Bổ sung `EXCLUDED_GATHER_SERVICE_NAMES` và kiểm tra ngữ cảnh `bảng tính` trước khi khớp mẫu gather `trello.search_boards` |
| `packages/tool-schemas/src/registry/trello.ts` | Cập nhật | Cho phép tên bảng có dấu gạch nối sau `tinh-` (`tinh(?!\s|$)`) và loại trừ cụm `bảng tính` khỏi mẫu gather tên bảng Trello |
| `apps/chat-web/src/pages/Cockpit/SavedConversation.tsx` | Tạo mới | Component hiển thị nội dung cuộc trò chuyện đã lưu (tin nhắn người dùng + trạng thái yêu cầu/kết quả) khi mở lại hội thoại không còn plan đang chạy |
| `apps/chat-web/src/pages/Cockpit/CockpitHeader.tsx` | Cập nhật | Hiển thị header cho trạng thái `saved` khi mở lại cuộc trò chuyện |
| `apps/chat-web/src/pages/Cockpit/RequestMoments.tsx` | Cập nhật | Render `SavedConversation` khi `phase === 'saved'` |
| `apps/chat-web/src/components/Cockpit.tsx` | Cập nhật | Hỗ trợ hiển thị vùng hội thoại khi `phase === 'saved'` |
| `apps/chat-web/src/hooks/use-conversation-history.ts` | Cập nhật | Phục hồi đúng trạng thái hội thoại đã lưu (`saved`), đánh dấu các plan đã quyết định (`settledPlanIds`) và báo lỗi rõ ràng khi tải trạng thái thực thi thất bại |
| `apps/chat-web/src/hooks/use-sse.ts` | Cập nhật | Bỏ qua sự kiện SSE `plan` phát lại nếu `planId` đã nằm trong `settledPlanIds` |
| `apps/chat-web/src/store/chat-store.ts` | Cập nhật | Bổ sung phase `'saved'`, danh sách `settledPlanIds` và dữ liệu `savedMessages` trong store |
| `apps/chat-web/src/pages/Responses/ResponseMoment.tsx` | Cập nhật | Nhận diện thông báo từ chối thiếu phạm vi bảng Trello / repo GitHub (`scope_required`) và hiển thị CTA dẫn tới `/settings` |
| `apps/chat-web/src/pages/Settings/TrelloConnection.tsx` | Cập nhật | Hỗ trợ hiển thị trạng thái `scope_required` khi đã liên kết Trello nhưng chưa chọn bảng |
| `apps/chat-web/src/components/Workspace.tsx` | Cập nhật | Giữ nguyên trang hiện tại (`/settings`, `/history`) khi chuyển đổi workspace; làm mới danh sách dịch vụ và lịch trình theo workspace mới |
| `apps/chat-web/src/components/layout/WorkspaceSwitcher.tsx` | Cập nhật | Chỉ điều hướng về `/` khi đang mở một cuộc trò chuyện cụ thể (`/c/:id`) hoặc đang ở `/users` nhưng workspace mới không có quyền quản trị |
| `apps/chat-web/src/components/layout/SidebarHistory.tsx` | Cập nhật | Đồng bộ lại danh sách cuộc trò chuyện khi chuyển đổi workspace |
| `apps/chat-web/src/pages/Users/useUsers.ts` | Cập nhật | Xóa danh sách thành viên cũ và tải lại theo workspace mới khi chuyển đổi không gian làm việc |
| `apps/chat-web/src/pages/History/ScheduleSection.tsx` | Cập nhật | Luôn hiển thị mục `#history-schedules` kèm trạng thái trống (`#history-schedules-empty`) và làm mới khi đổi workspace |
| `apps/chat-api/tests/routes/services-security.test.ts` | Cập nhật | Kiểm thử `GET /api/services` chịu lỗi giải mã credential dùng chung và trả về `scope_required` cho OAuth cá nhân |
| `apps/chat-api/tests/routes/execution-routes.test.ts` | Cập nhật | Kiểm thử `POST /api/plans/:id/reject` xóa sự kiện `plan` khỏi bộ đệm SSE |
| `apps/chat-api/tests/sse/sse-manager.test.ts` | Cập nhật | Kiểm thử `SSEManager.clearPlanEvents` với cả payload object và chuỗi JSON |
| `packages/planner/tests/gather-service-names.test.ts` | Tạo mới | Kiểm thử `AIPlanner` không gọi `trello.search_boards` cho tên dịch vụ hoặc `bảng tính` |
| `packages/tool-schemas/tests/gather-patterns.test.ts` | Tạo mới | Kiểm thử mẫu regex gather của Trello với tên dịch vụ, `bảng tính`, và tên bảng gạch nối `tinh-nang` |
| `apps/chat-web/tests/fe-06b-responses.test.tsx` | Cập nhật | Kiểm thử `ResponseMoment` khi `scope_required` cho Trello/GitHub |
| `apps/chat-web/tests/sprint1-reopen-conversation.test.tsx` | Tạo mới | Kiểm thử mở lại cuộc trò chuyện đã lưu, plan đã từ chối và chặn replay SSE |
| `apps/chat-web/tests/sprint1-workspace-switch.test.tsx` | Tạo mới | Kiểm thử giữ nguyên trang khi đổi workspace và làm mới dữ liệu theo ngữ cảnh |
| `apps/chat-web/tests/sprint1-history-schedules-empty.test.tsx` | Tạo mới | Kiểm thử hiển thị trạng thái trống của mục Lịch định kỳ trên `/history` |

---

## 2. Tiêu chí nghiệm thu (Checklist)

- [x] **PBI-01 (`GET /api/services` Resilience & `scope_required`):** Khi một dòng credential dùng chung trong DB không giải mã được, `GET /api/services` vẫn trả HTTP `200` (coi dịch vụ đó là `configured: false`). Khi Trello/GitHub/Telegram đã kết nối OAuth nhưng chưa chọn phạm vi tài nguyên, trả `personalStatus: 'scope_required'`.
- [x] **PBI-02 (Planner Gather Exclusion & Refusal UX):** Câu lệnh chứa `"Trello và Google Sheets"` không gọi `trello.search_boards` với `query: "Trello"` hay `"Google Sheets"`, vẫn bắt đúng tên bảng thật (kể cả `tinh-nang`), và hiển thị thông báo hướng dẫn chọn bảng rõ ràng khi thiếu scope.
- [x] **PBI-03 (Reopen Conversation & Rejected Plan Replay Prevention):** Mở lại cuộc trò chuyện từ Sidebar hiển thị đầy đủ nội dung đã lưu (`SavedConversation`), và sau khi nhấn **Từ chối** plan rồi reload `/c/:id`, thẻ `PlanMoment` không bị replay lại từ bộ đệm SSE.
- [x] **PBI-04 (Workspace Switch Context Preservation):** Đổi giữa Không gian cá nhân và Không gian tổ chức khi đang ở `/settings` hoặc `/history` giữ nguyên đường dẫn URL hiện tại và tải lại đúng dữ liệu của không gian mới.
- [x] **PBI-05 (History Schedules Empty State):** Trang `/history` luôn hiển thị phần `#history-schedules` kèm thông báo trạng thái trống rõ ràng khi chưa có lịch định kỳ nào.

---

## 3. Lệnh kiểm tra

```powershell
npx vitest run apps/chat-api/tests/routes/execution-routes.test.ts apps/chat-api/tests/routes/services-security.test.ts apps/chat-api/tests/sse/sse-manager.test.ts
npm test -w @wap/tool-schemas
npm test -w @wap/planner
Push-Location apps/chat-web; npx vitest run tests/fe-06b-responses.test.tsx tests/sprint1-history-schedules-empty.test.tsx tests/sprint1-reopen-conversation.test.tsx tests/sprint1-workspace-switch.test.tsx; Pop-Location
npm run test:eval:v3
npm run typecheck:v3
npm run build:v3
node scripts/test-v3-web-build-security.mjs
```

---

## 4. Kết quả

- **Commit triển khai:** `7d19df57`, `1a6cde22`, `ca7a40e4`, `6f75f855`, `eab44d80`, `7f6a1664`, `1a81d23e`, `ba78c22f`, `9d702c2f`, `9463e9c6`, hợp nhất tại `f44045f1` và đồng bộ với `origin/main` (`bea7660c`) tại `537c01d3`.
- **Kiểm thử tự động (Vitest + Evaluation + Build Security):**
  - `apps/chat-api` (`execution-routes.test.ts`, `services-security.test.ts`, `sse-manager.test.ts`): **3 test files, 18/18 tests PASS**.
  - `@wap/tool-schemas`: **18 test files, 347/347 tests PASS**.
  - `@wap/planner`: **28 test files, 405/405 tests PASS**.
  - `apps/chat-web` (`fe-06b-responses.test.tsx`, `sprint1-history-schedules-empty.test.tsx`, `sprint1-reopen-conversation.test.tsx`, `sprint1-workspace-switch.test.tsx`): **4 test files, 50/50 tests PASS**.
  - `npm run test:eval:v3`: **25 test files, 406/406 tests PASS** (`static-guard.test.ts` 2/2 PASS).
  - `npm run typecheck:v3`, `npm run build:v3`, `node scripts/test-v3-web-build-security.mjs`: **exit code 0**.
- **Nghiệm thu độc lập:**
  - `scrum-qa-reality-auditor`: **APPROVED (PASS)** sau khi kiểm tra code, test thực tế và các cổng bảo mật.
  - `demanding-customer-v2-playwright` (Live Browser Verification Round 2 trên `http://127.0.0.1:5175` + PostgreSQL 16 thật): **5/5 PBIs PASS**, `0 console.error`, `0 pageerror`, `0 HTTP 500`.
