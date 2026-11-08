# 2026-11-07 · gemini · PL-08 · Khắc phục toàn diện Review Findings F1-F4 & P3-1

- **Nhiệm vụ:** [PL-08 · Cài đặt kết nối, Gmail, Google Calendar và Google Sheets](../tasks/PL-08-planora-google-connections.md)
- **Báo cáo Review đối chiếu:** [2026-11-05-argon-review-pl-08.md](2026-11-05-argon-review-pl-08.md)
- **Worktree:** `C:/Users/Admin/orca/workspaces/ATI_Project/feat-planora-pl-08`
- **Nhánh:** `longnguyen005/feat-planora-pl-08`
- **Target branch:** `codex/planora-ui`
- **Base SHA:** `81d139580d19641bfdf7b3eebe8b11c97a8ec9ec`
- **Orca Task ID:** `task_58de2e2c52a9` (Dispatch `ctx_63ceb861ac5a`)

---

## 1. Mục tiêu & Bối cảnh

Khắc phục triệt để 4 findings P2 (F1–F4) và 1 finding P3 (P3-1) được chỉ ra trong báo cáo review độc lập của Argon High:
1. **[F1 — P2] Chuẩn tương phản WCAG AA & Token nút Primary CTA:** Chuyển tất cả nút primary và nút xác nhận ngắt kết nối sang `bg-[var(--planora-primary)] text-[var(--planora-on-primary)] hover:bg-[var(--planora-primary-hover)]`. Loại bỏ hoàn toàn nền cam cũ `#FF5701`, bảo đảm tương phản >= 4.5:1 (7.80:1 Light / 7.91:1 Dark).
2. **[F2 — P2] Khắc phục biến CSS không tồn tại `--planora-border`:** Thay thế 29 vị trí dùng `--planora-border` bằng `--planora-border-strong` (thành phần tương tác: input, textarea, checkbox, button) và `--planora-divider` (thành phần cấu trúc: card, pill, container), bảo đảm WCAG 1.4.11 >= 3.0:1.
3. **[F3 — P2] Loại bỏ triệt để chuỗi "ATI" và emoji trần `👤`/`🏢`:** Chuyển các copy `"ATI chỉ đọc và ghi..."` / `"ATI chỉ thấy..."` sang `"Planora..."`, cập nhật `Settings/meta.ts` title sang `"Kết nối dịch vụ — Planora"`, cập nhật `page.css` sang token Planora, thay raw emoji bằng vector SVG icons có `aria-hidden="true"`.
4. **[F4 — P2] Loại bỏ lồng trùng khung lỗi và nút quay về Cài đặt trùng lặp:** Bỏ lớp `<div className="p-4 rounded-xl bg-red-50...">` trong `MyCalendarCallbackView` và `MySheetsCallbackView`, dùng trực tiếp khung `--planora-error-*` của `ConnectionCallbackFrame`. Loại bỏ nút quay về Cài đặt bị render 2 lần trong cùng một view/trạng thái.
5. **[P3-1 — P3] Chặn đóng modal ngắt kết nối khi đang xử lý request:** Thêm guard `if (!busy) setConfirm(false)` vào handler `onClose` của `PersonalMySheets.tsx`.

---

## 2. Chi tiết các tệp đã sửa đổi

1. **`apps/chat-web/src/pages/Settings/PersonalGmail.tsx`:**
   - Chuyển `button` sang `bg-[var(--planora-primary)] text-[var(--planora-on-primary)] hover:bg-[var(--planora-primary-hover)]`.
   - Chuyển `secondary` sang `border-[var(--planora-border-strong)]`, thẻ card sang `border-[var(--planora-divider)]`.

2. **`apps/chat-web/src/pages/Settings/PersonalMyCalendar.tsx`:**
   - Chuyển `button` sang token chuẩn Planora; `secondary` và checkbox sang `border-[var(--planora-border-strong)]`.
   - Chuyển thẻ card và calendar item label sang `border-[var(--planora-divider)]`.

3. **`apps/chat-web/src/pages/Settings/PersonalMySheets.tsx`:**
   - Chuyển `button` sang token chuẩn Planora; `secondary` sang `border-[var(--planora-border-strong)]`, thẻ card sang `border-[var(--planora-divider)]`.
   - Sửa copy dòng 125 từ `"ATI chỉ thấy..."` sang `"Planora chỉ thấy..."`.
   - Thêm guard `if (!busy) setConfirm(false)` tại dòng 293 (P3-1).
   - Nút xác nhận ngắt kết nối dòng 311 dùng `className={button}` đồng bộ.

