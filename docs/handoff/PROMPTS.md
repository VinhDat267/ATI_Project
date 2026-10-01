# Câu lệnh mẫu

Dán nguyên văn vào agent, thay phần trong `<…>`.

## Giao một task cho agent thi công (Codex, Antigravity, Cursor, Claude Code)

```
Đọc AGENTS.md, docs/handoff/README.md và docs/handoff/CURRENT-STATE.md trước.
Sau đó làm task docs/handoff/tasks/<W2-01-reconcile-on-startup.md>.

Yêu cầu:
- Kiểm tra git status và git log -5 trước khi bắt đầu; nếu thư mục đang có agent khác làm, dùng git worktree.
- Tạo nhánh theo tên gợi ý trong task card, làm theo TDD (test fail trước, ghi lại output fail).
- Chỉ làm đúng phạm vi task card.
- Trước khi mở PR: chạy các lệnh kiểm tra trong task card và ghi output thật vào mô tả PR.
- Trong cùng PR: điền phần "Kết quả" của task card và thêm một file nhật ký mới trong docs/handoff/log/ theo mẫu ở docs/handoff/log/README.md. Không sửa CURRENT-STATE.md hay ROADMAP.md.
- Khi commit, chỉ git add đúng các file của task; không dùng git add -A.
- Mô tả PR điền theo checklist trong .github/pull_request_template.md.
- Mô tả PR viết tiếng Việt, không có dòng "Generated with …". Không tự merge.
```

## Giao review cho Claude Code

```
Review PR #<số> theo docs/handoff/REVIEW-CHECKLIST.md và task card <docs/handoff/tasks/...>.
Chạy lại test ở máy, đọc diff thật, thử bỏ phần sửa để xem test mới có fail không.
Kết luận Đạt / Đạt sau khi sửa nhỏ / Chưa đạt, ghi lỗi cụ thể theo file:dòng.
```

## Sau khi merge một PR (cho Claude Code)

```
PR #<số> vừa được merge. Cập nhật docs/handoff/CURRENT-STATE.md (số liệu kèm ngày đo và commit,
lỗi đã biết, việc đã làm) và trạng thái trong docs/handoff/ROADMAP.md theo kết quả của PR đó, rồi mở PR nhỏ.
```

## Nhờ Claude Code lập kế hoạch tiếp

```
Đọc docs/handoff/CURRENT-STATE.md, ROADMAP.md và 3 file mới nhất trong docs/handoff/log/.
Viết task card cho các việc của tuần <3> trong docs/handoff/tasks/ theo mẫu các task card tuần 2,
cập nhật ROADMAP.md, rồi mở PR.
```

## Khi bắt đầu một phiên mới với bất kỳ agent nào

```
Đọc docs/handoff/CURRENT-STATE.md và 3 file mới nhất trong docs/handoff/log/,
tóm tắt lại cho tôi dự án đang ở đâu và việc tiếp theo là gì, chưa sửa gì cả.
```
