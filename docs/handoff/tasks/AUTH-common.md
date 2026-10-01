# Yêu cầu chung cho mảng tài khoản (AUTH-01 → AUTH-06)

## Quyết định của chủ dự án (02/10/2026)

1. **Đăng ký mở, admin duyệt.** Ai cũng tạo được tài khoản (email/mật khẩu hoặc Google), nhưng tài khoản mới ở trạng thái `pending`. Chỉ tài khoản `active` mới đăng nhập được vào chat. Lý do: credentials của mọi service (Trello, Slack, GitHub và các service tuần 3) **dùng chung cho cả nhóm**, nên người được duyệt có thể ghi vào các service đó.
2. **Gửi email bằng Gmail SMTP** (một Gmail của nhóm, App Password). Thư viện mới được phép duy nhất cho mảng này: `nodemailer` (và `@types/nodemailer`). Chế độ sandbox và CI không gửi email thật mà ghi vào hộp thư giả lập (bảng `email_outbox`).
3. **Đăng nhập Google** theo OpenID Connect. Không thêm thư viện: tự kiểm ID token bằng JWKS của Google và `node:crypto`.
4. Đặc tả v3 §8.1 ("Không có đăng ký tự do") được thay bằng mục 8.1 mới theo các quyết định trên.

## Hiện trạng trên `main` `2ae2a16`

| Phần | Hiện trạng |
|---|---|
| Đăng nhập | `POST /api/auth/login` (email/mật khẩu, PBKDF2 210.000 vòng, so sánh timing-safe) |
| Token | Access JWT HS256 15 phút; refresh **cũng là JWT** 7 ngày, không lưu ở server, nên **không thu hồi được**. Đặc tả §8.1 yêu cầu "refresh token hỗ trợ revocation", tức code chưa đạt đặc tả |
| Đăng xuất | Chỉ xóa token trong `localStorage` (`App.tsx` `handleLogout`) |
| Tạo tài khoản / đổi mật khẩu | Chỉ có CLI `apps/chat-api/src/cli/provision-user.ts` |
| Phân quyền | Không có cột vai trò; quyền sửa credentials dùng chung lấy từ env `SERVICE_ADMIN_USER_IDS` |
| Chặn đoán mật khẩu | Không có |
| Bảng `users` | `id, email UNIQUE, password NOT NULL, name, created_at` |
| Middleware | `createAuthMiddleware` chỉ kiểm chữ ký và hạn của JWT, không đọc database |
| Chế độ không có PostgreSQL | Sandbox có thể chạy bằng bộ nhớ (`userRepo` null, `validateCredentials` từ `SANDBOX_USER_*`) |

## Quy tắc bắt buộc

- **Migration idempotent.** `db/v3/migrate.mjs` chạy lại **mọi** file `.sql` mỗi lần, không lưu lịch sử. Vì vậy file mới phải dùng `IF NOT EXISTS`/`IF EXISTS`, và **không có câu `UPDATE` sửa dữ liệu chạy lặp**. Ví dụ: để tài khoản cũ thành `active` còn tài khoản mới mặc định `pending`, dùng `ADD COLUMN IF NOT EXISTS status … DEFAULT 'active'` rồi `ALTER COLUMN status SET DEFAULT 'pending'`, không dùng `UPDATE users SET status = 'active'`. Có test chạy migration hai lần liên tiếp trên PostgreSQL thật.
- **Không lưu bí mật dạng gốc:** refresh token, token xác minh email, token đặt lại mật khẩu, `state` OAuth chỉ lưu **SHA-256**; so sánh bằng hash. Không ghi token, mật khẩu, mã OAuth, nội dung email chứa link vào log.
- **Không lộ tài khoản có tồn tại hay không:** đăng nhập sai, đăng ký email đã có, quên mật khẩu với email lạ đều trả cùng một kiểu phản hồi.
- **Token dùng một lần, có hạn:**
  - xác minh email: 24 giờ;
  - đặt lại mật khẩu: 30 phút;
  - `state` OAuth: 10 phút.

  Dùng xong thì vô hiệu. Tạo token mới thì vô hiệu token cũ cùng mục đích.
- **Mật khẩu:** 12–128 ký tự (khớp CLI hiện có), băm bằng `hashPassword` sẵn có.
- **Giới hạn tần suất** trong bộ nhớ (một API instance, như các giới hạn khác của hệ thống):
  - đăng nhập: 5 lần sai mỗi (IP, email) trong 15 phút;
  - quên mật khẩu: 3 lần mỗi email mỗi giờ;
  - đăng ký: 10 lần mỗi IP mỗi giờ.

  Vượt giới hạn trả 429 kèm `Retry-After`.
- **Link trong email** có token ở URL. Frontend đọc token xong phải xóa token khỏi thanh địa chỉ ngay (`history.replaceState`). Trang web đặt `Referrer-Policy: no-referrer`.
- **Chế độ bộ nhớ (không có PostgreSQL):** các tính năng mới trả 503 "cần PostgreSQL". Đăng nhập kiểu cũ bằng `SANDBOX_USER_*` vẫn chạy như hiện nay.
- **Test:** logic database test trên PostgreSQL thật; luồng giao diện có browser E2E (sandbox, PostgreSQL thật). Test đọc email từ bảng `email_outbox`, không cần endpoint riêng.
- **Giao diện** tiếng Việt, theo phong cách các màn hình đăng nhập hiện có (`LoginView.tsx`). Phần giao diện của AUTH-02 → AUTH-05 làm **sau FE-02**: FE-02 tách `App.tsx` và tạo bảng route, nên mỗi task chỉ thêm một file view và một dòng route. Phần backend làm trước được.
- Không thêm thư viện nào ngoài `nodemailer`.

## Dữ liệu dùng chung (tạo ở AUTH-01, các task sau chỉ thêm)

- `users` thêm cột:
  - `password` cho phép NULL (tài khoản chỉ dùng Google);
  - `email_verified BOOLEAN`;
  - `status` (`pending` | `active` | `disabled`);
  - `role` (`member` | `admin`);
  - `google_sub TEXT UNIQUE NULL`;
  - `updated_at`.

  Tài khoản đang có sau migration: `active`, `email_verified = true`, `role = 'member'`.
- `auth_sessions`: `id`, `user_id`, `refresh_token_hash`, `previous_token_hash`, `rotated_at`, `created_at`, `last_used_at`, `expires_at`, `revoked_at`, `user_agent`.
- AUTH-02 thêm `auth_tokens` (mục đích `verify_email` | `reset_password`) và `email_outbox`. AUTH-04 thêm `oauth_states`. Mỗi task thêm migration riêng (`0004_…`, `0005_…`); hai PR cùng số thì PR merge sau đổi số.

## Thứ tự

AUTH-01 làm trước và chặn tất cả. Sau đó AUTH-02, AUTH-03, AUTH-04 làm song song. **AUTH-02 và AUTH-03 phải cùng có mặt trước khi bật đăng ký trên giao diện**: có đăng ký mà chưa có trang duyệt thì tài khoản mới kẹt ở `pending`. AUTH-05 sau AUTH-01 (phần liên kết Google sau AUTH-04). AUTH-06 (chạy thật) sau AUTH-02 và AUTH-04.

Để giảm xung đột khi làm song song, AUTH-01 tách `auth-routes.ts` thành thư mục `apps/chat-api/src/routes/auth/`, mỗi nhóm chức năng một router, gom ở `index.ts`; mỗi task sau thêm file router của mình và một dòng ở `index.ts`.
