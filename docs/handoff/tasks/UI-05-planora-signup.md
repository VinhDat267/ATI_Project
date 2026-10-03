# UI-05 · Planora: nhận diện, trang công khai và đăng ký email/mật khẩu

**Trạng thái:** đã triển khai, chờ review · **Nhánh:** `Frontend_UXUI` (tên chủ dự án yêu cầu)

## Phạm vi

- Đổi nhận diện hiển thị, logo/favicon sang Planora; ATI là tên môn học, giữ tên kỹ thuật/lịch sử repository.
- Footer công khai dùng chung; section dịch vụ có năng lực thực tế GitHub/Trello/Slack; tinh giản editorial đăng nhập.
- Đăng ký thật: mật khẩu 12–128 ký tự, email xác minh một lần, tài khoản pending, quản trị duyệt trong cài đặt. Không cấp quyền dịch vụ trước khi duyệt.
- Nền tảng cần thiết: phiên PostgreSQL, refresh xoay vòng, logout thu hồi, middleware trạng thái, giới hạn login/signup/resend, SMTP live/outbox sandbox. Tương thích admin env/CLI.
- Không bao gồm Google, quên/đặt lại mật khẩu, sửa hồ sơ, khóa/đổi vai trò quản trị, hay chứng nhận toàn bộ AUTH-01→06. Các task AUTH hiện hữu giữ trạng thái để reviewer đối chiếu phạm vi còn lại.
- Không sửa v2, không sửa CURRENT-STATE/ROADMAP, không gửi email thật trong kiểm thử, không commit/push/deploy trong lượt này.

## Nghiệm thu

- PostgreSQL thật: migration chạy lặp giữ dữ liệu; signup/duplicate cùng phản hồi; hash mật khẩu/token; verify một lần/khi hết hạn; không cho pending vào workspace; duyệt đúng quyền và chỉ đã xác minh; refresh cạnh tranh/logout/replay.
- Frontend: form và lỗi/pending hoạt động, URL token bị xóa, navigation dịch vụ/footer đúng đích; desktop/mobile không tràn ngang, reduced motion giữ nội dung.
- Chạy test/build, lưu ảnh preview, ghi bàn giao. Giữ toàn bộ thay đổi của các lượt trước.

## Kết quả

- Đã triển khai nhận diện Planora, editorial giấy, footer chung và section dịch vụ công khai. Giữ hero/marquee/motion hiện có; sửa direct fragment dịch vụ và reset vị trí cuộn khi chuyển auth.
- Signup/verify/resend/approval có API thật, PostgreSQL pending/verified, phiên có revocation và refresh rotation/replay. Duyệt tài khoản chỉ admin, có tìm kiếm/phân trang và xác nhận quyền dùng dịch vụ chung. Live SMTP cần cấu hình; preview không gửi email thật.
- TDD signup ban đầu 6 fail; bộ PostgreSQL cuối 9/9 pass. Có bằng chứng UPDATE có điều kiện/concurrent verify/approve/refresh, expiration/wrong-purpose, logout-all/replay, migration lặp và disabled-user gate.
- `npm run check` exit0 ngày03/10/2026; frontend follow-up cuối37files/203tests exit0, API24files/165tests exit0, typecheck và build exit0. `git diff --check` exit0.
- Browser: desktop1440×900, mobile390×844 và auth320×740; signup/login không tràn, verify bỏ token URL, pending login bị chặn, admin list/dialog/Escape, logout, footer/Dịch vụ và CTA có đích thật. Final approval browser không bấm; API integration kiểm chứng duyệt thật trên fixture. Không provider writes. Reduced-motion được kiểm qua CSS/hook tests, chưa giả lập browser media setting.
- Preview riêng `http://127.0.0.1:5176/`, API3006, schema `ui_lifecycle_preview_20261003`; ảnh và giới hạn tại log UI-05. Không sửa v2, CURRENT-STATE/ROADMAP; HEAD vẫn995f5f7, chưa commit/push/deploy. Các thay đổi UI-01→04 chưa commit được giữ.
