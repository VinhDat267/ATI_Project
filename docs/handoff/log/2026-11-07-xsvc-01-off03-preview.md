# 2026-11-07 · XSVC-01 — xem trước báo cáo Sheets rồi Slack

Prompt yêu cầu đọc bảng đang kết nối, tóm tắt, và soạn tin vào kênh ati-test. `LIVE_APP_CANCEL=1` bấm Hủy.

Plan `rejected`, 0 execution step. Bước một là `mysheets.aggregate_rows` trên tab Trang tính1 của bảng "Planora Tự động hoá". Bước hai là `slack.send_message`. `reportEvidence` gắn vào nội dung tin: `sheets_summary`, `itemCount` 0, `coverage` complete, nguồn `mysheets.aggregate_rows`. Câu tin nói không có dòng dữ liệu, khớp số liệu đã đọc lúc lập kế hoạch.

Không gửi tin Slack.
