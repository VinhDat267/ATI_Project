# Handoff Log — 2026-11-03: Nâng Cấp Toàn Diện Google Sheets 2 Chiều (`mysheets.*` & `sheets.*`), Báo Cáo KPI Tự Động (`sheets_digest`), UI/UX & Playwright E2E

- **Ngày:** 03/11/2026 (Asia/Ho_Chi_Minh)
- **Nhánh:** `fix/migration-rerun-idempotency`
- **Phạm vi:** Kiểm định phản biện dưới góc nhìn người dùng thực tế (`agency-product-manager` × `agency-reality-checker`) và nâng cấp toàn trình Google Sheets thành hệ thống Quản trị Dữ liệu 2 chiều (Two-Way Operational Database): định tuyến cá nhân thông minh, đọc tiêu đề cột dòng 1, chống trùng lặp Upsert (`skip` / `update`), 3 công cụ vận hành 2 chiều mới (`search_rows`, `update_rows`, `create_sheet`), báo cáo định kỳ `sheets_digest` kèm thống kê KPI số học (`numericTotals` + gửi qua Gmail/Slack), nâng cấp toàn diện UI/UX trên `chat-web`, và kiểm thử đầu-cuối Playwright E2E (`Flow 1`–`Flow 7`).

---

## 1. Các hạng mục đã hoàn thành

### Vòng 1: Giải quyết 4 điểm nghẽn trải nghiệm cốt lõi (P0 – P2)
1. **Smart Personal Routing (`sheets` ↔ `mysheets`) & Header-Aware Grounding (P0):**
   - Nâng cấp [`packages/planner/src/router.ts`](../../../packages/planner/src/router.ts): tự động ánh xạ sang `mysheets` khi người dùng chỉ kết nối Google Sheets cá nhân (hoặc sang `sheets` khi chỉ có tài khoản dịch vụ dùng chung), loại bỏ hoàn toàn ma sát bắt người dùng phải gõ cụm từ *"của tôi"* mới kích hoạt được công cụ.
   - Mở rộng [`packages/tool-adapters/src/sheets/personal-sheets-adapter.ts`](../../../packages/tool-adapters/src/sheets/personal-sheets-adapter.ts) (`tabs(spreadsheetId, signal, includeHeaders)`): đọc dòng 1 (`1:1`) của tối đa 5 tab đầu tiên để trích xuất `headers?: string[]`.
   - Cập nhật [`apps/chat-api/src/services/chat-service.ts`](../../../apps/chat-api/src/services/chat-service.ts) và [`packages/planner/src/prompts/system-prompt.ts`](../../../packages/planner/src/prompts/system-prompt.ts): bơm cấu trúc cột thực tế `[Cột: ...]` vào `resourceContext` để LLM ánh xạ chính xác thứ tự cột khi lập kế hoạch `append_rows`.
2. **Idempotent Upsert (`onDuplicate: 'skip' | 'update'`) & Preview Bảng Cột (P1):**
   - Mở rộng schema `mysheets.append_rows` ([`packages/tool-schemas/src/mysheets.ts`](../../../packages/tool-schemas/src/mysheets.ts)) và `sheets.append_rows` ([`packages/tool-schemas/src/sheets.ts`](../../../packages/tool-schemas/src/sheets.ts)) thêm `matchColumn?: number` (`0..25`) và `onDuplicate?: 'append' | 'skip' | 'update'`.
   - Cài đặt thuật toán đối soát khóa trùng trong [`packages/tool-adapters/src/sheets/sheets-shared.ts`](../../../packages/tool-adapters/src/sheets/sheets-shared.ts) (`partitionUpsertRows`, `columnIndexToLetter`), thực thi `PUT /values/{range}` cho các dòng cập nhật và `POST /values/{range}:append` cho các dòng mới trong cả `PersonalSheetsAdapter` và `SheetsAdapter`.
