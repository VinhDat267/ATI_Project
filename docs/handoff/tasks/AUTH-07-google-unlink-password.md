# AUTH-07 · Kiểm tra mật khẩu hiện tại khi gỡ Google

**Trạng thái:** đang triển khai · **Nhánh:** `fix/auth-google-unlink-password` · **Phụ thuộc:** AUTH-04/05 đã merge; là điều kiện của FE-09.

## Quyết định phạm vi

Ngày 09/10/2026, chủ dự án yêu cầu FE-08/FE-09 song song và xác nhận thêm PR backend riêng để kiểm tra mật khẩu thật khi gỡ Google. API hiện tại bỏ qua request body và chỉ kiểm tra tài khoản đã có mật khẩu. Thay đổi này thực hiện riêng, không đưa backend vào diff FE-09.

## Việc cần làm

1. `POST /api/auth/google/unlink` yêu cầu `currentPassword`, kiểm tra mật khẩu thật của người dùng đang đăng nhập trước khi gỡ liên kết; thiếu/sai mật khẩu giữ nguyên liên kết và phiên.
2. Dùng giới hạn nhập sai hiện có; lỗi sai mật khẩu không trả 401 gây xoá phiên, 429 có `Retry-After`. Không tạo phiên đăng nhập phụ hoặc đổi mật khẩu để kiểm tra.
3. Giữ kiểm tra phiên, trạng thái người dùng, không cho gỡ khi chưa có mật khẩu, và các quy tắc quản lý phiên hiện có. Chống thay đổi mật khẩu/phiên giữa kiểm tra và ghi bằng transaction/điều kiện cập nhật thật.
4. Cập nhật tối thiểu caller frontend cũ và fixture/browser liên quan để PR tự chạy được. FE-09 thay caller bằng modal của bản React trên nhánh phụ thuộc PR này; API client tiếp tục dùng protected transport.

## Tiêu chí nghiệm thu

- [x] RED-before-GREEN bằng HTTP và PostgreSQL thật: thiếu/sai mật khẩu bị chặn, mật khẩu đúng gỡ thành công.
- [x] Tài khoản chưa có mật khẩu không gỡ được; trạng thái Google và phiên không đổi khi lỗi.
- [x] Giới hạn nhập sai có `Retry-After`; phiên hiện tại vẫn dùng được sau lỗi sai mật khẩu.
- [x] Có bằng chứng concurrency thật cho điều kiện mật khẩu/phiên còn đúng lúc ghi.
- [x] Test AUTH-04/05 hiện có được giữ và cập nhật caller; không dùng mock hình thức hoặc gửi mật khẩu vào log.
- [ ] `npm run check` và `npm run test:browser:v3` exit 0, CI đúng head xanh.
- [ ] Log riêng, review độc lập, PR riêng; không sửa CURRENT-STATE/ROADMAP, không tự merge.

## Ngoài phạm vi

Port hình thức FE-08/FE-09, thay đổi luồng Google callback/link, model hoặc dịch vụ thật, migration hay dependency mới.

## Kết quả

- Nhánh/worktree: `fix/auth-google-unlink-password`, `C:/Users/VinhDat/orca/workspaces/ATI_Project/auth-google-unlink-password`, base `129d9c0`.
- Code: `fe9914f54ac12054e3df0218b9ccf5c57f66bf2e`; sửa hai điểm sau review tại `be9417da011bfc3a5be935f7d226a6bfe00329fa`. PR/CI/review độc lập do parent bàn giao, chưa merge.
- `POST /api/auth/google/unlink` nhận `{ currentPassword }`: input thiếu/không phải chuỗi/rỗng/quá 128 ký tự trả 400 `CURRENT_PASSWORD_REQUIRED`; sai trả 400 `INVALID_CURRENT_PASSWORD`; dùng cùng `LoginFailures` với login/đổi mật khẩu, 429 có `Retry-After`. Không tạo phiên hay đổi mật khẩu để kiểm tra.
- Repository đối chiếu password hash đã xác minh dưới khóa user và session; password đổi ở nơi khác trả 409 `PASSWORD_CHANGED_ELSEWHERE`. Giữ 409 `PASSWORD_REQUIRED`, active-user/session check, Google session-creation guard và các quy tắc quản lý phiên hiện có. Sau khi lấy đủ khóa mới đọc clock để chặn hết hạn tự nhiên trong thời gian chờ.
- Caller cũ chỉ bổ sung form xác nhận có `type="password"`, không gửi khi rỗng, xóa giá trị khi hủy/thành công. `apiClient.unlinkGoogle(currentPassword: string)` giữ protected request, password được chuyển tiếp cả sau refresh. FE-09 sở hữu phần đưa modal prototype vào app.
- Bằng chứng local: baseline API **34/34**, web **59/59**; RED backend **5 fail/8 pass**, web **3 fail/48 pass**; sau review expiry RED **2 fail**, masked caller RED **4 fail/16 pass**. Focused cuối **49 API + 61 web**, exit 0. `npm run check` exit 0: **1.587 v3 + 173 eval**, typecheck/build/security/launcher/env/OIDC đạt.
- Canonical browser **78/78, 11 nhóm, exit 0**, lần full đầu trên đúng code `be9417d`; [log AUTH-07](../log/2026-10-09-codex-auth-07-google-unlink-password.md). Local gates đạt; hai tiêu chí còn mở cần exact-head CI, PR và review độc lập. PG16 tmpfs riêng `56550`, API `3050`, web `5150`; API/web đã dừng, giữ DB cho review. Không gọi Google/SMTP/model/dịch vụ thật, không sửa CURRENT-STATE/ROADMAP, không tự merge.