4. **`apps/chat-web/src/pages/Settings/SettingsPage.tsx`:**
   - Thay emoji trần `👤`/`🏢` tại context pill bằng vector SVGs có `aria-hidden="true"`.
   - Thay thế toàn bộ 14 vị trí `--planora-border` bằng `--planora-divider` (thẻ, drawer, pill, container) và `--planora-border-strong` (input, textarea, button thêm scope, button kiểm tra kết nối).
   - Sửa copy dòng 801 từ `"ATI chỉ đọc và ghi..."` sang `"Planora chỉ đọc và ghi..."`.
   - Nút `#btn-save-service-changes` tại dòng 904 dùng `bg-[var(--planora-primary)] text-[var(--planora-on-primary)] hover:bg-[var(--planora-primary-hover)]`.

5. **`apps/chat-web/src/pages/Settings/meta.ts` & `page.css`:**
   - `meta.ts`: title `"Kết nối dịch vụ — Planora"`, bodyClass dùng `bg-[var(--planora-canvas,#F8F8F6)] text-[var(--planora-text,#111827)]`.
   - `page.css`: dùng các CSS tokens `--planora-canvas`, `--planora-paper`, `--planora-text`, `--planora-muted`, `--planora-divider`, `--planora-primary`.

6. **`apps/chat-web/src/views/GmailCallbackView.tsx`:**
   - Bỏ prop `actions` dư thừa, giữ lại duy nhất 1 button quay về Cài đặt qua `onBackToSettings` trong footer của `ConnectionCallbackFrame`.

7. **`apps/chat-web/src/views/MyCalendarCallbackView.tsx`:**
   - Bỏ lớp `<div className="p-4 rounded-xl bg-red-50 border border-red-200 ...">` lồng thừa trong prop `error`.
   - Chỉ truyền `onBackToSettings` khi có `error`. Khi ở trạng thái chọn lịch (`!error`), chỉ render duy nhất nút "Để sau (về trang Cài đặt)" trong form.
   - Thay thế các vị trí `--planora-border` bằng `--planora-border-strong`.

8. **`apps/chat-web/src/views/MySheetsCallbackView.tsx`:**
   - Sửa copy dòng 293 từ `"ATI chỉ thấy..."` sang `"Planora chỉ thấy..."`.
   - Bỏ lớp `<div className="p-4 rounded-xl bg-red-50 ...">` lồng thừa trong prop `error`.
   - Chỉ truyền `onBackToSettings` khi có `error`. Ở trạng thái chọn bảng tính (`!error`), chỉ render duy nhất nút "Để sau (về trang Cài đặt)".
   - Thay thế các vị trí `--planora-border` bằng `--planora-border-strong`.

9. **Bộ kiểm thử liên quan (`apps/chat-web/tests/`):**
   - `planora-pl-08-connections.test.tsx`: bổ sung 5 test cases xác thực chuyên sâu F1–F4 và P3-1 (tổng 11 tests pass).
   - `fe-07-settings.test.tsx`: cập nhật assertion kiểm tra CSS và title Planora (34 tests pass).
   - `gmail-review-fixes.test.tsx`: cập nhật assertion kiểm tra class Planora primary thay vì `#FF5701`.
   - `mysheets-ui.test.tsx`: cập nhật regex matcher disclaimer.
   - `service-naming.test.tsx`: cập nhật regex matcher scope description.
   - `browser/gmail-03.spec.ts` & `browser/mysheets.spec.ts`: cập nhật locator regex đồng bộ với thương hiệu Planora.

---

## 3. Bằng chứng Kiểm thử Thực tế

| Lệnh kiểm thử | Exit Code | Kết quả | Chi tiết |
|---|:---:|:---:|---|
| `npm run typecheck:v3` | `0` | **PASS** | `tsc -p apps/chat-api/tsconfig.json --noEmit && tsc -p apps/chat-web/tsconfig.json --noEmit` sạch 0 lỗi TypeScript |
| `npm test -w @wap/chat-web -- planora-pl-08-connections` | `0` | **PASS** | 11/11 tests pass (xác thực toàn bộ F1-F4 và P3-1) |
| `npm test -w @wap/chat-web -- fe-07-settings gmail mycalendar mysheets planora-pl-08-connections workflow-flow-canvas` | `0` | **PASS** | 11 test files, 169/169 tests pass |
| `npm test -w @wap/chat-web` | `0` | **PASS** | Toàn bộ 103 test files, 1174/1174 tests pass (0 regressions) |
| `npm run build:v3` | `0` | **PASS** | Vite production build thành công (200 modules transformed, HTML/CSS/JS bundles) |
| `node scripts/test-v3-web-build-security.mjs` | `0` | **PASS** | Excludes credential sentinels and 7 forbidden UI claims |
