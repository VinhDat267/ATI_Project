# AUTH-04 · Đăng nhập và đăng ký bằng Google

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/auth-04-google-login` · **Phụ thuộc:** AUTH-01 đã merge · **Làm song song với:** AUTH-02, AUTH-03

Đọc trước: [yêu cầu chung của mảng tài khoản](AUTH-common.md). Đọc tài liệu OpenID Connect hiện hành của Google trước khi code; ghi đường dẫn và ngày đọc trong log.

## Thiết kế đã chốt

**Luồng:** authorization code + PKCE (S256) + `state` + `nonce`, scope `openid email profile`.

1. Frontend gọi `POST /api/auth/google/start` với `{ mode: 'login' }`, hoặc `{ mode: 'link' }` khi đã đăng nhập (dùng ở AUTH-05).
2. Backend tạo `state`, `nonce`, `code_verifier` và lưu vào bảng `oauth_states`:
   - `state_hash`, `code_verifier`, `nonce`, `mode`;
   - `user_id` (chỉ khi `link`);
   - `expires_at` (10 phút), `used_at`.

   Backend trả URL ủy quyền của Google.
3. Google chuyển về `GOOGLE_OAUTH_REDIRECT_URI`, là một đường dẫn của **web** (ví dụ `http://localhost:5174/auth/google/callback`). Kiểm lại trong tài liệu Google xem redirect URI có được chứa query hay không; nếu không thì dùng đường dẫn, và `App.tsx` nhận diện bằng `location.pathname`.
4. Trang callback gửi `{ code, state }` tới `POST /api/auth/google/callback`, rồi xóa `code`/`state` khỏi thanh địa chỉ.
5. Backend xử lý theo thứ tự:
   - kiểm `state` (dùng một lần, chưa hết hạn);
   - đổi `code` lấy token ở token endpoint của Google bằng `client_secret` và `code_verifier`;
   - kiểm ID token: chữ ký RS256 theo JWKS của Google (cache theo `Cache-Control`; `kid` lạ thì tải lại JWKS một lần); `iss` là `https://accounts.google.com` hoặc `accounts.google.com`; `aud` đúng client ID; `exp`/`iat` (lệch tối đa 60 giây); `nonce` khớp; **bắt buộc `email_verified = true`**;
   - trả token của hệ thống (phiên mới như AUTH-01) hoặc mã trạng thái.

**Env:** `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`. Thiếu biến nào thì nút Google không hiện (`GET /api/auth/config` trả `googleEnabled: false`) và các route Google trả 503.

**Ghép tài khoản** (quan trọng cho an toàn):

| Trường hợp | Xử lý |
|---|---|
| Đã có user với `google_sub` này | Đăng nhập (vẫn kiểm `pending`/`disabled` như AUTH-01) |
| Có user cùng email, `email_verified = true` | Tự liên kết `google_sub`, đăng nhập, gửi email thông báo "đã liên kết Google" (nếu AUTH-02 đã có) |
| Có user cùng email, `email_verified = false` | Google chứng minh người này sở hữu email. Đánh dấu đã xác minh, liên kết, **xóa mật khẩu (NULL) và thu hồi mọi phiên**. Lý do: chặn kiểu chiếm tài khoản bằng cách đăng ký trước email của người khác. Giữ nguyên `status` |
| Chưa có user | Tạo user `pending`, `email_verified = true`, `password = NULL`, tên lấy từ Google. Trả mã `ACCOUNT_PENDING`; gửi email "có tài khoản chờ duyệt" cho admin nếu AUTH-02 đã có. Việc tạo vẫn chịu cờ `AUTH_SIGNUP_ENABLED`: cờ tắt thì không tạo user mới |
| `mode: 'link'` | Gắn `google_sub` vào user đang đăng nhập (lấy `user_id` từ `oauth_states`, không tin dữ liệu từ trình duyệt). `google_sub` đã thuộc user khác → từ chối |

**Gỡ liên kết:** `POST /api/auth/google/unlink` chỉ cho phép khi tài khoản có mật khẩu. Giao diện gỡ liên kết thuộc AUTH-05.

## Kiểm thử không phụ thuộc Google thật

- Unit/integration: tự sinh cặp khóa RSA trong test, dựng JWKS và ID token giả; token endpoint và JWKS dùng `fetch` inject được.
- Browser E2E: script test chạy một **máy chủ OIDC giả** cục bộ (`scripts/fake-oidc.mjs`, `node:http`, khóa RSA sinh lúc chạy) với các endpoint authorize/token/JWKS. Chế độ `sandbox` cho phép đặt các URL này bằng env (`GOOGLE_OAUTH_*_URL`). **Chế độ `live` luôn dùng URL thật của Google** và bỏ qua các env đó (có test).

## Việc cần làm

1. Migration `0005_oauth_states.sql` (idempotent; đổi số nếu trùng với PR khác).
2. `routes/auth/google.ts`: `start`, `callback`, `unlink`; module kiểm ID token `apps/chat-api/src/auth/google-oidc.ts`.
3. Giao diện:
   - nút "Tiếp tục với Google" trên màn hình đăng nhập (và đăng ký nếu AUTH-02 đã có);
   - view/trang callback có trạng thái đang xử lý, thành công, chờ duyệt, lỗi.
4. Thêm tên biến env (không có giá trị) vào `.env.example`.

## Tiêu chí nghiệm thu

- [ ] Test kiểm ID token: từ chối khi:
  - sai chữ ký, `kid` lạ không có trong JWKS mới;
  - `iss` sai, `aud` sai, hết hạn, `nonce` sai;
  - `email_verified` false, thuật toán khác RS256 (kể cả `none`).
- [ ] Test `state`: dùng lại, hết hạn, không tồn tại đều bị từ chối; hai callback đồng thời cùng `state` chỉ một thành công (PostgreSQL thật).
- [ ] Test PKCE: `code_verifier` gửi tới token endpoint khớp `code_challenge` đã gửi Google.
- [ ] Test đủ năm trường hợp của bảng ghép tài khoản, đặc biệt: tài khoản email chưa xác minh bị Google "nhận lại" thì mật khẩu cũ không còn đăng nhập được và phiên cũ bị thu hồi.
- [ ] Test `mode: 'link'` không thể gắn vào user khác bằng cách sửa dữ liệu phía trình duyệt; `google_sub` trùng bị từ chối.
- [ ] Test `unlink` bị từ chối khi tài khoản không có mật khẩu.
- [ ] Test `live` bỏ qua env URL giả; thiếu env Google thì `googleEnabled: false`.
- [ ] Test không có `code`, token, `client_secret` trong log.
- [ ] Browser E2E với máy chủ OIDC giả:
  - người mới đăng nhập Google → màn hình "chờ duyệt";
  - admin duyệt (DB hoặc AUTH-03) → đăng nhập Google vào được chat;
  - URL sau callback không còn `code`/`state`.
- [ ] Test mới fail trước khi sửa; `npm run check` exit 0; `npm run test:browser:v3` đạt hết.

## Kết quả (agent thi công điền)

- PR:
- Commit:
- Tài liệu Google đã đọc (đường dẫn, ngày):
- Test đã chạy và kết quả:
- Điều chưa làm hoặc khác với task card:
