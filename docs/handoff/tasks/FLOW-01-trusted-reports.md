# FLOW-01 · Báo cáo PR có nguồn, đóng F1

**Trạng thái:** chờ · **Owner:** AI + backend + integration/schema + frontend metadata · **Nhánh gợi ý:** `fix/flow-01-trusted-reports`

**Phụ thuộc:** Không phụ thuộc task mới; theo baseline thực thi đã chốt.

## Mục tiêu

Không cho báo cáo PR chứa dữ kiện model tự dựng khi chưa có read hợp lệ; chốt contract artifacts cho bốn loại báo cáo.

## Thiết kế và phạm vi

- [Đặc tả](../../superpowers/specs/2026-11-04-current-flow-completion-design.md).
- [Kế hoạch, phần Task FLOW-01](../../superpowers/plans/2026-11-04-current-flow-completion.md#task-flow-01--báo-cáo-pr-có-nguồn-đóng-f1).
- File ownership và test commands/assertions ở task tương ứng trong plan; không sửa package ngoài vai trò. Chốt DTO chung trước sửa consumer.
- Một task/nhánh/worktree; đọc current head/handoff khi bắt đầu. Không sửa CURRENT-STATE/ROADMAP.

## Tiêu chí nghiệm thu

- [ ] Không có read hoặc read lỗi: không persist/approve/dispatch báo cáo; hai PR fixture cho đúng count và link; metadata giả/khác actor/workspace/connection bị chặn; facts hiển thị khớp nội dung đã hash.
- [ ] Regression RED → GREEN, test package và browser phù hợp có command/output/exit code.
- [ ] Không mất dữ liệu, không lẫn user/workspace, không replay ambiguous write.
- [ ] Review độc lập và CI đúng final SHA; kết quả code/offline/live phân biệt.
- [ ] Điền Kết quả và thêm một log mới trong cùng PR.

## Kết quả

Chưa triển khai. Không dùng checklist chưa đánh dấu để suy ra code đã có hoặc provider đã nghiệm thu.
