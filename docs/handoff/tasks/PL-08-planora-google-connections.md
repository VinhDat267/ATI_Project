# PL-08 · Cài đặt kết nối, Gmail, Google Calendar và Google Sheets (Settings & Google Services)

**Trạng thái:** sẵn sàng nhận · **Nhánh gợi ý:** `longnguyen005/feat-planora-pl-08` · **Phụ thuộc:** PL-02, PL-04, PL-07 đã hoàn tất và được Argon High duyệt Đạt.  
**Base SHA:** `81d139580d19641bfdf7b3eebe8b11c97a8ec9ec` (hội tụ các module accepted PL-02, PL-03, PL-04, PL-07).  
**Target branch:** `codex/planora-ui`.  
**Đặc tả:** [Planora migration design](../../superpowers/specs/2026-11-02-planora-migration-design.md), [Design Brief v2.0](../../superpowers/specs/2026-11-05-planora-design-brief.md), [Business-First UX](../../superpowers/specs/2026-11-05-planora-business-first-ux.md) · **Kế hoạch:** [Planora migration plan](../../superpowers/plans/2026-11-02-planora-migration.md) mục PL-08.  
**Prompt thi công:** [PL-08.md](../planora-prompts/PL-08.md).  
**Quy ước chung:** [COMMON.md](../planora-prompts/COMMON.md).

---

## 1. Mục tiêu

Thiết kế trang Cài đặt (Settings) và các kết nối dịch vụ Google (Gmail, Google Calendar, Google Sheets) theo nhận diện Planora và tiêu chuẩn Business-First UX v2.0:
1. **Settings Planora:** Trình bày theo nhóm cá nhân/tổ chức, phản ánh trạng thái kết nối, phạm vi và quyền thật; đếm dịch vụ từ dữ liệu thực tế.
2. **Ngôn ngữ kết nối hướng công việc:** Trình bày kết nối theo lợi ích công việc và mức sẵn sàng (chọn tài khoản, lịch làm việc, bảng tính biểu mẫu dễ hiểu; giải thích quyền hạn cần thiết thay vì phơi bày mã OAuth scope).
3. **ConnectionCallbackFrame:** Tạo khung layout callback chung (`apps/chat-web/src/planora/layout/ConnectionCallbackFrame.tsx`) chuẩn editorial Planora, chỉ đóng vai trò trình bày giao diện và không tiêu thụ OAuth state khi render; từng callback view giữ state machine, handler và deep-link returnTo riêng.
4. **Bảo toàn 100% contracts & anchors:** Giữ nguyên các anchor URL `#gmail`, `#mycalendar`, `#mysheets`, Google Picker API do Google sở hữu, logic xử lý lỗi kết nối, hết hạn token (reconnect), từ chối quyền (denied), và bảo mật chuyển phiên người dùng giữa callback.
5. **Trợ năng & Tương phản WCAG AA:** Đạt tỷ lệ tương phản >= 4.5:1 (nút primary dùng `var(--planora-on-primary)`, không dùng text-white ở dark mode), 100% SVG icons có `aria-hidden="true"`, không tràn ngang 320px..1440px.

---

## 2. Ranh giới sở hữu & Phạm vi file

- **Sửa đổi cho phép:**
  - `apps/chat-web/src/pages/Settings/SettingsPage.tsx`
  - `apps/chat-web/src/pages/Settings/PersonalGmail.tsx`
  - `apps/chat-web/src/pages/Settings/PersonalMyCalendar.tsx`
  - `apps/chat-web/src/pages/Settings/PersonalMySheets.tsx`
  - `apps/chat-web/src/pages/Settings/page.css`
  - `apps/chat-web/src/pages/Settings/useSettings.ts` (chỉ phần nối UI nếu cần)
  - `apps/chat-web/src/views/GmailCallbackView.tsx`
  - `apps/chat-web/src/views/MyCalendarCallbackView.tsx`
  - `apps/chat-web/src/views/MySheetsCallbackView.tsx`
  - `apps/chat-web/src/planora/layout/ConnectionCallbackFrame.tsx` (tạo mới)
  - Tests Settings và Google connections trong `apps/chat-web/tests/`.
