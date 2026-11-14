# Câu lệnh mẫu giao việc cho agent

Bộ câu lệnh cũ (P-START, P-TASK, P-REVIEW…) nằm ở [`docs/archive/handoff-2026-11-12/PROMPTS.md`](../archive/handoff-2026-11-12/PROMPTS.md).

## Giao một việc

```
Đọc AGENTS.md và docs/handoff/CURRENT-STATE.md.
Việc: <mô tả ngắn: lỗi gì / tính năng gì, ai dùng, kết quả mong muốn>.
Làm trên nhánh mới tách từ origin/main (worktree riêng nếu cần), có test cho hành vi đổi,
chạy test liên quan + npm run typecheck:v3, mở PR (Làm gì / Vì sao / Đã test gì).
Sửa dòng tương ứng trong CURRENT-STATE.md nếu trạng thái dịch vụ đổi.
```

## Nhờ review PR rủi ro cao

```
Review PR #<số> theo docs/handoff/REVIEW-CHECKLIST.md. Đọc diff, không cần chạy lại toàn bộ suite.
Kết luận OK hoặc Cần sửa (file:dòng + lý do).
```

## Sửa CI đỏ

```
CI của PR #<số> (hoặc main) đỏ. Lấy log bằng `gh run view <id> --log-failed`, tìm test lỗi,
tái hiện ở máy, sửa nguyên nhân gốc, push lại.
```