3. **Scheduled `sheets_digest` qua Gmail & Smart Fallback (P2):**
   - Nâng cấp [`apps/chat-api/src/services/schedules/sheets-digest-candidate.ts`](../../../apps/chat-api/src/services/schedules/sheets-digest-candidate.ts) và [`apps/chat-api/src/services/schedules/sheets-digest-runner.ts`](../../../apps/chat-api/src/services/schedules/sheets-digest-runner.ts): hỗ trợ gửi báo cáo định kỳ bảng tính qua cả **Slack** (`notifyChannel`) và **Gmail cá nhân** (`notifyEmail` hoặc tự động fallback sang địa chỉ Gmail đã kết nối của user).

### Vòng 2: Mở rộng Bộ Công Cụ Vận Hành 2 Chiều (8 Tools) & Thống Kê KPI Số Học
1. **3 công cụ mới cho cả `mysheets.*` và `sheets.*` (tổng cộng 6 tool definitions mới):**
   - `mysheets.search_rows` / `sheets.search_rows`: Tra cứu dòng theo điều kiện lọc (`column`, `operator: 'equals' | 'contains' | 'not_empty'`, `value`, `limit`) trả về số thứ tự dòng thật (`rowNumber >= 2`), `headers`, `matches`, và `totalMatched`.
   - `mysheets.update_rows` / `sheets.update_rows`: Cập nhật các dòng đã tồn tại theo khóa đối chiếu (`matchColumn`, `matches: [{ matchValue, values }]`) thông qua `POST /v4/spreadsheets/{id}/values:batchUpdate`, trả về `updatedRows`, `matchedRowNumbers`, `notFoundKeys`.
   - `mysheets.create_sheet` / `sheets.create_sheet`: Tạo tab mới (`title`, `headers?: string[]`) qua `POST /v4/spreadsheets/{id}:batchUpdate` (`addSheet`) và tự động khởi tạo dòng tiêu đề `A1` nếu truyền `headers`.
2. **Hỗ trợ nối chuỗi biến bước trước (`$step_N`) trong Executor & Validator:**
   - Mở rộng [`packages/planner/src/validator.ts`](../../../packages/planner/src/validator.ts) và [`packages/executor/src/runner.ts`](../../../packages/executor/src/runner.ts) để bảo toàn cấu trúc mảng/đối tượng khi phân giải biểu thức `$step_N.matches[0]...` trong các workflow liên dịch vụ.
3. **Thống kê KPI Số học (`numericTotals`) trong `sheets_digest`:**
   - Nâng cấp [`apps/chat-api/src/services/schedules/sheets-digest-runner.ts`](../../../apps/chat-api/src/services/schedules/sheets-digest-runner.ts): tự động bóc tách số học tiền tệ/phần trăm (`15.000.000`, `$1,250.50`, `85%`) theo từng cột tiêu đề (`sum`, `avg`, `min`, `max`, `count`) và đưa vào prompt tổng hợp AI + payload kết quả.

### Vòng 3: Nâng Cấp Toàn Diện Giao Diện Frontend UI/UX (`apps/chat-web`)
1. **Danh mục dịch vụ & Trạng thái thực thi (`Cockpit` & `ExecutionProgress`):**
   - Cập nhật [`apps/chat-web/src/assets/cockpit-services.json`](../../../apps/chat-web/src/assets/cockpit-services.json), [`apps/chat-web/src/components/Cockpit.tsx`](../../../apps/chat-web/src/components/Cockpit.tsx), và [`apps/chat-web/src/components/ExecutionProgress.tsx`](../../../apps/chat-web/src/components/ExecutionProgress.tsx) hỗ trợ đầy đủ 8 tools (`mysheets.*` & `sheets.*`).
