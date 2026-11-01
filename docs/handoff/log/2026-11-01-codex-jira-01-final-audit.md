# 01/11/2026 · JIRA-01 · Audit sau native gate

**Task:** [JIRA-01](../tasks/JIRA-01-oauth-feasibility.md). **Head reviewed:** `a54a897`.

Reviewer độc lập đọc code, tests và private safe artifacts; không tìm P1–P3 mã mới. `npm run test:probe -w @wap/tool-adapters` của reviewer 32/32 PASS, exit 0. Parent chạy `npm test -w @wap/tool-adapters`: 18 file/443 Vitest và 32 Node PASS, exit 0. Không thay source trong audit.

Full `npm run check` lần 1 thiếu `.env`, chat-api integration tests không kết nối được PostgreSQL mặc định tại 56533/5432; exit 1. Tạo database test riêng `ati_v3_test` trên Docker PostgreSQL local port 55533, chạy lại với `DATABASE_URL` trỏ đúng database test: vẫn exit 1; bộ test cũ có ca yêu cầu tên DB `ati_v3`, có ca copy `public` tables chưa migrate, và nhiều pool song song quá giới hạn client. Sau đó chat-web 860 test pass nhưng một worker không khởi động được. Đây không phải kết quả CI xanh và chưa đủ điều kiện merge. Không chạy test trên database ATI runtime.

`gh auth status` chưa đăng nhập GitHub; không push/PR/CI. Reviewer cũng xác nhận diff so với `origin/main` hiện gồm cả card/spec/log JIRA-00 và code/docs JIRA-01, trái một card/nhánh trong AGENTS §4. Cần tách thiết kế JIRA-00 thành PR/merge riêng hoặc được chủ dự án duyệt rõ scope gộp, sau đó review/check đúng head mới. Không sửa CURRENT-STATE/ROADMAP, không tuyên bố JIRA-01 hoàn tất hoặc mở JIRA-02–11.
