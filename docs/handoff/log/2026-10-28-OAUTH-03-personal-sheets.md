# 28/10/2026 · OAUTH-03 · Google Sheets của riêng bạn kèm chọn bảng tính qua Google Picker (`mysheets`)

**Người viết:** Antigravity Orchestrator (thi công theo quy trình `subagent-driven-development` với 2 subagents chạy song song).  
**Nhánh:** `feat/oauth-03-personal-sheets` (tách từ `main` `155e99de`).  
**Task card:** [`docs/handoff/tasks/OAUTH-03-personal-sheets.md`](../tasks/OAUTH-03-personal-sheets.md).  
**Đặc tả:** [`docs/superpowers/specs/2026-10-28-oauth-03-personal-sheets-design.md`](../../superpowers/specs/2026-10-28-oauth-03-personal-sheets-design.md).  
**Kế hoạch triển khai:** [`docs/superpowers/plans/2026-10-28-oauth-03-personal-sheets.md`](../../superpowers/plans/2026-10-28-oauth-03-personal-sheets.md).

---

## 1. Tóm tắt những việc đã làm (11 Tasks)

1. **Task 1 — Tool Schemas, Registry, Executor Write Catalog & DB Migration `0013` (`e8de063d`):**
   - Thêm `packages/tool-schemas/src/mysheets.ts` và `packages/tool-schemas/src/registry/mysheets.ts`:
     - `MYSHEETS_SERVICE` (`connection: 'personal'`, `scopeKey: 'spreadsheets'`, `authType: 'oauth2'`).
     - 4 công cụ `mysheets.list_spreadsheets` (`discovers: 'myspreadsheet'`), `mysheets.read_range`, `mysheets.list_sheets` (`discovers: 'mysheet'`), và `mysheets.append_rows` (`'x-resource': 'myspreadsheet'`).
   - Cập nhật `packages/executor/src/runner.ts` phân loại `'mysheets.append_rows'` vào `WRITE_TOOLS`.
   - Tạo migration idempotent `db/v3/0013_mysheets_personal_connections.sql` mở rộng `service_credentials_personal_check` cho `'mysheets'` và `oauth_states_mode_check` cho `'connect_mysheets'`.

2. **Task 2 — Cấu hình môi trường & Cách ly Google Cloud Project (`e45cffe2`):**
   - Bổ sung `MYSHEETS_ENABLED` (mặc định `off`), `MYSHEETS_OAUTH`, `MYSHEETS_PICKER` trong `apps/chat-api/src/config/env.ts` và `.env.example`.
   - Tổng quát hóa `validatePersonalGoogleProjects` cho cả ba dịch vụ Google riêng (Gmail, MyCalendar, MySheets), kiểm tra project ID riêng biệt và OAuth Client ID khác nhau, bảo toàn nguyên vẹn hai câu báo lỗi đặc thù của cặp Gmail–MyCalendar.
   - Thêm `docs/ai-evidence/MYSHEETS-LIVE/` vào `.gitignore`.

3. **Task 3 — `PersonalSheetsAdapter` & Tách phần dùng chung (`63aa70cb`):**
   - Tách các hàm validate/normalize dùng chung vào `packages/tool-adapters/src/sheets/sheets-shared.ts`.
   - Xây dựng `packages/tool-adapters/src/sheets/personal-sheets-adapter.ts`:
     - Kiểm tra nghiêm ngặt `spreadsheetId ∈ allowedScope.spreadsheets` (`assertAllowedScope('spreadsheets', value)`) trên toàn bộ 4 tools.
     - `mysheets.list_spreadsheets` chỉ hiển thị các bảng trong phạm vi đã cấp.
     - Chặn công thức nguy hiểm (`=, +, -, @, \t, \r`) khi thực thi `append_rows`.
     - Phân loại lỗi mạng/treo sau khi gửi lệnh ghi thành `StepError` với `category: 'UNKNOWN'`.

