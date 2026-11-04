# Bàn giao: FLOW-05 · Khép kín dữ liệu và kết quả sáu luồng

- **Ngày:** 2026-11-04
- **Nhánh:** `fix/flow-05-six-flow-composition`
- **Người thực hiện:** Integration + AI + Backend Specialist (Antigravity Orchestrator)
- **Tham chiếu:** `docs/superpowers/plans/2026-11-04-current-flow-completion.md` (Task FLOW-05)

## Nội dung thực hiện

1. **Bộ Deterministic Report Renderers đầy đủ (`packages/planner/src/reports/renderers.ts`)**:
   - `renderGithubPrsReport`: Kế thừa từ FLOW-01.
   - `renderGithubIssueAgingReport`: Báo cáo issue GitHub tồn đọng tính tuổi ngày theo reference clock, phân loại theo ngưỡng ngày (`agingDays`), xuất text chính xác kèm URL.
   - `renderJiraProgressReport`: Báo cáo tiến độ Jira Sprint nhóm theo status (Done, In Progress, To Do), ghi chú rõ yêu cầu duyệt từng lượt thủ công (`Duyệt từng lượt trước khi gửi - Manual Approval Required`).
   - `renderSheetSummaryReport`: Báo cáo Google Sheets hỗ trợ cả `records` / `values` và `aggregate_rows` (`groups`), hỗ trợ định dạng số VN/US (`1.234,56` vs `1,234.56`), tiền tệ (`₫`, `$`), số âm (`-100`, `(250)`), bỏ qua ô lỗi an toàn.
   - `parseFactualNumber` & `formatFactualNumber`: Parse số thực tế an toàn không phụ thuộc AI.

2. **Mở rộng Grounding Layer 5b Validator (`packages/planner/src/validator.ts`)**:
   - Mở rộng Layer 5b kiểm soát chặt chẽ cả 4 loại báo cáo: `github_prs`, `github_issue_aging`, `jira_progress`, `sheet_summary`.
   - Ngăn chặn triệt để kế hoạch báo cáo model tự bịa số liệu nếu không có read step hoặc artifact `reportEvidence`.

3. **Bộ Oracle Hồi quy 36 câu (`evaluations/current-flows/cases.json`)**:
   - Định nghĩa đầy đủ 36 ca kiểm thử cho 12 công việc × 3 biến thể (`explicit`, `natural`, `underspecified`).
   - Xác định rõ oracle kết quả (`plan`, `clarification`, `refusal`) và tiêu chí bằng chứng tương ứng.

4. **Kiểm thử Composition & Tĩnh**:
   - `packages/planner/tests/report-renderers-all.test.ts`: 18/18 tests RED → GREEN.
   - `evaluations/tests/current-flow-composition.test.ts`: 10/10 tests RED → GREEN.
   - `evaluations/generic-plumbing/static-guard.test.ts`: 12/12 tests PASS.
   - `npm run typecheck:v3`: Exit code 0, không có lỗi kiểu dữ liệu.

## Bằng chứng thực nghiệm

- `npx vitest run packages/planner/tests/report-renderers-all.test.ts`:
  `18 passed (18)` trong 51ms.
- `npx vitest run evaluations/tests/current-flow-composition.test.ts`:
  `10 passed (10)` trong 35ms.
- `npx vitest run evaluations/generic-plumbing/static-guard.test.ts`:
  `12 passed (12)` trong 2.4s.
- `npm run typecheck:v3`:
  Exit code 0.
