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

- PR: đang chuẩn bị bản bàn giao; chưa merge.
- Kết quả từng bước (04–05/10/2026, base `3d414ff`):
  - Đồng bộ dependencies bằng `npm ci` sau merge; local thiếu `nodemailer`. PostgreSQL dev port15433 kết nối được nhưng mới có 6 bảng. Chạy migrations0001–0008 exit0; kích hoạt tài khoản admin đã cấu hình, sau khi kiểm mật khẩu khớp tài khoản hiện có. Ứng dụng live khởi động, `/api/health`200 và auth config bật email/signup/Google.
  - SMTP ban đầu trả `535 / EAUTH`. Signup thật vẫn trả200/thông báo chung; server chỉ ghi `[auth-email] Không gửi được email.`. Người dùng cập nhật `.env`; SMTP `verify()` đạt. Người dùng xác nhận nhận cả thư xác minh/duyệt/reset, tự đặt mật khẩu mới, đăng nhập thành công và hai link cũ bị từ chối. DB xác nhận verify/reset token consumed, verified/pending trước approve và active sau approve HTTP200. Không thu thập mật khẩu mới của người dùng.
  - Google ban đầu401/`invalid_client` vì Client ID là giá trị mẫu. Sau người dùng cập nhật ID/secret thực, browser thật Google → Workspace đạt; DB verified/active/hasPassword/Google linked và một phiên active. Account gỡ rồi liên kết lại hiển thị thành công, DB quan sát state `mode=link` consumed1 tại thời điểm đó (state hết hạn được hệ thống dọn); thao tác người dùng xen kẽ automation, không gửi lại action khi selector đã đổi trang. Đăng xuất rồi chọn lại Google của tài khoản mật khẩu đã liên kết → Workspace đạt. Google mới do người dùng tự đăng nhập Gmail thứ hai: UI chờ duyệt, DB verified/password NULL/pending; admin approve HTTP200 → đăng nhập Google lại → Workspace và một phiên active.
  - Đọc đúng ba thư AUTH-06 trong Gmail thật: tiêu đề/nội dung tiếng Việt xác minh, duyệt, reset hiển thị đúng. DOM của hai link nhận được có origin `http://localhost:5174`, view `verify-email`/`reset-password` và có token; chỉ ghi origin/view/boolean, không lưu giá trị token. Ảnh nội dung xác minh/reset đã loại vùng link và định danh.
  - Runtime riêng API3101/web5177, callback5177 chưa đăng ký: Google từ chối thật400/`redirect_uri_mismatch`, có ảnh lỗi đã loại email. Callback ATI không được gọi khi Google từ chối URI; không gán ca này thành lỗi callback ứng dụng. Runtime phụ đã dừng; runtime đúng3000/5174 vẫn chạy, không sửa `.env` cho ca lỗi.
  - `npm run check` exit0 trên PostgreSQL16 tmpfs riêng: **1.245 v3 (47+340+188+25+331+314) +165 eval**; typecheck/build/credential scan/launcher1 và guards8 đạt. Lần baseline đầu không kết nối được endpoint test cũ55532; sau khi chọn DB test riêng5432 thì toàn bộ check đạt. Không dùng DB dev để chạy suite.
  - Đã thêm ignore `docs/ai-evidence/AUTH-LIVE/`; `git check-ignore -v` đạt trước khi lưu bằng chứng. JSON chỉ chứa trạng thái/mã lỗi/số liệu, không chứa email, mật khẩu, token hay client secret; ảnh Google pending/Workspace và lỗi mismatch không có email/token. Hướng dẫn thêm tại `evaluations/README.md`, mục AUTH-06. Container test tmpfs đã dọn, dev15433 vẫn healthy.
- Điều chưa làm hoặc khác với task card: reset/login mật khẩu và từ chối link email đã dùng có xác nhận trực tiếp của người dùng, không lấy token từ DB để thay cho nhận thư. Gmail và Google có UI thật; DB/API đối chiếu trạng thái. Chưa có review độc lập hay gate PR. Google chặn redirect mismatch trên trang lỗi của Google, không chuyển về callback ATI. Hướng dẫn làm rõ ngoại lệ Testing cho các scope `openid email profile` theo Google; test-user allowlist không phải lớp bảo vệ đăng nhập với ba scope này. Browser suite fixture chưa chạy lại local trong task này. Không gọi model/ghi workflow service/deploy; không sửa CURRENT-STATE/ROADMAP hay v2.
