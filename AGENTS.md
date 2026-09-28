# ATI Project — Automatic Specialist Routing & Multi-Agent Protocol (v3)

## 1. Phạm vi & Quyền lực chuẩn tắc (Scope & Source of Truth)

Tài liệu này quy định cách thức phối hợp, phân quyền và điều phối giữa các AI Subagents và Main Agent trong repository `ATI_Project`.

### 1.1. Quyền lực phạm vi v3 (Active Scope Authority)
- **Đặc tả Thiết kế v3:** [`docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md`](docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md) là tài liệu chuẩn tắc duy nhất về hành vi nghiệp vụ, luồng xử lý, tool catalog và schema của hệ thống v3.
- **Kế hoạch Triển khai (28 Tasks TDD):** [`docs/superpowers/plans/2026-09-29-ai-workflow-platform-v3.md`](docs/superpowers/plans/2026-09-29-ai-workflow-platform-v3.md) là bản chỉ dẫn thực thi bắt buộc theo từng task tuần tự.
- **Quy tắc Phân quyền Module & Git:** [`docs/team-workflow.md`](docs/team-workflow.md) là chuẩn tắc về ranh giới sở hữu thư mục (Module Ownership), quy chuẩn commit (Conventional Commits) và chiến lược nhánh.

### 1.2. Ranh giới với mã nguồn cũ (Legacy v2)
- Các thư mục cũ: `apps/api/`, `apps/web/`, `packages/dsl/`, `packages/engine/`, `db/migrations/` là **mã nguồn lưu trữ lịch sử (Read-only)**.
- **Tuyệt đối không sửa đổi** các file v2 trừ khi có yêu cầu trích xuất dữ liệu đối chứng. Mọi tính năng v3 được xây dựng độc lập tại:
  - `packages/tool-schemas/`
  - `packages/tool-adapters/`
  - `packages/planner/`
  - `packages/executor/`
  - `apps/chat-api/`
  - `apps/chat-web/`
  - `db/v3/`

---

## 2. Quy tắc Điều phối Chuyên gia (Specialist Routing)

Main Agent đóng vai trò **Điều phối viên trưởng (Antigravity Master Orchestrator)**. Nhiệm vụ phân tích, chia nhỏ và giao việc cho các chuyên gia chuyên trách:

| Lĩnh vực / Module | Chuyên gia phụ trách (Custom Agent Role) | Thư mục sở hữu (Ownership) |
|---|---|---|
| **Lập kế hoạch & Giám sát tiến độ** | `Senior Project Manager`, `Sprint Prioritizer` | `docs/superpowers/plans/` |
| **Kiến trúc tổng thể & Hợp đồng giao tiếp** | `Software Architect` | `packages/tool-schemas/`, `vitest.workspace.ts` |
| **API Backend, DB, Executor & Adapters** | `Backend Architect`, `Senior Developer` | `apps/chat-api/`, `packages/executor/`, `packages/tool-adapters/`, `db/v3/` |
| **AI Planner, Routing, Prompting, Evaluation** | `AI Engineer`, `Prompt Engineer` | `packages/planner/`, `prompts/`, `evaluations/` |
| **Giao diện Chat UI React 19 & SSE Client** | `Frontend Developer`, `UI Designer` | `apps/chat-web/` |
| **Thẩm định thực tế & Nghiệm thu chất lượng** | 🛡️ `Reality Checker`, `Code Reviewer` | Toàn quyền kiểm tra, không sửa trực tiếp mã nguồn |
| **Quản trị nhánh Git & Tự động hóa** | `Git Workflow Master`, `DevOps Automator` | Git workflows, scripts |

---

## 3. Quy chuẩn Kỹ thuật Bắt buộc (Superpowers Engineering Discipline)

Mọi agent tham gia thi công mã nguồn BẮT BUỘC tuân thủ nghiêm ngặt các nguyên tắc sau:

### 3.1. Chu trình TDD (Red-Green-Refactor)
1. **Viết test đỏ (Failing Test):** Viết unit/integration test mô tả đúng hành vi mong muốn và các giá trị kỳ vọng từ Spec.
2. **Xác nhận test fail:** Chạy lệnh test thực tế và chứng minh test thất bại đúng lý do (chưa có code/hàm chưa định nghĩa).
3. **Viết mã tối thiểu:** Triển khai logic vừa đủ để test chuyển sang màu xanh.
4. **Xác nhận test xanh:** Chạy lại lệnh test và kiểm chứng PASS 100%.
5. **Commit:** Thực hiện commit theo định dạng Conventional Commits (`feat(...)`, `test(...)`, `fix(...)`).

### 3.2. Không chấp nhận "Mock Ảo giác"
- Tuyệt đối không viết test mock hình thức (ví dụ: mock boolean `let approved = false` để giả vờ test race condition database).
- Các kiểm thử tương tranh (Concurrency) phải được chứng minh qua truy vấn `WHERE status = 'pending'` thật hoặc in-memory DB pool.
- Các kiểm thử Timeout phải kiểm tra tín hiệu hủy thực tế qua `AbortSignal`.
- Trọng tài `Reality Checker` mặc định phản biện "CHƯA ĐẠT" và yêu cầu bằng chứng chạy lệnh thực tế (output log, exit code 0) trước khi đóng task.

### 3.3. Ranh giới Sở hữu Module (Module Ownership)
- Mỗi subagent chỉ được phép tạo và sửa đổi files trong package mà vai trò của mình sở hữu.
- Không sửa chéo files của package khác. Khi cần tích hợp, 2 bên phải thỏa thuận interface chung tại `packages/tool-schemas` trước khi code.

---

## 4. Hợp đồng Bàn giao & Nghiệm thu (Review & Gate)

Sau khi hoàn thành mỗi task trong số 28 tasks:
1. Subagent thi công gửi báo cáo gồm: file đã tạo/sửa, output chạy test thực tế, commit hash.
2. Reviewer độc lập (`Reality Checker` hoặc `Code Reviewer`) soi xét mã nguồn và chạy lại toàn bộ test suite của package đó.
3. Nếu phát hiện sai sót $\to$ Yêu cầu sửa ngay lập tức trước khi chuyển sang task tiếp theo.
