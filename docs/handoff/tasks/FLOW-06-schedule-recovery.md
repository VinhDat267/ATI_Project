# FLOW-06 · Lịch và phục hồi lỗi rõ ràng

**Trạng thái:** chờ · **Owner:** Backend + frontend + integration AbortSignal · **Nhánh gợi ý:** `fix/flow-06-schedule-recovery`

**Phụ thuộc:** FLOW-01, FLOW-04 và FLOW-05

## Mục tiêu

Phân biệt duyệt từng lượt/tự gửi, làm rõ pause/resume/quyền thay đổi và delivery unknown.

## Thiết kế và phạm vi

- [Đặc tả](../../superpowers/specs/2026-11-04-current-flow-completion-design.md).
- [Kế hoạch, phần Task FLOW-06](../../superpowers/plans/2026-11-04-current-flow-completion.md#task-flow-06--lịch-khôi-phục-lỗi-và-quyền-thay-đổi).
- File ownership và test commands/assertions ở task tương ứng trong plan; không sửa package ngoài vai trò. Chốt DTO chung trước sửa consumer.
- Một task/nhánh/worktree; đọc current head/handoff khi bắt đầu. Không sửa CURRENT-STATE/ROADMAP.

## Tiêu chí nghiệm thu

- [ ] PostgreSQL thật + loopback chứng minh không replay khi kết quả chưa rõ; abort thực; revoke/source-swap chặn; resume không backfill lượt bỏ lỡ; UI cho biết đúng chế độ/timezone/next run và việc cần làm.
- [ ] Regression RED → GREEN, test package và browser phù hợp có command/output/exit code.
- [ ] Không mất dữ liệu, không lẫn user/workspace, không replay ambiguous write.
- [ ] Review độc lập và CI đúng final SHA; kết quả code/offline/live phân biệt.
- [ ] Điền Kết quả và thêm một log mới trong cùng PR.

## Kết quả

Chưa triển khai. Không dùng checklist chưa đánh dấu để suy ra code đã có hoặc provider đã nghiệm thu.
