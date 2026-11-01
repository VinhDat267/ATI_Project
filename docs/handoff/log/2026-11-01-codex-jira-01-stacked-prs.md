# 01/11/2026 · JIRA-01 · Hai PR tách scope

**Task:** [JIRA-01](../tasks/JIRA-01-oauth-feasibility.md). **Base:** `7209347`.

Đã đẩy nhánh thiết kế `codex/docs-jira-oauth-workspaces` tại `c713eaf` và nhánh probe `codex/jira-01-oauth-feasibility` tại `7209347`. Mở PR [#229](https://github.com/VinhDat267/ATI_Project/pull/229) từ thiết kế vào `main` và PR [#230](https://github.com/VinhDat267/ATI_Project/pull/230) từ probe vào nhánh thiết kế. GitHub báo cả hai MERGEABLE; CI `v3` đang chạy khi ghi log. `gh pr diff --name-only` cho #229 có sáu file docs, #230 có 21 file JIRA-01.

Reviewer độc lập không thấy lỗi mã mới; báo P3 tài liệu: checklist plan nói mọi response no-referrer trong khi GET `/` dùng same-origin có chủ ý để form POST mang Origin. Đã sửa đúng câu checklist; không sửa source. Cần đẩy commit này, cập nhật mô tả PR #230, đợi CI và review lại head trước merge. Không merge hoặc sửa CURRENT-STATE/ROADMAP.