4. **Task 4 — Mở rộng Repo kết nối, Token Manager & Google giả (`c0740ea4`):**
   - Mở rộng `apps/chat-api/src/db/repositories/gmail-connection-repo.ts` hỗ trợ `'mysheets'` và `oauth_states.mode = 'connect_mysheets'`.
   - Cập nhật `services/gmail/token-manager.ts` và `services/gmail/connection-reference.ts` (`createMySheetsConnectionLookup`).
   - Mở rộng `scripts/fake-google-gmail.mjs`: Drive `about.get` (trả email người dùng), `files.get` (trả metadata `name`, `mimeType`, `capabilities.canEdit`, `trashed`), Sheets API phạm vi scoped, và hai endpoint phục vụ sandbox picker: `GET /fake-picker/files`, `POST /fake-picker/grant` (có CORS origin).

5. **Task 5 — Route `/api/connections/mysheets` (`febc23cd`, `cffa87fd`, `5eb3b641`):**
   - `POST /start`: PKCE S256, cookie `ati_mysheets_browser`, kiểm tra bảo vệ CSRF và quyền hội thoại `returnTo`.
   - `POST /callback`: đổi code, lấy email qua Drive `about.get`, lưu kết nối ở trạng thái `scope_required` (`selectedSpreadsheets: []`), trả `{ email, returnTo }`.
   - `POST /picker-session`: yêu cầu phiên người dùng có dòng `active`, trả token tạm, header `Cache-Control: no-store`, rate limit 10 lần/phút/user.
   - `GET /spreadsheets`: trả danh sách bảng tính đã chọn hiện tại kèm trạng thái.
   - `PUT /scope`: nhận 1 đến 10 spreadsheet IDs, gọi Drive `files.get` xác thực quyền sở hữu và lấy `canEdit`, cập nhật nguyên tử dưới advisory transaction lock.
   - `DELETE /`: thu hồi refresh token của project Sheets, xoá dòng `mysheets`, đảm bảo giữ nguyên tuyệt đối dòng `gmail` và `mycalendar` của cùng người dùng.

6. **Task 6 — Runtime Wiring: Router, Adapter Factory, Chat Service & Sandbox (`f8afded8`):**
   - `packages/planner/src/router.ts`: tổng quát hóa quy tắc ưu tiên dịch vụ riêng dựa trên `connection === 'personal'` và `scopeKey === 'spreadsheets'`.
   - `registered-services.ts`: đưa `MYSHEETS_TOOLS` vào catalog khi `mysheetsEnabled === true` và kết nối đang `connected` (đã chọn ít nhất 1 bảng).
   - `adapter-factory.ts`: khởi tạo `PersonalSheetsAdapter`, xác thực `record.id === previewed.credentialId` và mọi bảng trong `previewed.allowedSpreadsheets` còn nằm trong scope được phép.
   - `chat-service.ts`: `bindConnections` chặn các yêu cầu vào bảng nằm ngoài allowlist hoặc cố gắng ghi vào bảng chỉ xem (`canEdit === false`).
   - `sandbox/scenarios.ts`: kịch bản sandbox `mysheets` với `args: { query: '' }` cho `list_spreadsheets` và `{ spreadsheetId, sheet, rows }` cho `append_rows`.

7. **Task 7 — Web Infra, Google Picker & Màn Callback (`f6b7c061`):**
   - `apps/chat-web/src/services/google-picker.ts`: nạp script `apis.google.com/js/api.js` một lần, URL hằng số an toàn.
   - `apps/chat-web/src/components/FakeSheetsPicker.tsx`: modal chọn bảng tính cho sandbox.
   - `apps/chat-web/src/views/MySheetsCallbackView.tsx`: tiếp nhận OAuth callback hoặc chế độ `?mode=select&returnTo=...` mở Picker chọn bảng mà không phải chạy lại OAuth.

8. **Task 8 — Web UI: Settings, Cockpit, Moments & Privacy (`855a2973`, `0b2819c6`):**
   - `PersonalMySheets.tsx` (`/settings#mysheets`): đủ 4 trạng thái (`not_connected`, `scope_required`, `connected` kèm danh sách bảng và badge Chỉ xem, `reconnect_required`).
   - `Cockpit.tsx`: bổ sung `mysheetsEnabled` vào điều kiện `personalEnabled` mở luồng kết nối trực tiếp từ chat.
   - `ResponseMoment.tsx` (`RefusalMoment`): hiển thị nút *"Kết nối Google Sheets"*, *"Chọn bảng tính Google Sheets"* (khi `scope_required`), *"Kết nối lại Google Sheets"*.
   - `PlanMoment.tsx`, `ReceiptMoment.tsx`, `RecoveryMoment.tsx`, `PrivacyPage.tsx`: hiển thị nhãn tài khoản, đường dẫn bảng tính, link an toàn `https://`, và chính sách dữ liệu bảng tính riêng.

