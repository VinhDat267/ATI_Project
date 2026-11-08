# Báo cáo Review Độc lập — PL-08 (Cài đặt kết nối, Gmail, Google Calendar và Google Sheets theo Design Brief v2.0 & Business-First UX)

- **Reviewer:** Antigravity / Gemini 4 Argon (High); model ID `gemini-4-argon-high`
- **Ngày review:** 05/11/2026 (thực chạy 07/11/2026)
- **Task:** [PL-08 · Cài đặt kết nối, Gmail, Google Calendar và Google Sheets (Google Connections)](../tasks/PL-08-planora-google-connections.md)
- **UX Authority:** [`docs/superpowers/specs/2026-11-05-planora-design-brief.md`](../../superpowers/specs/2026-11-05-planora-design-brief.md) & [`docs/superpowers/specs/2026-11-05-planora-business-first-ux.md`](../../superpowers/specs/2026-11-05-planora-business-first-ux.md)
- **PR_URL hoặc LOCAL_ONLY:** `LOCAL_ONLY`
- **Target Branch:** `longnguyen005/feat-planora-pl-08` (target tích hợp: `codex/planora-ui`)
- **Base SHA:** `81d139580d19641bfdf7b3eebe8b11c97a8ec9ec`
- **Reviewed Head SHA:** `76ebeedba79970834fe9d3b2dd69f0276612e740`
- **Worktree review:** `C:\Users\Admin\orca\workspaces\ATI_Project\review-planora-pl-08` (branch `longnguyen005/review-planora-pl-08`)
- **Orca Worker / Coordinator:** `term_b3483912-ba99-431a-8fd2-fd6638d75fc8` / `term_2d35bb18-7746-41a6-83b0-2669aeb86776` (`task_eaa3df331ed4`, `ctx_325636cc193c`)

---

## 1. Xác minh Git, Head SHA & Phạm vi File

- `git rev-parse HEAD` và `git rev-parse longnguyen005/feat-planora-pl-08` đều khớp chính xác SHA 40 ký tự: `76ebeedba79970834fe9d3b2dd69f0276612e740`.
- `git merge-base 81d139580d19641bfdf7b3eebe8b11c97a8ec9ec 76ebeedba79970834fe9d3b2dd69f0276612e740` = `81d139580d19641bfdf7b3eebe8b11c97a8ec9ec`.
- Diff của PL-08 (`81d139580d19641bfdf7b3eebe8b11c97a8ec9ec..76ebeedba79970834fe9d3b2dd69f0276612e740`) gồm 13 files (`+717 / -269`):
  1. `apps/chat-web/src/planora/layout/ConnectionCallbackFrame.tsx` *(tạo mới)*
  2. `apps/chat-web/src/pages/Settings/SettingsPage.tsx`
  3. `apps/chat-web/src/pages/Settings/PersonalGmail.tsx`
  4. `apps/chat-web/src/pages/Settings/PersonalMyCalendar.tsx`
  5. `apps/chat-web/src/pages/Settings/PersonalMySheets.tsx`
  6. `apps/chat-web/src/views/GmailCallbackView.tsx`
  7. `apps/chat-web/src/views/MyCalendarCallbackView.tsx`
  8. `apps/chat-web/src/views/MySheetsCallbackView.tsx`
  9. `apps/chat-web/tests/planora-pl-08-connections.test.tsx` *(tạo mới)*
  10. `apps/chat-web/tests/fe-07-settings.test.tsx`
  11. `apps/chat-web/tests/workflow-flow-canvas.test.tsx`
  12. `docs/handoff/tasks/PL-08-planora-google-connections.md`
  13. `docs/handoff/log/2026-11-07-gemini-pl-08.md`
- Không có thay đổi trái phép sang `apps/chat-api`, `packages/*`, `db/v3`, `prompts`, `evaluations`, `CURRENT-STATE.md` hay `ROADMAP.md`.

---

## 2. Kiểm tra Trọng tâm Kỹ thuật & Nghiệp vụ (Behavior & Technical)

