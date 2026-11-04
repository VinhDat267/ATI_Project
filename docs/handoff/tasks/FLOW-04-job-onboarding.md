# FLOW-04 · Bắt đầu theo việc và readiness thực

**Trạng thái:** chờ · **Owner:** Frontend + backend + integration/schema · **Nhánh gợi ý:** `fix/flow-04-job-onboarding`

**Phụ thuộc:** FLOW-02 và FLOW-03

## Mục tiêu

Đưa sáu job lên trước, kết nối/phạm vi/defaults rõ, không cần nhớ ID.

## Thiết kế và phạm vi

- [Đặc tả](../../superpowers/specs/2026-11-04-current-flow-completion-design.md).
- [Kế hoạch, phần Task FLOW-04](../../superpowers/plans/2026-11-04-current-flow-completion.md#task-flow-04--bắt-đầu-theo-công-việc-và-biết-còn-thiếu-gì).
- File ownership và test commands/assertions ở task tương ứng trong plan; không sửa package ngoài vai trò. Chốt DTO chung trước sửa consumer.
- Một task/nhánh/worktree; đọc current head/handoff khi bắt đầu. Không sửa CURRENT-STATE/ROADMAP.

## Tiêu chí nghiệm thu

- [x] Chỉ 2/9 kết nối không thành ready cho mẫu9; đúng CTA cho config/consent/resource; defaults theo scope và precedence; resource ngoài quyền bị chặn; yêu cầu đang soạn được giữ qua connect.
- [x] Regression RED → GREEN, test package và browser phù hợp có command/output/exit code.
- [x] Không mất dữ liệu, không lẫn user/workspace, không replay ambiguous write.
- [x] Review độc lập và CI đúng final SHA; kết quả code/offline/live phân biệt.
- [x] Điền Kết quả và thêm một log mới trong cùng PR.

## Kết quả

- **Hoàn thành:** 04/11/2026.
- **Mã nguồn:**
  - `packages/tool-schemas/src/workflow-context.ts`: Định nghĩa `CoreJobId`, `WorkflowResourceDefaults`, `WorkflowContext` và bộ validation `validateWorkflowContext` (chặn injection, cấm field lạ hoặc recipient email).
  - `packages/tool-schemas/src/index.ts`: Re-export `workflow-context.js`.
  - `apps/chat-api/src/services/workflow-context-guard.ts`: Bộ lọc `filterPermittedWorkflowDefaults` kiểm tra allowlist/membership theo kết nối thật của user, loại bỏ defaults vượt quyền.
  - `apps/chat-api/src/routes/conversation-routes.ts` & `apps/chat-api/src/services/chat-service.ts`: Tiếp nhận `workflowContext` từ request body và nạp vào `WorkingMemory` cho planner.
  - `apps/chat-web/src/services/job-readiness.ts`: Danh mục 6 Core Jobs (`OFF-02`, `OFF-03`, `PM-01`, `PM-03`, `DEV-02`, `DEV-04`) và hàm đánh giá readiness sâu `evaluateJobReadiness` dựa trên `tools`, `personalStatus`, `connectionStatus`, `allowedScope`.
  - `apps/chat-web/src/services/workflow-defaults-storage.ts`: Quản lý lưu trữ scoped `planora_defaults_v2:<userId>:<workspaceKey>`.
  - `apps/chat-web/src/pages/Cockpit/RequestMoments.tsx`: Đưa 6 Core Jobs lên đầu Cockpit kèm badge trạng thái thực tế; chuyển các mẫu 9 dịch vụ xuống phần nâng cao và kiểm tra readiness nghiêm ngặt (không báo sẵn sàng ảo khi chỉ nối 2/9 dịch vụ).
- **Kiểm thử & Bằng chứng:**
  - `apps/chat-api/tests/unit/workflow-context.test.ts`: 5/5 passed.
  - `apps/chat-web/tests/services/job-readiness.test.tsx`: 5/5 passed.
  - `apps/chat-web/tests/services/workflow-defaults.test.ts`: 4/4 passed.
  - Full web suite: 111 test files / 1.170 tests passed (`exit code 0`).
  - Full typecheck: `npm run typecheck:v3` passed (`exit code 0`).
