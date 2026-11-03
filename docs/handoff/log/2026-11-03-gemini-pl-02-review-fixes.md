# Nhật ký thi công: Khắc phục Codex review findings (F1-F6) cho PL-02

- **Ngày:** 03/11/2026
- **Người thực hiện:** Antigravity / Gemini worker
- **Nhiệm vụ:** [PL-02 · Shell, sidebar và không gian cá nhân/tổ chức](../tasks/PL-02-planora-shell-workspaces.md)
- **Worktree:** `feat-planora-pl-02`
- **Nhánh:** `longnguyen005/feat-planora-pl-02`
- **Reviewed Head SHA:** `e8324a2849c3f91eba41ab81beb24dc462cd8218`

---

## 1. Tóm tắt 6 Findings & 2 Gaps từ Codex Review và Giải pháp

### F1 · P1 · Sidebar “Hội thoại mới” discards the pending request lock
- **Nguyên nhân:** Nút "Hội thoại mới" trên sidebar ban đầu gọi `useChatStore.getState().reset()` trơn, xóa `planningByConversation` và không cung cấp `onNewConversation` từ `PlanoraShell`. Khi người dùng đang có POST request pending ở cuộc hội thoại c1, bấm "Hội thoại mới", quay lại c1 thì lock pending bị mất, cho phép gửi duplicate POST request trong khi request 1 vẫn đang chạy.
- **Khắc phục:**
  - Trong `App.tsx`: triển khai `handleNewConversation` sử dụng `useChatStore.getState().reset({ preservePlanning: true })`, chuyển cuộc hội thoại về `null` nhưng bảo lưu ownership/pending lock của các conversation khác, và truyền xuống `PlanoraShell`.
  - Trong `PlanoraSidebar.tsx`: `handleNewChat` ưu tiên gọi `onNewConversation` từ props, hoặc fallback về `reset({ preservePlanning: true })`.
  - Trong `tests/planora-shell.test.tsx`: Bổ sung regression test F1 bắt đầu một POST deferred request thật ở c1, bấm nút sidebar "Hội thoại mới", quay lại c1 qua history navigation, và xác minh composer vẫn ở trạng thái locked/pending cho đến khi request ban đầu phản hồi xong.

### F2 · P2 · Mobile drawer không cô lập focus và accessibility state
- **Nguyên nhân:** Khi mở hamburger drawer ở màn hình mobile (<1024px), focus vẫn ở nút opener bên ngoài, nhấn Tab đi vào nội dung phía sau; khi đóng drawer bằng CSS transform offscreen, các nút bên trong vẫn nằm trong tab order và accessibility tree; thiếu semantics modal/dialog và inert cho background.
- **Khắc phục:**
  - Trong `PlanoraShell.tsx`:
    - Khi drawer mở: tự động di chuyển focus vào nút đóng drawer (`closeBtnRef`), thiết lập focus trap giữ phím Tab chỉ luân chuyển bên trong sidebar, và áp dụng `inert` lên vùng nội dung chính (`.planora-main-work`).
    - Khi drawer đóng: tự động khôi phục focus về nút mở drawer (`triggerRef`), xóa `inert` trên background.
  - Trong `PlanoraSidebar.tsx`: Khi drawer mở (`isOpen`), gắn `role="dialog"`, `aria-modal="true"`, và `aria-label="Menu điều hướng"`. Khi drawer đóng, trở về `<aside aria-label="Thanh điều hướng bên">`.
  - Trong `shell.css`: Thêm `@media (max-width: 1023px) { .planora-sidebar:not(.planora-sidebar-open) { visibility: hidden; pointer-events: none; } }` loại bỏ hoàn toàn sidebar đóng khỏi keyboard navigation và screen reader tree.

### F3 · P2 · Workspace overlays bị cắt hoặc bị giới hạn bởi sidebar
- **Nguyên nhân:** CSS transform (non-none) trên sidebar biến sidebar thành containing block cho các modal `fixed` lồng bên trong, khiến modal tạo/tham gia workspace trên mobile bị co cụm trong độ rộng sidebar (~279px) thay vì toàn màn hình 375px. Ngoài ra dropdown menu có width cố định 320px trong sidebar 248px nên tràn mép phải.
- **Khắc phục:**
  - Trong `WorkspaceSwitcher.tsx`: Sử dụng `createPortal(..., document.body)` để render các modal tạo và tham gia workspace trực tiếp vào `document.body`, thoát hoàn toàn khỏi transform containing block của sidebar.
  - Cập nhật responsive width cho dropdown menu khi `variant="sidebar"`: `left-0 right-0 w-full min-w-[220px] max-w-[calc(100vw-32px)]`, đảm bảo luôn nằm gọn trong sidebar hoặc viewport mà không bị cắt tràn.