### 2.1. Các hạng mục kỹ thuật & nghiệp vụ ĐẠT
1. **Phân nhóm trang Cài đặt (`SettingsPage.tsx:319-522`):**
   - Phân tách rõ 2 khu vực nghiệp vụ: **"Của riêng bạn"** (`Tài khoản cá nhân OAuth`: Gmail, Google Calendar, Google Sheets) và **"Dùng chung tổ chức"** (`Khóa dịch vụ tích hợp cho toàn nhóm`: разделяется thành `Đã sẵn sàng hoạt động` và `Chưa thiết lập`).
   - Bảo toàn hoàn toàn logic `useSettings()`, capability `canConfigure` từ server (fail-closed khi `undefined` hoặc `false`), cô lập state theo user/workspace, deep-link hash (`#trello`, `#slack`, `#jira`, ...), focus trap hai chiều `Tab` / `Shift+Tab`, khôi phục focus khi đóng drawer bằng `Escape`, và timeout `AbortController` 10 giây khi kiểm tra kết nối.
2. **Đếm số lượng dịch vụ động từ dữ liệu API thực tế (`SettingsPage.tsx:266, 314`):**
   - Tính `const totalServices = catalogue.length;` và hiển thị `{configured.length} / {totalServices} dịch vụ đã thiết lập · {okCount} kết nối tốt`, không hardcode `"8 dịch vụ"`.
3. **Khung `ConnectionCallbackFrame` (`ConnectionCallbackFrame.tsx:1-291`):**
   - Component thuần trình bày (presentation-only): hiển thị Monogram `P` của Planora, tiêu đề serif (`font-serif`), huy hiệu trạng thái (`connecting`, `selecting`, `ready`, `error`), vector icon dịch vụ (`gmail`, `mycalendar`, `mysheets`, `generic`), spinner trạng thái chờ và vùng thông báo lỗi.
   - Không đọc/ghi `window.location`, `window.history`, `localStorage`, `sessionStorage` và không gọi API khi render.
4. **Bảo toàn State Machine trong 3 Views Callback (`GmailCallbackView.tsx`, `MyCalendarCallbackView.tsx`, `MySheetsCallbackView.tsx`):**
   - Giữ nguyên single-use `code`/`state` exchange (`exchanged.current` / `completedKey.current`), `sessionEpoch` guard chống phản hồi trễ sau khi đổi phiên, luồng chọn lịch Google Calendar (kể cả lối tắt `"Chỉ dùng lịch chính"`), luồng chọn bảng tính Google Sheets qua Google Picker / dán link / nhập mã, và điều hướng `returnTo` an toàn.
5. **Bảo toàn Anchors & Google Picker Iframe:**
   - Giữ nguyên `id="gmail"` (`PersonalGmail.tsx:86`), `id="mycalendar"` (`PersonalMyCalendar.tsx:182`), `id="mysheets"` (`PersonalMySheets.tsx:110`).
   - Giữ nguyên `<div className="sr-only" aria-live="polite" role="status">{announcement}</div>` tại đầu `SettingsPage.tsx:293`.
   - Không can thiệp vào DOM/iframe Google Picker do Google sở hữu (`googlePicker.ts`).

---

## 3. Kết quả Chạy Lệnh Kiểm thử & Kiểm chứng Mutation

### 3.1. Bảng lệnh kiểm thử thực tế tại worktree review (`review-planora-pl-08`)

