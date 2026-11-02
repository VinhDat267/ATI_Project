# CALENDAR-01 — Calendar digest audit fixes

- Yêu cầu: sửa F2/F3 từ audit PR #239, trên main `19b51f9e`.
- Phạm vi: Calendar digest; không sửa các digest khác, không bật flags hoặc gửi provider thật.
- Chấp nhận: kết quả gửi không rõ không được replan; giữ được qua timeout/restart; lỗi chắc chắn trước gửi vẫn phục hồi được. Xác nhận create/update phải khớp cấu hình và preview đã lưu, đổi scope/đích/tài khoản phải tạo đề xuất mới.
- Bằng chứng: PostgreSQL16 riêng, HTTP fixture thật với Slack/Telegram adapters, regression API/UI, full check và review độc lập.

## Kết quả

- Đã sửa F2 bằng marker dispatch bền vững và `needs_attention` không replan; kiểm chứng cả Slack/Telegram mất phản hồi, timeout/stop/restart, migration rerun và receipt sau cancellation.
- Đã sửa F3 cho create/update, gồm implicit update khi scope trở thành không đủ điều kiện. Đổi scope/tài khoản/kết nối/đích từ preview bị từ chối; giữ cấu hình và version cũ. Token rotation cùng credential và thứ tự lịch không làm đổi consent.
- Implementation `4b0ee709`, sửa P2 reviewer `c8b516e1`, tích hợp main #240 ở `02012daa` (base mới `afc25bd3`). Reviewer độc lập chạy34 API +7 UI PASS, phát hiện1 P2;2 regression RED→GREEN đóng finding, full check sau sửa PASS.
- `npm run check` trên cây tích hợp: **3.507 v3 +406 eval +99 Node/launcher PASS**, exit0. API162files/1.314tests; web89files/961tests. PostgreSQL16 riêng cổng56534 theo guard Jira mới.
- Browser API thật desktop1440/mobile375: **2/2 PASS**, exit0. UI hiển thị hướng dẫn kiểm tra, không replan; endpoint trả409. Fixture seed trạng thái kết thúc, không gửi provider thật.
- Migration0021 phải áp dụng trước API. Đề xuất cũ thiếu config snapshot cần tạo lại hoặc chọn thủ công.
- NOT_RUN: Google OAuth, Slack/Telegram và model live; DB runtime không bị chạm, flags không đổi. CI exact-head theo dõi ở PR; chưa merge.
