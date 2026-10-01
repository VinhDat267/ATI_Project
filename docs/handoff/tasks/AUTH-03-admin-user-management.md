# AUTH-03 · Trang quản trị người dùng: duyệt, khóa, phân quyền

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/auth-03-admin-users` · **Phụ thuộc:** AUTH-01 đã merge · **Làm song song với:** AUTH-02, AUTH-04

Đọc trước: [yêu cầu chung của mảng tài khoản](AUTH-common.md).

## Mục tiêu

Admin duyệt tài khoản mới, khóa/mở khóa tài khoản, cấp hoặc bỏ quyền admin. Đây là điều kiện để bật đăng ký mở, vì người được duyệt dùng được credentials chung của nhóm.

## Việc cần làm

1. **API** `routes/auth/admin-users.ts`. Mọi route kiểm `isAdmin` **bằng dữ liệu trong DB** (không tin claim trong token).
   - `GET /api/admin/users`: lọc theo `status`, tìm theo email/tên, phân trang. Trả:
     - `id`, `email`, `name`, `status`, `role`, `emailVerified`;
     - `hasPassword`, `hasGoogle`, `createdAt`;
     - số phiên đang mở.

     Không bao giờ trả hash mật khẩu.
   - `POST /api/admin/users/:id/approve`: chỉ khi `pending` và `email_verified = true`. Sau đó gửi email "tài khoản đã được duyệt" bằng hàm gửi email của AUTH-02 (nếu AUTH-02 chưa merge thì bỏ qua phần gửi, ghi trong PR).
   - `POST /api/admin/users/:id/disable`: chuyển `disabled` và thu hồi mọi phiên. `POST /api/admin/users/:id/enable`: chuyển về `active`.
   - `POST /api/admin/users/:id/role` với `{ role: 'member' | 'admin' }`.
2. **Ràng buộc an toàn** (kiểm trong một transaction trên PostgreSQL):
   - admin không tự khóa hay tự bỏ quyền admin của mình;
   - luôn còn ít nhất **một** admin `active`;
   - người không phải admin gọi API nhận 403.
3. **Giao diện** view `admin-users`, chỉ hiện với admin (mục "Quản lý người dùng" trong `UserNavMenu`):
   - tab "Chờ duyệt" có số lượng; danh sách tất cả người dùng; ô tìm kiếm;
   - nút Duyệt / Khóa / Mở khóa / Đổi vai trò, mỗi nút có hộp xác nhận. Hộp xác nhận "Duyệt" nhắc rõ: "Người này sẽ dùng được các service đã kết nối của nhóm (Trello, Slack, GitHub…)".
4. **Bật đăng ký:** nếu AUTH-02 đã merge trước task này, đổi mặc định của `AUTH_SIGNUP_ENABLED` thành `true` trong PR này (xem AUTH-02).
5. Ghi lại mỗi thao tác quản trị: ai, làm gì, với ai, lúc nào. Có thể là log có cấu trúc trên console; không bắt buộc thêm bảng.

## Tiêu chí nghiệm thu

- [ ] Test quyền: member gọi mọi route admin nhận 403; admin xác định theo DB. Một người vừa bị bỏ quyền admin mà còn access token cũ vẫn bị 403.
- [ ] Test duyệt: chỉ duyệt được `pending` đã xác minh email; duyệt xong thì đăng nhập được; email thông báo nằm trong outbox (nếu AUTH-02 đã có).
- [ ] Test khóa: người bị khóa bị từ chối **ngay** ở request tiếp theo (nhờ middleware của AUTH-01), refresh trả 401; mở khóa xong thì đăng nhập lại được.
- [ ] Test ràng buộc: không tự khóa, không tự bỏ quyền; hai admin cùng bỏ quyền của nhau đồng thời thì vẫn còn ít nhất một admin (PostgreSQL thật, transaction có khóa dòng).
- [ ] Test response không chứa hash mật khẩu.
- [ ] Browser E2E: admin thấy tài khoản chờ duyệt → duyệt → tài khoản đó đăng nhập được; admin khóa → phiên của người đó bị đẩy về màn hình đăng nhập ở thao tác tiếp theo; member không thấy mục "Quản lý người dùng".
- [ ] Test mới fail trước khi sửa; `npm run check` exit 0; `npm run test:browser:v3` đạt hết.

## Kết quả (agent thi công điền)

- PR:
- Commit:
- Test đã chạy và kết quả:
- Điều chưa làm hoặc khác với task card:
