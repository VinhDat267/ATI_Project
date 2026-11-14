# Quy ước Git

Bản cũ (chia module theo đội 3–4 người, nhánh `develop`, standup) nằm ở [`docs/archive/handoff-2026-11-12/team-workflow.md`](archive/handoff-2026-11-12/team-workflow.md). Quy tắc làm việc chính ở [`AGENTS.md`](../AGENTS.md).

## Nhánh

- `main` là nhánh duy nhất lâu dài; chỉ vào qua PR có CI xanh.
- Nhánh việc: `feat/<tên>`, `fix/<tên>`, `chore/<tên>`, `docs/<tên>`. Một việc một nhánh, tách từ `origin/main`.
- Khi thư mục chính đang bận: `git worktree add ../<tên> -b feat/<tên> origin/main`.
- Merge xong thì xoá nhánh và worktree (`git worktree remove <path>`, `git worktree prune`).

## Commit

Conventional Commits: `<type>(<scope>): <tóm tắt>`.

- type: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`.
- scope: tên dịch vụ hoặc package, ví dụ `notion`, `gmail`, `chat-api`, `chat-web`, `planner`, `schemas`, `db`.
- Sửa bug: ghi nguyên nhân gốc trong thân commit.

## PR

- Nhỏ, một mục đích; được phép sửa xuyên package nếu cùng một tính năng.
- Trước khi mở PR: `git fetch && git rebase origin/main` (hoặc merge) để nhánh không lệch xa.
- Không commit `.env`, secret, file build, `.worktrees/`.
