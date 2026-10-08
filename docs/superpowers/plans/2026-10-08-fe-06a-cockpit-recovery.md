# FE-06 phần A — kế hoạch triển khai

**Goal:** Đưa khoảnh khắc 7–9 vào cockpit, giữ an toàn khôi phục và xử lý mục 10 của FE-06.
**Architecture:** Chép cấu trúc AppStagePage vào các component Cockpit. Snapshot và recoveryActions quyết định hành động; giữ nguyên API executor. Tham số sửa phải thành yêu cầu mới có kế hoạch duyệt mới, vì API retry không nhận tham số.
**Tech stack:** React, Zustand, Vitest, Playwright; không thêm dependency.
**Spec:** `docs/handoff/tasks/FE-06-cockpit-recovery-and-responses.md` mục 1–4, 8, 10; `docs/superpowers/specs/2026-10-05-ui-redesign-agentic-design.md` mục 1.2, 5, 6.

## Ràng buộc

- Chỉ apps/chat-web và tài liệu của FE-06A; không đổi backend/planner/executor, CURRENT-STATE hay ROADMAP.
- Bản React AppStagePage.tsx:2153–2404 là nguồn markup/class; dữ liệu thay bằng snapshot.
- Unknown không có retry/edit/continue kể cả recoveryActions sai; stopped giữ bằng chứng unknown nhưng hiển thị kết thúc.
- Không đổi màn khi phản hồi khôi phục muộn, kể cả rời rồi quay lại cùng hội thoại.
- Giữ mọi ca test hành vi cũ, chỉ chuyển component/selector.

## Các bước (thi công trong phiên hiện tại)

1. [x] Chạy baseline frontend; viết test RED qua Cockpit cho markup 7–9, actions, link, terminal; test P3 cho runtime, skipped, đóng sửa chat, tin plan SSE.
2. [x] Chép RecoveryMoment từ mẫu; thêm form sửa có nhãn theo inputSchema, xác nhận dừng, chi tiết đối chiếu args/output đã lưu. Dừng kế hoạch cũ rồi gửi yêu cầu sửa chỉ sau snapshot stopped; chờ người dùng duyệt kế hoạch mới.
3. [x] Nối Workspace/Cockpit, bỏ hai component cũ, chuyển toàn bộ test partial-failure/reconciliation; kiểm tra race qua API giả ở biên HTTP và store thật.
4. [x] Dùng ReceiptMoment cho kết thúc không thành công; đếm dịch vụ succeeded, thêm tin plan hiển thị theo planId, lấy runtime chung cho header/PlanMoment.
5. [x] GREEN frontend; browser dùng HTTP sandbox và PostgreSQL riêng, thêm snapshot unknown/restart vào fixture frontend nếu harness chưa có; giữ nguyên chính sách executor.
6. [ ] npm run check, npm run test:browser:v3, ảnh app và React 1440×900/375×812 sáng/tối, SHA256; tự kiểm diff; cập nhật Kết quả/log; commit và PR chờ review độc lập, không merge.

## Điểm cần review

- Snapshot thiếu pausedStepId, unknown xen failed, actions không nhất quán.
- Link đích không hợp lệ hoặc args chứa reference chưa resolve.
- Stop lỗi/conflict không được gửi yêu cầu sửa hoặc báo hoàn thành.
- Response muộn và thay plan trong cùng hội thoại không được ghi đè.
- Tiêu đề/output/link chỉ lấy từ succeeded; stopped/rejected/failed không gắn nhãn hoàn thành.

Kiểm tra/handoff đã đạt; bước6 còn PR/CI exact head và reviewer repository. Xem log FE-06A để biết bằng chứng và NOT_RUN.
