# 2026-11-04 · FLOW-00 · Kế hoạch hoàn thiện Planora

## Bối cảnh

Người dùng yêu cầu lên plan từ audit trước đó. Chốt qua câu hỏi: Playbook tiếp tục local, tách account/workspace. Lập kế hoạch trên worktree riêng từ `0b62372c4bdf4597fde0b560ada70cabec3ea393`; checkout nguồn `feat/rebrand-planora` có file khóa Word ngoài task, không động vào.

Đã đọc CURRENT-STATE, README, ROADMAP, FINISH-PLAN, v3 spec, team workflow và ba log mới nhất; CodeGraph kiểm RequestMoments, validator, source grounding và digest trước khi chốt hướng sửa.

## Bàn giao

- [FLOW-00](../tasks/FLOW-00-plan-existing-flows.md) và bảy task card FLOW-01…07.
- [Spec](../../superpowers/specs/2026-11-04-current-flow-completion-design.md).
- [Implementation plan](../../superpowers/plans/2026-11-04-current-flow-completion.md).

Thứ tự: chặn báo cáo không nguồn → tách mẫu và bảo toàn sửa đổi → onboarding/defaults → khép sáu luồng → lịch/recovery → live acceptance. Không thêm dịch vụ/đồng bộ mẫu server.

## Kiểm tra và giới hạn

Tự review theo writing-plans: coverage F1…F4, source/head, shared DTO, dependencies, failure cases và live boundaries. Kiểm links nội bộ, whitespace và diff chỉ docs. Chưa thực thi task sửa lỗi, chưa chạy model/provider/test sản phẩm và chưa tạo CI. Chỉ lập kế hoạch; khi thi công từng task phải lấy head mới, chạy RED/GREEN và review độc lập đúng protocol.

Báo cáo audit gốc ở commit local `fb385830`; lấy bằng `git show fb385830:docs/audits/2026-11-04-user-value/REPORT.md` và `cases.json` cùng thư mục. Không cherry-pick hoặc merge nhánh audit tự động.
