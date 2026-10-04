# AUTH-02b · Gửi email không chặn phản hồi; chế độ live chạy được khi chưa có SMTP

**Trạng thái:** chờ · **Nhánh gợi ý:** `fix/auth-02b-async-email` · **Phụ thuộc:** không · **Phải xong trước:** AUTH-06 (cấu hình Gmail SMTP thật) và các phép đo tuần 4 qua app thật (W4-03, W4-04)

Nguồn: review của Claude Code cho #52/#53/#54 ngày 04/10/2026 (xem `log/2026-10-04-claude-code-review-auth02-03-fe03.md`).

## 1. Lộ tài khoản qua thời gian phản hồi (P2)

- **Hiện trạng:** với email có tài khoản, `POST /api/auth/forgot-password` và `POST /api/auth/resend-verification` tạo token rồi `await sendEmailSafely(...)` trước khi trả lời. Ở live, hàm này chờ SMTP (timeout tối đa 10 giây). Email không tồn tại thì trả lời ngay. Hai nhánh có cùng nội dung phản hồi nhưng khác thời gian.
- **Bằng chứng:** probe HTTP + PostgreSQL thật, sender giả lập SMTP chậm 800 ms: email có tài khoản **832 ms**, email không có **6 ms**, cùng body. Với Gmail thật, chênh lệch 1–3 giây, đo được từ bên ngoài.
- **Phạm vi kiểm:** `signup` không bị, vì cả hai nhánh đều băm mật khẩu và gửi một thư. Duyệt tài khoản (AUTH-03) chỉ admin gọi được, nên không thuộc phạm vi lỗi này.
- **Yêu cầu:**
  - Phản hồi của `forgot-password` và `resend-verification` **không chờ** việc gửi email. Chọn một cách và ghi lý do trong PR:
    - (a) ghi thư vào `email_outbox` trong cùng request (thời gian như nhau ở cả hai nhánh, vì nhánh email lạ cũng làm một thao tác tương đương), rồi để một tiến trình gửi nền chuyển thư qua SMTP;
    - (b) tạo token xong thì gọi gửi email không `await` (có `.catch` ghi log đã làm sạch), và nhánh email lạ thực hiện công việc có chi phí tương đương.
  - Không lộ token hoặc nội dung thư trong log.
  - Áp dụng cùng cách cho `signup` nếu thay đổi làm hai nhánh của nó chênh lệch.
- **Test:**
  - sender chậm (≥ 500 ms): thời gian phản hồi hai nhánh chênh không quá 100 ms (đo nhiều lần, so trung vị);
  - thư vẫn được gửi hoặc ghi vào outbox đúng một lần;
  - sender lỗi không làm request lỗi.

## 2. Chế độ live không khởi động được khi chưa cấu hình SMTP (thấp, chặn việc khác)