- **Ngoài phạm vi:**
  - Không sửa `apps/chat-api` hay backend OAuth protocols.
  - Không skin hoặc can thiệp vào modal iframe Google Picker do Google sở hữu.
  - Không sửa hợp đồng API hoặc thay đổi schema dữ liệu settings của backend.

---

## 3. Interfaces & Yêu cầu kỹ thuật

1. **Khung giao diện ConnectionCallbackFrame:**
   - Được tái sử dụng cho 3 callback Google của PL-08 và mở rộng cho các dịch vụ tiếp theo (Trello, GitHub, Slack, Notion, Jira trong PL-09/10).
   - Render thương hiệu Planora (Monogram P, tiêu đề serif, status badge, message, và các nút CTA tiếp tục công việc).
2. **Bảo toàn State Machine Callback:**
   - `GmailCallbackView`: giữ logic trao đổi code, lưu token cá nhân, xử lý lỗi `access_denied`, `invalid_grant`.
   - `MyCalendarCallbackView`: giữ logic kết nối calendar, danh sách lịch người dùng chọn (`calendarId`), thiết lập primary calendar.
   - `MySheetsCallbackView`: giữ logic Google Sheets selection, danh sách spreadsheet IDs, quyền viewer/editor.
3. **Tiêu chuẩn Bằng chứng:**
   - `npm run typecheck:v3` exit code 0.
   - Toàn bộ unit tests liên quan đến Settings và Google Connections PASS.
   - `npm run build:v3` và `node scripts/test-v3-web-build-security.mjs` PASS.

---

## 4. Tiêu chí nghiệm thu (Acceptance Criteria)

- [x] Settings Page được refactor theo nhận diện Planora, phân nhóm rõ ràng cá nhân/tổ chức.
- [x] PersonalGmail, PersonalMyCalendar, PersonalMySheets được thiết kế lại business-first.
- [x] ConnectionCallbackFrame được tạo mới và tích hợp sạch sẽ vào 3 Google callback views.
- [x] Bảo toàn 100% anchors `#gmail`, `#mycalendar`, `#mysheets` và luồng quay lại `/c/:id` hoặc `/settings`.
- [x] Toàn bộ test suite web không có hồi quy, typecheck và build sạch 0 lỗi.

---

## 5. Kết quả (Worker điền sau khi hoàn thành)

- **Ngày hoàn thành:** 2026-11-07
- **Người thực hiện:** Gemini (Orca worker `task_50828ff53a35`)
- **Base SHA:** `81d139580d19641bfdf7b3eebe8b11c97a8ec9ec`
- **Worktree:** `C:/Users/Admin/orca/workspaces/ATI_Project/feat-planora-pl-08`
- **Nhánh:** `longnguyen005/feat-planora-pl-08`
- **Target branch:** `codex/planora-ui`

### Các thay đổi chính:
1. **ConnectionCallbackFrame (`apps/chat-web/src/planora/layout/ConnectionCallbackFrame.tsx`):**
   - Tạo mới khung layout callback chung chuẩn editorial Planora, tái sử dụng cho 3 callback Google của PL-08 và sẵn sàng mở rộng cho Trello/GitHub/Slack/Jira trong PL-09/10.
   - Trình bày thương hiệu Planora (Monogram P, tiêu đề serif, status badge, loading indicator, và cụm nút CTA tiếp tục công việc).
   - Presentation-only: không can thiệp, không tiêu thụ và không mutate OAuth state hay code exchange.
   - Đảm bảo 100% SVG vector icons có `aria-hidden="true"`, min tap target 44px, nút primary dùng token `var(--planora-on-primary)` chuẩn WCAG AA.

