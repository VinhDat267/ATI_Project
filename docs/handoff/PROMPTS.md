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

## Quy tắc cho một phiên Claude Code

Dán một lần ở đầu phiên. Các quy tắc này rút ra từ các phiên 04–05/10/2026.

```
Quy tắc làm việc cho phiên này (áp dụng cho mọi việc tôi giao, kể cả lệnh ngắn như "làm X", "merge #N"):

1. Bắt đầu
- Đọc docs/handoff/CURRENT-STATE.md và 3 file mới nhất trong docs/handoff/log/. Chạy git status, git log -5 và gh pr list.
- Thư mục chính luôn có file riêng chưa commit của tôi (DESIGN.md, PRODUCT.md, .github/hooks/, docs/reports/, skills-lock.json). Không sửa, không add, không stash các file này.
- Mọi việc làm trong worktree riêng ở .claude/worktrees/<tên-việc>, tạo từ origin/main, mỗi việc một nhánh. Không chuyển nhánh ở thư mục chính. Không đụng worktree của Codex (C:/Users/VinhDat/.codex/worktrees/).

2. Vai trò
- Mặc định bạn lập kế hoạch (task card, ROADMAP) và review. Chỉ thi công khi tôi giao rõ ("làm <task>", "fix <task>").
- Khi thi công: TDD (commit test RED trước, ghi output fail thật), chỉ đúng phạm vi task card, điền "Kết quả" trong task card, thêm một file log mới. PR do bạn tự viết phải ghi rõ "tự review, nên có review độc lập". Các lần trước, review độc lập đã bắt lỗi P2 trong cả ba PR tự review: FE-03b, AUTH-05, W3-00b.
- Với giao diện có gọi API bất đồng bộ, phải test ca "phản hồi về sau khi người dùng đã đổi sang thứ khác" (đổi hội thoại, gõ nội dung mới, đăng xuất).
- Chỉ reviewer sửa CURRENT-STATE.md và ROADMAP.md, và chỉ sau khi PR đã merge.

3. Kiểm thử
- Không tuyên bố "xong" khi chưa có output lệnh thật. Trước khi mở PR có sửa code: npm run check và npm run test:browser:v3 đều exit 0, kèm số liệu thật.
- PostgreSQL test là container tạm ở cổng 55533, không bao giờ dùng DB dev ở cổng 15433. Dưới Git Bash:
  MSYS_NO_PATHCONV=1 docker run -d --name <tên> --tmpfs /var/lib/postgresql/data -p 127.0.0.1:55533:5432 -e POSTGRES_USER=ati_v3 -e POSTGRES_PASSWORD=ati_v3_local_only -e POSTGRES_DB=ati_v3 postgres:16
  rồi đặt RUNTIME_MODE=sandbox, DATABASE_URL=postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3 và tài khoản admin test trong .github/workflows, chạy npm run db:migrate:v3 và npm run admin:provision:v3. Xong việc thì xoá container.
- Nội dung có dấu backslash (regex, escape, JQL, PEM) phải ghi bằng công cụ sửa file, không qua heredoc của shell, vì shell trên máy này làm mất backslash.

4. Merge
- Chỉ merge khi tôi nói "merge #N". Trước khi merge kiểm CI xanh đúng head đó, rồi dùng gh pr merge N --merge --delete-branch --match-head-commit <SHA đủ 40 ký tự>.
- Xoá worktree của nhánh trước khi merge. Sau khi merge: fast-forward main ở máy, kiểm nhánh local/remote đã xoá.
- CI đỏ trên PR không đổi code thì đọc log tìm nguyên nhân trước. Chỉ chạy lại job khi đã xác định là lỗi chập chờn, và nói rõ cho tôi.

5. Service thật và bí mật
- Chỉ ghi ra service thật khi tôi đã duyệt đúng plan/hash đó. Lệnh chỉ đọc thì báo trước rồi mới chạy.
- Không in, không commit token, mật khẩu, nội dung .env. Bằng chứng live để ở docs/ai-evidence/ (đã ignore), không commit.
- Mô tả PR và commit viết tiếng Việt, theo .github/pull_request_template.md, không có dòng "Generated with …" hay chữ ký AI.

6. Báo cáo cho tôi
- Trả lời tiếng Việt, ngắn: đã làm gì, kết quả thật, còn lại gì, cần tôi quyết định gì.
- Nói thẳng khi chính bạn làm sai (ví dụ commit test fail, lỗi sinh ra từ PR của bạn), không che bằng chữ "flaky".
```
