# 2026-10-04 · Claude Code · W3-07 workflow thật 4 service

- **Workflow:** GitHub issue → Notion page (Link = URL issue) → Telegram → Slack. Đây là tiêu chí "một workflow thật ≥ 4 service, ít nhất 2 service mới" của W3-07.
- **Plan:** model thật, 8,4 s; người dùng duyệt đúng hash `057c0ab9…`.
- **Thực thi:** 4/4 step `succeeded`. Issue #3, page Notion `3eff24d5-…-cd326c8447fb`, Telegram `messageId 6`, Slack `ts 1791079497.557269`.
- **Đối chiếu:** `github.get_issue` và `notion.query_database` khớp, `Link` của page bằng URL issue. Tin nhắn được người dùng xem bằng mắt.
- **Lưu ý khi đối chiếu:** script đọc lại lần đầu truyền sai tên tham số (`number` thay vì `issueNumber`); adapter trả `VALIDATION` trước khi gọi mạng, đúng hành vi. Không phải lỗi sản phẩm.
- **Còn lại của W3-07:** Google Sheets, Google Calendar, Jira.
