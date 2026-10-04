# AUTH-05 · Trang quản lý tài khoản

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/auth-05-account-page` · **Phụ thuộc:** AUTH-01 đã merge; phần liên kết Google cần AUTH-04 · **Làm song song với:** AUTH-02 → AUTH-04

Đọc trước: [yêu cầu chung của mảng tài khoản](AUTH-common.md).

## Nội dung trang "Tài khoản"

Mở từ mục "Tài khoản" trong `UserNavMenu`, view `account`.

1. **Hồ sơ:** email (chỉ đọc), tên (sửa được, 1–100 ký tự), ngày tạo, vai trò.
2. **Mật khẩu:**
   - có mật khẩu: "Đổi mật khẩu" yêu cầu mật khẩu hiện tại + mật khẩu mới. Đổi xong thu hồi **mọi phiên khác**, giữ phiên hiện tại;
   - chưa có mật khẩu (tài khoản chỉ dùng Google): hiện hướng dẫn dùng "Quên mật khẩu" để đặt mật khẩu qua email (AUTH-02), không đặt trực tiếp khi chưa xác thực lại.
3. **Phương thức đăng nhập:** trạng thái mật khẩu, trạng thái Google (email Google đã liên kết nếu có).
   - Nút "Liên kết Google" dùng `mode: 'link'` của AUTH-04.
   - Nút "Gỡ liên kết" chỉ bật khi có mật khẩu.
   - Ẩn phần này nếu `googleEnabled: false`.
4. **Phiên đăng nhập:** danh sách phiên đang mở (thiết bị/trình duyệt rút gọn từ `user_agent`, thời điểm tạo, lần dùng cuối, đánh dấu "phiên này"). Nút "Đăng xuất phiên này" cho từng phiên khác, và "Đăng xuất khỏi mọi thiết bị khác".
5. **Không có** xóa tài khoản hay đổi email trong phạm vi môn học. Người dùng muốn ngừng dùng thì nhờ admin khóa (AUTH-03). Trang ghi rõ điều này.

## API

Đặt trong `routes/auth/account.ts`:
- `PATCH /api/account/profile`;
- `POST /api/account/change-password`;
- `GET /api/account/sessions`;
- `POST /api/account/sessions/:id/revoke`;
- `POST /api/account/sessions/revoke-others`.

Mọi route chỉ thao tác trên phiên và dữ liệu của chính người dùng (lấy từ token, kiểm lại trong DB).

## Tiêu chí nghiệm thu

- [ ] Test đổi mật khẩu:
  - sai mật khẩu hiện tại bị từ chối và tính vào giới hạn đăng nhập sai;
  - đổi xong, các phiên khác bị thu hồi, phiên hiện tại vẫn dùng được;
  - mật khẩu mới < 12 ký tự bị từ chối.
- [ ] Test phiên: người dùng A không xem được hay thu hồi phiên của người dùng B (403/404); phiên đã thu hồi biến mất khỏi danh sách và refresh của nó trả 401.
- [ ] Test sửa tên: tên rỗng hoặc quá dài bị từ chối; tên mới hiện trong `GET /api/auth/me` và access token phát hành sau đó.
- [ ] Test giao diện:
  - tài khoản chỉ có Google không thấy ô "mật khẩu hiện tại" mà thấy hướng dẫn;
  - nút "Gỡ liên kết" bị khóa khi không có mật khẩu.
- [ ] Browser E2E:
  - đăng nhập ở hai context trình duyệt, ở context 1 bấm "Đăng xuất khỏi mọi thiết bị khác", context 2 bị đưa về màn hình đăng nhập ở thao tác tiếp theo;
  - đổi tên thì tên mới hiện trên `UserNavMenu`.
- [ ] Test mới fail trước khi sửa; `npm run check` exit 0; `npm run test:browser:v3` đạt hết.

## Kết quả (agent thi công điền)

- PR: nhánh `feat/auth-05-account-page` (Claude Code thi công theo yêu cầu của người dùng).
- Commit:
  - test RED backend `5d768d3`;
  - backend `f52f8a9`;
  - test RED frontend `c0df781`;
  - frontend `3d2e1e9`;
  - browser `87cbf2d`;
  - test link reset `7d6d129`, sửa test đó `2f6d512`;
  - kèm commit tài liệu.
- Đã làm:
  - **API** (`routes/auth/account.ts`, mount `/api/account`):
    - `GET /api/account`: hồ sơ, ngày tạo, vai trò, phương thức đăng nhập, email Google;
    - năm route theo task card.
    - Mọi route qua middleware phiên. Thao tác trên phiên của người khác trả 404, giống phiên không tồn tại.
  - **Đổi mật khẩu:**
    - Sai mật khẩu hiện tại trả **400** `INVALID_CURRENT_PASSWORD`, không trả 401 (401 làm client đăng xuất). Lần sai được tính vào giới hạn đăng nhập sai (`LoginFailures`, tách từ route đăng nhập và dùng chung một instance); quá giới hạn trả 429.
    - Đổi xong trong một transaction có khóa dòng user: thu hồi mọi phiên khác và vô hiệu link đặt lại mật khẩu chưa dùng.
    - Tài khoản chỉ có Google trả 409 `PASSWORD_NOT_SET`.
  - **Phiên:** nhãn thiết bị rút gọn từ `user_agent` ở server (`auth/user-agent.ts`); API không trả chuỗi `user_agent` gốc.
  - **Migration `0008_account_google_email.sql`** (idempotent) thêm `users.google_email`.
    - Ghi mỗi lần liên kết hoặc đăng nhập Google; xóa khi gỡ liên kết.
    - Liên kết cũ hiện "Đã liên kết" không kèm email, cho tới lần đăng nhập Google kế tiếp.
  - **Giao diện:**
    - `AccountView` ở `/account`, mở từ mục "Tài khoản" trong `UserNavMenu`.
    - Tên mới ghi vào user đang đăng nhập nên menu cập nhật ngay.
    - Màn hình callback Google sau khi liên kết có nút "Về trang tài khoản".
- Test đã chạy và kết quả (04/10/2026, PostgreSQL tạm ở 55533):
  - **RED:**
    - backend 21/21 fail đúng lý do (route 404, chưa có module nhãn thiết bị);
    - frontend 8/8 fail, cộng 1 test nút "Về trang tài khoản" fail trước khi sửa;
    - browser `AUTH-05:` trên code chỉ có backend: hết 30 s chờ nút "Tài khoản".
  - **GREEN:**
    - `tests/auth` **130/130** (22 test mới, gồm test link reset);
    - `account-view.test.tsx` **9/9**;
    - browser `AUTH-05:` `--repeat-each=3` **3/3**.
  - **Mutation:** **20/20** bị bắt (13 backend, 7 frontend).
    - Lần chạy đầu, test link reset fail ngay trên code thật: route reset trả 503 vì app trong test không có email sender. Đây là lỗi của test, đã sửa ở `2f6d512`.
    - Vì test đó luôn fail, kết quả lần đầu của mutation B3 không có giá trị. Chạy lại B3 sau khi sửa thì bị bắt đúng bởi test đó. Các mutation khác bị bắt bởi test riêng của chúng.
  - **`npm run check`:** exit 0; v3 1.219 = 47 schema + 340 adapters + 180 planner + 25 executor + 331 API + 296 web; eval 165; typecheck, build, quét bản build đạt.
  - **`npm run test:browser:v3`:** exit 0, 28/28 ca qua 11 scenario (default 16, gồm AUTH-05).
- Điều chưa làm hoặc khác với task card:
  - **Thêm `GET /api/account`**, ngoài 5 route trong task card, để có ngày tạo và email Google.
  - **"Lần dùng cuối"** là lần refresh token gần nhất: access token không ghi `last_used_at` cho từng request.
  - **Gỡ liên kết Google** không có hộp xác nhận, vì liên kết lại được ngay.
  - **Liên kết/gỡ Google chỉ test bằng unit test và repo trên PostgreSQL.** Browser không chạy luồng Google ở trang tài khoản, vì sandbox không bật Google; scenario `auth04` vẫn chạy luồng đăng nhập bằng OIDC giả.
  - Google và SMTP thật thuộc AUTH-06.
