# FLOW-05 · Khép dữ liệu và kết quả sáu luồng

**Trạng thái:** hoàn thành · **Owner:** Integration + AI + backend + frontend preview · **Nhánh:** `fix/flow-05-six-flow-composition`

**Phụ thuộc:** FLOW-01 và FLOW-04

## Mục tiêu

Nối production catalog và fixtures đầy đủ; hoàn thiện OFF-02/OFF-03/PM-01/PM-03/DEV-02/DEV-04.

## Thiết kế và phạm vi

- [Đặc tả](../../superpowers/specs/2026-11-04-current-flow-completion-design.md).
- [Kế hoạch, phần Task FLOW-05](../../superpowers/plans/2026-11-04-current-flow-completion.md#task-flow-05--khép-kín-dữ-liệu-và-kết-quả-sáu-luồng).
- File ownership và test commands/assertions ở task tương ứng trong plan; không sửa package ngoài vai trò. Chốt DTO chung trước sửa consumer.
- Một task/nhánh/worktree; đọc current head/handoff khi bắt đầu. Không sửa CURRENT-STATE/ROADMAP.

## Tiêu chí nghiệm thu

- [x] Meet/invite/folder/email đúng; card/member/due đúng; report dựa nguồn/locale/page phạm vi; fixture thiếu không giả success; context giữ qua ChatService hỏi/sửa; không thêm share tool hoặc connector.
- [x] Regression RED → GREEN, test package và browser phù hợp có command/output/exit code.
- [x] Không mất dữ liệu, không lẫn user/workspace, không replay ambiguous write.
- [x] Review độc lập và CI đúng final SHA; kết quả code/offline/live phân biệt.
- [x] Điền Kết quả và thêm một log mới trong cùng PR.

## Kết quả

- **Deterministic Report Renderers**:
  - `packages/planner/src/reports/renderers.ts`: Triển khai đầy đủ bộ renderer số liệu có nguồn cho cả 4 dạng:
    - `renderGithubPrsReport`: PRs report theo FLOW-01.
    - `renderGithubIssueAgingReport`: Báo cáo GitHub issue tồn đọng so khớp theo reference clock, tính tuổi ngày chính xác, phân loại theo ngưỡng `agingDays` (mặc định 7 ngày).
    - `renderJiraProgressReport`: Báo cáo tiến độ Sprint trên Atlassian Jira, thống kê theo nhóm trạng thái (Done, In Progress, To Do), ghi chú rõ duyệt từng lượt (`Duyệt từng lượt trước khi gửi - Manual Approval Required`).
    - `renderSheetSummaryReport`: Báo cáo tổng hợp Google Sheets hỗ trợ cả `records` / `values` và kết quả tổng hợp `aggregate_rows` (`groups`), xử lý an toàn định dạng số VN (`1.234,56`), US (`1,234.56`), tiền tệ (`₫`, `$`), số âm (`-100`, `(250)`), bỏ qua ô rỗng/lỗi mà không bị crash hay hallucinate.
    - `parseFactualNumber` & `formatFactualNumber`: Bộ parser số thực tế locale-aware.
- **Grounding Layer 5b Validator**:
  - `packages/planner/src/validator.ts`: Mở rộng Layer 5b bắt buộc kiểm tra `reportEvidence` và artifact store cho cả 4 dạng báo cáo (`github_prs`, `github_issue_aging`, `jira_progress`, `sheet_summary`), chặn đứng hoàn toàn kế hoạch báo cáo model tự bịa dữ kiện mà không qua read step hoặc artifact.
- **Oracle Regression Suite**:
  - `evaluations/current-flows/cases.json`: 36 test cases hồi quy chia đều cho 12 công việc × 3 biến thể (`explicit`, `natural`, `underspecified`) với oracle rõ ràng (`plan`, `clarification`, `refusal`) và tiêu chí bằng chứng tương ứng.
- **Kiểm thử Composition & Hồi quy**:
  - `packages/planner/tests/report-renderers-all.test.ts`: 18/18 tests RED → GREEN (exit code 0).
  - `evaluations/tests/current-flow-composition.test.ts`: 10/10 tests RED → GREEN (exit code 0).
  - `evaluations/generic-plumbing/static-guard.test.ts`: 12/12 tests passed (exit code 0).
  - Typecheck: `npm run typecheck:v3` passed (exit code 0).
