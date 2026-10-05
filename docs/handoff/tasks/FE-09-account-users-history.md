# FE-09 · Trang Tài khoản, Quản lý người dùng, Lịch sử

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/fe-09-account-users-history` · **Phụ thuộc:** FE-04 đã merge · **Mốc:** 27/10/2026
**Đặc tả:** mục 4, 6 · **Bản mẫu:** `account.html`, `users.html`, `history.html`

## Vì sao quan trọng

Ba trang này đã có chức năng (AUTH-03, AUTH-05, FE-02) nhưng giao diện cũ. Bản mẫu đã được review để chỉ hiện đúng những gì API hỗ trợ.

## Việc cần làm

1. **`/account`** (thay `AccountView`):
   - hồ sơ: đổi tên; email chỉ đọc kèm trạng thái xác minh; vai trò;
   - đổi mật khẩu ≥ 12 ký tự; câu đúng: "Sau khi đổi mật khẩu, các thiết bị khác sẽ bị đăng xuất và các link đặt lại mật khẩu cũ hết hiệu lực.";
   - phiên đăng nhập: thiết bị/trình duyệt và lần dùng gần nhất (không vị trí), thu hồi từng phiên, "Đăng xuất khỏi mọi thiết bị khác";
   - Google: liên kết/gỡ; gỡ cần mật khẩu hiện tại; tài khoản chưa có mật khẩu thì nút gỡ bị khoá kèm hướng dẫn dùng "Quên mật khẩu";
   - không có điểm "bảo mật: tốt".
2. **`/admin/users`** (thay `AdminUsersView`):
   - tab Chờ duyệt: chỉ "Duyệt & kích hoạt"; tài khoản chưa xác minh email có nút Duyệt bị khoá kèm lý do; không có Từ chối, Mời;
   - tab Thành viên: khoá (xác nhận: "bị đăng xuất khỏi mọi thiết bị…"), mở khoá, đổi vai trò; dòng của chính mình không có thao tác;
   - duyệt xong báo "Đã duyệt. Hệ thống gửi email báo cho người dùng."; khi máy chủ chưa cấu hình email thì hiện đúng lỗi 503 của API.
3. **`/history`:** lịch sử hội thoại của chính người dùng (không có "toàn bộ nhóm", không lọc theo người yêu cầu), tìm theo tiêu đề, đổi tên tại chỗ (Enter lưu, Esc huỷ), "Tải thêm" theo cursor, mở lại hội thoại tới `/c/:id`. Không làm bộ lọc trạng thái/công cụ (đặc tả mục 9.3).
4. Giữ các bảo đảm AUTH-05/#73: phản hồi lưu tên đến muộn không xoá draft mới; link/unlink dùng protected transport.

## Tiêu chí nghiệm thu

- [ ] Test: không có thao tác Từ chối/Mời; Duyệt bị khoá khi chưa xác minh email.
- [ ] Test: gỡ Google bắt buộc mật khẩu; tài khoản chưa có mật khẩu không gỡ được.
- [ ] Test: đổi tên hội thoại lưu bằng Enter, huỷ bằng Esc, phản hồi muộn không ghi đè tên vừa gõ lại.
- [ ] Các test `account-view`, `account-action-regressions`, `admin-users`, `app-routing`, browser AUTH-03/AUTH-05/FE-02 vẫn xanh.
- [ ] Không cuộn ngang ở 375px; chế độ tối đạt tương phản.
- [ ] `npm run check` và `npm run test:browser:v3` exit 0.

## Ngoài phạm vi

Từ chối tài khoản, mời thành viên, lịch sử cả nhóm, lọc lịch sử theo trạng thái/công cụ (cần API mới, chưa lập kế hoạch).

## Kết quả

_(agent thi công điền)_