9. **Task 9 — `/guide` và Landing Page (`e70f54e8`, `cd55c9e1`):**
   - `apps/chat-web/src/pages/Guide/mysheets-data.tsx`: hướng dẫn và mẫu câu cho 4 tình huống.
   - `GuidePage.tsx`: hiển thị tab Bảng tính với category `mysheets`, liên kết `/guide?service=mysheets`.
   - `LandingPage.tsx`: thẻ "Google Sheets · Của riêng bạn" xuất hiện có điều kiện khi `MYSHEETS_ENABLED=on`.
   - Khai báo ngoại lệ cho `mysheets-data.tsx` trong `evaluations/generic-plumbing/static-guard.test.ts`.

10. **Task 10 — Browser E2E Test Suite (`c2348b55`, `0b2819c6`):**
    - Tạo `apps/chat-web/tests/browser/mysheets.spec.ts` gồm 6 flows (9 ca kiểm thử).
    - Cập nhật runner `scripts/test-v3-browser.mjs` hỗ trợ `SCENARIO=mysheets`.
    - Kiểm thử cô lập cờ tắt `MYSHEETS off:` đảm bảo không rò rỉ endpoint hay gọi ngoài tới Google.

11. **Task 11 — 13 Đột biến Bắt buộc (§8.2) & Runner Tự động (`cffa87fd`):**
    - Xây dựng công cụ kiểm thử đột biến tự động `scripts/test-mysheets-mutations.mjs`.
    - Xác nhận bắt thành công 13/13 đột biến bắt buộc (100% exit code 1, khôi phục SHA-256 hoàn hảo).

---

## 2. Bằng chứng RED → GREEN & Kiểm thử toàn diện

Chạy trên PostgreSQL container tại cổng `55533` (`ati_v3`):

| Nhóm kiểm thử | Lệnh chạy | Kết quả |
|---|---|---|
| TypeScript Typecheck | `npm run typecheck:v3` | **PASS** (exit code 0, 0 errors) |
| Web Security Scan & Production Build | `npm run build:v3 && node scripts/test-v3-web-build-security.mjs` | **PASS** (exit code 0) |
| Unit & Integration Suites (`test:v3`) | `npm run test:v3` | **PASS — 2.491 passed** (6 workspaces: `tool-schemas` 67, `tool-adapters` 443, `planner` 381, `executor` 42, `chat-api` 675, `chat-web` 883) |
| Evaluation & Static Guard (`test:eval:v3`) | `npm run test:eval:v3` | **PASS — 406 passed** (25 test files, gồm `static-guard.test.ts` và golden suites) |
| Launcher & Environment Checks | `npm run test:launcher:v3 && node --test ...` | **PASS — 11 passed** |
| Toàn bộ Verification Gate | `npm run check` | **PASS** (exit code 0) |
| Browser E2E (`SCENARIO=mysheets`) | `SCENARIO=mysheets node scripts/test-v3-browser.mjs` | **PASS — 9/9 passed** (27.8s: Flow 1–6, dark/light, 1440×900 & 375×812) |
| Browser E2E (`MYSHEETS off:`) | `SCENARIO=default GREP="MYSHEETS off:" node scripts/test-v3-browser.mjs` | **PASS — 1/1 passed** (6.6s) |

---

## 3. Bảng kết quả 13 Đột biến Bắt buộc (Spec §8.2)

Tất cả 13 đột biến được kiểm tra tự động qua runner `scripts/test-mysheets-mutations.mjs`:

