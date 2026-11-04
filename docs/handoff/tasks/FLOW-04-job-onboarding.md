# FLOW-04 · Bắt đầu theo việc và readiness thực

**Trạng thái:** chờ · **Owner:** Frontend + backend + integration/schema · **Nhánh gợi ý:** `fix/flow-04-job-onboarding`

**Phụ thuộc:** FLOW-02 và FLOW-03

## Mục tiêu

Đưa sáu job lên trước, kết nối/phạm vi/defaults rõ, không cần nhớ ID.

## Thiết kế và phạm vi

- [Đặc tả](../../superpowers/specs/2026-11-04-current-flow-completion-design.md).
- [Kế hoạch, phần Task FLOW-04](../../superpowers/plans/2026-11-04-current-flow-completion.md#task-flow-04--bắt-đầu-theo-công-việc-và-biết-còn-thiếu-gì).
- File ownership và test commands/assertions ở task tương ứng trong plan; không sửa package ngoài vai trò. Chốt DTO chung trước sửa consumer.
- Một task/nhánh/worktree; đọc current head/handoff khi bắt đầu. Không sửa CURRENT-STATE/ROADMAP.

## Tiêu chí nghiệm thu

- [ ] Chỉ 2/9 kết nối không thành ready cho mẫu9; đúng CTA cho config/consent/resource; defaults theo scope và precedence; resource ngoài quyền bị chặn; yêu cầu đang soạn được giữ qua connect.
- [ ] Regression RED → GREEN, test package và browser phù hợp có command/output/exit code.
- [ ] Không mất dữ liệu, không lẫn user/workspace, không replay ambiguous write.
- [ ] Review độc lập và CI đúng final SHA; kết quả code/offline/live phân biệt.
- [ ] Điền Kết quả và thêm một log mới trong cùng PR.

## Kết quả

Chưa triển khai. Không dùng checklist chưa đánh dấu để suy ra code đã có hoặc provider đã nghiệm thu.
