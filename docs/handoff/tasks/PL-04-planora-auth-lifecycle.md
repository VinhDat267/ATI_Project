# PL-04 · Xác thực nâng cao và vòng đời tài khoản (Advanced Auth)

**Trạng thái:** sẵn sàng nhận · **Nhánh gợi ý:** `longnguyen005/feat-planora-pl-04` · **Phụ thuộc:** PL-03 đã tích hợp vào `codex/planora-ui` và được Codex duyệt Đạt.  
**Base SHA:** `5633e6b856af8e23a005b5e82280305afc7e4c89` (trên integration branch `codex/planora-ui`).  
**Target branch:** `codex/planora-ui`.  
**Đặc tả:** [Planora migration design](../../superpowers/specs/2026-11-02-planora-migration-design.md) mục 4.2, 8.2 · **Kế hoạch:** [Planora migration plan](../../superpowers/plans/2026-11-02-planora-migration.md) mục PL-04.  
**Prompt thi công:** [PL-04.md](../planora-prompts/PL-04.md).  
**Quy ước chung:** [COMMON.md](../planora-prompts/COMMON.md).

---

## 1. Mục tiêu

Di chuyển toàn bộ các màn hình xác thực nâng cao và vòng đời tài khoản sang chuẩn giao diện Planora:
1. **Các chế độ AuthAction:** Xác thực email (`verify`), gửi lại email xác thực (`resend`), quên mật khẩu (`forgot`), đặt lại mật khẩu (`reset`), xử lý liên kết hết hạn hoặc đã sử dụng (`expired` / `used`), và thông báo thành công (`success`).
2. **Google OAuth Callback:** Chuyển đổi giao diện `GoogleCallbackView` sang khung Planora, giữ nguyên logic xử lý callback 1 lần (ngăn chặn double-trigger do StrictMode / reload), hiển thị trạng thái pending/ready/error rõ ràng, gỡ token khỏi URL sau xử lý.
3. **Bảo toàn 100% nghiệp vụ Auth:** Giữ nguyên các cơ chế cooldown timer, validation mật khẩu, xử lý token/state, lockout/attempts, và điều hướng an toàn về `returnTo` hoặc hội thoại ban đầu.

---

## 2. Ranh giới sở hữu & Phạm vi file

- **Sửa đổi cho phép:**
  - `apps/chat-web/src/views/VerifyEmailView.tsx`
  - `apps/chat-web/src/views/ForgotPasswordView.tsx`
  - `apps/chat-web/src/views/ResetPasswordView.tsx`
  - `apps/chat-web/src/views/GoogleCallbackView.tsx`
  - `apps/chat-web/src/pages/AuthAction/AuthActionPage.tsx`
  - `apps/chat-web/src/pages/AuthAction/page.css`
  - `apps/chat-web/src/components/AuthGate.tsx` (chỉ phần trình bày/loading state nếu cần)
  - Tests liên quan: `tests/auth-02-signup-reset.test.tsx`, `tests/auth-04-google.test.tsx`, `tests/auth-return-target.test.tsx` (hoặc tương đương)
- **Ngoài phạm vi:**
  - Không sửa `apps/chat-api`, backend auth routers, auth services, DB migrations.
  - Không sửa các màn hình Chat/Cockpit/Settings (thuộc PL-05..PL-13).

---

## 3. Interfaces & Yêu cầu kỹ thuật

- **Bảo toàn enum `AuthActionMode`:**
  - Đảm bảo render đầy đủ tất cả các mode mà `AuthActionPage` hiện tại hỗ trợ.
- **Tương thích giao diện Planora:**
  - Tái sử dụng `PlanoraAuthFrame` đã hoàn thành ở PL-03 cho các màn hành động xác thực độc lập.
  - Hỗ trợ đầy đủ Light/Dark theme (`--planora-*`), tap target tối thiểu 44px trên mobile, và 0px tràn ngang trên mọi viewport (320px -> 1440px).

---

## 4. Tiêu chí nghiệm thu

- [x] Toàn bộ các chế độ `AuthAction` (verify, resend, forgot, reset, success, expired/used) hiển thị chuẩn Planora.
- [x] Xử lý Google OAuth callback hiển thị chuẩn giao diện Planora, không bị lỗi double-invocation khi React StrictMode chạy.
- [x] Giữ nguyên 100% validation mật khẩu, cooldown timer, xóa sạch sensitive tokens khỏi URL sau khi xử lý.
- [x] `npm run typecheck:v3` exit 0.
- [x] `npm run build:v3` exit 0.
- [x] `npm test -w @wap/chat-web` PASS 100%, không hồi quy bất kỳ bài test nào (99/99 files, 1095/1095 tests).
- [x] Có Playwright browser test spec kiểm chứng trên 5 viewports (1440, 1024, 768, 375, 320) ở cả hai theme Sáng/Tối.
- [x] Gửi packet `READY_FOR_CODEX_REVIEW` cho Codex re-review độc lập.

---

## 5. Kết quả

