# CALENDAR-01 — Calendar digest audit fixes

- Yêu cầu: sửa F2/F3 từ audit PR #239, trên main `19b51f9e`.
- Phạm vi: Calendar digest; không sửa các digest khác, không bật flags hoặc gửi provider thật.
- Chấp nhận: kết quả gửi không rõ không được replan; giữ được qua timeout/restart; lỗi chắc chắn trước gửi vẫn phục hồi được. Xác nhận create/update phải khớp cấu hình và preview đã lưu, đổi scope/đích/tài khoản phải tạo đề xuất mới.
- Bằng chứng: PostgreSQL16 riêng, HTTP fixture thật với Slack/Telegram adapters, regression API/UI, full check và review độc lập.

## Kết quả

Đang thực hiện.
