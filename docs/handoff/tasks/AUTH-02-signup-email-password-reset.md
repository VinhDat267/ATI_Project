# AUTH-02 · Gửi email, đăng ký, xác minh email, quên mật khẩu

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/auth-02-signup-email-reset` · **Phụ thuộc:** AUTH-01 đã merge · **Làm song song với:** AUTH-03, AUTH-04 · **Lưu ý:** đăng ký chỉ mặc định bật khi cả AUTH-02 và AUTH-03 đã merge (xem mục 5 của "Việc cần làm")

Đọc trước: [yêu cầu chung của mảng tài khoản](AUTH-common.md).

## Luồng người dùng

1. **Đăng ký:** điền tên, email, mật khẩu. Hệ thống tạo tài khoản `pending`, `email_verified = false`, gửi email xác minh. Màn hình báo "Kiểm tra email để xác minh". Email đã tồn tại cũng nhận đúng thông báo này; khi đó hệ thống gửi tới email đó một thư "có người vừa thử đăng ký bằng email của bạn", không tạo tài khoản mới.
2. **Xác minh email:** bấm link, tài khoản thành `email_verified = true` và vẫn `pending`. Màn hình báo "Email đã xác minh, chờ quản trị viên duyệt". Hệ thống gửi một email cho mỗi admin đang `active`: "có tài khoản mới chờ duyệt".
3. **Admin duyệt** (AUTH-03) → người dùng nhận email "tài khoản đã được duyệt" → đăng nhập được.
4. **Quên mật khẩu:**
   - nhập email → luôn báo "Nếu email có trong hệ thống, bạn sẽ nhận được link";
   - bấm link → đặt mật khẩu mới → **mọi phiên cũ bị thu hồi** → về màn hình đăng nhập;
   - tài khoản chỉ dùng Google (chưa có mật khẩu) cũng dùng được luồng này để đặt mật khẩu lần đầu;
   - đặt lại mật khẩu cũng đánh dấu `email_verified = true`, vì người dùng đã chứng minh sở hữu email.
5. **Gửi lại email xác minh** từ màn hình đăng nhập khi tài khoản chưa xác minh (có giới hạn tần suất).

## Việc cần làm

1. **Migration `0004_auth_tokens_outbox.sql`** (idempotent):
   - `auth_tokens(id, user_id, purpose, token_hash, expires_at, used_at, created_at)`;
   - `email_outbox(id, to_address, subject, body_text, body_html, created_at)`.
2. **Gửi email** `apps/chat-api/src/services/email/`:
   - interface `EmailSender { send(message) }`;
   - `SmtpEmailSender` dùng `nodemailer`, đọc env `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` (Gmail: `smtp.gmail.com`, 465, TLS);
   - `OutboxEmailSender` ghi vào `email_outbox`.
   - Chế độ `live` bắt buộc đủ biến SMTP, thiếu thì báo lỗi lúc khởi động. Chế độ `sandbox` và CI luôn dùng outbox.
   - Thêm tên biến (không có giá trị) vào `.env.example`, cùng `APP_BASE_URL` (origin của web, dùng để dựng link).
   - Lỗi gửi email không làm hỏng request. Ghi log ngắn không chứa link/token; người dùng thấy cùng một thông báo.
3. **Mẫu email tiếng Việt** (văn bản thuần + HTML đơn giản):
   - xác minh email;
   - đặt lại mật khẩu;
   - có người thử đăng ký bằng email của bạn;
   - có tài khoản mới chờ duyệt (gửi admin);
   - tài khoản đã được duyệt (hàm gửi để sẵn, AUTH-03 gọi).

   Link dạng `APP_BASE_URL/?view=verify-email&token=…` và `?view=reset-password&token=…`.
4. **API** `routes/auth/signup.ts` và `routes/auth/password.ts`:
   - `POST /api/auth/signup`;
   - `POST /api/auth/verify-email`;
   - `POST /api/auth/resend-verification`;
   - `POST /api/auth/forgot-password`;
   - `POST /api/auth/reset-password`.

   Token theo yêu cầu chung: SHA-256, dùng một lần, có hạn, token mới vô hiệu token cũ cùng mục đích. Giới hạn tần suất cho signup, forgot, resend.
5. **Giao diện:**
   - các view `signup`, `verify-email`, `forgot-password`, `reset-password`;
   - link "Quên mật khẩu?" trên màn hình đăng nhập;
   - token đọc từ URL xong thì xóa khỏi thanh địa chỉ;
   - đặt `Referrer-Policy: no-referrer` (thẻ meta trong `index.html`).
   - Nút/link **"Tạo tài khoản"** chỉ hiện khi `GET /api/auth/config` trả `signupEnabled: true`. Giá trị lấy từ env `AUTH_SIGNUP_ENABLED`; `POST /api/auth/signup` cũng trả 403 khi cờ tắt. **Mặc định trong code là `false`**; task nào merge sau trong hai task AUTH-02/AUTH-03 thì đổi mặc định thành `true`. Browser E2E đặt `AUTH_SIGNUP_ENABLED=true`. Admin có thể đóng đăng ký bằng env này.

## Không làm trong task này

Đăng nhập Google (AUTH-04), trang tài khoản và đổi mật khẩu khi đang đăng nhập (AUTH-05), trang duyệt (AUTH-03).

## Tiêu chí nghiệm thu

- [ ] Test migration chạy hai lần (PostgreSQL thật).
- [ ] Test đăng ký:
  - tạo `pending` + chưa xác minh + một email trong outbox;
  - email đã tồn tại: cùng phản hồi HTTP, không tạo tài khoản, outbox có thư "có người thử đăng ký";
  - mật khẩu < 12 ký tự bị từ chối.
- [ ] Test token:
  - DB chỉ có hash;
  - token hết hạn, đã dùng, sai mục đích đều bị từ chối;
  - tạo token mới làm token cũ hết hiệu lực;
  - hai request dùng cùng token đồng thời chỉ một thành công (PostgreSQL thật).
- [ ] Test quên mật khẩu:
  - email lạ và email có thật trả phản hồi giống hệt;
  - đặt lại xong thì mọi phiên cũ bị thu hồi (refresh cũ trả 401);
  - tài khoản chỉ có Google đặt được mật khẩu;
  - `email_verified` thành `true`.
- [ ] Test giới hạn tần suất (đồng hồ giả) cho signup, forgot, resend.
- [ ] Test `live` thiếu biến SMTP thì không khởi động; `SmtpEmailSender` dựng đúng transport (inject transport giả, không gửi thật trong test).
- [ ] Test không có token/link trong log (bắt log trong test).
- [ ] Browser E2E (sandbox, PostgreSQL thật): đăng ký → đọc link trong `email_outbox` → xác minh → màn hình "chờ duyệt" → admin duyệt (qua AUTH-03 nếu đã có, nếu chưa thì đổi trạng thái trực tiếp trong DB) → đăng nhập. Quên mật khẩu → link trong outbox → đặt mật khẩu → đăng nhập bằng mật khẩu mới; mật khẩu cũ bị từ chối.
- [ ] Test mới fail trước khi sửa; `npm run check` exit 0; `npm run test:browser:v3` đạt hết.

## Kết quả (agent thi công điền)

- PR:
- Commit:
- Test đã chạy và kết quả:
- Điều chưa làm hoặc khác với task card:
