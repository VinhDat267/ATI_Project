# Nhật ký bàn giao

Mỗi phiên làm việc thêm **một mục ở cuối file** (mới nhất ở dưới cùng), trong cùng PR với thay đổi. Giữ ngắn; chi tiết nằm trong PR và task card.

Mẫu:

```
## YYYY-MM-DD · <agent> · <task hoặc chủ đề>
- Đã làm:
- PR / commit:
- Kiểm tra đã chạy (lệnh và kết quả):
- Chưa làm / vấn đề phát hiện:
- Việc tiếp theo đề xuất:
```

---

## 2026-09-29 → 2026-10-01 · Claude Code · Giữa kỳ và tuần 1
- Đã làm: grounding, LLM qua cổng tương thích OpenAI, golden set v2, model tự gọi search tool, chạy thật trên Trello/Slack/GitHub, giảm latency, chạy thật qua frontend, báo cáo giữa kỳ, toàn bộ tuần 1 (PR #13), merge nhánh thiết kế lại frontend (PR #14).
- PR: #6–#14.
- Kiểm tra: `npm run test:v3` 400/400, `npm run test:eval:v3` 66/66, browser E2E 6/6, golden 50/50 và 18/18 với model thật.
- Vấn đề phát hiện: PR #14 được merge trước khi CI chạy xong và làm `main` đỏ (test đăng nhập phụ thuộc `CHAT_ADMIN_EMAIL`); đã sửa trong PR #13. Bài học: chỉ merge khi CI xanh.
- Việc tiếp theo: tuần 2, bắt đầu từ W2-01; có thể làm W2-03 song song.
