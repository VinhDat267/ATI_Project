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
- Render `planora-api` Free Singapore đã Live: https://planora-api-m1ks.onrender.com, service `srv-db0kf2e0tbcc73885glg`, deployment `dep-db0kf2u0tbcc73885ia0`, runtime commit `669a413`. Build npm ci + bundle thành công, cả 5 migration đã apply; `/api/ready`200 xác nhận PostgreSQL connected.
- Administrator đã provision trên Neon theo email chủ dự án chọn. Mật khẩu ngẫu nhiên và env chỉ lưu ngoài repo, không in/commit. Smoke compiled backend với Neon thật: login, workspace, account, logout revocation pass.
- Frontend repo `longnguyen005/planora`, commit `2f02695`, Vercel production `dpl_3uMpsSkNX4YHVq5mu5epDcVYWZHE` Ready; same-origin `/api` rewrite tới Render. Build frontend exit0; live HTTP check backend và website đều 1/1 pass.
- Production HTTPS end-to-end: login administrator200, refresh200, account200, hội thoại tạo qua browser còn trong database sau reload, logout204, access/refresh bị thu hồi401. Browser vào workspace/cài đặt thành công, không có console error/warn. Ảnh bằng chứng lưu ngoài Git tại `ati-implementation/planora-cloud-workspace.png`.
- AI planning/execution và email/signup vẫn chưa cấu hình; không tuyên bố nền tảng hoàn tất. Render Free có cold start. Chưa chạy toàn bộ test:v3/eval:v3 trong task deployment này; đã chạy regression API/PostgreSQL, config, typecheck/build và kiểm tra cloud thật như trên. PR cần review độc lập, không tự merge.