| # | Đột biến (Spec §8.2) | File áp đột biến | Test bắt lỗi | Exit Code | Khôi phục SHA-256 |
|---|---|---|---|:---:|:---:|
| **M1** | Rơi về `sheets.*` chung khi chưa kết nối `mysheets` (`mayFallbackToShared`) | `apps/chat-api/src/config/gmail-tools-runtime.ts` | `mysheets-services.test.ts` (`mayFallbackToShared prevents shared fallback when mysheets intent is routed`) | `1` | Khớp 100% |
| **M2** | Cho `mysheets.*` vào catalog khi đang `scope_required` | `apps/chat-api/src/services/registered-services.ts` | `mysheets-services.test.ts` (`excludes MYSHEETS_TOOLS in getToolCatalogFor when in scope_required state`) | `1` | Khớp 100% |
| **M3a** | `PUT /scope` bỏ kiểm tra fileId hợp lệ từ Google Drive | `apps/chat-api/src/routes/connections/mysheets.ts` | `mysheets-connections.test.ts` (`PUT /scope rejects when one of the requested files cannot be retrieved from Drive`) | `1` | Khớp 100% |
| **M3b** | `bindConnections` bỏ kiểm tra `allowedSpreadsheets` | `apps/chat-api/src/services/chat-service.ts` | `mysheets-services.test.ts` (`bindConnections rejects steps using a spreadsheet outside allowedSpreadsheets`) | `1` | Khớp 100% |
| **M3c** | `AdapterFactory` bỏ kiểm tra `allowedSpreadsheets` lúc thực thi | `apps/chat-api/src/services/adapter-factory.ts` | `mysheets-services.test.ts` (`AdapterFactory throws AUTH_ERROR when requested spreadsheet was removed from allowedSpreadsheets`) | `1` | Khớp 100% |
| **M3d** | `PersonalSheetsAdapter` bỏ kiểm tra `assertAllowedScope` | `packages/tool-adapters/src/sheets/personal-sheets-adapter.ts` | `personal-sheets-adapter.test.ts` (`assertAllowedScope: rejects spreadsheetId not in allowedScope.spreadsheets`) | `1` | Khớp 100% |
| **M4** | `PUT /scope` không gọi Drive `files.get`, lấy tên bảng giả lập | `apps/chat-api/src/routes/connections/mysheets.ts` | `mysheets-connections.test.ts` (`PUT /scope rejects when one of the requested files cannot be retrieved from Drive`) | `1` | Khớp 100% |
| **M5** | `AdapterFactory` bỏ kiểm tra `credentialId` lúc thực thi | `apps/chat-api/src/services/adapter-factory.ts` | `mysheets-services.test.ts` (`AdapterFactory throws AUTH_ERROR when credentialId changed between planning and execution`) | `1` | Khớp 100% |
| **M6** | `DELETE /connections/mysheets` xoá luôn dòng `gmail` của cùng người dùng | `apps/chat-api/src/routes/connections/mysheets.ts` | `mysheets-connections.test.ts` (`revokes the mysheets token, deletes the mysheets row, leaving gmail row active and untouched`) | `1` | Khớp 100% |
| **M7** | `MYSHEETS_ENABLED=off` vẫn thêm `MYSHEETS_TOOLS` vào catalog | `apps/chat-api/src/services/registered-services.ts` | `mysheets-services.test.ts` (`excludes MYSHEETS_TOOLS from getToolCatalogFor when mysheetsEnabled is false`) | `1` | Khớp 100% |
| **M8** | `POST /picker-session` thiếu header `Cache-Control: no-store` | `apps/chat-api/src/routes/connections/mysheets.ts` | `mysheets-connections.test.ts` (`POST /picker-session returns session details with Cache-Control: no-store`) | `1` | Khớp 100% |
| **M9** | `PersonalSheetsAdapter` bỏ chặn công thức (`=, +, -, @, \t, \r`) | `packages/tool-adapters/src/sheets/personal-sheets-adapter.ts` | `personal-sheets-adapter.test.ts` (`rejects formula injection in rows for append_rows`) | `1` | Khớp 100% |
| **M10** | Lỗi mạng sau khi gửi `append_rows` bị xếp vào `FAILED` thay vì `UNKNOWN` | `packages/tool-adapters/src/sheets/personal-sheets-adapter.ts` | `personal-sheets-adapter.test.ts` (`when fetchFn rejects after append_rows is sent, throws StepError with category UNKNOWN`) | `1` | Khớp 100% |