### F4 · P2 · Phím Escape đóng drawer thay vì đóng workspace form đang mở
- **Nguyên nhân:** Các modal form trong `WorkspaceSwitcher` thiếu `role="dialog"` và không có listener bàn phím độc lập; phím Escape kích hoạt listener của `PlanoraShell` đóng mobile drawer trong khi form vẫn mount ngầm.
- **Khắc phục:**
  - Trong `WorkspaceSwitcher.tsx`: Gán `role="dialog"`, `aria-modal="true"`, và gán capture-phase `keydown` listener trên `window` cho các modal create/join để bắt phím Escape, gọi `stopPropagation()`, đóng modal trước và khôi phục focus về nút mở modal.
  - Trong `PlanoraShell.tsx`: Listener Escape kiểm tra nếu đang có modal con khác mở (`document.querySelector('[role="dialog"]:not(.planora-sidebar)')`) thì bỏ qua, đảm bảo phân cấp topmost-overlay rõ ràng.

### F5 · P2 · Route / (home) không được nhận diện là tab chat
- **Nguyên nhân:** Hàm `getTab(kind)` trong `App.tsx` chỉ xử lý `'workspace'`, trả về `undefined` khi route là `'home'`. Do đó khi truy cập `/`, nav link "Không gian làm việc" không có `aria-current="page"` và `SidebarHistory` bị ẩn.
- **Khắc phục:**
  - Nhập kiểu `AppRoute` từ `./routes`.
  - Map cả `case 'home':` và `case 'workspace':` trả về `'workspace'`.
  - Bổ sung App-level regression test xác minh khi đăng nhập vào `/`, link "Không gian làm việc" active và `SidebarHistory` hiển thị.

### F6 · P2 · Chuyển đổi breakpoint để lại document bị scroll-locked
- **Nguyên nhân:** Khi mở drawer ở mobile (<1024px) rồi xoay/resize màn hình sang desktop (>=1024px), CSS chuyển thành desktop sidebar và ẩn nút đóng nhưng `drawerOpen` vẫn là `true` và `document.body.style.overflow` bị khóa `'hidden'`.
- **Khắc phục:**
  - Trong `PlanoraShell.tsx`: Thêm listener đồng bộ breakpoint qua `matchMedia('(min-width: 1024px)')` và sự kiện `resize`. Khi màn hình đạt desktop (>=1024px), tự động set `drawerOpen = false` và khôi phục `originalOverflow` trên `document.body`.
  - Bổ sung regression test F6 mở drawer ở mobile rồi trigger resize sang desktop, xác minh drawer tự đóng và `overflow` được giải phóng.

### Verification Gap 1 · Delayed GET/SSE cross-workspace test
- Bổ sung test case `ignores deferred GET/SSE responses from a previous workspace after switching to a new workspace` trong `tests/planora-shell.test.tsx`, giả lập response/SSE đến muộn từ workspace cũ và kiểm chứng rằng context của workspace mới không bị overwrite.

### Verification Gap 2 · Thêm PL-02 vào test-v3-browser runner
- Cập nhật file `scripts/test-v3-browser.mjs`, thêm `|PL-02:` vào biểu thức chính quy `scenarios[0].grep`.

---

## 2. Bằng chứng kiểm thử thực tế (Exit Code 0)

1. **`npm test -w @wap/chat-web -- tests/planora-shell.test.tsx`:**
   ```text
    Test Files  1 passed (1)
         Tests  18 passed (18)
      Duration  3.00s
   ```
   Bao gồm đầy đủ 12 unit tests ban đầu + cross-workspace isolation test + 6 regression tests F1-F6.

2. **`npm test -w @wap/chat-web`:**
   ```text
    Test Files  98 passed (98)
         Tests  1074 passed (1074)
      Duration  40.45s
   ```

3. **`npm run typecheck:v3`:**
   ```text
   > typecheck:v3
   > tsc -p apps/chat-api/tsconfig.json --noEmit && tsc -p apps/chat-web/tsconfig.json --noEmit
   Exit code: 0
   ```

4. **`npm run build:v3`:**
   ```text
   > build:v3
   > npm run build -w @wap/chat-web
   ✓ 191 modules transformed.
   dist/index.html                     1.60 kB │ gzip:   0.88 kB
   dist/assets/index-Bpzr4P9D.css    138.05 kB │ gzip:  24.85 kB
   dist/assets/index-BJSKL4Ph.js   1,176.23 kB │ gzip: 279.35 kB
   ✓ built in 635ms
   Exit code: 0
   ```

---

## 3. Trạng thái bàn giao
- Toàn bộ 1 P1, 5 P2, và 2 gaps của Codex review đã được sửa chữa triệt để và kiểm chứng bằng test tự động.
- Sẵn sàng bàn giao reviewer: `STATUS: READY_FOR_CODEX_REVIEW`.
