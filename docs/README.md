# Chỉ mục tài liệu ATI Project

## Bắt đầu

- [README gốc](../README.md): cài đặt, chạy sandbox/live và các lệnh.
- [Trạng thái hiện tại](handoff/CURRENT-STATE.md): số liệu mới nhất, lỗi đã biết, quy tắc đã chốt. Đọc trước khi làm bất cứ việc gì.
- [Bàn giao giữa các agent](handoff/README.md), [lộ trình](handoff/ROADMAP.md) và [task card](handoff/tasks/).
- [Môi trường v3 cục bộ](V3-LOCAL-SETUP.md): PostgreSQL thật ở chế độ sandbox.

## Thiết kế và phạm vi

- [Đặc tả v3](superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md) và [kế hoạch triển khai](superpowers/plans/2026-09-29-ai-workflow-platform-v3.md): hành vi thiết kế, 28 tasks nền và backlog Phase 7 đa dịch vụ.
- [Phạm vi nền tảng đa dịch vụ](MULTI-SERVICE-SCOPE.md): mục tiêu sản phẩm, giới hạn mã, backlog và tiêu chí nghiệm thu dẫn từ đặc tả.
- [Báo cáo dự án](PROJECT-REPORT.md): mục tiêu, kiến trúc, tiến độ đến 29/09; số liệu mới hơn ở CURRENT-STATE.
- [Quy ước làm việc nhóm](team-workflow.md): sở hữu module, commit, nhánh.
- Tài liệu đề tài ban đầu: [mô tả dự án](mo-ta-du-an.md), [yêu cầu chức năng](functional-requirements.md), [màn hình](screens.html), [wireframe](wireframes.html), [ADR-001](ADR-001-FRONTEND-STACK.md), [ADR-002](ADR-002-FRONTEND-UI-DATA-LAYER.md). Các tài liệu này viết cho v1/v2; giữ lại làm tham khảo cho báo cáo môn học.

## Bằng chứng

- [Rà soát v3 ngày 29/09](audits/2026-09-29-v3-review/REMEDIATION-RESULTS.md).
- [Golden set v3](ai-evidence/V3-GOLDEN-V2/) và [probe planner live](ai-evidence/V3-LIVE-PLANNER/). Bằng chứng chạy service thật và tài khoản thật được Git bỏ qua, chỉ lưu ở máy nhóm trưởng.

## Mã và tài liệu v1/v2

Đã xoá khỏi `main` ngày 05/10/2026. Ảnh chụp trước khi xoá là tag `archive/v2-final`; đọc một file bằng `git show archive/v2-final:<đường dẫn>`.

## Quy tắc dọn file sinh ra

- `dist/`, `generated/` và output build/test bị Git bỏ qua có thể tạo lại bằng lệnh build hoặc test tương ứng. Chỉ dọn sau khi xác nhận không có tiến trình đang dùng và đường dẫn không chứa file được Git theo dõi.
- `.artifacts/`, `.cache/`, `.playwright-mcp/` và `runtime/` có thể chứa capture hoặc dữ liệu chạy thử chưa đưa vào Git; xem từng mục trước khi quyết định lưu hay xoá.
- Giữ `node_modules/` khi còn phát triển và `.codegraph/` khi còn dùng chỉ mục.
