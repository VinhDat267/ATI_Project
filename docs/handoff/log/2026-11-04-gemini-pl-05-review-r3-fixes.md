# 2026-11-04 · gemini · PL-05 · Sửa findings R3–R4 từ Codex review vòng 3

- **Đã làm:**
  - **(R3) Khắc phục mất cuộn chuột trên các trang ngoài chat & scope layout chat:**
    - Cập nhật `apps/chat-web/src/planora/styles/shell.css`:
      - Hoàn nguyên `.planora-shell`, `.planora-screen-layout`, `.planora-main-work`, `.planora-content-body` về trạng thái không khóa chiều cao/overflow cứng (sử dụng `min-height: 100dvh`), cho phép document scrolling và mouse wheel hoạt động tự nhiên trên toàn bộ các trang ngoài chat (`/settings`, `/history`, `/account`, `/guide`).
      - Sử dụng bộ chọn CSS scoped `:has(.planora-chat-workspace)` để chỉ áp dụng chiều cao hữu hạn (`height: 100dvh`, `overflow: hidden`) khi không gian làm việc chat đang được mount trong DOM:
        - `.planora-shell:has(.planora-chat-workspace)`
        - `.planora-screen-layout:has(.planora-chat-workspace)`
        - `.planora-main-work:has(.planora-chat-workspace)`
        - `.planora-content-body:has(.planora-chat-workspace)`
    - Bổ sung Playwright browser test trong `apps/chat-web/tests/browser/planora-chat.spec.ts`:
      - Kiểm thử cuộn chuột bằng `page.mouse.wheel(0, 3000)` trên trang `/settings` ở 4 tổ hợp: desktop (1440x900) và mobile (375x812) × light/dark theme. Xác nhận document cuộn tự do (`document.scrollingElement.scrollTop > 300`).
  - **(R4) Khắc phục composer nhiều dòng che nút và triệt tiêu cuộn document phụ trong chat:**
    - Cập nhật `apps/chat-web/src/planora/styles/shell.css`:
      - Thêm `:root:has(.planora-chat-workspace) body { padding-bottom: 0 !important; }` và `:root:has(.planora-chat-workspace) { scroll-padding-bottom: 0 !important; }`, triệt tiêu hoàn toàn khoảng đệm thừa trên `body` gây ra vùng cuộn document thứ hai 218px.
      - Thiết lập padding động dưới chân feed: `.planora-conversation-feed { padding-bottom: calc(var(--cockpit-bottom-space, 112px) + 24px) !important; }`.
    - Cập nhật `apps/chat-web/src/planora/workspace/PlanoraConversationFeed.tsx`:
      - Thiết lập inline style `paddingBottom: 'calc(var(--cockpit-bottom-space, 112px) + 24px)'` bảo đảm feed luôn dành đủ không gian đệm theo biến `--cockpit-bottom-space` được cập nhật liên tục bởi `ResizeObserver` trong `ChatComposer` khi textarea giãn nở.
      - Bổ sung `ResizeObserver` trên feed container để giữ nguyên vị trí ở đáy (`box.scrollTop = box.scrollHeight`) khi kích thước hoặc padding thay đổi do composer nhiều dòng giãn nở.
    - Cập nhật unit test `apps/chat-web/tests/planora-chat.test.tsx`:
      - Xác nhận feed có thuộc tính dynamic padding `calc(var(--cockpit-bottom-space, 112px) + 24px)`.
    - Bổ sung Playwright browser test trong `apps/chat-web/tests/browser/planora-chat.spec.ts`:
      - Mở preview có lịch sử dài trên mobile (375x812), nhập draft 14 dòng vào dock composer, xác nhận `#global-bottom-bar` giãn nở chiều cao >= 180px.
      - Cuộn feed tới đáy, xác nhận document không bị cuộn (`document.scrollingElement.scrollTop === 0`).
      - Xác nhận nút Chi tiết kỹ thuật (`#btn-tech-toggle`) có đáy nằm phía trên đỉnh footer và hit-test tâm nút trả về chính nút, không bị che bởi composer textarea.

- **PR / commit:**
  - Nhánh: `longnguyen005/feat-planora-pl-05` (target `codex/planora-ui`).
  - Reviewed Head vòng 3: `128fab1da4178ce28cebdbcc1d974f5dc39d4ab6`.
  - Không sửa `CURRENT-STATE.md` hay `ROADMAP.md` (chỉ reviewer cập nhật sau khi merge).

- **Kiểm tra đã chạy (lệnh và kết quả):**
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm test -w @wap/chat-web -- tests/planora-chat.test.tsx`: PASS 17/17 tests (exit code 0).
  - `npm test -w @wap/chat-web`: PASS 100/100 test files, 1115/1115 tests (exit code 0).
  - `npm run build:v3`: PASS (exit code 0).
  - `node scripts/test-v3-web-build-security.mjs`: PASS (exit code 0).

- **Trạng thái:** `STATUS: READY_FOR_CODEX_REVIEW`.
