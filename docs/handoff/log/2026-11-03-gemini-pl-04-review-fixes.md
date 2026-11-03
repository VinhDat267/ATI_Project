# 2026-11-03 · gemini · PL-04 · Khắc phục Codex Review Findings F1–F3

- **Đã làm:**
  - **(1) Khắc phục triệt để F1 (P2) · Email hợp lệ dài làm vỡ layout ở cả 5 viewport:**
    - Cập nhật `.user-email-placeholder` trong `apps/chat-web/src/pages/AuthAction/AuthActionPage.tsx` ở tất cả các chế độ (`verify-success`, `verify-used`, `reset-password`, `reset-success`, `google-pending`, `blocked-pending`, `blocked-locked`, `blocked-attempts`, `email-not-verified`) bổ sung class `break-all`.
    - Trong `email-not-verified`: bọc biến email trong thẻ `<strong className="text-[var(--planora-text)] font-semibold user-email-placeholder break-all">` thay vì nội suy chuỗi raw template literal.
    - Cập nhật `apps/chat-web/src/pages/AuthAction/page.css` và `apps/chat-web/src/planora/styles/auth.css`:
      - Thiết lập `.user-email-placeholder`: `display: inline-block; min-width: 0; max-width: 100%; overflow-wrap: anywhere; word-break: break-word; word-break: break-all; vertical-align: bottom;`.
      - Thiết lập containment cho header, subtitle, heading, body, footer, info card, timeline: `min-width: 0; max-width: 100%; overflow-wrap: anywhere; word-break: break-word; box-sizing: border-box;`.
      - Thay đổi grid track desktop trong `auth.css`: `grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);` loại bỏ giới hạn cứng `340px`.
      - Thiết lập card trên mobile (`max-width: min(100%, 480px); min-width: 0; width: 100%;`).
    - Bổ sung unit tests kiểm chứng email dài 141 ký tự (`'a'.repeat(64) + '@' + 'b'.repeat(63) + '.example.test'`) trong `tests/planora-auth-lifecycle.test.tsx` không bị tràn vỡ và có class `break-all`.
  - **(2) Khắc phục triệt để F2 (P3) · Hai link footer đạt tap target tối thiểu 44px:**
    - Trong `AuthActionPage.tsx`: cập nhật cấu trúc footer sử dụng container `.planora-auth-footer-links` và các link `.planora-auth-footer-link`.
    - Trong `page.css` và `auth.css`: định dạng `.planora-auth-footer-link` có `min-height: 44px; min-width: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 8px 6px; box-sizing: border-box; text-decoration: none;`.
    - Trong `apps/chat-web/tests/browser/planora-auth-lifecycle.spec.ts`: bổ sung assertions đo `boundingBox()` của cả 2 link `Trang chủ` và `Chính sách an toàn & Dữ liệu` bảo đảm `height >= 44px` và `width >= 44px`.
  - **(3) Khắc phục triệt để F3 (P2) · Nối matcher `PL-04:` vào default scenario runner:**
    - Cập nhật `scripts/test-v3-browser.mjs`: bổ sung `|PL-04:` vào default grep pattern và auth02 grep pattern.
    - Đảm bảo runner mặc định `npm run test:browser:v3` tự động phát hiện và chạy toàn bộ 20 tests của PL-04.

- **PR / commit:**
  - Nhánh: `longnguyen005/feat-planora-pl-04` (target `codex/planora-ui`).
  - Base SHA: `5633e6b856af8e23a005b5e82280305afc7e4c89`.
  - Commit message: `fix(planora): resolve Codex PL-04 findings F1-F3`.

- **Kiểm tra đã chạy (lệnh và kết quả thực tế):**
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm run build:v3`: PASS (exit code 0, 193 modules transformed).
  - `npm test -w @wap/chat-web -- tests/planora-auth-lifecycle.test.tsx`: PASS 1 file, 23/23 tests (exit code 0).
  - `npm test -w @wap/chat-web`: PASS 99 files, 1098/1098 tests (exit code 0).

- **Trạng thái:** `STATUS: READY_FOR_CODEX_REVIEW_R2`.