---

## 4. Cập nhật sau Review Vòng 1 (PR #180)

Đã xử lý dứt điểm 4 findings từ reviewer (`https://github.com/VinhDat267/ATI_Project/pull/180#issuecomment-6461437330`) và bổ sung test tích hợp:

1. **[P1] Cấu hình live tách biệt hoàn toàn fakePickerBaseUrl và Drive endpoint:**
   - Sửa `apps/chat-api/src/server.ts`: chỉ truyền `fakePickerBaseUrl` và `driveApiBaseUrl` khi `RUNTIME_MODE === 'sandbox'`. Trong chế độ live, để `undefined` fallback về Drive API chuẩn (`https://www.googleapis.com`) và Google Picker SDK chính thức (`POST /picker-session` trả `mode: 'google'`).
   - Kiểm thử: Bổ sung ca test `proves live mode isolates driveApiBaseUrl and omits fakePickerBaseUrl` trong `apps/chat-api/tests/config/mysheets-config.test.ts` (9/9 pass).

2. **[P2] Chặn bỏ bảng cuối trên UI khi server chưa thay đổi quyền:**
   - Sửa `apps/chat-web/src/views/MySheetsCallbackView.tsx`: Khi `spreadsheets.length <= 1`, disable nút "Bỏ", hiển thị thông báo lỗi rõ ràng hướng dẫn người dùng ngắt kết nối tại Cài đặt thay vì để xoá mồ côi trên UI trong khi server vẫn giữ quyền. Bổ sung link điều hướng sang `/settings#mysheets`.
   - Kiểm thử: Cập nhật `apps/chat-web/tests/mysheets-ui.test.tsx` kiểm tra vô hiệu hoá nút "Bỏ" khi còn 1 bảng tính và hiển thị thông báo hướng dẫn (19/19 pass).

3. **[P2] Kiểm tra quyền hạn "Chỉ xem" (read-only) cả khi ID bảng tính là tham chiếu `$ref`:**
   - Sửa `apps/chat-api/src/services/chat-service.ts`: Xây dựng hàm `resolveTargetSpreadsheet` hỗ trợ giải quyết ID từ cả dạng chuỗi trực tiếp lẫn tham chiếu `$ref` (dựa trên kết quả danh sách bảng tính được kết nối hoặc bước liệt kê trước đó). Bắt và từ chối kế hoạch ghi vào bảng chỉ xem ngay tại tầng thẩm định trước khi người dùng duyệt.
   - Kiểm thử: Bổ sung 2 ca test trong `apps/chat-api/tests/routes/mysheets-services.test.ts` kiểm tra từ chối append_rows nhắm vào bảng read-only qua `$ref` (24/24 pass).

4. **[P2] Đột biến M2 chuẩn xác và bằng chứng 13/13 đột biến bắt thành công:**
   - Sửa `scripts/test-mysheets-mutations.mjs`: Đột biến M2 được sửa từ việc gán sai điều kiện sang trực tiếp bypass kiểm tra `spreadsheets.length > 0` thành `true`.
   - Kết quả: Runner bắt trọn vẹn 13/13 đột biến (100% exit code 1, khôi phục 100% SHA-256).

5. **Bổ sung kiểm thử tích hợp Lịch trình (Schedules) + MySheets:**
   - Thêm ca test `attaches connections.mysheets and saves pending plan when schedule task uses mysheets` trong `apps/chat-api/tests/services/schedules/scheduled-run-planning.test.ts` xác thực khi cờ lịch trình và MySheets đều bật, lượt chạy định kỳ lập kế hoạch với MySheets lưu đầy đủ `connections.mysheets` vào bảng `plans` (5/5 pass).

6. **Chuẩn hoá thuật ngữ tài liệu:**
   - Sửa lỗi chính tả `mysheets.list_sheet_tabs` thành `mysheets.list_sheets` cho khớp 100% tên tool thực tế.

---

## 5. Cập nhật sau Review Vòng 2 (PR #180)

