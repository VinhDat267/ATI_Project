# Handoff Log: Google Sheets OAuth & AI Automation v2 (2026-11-02)

## 1. Tóm tắt công việc đã thực hiện

Triển khai hoàn chỉnh **Google Sheets OAuth & AI Automation v2** trên nhánh `feat/sheets-oauth-v2` theo quy trình 4 giai đoạn (Brainstorming từ góc nhìn User/Business thực tế -> Đặc tả v2 + Audit Loop -> Kế hoạch triển khai chi tiết + Audit Loop -> TDD Implementation & Quality Gate):

1. **Đọc thông minh theo tên Tab, cột, N dòng cuối & Header-Aware (`@wap/tool-schemas`, `@wap/tool-adapters`):**
   - Nâng cấp `a1RangeSchema` và `normalizeAndValidateSmartRange()` hỗ trợ viết tắt tên tab (`Tasks` -> `Tasks!A1:Z500`), dải cột không giới hạn dòng (`Tasks!A:D` -> `Tasks!A1:D500`), lấy N dòng cuối (`Tasks!tail:5`, `tail:20`), vẫn giữ nguyên chốt chặn chống ReDoS (`max(100)`) và chặn nhảy trang (`..`).
   - Nâng cấp `SheetsReadRangeInputSchema` và `executeSheetsReadRange()` (dùng chung cho cả `sheets.read_range` và `mysheets.read_range`): hỗ trợ `tail?: number` (1..500) và `headerAware?: boolean` (trả về `headers?: string[]` và `records?: Array<Record<string, string>>` khớp tên cột dòng đầu tiên, giữ nguyên dòng tiêu đề khi cắt `tail`).
2. **Chống ghi trùng lặp Idempotent Deduplication trên `append_rows` (`@wap/tool-schemas`, `@wap/tool-adapters`):**
   - Nâng cấp `SheetsAppendRowsInputSchema` và `executeSheetsAppendRows()` hỗ trợ `deduplicate?: boolean`, `deduplicateColumn?: string`, `deduplicateColumns?: number[]`, và **tự động phát hiện khóa đồng bộ ngoài** (`GH#101`, `JIRA-101`, URL GitHub/Trello/Jira) ở cột đầu tiên khi Planner quên truyền `deduplicate: true`.
   - Khi `deduplicate` kích hoạt, đọc trước tối đa 500 dòng của tab mục tiêu (fail-open an toàn nếu đọc lỗi), đối chiếu khóa chuẩn hóa (`trim()`), lọc bỏ các dòng đã tồn tại và trả về `{ updatedRange, updatedRows, skippedDuplicateRows }`. Nếu toàn bộ dòng đều trùng lặp, bỏ qua lệnh POST ghi mà không báo lỗi.
   - Bảo toàn 100% lớp bảo vệ **Formula Injection** (`=`, `+`, `-`, `@`, `\t`, `\r`) trên tất cả các dòng được phép ghi.
3. **Chọn bảng tính qua Dán Link/ID Google Sheets & Tự động khám phá danh sách Tab (`apps/chat-api`, `apps/chat-web`):**
   - Mở rộng `PUT /api/connections/mysheets/scope` với `extractSpreadsheetIdFromUrlOrId()` (chấp nhận cả URL đầy đủ `https://docs.google.com/spreadsheets/d/<ID>/edit#gid=0` lẫn raw ID) và tự động khám phá danh sách tên tab (`sheets?: string[]`, tối đa 20 tab) qua Google Sheets Metadata API (`includeGridData=false`) khi `includeSheets: true` hoặc khi người dùng dán URL.
   - Cập nhật `MySheetsCallbackView.tsx` và `PersonalMySheets.tsx` bổ sung ô nhập dán trực tiếp Link/ID bảng tính bên cạnh Google Picker và hiển thị chips danh sách các tab (`sheets`) ngay dưới tên từng bảng tính.
4. **Lịch chạy tự động Báo cáo Google Sheets (`approvalMode: 'auto_digest'`, `kind = 'sheets_digest'`):**
   - Tạo migration `db/v3/0016_sheets_automation_and_digest.sql` (idempotent) mở rộng ràng buộc `schedules_mode_check` trên bảng `schedules` và `schedule_runs` để hỗ trợ `kind = 'sheets_digest'` có `definition_hash` SHA-256 64 ký tự hex và `approval_run_id IS NULL`.
   - Tạo `SheetsDigestCandidate` (`extractSheetsDigestCandidate`, `computeSheetsDigestHash` chuẩn hóa khóa `recurrence` tương thích `JSONB` PostgreSQL) và `SheetsDigestRunner` đọc dữ liệu bảng tính (`sheets.read_range` / `mysheets.read_range` hỗ trợ `headerAware`, `tail`) và gửi báo cáo trực tiếp vào đích `slack.post_message` / `myslack.post_message` / `telegram.send_message` đã khóa, kèm cơ chế tự động tạm dừng lịch (`paused_ReconnectRequired` / `paused_ScopeRequired`) khi OAuth token hết hạn hoặc bảng tính bị gỡ quyền.
   - Cập nhật `ScheduleService.confirmProposal`, `ScheduleRunner`, `schedule-routes.ts`, `chat-service.ts` và giao diện `ScheduleMoment.tsx`, `ScheduleRunRecovery.tsx`, `ScheduleSection.tsx`, `schedule-text.ts` để người dùng có thể chọn giữa **Hỏi lại tôi trước mỗi lần gửi** (`manual`) và **Gửi báo cáo tự động vào kênh đã chọn** (`auto_digest`).

