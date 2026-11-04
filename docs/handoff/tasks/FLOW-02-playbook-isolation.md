# FLOW-02 · Playbook local tách account/workspace

**Trạng thái:** chờ · **Owner:** Frontend · **Nhánh gợi ý:** `fix/flow-02-playbook-isolation`

**Phụ thuộc:** Không phụ thuộc FLOW-01.

## Mục tiêu

Thay key toàn cục bằng namespace user/workspace, bảo toàn dữ liệu v1 không rõ owner.

## Thiết kế và phạm vi

- [Đặc tả](../../superpowers/specs/2026-11-04-current-flow-completion-design.md).
- [Kế hoạch, phần Task FLOW-02](../../superpowers/plans/2026-11-04-current-flow-completion.md#task-flow-02--tách-local-playbook-theo-accountworkspace).
- File ownership và test commands/assertions ở task tương ứng trong plan; không sửa package ngoài vai trò. Chốt DTO chung trước sửa consumer.
- Một task/nhánh/worktree; đọc current head/handoff khi bắt đầu. Không sửa CURRENT-STATE/ROADMAP.

## Tiêu chí nghiệm thu

- [ ] A/B và personal/org/Jira context không lẫn; callback Save sau đổi scope không ghi nhầm; v1 quarantine không tự gán; quota/corrupt/giới hạn 12 không gây báo thành công sai hoặc mất mẫu.
- [ ] Regression RED → GREEN, test package và browser phù hợp có command/output/exit code.
- [ ] Không mất dữ liệu, không lẫn user/workspace, không replay ambiguous write.
- [ ] Review độc lập và CI đúng final SHA; kết quả code/offline/live phân biệt.
- [ ] Điền Kết quả và thêm một log mới trong cùng PR.

## Kết quả

Chưa triển khai. Không dùng checklist chưa đánh dấu để suy ra code đã có hoặc provider đã nghiệm thu.
