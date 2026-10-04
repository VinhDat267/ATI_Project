# 2026-10-04 · Claude Code · W3-07 phần Notion chạy thật

- **Người dùng chuẩn bị:** connection kiểu API token trong Notion Developer tools (giao diện mới gọi integration là "connection"), database "ATI Test Notes" (Private, một data source), tự ghi `NOTION_TOKEN` và `LIVE_NOTION_DATABASE_IDS` vào `.env`. Database ID lấy từ thanh developer ở chân trang Notion (DATABASE, không phải DATA SOURCE).
- **Lỗi thật tìm được:** Notion API trả URL host `app.notion.com`, còn adapter chỉ chấp nhận `notion.so`, nên `check` báo `SERVER_ERROR`. Test với dữ liệu giả không bắt được. Đã sửa qua #49 (merge `391aac4`).
- **Kết quả:**
  - ghi thật Notion + Slack theo plan hash `b6ccb160…` người dùng duyệt;
  - đọc lại khớp tiêu đề và Trạng thái;
  - token giả → HTTP 401 → `AUTH_ERROR`.
- **Tiếp theo:** workflow ≥ 4 service (đã đủ 2 service mới); Google và Jira khi có tài khoản.