2. **Xem trước thao tác trực quan (`PreviewContents.tsx`) & Biên lai kết quả (`ReceiptMoment.tsx`):**
   - Cập nhật [`apps/chat-web/src/pages/Cockpit/PreviewContents.tsx`](../../../apps/chat-web/src/pages/Cockpit/PreviewContents.tsx): hiển thị thẻ tóm tắt điều kiện lọc cho `search_rows`, bảng khóa cập nhật kèm huy hiệu `Cập nhật theo cột #` cho `update_rows`, thẻ cấu trúc cột khởi tạo cho `create_sheet`, và huy hiệu chống trùng (`Bỏ qua dòng trùng` / `Cập nhật dòng trùng`) kèm tiêu đề cột thật từ `headers` cho `append_rows`.
   - Cập nhật [`apps/chat-web/src/pages/Cockpit/ReceiptMoment.tsx`](../../../apps/chat-web/src/pages/Cockpit/ReceiptMoment.tsx): hiển thị biên lai chi tiết sau thực thi (`insertedRows` / `updatedRows` / `skippedDuplicateRows`, `matchedRowNumbers` + `notFoundKeys`, `sheetId` + `headersWritten`, `totalMatched` dòng khớp).
3. **Khôi phục lỗi thông minh (`RecoveryMoment.tsx`), Lịch biểu (`ScheduleMoment.tsx`) & Quản lý kết nối (`PersonalMySheets.tsx`):**
   - Cập nhật [`apps/chat-web/src/pages/Cockpit/recovery-labels.json`](../../../apps/chat-web/src/pages/Cockpit/recovery-labels.json) và [`apps/chat-web/src/pages/Cockpit/RecoveryMoment.tsx`](../../../apps/chat-web/src/pages/Cockpit/RecoveryMoment.tsx) hỗ trợ tiếng Việt cho các tham số mới (`matchColumn`, `onDuplicate`, `column`, `operator`, `value`, `matches`, `headers`) và gợi ý chọn tab sẵn có khi gặp `TAB_NOT_FOUND`.
   - Cập nhật [`apps/chat-web/src/pages/Settings/PersonalMySheets.tsx`](../../../apps/chat-web/src/pages/Settings/PersonalMySheets.tsx): hiển thị danh sách **Tab & Cột tiêu đề dòng 1** trực tiếp dưới mỗi bảng tính đã ghim, hỗ trợ dán nhanh cả URL Google Sheets lẫn Spreadsheet ID.
   - Cập nhật [`apps/chat-web/src/pages/Guide/mysheets-data.tsx`](../../../apps/chat-web/src/pages/Guide/mysheets-data.tsx) bổ sung các mẫu câu lệnh thực chiến (tra cứu dòng, tạo tab mới, cập nhật theo mã đơn, chống trùng lặp, và báo cáo KPI định kỳ).

### Vòng 4: Audit Toàn Trình & Kiểm Thử Đầu-Cuối Playwright E2E (`Flow 1` – `Flow 7`)
1. **Nâng cấp Fake Google Sheets v4 Server & Sandbox Scenarios:**
   - Mở rộng [`scripts/fake-google-gmail.mjs`](../../../scripts/fake-google-gmail.mjs) hỗ trợ đầy đủ các endpoint Google Sheets v4 thật: đọc metadata kèm dòng tiêu đề 1 (`ranges=1:1&fields=sheets.properties...,sheets.data.rowData.values.formattedValue`), `values:batchGet`, `:batchUpdate` (`addSheet`), `values:batchUpdate`, và `PUT /values/{range}`.
   - Bổ sung kịch bản khép kín 4 bước trong [`apps/chat-api/src/sandbox/scenarios.ts`](../../../apps/chat-api/src/sandbox/scenarios.ts) và [`apps/chat-api/src/sandbox/fake-results/sheets.ts`](../../../apps/chat-api/src/sandbox/fake-results/sheets.ts): `mysheets.create_sheet` → `mysheets.append_rows` (`onDuplicate: 'update'`) → `mysheets.search_rows` → `mysheets.update_rows`.
   - Bổ sung kịch bản kiểm thử trình duyệt thật `MYSHEETS: Flow 7` trong [`apps/chat-web/tests/browser/mysheets.spec.ts`](../../../apps/chat-web/tests/browser/mysheets.spec.ts).

---

