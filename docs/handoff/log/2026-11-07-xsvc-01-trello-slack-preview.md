# 2026-11-07 · XSVC-01 — xem trước Trello rồi Slack

Prompt yêu cầu lập kế hoạch tạo thẻ trên bảng To Do, danh sách Cần làm, rồi gửi link thẻ lên Slack. `LIVE_APP_CANCEL=1` bấm Hủy.

Plan `rejected`, 0 execution step. Bước một là `trello.create_card`. Bước hai là `slack.send_message`, phụ thuộc bước một, nội dung dùng `${step_1.output.url}`.

Không tạo thẻ và không gửi tin.
