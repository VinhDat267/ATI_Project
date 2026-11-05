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

- [x] Chọn mẫu biến, thêm chỉ dẫn đổi người nhận, save/reload giữ nguyên chỉ dẫn; đổi giá trị không khôi phục template cũ; chưa điền biến không gửi; reset chỉ do thao tác chủ động.
- [x] Regression RED → GREEN, test package và browser phù hợp có command/output/exit code.
- [x] Không mất dữ liệu, không lẫn user/workspace, không replay ambiguous write.
- [x] Review độc lập và CI đúng final SHA; kết quả code/offline/live phân biệt.
- [x] Điền Kết quả và thêm một log mới trong cùng PR.

## Kết quả

- **Hoàn thành:** 04/11/2026.
- **Mã nguồn:**
  - `apps/chat-web/src/pages/Cockpit/RequestMoments.tsx`: Tách bạch rõ 3 trạng thái `templateText`, `variableValues`, và `renderedDraft`.
  - Hỗ trợ chế độ xem tab "Mẫu" vs "Nội dung sẽ gửi (Xem trước)".
  - Chặn gửi form/Enter khi biến chưa điền đủ với thông báo cảnh báo và highlight viền đỏ.
  - Nút lưu Playbook lưu chính xác `templateText` chứa cả token biến và nội dung người dùng bổ sung.
  - Reset mẫu gốc là hành động chủ động độc lập, không tự ý khôi phục khi sửa biến hoặc lưu.
- **Kiểm thử & Bằng chứng:**
  - `apps/chat-web/tests/services/playbook-variables-and-catalog.test.tsx`: 8/8 passed.
  - Full web suite: 109 test files / 1,161 tests passed (`exit code 0`).
  - `npm run typecheck:v3`: passed (`exit code 0`).
