# 2026-10-02 · Claude Code · Review FE-01 (PR #27)

- **Kết luận:** Đạt sau một sửa của reviewer trong cùng PR.
- **Chạy lại ở máy tại `44f022e`:**
  - `npm run check` exit 0: v3 526 (11 + 53 + 128 + 25 + 148 + 161), eval 66, quét bản build PASS;
  - `test-v3-browser.mjs` 9/9 trên PostgreSQL tạm riêng (cổng 55533, xóa sau khi chạy).
- **Mutation test:**
  - App gọi lại `handleStop` khi đóng hộp thoại lỗi → 3 test fail;
  - modal gọi `onStop` khi thiếu `onClose` → 1 test fail.
- **Lỗi tìm thấy và đã sửa:**
  - `scripts/test-v3-web-build-security.mjs` không đặt `SANDBOX_USER_EMAIL`, nên điều kiện bật demo login không bao giờ đúng; gỡ cả hai lớp chặn (`command === 'serve'` trong `vite.config.ts` và `import.meta.env.DEV` trong `LoginView.tsx`) mà test vẫn PASS.
  - Đã đặt đủ `CHAT_ADMIN_EMAIL`/`SANDBOX_USER_EMAIL` (khác nhau) trong process env và `.env` tạm. Sau sửa: code hiện tại PASS; gỡ cả hai lớp → FAIL ("Production artifact contains a credential"); gỡ một lớp → PASS (lớp còn lại vẫn chặn, đúng thiết kế).
- **Để sau (minor):**
  - tiêu đề mẫu "Tổng hợp Phát hành Sprint & Báo cáo Kỹ thuật" không khớp nội dung mới;
  - chấm xanh nhấp nháy luôn hiện ở thanh dịch vụ;
  - dòng "Chưa xác định được chế độ chạy" hiện thoáng khi đang tải.
- **Môi trường:** container `ati-v3-postgres-1` ở máy đang map cổng 15433 trong khi `compose.v3.yaml` và guard E2E dùng 55533; `.env` trỏ 15433. Không ảnh hưởng CI.