| Lệnh kiểm thử | Exit Code | Kết quả | Chi tiết |
| :--- | :---: | :---: | :--- |
| `npm run typecheck:v3` | `0` | **PASS** | `tsc -p apps/chat-api/tsconfig.json --noEmit && tsc -p apps/chat-web/tsconfig.json --noEmit` (0 lỗi) |
| `npm test -w @wap/chat-web -- fe-07-settings gmail mycalendar mysheets planora-pl-08-connections workflow-flow-canvas` | `0` | **PASS** | `11 passed (11)` test files, `164 passed (164)` tests |
| `npm test -w @wap/chat-web` | `0` | **PASS** | `103 passed (103)` test files, `1169 passed (1169)` tests (`42.97s`) |
| `npm run build:v3` | `0` | **PASS** | Vite production build thành công (`202 modules transformed`, `dist/assets/index-CEuI9iV3.css`, `dist/assets/index-C0cB8-p0.js`) |
| `node scripts/test-v3-web-build-security.mjs` | `0` | **PASS** | `PASS: production build excludes credential sentinels and 7 forbidden UI claims` |
| Browser E2E (`fe-07-settings.spec.ts`, `gmail-03.spec.ts`, `mycalendar.spec.ts`, `mysheets.spec.ts`) | `NOT_RUN` | **NOT_RUN** | Không chạy live PostgreSQL 16 sandbox trong phiên review này; đã đối chiếu trực tiếp mã nguồn spec với DOM/locator và phát hiện 2 điểm lệch selector tại `gmail-03.spec.ts:29` và `mysheets.spec.ts:61,109,158,222,234,259,324` (xem Findings F1 & F3) |

### 3.2. Kiểm chứng Mutation / Regression thực tế (Chống Mock Ảo giác)

Thực hiện kiểm chứng đột biến (mutation) tạm thời trên `apps/chat-web/src/pages/Settings/SettingsPage.tsx` và `apps/chat-web/src/planora/layout/ConnectionCallbackFrame.tsx` trong worktree review:
1. **Mutation M1 (`SettingsPage.tsx:314`):** Thay `{configured.length} / {totalServices} dịch vụ đã thiết lập` bằng chuỗi tĩnh `{configured.length} / 8 dịch vụ đã thiết lập`.
   - Chạy `npm test -w @wap/chat-web -- tests/planora-pl-08-connections.test.tsx` -> **FAIL (exit code 1)**:
     `FAIL counts services dynamically from server catalogue data instead of hardcoding 8 services — Unable to find an element with the text: 1 / 3 dịch vụ đã thiết lập · 1 kết nối tốt`.
2. **Mutation M2 (`ConnectionCallbackFrame.tsx`):** Bỏ thuộc tính `aria-hidden="true"` trên các thẻ `<svg>` trong `ConnectionCallbackFrame.tsx`.
   - Chạy `npm test -w @wap/chat-web -- tests/planora-pl-08-connections.test.tsx` -> **FAIL (exit code 1)**:
     `FAIL enforces aria-hidden="true" on 100% of SVG vector icons for a11y compliance — Expected the element to have attribute: aria-hidden="true", Received: null`.
3. **Khôi phục code gốc & xác nhận GREEN:**
   - Khôi phục bằng `git checkout -- apps/chat-web/src/pages/Settings/SettingsPage.tsx apps/chat-web/src/planora/layout/ConnectionCallbackFrame.tsx`, kiểm tra `git diff --exit-code` = `0` và chạy lại `npm test -w @wap/chat-web -- tests/planora-pl-08-connections.test.tsx` -> **PASS 6/6 tests (exit code 0)**.

---

## 4. Findings theo Design Brief v2.0 & Business-First UX (Cần sửa trước khi nghiệm thu)

Đối chiếu với chuẩn bắt buộc tại [`docs/superpowers/specs/2026-11-05-planora-design-brief.md`](../../superpowers/specs/2026-11-05-planora-design-brief.md), [`docs/superpowers/specs/2026-11-05-planora-business-first-ux.md`](../../superpowers/specs/2026-11-05-planora-business-first-ux.md) và card [`PL-08-planora-google-connections.md`](../tasks/PL-08-planora-google-connections.md), bản triển khai tại `76ebeedb` còn **4 findings P2** và **1 finding P3**:

### [F1 — P2] Vi phạm chuẩn tương phản WCAG AA (GATE-03) và pha trộn nền cam Agentic cũ (`#FF5701`) với token chữ Planora (`--planora-on-primary`) trên các nút Primary CTA
- **Vị trí:**
  - `apps/chat-web/src/pages/Settings/PersonalGmail.tsx:9-10`
  - `apps/chat-web/src/pages/Settings/PersonalMyCalendar.tsx:9-10`
  - `apps/chat-web/src/pages/Settings/PersonalMySheets.tsx:9-10`
  - `apps/chat-web/src/pages/Settings/SettingsPage.tsx:904` (`#btn-save-service-changes`)
  - `apps/chat-web/src/pages/Settings/PersonalMySheets.tsx:311` (nút xác nhận ngắt kết nối)
