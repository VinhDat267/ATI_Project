# 2026-11-07 · gemini · PL-10 · Khắc phục toàn diện Review Findings F1-F3 (Argon High)

- **Nhiệm vụ:** [PL-10 · Kết nối Jira, Không gian làm việc và Dự án (Jira UI & Workspace Management)](../tasks/PL-10-planora-jira-ui.md)
- **Báo cáo Review đối chiếu:** [2026-11-07-argon-review-pl-10.md](2026-11-07-argon-review-pl-10.md) (Argon High)
- **Worktree / Nhánh:** `longnguyen005/feat-planora-pl-10`
- **Target branch:** `codex/planora-ui`
- **Base SHA (Trước khi sửa):** `b58c9eb2b7ef344a010d2704d2164001d74ef6e5`
- **Fix Commit SHA:** `64b9fa7c86fe202bfe8f9c1db16327cf0ecbb258`
- **Orca Task ID:** `task_3c6553fb405d` (Dispatch `ctx_280d3a8e8d6a`)

---

## 1. Mục tiêu & Bối cảnh

Khắc phục triệt để 2 findings P2 (F1, F2) và 1 finding P3 (F3) được chỉ ra trong báo cáo review độc lập của Argon High:
1. **[F1 — P2] Loại bỏ xung đột class màu cũ đè mất token Planora & chuyển đổi toàn bộ 4 phân vùng con sang token Planora:**
   - Xoá triệt để các chuỗi prototype class cũ đè CSS token (`bg-white dark:bg-[#111827]`, `text-[#111827] dark:text-white`, `border-[#E7E7E2] dark:border-[#374151]`, `hover:bg-neutral-50 dark:hover:bg-neutral-800`, `dark:bg-[#1F2937]`).
   - Định nghĩa `buttonSecondary` thuần token Planora: `bg-[var(--planora-paper)] text-[var(--planora-text)] border border-[var(--planora-divider)] hover:bg-[var(--planora-surface-inset)] disabled:opacity-50 transition-colors cursor-pointer`.
   - Chuyển đổi toàn diện 4 phân vùng con sang CSS tokens:
     - Phân vùng 1 (Chi tiết danh tính Atlassian & Sites): viền `border-[var(--planora-divider)]`, chữ `text-[var(--planora-text)]` / `text-[var(--planora-muted)]`, nền code `bg-[var(--planora-surface-inset)]`.
     - Phân vùng 2 (Chi tiết Workspace & Capabilities Directory): khung `bg-[var(--planora-surface-inset)] border-[var(--planora-divider)]`, card site `bg-[var(--planora-paper)] border-[var(--planora-divider)]`.
     - Phân vùng 3 (Quản lý thành viên, Mã mời, Liên kết Sites & Projects): các thẻ card dùng `bg-[var(--planora-paper)] border-[var(--planora-divider)]`, dropdown `#link-site-select` dùng `border-[var(--planora-border-strong)] bg-[var(--planora-paper)] text-[var(--planora-text)]`, checkbox viền `border-[var(--planora-border-strong)]`.
     - Phân vùng 4 (Panel Hội thoại Jira Cockpit chờ JIRA-08): dùng `bg-[var(--planora-surface-inset)] border-[var(--planora-divider)] text-[var(--planora-text)] text-[var(--planora-muted)]`.
   - Cập nhật test assertion trong `apps/chat-web/tests/jira-connection-responsive.test.tsx` sang kiểm tra token `bg-[var(--planora-paper)]` và `border-[var(--planora-divider)]`.

2. **[F2 — P2] Chuẩn hóa tương phản WCAG AA ≥ 4.5:1 (GATE-03):**
   - Loại bỏ toàn bộ nhãn mờ `text-neutral-400`, `text-neutral-500`, `text-neutral-600`, thay bằng `text-[var(--planora-muted)]` (tương phản 5.42:1 Light / 7.77:1 Dark).
   - Thay `placeholder-neutral-400` bằng `placeholder:text-[var(--planora-placeholder)]`.
   - Thay các mã màu trạng thái cứng `text-green-600` / `text-amber-600` bằng semantic tokens `text-[var(--planora-success-text)]` / `text-[var(--planora-pending-text)]`.
   - Đồng bộ toàn bộ các huy hiệu trạng thái (`membershipStatus`, huy hiệu kết nối, khung cảnh báo ngắt kết nối, khung thông báo lỗi/thành công) sang semantic status tokens:
     - Success: `bg-[var(--planora-success-bg)] text-[var(--planora-success-text)] border border-[var(--planora-success-border)]`
     - Pending: `bg-[var(--planora-pending-bg)] text-[var(--planora-pending-text)] border border-[var(--planora-pending-border)]`
     - Error: `bg-[var(--planora-error-bg)] text-[var(--planora-error-text)] border border-[var(--planora-error-border)]`