Đã xử lý dứt điểm 2 findings từ reviewer (`https://github.com/VinhDat267/ATI_Project/pull/180#issuecomment-6462036541`):

1. **[P2] Xác định đích bảng tính chính xác từ ngữ nghĩa `$ref`, chỉ số mảng và giới hạn `limit`:**
   - Sửa `apps/chat-api/src/services/chat-service.ts`:
     - Tái hiện đúng cơ chế của `PersonalSheetsAdapter.list_spreadsheets`: lọc theo `query` (nếu có, không phân biệt hoa thường), áp dụng giới hạn `limit` (1..10, mặc định 10).
     - Sử dụng hàm `resolveRef` chuẩn của `@wap/executor` giải quyết biểu thức tham chiếu (ví dụ: `find.output.1.id` hoặc `find.output.0.id`, hỗ trợ chuẩn hoá cú pháp ngoặc vuông `[1]`), lấy ra ID bảng tính cụ thể được trỏ tới thay vì ưu tiên bất kỳ bảng chỉ xem nào trùng tên.
     - Kiểm tra quyền hạn ghi: Nếu bảng tính được giải quyết qua tham chiếu có `canEdit: false`, từ chối với lý do rõ ràng; nếu là bảng cho phép chỉnh sửa (`canEdit: true`), kế hoạch được chấp thuận (`plan`).
   - Kiểm thử: Bổ sung bộ ca kiểm thử toàn diện trong `apps/chat-api/tests/routes/mysheets-services.test.ts` (26/26 pass):
     - Test unit `resolveTargetSpreadsheet` kiểm tra chính xác các tổ hợp query, limit, chỉ số 0 và 1, và trường hợp vượt giới hạn.
     - Tái hiện ca 1: Allowlist hỗn hợp `[W (Report writable), R (Report read only)]`, `query: "", limit: 10`, `$ref: "find.output.1.id"` trỏ tới R -> trả về **refusal**.
     - Tái hiện ca 2: Allowlist hỗn hợp `[W, R]`, `query: "Report", limit: 1`, `$ref: "find.output.0.id"` trỏ tới W -> trả về **plan** (chấp thuận, không bị chặn nhầm).
     - Allowlist hỗn hợp với `query: "Report", limit: 10`: `$ref: "find.output.0.id"` chấp thuận, `$ref: "find.output.1.id"` từ chối.

2. **[P3] Bảo vệ wiring live endpoints bằng hàm runtime và kiểm thử bắt hồi quy:**
   - Trích xuất hàm `runtimeMySheetsEndpoints(mode, apiBaseUrl)` trong `apps/chat-api/src/config/gmail-tools-runtime.ts`.
   - Cập nhật `apps/chat-api/src/server.ts` sử dụng trực tiếp hàm wiring này khi cấu hình `mysheets` app options thay vì biểu thức lặp lại cục bộ.
   - Kiểm thử: Cập nhật `apps/chat-api/tests/config/mysheets-config.test.ts` (10/10 pass):
     - Kiểm tra trực tiếp hàm `runtimeMySheetsEndpoints` cho cả 2 chế độ live và sandbox. Đã chứng minh nếu bỏ guard sandbox trong hàm này thì test lập tức FAIL (exit code 1).
     - Kiểm tra tĩnh mã nguồn `server.ts` bảo đảm server thực sự gọi `runtimeMySheetsEndpoints` và không truyền trực tiếp `apiBaseUrl` chưa cách ly.

---

## 6. Việc còn lại (cần thao tác của nhóm trưởng)

- Tạo OAuth Client thứ ba trên Google Cloud Project riêng biệt (redirect URI `/connections/mysheets/callback`, scope `https://www.googleapis.com/auth/drive.file`), tạo API Key cho Google Picker và điền các biến `MYSHEETS_OAUTH_*`, `MYSHEETS_PICKER_*` vào `.env` máy local.
- Thực hiện đo model độc lập trên nhánh `eval/oauth-03-measure` (`EVAL_SET=mysheets` ×3) sau khi PR code này được review và merge.
- Chạy nghiệm thu thật (P-LIVE) theo quy trình mục 8.4 của đặc tả trước khi bật cờ `MYSHEETS_ENABLED=on`.
