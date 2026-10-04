# 2026-10-04 · Claude Code · AUTH-02b

- **Đã làm:**
  - **Mục 1:** `forgot-password` và `resend-verification` gửi thư ở nền (`sendEmailInBackground`), không chờ SMTP.
  - **Mục 2:** live không có biến SMTP nào vẫn khởi động. Khi đó đăng ký bị buộc tắt, năm route email trả 503 "Chưa cấu hình gửi email.", và có một dòng cảnh báo lúc khởi động. Cấu hình SMTP thiếu một phần vẫn là lỗi.
- **PR / commit:** nhánh `fix/auth-02b-async-email`; `4730c76` (test RED), `ecfe7ab` (sửa).
- **Kiểm tra đã chạy (lệnh và kết quả):**
  - **RED trên `main` `7d2b292`:**
    - chênh lệch trung vị 519 ms và 514 ms với SMTP chậm 500 ms;
    - `validateEnv` và spawn `server.ts` live đều lỗi `SMTP_HOST is required`.
  - **GREEN:**
    - auth/config/live-startup 93/93, ba lần liên tiếp;
    - probe reviewer 28 vs 5 ms (trước 832 vs 6 ms);
    - mutation 9/9 bị bắt.
  - `npm run check`: exit 0; v3 1.074 = 47 schema + 328 adapters + 180 planner + 25 executor + 258 API + 236 web; eval 165; typecheck, build, quét bản build đạt.
  - `npm run test:browser:v3`: exit 0, 26/26 ca qua 10 scenario (auth02 2/2).
- **Chưa làm / vấn đề phát hiện:**
  - Không làm việc giả cho nhánh email lạ; chênh lệch còn khoảng 20 ms.
  - Thư gửi nền có thể mất nếu API dừng ngay sau khi trả lời.

  Cả hai đã ghi trong task card.
- **Việc tiếp theo đề xuất:** đo lại golden set và chạy workflow qua app ở live (giờ khởi động được khi chưa có Gmail); sau đó W3-09.
