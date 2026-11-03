# Nhật ký thi công: Khắc phục Codex review findings Vòng 3 cho PL-02

- **Ngày:** 03/11/2026
- **Người thực hiện:** Antigravity / Gemini worker
- **Nhiệm vụ:** [PL-02 · Shell, sidebar và không gian cá nhân/tổ chức](../tasks/PL-02-planora-shell-workspaces.md)
- **Worktree:** `feat-planora-pl-02`
- **Nhánh:** `longnguyen005/feat-planora-pl-02`
- **Reviewed Head SHA:** `d291b7d0f88af1f785087cd1ad17efe830691daa`
- **Base SHA:** `83ea86123b36201f4e00601b384fdb846dee80e0`

---

## 1. Tóm tắt 2 Findings (P2) từ Codex Review Vòng 3 & Giải pháp

### Finding 1: R2 (P2) — Click chuột vào input trong portal modal unmount trigger và làm rớt focus ra `document.body`
- **Nguyên nhân:**
  - Modal form tạo/tham gia tổ chức được render qua `createPortal` vào trực tiếp `document.body` (bên ngoài `menuRef` của dropdown WorkspaceSwitcher).
  - Khi người dùng click chuột vào input trong modal portal, listener `handleOutside` (mousedown trên document) nhận diện target không thuộc `menuRef.current`, dẫn đến `setOpen(false)` và unmount các nút trigger `createTriggerRef` / `joinTriggerRef`.
  - Khi modal đóng (qua Escape, nút Close hoặc Cancel), hàm restore focus gọi `createTriggerRef.current?.focus()` vào phần tử đã bị gỡ khỏi DOM, khiến trình duyệt đẩy focus về `document.body`.
- **Khắc phục:**
  - Trong `apps/chat-web/src/components/layout/WorkspaceSwitcher.tsx`:
    1. Cập nhật `handleOutside`: nếu `showCreateModal || showJoinModal` đang là `true`, HOẶC target click nằm trong `createModalRef.current` / `joinModalRef.current`, hàm lập tức return sớm và không đóng dropdown.
    2. Bổ sung dependency array của `handleOutside`: `[showCreateModal, showJoinModal]`.
    3. Thêm hàm `restoreCreateFocus()` và `restoreJoinFocus()`: kiểm tra `document.body.contains(triggerRef.current)`. Nếu trigger còn trong DOM thì focus vào trigger; nếu trigger bị unmount thì fallback an toàn về `buttonRef.current` (nút WorkspaceSwitcher). Focus tuyệt đối không bao giờ rớt ra `document.body`.
    4. Cập nhật toàn bộ các điểm đóng modal (phím Escape, nút "✕" close, nút "Hủy" / "Đóng") gọi các hàm restore focus an toàn.
  - Trong `apps/chat-web/tests/planora-shell.test.tsx`:
    - Thêm bước mô phỏng `fireEvent.mouseDown(orgNameInput)` trong modal portal và assert `createOrgBtn` vẫn nằm trong document (dropdown không bị unmount). Nhấn Escape, assert focus quay về `createOrgBtn` và `document.activeElement !== document.body`.
    - Bổ sung test regression: Khi trigger button bị remove khỏi DOM trong lúc modal đang mở, đóng modal qua Escape tự động fallback focus về `switcherBtn` (`buttonRef`), tuyệt đối không rớt ra `document.body`.

### Finding 2: R3 (P2) — Nâng cấp test F1 lên App integration test & Bổ sung verification late SSE cross-workspace
- **Nguyên nhân:**
  - Test F1 trước đó chỉ test ở unit level với inline `handleNewConversation`, không mount component `<App />` và không kiểm chứng đoạn mã thực tế tại `App.tsx:45-49`.
  - Test cross-workspace isolation có tên chứa "GET/SSE" nhưng mới chỉ kiểm tra delayed GET promise, chưa dispatch late SSE event từ workspace cũ.
- **Khắc phục:**
  - Trong `apps/chat-web/tests/planora-shell.test.tsx`:
    1. **Nâng cấp test F1 & R3 lên integration test mount `<App />` thật:**
       - Thiết lập user đăng nhập, khởi tạo route `/c/c1` bằng `window.history.replaceState`.
       - Render `<App />` trực tiếp, gửi tin nhắn thật qua composer input ("Chạy phân tích c1") với `apiClient.sendMessage` pending.
       - Assert `isPlanning: true` và `planningByConversation['c1']` được ghi nhận, nút gửi tin nhắn bị disabled.
       - Click nút "Hội thoại mới" trên sidebar thật bên trong `<App />` (gọi hàm `App.tsx:handleNewConversation`).
       - Assert URL chuyển về `/`, `conversationId: null`, `isPlanning: false`, và `planningByConversation['c1']` vẫn được bảo lưu (invariant quan trọng).
       - Dùng `window.history.pushState` và dispatch `PopStateEvent('popstate')` quay lại `/c/c1`.
       - Assert `isPlanning: true` được store tự động phục hồi trên `c1`, nút gửi vẫn disabled khi nhập draft mới cho tới khi in-flight request kết thúc.
       - Giải quyết promise send và gọi `setIsPlanning(false, 'c1')`, assert `isPlanning` trở về `false` và c1 mở khóa cho các request tiếp theo.
    2. **Bằng chứng RED -> GREEN cho `App.tsx:46`:**
       - Tạm thời sửa `App.tsx:46` từ `reset({ preservePlanning: true })` thành `reset()` (bỏ preservePlanning).
       - Chạy test F1 & R3: **FAIL ngay lập tức** với lỗi `AssertionError: expected undefined to be defined` tại `expect(useChatStore.getState().planningByConversation['c1']).toBeDefined()`.
       - Khôi phục lại `{ preservePlanning: true }`: **PASS 19/19 tests**.
    3. **Bổ sung verification late SSE cross-workspace:**
       - Trong test `ignores deferred GET/SSE responses...`: sau khi chuyển workspace sang `personal`, dispatch các late SSE events từ Alpha thông qua `handleSSEEvent('clarification', ...)` và `handleSSEEvent('plan', ...)`.
       - Assert store của Personal hoàn toàn sạch sẽ: `messages` rỗng, `activeClarification: null`, `activePlan: null`.

---

## 2. Bảng Bằng chứng Kiểm thử Thực tế

| Lệnh kiểm thử | Kết quả | Ghi chú |
|---|---|---|
| `npm run typecheck:v3` | **PASS (exit code 0)** | Chat API & Chat Web 0 errors |
| `npm test -w @wap/chat-web -- tests/planora-shell.test.tsx` | **PASS (19/19 tests, exit code 0)** | Bao phủ App integration F1/R3, delayed GET/SSE, modal portal focus fallback |
| `npm test -w @wap/chat-web` | **PASS (98/98 files, 1.075/1.075 tests, exit code 0)** | Toàn bộ unit test suite của chat-web |
| `npm run build:v3` | **PASS (exit code 0)** | Build Vite production thành công |
| `node scripts/test-v3-browser.mjs planora-shell.spec.ts` | **NOT_RUN** | Máy phát triển không có Docker daemon chạy PostgreSQL port 55533; spec file sẵn sàng chạy trong môi trường CI có Docker |

---

## 3. Trạng thái Bàn giao
- Toàn bộ findings P2 từ Codex review Vòng 3 đã được khắc phục hoàn chỉnh và có bằng chứng RED/GREEN rõ ràng.
- Báo cáo trạng thái: `STATUS: READY_FOR_CODEX_REVIEW`.
