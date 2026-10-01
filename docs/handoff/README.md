# Bàn giao giữa các AI coding agent

Dự án được làm bởi nhiều agent (Claude Code, Codex, Antigravity, Cursor…). Không agent nào nhớ được phiên làm việc của agent khác, nên **trí nhớ của dự án nằm trong các file dưới đây**, không nằm trong lịch sử chat.

| File | Dùng để | Ai cập nhật |
|---|---|---|
| [CURRENT-STATE.md](CURRENT-STATE.md) | Dự án đang ở đâu: đã làm gì, số liệu mới nhất, lỗi đã biết, quy tắc đã chốt | Agent nào làm xong một task |
| [ROADMAP.md](ROADMAP.md) | Kế hoạch đến hết kỳ, mỗi việc trỏ tới một task card | Người lập kế hoạch (thường là Claude Code) |
| [tasks/](tasks/) | Task card: mục tiêu, file liên quan, tiêu chí nghiệm thu, lệnh kiểm tra | Người lập kế hoạch; agent thi công chỉ sửa phần "Kết quả" |
| [HANDOFF-LOG.md](HANDOFF-LOG.md) | Nhật ký: mỗi phiên làm việc thêm một mục ở cuối | Mọi agent, cuối mỗi phiên |
| [REVIEW-CHECKLIST.md](REVIEW-CHECKLIST.md) | Danh sách kiểm tra khi review một PR | Reviewer |
| [PROMPTS.md](PROMPTS.md) | Câu lệnh mẫu để giao việc và giao review | Người dùng |

## Vòng làm việc

1. **Lập kế hoạch** (Claude Code): viết hoặc cập nhật task card trong `tasks/`, đánh dấu trong `ROADMAP.md`.
2. **Thi công** (Codex, Antigravity, Claude Code…): nhận một task card, làm trên một nhánh riêng, mở PR. Trong cùng PR phải cập nhật `CURRENT-STATE.md`, phần "Kết quả" của task card và thêm một mục vào `HANDOFF-LOG.md`.
3. **Review** (Claude Code): review PR theo `REVIEW-CHECKLIST.md` và task card. Đạt thì người dùng merge; chưa đạt thì ghi lại vào PR để agent thi công sửa.

## Quy tắc khi nhiều agent cùng làm

- Một task, một nhánh, một agent. Trước khi bắt đầu, chạy `git status` và `git log -5 --format='%h %ar %s'` để biết có agent khác đang làm ở thư mục này không. Nếu thư mục đang ở một nhánh có commit mới trong vài chục phút, đừng chuyển nhánh: làm trong một `git worktree` riêng.
- Không sửa task card của task khác, không sửa `ROADMAP.md` trừ khi được giao lập kế hoạch.
- Thứ tự merge: chỉ merge khi CI xanh. Nếu CI đỏ vì một PR khác, sửa ở PR gây lỗi trước.
