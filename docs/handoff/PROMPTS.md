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

## Khi không còn reviewer cũ (từ 26/10/2026)

Dùng cùng [FINISH-PLAN.md](FINISH-PLAN.md). Mỗi việc dùng hai phiên agent **khác nhau**: A-thi công và A-review (FINISH-PLAN mục 6.1). Phiên A-review đóng luôn vai "reviewer" trong `AGENTS.md`: nó là phiên duy nhất được sửa `CURRENT-STATE.md` và `ROADMAP.md`, và chỉ sau khi merge.

### P-START: mở đầu mọi phiên

```
Đọc AGENTS.md, docs/handoff/README.md, docs/handoff/CURRENT-STATE.md, docs/handoff/FINISH-PLAN.md
và 3 file mới nhất trong docs/handoff/log/. Chạy git status, git log -5 --format='%h %ar %s', gh pr list.
Tóm tắt cho tôi: dự án đang ở đâu, hôm nay theo FINISH-PLAN mục 3 có việc gì, việc nào đang chờ tôi.
Chưa sửa gì.

Quy tắc cho cả phiên:
- Thư mục chính có file riêng chưa commit của tôi (PRODUCT.md, evaluations/golden-independent/member-*.json,
  skills-lock.json). Không sửa, không add, không stash. Mọi việc làm trong git worktree riêng tách từ origin/main.
- Không dùng DB dev (cổng 15433, container ati-v3-postgres-1). DB test là container tạm theo FINISH-PLAN mục 6.3.
- Không in, không commit token, mật khẩu, .env, bằng chứng live. Mô tả PR và commit tiếng Việt, không có dòng
  "Generated with …" hay chữ ký AI; trong tài liệu gọi người review là "reviewer", ghi tên thành viên, không ghi tên công cụ.
- Không tuyên bố "xong" khi chưa có output lệnh thật. Lỗi do chính phần mình sửa thì nói thẳng, không gọi là chập chờn.
- Nội dung có dấu backslash (regex, PEM) ghi bằng công cụ sửa file, không qua heredoc.
- Chỉ ghi ra dịch vụ thật khi tôi đã duyệt đúng kế hoạch đó. Không tự merge.
```

### P-TASK: giao một task card cho A-thi công

```
Làm task docs/handoff/tasks/<TÊN-TASK>.md<, chỉ phần: …>. Đọc task card, đặc tả nó trỏ tới và quy tắc chung
(…-common.md nếu có) trước khi làm.

- git worktree riêng tách từ origin/main, nhánh theo tên gợi ý trong task card.
- TDD: viết test trước, chạy thấy fail đúng lý do, lưu output RED vào .codex/<task>/ của worktree; rồi mới sửa.
  Logic database test trên PostgreSQL thật; timeout test bằng AbortSignal thật; không mock hình thức.
- Tự làm đột biến: mỗi bảo đảm quan trọng sửa sai một chỗ, chạy test liên quan, test phải fail, khôi phục, so SHA-256.
  Ghi bảng đột biến vào log.
- Trước khi mở PR: npm run check và npm run test:browser:v3 đều exit 0 trên DB tạm (FINISH-PLAN mục 6.3).
  Lỗi chập chờn đã biết thì ghi lại, chạy riêng ca đó, chạy lại cả bộ trên DB sạch; không sửa assertion hay timeout.
- Label golden (nếu có) commit và push trước mọi lời gọi model.
- Trong cùng PR: điền "Kết quả" của task card, thêm một file log mới docs/handoff/log/<ngày>-<người>-<TÊN-TASK>.md.
  Không sửa CURRENT-STATE.md hay ROADMAP.md. Chỉ git add đúng file của task.
- Mô tả PR theo .github/pull_request_template.md, có output test thật và commit hash; ghi rõ "cần review độc lập".
- Báo tôi: PR số mấy, kết quả kiểm, chỗ nào khác task card.
```

### P-REVIEW: giao review độc lập (phiên khác với phiên thi công)

```
Review độc lập PR #<số> theo docs/handoff/REVIEW-CHECKLIST.md và task card docs/handoff/tasks/<TÊN-TASK>.md.
Mặc định kết luận "chưa đạt" cho tới khi có bằng chứng chạy lệnh thật.

- git worktree riêng ở đúng head PR (gh pr view <số> --json headRefOid). Ghi head đã review.
- Đọc diff thật (git diff <merge-base> <head>), đối chiếu từng mục và từng tiêu chí của task card.
- Chạy lại test mới, npm run check và npm run test:browser:v3 trên DB tạm riêng (FINISH-PLAN mục 6.3).
- Tự làm đột biến (ít nhất các đột biến ghi trong task card): sửa sai một chỗ, chạy test, ghi bị bắt hay lọt, khôi phục, so SHA-256.
  Đột biến lọt là một phát hiện (thiếu test), trừ khi chứng minh được là tương đương.
- Nghi ngờ lỗi thì viết probe tái hiện (test tạm ngoài repo hoặc script trong .codex/), không đoán.
- Kiểm CI xanh đúng head; kiểm quy trình (chỉ file của task, Kết quả task card, log mới, không sửa CURRENT-STATE/ROADMAP,
  không có chữ ký AI).
- Ghi kết luận lên PR bằng gh pr comment: Đạt / Đạt sau khi sửa nhỏ / Chưa đạt; mỗi lỗi có mức P1/P2/P3, file:dòng,
  cách tái hiện và gợi ý sửa; kèm bảng lệnh đã chạy và exit code.
- Bằng chứng giữ ở .codex/ của worktree review, không commit. Không merge.
```

