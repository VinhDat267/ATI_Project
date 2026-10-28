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
     - 4 công cụ `mysheets.list_spreadsheets` (`discovers: 'myspreadsheet'`), `mysheets.read_range`, `mysheets.list_sheet_tabs` (`discovers: 'mysheet'`), và `mysheets.append_rows` (`'x-resource': 'myspreadsheet'`).
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

## 4. Việc còn lại (cần thao tác của nhóm trưởng)

- Tạo OAuth Client thứ ba trên Google Cloud Project riêng biệt (redirect URI `/connections/mysheets/callback`, scope `https://www.googleapis.com/auth/drive.file`), tạo API Key cho Google Picker và điền các biến `MYSHEETS_OAUTH_*`, `MYSHEETS_PICKER_*` vào `.env` máy local.
- Thực hiện đo model độc lập trên nhánh `eval/oauth-03-measure` (`EVAL_SET=mysheets` ×3) sau khi PR code này được review và merge.
- Chạy nghiệm thu thật (P-LIVE) theo quy trình mục 8.4 của đặc tả trước khi bật cờ `MYSHEETS_ENABLED=on`.
