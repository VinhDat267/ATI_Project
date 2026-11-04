# FLOW-05 · Khép dữ liệu và kết quả sáu luồng

**Trạng thái:** chờ · **Owner:** Integration + AI + backend + frontend preview · **Nhánh gợi ý:** `fix/flow-05-six-flow-composition`

**Phụ thuộc:** FLOW-01 và FLOW-04

## Mục tiêu

Nối production catalog và fixtures đầy đủ; hoàn thiện OFF-02/OFF-03/PM-01/PM-03/DEV-02/DEV-04.

## Thiết kế và phạm vi

- [Đặc tả](../../superpowers/specs/2026-11-04-current-flow-completion-design.md).
- [Kế hoạch, phần Task FLOW-05](../../superpowers/plans/2026-11-04-current-flow-completion.md#task-flow-05--khép-kín-dữ-liệu-và-kết-quả-sáu-luồng).
- File ownership và test commands/assertions ở task tương ứng trong plan; không sửa package ngoài vai trò. Chốt DTO chung trước sửa consumer.
- Một task/nhánh/worktree; đọc current head/handoff khi bắt đầu. Không sửa CURRENT-STATE/ROADMAP.

## Tiêu chí nghiệm thu

- [ ] Meet/invite/folder/email đúng; card/member/due đúng; report dựa nguồn/locale/page phạm vi; fixture thiếu không giả success; context giữ qua ChatService hỏi/sửa; không thêm share tool hoặc connector.
- [ ] Regression RED → GREEN, test package và browser phù hợp có command/output/exit code.
- [ ] Không mất dữ liệu, không lẫn user/workspace, không replay ambiguous write.
- [ ] Review độc lập và CI đúng final SHA; kết quả code/offline/live phân biệt.
- [ ] Điền Kết quả và thêm một log mới trong cùng PR.

## Kết quả

Chưa triển khai. Không dùng checklist chưa đánh dấu để suy ra code đã có hoặc provider đã nghiệm thu.
