# Bàn giao giữa các AI coding agent

Dự án được làm bởi nhiều agent (Claude Code, Codex, Antigravity, Cursor…). Không agent nào nhớ được phiên làm việc của agent khác, nên **trí nhớ của dự án nằm trong các file dưới đây**, không nằm trong lịch sử chat.

| File | Dùng để | Ai được sửa |
|---|---|---|
| [CURRENT-STATE.md](CURRENT-STATE.md) | Dự án đang ở đâu: đã làm gì, số liệu mới nhất, lỗi đã biết, quy tắc đã chốt | **Chỉ reviewer**, sau khi merge một PR (hoặc người lập kế hoạch) |
| [ROADMAP.md](ROADMAP.md) | Kế hoạch đến hết kỳ, mỗi việc trỏ tới một task card | Người lập kế hoạch (thường là Claude Code) |
| [tasks/](tasks/) | Task card: mục tiêu, file liên quan, tiêu chí nghiệm thu, lệnh kiểm tra | Người lập kế hoạch; agent thi công chỉ điền phần "Kết quả" của card mình làm |
| [log/](log/) | Nhật ký: mỗi phiên làm việc thêm **một file riêng** | Mọi agent, cuối mỗi phiên |
| [REVIEW-CHECKLIST.md](REVIEW-CHECKLIST.md) | Danh sách kiểm tra khi review một PR | Reviewer |
| [PROMPTS.md](PROMPTS.md) | Câu lệnh mẫu để giao việc và giao review | Người dùng |

`.github/pull_request_template.md` tự chèn checklist bàn giao vào mọi PR, nên agent nào mở PR trên GitHub cũng thấy.

## Vòng làm việc

1. **Lập kế hoạch** (Claude Code): viết hoặc cập nhật task card trong `tasks/`, đánh dấu trong `ROADMAP.md`.
2. **Thi công** (Codex, Antigravity, Claude Code…): nhận một task card, làm trên một nhánh riêng, mở PR. Trong cùng PR: điền phần "Kết quả" của task card và thêm một file vào `log/`. Không sửa `CURRENT-STATE.md` hay `ROADMAP.md`.
3. **Review** (Claude Code): review PR theo `REVIEW-CHECKLIST.md` và task card. Đạt và CI xanh thì người dùng merge. Sau khi merge, reviewer cập nhật `CURRENT-STATE.md` và trạng thái trong `ROADMAP.md` bằng một commit hoặc PR nhỏ.

Chỉ một người sửa `CURRENT-STATE.md` và `ROADMAP.md`, nên các PR làm song song không xung đột ở hai file này.

## Quy tắc khi nhiều agent cùng làm

- Một task, một nhánh, một agent. Trước khi bắt đầu, chạy `git status` và `git log -5 --format='%h %ar %s'`. Nếu thư mục có thay đổi chưa commit không phải của bạn, hoặc đang ở một nhánh có commit mới trong vài chục phút, đừng chuyển nhánh: làm trong một `git worktree` riêng.
- Khi commit, chỉ `git add` đúng các file của task mình; không dùng `git add -A`.
- Không sửa task card của task khác.
- Chỉ merge khi CI xanh. Nếu CI đỏ vì một PR khác, sửa ở PR gây lỗi trước.

## Giới hạn đã biết

- Codex đọc `AGENTS.md` tự động. Chưa kiểm chứng Antigravity có tự đọc hay không; luôn mở đầu bằng câu lệnh mẫu trong `PROMPTS.md`.
- Quy trình dựa vào việc agent làm theo hướng dẫn; thứ duy nhất được áp đặt là checklist trong mẫu PR và bước review.
