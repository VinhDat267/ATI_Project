# 2026-11-07 · XSVC-01 — browser nine_service

## Đã chạy

Sandbox, không gọi dịch vụ thật. API `3017`, web `5184`, database local cổng `55533`. Máy đã có server ở cổng `3000` nên không dùng lại cổng đó.

`SCENARIO=nine_service node scripts/test-v3-browser.mjs` exit 1. Không có nút "Duyệt kế hoạch".

Màn hình: "Tôi chưa làm được yêu cầu này". Lý do: "Jira chưa được kết nối hoặc chưa có tài nguyên được phép." Ngay dưới: Jira "Đã kết nối", và câu "Jira đã được kết nối. Bạn có thể gửi lại yêu cầu." Không gian làm việc là Không gian Cá nhân. Google Calendar và Google Sheets trên cùng màn là "Chưa kết nối".

Chưa có `output_json` để đối chiếu biên nhận. Assertion mới trên test browser chưa được thực thi.

## Chưa chạy

Đọc một provider thật rồi Hủy. Không gửi lệnh ghi.