- **Trạng thái:** `STATUS: READY_FOR_CODEX_REVIEW`
- **Nhánh:** `longnguyen005/feat-planora-pl-04` (target `codex/planora-ui`)
- **Base SHA:** `5633e6b856af8e23a005b5e82280305afc7e4c89`
- **Tóm tắt thay đổi:**
  1. `apps/chat-web/src/pages/AuthAction/AuthActionPage.tsx`:
     - Tái cấu trúc toàn bộ 13 modes (`loading`, `verify-success`, `verify-expired`, `verify-used`, `reset-password`, `reset-success`, `google-pending`, `google-ready`, `google-error`, `blocked-pending`, `blocked-locked`, `blocked-attempts`, `email-not-verified`) sang layout `PlanoraAuthFrame`.
     - Side panel nghệ thuật Planora trên desktop (>= 1024px), responsive card trên mobile (< 1024px).
     - Giữ nguyên toàn bộ DOM IDs (`#view-*`, `#blocked-timer-display`, `#blocked-timer-bar`, `#resend-email-input`, `#btn-submit-resend`, `#resend-success-box`, `#new-password-input`, `#confirm-password-input`, `#btn-submit-reset-password`, `#password-match-msg`, `#strength-bar-*`), form action handlers, returnTo/source conversation navigation.
     - Bảo toàn cơ chế tính timer countdown từ `deadline` (tránh drift), meter độ mạnh mật khẩu 4 mức, validation tối thiểu 12 ký tự, toggle xem mật khẩu.
     - Bảo toàn cờ `callbackProcessedRef` chống double-invocation của Google callback trong React StrictMode và scrub sạch token khỏi URL.
     - Bảo đảm quy tắc trợ năng 1 `<h1>` per view và `role="status"` không bị trùng lặp.
  2. `apps/chat-web/src/pages/AuthAction/page.css`:
     - Chuyển đổi toàn bộ màu sắc từ prototype cam (`#FF5701`) sang hệ design tokens `--planora-*` (canvas `#f8f4eb`, paper `#fffdf7`, primary forest green `#3c5741`, soft sage, status pending/error).
     - Hỗ trợ đầy đủ Light/Dark theme (`.dark`), typography Planora serif/sans, card padding, tap target min 44px, và reduced motion.
  3. `apps/chat-web/src/planora/layout/PlanoraAuthFrame.tsx`:
     - Bổ sung prop tùy chọn `cardId?: string;` để gắn id cho thẻ card (`id={cardId ?? 'action-card'}`).
  4. Tests:
     - Tạo mới `apps/chat-web/tests/planora-auth-lifecycle.test.tsx`: 20 unit tests bao phủ 13 modes, 1 h1 per view, countdown timer math (`01:13` -> `01:00` -> `00:00`), meter 4 giai đoạn, eye toggles, resend, và Google callback single invocation.
     - Tạo mới `apps/chat-web/tests/browser/planora-auth-lifecycle.spec.ts`: Playwright spec bao phủ 5 viewports (1440, 1024, 768, 375, 320) trên 2 theme Light & Dark, kiểm tra 0px tràn ngang và tap target >= 44px.
- **Bằng chứng kiểm tra thực tế:**
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm run build:v3`: PASS (exit code 0).
  - `npm test -w @wap/chat-web`: PASS (99 test files, 1098/1098 tests pass, exit code 0).

---

## 6. Khắc phục Codex Review Vòng 1 (F1–F3)

- **Trạng thái:** `STATUS: READY_FOR_CODEX_REVIEW_R2`
- **Các findings đã khắc phục triệt để:**
  1. **F1 (P2) · Containment & text wrap cho email hợp lệ dài (141 ký tự):**
     - Bổ sung `overflow-wrap: anywhere; word-break: break-word; word-break: break-all; min-width: 0; max-width: 100%; display: inline-block;` cho `.user-email-placeholder` và subtitle/card containment trong `page.css` và `auth.css`.
     - Loại bỏ track minimum `340px` cứng trong grid template `has-editorial` trên desktop (`minmax(0, 0.85fr)`), co dãn card `max-width: min(100%, 480px)` trên mobile.
     - Thêm unit test regression trong `tests/planora-auth-lifecycle.test.tsx` kiểm chứng render email 141 ký tự không bị tràn và có class `break-all`.
  2. **F2 (P3) · Hai link footer đáp ứng tap target $\ge 44\text{px}$:**
     - Tạo class `.planora-auth-footer-link` với `min-height: 44px; min-width: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 8px 6px;`.
     - Bổ sung assertion kiểm tra chiều cao và chiều rộng của 2 link footer (`Trang chủ` và `Chính sách an toàn & Dữ liệu`) $\ge 44\text{px}$ trong `tests/browser/planora-auth-lifecycle.spec.ts`.
  3. **F3 (P2) · Nối matcher `PL-04:` vào default scenario runner:**
     - Bổ sung `|PL-04:` vào grep regex của default scenario và auth02 scenario trong `scripts/test-v3-browser.mjs`.
     - Giúp `npm run test:browser:v3` tự động chạy toàn bộ 20 tests của PL-04.
- **Bằng chứng kiểm tra sau review fixes:**
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm run build:v3`: PASS (exit code 0).
  - `npm test -w @wap/chat-web`: PASS 99 files, 1098/1098 tests (exit code 0).