2. **Google Callback Views (`GmailCallbackView.tsx`, `MyCalendarCallbackView.tsx`, `MySheetsCallbackView.tsx`):**
   - Tích hợp `ConnectionCallbackFrame`, hiển thị giao diện editorial Planora nhất quán.
   - Bảo toàn 100% state machine:
     - `GmailCallbackView`: trao đổi authorization code lấy personal token, xử lý lỗi `access_denied`, `invalid_grant`, tự động navigate theo `returnTo` hoặc fallback `/settings`.
     - `MyCalendarCallbackView`: tải danh sách lịch, chọn calendar scope (`calendarId`), chọn primary calendar, lưu scope an toàn.
     - `MySheetsCallbackView`: quản lý Google Sheets selection, FakeSheetsPicker fallback khi không có Google Picker script, quản lý danh sách spreadsheet IDs, giới hạn dung lượng spreadsheet.

3. **Cài đặt kết nối cá nhân (`PersonalGmail.tsx`, `PersonalMyCalendar.tsx`, `PersonalMySheets.tsx`):**
   - Thiết kế lại theo tiêu chuẩn Business-First UX v2.0: giải thích giá trị công việc và mức sẵn sàng (chọn tài khoản, lịch làm việc, bảng tính quản lý) thay vì phơi bày thông số OAuth scope kỹ thuật.
   - Bảo toàn 100% anchors `#gmail`, `#mycalendar`, `#mysheets`.
   - Giữ nguyên các disclaimer pháp lý và quyền riêng tư theo tiêu chuẩn an toàn dữ liệu.

4. **Trang Cài đặt Planora (`SettingsPage.tsx`):**
   - Refactor toàn diện giao diện sang CSS tokens Planora, phân nhóm rành mạch: "Của riêng bạn" (Tài khoản cá nhân OAuth 1-Click) và "Dùng chung tổ chức" (Khoá dịch vụ tích hợp toàn workspace).
   - Đếm dịch vụ từ dữ liệu danh mục thực tế (`{configured.length} / {totalServices}`) thay vì hardcode "8 dịch vụ".
   - Bảo toàn drawer điều hướng, bẫy tiêu điểm (focus trap), phím tắt bàn phím (Escape), kiểm tra kết nối với timeout thực tế.

5. **Bộ kiểm thử & Kiểm chứng hồi quy:**
   - Tạo mới `apps/chat-web/tests/planora-pl-08-connections.test.tsx` (6 tests) kiểm thử toàn diện:
     - Khung `ConnectionCallbackFrame` presentation-only, Monogram P, serif title, status badge, loading, error role=alert.
     - Kiểm tra `aria-hidden="true"` trên 100% SVG vector icons.
     - Kiểm tra đếm dịch vụ động từ dữ liệu API.
     - Bảo toàn các technical anchors `#gmail`, `#mycalendar`, `#mysheets`.
     - Kiểm tra ngôn ngữ hướng nghiệp vụ, không dùng thuật ngữ OAuth trần.
   - Cập nhật assertions tương ứng trong `fe-07-settings.test.tsx` và `workflow-flow-canvas.test.tsx` để chấp nhận đếm dịch vụ động.

### Giải quyết các phát hiện review (Review Findings F1-F4 & P3-1) - 07/11/2026:
1. **[F1 — P2] Chuẩn tương phản WCAG AA & Token nút Primary CTA:**
   - Đã chuyển toàn bộ các nút primary action trong `PersonalGmail.tsx:9-10`, `PersonalMyCalendar.tsx:9-10`, `PersonalMySheets.tsx:9-10`, nút lưu `#btn-save-service-changes` tại `SettingsPage.tsx:904`, và nút xác nhận ngắt kết nối tại `PersonalMySheets.tsx:311` sang CSS token chuẩn Planora `bg-[var(--planora-primary)] text-[var(--planora-on-primary)] hover:bg-[var(--planora-primary-hover)]`.
   - Loại bỏ hoàn toàn nền cam `#FF5701`, đạt tỷ lệ tương phản >= 4.5:1 (7.80:1 Light / 7.91:1 Dark).
   - Cập nhật test assertion màu cam cũ tại `apps/chat-web/tests/gmail-review-fixes.test.tsx:100` và `apps/chat-web/tests/browser/gmail-03.spec.ts:29`.