### P-FIX: giao A-thi công sửa theo review

```
Sửa PR #<số> theo bình luận review <link>. Làm trong worktree của nhánh PR (hoặc tạo worktree mới từ nhánh đó).
Mỗi lỗi: test tái hiện trước (RED), rồi sửa (GREEN). Chạy lại npm run check và npm run test:browser:v3.
Thêm một file log mới docs/handoff/log/<ngày>-<người>-<TÊN-TASK>-review-fixes.md (lỗi, RED, GREEN, đột biến),
cập nhật "Kết quả" của task card và mô tả PR. Push, rồi báo tôi commit nào sửa lỗi nào.
```

### P-RECHECK: kiểm lại phần sửa (A-review)

```
Kiểm lại phần sửa của PR #<số> sau review <link>. Head mới: <SHA>.
Với từng lỗi đã nêu: đọc diff sửa, chạy lại đúng cách tái hiện cũ (probe cũ nếu có) và test mới; làm đột biến bỏ phần sửa,
test phải fail. Chạy lại test liên quan; chạy npm run check nếu phần sửa đụng mã dùng chung.
Ghi kết luận lên PR: các lỗi đã đóng, lỗi còn mở, kết luận mới.
```

### P-RECORD: ghi bàn giao sau khi merge (A-review)

```
PR #<các số> vừa merge. Tạo worktree từ origin/main, nhánh docs/record-<các số>.
- Kiểm: CI main xanh đúng commit merge; cây merge so với cây head đã review (git diff <head> <merge> --stat).
- docs/handoff/CURRENT-STATE.md: viết đoạn "Cập nhật lần cuối" mới ở đầu file (ngày, PR, commit merge, đã làm gì,
  review lần nào chưa đạt rồi sửa thế nào, việc tiếp theo theo FINISH-PLAN mục 3); chuyển đoạn cũ xuống "Cập nhật trước đó";
  cập nhật mục 3 (số liệu kèm ngày và commit), mục 4, mục 5 (lỗi mới hoặc đã đóng), mục 7 (quyết định mới của nhóm trưởng).
- docs/handoff/ROADMAP.md: đổi trạng thái dòng của task, thêm "Cập nhật <ngày>" ngắn.
- docs/handoff/FINISH-PLAN.md mục 3: đánh dấu việc đã xong.
- Thêm log docs/handoff/log/<ngày>-reviewer-merge-<các số>.md. Mở PR nhỏ, không đổi mã. Báo tôi để merge.
```

### P-W4-03: báo cáo buổi thử W4-03

```
Làm phần sau buổi thử của docs/handoff/tasks/W4-03-usable-plan-study.md. Phiếu ở <đường dẫn CSV trên máy>, không commit phiếu.
Chạy evaluations/usable-plan/report.ts theo evaluations/usable-plan/PROTOCOL.md trên DB của buổi thử (chỉ đọc, READ ONLY).
Exit 2 (chưa đủ 20 lượt, 5 người, 4 lượt mỗi người) thì dừng và báo tôi số lượt và số người hiện có.
Đủ thì: tóm tắt kết quả (tỉ lệ dùng được, Wilson 95%, nguyên nhân không dùng được) vào evaluations/README.md,
điền "Kết quả" task card, thêm log; dữ liệu thô giữ ở máy. Mở PR theo P-TASK.
```

### P-LIVE: agent ghi bằng chứng khi tôi nghiệm thu thật

```
Tôi sắp nghiệm thu thật <GMAIL-04 bước 5 | SCHED-04 bước 4> theo task card. Bạn chỉ ghi bằng chứng, không tự thao tác ghi.
- Dựng app live trên DB tạm riêng (không DB dev), theo task card.
- Với mỗi bước: nói tôi cần làm gì; chờ tôi báo xong; rồi đọc DB/API (chỉ đọc) để đối chiếu và ghi kết quả.
- Mọi lệnh ghi chỉ chạy khi tôi đã duyệt đúng kế hoạch trên giao diện.
- Bằng chứng ở docs/ai-evidence/<GMAIL-LIVE|SCHEDULE-LIVE>/<ngày>/ (đã ignore), ghi SHA-256 từng file vào log; không commit bằng chứng.
- Cuối cùng: log và "Kết quả" task card trong một PR nhỏ; ghi rõ bước nào đạt, bước nào chưa.
```

### P-PLAN: lập một task card nhỏ khi phát sinh việc

```
Có việc mới: <mô tả>. Đọc CURRENT-STATE, FINISH-PLAN và task card liên quan.
Viết một task card docs/handoff/tasks/<TÊN>.md theo khuôn các task card hiện có (Mục tiêu, Việc cần làm, Test tối thiểu,
Đột biến, Tiêu chí nghiệm thu, Ngoài phạm vi, Kết quả). Thêm một dòng vào ROADMAP.md và FINISH-PLAN.md mục 3 và 8.
Không đổi mã. Mở PR nhỏ, báo tôi để duyệt. Từ 04/11 chỉ nhận task sửa lỗi chặn demo.
```
