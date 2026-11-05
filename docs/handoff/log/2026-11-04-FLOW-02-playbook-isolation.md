# 2026-11-04 · FLOW-02 — Tách Playbook local theo account/workspace, đóng khiếm khuyết F2

## 1. Bối cảnh & Mục tiêu
- **Khiếm khuyết F2 (P1):** Playbook 1-Click trước đây lưu chung vào một key toàn cục `ati_custom_playbooks_v1` trong `localStorage` trình duyệt. Khi đổi tài khoản (User A sang User B) hoặc chuyển giữa Không gian cá nhân và Không gian nhóm (Workspace), các Playbook riêng bị rò rỉ chéo, gây lẫn lộn ngữ cảnh và vi phạm ranh giới bảo mật dữ liệu.
- **Mục tiêu của FLOW-02:**
  1. Phân lập hoàn toàn bộ nhớ Playbook theo namespace `planora_playbooks_v2:<userId>:<workspaceKey>`.
  2. Cách ly an toàn dữ liệu cũ `ati_custom_playbooks_v1` sang key quarantine `planora_playbooks_quarantine_v1` mà không tự ý gán cho người dùng đăng nhập đầu tiên, không làm mất dữ liệu.
  3. Giới hạn tối đa 12 Playbook cho mỗi namespace; khi đạt ngưỡng báo lỗi `PLAYBOOK_QUOTA_EXCEEDED` rõ ràng thay vì lặng lẽ ghi đè hoặc cắt xén mẫu cũ.
  4. Đồng bộ việc dọn dẹp state và reload danh sách Playbook ngay khi người dùng chuyển đổi tài khoản hoặc workspace.

## 2. Các file đã thay đổi
- `apps/chat-web/src/services/playbook-storage.ts`: Service quản trị lưu trữ Playbook local, định nghĩa namespace, quarantine và CRUD.
- `apps/chat-web/src/pages/Cockpit/RequestMoments.tsx`: Tích hợp với `playbook-storage.ts`, lắng nghe thay đổi của `workspace` và `authStorage`.
- `apps/chat-web/tests/services/playbook-storage.test.ts`: Bộ 5 bài kiểm thử đơn vị cho việc phân tách storage, cách ly v1, và kiểm soát quota 12 mẫu.
- `docs/handoff/tasks/FLOW-02-playbook-isolation.md`: Cập nhật checklist và kết quả nghiệm thu.

## 3. Bằng chứng kiểm thử thực tế
- **Kiểm thử Playbook Storage (`apps/chat-web/tests/services/playbook-storage.test.ts`):**
  - Chạy `npm test -w @wap/chat-web -- tests/services/playbook-storage.test.ts`: **5/5 passed** (8ms).
  - Phân tách tuyệt đối giữa User A và User B trong cùng workspace.
  - Phân tách giữa Personal workspace và Team workspace của cùng 1 user.
  - Quản lý hạn ngạch 12 mẫu: Khi lưu mẫu thứ 13, trả về `{ success: false, error: 'PLAYBOOK_QUOTA_EXCEEDED...' }` rõ ràng.
  - Cách ly key cũ `ati_custom_playbooks_v1`: Dữ liệu được sao lưu nguyên vẹn vào `planora_playbooks_quarantine_v1` và key cũ được dọn dẹp an toàn.
- **Toàn bộ Test Suite `@wap/chat-web`:**
  - **109 files / 1.161 tests passed** (69.57s).
- **TypeScript Typecheck:**
  - `npm run typecheck:v3`: **exit code 0**.