2. **[F2 — P2] Khắc phục biến CSS không tồn tại `--planora-border`:**
   - Thay thế toàn bộ 29 vị trí sử dụng `--planora-border`:
     - Trên các phần tử tương tác (`input`, `textarea`, `checkbox`, `button` phụ): dùng `border-[var(--planora-border-strong)]` đạt WCAG 1.4.11 >= 3.0:1.
     - Trên các thẻ card, context pill, khung phân cách, danh sách rỗng: dùng `border-[var(--planora-divider)]`.

3. **[F3 — P2] Loại bỏ triệt để chuỗi "ATI" và emoji trần `👤`/`🏢`:**
   - Thay đổi copy `"ATI chỉ đọc và ghi..."` / `"ATI chỉ thấy..."` thành `"Planora chỉ đọc và ghi..."` / `"Planora chỉ thấy..."` tại `SettingsPage.tsx:801`, `PersonalMySheets.tsx:125`, `MySheetsCallbackView.tsx:293`.
   - Cập nhật `Settings/meta.ts:5` sang `"Kết nối dịch vụ — Planora"`.
   - Cập nhật `apps/chat-web/src/pages/Settings/page.css` sang các CSS tokens `--planora-canvas`, `--planora-text`, `--planora-primary`.
   - Thay emoji `👤` và `🏢` tại context pill bằng vector SVG icons chuẩn có thuộc tính `aria-hidden="true"`.
   - Cập nhật matcher trong `tests/browser/mysheets.spec.ts`, `tests/components/service-naming.test.tsx`, `tests/mysheets-ui.test.tsx` và `tests/planora-pl-08-connections.test.tsx`.

4. **[F4 — P2] Loại bỏ lồng trùng khung lỗi và nút quay về Cài đặt trùng lặp:**
   - Trong `MyCalendarCallbackView.tsx` và `MySheetsCallbackView.tsx`: loại bỏ lớp bọc `<div className="p-4 rounded-xl bg-red-50 border border-red-200 ...">` dư thừa, sử dụng trực tiếp khung `--planora-error-*` của `ConnectionCallbackFrame`.
   - Loại bỏ trùng lặp nút quay về:
     - `GmailCallbackView`: bỏ prop `actions` dư thừa, chỉ dùng `onBackToSettings`.
     - `MyCalendarCallbackView` & `MySheetsCallbackView`: chỉ truyền `onBackToSettings` khi `error` xuất hiện; ở trạng thái chọn tài nguyên (`!error`), chỉ dùng nút "Để sau (về trang Cài đặt)" trong form. Bảo đảm duy nhất 1 return action cho mỗi trạng thái.

5. **[P3-1 — P3] Chặn đóng modal ngắt kết nối khi đang xử lý request:**
   - Bổ sung guard `onClose={() => { if (!busy) setConfirm(false); }}` trong `PersonalMySheets.tsx:293`.

### Bằng chứng Kiểm thử Thực tế:

| Lệnh kiểm thử | Kết quả | Ghi chú |
|---|---|---|
| `npm run typecheck:v3` | **PASS (exit code 0)** | Chat API & Chat Web 0 lỗi TypeScript |
| `npm test -w @wap/chat-web -- fe-07-settings gmail mycalendar mysheets planora-pl-08-connections workflow-flow-canvas` | **PASS (exit code 0)** | 11 test files, 169/169 tests passed |
| `npm test -w @wap/chat-web` | **PASS (exit code 0)** | Toàn bộ 103 test files, 1174/1174 tests passed |
| `npm run build:v3` | **PASS (exit code 0)** | Vite production build thành công (HTML, CSS, JS bundle) |
| `node scripts/test-v3-web-build-security.mjs` | **PASS (exit code 0)** | Loại trừ credential sentinels và 7 UI claims bị cấm |
