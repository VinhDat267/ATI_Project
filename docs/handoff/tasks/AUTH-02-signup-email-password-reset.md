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

- [x] Test migration chạy hai lần (PostgreSQL thật).
- [x] Test đăng ký:
  - tạo `pending` + chưa xác minh + một email trong outbox;
  - email đã tồn tại: cùng phản hồi HTTP, không tạo tài khoản, outbox có thư "có người thử đăng ký";
  - mật khẩu < 12 ký tự bị từ chối.
- [x] Test token:
  - DB chỉ có hash;
  - token hết hạn, đã dùng, sai mục đích đều bị từ chối;
  - tạo token mới làm token cũ hết hiệu lực;
  - hai request dùng cùng token đồng thời chỉ một thành công (PostgreSQL thật).
- [x] Test quên mật khẩu:
  - email lạ và email có thật trả phản hồi giống hệt;
  - đặt lại xong thì mọi phiên cũ bị thu hồi (refresh cũ trả 401);
  - tài khoản chỉ có Google đặt được mật khẩu;
  - `email_verified` thành `true`.
- [x] Test giới hạn tần suất (đồng hồ giả) cho signup, forgot, resend.
- [x] Test `live` thiếu biến SMTP thì không khởi động; `SmtpEmailSender` dựng đúng transport (inject transport giả, không gửi thật trong test).
- [x] Test không có token/link trong log (bắt log trong test).
- [x] Browser E2E (sandbox, PostgreSQL thật): đăng ký → đọc link trong `email_outbox` → xác minh → màn hình "chờ duyệt" → admin duyệt (qua AUTH-03 nếu đã có, nếu chưa thì đổi trạng thái trực tiếp trong DB) → đăng nhập. Quên mật khẩu → link trong outbox → đặt mật khẩu → đăng nhập bằng mật khẩu mới; mật khẩu cũ bị từ chối.
- [x] Test mới fail trước khi sửa; `npm run check` exit 0; `npm run test:browser:v3` đạt hết.

## Kết quả (agent thi công điền)

- PR: https://github.com/VinhDat267/ATI_Project/pull/52; review/local checks đạt, chờ CI cuối; chưa merge.
- Commit: backend `99b539c5315c4ea4aead14a280cec87d3ed947cd`; frontend/browser và regression HTTP `9cefe3ecd249d721640309c660f9e5c8ae5c0115`; nhật ký đi kèm commit tài liệu kế tiếp.
- Test đã chạy và kết quả:
  - RED PostgreSQL/HTTP: 13/13 fail vì endpoint chưa có (404) hoặc hai bảng chưa có; RED email/config được chạy lại với fixture khóa mã hóa đúng, 3 cấu hình fail như dự kiến; RED giao diện 5/5 fail; RED stale-login ở repo tạo phiên bằng snapshot cũ, và RED HTTP với caller trước sửa trả 200 thay vì 401.
  - GREEN: 20/20 backend/email mới; 69/69 auth + config hiện có tại checkpoint backend; thêm regression HTTP snapshot mật khẩu cũ 1/1 pass trên code cuối; toàn bộ web workspace 189/189 pass. Typecheck API và web, `git diff --check` exit 0.
  - Root chạy `npm run check` trên checkpoint `99b539c`: exit 0, 983 v3 + 165 evaluation offline, typecheck/build/credential scan/launcher/env guards đạt. Đây là bằng chứng checkpoint backend, chưa phải check canonical của head frontend cuối.
  - Suite API rộng trên DB riêng đã migrate: 218/223 pass, năm timeout ở các ca cũ (CLI provision; hai memory snapshot; hai startup reconciliation) khi các worker chạy đồng thời. Không tăng timeout hoặc sửa các test đó. Root chịu trách nhiệm chạy canonical tuần tự trên head tích hợp cuối.
  - Bằng chứng cục bộ: `C:/Users/VinhDat/.codex/visualizations/2026/10/04/auth02-auth03-fe03/AUTH02/`; browser spec mới đã đăng ký scenario `auth02`, chưa chạy ở worktree thi công theo lịch cổng của root.
- Điều chưa làm hoặc khác với task card:
  - Migration dùng `0005_auth_tokens_outbox.sql` vì `0004_conversation_titles.sql` đã có. Migration được thực thi hai lần trên PostgreSQL thật và giữ nguyên token đã dùng/outbox.
  - Thêm `SessionRepo.create(..., expectedPasswordHash?)` khóa hàng user và kiểm lại password/status để chặn login đang chạy trước reset hoặc disable; token consumption và reset/password/session revocation cùng transaction.
  - Cờ đăng ký vẫn mặc định `false`; AUTH-03/root đổi mặc định chỉ khi cả hai tính năng cùng có mặt. Email sandbox/CI dùng outbox, SMTP transport chỉ được kiểm qua injection, không gọi SMTP/email/provider/service thật.
  - Browser AUTH-02, canonical check trên head cuối, review độc lập, CI và PR: **NOT_RUN/OPEN tại thời điểm bàn giao**. Không tuyên bố nghiệm thu sản phẩm thật hoặc production readiness.
## Xác minh cuối của root/reviewer (04/10/2026)

- PR: https://github.com/VinhDat267/ATI_Project/pull/52; base main, nhánh `vinhdat/feat-auth-02-signup-email`. Chưa merge; CI trên head cuối còn chờ.
- `npm run check` trên code hoàn chỉnh `7d7dd66`: exit 0, **989 v3 + 165 evaluation offline**, typecheck/build/credential scan/launcher 1/env guards 3 đạt. Các timeout do tải đồng thời không còn trong phép chạy canonical tuần tự.
- `npm run test:browser:v3` sau delta test-only `4f50970`: exit 0, **22/22** qua 10 scenario. Header Chromium no-referrer thiếu hoặc rỗng đều không chứa URL; test vẫn từ chối URL. Signup/outbox/verification/pending/reset/revocation/mật khẩu cũ đã kiểm bằng browser + PostgreSQL thật.
- Review độc lập: **Đạt**, không có P1/P2 được xác nhận; reviewer chạy lại **21/21 API/email PostgreSQL + 5/5 frontend**. Delta `7d7dd66..4f50970` chỉ assertion browser, không đổi runtime.
- Bằng chứng canonical và review: thư mục local `C:/Users/VinhDat/.codex/visualizations/2026/10/04/auth02-auth03-fe03/`, các log `auth02-final-check.log`, `auth02-final-browser-rerun.log`, `auth02-independent-focused-verified.log`, `auth02-independent-web.log`. Không commit raw artifacts.
- SMTP/model/provider/SaaS thật vẫn **NOT_RUN**; không tuyên bố production readiness. AUTH-03 xếp trên PR này để bật mặc định đăng ký khi cả đăng ký và duyệt cùng có mặt.