## 2. Danh sách Files chính đã sửa đổi / thêm mới
- `packages/tool-schemas/src/mysheets.ts`, `packages/tool-schemas/src/sheets.ts`, `packages/tool-schemas/src/types.ts`
- `packages/tool-schemas/tests/mysheets-schemas.test.ts`, `packages/tool-schemas/tests/schemas.test.ts`
- `packages/tool-adapters/src/sheets/sheets-shared.ts`, `packages/tool-adapters/src/sheets/personal-sheets-adapter.ts`, `packages/tool-adapters/src/sheets/sheets-adapter.ts`
- `packages/tool-adapters/tests/sheets/personal-sheets-adapter.test.ts`
- `packages/planner/src/router.ts`, `packages/planner/src/validator.ts`, `packages/planner/src/prompts/system-prompt.ts`
- `packages/planner/tests/mysheets-routing.test.ts`, `packages/planner/tests/planner.test.ts`
- `packages/executor/src/runner.ts`, `packages/executor/tests/runner.test.ts`
- `apps/chat-api/src/services/chat-service.ts`, `apps/chat-api/src/services/schedules/sheets-digest-candidate.ts`, `apps/chat-api/src/services/schedules/sheets-digest-runner.ts`
- `apps/chat-api/src/sandbox/scenarios.ts`, `apps/chat-api/src/sandbox/fake-results/sheets.ts`
- `apps/chat-api/tests/services/sheets-digest.test.ts`, `apps/chat-api/tests/services/schedules/sheets-digest.test.ts`
- `apps/chat-web/src/assets/cockpit-services.json`, `apps/chat-web/src/components/Cockpit.tsx`, `apps/chat-web/src/components/ExecutionProgress.tsx`
- `apps/chat-web/src/pages/Cockpit/PreviewContents.tsx`, `apps/chat-web/src/pages/Cockpit/ReceiptMoment.tsx`, `apps/chat-web/src/pages/Cockpit/RecoveryMoment.tsx`, `apps/chat-web/src/pages/Cockpit/recovery-labels.json`, `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx`
- `apps/chat-web/src/pages/Settings/PersonalMySheets.tsx`, `apps/chat-web/src/pages/Guide/mysheets-data.tsx`, `apps/chat-web/src/services/schedule-text.ts`, `apps/chat-web/src/types.ts`
- `apps/chat-web/tests/mysheets-ui.test.tsx`, `apps/chat-web/tests/browser/mysheets.spec.ts`
- `scripts/fake-google-gmail.mjs`

---

## 3. Bằng chứng Kiểm thử Thực tế (Quality Gate Evidence)
- **Typecheck toàn dự án v3:**
  - `npm run typecheck:v3` → **PASS** (exit code 0).
- **Unit & Integration Tests (Schemas, Adapters, Planner, Executor, Chat API, Chat Web UI):**
  - `npm test -w @wap/tool-schemas` → **PASS** (exit code 0).
  - `npm test -w @wap/tool-adapters -- tests/sheets/personal-sheets-adapter.test.ts` → **31/31 tests PASS** (exit code 0).
  - `npm test -w @wap/planner -- tests/mysheets-routing.test.ts` → **12/12 tests PASS** (exit code 0).
  - `npm test -w @wap/executor -- tests/runner.test.ts` → **PASS** (exit code 0).
  - `npm test -w @wap/chat-api -- tests/services/sheets-digest.test.ts tests/services/schedules/sheets-digest.test.ts` → **PASS** (exit code 0).
  - `npm test -w @wap/chat-web -- tests/mysheets-ui.test.tsx` → **24/24 tests PASS** (exit code 0).
- **Kiểm thử Đột biến Bảo mật (Mutation Testing):**
  - `node scripts/test-mysheets-mutations.mjs` → **13/13 mutations caught** (exit code 0).
- **Kiểm thử Trình duyệt Thật (Playwright Chromium Headless + PostgreSQL 16 + Fake Google Sheets v4 Server):**
  - `SCENARIO=mysheets node scripts/test-v3-browser.mjs` → **10/10 passed (31.1s, Flows 1–7)** (exit code 0).
  - `SCENARIO=sheets_slack node scripts/test-v3-browser.mjs` → **1/1 passed (8.1s)** (exit code 0).
  - `SCENARIO=default GREP="MYSHEETS off:" node scripts/test-v3-browser.mjs` → **1/1 passed (8.2s)** (exit code 0).