- **Hiện trạng:** `validateEnv` bắt buộc đủ `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `APP_BASE_URL` khi `RUNTIME_MODE=live`. Máy nhóm trưởng chưa có các biến này (AUTH-06 chưa làm), nên `RUNTIME_MODE=live npm run up` lỗi ngay khi khởi động. Các phép đo qua app thật ở tuần 4 vì vậy bị chặn.
- **Yêu cầu:** ở live, nếu thiếu cấu hình SMTP thì API vẫn khởi động, nhưng:
  - `signupEnabled` buộc về `false`;
  - `signup`, `verify-email`, `resend-verification`, `forgot-password`, `reset-password` trả 503 "Chưa cấu hình gửi email";
  - duyệt tài khoản (AUTH-03) vẫn trả 503 như hiện nay khi thiếu sender;
  - log khởi động ghi một dòng cảnh báo (không chứa giá trị).

  Cấu hình SMTP **thiếu một phần** (có vài biến) vẫn là lỗi khởi động, để không chạy với cấu hình hỏng.
- **Test:**
  - live không có biến SMTP nào → khởi động được, 5 route trên trả 503, `GET /api/auth/config` báo `signupEnabled: false`;
  - live có đủ biến → hành vi như cũ;
  - live chỉ có một vài biến → lỗi khởi động.

## Tiêu chí nghiệm thu

- [ ] Test mới fail trước khi sửa (mục 1 bằng sender chậm; mục 2 bằng env thiếu SMTP).
- [ ] `npm run check` exit 0; `npm run test:browser:v3` đạt hết (chạy trên PostgreSQL tạm, không dùng database dev ở 15433).
- [ ] Probe đo thời gian của reviewer chạy lại cho chênh lệch ≤ 100 ms.

## Kết quả (agent thi công điền)

- PR: nhánh `fix/auth-02b-async-email` (Claude Code thi công theo yêu cầu của người dùng).
- Commit: `4730c76` (test RED), `ecfe7ab` (sửa), kèm commit tài liệu.
- Cách sửa mục 1: chọn **(b)**.
  - `forgot-password` và `resend-verification` tạo token xong thì gọi `sendEmailInBackground`, không chờ SMTP. Lỗi gửi vẫn đi qua `sendEmailSafely`, chỉ ghi log đã làm sạch.
  - Không chọn (a): outbox ở live sẽ lưu link reset có token dạng rõ trong database, ngược thiết kế chỉ lưu hash token.
  - `signup` giữ nguyên, vì hai nhánh của nó vẫn cùng chờ một lần gửi thư.
- Cách sửa mục 2:
  - `validateEnv` thêm `EMAIL_ENABLED`. Live không có biến SMTP nào thì `EMAIL_ENABLED=false` và `AUTH_SIGNUP_ENABLED` bị buộc về `false`. Có một vài biến là lỗi khởi động như cũ.
  - Server không tạo email sender khi `EMAIL_ENABLED=false`, và ghi một dòng cảnh báo khi khởi động (không có giá trị nào).
  - Năm route email trả 503 "Chưa cấu hình gửi email.". Không có PostgreSQL thì vẫn trả thông báo cũ.
- Test đã chạy và kết quả (04/10/2026, PostgreSQL tạm ở 55533):
  - **RED trên `main` `7d2b292`:**
    - SMTP giả lập chậm 500 ms, mỗi route 5 cặp email có/không có tài khoản: chênh lệch trung vị **519 ms** (`forgot-password`) và **514 ms** (`resend-verification`), vượt ngưỡng 100 ms;
    - `validateEnv` live không SMTP: lỗi `SMTP_HOST is required in live mode`;
    - spawn `server.ts` thật ở live không SMTP: thoát khi khởi động với cùng lỗi.
  - **Hai test giữ hành vi cũ (đạt cả trước khi sửa):**
    - cấu hình SMTP thiếu một phần vẫn là lỗi khởi động;
    - duyệt tài khoản trả 503 `APPROVAL_EMAIL_UNAVAILABLE` khi không có sender, tài khoản vẫn `pending`.
  - **GREEN:**
    - test auth, config và live-startup: 93/93, chạy 3 lần liên tiếp;
    - mỗi email có tài khoản nhận đúng một thư, email lạ không nhận thư.
  - **Probe của reviewer chạy lại** (SMTP chậm 800 ms): email có tài khoản **28 ms**, email không có **5 ms**. Trước khi sửa là 832 ms và 6 ms.
  - **Mutation:** 9/9 bị bắt:
    - hai route chờ SMTP trở lại;
    - helper gửi nền bỏ thư;
    - live không SMTP vẫn lỗi;
    - chấp nhận cấu hình thiếu một phần;
    - không buộc tắt đăng ký;
    - server vẫn tạo sender;
    - mất dòng cảnh báo;
    - thông báo 503 chung chung.
  - **`npm run check`:** exit 0; v3 1.074 = 47 schema + 328 adapters + 180 planner + 25 executor + 258 API + 236 web; eval 165; typecheck, build, quét bản build đạt.
  - **`npm run test:browser:v3`:** exit 0, 26/26 ca qua 10 scenario (auth02 2/2).
- Điều chưa làm hoặc khác với task card:
  - Nhánh email lạ **không** làm thêm việc giả để cân thời gian.
    - Chênh lệch còn lại là transaction tạo token, khoảng 20 ms ở máy (probe 28 vs 5 ms), dưới ngưỡng 100 ms.
    - Mỗi email chỉ được gửi 3 yêu cầu mỗi giờ, nên khó đo chênh lệch nhỏ như vậy giữa nhiễu mạng.
  - Thư gửi nền chưa có hàng đợi bền: nếu API dừng ngay sau khi trả lời, thư đang gửi có thể mất. Người dùng chỉ cần gửi lại yêu cầu.
  - Hai chỗ test đọc thư ngay sau response được sửa để chờ:
    - helper `tokenFromMail` chờ các lần `send` đã bắt đầu;
    - `mailLink` của browser test AUTH-02 poll outbox.
  - `.env.example` ghi rõ live chạy được khi không có SMTP.