- **Trigger:**
  - Hiển thị các nút hành động chính trên thẻ Gmail (`"Kết nối Gmail"`), Google Calendar (`"Kết nối Google Calendar"`, `"Chọn lịch làm việc"`, `"Lưu lịch đã chọn"`), Google Sheets (`"Kết nối Google Sheets"`, `"Chọn bảng tính"`, `"Thay đổi bảng tính"`, `"Thử lại"`) và nút `"Lưu thay đổi"` (`#btn-save-service-changes`) trong ngăn kéo cấu hình dịch vụ ở cả Light mode và Dark mode.
- **Tác động & Bằng chứng:**
  - Các nút primary hiện giữ màu nền cam Agentic cũ `bg-[#FF5701] hover:bg-[#E04C00]` (hoặc `hover:bg-[#e04d01]`) nhưng lại ghép với màu chữ `text-[var(--planora-on-primary,#FFFFFF)]`.
  - Ở **Light mode**, `--planora-on-primary` có giá trị `#fffdf7` (`tokens.css:20`, luminance `0.9863`) trên nền `#FF5701` (luminance `0.2808`), chỉ đạt tỷ lệ tương phản **3.13:1** (kể cả với `#FFFFFF` cũng chỉ đạt **3.17:1**) — **không đạt ngưỡng tối thiểu WCAG AA 4.5:1** cho cỡ chữ `text-xs` (`12px`) / `text-sm` (`14px`), vi phạm trực tiếp **GATE-03** của Design Brief v2.0 và Mục 1.5 / Mục 5 của task card PL-08.
  - Ở **Dark mode**, `--planora-on-primary` có giá trị `#132014` (`tokens.css:122`, chữ xanh đen đậm) đặt trên nền cam `#FF5701`, làm lệch bảng màu xanh rừng Planora (`--planora-primary`: `#3c5741` ở Light / `#8fb68e` ở Dark; đạt tương phản **7.80:1** Light / **7.91:1** Dark).
  - Ngoài ra, nút `"Xác nhận ngắt kết nối"` tại `PersonalMySheets.tsx:311` đang dùng `bg-red-600 text-white hover:bg-red-700` (dùng `text-white` cứng ở cả Dark mode, không đồng bộ với `PersonalGmail.tsx:266` và `PersonalMyCalendar.tsx:390` hoặc token semantic error của Planora).
- **Cách sửa:**
  - Chuyển các nút primary trong `PersonalGmail.tsx:9-10`, `PersonalMyCalendar.tsx:9-10`, `PersonalMySheets.tsx:9-10` và `#btn-save-service-changes` tại `SettingsPage.tsx:904` sang token chuẩn Planora: `bg-[var(--planora-primary)] text-[var(--planora-on-primary)] hover:bg-[var(--planora-primary-hover)]`.
  - Đồng bộ nút `"Xác nhận ngắt kết nối"` tại `PersonalMySheets.tsx:311` sang token chuẩn Planora (hoặc semantic error `bg-[var(--planora-error-bg)] text-[var(--planora-error-text)] border border-[var(--planora-error-border)]` đạt 5.55:1 Light / 8.42:1 Dark).
  - Cập nhật có chủ đích assertion màu cam cũ tại `apps/chat-web/tests/gmail-review-fixes.test.tsx:100` và `apps/chat-web/tests/browser/gmail-03.spec.ts:29` sang token màu primary của Planora theo hướng dẫn tại Mục 3 của task card PL-08.

---

