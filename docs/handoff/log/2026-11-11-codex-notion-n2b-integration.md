# 2026-11-11 · NOTION-N2B · Tích hợp OAuth

- Cherry-pick `6588b5c3` vào worktree độc lập trên `e12c94d3`. Commit `b0ffd160` có diff rỗng khi so 16 đường dẫn với commit nguồn. Worktree nguồn vẫn ở `6588b5c3`.
- PostgreSQL 16 sandbox, không có file `.env`. Chuỗi migration mới áp dụng thành công, gồm `0035` và `0036`.
- Trước chỉnh test harness: sáu suite API có 33 PASS và 2 timeout ở 5 giây. Chạy riêng suite migration có 3 PASS. Chạy lại sáu suite tuần tự có 34 PASS và 1 timeout. Sau khi đặt ngân sách riêng cho hai ca replay migration: 35/35 PASS trên sáu suite với worker mặc định, exit 0. Web 15/15 PASS và typecheck exit 0.
- Xem [task NOTION-N2B](../tasks/NOTION-N2B-oauth-integration.md) và CI trên PR để xác minh bản tích hợp. Chờ review và nghiệm thu cấp service theo phạm vi riêng.

- CI đầu tiên trên PR #317 xác nhận lỗi tương thích: gate trên main kỳ vọng đúng 47 migration, trong khi 0036 nâng danh sách lên 48. Đã giữ kiểm tra 47 file đến 0035 và đối chiếu output CLI của cả hai lượt với danh sách thực tế. Gate migration trên PostgreSQL 16 với vùng lưu trữ tmpfs: 2/2 PASS, exit 0, 13 ca ngoài bộ lọc.
- Review độc lập tái hiện hai lỗi OAuth. Test API với HTTP loopback và PostgreSQL: RED 2/2 lỗi (HTTP 409 và revoke báo confirmed sai), sau sửa sáu suite API đạt 37/37, exit 0. Phản hồi danh tính sai cấu trúc trả lỗi tạm thời; revoke best-effort chỉ được xác nhận khi token lưu thuộc grant đang hoạt động và không có checkpoint refresh.
- Chromium sandbox `SCENARIO=notion_slack`: 1/1 PASS, exit 0. URL trang từ bước Notion tới Slack sau duyệt; chạy trước hai thay đổi từ review.
