# 2026-10-03 · Codex · UI-01 kiểm tra nguồn dữ liệu

Yêu cầu: nối giao diện B với dữ liệu thật. Tiếp tục task UI-01 trên `codex/ati-ui-b`, HEAD `c6d6e89`; các thay đổi chưa commit vẫn là công việc UI-01 của phiên trước. Không đổi nhánh, không commit/deploy, không sửa API hoặc các module ngoài frontend.

## Đã kiểm chứng

- Giao diện `5175` proxy tới API sandbox `3005`. Health trả HTTP 200 tại API và qua frontend. GET tài khoản, lịch sử và dịch vụ được gọi sau đăng nhập bằng tài khoản cấu hình hiện có; tất cả HTTP 200. Token và mật khẩu chỉ dùng trong bộ nhớ của kiểm tra, không in ra output hoặc ghi file.
- PostgreSQL được đọc trực tiếp bằng cấu hình DATABASE_URL trong `.env`: truy vấn COUNT trên cả sáu bảng thành công. Không ghi dữ liệu. `service_credentials` có 0 bản ghi; không có cấu hình dịch vụ dùng chung.
- API qua frontend trả ba dịch vụ trello/slack/github, connected=false, allowedScope rỗng. CUA mở trang dịch vụ và thấy cả ba nhãn “Chưa cấu hình”, đúng với dữ liệu API/DB. Không bấm Test/Save/Duyệt.
- Cấu hình `.env` là sandbox; chưa có JWT_SECRET, ENCRYPTION_KEY, cấu hình LLM thật hoặc token Trello/Slack/GitHub. Chỉ báo boolean hiện diện, không công bố giá trị riêng tư. Do đó chưa thể chạy backend live hoặc chứng minh dữ liệu tài nguyên từ nhà cung cấp thật.

## Kết quả và giới hạn

Không cần sửa frontend để bật REST/SSE: kết nối này đã được triển khai trong UI-01. Tài khoản/lịch sử đến từ DB thật; kế hoạch/thực thi trong phiên preview vẫn là sandbox, không được gọi là AI hoặc dịch vụ live. Không tự chuyển mode chỉ để đổi nhãn.

Đã hỏi chủ dự án phân biệt dữ liệu ATI với GitHub/Trello/Slack thật. Việc live cần cấu hình riêng tư từ chủ dự án: LLM/provider, JWT/encryption key, credentials và phạm vi repo/board/channel. Tài khoản cấu hình service phải nằm trong SERVICE_ADMIN_USER_IDS; không tự cấp quyền trong phiên này. Các tool ghi vẫn cần chủ dự án duyệt đúng plan theo đặc tả v3.

Không chạy lại toàn bộ tests vì không sửa mã nguồn. Screenshot: `C:/Users/Admin/.codex/visualizations/2026/10/02/01a0faf0-f9b9-7432-89ab-cfec274816e2/ati-implementation/services-data-check.jpg`. Trang dịch vụ để lại tại `http://127.0.0.1:5175/?view=services`. Không sửa `.env`, CURRENT-STATE hoặc ROADMAP.
