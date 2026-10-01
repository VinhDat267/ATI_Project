# 2026-10-01 · Claude Code · Giữa kỳ và tuần 1

- **Đã làm:** grounding, LLM qua cổng tương thích OpenAI, golden set v2, model tự gọi search tool, chạy thật trên Trello/Slack/GitHub, giảm latency, chạy thật qua frontend, báo cáo giữa kỳ, toàn bộ tuần 1, merge nhánh thiết kế lại frontend; dựng thư mục bàn giao `docs/handoff/`.
- **PR:** #6–#15.
- **Kiểm tra đã chạy:** `npm run test:v3` 400/400, `npm run test:eval:v3` 66/66, browser E2E 6/6, golden 50/50 và 18/18 với model thật (01/10, commit `29afc4f`).
- **Vấn đề phát hiện:** PR #14 được merge trước khi CI chạy xong và làm `main` đỏ (test đăng nhập phụ thuộc `CHAT_ADMIN_EMAIL`); đã sửa trong PR #13. Bài học: chỉ merge khi CI xanh. Hai agent từng làm cùng lúc trong một thư mục; quy trình mới yêu cầu dùng worktree riêng.
- **Việc tiếp theo đề xuất:** tuần 2, bắt đầu từ W2-01; W2-03 làm song song được.
