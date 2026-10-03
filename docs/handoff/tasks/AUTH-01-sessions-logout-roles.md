# AUTH-01 · Phiên đăng nhập lưu ở server, đăng xuất thật, trạng thái và vai trò tài khoản

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/auth-01-sessions-logout-roles` · **Phụ thuộc:** không · **Chặn:** AUTH-02 → AUTH-05

Đọc trước: [yêu cầu chung của mảng tài khoản](AUTH-common.md).

## Mục tiêu

Đăng xuất phải thu hồi được token ở server (đúng đặc tả §8.1). Tài khoản có trạng thái (`pending`/`active`/`disabled`) và vai trò (`member`/`admin`) để các task sau dùng. Đồng thời dựng khung route và dữ liệu cho AUTH-02 → AUTH-05.

## Việc cần làm

1. **Migration `db/v3/0003_auth_sessions.sql`** (idempotent, xem yêu cầu chung): thêm các cột của `users` và bảng `auth_sessions` như mục "Dữ liệu dùng chung". Index `auth_sessions(user_id)`, `auth_sessions(refresh_token_hash)`.
2. **Refresh token là chuỗi ngẫu nhiên**, 32 byte, không còn là JWT:
   - mỗi lần đăng nhập tạo một dòng `auth_sessions` (lưu hash, hạn 7 ngày, `user_agent`);
   - access JWT có thêm claim `sid` (ID phiên).
3. **Xoay vòng refresh token:** `POST /api/auth/refresh` đổi token cũ lấy token mới và cập nhật hash.
   - Dùng lại một refresh token **đã bị thay** thì thu hồi cả phiên đó: dấu hiệu token bị đánh cắp.
   - **Ngoại lệ cho nhiều tab:** các tab dùng chung `localStorage` nên hai tab có thể cùng refresh bằng một token. Frontend hiện chỉ gộp các lần refresh **trong một tab** (`refreshPromise` trong `api-client.ts`). Vì vậy server lưu thêm hash của token liền trước và thời điểm xoay (`previous_token_hash`, `rotated_at`). Dùng lại token liền trước **trong 30 giây** sau khi xoay thì trả 409 `{ code: 'REFRESH_ROTATED' }`, **không** thu hồi phiên; sau 30 giây thì xử lý như bị đánh cắp. Khi nhận `REFRESH_ROTATED`, frontend đọc lại `localStorage`: có token mới (do tab khác lưu) thì dùng tiếp, không có thì đăng xuất.
   - Phiên hết hạn hoặc đã thu hồi trả 401.
   - Hai request refresh đồng thời với cùng token: đúng một request thành công. Test bằng PostgreSQL thật (`UPDATE … WHERE refresh_token_hash = $1 AND revoked_at IS NULL RETURNING`), không mock.
4. **Đăng xuất:**
   - `POST /api/auth/logout` thu hồi phiên hiện tại;
   - `POST /api/auth/logout-all` thu hồi mọi phiên của người dùng;
   - frontend `handleLogout` gọi API rồi mới xóa token trong trình duyệt. Lỗi mạng khi gọi API vẫn xóa token trong trình duyệt và không chặn người dùng.
5. **Middleware kiểm database:** khi có PostgreSQL, `createAuthMiddleware` kiểm `sid` chưa bị thu hồi và người dùng đang `active` bằng **một** truy vấn có index. Nhờ vậy đăng xuất và khóa tài khoản có hiệu lực ngay, không phải chờ access token hết 15 phút. Chế độ bộ nhớ giữ hành vi cũ.
6. **Trạng thái khi đăng nhập:**
   - `pending` trả 403 `{ code: 'ACCOUNT_PENDING' }`;
   - `disabled` trả 403 `{ code: 'ACCOUNT_DISABLED' }`;
   - chỉ trả mã này **sau khi** mật khẩu đúng, để không lộ tài khoản có tồn tại hay không;
   - frontend hiện thông báo tiếng Việt tương ứng.
7. **Vai trò admin:**
   - `isAdmin(user)` = `role = 'admin'` **hoặc** ID nằm trong `SERVICE_ADMIN_USER_IDS` (giữ tương thích);
   - quyền sửa credentials dùng chung (`services-routes.ts`) dùng `isAdmin`;
   - `GET /api/auth/me` trả thêm `role`, `status`, `emailVerified`, `hasPassword`, `hasGoogle`.
8. **CLI `provision-user`:** tạo hoặc cập nhật tài khoản với `role = 'admin'`, `status = 'active'`, `email_verified = true`. Đây là cách tạo admin đầu tiên.
9. **Chặn đoán mật khẩu** cho `POST /api/auth/login` theo yêu cầu chung.
10. **Tách route:** `routes/auth-routes.ts` thành `routes/auth/index.ts` + `routes/auth/session.ts` (login, refresh, logout, logout-all, me). Đường dẫn API không đổi. Thêm `GET /api/auth/config` (công khai), trả `{ signupEnabled, googleEnabled }`; ở task này cả hai luôn `false`, AUTH-02 và AUTH-04 nối vào. Màn hình đăng nhập đọc route này để quyết định hiện nút nào.
11. **Frontend:** `api-client.ts` lưu refresh token mới sau mỗi lần refresh. Refresh trả 401 thì đưa về màn hình đăng nhập.

## Không làm trong task này

Đăng ký, email, quên mật khẩu (AUTH-02); trang quản trị (AUTH-03); Google (AUTH-04); trang tài khoản (AUTH-05).

## Tiêu chí nghiệm thu

- [ ] Test migration chạy hai lần liên tiếp trên PostgreSQL thật. Tài khoản tạo trước migration thành `active`/`member`/`email_verified`. Tài khoản tạo sau (không ghi rõ trạng thái) mặc định `pending`. Lần chạy thứ hai không đổi dữ liệu.
- [ ] Test refresh xoay vòng; dùng lại token cũ sau 30 giây thì cả phiên bị thu hồi; trong 30 giây thì trả `REFRESH_ROTATED` và phiên còn nguyên; hai refresh đồng thời chỉ một thành công (PostgreSQL thật, đồng hồ giả cho mốc 30 giây).
- [ ] Test frontend: nhận `REFRESH_ROTATED` mà `localStorage` đã có token mới thì request được gửi lại thành công, không đăng xuất.
- [ ] Test đăng xuất: sau `logout`, access token cũ bị từ chối ngay ở API được bảo vệ, refresh token cũ trả 401. `logout-all` thu hồi mọi phiên.
- [ ] Test middleware: phiên bị thu hồi hoặc người dùng `disabled` bị từ chối ngay.
- [ ] Test `pending`/`disabled` chỉ lộ mã trạng thái khi mật khẩu đúng.
- [ ] Test chặn đoán mật khẩu bằng đồng hồ giả: lần sai thứ 6 trong 15 phút bị 429 kèm `Retry-After`; hết thời gian thì đăng nhập lại được.
- [ ] Test `isAdmin` với `role` và với `SERVICE_ADMIN_USER_IDS`; người không phải admin không sửa được credentials dùng chung.
- [ ] Test DB không lưu refresh token dạng gốc (truy vấn bảng, so sánh).
- [ ] Browser E2E: đăng nhập → đăng xuất → bấm Back/Reload không vào lại được chat; refresh token cũ trả 401.
- [ ] Toàn bộ test cũ đạt (test đang giả định refresh là JWT được sửa và ghi rõ trong PR).
- [ ] Test mới fail trước khi sửa; `npm run check` exit 0; `npm run test:browser:v3` đạt hết.

## Kết quả (agent thi công điền)

- PR: [#41](https://github.com/VinhDat267/ATI_Project/pull/41), base `main`; chưa merge.
- Commit: backend `d7efd9f`, frontend `6cd89f8`, sửa giới hạn request đồng thời `66c4d29`, ổn định browser fixture `b24a223`. Đã tích hợp W3-08 từ `main` `c5ce8a0`.
- Test đã chạy và kết quả:
  - RED→GREEN: migration PostgreSQL, session/HTTP, frontend session client (8 ca), logout order/network failure, và burst đoán mật khẩu. Burst 12 request sai trước sửa: 12×401; sau sửa: 5×401 + 7×429 kèm `Retry-After=900`; hết 15 phút đăng nhập được.
  - `npm run check` trên bản sửa burst: exit 0; v3 **927/927** = schemas 47, adapters 317, planner 172, executor 25, API 194, web 172; evaluation **165/165**; strict typecheck, build, production credential scan, launcher 1/1, environment guards 3/3 đều đạt.
  - Browser sandbox/PostgreSQL thật: **16/16**, gồm logout → Back/Reload không vào chat, access/refresh cũ 401, logout-all thu hồi hai browser sessions. Local chạy cùng 9 scenario qua cấu hình ngoài repo trỏ DB tạm được kiểm tra chính xác; canonical `npm run test:browser:v3` chạy ở GitHub CI.
  - Review độc lập tái hiện rồi xác nhận đóng lỗi burst tại `66c4d29`; probe sid khác chủ, CLI thu hồi phiên cũ, migration chạy lại đạt. CI head đầu đã qua `check`, phát hiện race của browser fixture cũ khi reload; `b24a223` sửa test lấy response bằng `APIRequestContext`, CI sẽ chạy lại trên head bàn giao.
- Điều chưa làm hoặc khác với task card:
  - Thêm bảng lịch sử **hash** refresh có FK/cascade để nhận diện replay sau hơn một lần xoay; chỉ token liền trước được grace 30 giây. Không lưu token gốc.
  - Bộ đếm/quản lý request đăng nhập theo một API instance, như AUTH-common; chưa có signup/email/Google/account/admin-user UI.
  - FE-02 [#42](https://github.com/VinhDat267/ATI_Project/pull/42) xếp trên nhánh AUTH-01 vì cùng sửa frontend auth. Thứ tự merge AUTH-01 trước, retarget FE-02 sang main rồi kiểm tra CI. Không sửa CURRENT-STATE/ROADMAP trong PR thi công.
