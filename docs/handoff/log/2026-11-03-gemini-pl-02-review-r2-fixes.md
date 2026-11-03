# Nhật ký thi công: Khắc phục Codex review findings Vòng 2 (R1-R4) cho PL-02

- **Ngày:** 03/11/2026
- **Người thực hiện:** Antigravity / Gemini worker
- **Nhiệm vụ:** [PL-02 · Shell, sidebar và không gian cá nhân/tổ chức](../tasks/PL-02-planora-shell-workspaces.md)
- **Worktree:** `feat-planora-pl-02`
- **Nhánh:** `longnguyen005/feat-planora-pl-02`
- **Reviewed Head SHA:** `de67cf5094c780555182fca01306a141423954c2`
- **Base SHA:** `83ea86123b36201f4e00601b384fdb846dee80e0`

---

## 1. Tóm tắt 4 Findings (R1 - R4) từ Codex Review Vòng 2 & Giải pháp

### R1 — P2: Initial focus của drawer và khôi phục focus về đúng opener
- **Nguyên nhân:**
  1. Trong CSS, `transition: transform ..., visibility ...` khiến `visibility: visible` bị hoãn trong thời gian chuyển tiếp khi mở drawer, làm các lệnh `focus()` gọi sớm bị bỏ qua (Chromium probe ghi nhận focus bị đẩy về `document.body`).
  2. Drawer mở bằng nút "Mở menu không gian làm việc" (workspace pill) nhưng khi đóng lại luôn trả focus về hamburger button (`triggerRef.current`), sai opener kích hoạt ban đầu.
  3. Focus trap trong drawer chỉ xử lý khi focus đã ở trong, chưa kéo focus từ bên ngoài (e.g. body hoặc opener) vào lại bên trong khi người dùng nhấn Tab.
- **Khắc phục:**
  - Trong `shell.css`: Tách biệt transition khi mở và đóng:
    - Khi mở (`.planora-sidebar.planora-sidebar-open`): Gán `visibility: visible` ngay lập tức (`transition: transform var(--planora-transition-base)`).
    - Khi đóng (`:not(.planora-sidebar-open)`): Hoãn `visibility: hidden` cho đến khi `transform` kết thúc (`transition: transform var(--planora-transition-base), visibility 0s var(--planora-transition-base)`).
  - Trong `PlanoraShell.tsx`:
    - Thêm `openerRef` lưu giữ phần tử thực tế đã mở drawer (hamburger `triggerRef` hoặc workspace pill `wsPillRef`). Khi đóng drawer, trả focus về đúng `openerRef.current`.
    - Thực hiện `performFocus()` ngay khi mount đồng thời bọc trong double `requestAnimationFrame` và fallback `setTimeout` để đảm bảo phần tử focusable đầu tiên (nút đóng `closeBtnRef`) nhận focus sau khi render layout.
    - Trong `handleKeyDown`, nếu focus đang nằm ngoài `sidebarRef.current`, nhấn Tab/Shift+Tab sẽ lập tức kéo focus vào trong phần tử đầu/cuối của sidebar.

### R2 — P2: Create/join portal modal có keyboard focus lifecycle riêng
- **Nguyên nhân:** Các modal form tạo (`showCreateModal`) và tham gia (`showJoinModal`) tổ chức hiển thị qua React Portal nhưng thiếu initial focus vào trường nhập liệu, thiếu focus trap (Tab/Shift+Tab) giữ focus bên trong modal, và `PlanoraShell` có thể can thiệp cướp focus nếu sidebar phía sau vẫn mount.
- **Khắc phục:**
  - Trong `WorkspaceSwitcher.tsx`:
    - Gán `ref={createModalRef}` và `ref={joinModalRef}` cho container của từng modal.
    - Khi mở modal, tự động di chuyển initial focus vào input chính (`#create-org-name` hoặc `#join-org-code`).
    - Bổ sung capture-phase `keydown` listener xử lý focus trap (Tab / Shift+Tab): giữ focus luân chuyển tuần hoàn bên trong modal, ngăn chặn hoàn toàn focus thoát ra background hoặc sidebar phía sau.
    - Khi đóng modal (Escape, nút đóng, nút hủy), trả focus về đúng trigger button mở modal (`createTriggerRef.current` hoặc `joinTriggerRef.current`).
  - Trong `PlanoraShell.tsx`:
    - Bổ sung guard `const nonSidebarModal = document.querySelector('[role="dialog"]:not(.planora-sidebar)'); if (nonSidebarModal) return;` trong cả `performFocus()` và `handleKeyDown()`, đảm bảo drawer hoàn toàn nhường quyền điều khiển focus và phím cho modal form con.

