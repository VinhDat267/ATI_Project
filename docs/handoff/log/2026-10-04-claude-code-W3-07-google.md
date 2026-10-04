# 2026-10-04 · Claude Code · W3-07 phần Google Sheets và Calendar, đóng W3-07

- **Người dùng chuẩn bị:**
  - project Google Cloud, bật Sheets API và Calendar API;
  - service account không gán role, JSON key;
  - spreadsheet "ATI Test Tracker" (tab `Tasks`) và lịch "ATI Test", cả hai chia sẻ cho service account;
  - tự ghi 4 biến `GOOGLE_*`/`LIVE_*` vào `.env`.

  Lần đầu `GOOGLE_CLIENT_EMAIL` còn nguyên chữ `<project-id>` trong mẫu hướng dẫn. Reviewer kiểm định dạng (không in giá trị) trước khi gọi mạng nên phát hiện sớm.
- **Kết quả:**
  - `check`: cả 8 service OK;
  - ghi thật Calendar + Sheets + Slack theo plan hash `1b44ecde…` người dùng duyệt;
  - đọc lại khớp: sự kiện đúng giờ, dòng Sheets chứa link sự kiện;
  - key sai: Google 400 `invalid_grant` → `AUTH_ERROR`.
- **W3-07 đóng:** năm service mới và workflow 4 service đều đã chạy thật. Đã cập nhật `docs/MULTI-SERVICE-SCOPE.md` (mục cập nhật + dòng Live) và `evaluations/README.md` (mục W3-07 live runs).
- **Sau W3-07:** W3-09 (Jira) còn chờ thi công. Golden set cần đo lại sau FE-03 và W3-08.
