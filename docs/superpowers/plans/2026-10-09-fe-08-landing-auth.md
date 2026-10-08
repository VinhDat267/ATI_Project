# FE-08 Landing và xác thực

> Triển khai trong worktree FE-08 từ main `129d9c0`; thiết kế chuẩn là task FE-08 và đặc tả UI 07/10. Giữ nguyên backend và prototype markup/classes/CSS; thay JS demo bằng store/API.

1. TDD: baseline AUTH-02/AUTH-04, thêm RED cho trang giới thiệu, mật khẩu tối thiểu, khóa tạm đọc HTTP Retry-After, chờ duyệt và reset success.
2. Chép Landing và CSS; các route home/login/signup/forgot trình bày cùng modal. Bỏ mô phỏng hộp thư và kịch bản đăng nhập, giữ route/email link, capability signup/Google và focus trap.
3. Chép AuthAction và CSS; nối verify/resend/reset/Google callback, trạng thái lỗi đăng nhập. Giữ query clearing, một callback/StrictMode, session ownership và phản hồi muộn. Đồng hồ dùng deadline từ Retry-After; reset success thu hồi phiên cũ theo API.
4. Cập nhật selectors AUTH-02/AUTH-04, thêm browser FE-08 dùng API/PostgreSQL riêng. Chạy focused GREEN, check và canonical browser; giữ regression khác.
5. Chụp từng phần landing/modal và trạng thái AuthAction đối chứng React tại desktop/mobile/light/dark; manifest SHA256 ngoài Git, overflow/reduced-motion assertions. Result/log chỉ ghi gate đã chạy; parent thực hiện review độc lập và PR, không merge.

Pre-flight: Landing/auth share routes and AuthGate; wrappers consume existing AuthViewProps/LoginViewProps. FE-09 owns App/account/admin/history. Parent owns common browser runner inclusion. API client public-auth/login response metadata is agreed with parent; FE-09 method delta is separate.

Ruling: giữ thiết kế đã được phê duyệt và không tạo mẫu mới; cost if wrong: phải đối chứng lại với nguồn React.
