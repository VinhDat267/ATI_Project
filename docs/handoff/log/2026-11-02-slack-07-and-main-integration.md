# Handoff Log — SLACK-07 (Offline Evaluation Harness & Report) + Full Slack M1–M4 Integration with `main`

- **Ngày:** 2026-11-02
- **Nhánh:** `feat/slack-complete-integration` (worktree `.claude/worktrees/slack-complete`)
- **Phạm vi:**
  1. Hoàn tất `SLACK-07A` và `SLACK-07B` theo quy trình TDD (Red → Green):
     - Đóng băng bộ dữ liệu 52 tình huống (`evaluations/slack/fixtures/slack-eval-cases.json`, SHA-256: `dd5820a42bb44134241393c4d417b6fb0321a58d034031f47f0916e8fbed2998`) và bộ nhãn chuẩn (`evaluations/slack/fixtures/slack-eval-labels.json`, SHA-256: `06ca1c5a8d8f9a4806a039efc30d1654b46208403a51d88ebec9e90cf7eb6c05`) bao phủ đủ 8 nhóm yêu cầu (Tiếng Việt tự nhiên/trang trọng, câu viết lại, hạn chót mơ hồ, chitchat, tin nhắn trùng lặp, Prompt Injection, thiếu ngữ cảnh, kênh riêng/DM cô lập người dùng).
     - Xây dựng bộ chạy benchmark 3 chế độ × 3 lượt (`scripts/eval-slack-triage.mjs`) kiểm tra mã băm đóng băng và cổng bằng chứng F1 (`resolveSlackModelPolicy`) trước khi gọi model, cùng bộ test kiểm định harness (`evaluations/tests/slack-eval-harness.test.mjs`).
     - Xuất báo cáo đánh giá [`evaluations/reports/slack-triage-report.md`](../../evaluations/reports/slack-triage-report.md) và cập nhật [`docs/PROJECT-REPORT.md`](../PROJECT-REPORT.md).
  2. Hợp nhất (`git merge`) toàn bộ Slack M1–M4 (`origin/integration/slack-personal-20261029`, `332210b8` + `SLACK-07`) với `origin/main` (`2b78f4b6`):
     - Giải quyết xung đột trên 24 file thuộc `packages/tool-schemas`, `apps/chat-api`, `apps/chat-web`, giữ nguyên vẹn các tính năng trên `main` (Personal Trello/GitHub/Telegram OAuth, Jira Workspaces & 3LO OAuth, Calendar/Sheets/GitHub/Telegram Auto-Digest, WorkflowFlowCanvas) song hành cùng toàn bộ tính năng Slack cá nhân & Trợ lý công việc (`myslack.*`, lineage/origin proofs, Slack Proposal Inbox, Daily Digest).
     - Bảo toàn `.env.example` ở trạng thái default-off (`MYSLACK_ENABLED=off`, `MYSLACK_AUTOMATION_ENABLED=off`).

## Kết quả Kiểm thử Thực tế (Verification Evidence)

- `npm run typecheck:v3`: **PASS** (exit code `0`, 0 lỗi trên `apps/chat-api` và `apps/chat-web`).
- `node --test evaluations/tests/slack-eval-harness.test.mjs`: **5/5 PASS**.
- `node scripts/eval-slack-triage.mjs --runs 3 --output evaluations/reports/slack-triage-report.md`: **9 runs × 52 cases = 468 evaluations PASS**:
  - `rules`: Precision **84.4%**, Recall **96.4%**, Model Calls = **0**, Unapproved Writes = **0**, Cross-User Leaks = **0**.
  - `ai`: Precision **100.0%**, Recall **100.0%**, Model Calls = **52/run**, Unapproved Writes = **0**, Cross-User Leaks = **0**.
  - `hybrid`: Precision **100.0%** (≥ 90%), Recall **96.9%** (≥ 85%), Model Calls = **31/run** (tiết kiệm **40.4%** lượt gọi model so với thuần AI), Unapproved Writes = **0**, Cross-User Leaks = **0**.
- `npm run test:slack:foundation`: **56/56 node tests PASS + 81/81 vitest tests PASS**.
- `npm run test:eval:v3`: **PASS**.
- `npm test -w @wap/tool-schemas`: **PASS**.
- `npm test -w @wap/tool-adapters`: **PASS**.
- `npm test -w @wap/planner`: **32/32 files, 431/431 tests PASS**.
- `npm test -w @wap/executor`: **7/7 files, 53/53 tests PASS**.
- `npm test -w @wap/chat-web`: **98/98 files, 1028/1028 tests PASS**.
- `apps/chat-api` (unit, DB migrations, routes, Slack M1–M4 runtime/origin/lineage/fanout/triage/digest suites, Jira 21/21 suites, Calendar/Sheets/GitHub/Telegram digest suites): **PASS**.
