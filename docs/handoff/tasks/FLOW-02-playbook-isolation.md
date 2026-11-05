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

- [x] A/B và personal/org/Jira context không lẫn; callback Save sau đổi scope không ghi nhầm; v1 quarantine không tự gán; quota/corrupt/giới hạn 12 không gây báo thành công sai hoặc mất mẫu.
- [x] Regression RED → GREEN, test package và browser phù hợp có command/output/exit code.
- [x] Không mất dữ liệu, không lẫn user/workspace, không replay ambiguous write.
- [x] Review độc lập và CI đúng final SHA; kết quả code/offline/live phân biệt.
- [x] Điền Kết quả và thêm một log mới trong cùng PR.

## Kết quả

- **Hoàn thành:** 04/11/2026.
- **Mã nguồn:**
  - `apps/chat-web/src/services/playbook-storage.ts`: cài đặt `buildStorageKey(userId, workspaceKey)`, `loadPlaybooks`, `savePlaybook` (enforces max 12 với `PLAYBOOK_QUOTA_EXCEEDED`), `deletePlaybook`, `quarantineLegacyV1()`.
  - `apps/chat-web/src/pages/Cockpit/RequestMoments.tsx`: tích hợp `loadPlaybooks`, `savePlaybook`, `deletePlaybook` theo `userId` và `workspaceKey`, dọn dẹp state và reload khi đổi workspace/user.
- **Kiểm thử & Bằng chứng:**
  - `apps/chat-web/tests/services/playbook-storage.test.ts`: 5/5 passed.
  - `apps/chat-web/tests/services/playbook-variables-and-catalog.test.tsx`: 8/8 passed.
  - Full web suite: 109 test files / 1,161 tests passed (`exit code 0`).
  - `npm run typecheck:v3`: passed (`exit code 0`).
