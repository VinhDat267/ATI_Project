# AUTH-06 · Cấu hình Gmail SMTP, Google OAuth và kiểm tra chạy thật

**Trạng thái:** chờ · **Nhánh gợi ý:** `test/auth-06-live-auth` · **Phụ thuộc:** AUTH-02 và AUTH-04 đã merge; người dùng đã làm phần chuẩn bị · **Có phần việc của con người**

## Chuẩn bị của người dùng (agent không tự làm)

Agent không tạo tài khoản, không tạo hay đọc App Password/client secret, không in giá trị bí mật ra log. Người dùng tự điền `.env`.

**Gmail SMTP**
1. Chọn một Gmail của nhóm dùng để gửi thư (nên là Gmail tạo riêng cho dự án, không phải Gmail cá nhân chính).
2. Bật **Xác minh 2 bước** cho tài khoản đó, rồi tạo **App Password** (Mật khẩu ứng dụng).
3. Điền `.env`:
   - `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`;
   - `SMTP_USER` (địa chỉ Gmail đó), `SMTP_PASSWORD` (App Password);
   - `MAIL_FROM` (ví dụ `ATI Workflow <địa chỉ đó>`);
   - `APP_BASE_URL` (ví dụ `http://localhost:5174`).

**Google OAuth** (có thể dùng chung Google Cloud project với service account của W3-07)
1. Google Cloud Console, mục **OAuth consent screen**:
   - loại **External**, tên ứng dụng, email hỗ trợ;
   - scope chỉ gồm `openid`, `email`, `profile`;
   - để chế độ **Testing** và thêm email các thành viên và người tham gia buổi thử vào **Test users**. Ở chế độ Testing chỉ test user mới đăng nhập được, và hệ thống vẫn bắt admin duyệt.
2. **Credentials → Create OAuth client ID**, loại **Web application**. Authorized redirect URI là đúng giá trị `GOOGLE_OAUTH_REDIRECT_URI` (ví dụ `http://localhost:5174/auth/google/callback`).
3. Điền `.env`: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`.

## Việc cần làm (agent, khi người dùng đã chuẩn bị xong)

Chạy `RUNTIME_MODE=live npm run up`, rồi lần lượt:

1. **Email thật:** đăng ký một tài khoản bằng email của một thành viên (người đó đồng ý) → thư xác minh tới hộp thư thật → xác minh → admin duyệt → thư "đã được duyệt" tới. Quên mật khẩu → thư tới → đặt lại → đăng nhập bằng mật khẩu mới.
2. **Google thật:** một test user đăng nhập bằng Google lần đầu → "chờ duyệt" → admin duyệt → đăng nhập được. Liên kết Google vào một tài khoản email/mật khẩu có sẵn ở trang Tài khoản, rồi đăng nhập lại bằng Google.
3. **Ca lỗi thật:** App Password sai thì đăng ký vẫn trả thông báo chung, log có lỗi gửi thư nhưng không lộ bí mật. Đổi `GOOGLE_OAUTH_REDIRECT_URI` lệch với cấu hình trên Google Cloud thì Google từ chối và trang callback báo lỗi dễ hiểu.
4. Kiểm tra thư nhận được: link trỏ đúng `APP_BASE_URL`, token dùng một lần (bấm lại báo hết hạn), tiêu đề và nội dung tiếng Việt hiển thị đúng.

## Tiêu chí nghiệm thu

- [ ] Các bước 1–4 có kết quả ghi lại: thời điểm, bước, kết quả, ảnh chụp màn hình đã che email/token.
- [ ] Bằng chứng lưu ở `docs/ai-evidence/AUTH-LIVE/` (**không commit**): thêm thư mục này vào `.gitignore` trong PR và chạy `git check-ignore` để chứng minh trước khi lưu file. PR chỉ có tóm tắt và cập nhật hướng dẫn chạy (`evaluations/README.md` mục "Through the app" hoặc `README` chính) gồm các biến env mới.
- [ ] Không có giá trị bí mật nào trong PR, log hay ảnh chụp.

## Kết quả (agent thi công điền)

- PR:
- Kết quả từng bước:
- Điều chưa làm hoặc khác với task card:
