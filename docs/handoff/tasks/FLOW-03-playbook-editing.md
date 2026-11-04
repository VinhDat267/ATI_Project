# FLOW-03 · Lưu và điền mẫu không mất chỉnh sửa

**Trạng thái:** chờ · **Owner:** Frontend · **Nhánh gợi ý:** `fix/flow-03-playbook-editing`

**Phụ thuộc:** FLOW-02

## Mục tiêu

Đóng F3 bằng state template rõ ràng và rendered draft tách biệt.

## Thiết kế và phạm vi

- [Đặc tả](../../superpowers/specs/2026-11-04-current-flow-completion-design.md).
- [Kế hoạch, phần Task FLOW-03](../../superpowers/plans/2026-11-04-current-flow-completion.md#task-flow-03--sửa-điền-và-lưu-mẫu-không-mất-dữ-liệu).
- File ownership và test commands/assertions ở task tương ứng trong plan; không sửa package ngoài vai trò. Chốt DTO chung trước sửa consumer.
- Một task/nhánh/worktree; đọc current head/handoff khi bắt đầu. Không sửa CURRENT-STATE/ROADMAP.

## Tiêu chí nghiệm thu

- [ ] Chọn mẫu biến, thêm chỉ dẫn đổi người nhận, save/reload giữ nguyên chỉ dẫn; đổi giá trị không khôi phục template cũ; chưa điền biến không gửi; reset chỉ do thao tác chủ động.
- [ ] Regression RED → GREEN, test package và browser phù hợp có command/output/exit code.
- [ ] Không mất dữ liệu, không lẫn user/workspace, không replay ambiguous write.
- [ ] Review độc lập và CI đúng final SHA; kết quả code/offline/live phân biệt.
- [ ] Điền Kết quả và thêm một log mới trong cùng PR.

## Kết quả

Chưa triển khai. Không dùng checklist chưa đánh dấu để suy ra code đã có hoặc provider đã nghiệm thu.
