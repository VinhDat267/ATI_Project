# 2026-11-04 · FLOW-04 — Bắt đầu theo công việc và readiness thực, đóng khiếm khuyết F4

## 1. Bối cảnh & Mục tiêu
- **Khiếm khuyết F4 (P2):** Người dùng vào Cockpit trước đây bị phân mảnh giữa 9 logo dịch vụ đơn lẻ hoặc các kịch bản 9 dịch vụ toàn diện nhưng bị báo sẵn sàng ảo (chỉ cần nối 2/9 dịch vụ bất kỳ là UI đã hiện kịch bản "sẵn sàng", dù thực chất thiếu đến 7 kết nối). Người dùng không nắm được luồng nào có thể chạy được ngay, kết nối nào còn thiếu và cần bấm vào đâu để cấu hình.
- **Mục tiêu của FLOW-04:**
  1. Đưa 6 luồng công việc trọng tâm (`OFF-02`, `OFF-03`, `PM-01`, `PM-03`, `DEV-02`, `DEV-04`) lên vị trí ưu tiên cao nhất ở đầu Cockpit, nêu rõ đầu ra kỳ vọng.
  2. Triển khai cơ chế kiểm tra độ sẵn sàng sâu (`evaluateJobReadiness`) dựa trên `tools`, `connectionStatus`, `personalStatus`, `allowedScope`. Tuyệt đối không chỉ đếm logo hay cho phép 2/9 dịch vụ trở thành sẵn sàng.
  3. Định nghĩa contract `WorkflowContext` DTO và bộ validation chặt chẽ trong `packages/tool-schemas/src/workflow-context.ts`: chỉ cho phép các nhóm tài nguyên chuẩn hóa (`trello`, `github`, `slack`, `myjira`, `mycalendar`, `mysheets`), cấm hoàn toàn trường tự do hoặc địa chỉ email nhận.
  4. Backend guard `filterPermittedWorkflowDefaults` đối chiếu quyền và membership thật từ `PlanConnections`, loại bỏ ngay các mặc định ngoài phạm vi cấp phép.
  5. Quản lý lưu trữ tài nguyên mặc định phía client theo namespace `planora_defaults_v2:<userId>:<workspaceKey>`.

## 2. Các file đã thay đổi
- `packages/tool-schemas/src/workflow-context.ts`: Định nghĩa contract DTO `WorkflowContext`, `WorkflowResourceDefaults` và hàm `validateWorkflowContext`.
- `packages/tool-schemas/src/index.ts`: Re-export `workflow-context.js`.
- `apps/chat-api/src/services/workflow-context-guard.ts`: Triển khai `filterPermittedWorkflowDefaults`.
- `apps/chat-api/src/routes/conversation-routes.ts`: Đón nhận `workflowContext` từ `req.body`.
- `apps/chat-api/src/services/chat-service.ts`: Nạp và xác thực `workflowContext`, chuyển tài nguyên mặc định vào `WorkingMemory` của planner.
- `apps/chat-api/tests/unit/workflow-context.test.ts`: Bộ 5 bài test unit cho shared DTO và server-side guard.
- `apps/chat-web/src/services/job-readiness.ts`: Khai báo 6 Core Jobs và logic đánh giá readiness.
- `apps/chat-web/src/services/workflow-defaults-storage.ts`: Service lưu trữ scoped defaults trên localStorage.
- `apps/chat-web/src/pages/Cockpit/RequestMoments.tsx`: Tích hợp giao diện 6 Core Jobs lên đầu, hiển thị tài nguyên mặc định và kiểm định readiness cho các mẫu đa dịch vụ.
- `apps/chat-web/tests/services/job-readiness.test.tsx`: Bộ 5 bài test kiểm tra readiness logic.
- `apps/chat-web/tests/services/workflow-defaults.test.ts`: Bộ 4 bài test phân lập storage mặc định.
- `docs/handoff/tasks/FLOW-04-job-onboarding.md`: Cập nhật checklist và kết quả nghiệm thu.

## 3. Bằng chứng kiểm thử thực tế
- **Kiểm thử Shared DTO & Backend Guard (`apps/chat-api/tests/unit/workflow-context.test.ts`):**
  - Chạy `npx vitest run apps/chat-api/tests/unit/workflow-context.test.ts`: **5/5 passed** (6ms).
  - Xác nhận hợp lệ: Nhận diện đúng các nhóm tài nguyên trello, github, slack, myjira, mycalendar, mysheets.
  - Chống injection / email: Từ chối payload chứa `recipientEmail` hoặc field lạ.
  - Lọc quyền: Tự động loại bỏ repo github hoặc board trello không nằm trong allowlist của tài khoản.
- **Kiểm thử Frontend Job Readiness (`apps/chat-web/tests/services/job-readiness.test.tsx`):**
  - Chạy `npm test -w @wap/chat-web -- tests/services/job-readiness.test.tsx`: **5/5 passed** (8ms).
  - Chặn readiness ảo: Mẫu 9 dịch vụ khi chỉ nối 2 dịch vụ trả về `status: 'needs_connection'` và liệt kê chính xác 7 dịch vụ thiếu.
  - Nhận diện `ready`: Khi đủ dịch vụ và kết nối healthy.
  - Nhận diện `needs_reauth`: Khi có kết nối unhealthy/hết hạn token.
  - Nhận diện `needs_resource`: Khi đã nối nhưng chưa chọn scope/board (`personalStatus === 'needs_scope'`).
- **Kiểm thử Storage Phân Lập (`apps/chat-web/tests/services/workflow-defaults.test.ts`):**
  - Chạy `npm test -w @wap/chat-web -- tests/services/workflow-defaults.test.ts`: **4/4 passed** (8ms).
  - Phân tách độc lập giữa User A và User B, giữa Personal workspace và Team workspace.
- **Toàn bộ Test Suite `@wap/chat-web`:**
  - **111 files / 1.170 tests passed** (70.94s).
- **TypeScript Typecheck:**
  - `npm run typecheck:v3`: **exit code 0**.
