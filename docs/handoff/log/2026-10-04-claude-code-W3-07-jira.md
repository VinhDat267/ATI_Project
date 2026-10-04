# 2026-10-04 · Claude Code · W3-07 phần Jira chạy thật

- **Người dùng chuẩn bị:** site Jira Cloud Free, project `ATIT`, API token không scope; tự ghi `JIRA_SITE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `LIVE_JIRA_PROJECT_KEYS` vào `.env`. Mọi output được lọc bỏ token trước khi hiển thị.
- **Kết quả:**
  - `check` OK;
  - ghi thật Jira + Slack theo plan hash `d328ee1a…` người dùng duyệt, tạo `ATIT-4`;
  - đọc lại thấy `ATIT-4` qua query rỗng và query `Jira`.
- **Phát hiện → task card W3-09:**
  1. tìm `W3` hoặc nguyên tiêu đề `Kiểm tra W3-07 Jira` trả rỗng, vì adapter thay `-` bằng khoảng trắng;
  2. token giả → `/myself` 401 nhưng `/project/ATIT` 404, nên `check` báo `NOT_FOUND` thay vì `AUTH_ERROR`.
- **Ghi chú:**
  - project `ATIT` có sẵn `ATIT-1..3` do người dùng tạo khi thử giao diện; không ảnh hưởng;
  - lệnh ghi kết quả lần đầu lỗi cú pháp bash trước khi chạy bất kỳ bước nào; đã làm lại từng bước.
- **Còn lại của W3-07:** Google Sheets và Calendar.