## 2. Danh sách File tạo mới & chỉnh sửa

### Đặc tả & Kế hoạch
- `docs/superpowers/specs/2026-11-02-sheets-oauth-and-automation-design.md` (Tạo mới)
- `docs/superpowers/plans/2026-11-02-sheets-oauth-and-automation.md` (Tạo mới)

### Database Migration
- `db/v3/0016_sheets_automation_and_digest.sql` (Tạo mới)

### Packages (`@wap/tool-schemas`, `@wap/tool-adapters`)
- `packages/tool-schemas/src/types.ts`
- `packages/tool-schemas/src/mysheets.ts`
- `packages/tool-adapters/src/sheets/sheets-shared.ts`
- `packages/tool-adapters/src/sheets/sheets-adapter.ts`
- `packages/tool-adapters/src/sheets/personal-sheets-adapter.ts`
- `packages/tool-adapters/src/index.ts`
- `packages/tool-adapters/tests/sheets-adapter.test.ts`
- `packages/tool-adapters/tests/sheets/personal-sheets-adapter.test.ts`

### Backend (`apps/chat-api`)
- `apps/chat-api/src/routes/connections/mysheets.ts`
- `apps/chat-api/src/services/schedules/sheets-digest-candidate.ts` (Tạo mới)
- `apps/chat-api/src/services/schedules/sheets-digest-runner.ts` (Tạo mới)
- `apps/chat-api/src/services/schedules/run-state.ts`
- `apps/chat-api/src/db/repositories/schedule-repo.ts`
- `apps/chat-api/src/services/schedules/schedule-service.ts`
- `apps/chat-api/src/services/schedules/schedule-runner.ts`
- `apps/chat-api/src/routes/schedule-routes.ts`
- `apps/chat-api/src/services/chat-service.ts`
- `apps/chat-api/src/config/schedules-runtime.ts`
- `apps/chat-api/tests/routes/mysheets-connections.test.ts`
- `apps/chat-api/tests/db/sheets-digest-migration.test.ts` (Tạo mới)
- `apps/chat-api/tests/services/sheets-digest.test.ts` (Tạo mới)

### Frontend (`apps/chat-web`)
- `apps/chat-web/src/types.ts`
- `apps/chat-web/src/services/api-client.ts`
- `apps/chat-web/src/services/schedule-text.ts`
- `apps/chat-web/src/views/MySheetsCallbackView.tsx`
- `apps/chat-web/src/pages/Settings/PersonalMySheets.tsx`
- `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx`
- `apps/chat-web/src/pages/Cockpit/ScheduleRunRecovery.tsx`
- `apps/chat-web/src/pages/History/ScheduleSection.tsx`
- `apps/chat-web/tests/mysheets-ui.test.tsx`

## 3. Bằng chứng Kiểm thử Thực tế (Verification Evidence)

- **Kiểm thử Đột biến Bắt buộc (`node scripts/test-mysheets-mutations.mjs`):**
  - 13/13 đột biến (`M1`, `M2`, `M3a`, `M3b`, `M3c`, `M3d`, `M4`, `M5`, `M6`, `M7`, `M8`, `M9`, `M10`) bị bắt 100% (`All 13 mutations successfully caught and verified!`).
- **Kiểm thử Unit & Schema & Planner Invariants:**
  - `npx vitest run packages/tool-schemas/tests/ packages/tool-adapters/tests/sheets-adapter.test.ts packages/tool-adapters/tests/sheets/personal-sheets-adapter.test.ts packages/planner/tests/read-answers.test.ts packages/planner/tests/schedules.test.ts` -> **21 test files passed, 450/450 tests passed** (bao gồm kiểm tra bất biến 33 tools trong `ALL_TOOLS` và SHA-256 system prompt khi cờ tắt).
- **Kiểm thử PostgreSQL 16 Migration, Routes & Services (`apps/chat-api`):**
  - `npx vitest run apps/chat-api/tests/db/schedule-migration.test.ts apps/chat-api/tests/db/mysheets-migration.test.ts apps/chat-api/tests/db/sheets-digest-migration.test.ts apps/chat-api/tests/routes/mysheets-connections.test.ts apps/chat-api/tests/services/mysheets-backend.test.ts apps/chat-api/tests/services/sheets-digest.test.ts apps/chat-api/tests/routes/schedule-routes.test.ts` -> **7 test files passed, 64/64 tests passed** trên PostgreSQL 16 thật.
- **Kiểm thử Giao diện (`apps/chat-web`):**
  - `Push-Location apps/chat-web; npx vitest run tests/mysheets-ui.test.tsx; Pop-Location` -> **1 test file passed, 21/21 tests passed**.
