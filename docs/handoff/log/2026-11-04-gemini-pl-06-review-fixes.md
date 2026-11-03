# 2026-11-04 · gemini · PL-06 · Sửa 3 Findings P2 (F1–F3) từ Codex Review Vòng 1

- **Đã làm:**
  - **F1 — P2: Tích hợp hiển thị Step Cards Planora thực tế trong các Moment (`PlanMoment`, `ExecutionMoment`, `ReceiptMoment`):**
    - `PlanMoment.tsx`:
      - Sử dụng `PlanoraWorkflowSteps` làm renderer chính cho các bước kế hoạch với `showStepCards={true}`.
      - Xóa danh sách thẻ cũ `v3-space-y-3` trong `PlanMoment` để loại bỏ render trùng lặp hoàn toàn.
      - `PlanoraWorkflowSteps.tsx`: Đảm bảo container `#plan-cards-container` bọc lấy danh sách các step cards `[data-testid="planora-step-cards-grid"]`.
      - Bảo toàn toàn bộ test IDs và attributes: `#plan-cards-container` (`role="list" aria-label="Các bước thực thi"`), `[data-od-id="plan-item-N"]`, `#preview-${step.id}` (`data-testid="preview-step-btn-${step.id}"`) trên từng card `<article>`.
      - Hiển thị đầy đủ nhãn `Chỉ đọc` (Read) vs `Ghi` (Write) theo `toolDefinition`, nhãn `Phụ thuộc:` khi bước có `dependsOn`, các badge liên kết luồng dữ liệu data-flow mappings (`[data-testid="plan-step-data-flow-badge"]`).
      - Cấu trúc responsive grid: 2 cột trên desktop (`min-w-[768px]`, `md:grid-cols-2`), 1 cột trên mobile (`grid-cols-1`).
      - Lọc phạm vi tài nguyên `nonRedundantScopes` chống trùng lặp chuỗi với đích đến (`resolvedDest`), tránh lỗi duplicate text matcher trên test harness.
    - `ExecutionMoment.tsx`:
      - Cho phép `PlanoraWorkflowSteps` hiển thị step cards ở chế độ `executing` với `showStepCards={true}` và `destination={destination}`.
      - Trạng thái thời gian thực hiển thị rõ ràng trên từng card thông qua `StatusBadge`.
    - `ReceiptMoment.tsx`:
      - Cho phép `PlanoraWorkflowSteps` hiển thị step cards ở chế độ `receipt` với `showStepCards={true}`, `destination={destination}`, `serviceInfos={services}`.
      - Hiển thị tóm tắt kết quả từng bước (`resultTitle`) và nhãn hoàn thành tương ứng.
  - **F2 — P2: Ràng buộc mã băm `plan_hash` không fallback nhầm sang UUID:**
    - `PlanMoment.tsx`:
      - Kiểm tra tường minh: nếu `plan.plan_hash` tồn tại, hiển thị nhãn `Mã băm ràng buộc kế hoạch (plan_hash): {plan.plan_hash}`.
      - Nếu `plan_hash` không có (undefined/null), hiển thị nhãn `Mã định danh kế hoạch: {plan.id}`. Tuyệt đối không gọi UUID là `plan_hash`.
      - Giữ nguyên container `[data-testid="plan-hash-binding"]` để tương thích test selector.
  - **F3 — P2: Ẩn nút "Đặt lịch quy trình" khi capability `schedulesEnabled` đang tắt:**
    - `ReceiptMoment.tsx`: Thêm prop `schedulesEnabled?: boolean`. Chỉ hiển thị nút `[data-testid="receipt-schedule-workflow-btn"]` khi `schedulesEnabled === true`. Ẩn nút khi `false` hoặc `undefined`.
    - `PlanoraActiveTurn.tsx`: Truyền prop `schedulesEnabled={schedulesEnabled}` xuống `ReceiptMoment`.
    - `apps/chat-web/tests/planora-workflow-steps.test.tsx`: Bổ sung 4 unit tests mới bao quát cả 3 findings F1, F2, F3 (kiểm tra đầy đủ 3 trường hợp `schedulesEnabled: true`, `false`, `undefined`).

- **PR / commit:**
  - Nhánh: `longnguyen005/feat-planora-pl-06` (target `codex/planora-ui`).
  - Worktree: `C:\Users\Admin\orca\workspaces\ATI_Project\feat-planora-pl-06`.
  - Không sửa `CURRENT-STATE.md` hay `ROADMAP.md` (chỉ reviewer cập nhật sau khi merge).

- **Kiểm tra đã chạy (lệnh và kết quả thật):**
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm test -w @wap/chat-web`: PASS (101/101 test files, 1128/1128 tests, exit code 0).
  - `npm run build:v3`: PASS (exit code 0).
  - `node scripts/test-v3-web-build-security.mjs`: PASS (exit code 0).

- **Trạng thái:** `STATUS: READY_FOR_CODEX_RE_REVIEW`.
