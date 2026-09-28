# ATI Project — Multi-Agent Engineering Protocol (v3)

## 1. Phạm vi & Quyền lực chuẩn tắc (Scope & Source of Truth)

Tài liệu này quy định cách thức phối hợp và kỷ luật kỹ thuật giữa các AI Subagents và Main Agent trong repository `ATI_Project`. Vai trò điều phối viên trưởng và các khối chuyên gia chuyên trách được kế thừa trực tiếp từ **Global Rules của Antigravity Master Orchestrator**.

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

## 2. Quy chuẩn Kỹ thuật Bắt buộc (Superpowers Engineering Discipline)

Mọi agent tham gia thi công mã nguồn BẮT BUỘC tuân thủ nghiêm ngặt các nguyên tắc sau:

### 2.1. Chu trình TDD (Red-Green-Refactor)
1. **Viết test đỏ (Failing Test):** Viết unit/integration test mô tả đúng hành vi mong muốn và các giá trị kỳ vọng từ Spec.
2. **Xác nhận test fail:** Chạy lệnh test thực tế và chứng minh test thất bại đúng lý do (chưa có code/hàm chưa định nghĩa).
3. **Viết mã tối thiểu:** Triển khai logic vừa đủ để test chuyển sang màu xanh.
4. **Xác nhận test xanh:** Chạy lại lệnh test và kiểm chứng PASS 100%.
5. **Commit:** Thực hiện commit theo định dạng Conventional Commits (`feat(...)`, `test(...)`, `fix(...)`).

### 2.2. Không chấp nhận "Mock Ảo giác"
- Tuyệt đối không viết test mock hình thức (ví dụ: mock boolean `let approved = false` để giả vờ test race condition database).
- Các kiểm thử tương tranh (Concurrency) phải được chứng minh qua truy vấn `WHERE status = 'pending'` thật hoặc in-memory DB pool.
- Các kiểm thử Timeout phải kiểm tra tín hiệu hủy thực tế qua `AbortSignal`.
- Trọng tài `Reality Checker` mặc định phản biện "CHƯA ĐẠT" và yêu cầu bằng chứng chạy lệnh thực tế (output log, exit code 0) trước khi đóng task.

### 2.3. Ranh giới Sở hữu Module (Module Ownership)
- Phân chia quyền sở hữu file và thư mục giữa các chuyên gia được quy định chi tiết tại **Mục 1 của [`docs/team-workflow.md`](docs/team-workflow.md)**.
- Mỗi subagent chỉ được phép tạo và sửa đổi files trong package mà vai trò của mình sở hữu.
- Không sửa chéo files của package khác. Khi cần tích hợp, 2 bên phải thỏa thuận interface chung tại `packages/tool-schemas` trước khi code.

---

## 3. Hợp đồng Bàn giao & Nghiệm thu (Review & Gate)

Sau khi hoàn thành mỗi task trong số 28 tasks:
1. Subagent thi công gửi báo cáo gồm: file đã tạo/sửa, output chạy test thực tế, commit hash.
2. Reviewer độc lập (`Reality Checker` hoặc `Code Reviewer`) soi xét mã nguồn và chạy lại toàn bộ test suite của package đó.
3. Nếu phát hiện sai sót $\to$ Yêu cầu sửa ngay lập tức trước khi chuyển sang task tiếp theo.