### [F2 — P2] Sử dụng biến CSS không tồn tại `--planora-border` (29 vị trí) làm mất màu viền thẻ, nút phụ và ô nhập liệu (vi phạm WCAG 1.4.11 ≥ 3:1)
- **Vị trí:**
  - `apps/chat-web/src/pages/Settings/SettingsPage.tsx:102, 299, 334, 477, 514, 579, 679, 752, 767, 813, 862, 872, 887, 941` (14 vị trí)
  - `apps/chat-web/src/pages/Settings/PersonalGmail.tsx:12, 88` (2 vị trí)
  - `apps/chat-web/src/pages/Settings/PersonalMyCalendar.tsx:12, 184, 430, 442` (4 vị trí)
  - `apps/chat-web/src/pages/Settings/PersonalMySheets.tsx:12, 112` (2 vị trí)
  - `apps/chat-web/src/views/MyCalendarCallbackView.tsx:262, 310, 331` (3 vị trí)
  - `apps/chat-web/src/views/MySheetsCallbackView.tsx:302, 328, 334, 439` (4 vị trí)
- **Trigger:**
  - Mở trang `/settings` (thẻ dịch vụ, nút phụ, ngăn kéo cấu hình, ô nhập khóa API/phạm vi) hoặc các trang callback `/oauth/mycalendar/callback`, `/oauth/mysheets/callback`.
- **Tác động & Bằng chứng:**
  - Kiểm tra toàn bộ `apps/chat-web/src/planora/styles/tokens.css` (và `git grep "planora-border" apps/chat-web/src/`): hệ thống token chỉ định nghĩa `--planora-divider` (`#deded0` Light / `#394638` Dark) và `--planora-border-strong` (`#c2c2b0` Light / `#4e5e4d` Dark), **hoàn toàn không định nghĩa `--planora-border`**.
  - Do `border-[var(--planora-border)]` không có giá trị fallback, trình duyệt giải nghĩa `border-color` thành không hợp lệ/trong suốt, làm mất viền của toàn bộ các ô `input`/`textarea` nhập khóa dịch vụ, phạm vi, URL bảng tính, checkbox chọn lịch và các nút phụ (`secondaryButton`), vi phạm yêu cầu tương phản thành phần tương tác **WCAG 1.4.11 ≥ 3.0:1** tại Mục I.1 (dòng 33-34) của Design Brief v2.0.
- **Cách sửa:**
  - Thay `border-[var(--planora-border)]` trên các thành phần tương tác (`input`, `textarea`, `checkbox`, nút bấm phụ) bằng `border-[var(--planora-border-strong)]` và trên các khung/thẻ phân cách bằng `border-[var(--planora-divider)]` (hoặc `border-[var(--planora-border-strong)]` nhất quán như `PlanoraWorkflowSteps.tsx` và `ClarificationMoment.tsx`).

---

### [F3 — P2] Còn sót thương hiệu cũ `"ATI"`, ký tự emoji trần (`👤` / `🏢`) trên `SettingsPage` và lệch selector tiêu đề E2E trong `MySheetsCallbackView` (vi phạm GATE-04 & Iconography MẪU 2)
- **Vị trí:**
  - `apps/chat-web/src/pages/Settings/SettingsPage.tsx:300` (emoji trần `👤` / `🏢`)
  - `apps/chat-web/src/pages/Settings/SettingsPage.tsx:801` (copy `"ATI chỉ đọc và ghi..."`)
  - `apps/chat-web/src/pages/Settings/PersonalMySheets.tsx:125` (copy `"ATI chỉ thấy... ATI đọc các ô..."`)
  - `apps/chat-web/src/views/MySheetsCallbackView.tsx:257, 293` (trộn lẫn `"ATI"` và `"Planora"`; đổi heading làm lệch `tests/browser/mysheets.spec.ts`)
  - `apps/chat-web/src/pages/Settings/meta.ts:5` (`title: "Kết nối dịch vụ — ATI"`)
  - `apps/chat-web/src/pages/Settings/page.css:10-25` (màu nền `#F8F8F6` và focus ring cam `#FF5701` cũ)
- **Trigger:**
  - Mở `/settings`, mở ngăn kéo cấu hình dịch vụ có phạm vi, xem thẻ Google Sheets, hoặc mở `/oauth/mysheets/callback`.