3. **[F3 — P3] A11y, Disabled Guard & Kiểm thử Đột biến Mutation Safety:**
   - **A11y:** Bổ sung `aria-label="Chọn site Atlassian để liên kết"` cho dropdown `#link-site-select`.
   - **Disabled Guard:** Bổ sung `disabled={busy}` cho nút `"Huỷ"` trong panel xác nhận ngắt kết nối và nút `"Đóng"` trong cấu hình Projects.
   - **Kiểm thử SVG & Mutation Testing:**
     - Mở rộng bài test SVG trong `apps/chat-web/tests/planora-pl-10-jira.test.tsx` để render `JiraConnection` ở trạng thái lỗi kết nối (khiến thẻ `<svg>` cảnh báo tại dòng 723 mount vào DOM) và kiểm tra 100% SVG đều có `aria-hidden="true"`.
     - Bổ sung kiểm tra SVG trong `JiraCallbackView`.
     - **Tự kiểm chứng đột biến M3:** Đã thực hiện xoá thuộc tính `aria-hidden="true"` tại dòng 723 -> chạy Vitest -> test FAIL ngay lập tức (`Received: null`). Khôi phục thuộc tính -> test PASS 100%.

---

## 2. Chi tiết các tệp đã sửa đổi

1. **`apps/chat-web/src/pages/Settings/JiraConnection.tsx`:**
   - Dọn sạch class prototype cũ, chuẩn hóa `buttonSecondary` sang CSS token Planora.
   - Chuyển đổi toàn bộ 4 phân vùng con (Identity & Sites, Workspace & Capabilities, Members/Invites/Projects, Cockpit CTA) sang CSS tokens Planora.
   - Chuẩn hóa toàn bộ huy hiệu và khung trạng thái sang semantic status tokens đạt WCAG AA ≥ 4.5:1.
   - Thêm `aria-label` cho dropdown `#link-site-select`.
   - Thêm `disabled={busy}` cho các nút Huỷ ngắt kết nối và Đóng cấu hình Projects.

2. **`apps/chat-web/tests/jira-connection-responsive.test.tsx`:**
   - Cập nhật test assertion kiểm tra theme sáng/tối với token `bg-[var(--planora-paper)]` và `border-[var(--planora-divider)]`.

3. **`apps/chat-web/tests/planora-pl-10-jira.test.tsx`:**
   - Mở rộng test A11y kiểm tra `aria-hidden="true"` trên toàn bộ SVG bao gồm cả error alert SVG và `JiraCallbackView`.
   - Thêm `describe('4. Finding F3 Verification: A11y, Disabled Guards & Mutation Safety')` xác thực `aria-label` của `#link-site-select` và `disabled={busy}` guard trên các nút Huỷ và Đóng khi đang xử lý request.

4. **`docs/handoff/log/2026-11-07-gemini-pl-10.md`:**
   - Cập nhật HEAD SHA chính xác trước vòng review fixes.

---

## 3. Bằng chứng Kiểm thử Thực tế

| Lệnh kiểm thử | Exit Code | Kết quả | Chi tiết |
|---|:---:|:---:|---|
| `npm run typecheck:v3` | `0` | **PASS** | `tsc -p apps/chat-api/tsconfig.json --noEmit && tsc -p apps/chat-web/tsconfig.json --noEmit` sạch 0 lỗi TypeScript |
| `npm test -w @wap/chat-web -- jira` | `0` | **PASS** | 5 test files, 55/55 tests pass (tăng 2 tests so với ban đầu) |
| `npm test -w @wap/chat-web` | `0` | **PASS** | Toàn bộ 105 test files, 1.192/1.192 tests pass (0 regressions) |
| `npm run build:v3` | `0` | **PASS** | Vite production build thành công (200 modules transformed, HTML/CSS/JS bundles) |
| `node scripts/test-v3-web-build-security.mjs` | `0` | **PASS** | Excludes credential sentinels and 7 forbidden UI claims |
| **Kiểm chứng Đột biến M3** | `1` -> `0` | **PASS** | Xoá `aria-hidden="true"` tại dòng 723 -> test FAIL; khôi phục -> test PASS |
