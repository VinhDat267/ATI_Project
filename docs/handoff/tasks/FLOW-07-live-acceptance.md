# FLOW-07 · Nghiệm thu live và sáu persona mô phỏng

**Trạng thái:** chờ · **Owner:** Reviewer + người vận hành tài khoản thử · **Nhánh gợi ý:** `test/flow-07-live-acceptance`

**Phụ thuộc:** FLOW-01 đến FLOW-06

## Mục tiêu

Chứng minh sáu luồng × ba lần live, 36 câu hồi quy và góc nhìn sáu vai trò.

## Thiết kế và phạm vi

- [Đặc tả](../../superpowers/specs/2026-11-04-current-flow-completion-design.md).
- [Kế hoạch, phần Task FLOW-07](../../superpowers/plans/2026-11-04-current-flow-completion.md#task-flow-07--nghiệm-thu-live-và-mô-phỏng-sáu-vai-trò).
- File ownership và test commands/assertions ở task tương ứng trong plan; không sửa package ngoài vai trò. Chốt DTO chung trước sửa consumer.
- Một task/nhánh/worktree; đọc current head/handoff khi bắt đầu. Không sửa CURRENT-STATE/ROADMAP.

## Tiêu chí nghiệm thu

- [ ] UI/DB/provider đọc lại khớp; source hash/CI đúng head; không sai đích/trùng/false success; kết quả mô phỏng ghi riêng không nhân thành số liệu người thật; connector lỗi giữ NOT_RUN.
- [ ] Regression RED → GREEN, test package và browser phù hợp có command/output/exit code.
- [ ] Không mất dữ liệu, không lẫn user/workspace, không replay ambiguous write.
- [ ] Review độc lập và CI đúng final SHA; kết quả code/offline/live phân biệt.
- [ ] Điền Kết quả và thêm một log mới trong cùng PR.

## Kết quả

Chưa triển khai. Không dùng checklist chưa đánh dấu để suy ra code đã có hoặc provider đã nghiệm thu.