- **Tác động & Bằng chứng:**
  - **GATE-04** của Design Brief v2.0 quy định: *"Quét chuỗi trên DOM: Không chứa bất kỳ từ khóa nào trong danh sách: ... `ATI`"*. Hiện tại vẫn còn 4 nơi hiển thị `"ATI"`:
    1. `SettingsPage.tsx:801`: `` `ATI chỉ đọc và ghi ở những ${scopeLabel ?? ...} trong danh sách này.` `` (nằm ngay dưới tiêu đề `Nơi Planora được phép dùng`).
    2. `PersonalMySheets.tsx:125`: `"ATI chỉ thấy những bảng tính bạn chọn trong cửa sổ của Google. ATI đọc các ô và thêm dòng mới vào cuối bảng đã chọn; không sửa hay xóa dữ liệu có sẵn."`
    3. `MySheetsCallbackView.tsx:293`: `"ATI chỉ thấy những bảng tính bạn chọn trong cửa sổ của Google. Planora đọc các ô và thêm dòng mới..."` (câu đầu gọi là `ATI`, câu sau gọi là `Planora`).
    4. `Settings/meta.ts:5`: `title: "Kết nối dịch vụ — ATI"`.
  - **Chuẩn Iconography (Design Brief v2.0 Mục II MẪU 2, dòng 128):** *"Tuyệt đối dùng icon SVG vector chính thức `aria-hidden="true"`, không dùng ký tự emoji"*. Tại `SettingsPage.tsx:300`, huy hiệu không gian làm việc vẫn render raw emoji `<span aria-hidden="true">{workspace.id === 'personal' ? '👤' : '🏢'}</span>`.
  - **Đồng bộ E2E Browser Spec:** `MySheetsCallbackView.tsx:257` đổi tiêu đề `<h1>` sang `"Chọn bảng tính cho Planora"`, trong khi `apps/chat-web/tests/browser/mysheets.spec.ts` (dòng 61, 109, 158, 222, 234, 259, 324) vẫn tìm `getByRole('heading', { name: /Chọn bảng tính cho ATI/i })` và `getByText(/ATI chỉ thấy những bảng tính bạn chọn/i)`.
- **Cách sửa:**
  - Thay toàn bộ chuỗi `"ATI"` tại `SettingsPage.tsx:801`, `PersonalMySheets.tsx:125`, `MySheetsCallbackView.tsx:293`, `Settings/meta.ts:5` sang `"Planora"`; đồng thời cập nhật biểu thức chính quy trong `apps/chat-web/tests/browser/mysheets.spec.ts` (nếu nằm trong phạm vi cập nhật test của PL-08) sang `/Chọn bảng tính cho Planora/i` và `/Planora chỉ thấy những bảng tính bạn chọn/i`.
  - Thay ký tự emoji `👤` / `🏢` tại `SettingsPage.tsx:300` bằng vector SVG icon có `aria-hidden="true"`.
  - Cập nhật `apps/chat-web/src/pages/Settings/page.css` dùng biến `--planora-canvas`, `--planora-text` và focus outline `--planora-primary` thay cho `#F8F8F6` / `#FF5701`.

---

### [F4 — P2] Lồng trùng 2 khung lỗi (`error`) không hỗ trợ Dark mode và hiển thị lặp 2 nút quay về Cài đặt trong các màn Callback (`GmailCallbackView`, `MyCalendarCallbackView`, `MySheetsCallbackView`)
- **Vị trí:**
  - `apps/chat-web/src/planora/layout/ConnectionCallbackFrame.tsx:257-281`
  - `apps/chat-web/src/views/GmailCallbackView.tsx:92-107`
  - `apps/chat-web/src/views/MyCalendarCallbackView.tsx:220-235, 327-335`
  - `apps/chat-web/src/views/MySheetsCallbackView.tsx:271-286, 435-443`
- **Trigger:**
  - Khi OAuth callback của Gmail, Google Calendar hoặc Google Sheets rơi vào trạng thái lỗi (`error !== null`) hoặc trạng thái chọn tài nguyên (`selecting`).
