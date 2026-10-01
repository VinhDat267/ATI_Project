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

- PR:
- Commit:
- Test đã chạy và kết quả:
- Điều chưa làm hoặc khác với task card:
