# DEPLOY-02 · Backend đăng nhập workspace Planora

## Yêu cầu và phạm vi

Chủ dự án yêu cầu deploy backend để đăng nhập website Planora trên Vercel. Render đã có tài khoản; Neon PostgreSQL cần được tạo bằng gói Free, sau khi chủ tài khoản chấp nhận điều khoản.

- Nhánh riêng `codex/chore/backend-deploy`, giữ nguồn `Frontend_UXUI` tại `ef13c56`.
- Tái sử dụng auth/session, PostgreSQL repositories và API hội thoại v3. Không đưa database local hoặc tài khoản thử nghiệm lên cloud.
- Tách entry point dành cho account/workspace khi chưa có AI/SMTP; không dùng sandbox hoặc kế hoạch giả. AI planning/execution bị chặn rõ ràng. Đăng ký công khai đóng cho tới khi email được cấu hình.
- Chuẩn bị cấu hình Render Free và nối `/api` của frontend Vercel với backend khi backend đã hoạt động.
- Không sửa v2, CURRENT-STATE, ROADMAP; không ghi lên GitHub/Trello/Slack qua ứng dụng.

## Nghiệm thu

- Test cấu hình: secret riêng, URL hợp lệ, không khởi động khi thiếu database.
- PostgreSQL thật, schema riêng: login, session/revocation, ownership, hội thoại persist qua app restart, archive/delete/restore; gửi chat khi chưa có AI phải trả lỗi và không lưu tin nhắn như đã xử lý.
- Build backend, typecheck và các test API phù hợp có output/exit code thật.
- Cloud: database bền vững, health/readiness HTTPS; đăng nhập và vào workspace qua frontend Vercel, logout thu hồi phiên. Không tuyên bố đạt cloud nếu còn bước chủ tài khoản cần hoàn tất.
- Hướng dẫn và một log bàn giao mới; secrets không nằm trong Git hoặc log công khai.

## Kết quả

- Đã thêm entry point account/workspace dùng repositories và auth v3 thật; route hội thoại hoạt động khi chưa có planner và gửi chat bị từ chối trước khi lưu.
- Blueprint Render Free Singapore, build bundle backend 124.3 kB, README giới hạn tính năng, secure provisioning và kết nối frontend.
- TDD red: config module chưa tồn tại (exit1), sau triển khai config 9/9 pass. Regression API 26files/177tests pass trước bổ sung một case base64; TypeScript và build exit0.
- Kiểm thử PostgreSQL thật: schema riêng được xác nhận bằng `current_schema`; session/rotation/logout, ownership, persistence qua app recreation, lifecycle hội thoại, chặn AI và email chưa cấu hình. Lần chạy đầu URL `options` của fixture ghi đè `PoolConfig.options`; đã sửa isolation qua URL, dọn đúng hai tài khoản synthetic thuộc task trong fixture. Không tác động database sản phẩm.
- Neon Marketplace đã được chủ tài khoản xác nhận và resource `planora-db` Free Singapore đã tạo, nối với Vercel `planora`. Không dùng Neon Auth; tiếp tục dùng auth v3 của ứng dụng.
- Cloud backend và proxy frontend: đang triển khai, chưa nghiệm thu login qua website.