- **Tác động & Bằng chứng:**
  - `ConnectionCallbackFrame.tsx:257-261` đã bọc sẵn prop `error` trong hộp cảnh báo lỗi chuẩn token Planora: `<div className="p-4 rounded-xl bg-[var(--planora-error-bg,#FEF2F2)] border border-[var(--planora-error-border,#FECACA)] text-sm text-[var(--planora-error-text,#DC2626)]">`.
  - Tuy nhiên, `MyCalendarCallbackView.tsx:220-235` và `MySheetsCallbackView.tsx:271-286` lại truyền vào prop `error` một thẻ `<div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-[#DC2626] v3-space-y-3">` nữa. Kết quả là sinh ra **2 khung lỗi lồng nhau** (2 lớp padding `p-4`, 2 lớp viền), và khung bên trong dùng màu cứng `bg-red-50 border-red-200 text-[#DC2626]` gây chói ở Dark mode.
  - Ngoài ra, cả 3 view đều truyền `onBackToSettings={() => navigate('/settings', true)}` cho `ConnectionCallbackFrame` (khiến footer của frame tự render một nút `<button>Về Kết nối dịch vụ</button>` tại dòng 273), nhưng đồng thời lại truyền thêm một link/button `"Về Kết nối dịch vụ"` hoặc `"Về trang Cài đặt"` trong `actions`, `error`, hoặc `children` (`GmailCallbackView.tsx:98-103`, `MyCalendarCallbackView.tsx:225-233, 327-335`, `MySheetsCallbackView.tsx:276-284, 435-443`), khiến người dùng nhìn thấy **2 nút quay về Cài đặt đứng sát nhau** trong cùng một thẻ card.
- **Cách sửa:**
  - Trong `MyCalendarCallbackView.tsx` và `MySheetsCallbackView.tsx`, bỏ lớp `<div className="p-4 rounded-xl bg-red-50 border border-red-200 ...">` dư thừa khi truyền vào prop `error` của `ConnectionCallbackFrame` để sử dụng trực tiếp khung `--planora-error-*` của `ConnectionCallbackFrame` (đạt tương phản chuẩn ở cả Light và Dark mode).
  - Không truyền trùng cả `onBackToSettings` lẫn nút/link `"Về Kết nối dịch vụ"` / `"Về trang Cài đặt"` thủ công ở cùng một trạng thái; chỉ giữ đúng 1 nút/link quay về trang cài đặt cho mỗi trạng thái (bảo toàn đúng phần tử `<a href="/settings">` hoặc `<button>` mà các bài test `gmail-callback.test.tsx`, `mycalendar-ui.test.tsx`, `mysheets-ui.test.tsx` đang assert).

---

### [P3-1 — P3] Hộp thoại xác nhận ngắt kết nối trong `PersonalMySheets.tsx` chưa chặn `onClose` khi đang xử lý (`busy`)
- **Vị trí:** `apps/chat-web/src/pages/Settings/PersonalMySheets.tsx:293`
- **Trigger:** Bấm `Escape` hoặc bấm nền ngoài khi request `disconnectMySheets()` đang thực thi (`busy === true`).
- **Tác động:** Khác với `PersonalGmail.tsx:249` và `PersonalMyCalendar.tsx:373` đều có guard `onClose={() => { if (!busy) setConfirm(false); }}`, `PersonalMySheets.tsx:293` viết `onClose={() => setConfirm(false)}` không kiểm tra `!busy`.
- **Cách sửa:** Sửa thành `onClose={() => { if (!busy) setConfirm(false); }}`.

---

## 5. Đánh giá Tổng hợp & Kết luận (Verdict)

- **Đánh giá Behavior & Technical:** **PASS** (103/103 test files, 1169/1169 unit/integration tests PASS; typecheck, production build và security check đều PASS; bảo toàn state machine OAuth, single-use exchange, `returnTo`, anchors `#gmail`/`#mycalendar`/`#mysheets` và Google Picker iframe).
- **Đánh giá UX Gate 05/11 (Business-First & Design Brief v2.0):** **CHƯA ĐẠT** (Còn 4 findings P2 `F1`–`F4` và 1 finding P3 `P3-1` về độ tương phản WCAG AA trên nút primary, biến CSS `--planora-border` không tồn tại, sót chữ `"ATI"` + emoji trần `👤`/`🏢`, và lồng khung lỗi/lặp nút ở các màn Callback).
- **Overall Verdict:** **Chưa đạt**
