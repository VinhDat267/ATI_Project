# 2026-11-07 · XSVC-01 — F7, Jira trong kịch bản mẫu

## Sửa

Ba kịch bản sandbox `four_service`, `five_service`, `nine_service` giữ tool và route `jira` khi MyJira đang bật. Plan mẫu gọi `jira.create_issue`. Ngoài các kịch bản đó, MyJira vẫn thay Jira dùng chung.

## Kiểm tra

- `jira-runtime-catalog.test.ts`: 9/9, exit 0. Ba ca mới fail trước khi sửa vì catalog không còn `jira.create_issue`.
- Browser `nine_service`, sandbox, API 3017, web 5184: 1 passed, 11.2s. Plan completed. Biên nhận khớp output đã lưu cho mã Jira, Gmail, Telegram và phạm vi Sheets.

Đọc provider thật rồi Hủy chưa chạy.