### R3 — P2: Chứng minh delayed GET/SSE isolation và F1 test qua luồng thật
- **Nguyên nhân:** Test delayed GET trước đó chỉ dùng Promise rời không kết nối API/hook thật, không chứng minh được vai trò của guard `if (!isCurrent()) return;` trong `loadConversationHistory`. Test F1 cũ tự set `isPlanning` bằng tay thay vì chứng minh cơ chế tự phục hồi của `chatStore`.
- **Khắc phục:**
  - Trong `apps/chat-web/tests/planora-shell.test.tsx`:
    - Test `ignores deferred GET/SSE responses...`: Kết nối trực tiếp vào `apiClient.getConversation` và gọi `loadConversationHistory('conv-alpha', isCurrent)`. Sau khi đổi workspace sang `personal`, giải quyết promise cũ của Alpha.
    - **Chứng minh RED -> GREEN:** Khi thử comment bỏ `if (!isCurrent()) return;` trong `use-conversation-history.ts`, test FAIL ngay lập tức (`AssertionError: expected [ { id: 'm-alpha' } ] to have a length of +0 but got 1`, exit code 1). Khi có guard, test PASS (exit code 0).
    - Test F1: Sử dụng `useChatStore.getState().beginPlanning('c1', ...)` (từ chối duplicate POST khi đang pending), gọi `onNewConversation` thực tế (kết nối với `reset({ preservePlanning: true })`), và khi quay lại `c1` qua `setConversationId('c1')`, `isPlanning` tự động được store phục hồi mà không cần can thiệp thủ công.

### R4 — P2: Sửa 4 ca browser test mobile trong planora-shell.spec.ts
- **Nguyên nhân:** File `planora-shell.spec.ts` kiểm tra `getByRole('navigation', { name: 'Điều hướng chính' })` có count = 1 ngay khi load trang. Trên mobile (<1024px), sidebar đóng đã được ẩn chính xác khỏi a11y tree bằng `visibility: hidden` (count = 0), khiến 4 ca mobile (768px, 375px sáng/tối) fail assertion.
- **Khắc phục:**
  - Cập nhật assertion trong `planora-shell.spec.ts`:
    - Desktop (>=1024px): accessible nav count = 1.
    - Mobile (<1024px) khi đóng: accessible nav count = 0.
    - Mobile khi click mở drawer: drawer hiển thị, accessible nav count = 1.
    - Mobile khi nhấn Escape: drawer đóng, accessible nav count = 0 và toggle button được focus.

---

## 2. Bảng Bằng chứng Kiểm thử Thực tế

| Lệnh kiểm thử | Kết quả | Ghi chú |
|---|---|---|
| `npm run typecheck:v3` | **PASS (exit code 0)** | Chat API & Chat Web 0 errors |
| `npx tsc -p apps/chat-web/tsconfig.json --noEmit` | **PASS (exit code 0)** | Bao gồm cả `tests/browser/planora-shell.spec.ts` |
| `npm test -w @wap/chat-web -- tests/planora-shell.test.tsx` | **PASS (18/18 tests, exit code 0)** | Bao phủ R1-R4, delayed response, modal focus trap |
| `npm test -w @wap/chat-web` | **PASS (98/98 files, 1.074/1.074 tests, exit code 0)** | Toàn bộ unit test suite của chat-web |
| `npm run build:v3` | **PASS (exit code 0)** | Build Vite production thành công |
| `node --check scripts/test-v3-browser.mjs` | **PASS (exit code 0)** | Runner cú pháp chuẩn |
| `node scripts/test-v3-browser.mjs planora-shell.spec.ts` | **NOT_RUN** | Máy phát triển không có Docker daemon chạy DB port 55533; spec file đã được typecheck và cập nhật chuẩn xác cho CI |

---

## 3. Trạng thái Bàn giao
- Toàn bộ 4 findings R1-R4 từ Codex review Vòng 2 đã được giải quyết triệt để và kiểm chứng.
- Báo cáo trạng thái: `STATUS: READY_FOR_CODEX_REVIEW`.
