# ATI Project — Multi-Agent Engineering Protocol (v3)

**Version:** 3.1  

> **Đối tượng:** Tài liệu này áp dụng cho mọi AI coding assistant làm việc với
> repository này (Antigravity, Codex, Claude Code, Cursor, Gemini CLI, v.v.).
> Dù bạn là agent nào, hãy tuân thủ các quy tắc dưới đây khi đọc/ghi code
> trong repo `ATI_Project`.

> **Bắt đầu ở đây:** trước khi làm bất cứ việc gì, đọc [`docs/handoff/CURRENT-STATE.md`](docs/handoff/CURRENT-STATE.md) (dự án đang ở đâu) và [`docs/handoff/README.md`](docs/handoff/README.md) (cách nhận việc và bàn giao). Việc cần làm nằm trong [`docs/handoff/ROADMAP.md`](docs/handoff/ROADMAP.md) và `docs/handoff/tasks/`.

## 1. Phạm vi & Quyền lực chuẩn tắc (Scope & Source of Truth)

Tài liệu này quy định các ranh giới kỹ thuật đặc thù cho repository `ATI_Project`. Toàn bộ phương pháp luận Superpowers và vai trò Antigravity Master Orchestrator được tự động kế thừa từ **Global Rules**.

### 1.1. Quyền lực phạm vi v3 (Active Scope Authority)
- **Báo cáo Tổng quan Project:** [`docs/PROJECT-REPORT.md`](docs/PROJECT-REPORT.md) là tài liệu mô tả toàn cảnh dự án (mục tiêu, kiến trúc, tiến độ). Đọc file này trước để nắm bức tranh tổng thể.
- **Đặc tả Thiết kế v3:** [`docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md`](docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md) là tài liệu chuẩn tắc duy nhất về hành vi nghiệp vụ, luồng xử lý, tool catalog và schema của hệ thống v3.
- **Kế hoạch Triển khai:** [`docs/superpowers/plans/2026-09-29-ai-workflow-platform-v3.md`](docs/superpowers/plans/2026-09-29-ai-workflow-platform-v3.md) chứa 28 tasks nền và backlog Phase 7 đa dịch vụ còn mở. Hoàn thành 28 tasks không đồng nghĩa hoàn thành toàn bộ scope sản phẩm.
- **Quy tắc Phân quyền Module & Git:** [`docs/team-workflow.md`](docs/team-workflow.md) là chuẩn tắc về ranh giới sở hữu thư mục (Module Ownership), quy chuẩn commit (Conventional Commits) và chiến lược nhánh.

### 1.2. Phạm vi nền tảng đa dịch vụ
- Mục tiêu sản phẩm là workflow trên nhiều dịch vụ bên ngoài đã tích hợp và được cấp quyền; Trello/Slack chỉ là đợt triển khai đầu tiên.
- Áp dụng tiêu chí nghiệm thu ở mục 1.4 của đặc tả v3. Không tuyên bố hoàn thành nền tảng chỉ dựa trên demo hai dịch vụ hoặc một adapter giả lập bổ sung.
- [`docs/MULTI-SERVICE-SCOPE.md`](docs/MULTI-SERVICE-SCOPE.md) ghi khoảng cách mã nguồn và backlog; tài liệu này không thay thế quyền lực chuẩn tắc của đặc tả v3.
- Khi thêm dịch vụ, phải xét catalog, routing/gather, adapter, xác thực, phạm vi tài nguyên, API/UI cấu hình và kiểm thử liên dịch vụ; không giả định chỉ cần thêm một file adapter.

### 1.3. Ranh giới với mã nguồn cũ (Legacy v2)
- Các thư mục cũ: `apps/api/`, `apps/web/`, `packages/dsl/`, `packages/engine/`, `db/migrations/` là **mã nguồn lưu trữ lịch sử (Read-only)**.
- **Tuyệt đối không sửa đổi** các file v2 trừ khi có yêu cầu trích xuất dữ liệu đối chứng. Mọi tính năng v3 được xây dựng độc lập tại:
  - `packages/tool-schemas/`
  - `packages/tool-adapters/`
  - `packages/planner/`
  - `packages/executor/`
  - `apps/chat-api/`
  - `apps/chat-web/`
  - `db/v3/`
  - `prompts/`
  - `evaluations/`

---

## 2. Ranh giới Sở hữu Module (Module Ownership)

- Phân chia quyền sở hữu file và thư mục giữa các chuyên gia được quy định chi tiết tại **Mục 1 của [`docs/team-workflow.md`](docs/team-workflow.md)**.
- Mỗi subagent chỉ được phép tạo và sửa đổi files trong package mà vai trò của mình sở hữu.
- Không sửa chéo files của package khác. Khi cần tích hợp, 2 bên phải thỏa thuận interface chung tại `packages/tool-schemas` trước khi code.

---

## 3. Tiêu chuẩn Bằng chứng & Kiểm thử (Evidence Standards)

- **Tuyệt đối không dùng "Mock ảo giác":** Không viết test mock hình thức (ví dụ: mock boolean `let approved = false` để giả vờ test race condition database).
- **Kiểm thử Concurrency thực tế:** Phải chứng minh qua câu lệnh truy vấn `WHERE status = 'pending'` thật hoặc in-memory DB pool.
- **Kiểm thử Timeout thực tế:** Phải kiểm tra tín hiệu hủy thực tế thông qua `AbortSignal`.
- Trọng tài `Reality Checker` mặc định phản biện "CHƯA ĐẠT" và yêu cầu bằng chứng chạy lệnh thực tế (output log, exit code 0) trước khi đóng task.

---

## 4. Bàn giao và nghiệm thu giữa các agent (bắt buộc)

Nhiều agent khác nhau cùng làm dự án này và không agent nào nhớ phiên của agent khác. Trí nhớ chung nằm trong `docs/handoff/` (xem `docs/handoff/README.md`).

1. **Trước khi làm:** đọc `docs/handoff/CURRENT-STATE.md` và 3 file mới nhất trong `docs/handoff/log/`. Chạy `git status` và `git log -5 --format='%h %ar %s'`; nếu thư mục có thay đổi chưa commit không phải của bạn, hoặc đang ở một nhánh có commit mới của agent khác, làm trong `git worktree` riêng, không chuyển nhánh.
2. **Khi làm:** chỉ làm một task card trong `docs/handoff/tasks/`, trên nhánh riêng, đúng phạm vi. TDD, bằng chứng thật như mục 3. Khi commit, chỉ `git add` đúng các file của task.
3. **Khi xong:** trong cùng PR, điền phần "Kết quả" của task card và thêm **một file mới** trong `docs/handoff/log/`. Không sửa `CURRENT-STATE.md` hay `ROADMAP.md` (chỉ reviewer sửa, sau khi merge). Mô tả PR theo `.github/pull_request_template.md`, có file đã sửa, output test thật, commit hash; không có dòng "Generated with …" hay chữ ký AI.
4. **Review:** reviewer độc lập review theo `docs/handoff/REVIEW-CHECKLIST.md`, chạy lại test ở máy, mặc định kết luận "chưa đạt" cho tới khi có bằng chứng. Phát hiện sai sót thì sửa trước khi sang task tiếp theo.
5. **Merge:** chỉ khi CI xanh và review đạt. Sau khi merge, reviewer cập nhật `CURRENT-STATE.md` và `ROADMAP.md`.
