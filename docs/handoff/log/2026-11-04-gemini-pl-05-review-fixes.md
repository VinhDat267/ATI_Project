# 2026-11-04 · gemini · PL-05 · Sửa findings F1–F5 từ Codex review

- **Đã làm:**
  - **(F1) Sửa lỗi mất composer sau khi bấm "Sửa yêu cầu" tại planning error:**
    - Cập nhật `apps/chat-web/src/planora/workspace/PlanoraChatWorkspace.tsx` và `apps/chat-web/src/planora/workspace/PlanoraActiveTurn.tsx`.
    - Truyền cờ `responseEditing` đồng bộ giữa parent và child; `PlanoraActiveTurn` tính `planningError = ... && !props.responseEditing`.
    - Khi bấm "Sửa yêu cầu", thẻ lỗi `#view-server` được thay thế bằng `RequestMoment` với ô textarea prefilled sẵn nội dung yêu cầu, cho phép chỉnh sửa và gửi lại, không tự động gửi khi bấm Edit.
    - Duy trì đúng một composer trên màn hình (không sinh 2 composer và không mất composer).
  - **(F2) Sửa lỗi vùng cuộn feed và kéo người đọc về đầu khi chuyển moment:**
    - Trong `apps/chat-web/src/planora/workspace/PlanoraChatWorkspace.tsx`, loại bỏ lệnh cưỡng bức `scroller.scrollTop = 0` khi ở chế độ Planora (`legacyCockpit = false`), bảo toàn chính xác vị trí đọc lịch sử của người dùng khi moment thay đổi.
    - Đặt các lớp bọc layout và stage container với `min-h-0 overflow-hidden` để `PlanoraConversationFeed` (`.planora-conversation-feed.planora-chat-feed`) trở thành vùng cuộn độc lập thực sự (`flex-1 min-h-0 overflow-y-auto`).
    - Khi có nhiều tin nhắn, `scrollHeight > clientHeight`, người dùng cuộn xem tin cũ độc lập và không bị giật cuộn khi có tin mới hoặc khi chuyển đổi trạng thái active card.
  - **(F3) Khắc phục Moment 4 (Preview) có 0 composer theo tiêu chuẩn One-Composer Policy:**
    - Cập nhật điều kiện hiển thị dock composer trong `PlanoraChatWorkspace.tsx`: không loại trừ Moment 4 khi ở chế độ Planora.
    - Điều phối chính sách 1 composer:
      - Khi xem trước kế hoạch (preview): dock composer hiển thị ở đáy màn hình (1 textbox).
      - Khi bấm "Sửa qua Chat": dock composer ẩn, `inlineComposer` hiển thị ngay phía trên thanh thao tác của `PlanMoment` (1 textbox).
      - Khi đóng ô sửa: quay lại dock composer (1 textbox).
      - Khi mở Drawer hội thoại: các composer ngoài ẩn, chỉ có 1 composer trong drawer (1 textbox).
    - Cập nhật `apps/chat-web/tests/planora-chat.test.tsx` assert đúng tiêu chí 1 composer thay vì 0 composer.
  - **(F4) Đồng bộ selector cho Playwright browser spec PL-05:**
    - Thêm các class `.planora-chat-workspace` vào `PlanoraChatWorkspace.tsx` và `.planora-conversation-feed` vào `PlanoraConversationFeed.tsx` khớp đúng accessible contract.
    - Cập nhật `scripts/test-v3-browser.mjs`, bổ sung `|PL-05:` vào default grep pattern của scenarios runner.
  - **(F5) Tránh che ô nhập ở breakpoint desktop 1024px:**
    - Cập nhật `apps/chat-web/src/pages/Cockpit/ChatComposer.tsx` và `apps/chat-web/src/planora/styles/shell.css`: thiết lập `lg:left-[var(--planora-sidebar-width,248px)]` cho `#global-bottom-bar` và `#response-bottom-bar`.
    - Đảm bảo tại viewport >= 1024px (desktop), thanh nhập liệu bắt đầu từ mép ngoài của sidebar 248px, không bị nút sidebar đè lên khi hit-testing `elementFromPoint(x+10, y)`.
  - **(Hồi quy & Tương thích ngược):**
    - Hỗ trợ cờ `legacyCockpit` mặc định true trong `Cockpit.tsx` cho các test suite Sprint 1 cũ (`fe-05b-parity-b.test.tsx`), bảo đảm toàn bộ 100 test files hiện hữu không bị ảnh hưởng.
    - Thêm 4 regression tests chi tiết trong `apps/chat-web/tests/planora-chat.test.tsx` kiểm tra đủ 13 moment, hành trình F1 error-edit, kiểm tra không giật cuộn F2, và sidebar offset F5.

- **PR / commit:**
  - Nhánh: `longnguyen005/feat-planora-pl-05` (target `codex/planora-ui`).
  - Reviewed Head: `88da9c06365468cecdfe9ff6a84c467ec3f480de`.
  - Không sửa `CURRENT-STATE.md` hay `ROADMAP.md` (chỉ reviewer cập nhật sau khi merge).

- **Kiểm tra đã chạy (lệnh và kết quả):**
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm test -w @wap/chat-web -- tests/planora-chat.test.tsx`: PASS 16/16 tests (exit code 0).
  - `npm test -w @wap/chat-web -- tests/fe-05b-parity-b.test.tsx`: PASS 25/25 tests (exit code 0).
  - `npm test -w @wap/chat-web`: PASS 100/100 test files, 1114/1114 tests (exit code 0).
  - `npm run build:v3`: PASS (exit code 0).
  - `node scripts/test-v3-web-build-security.mjs`: PASS (exit code 0).
  - `node --check scripts/test-v3-browser.mjs`: PASS (exit code 0).
  - `scripts/test-v3-browser.mjs planora-chat.spec.ts`: NOT_RUN cục bộ do máy không có Docker daemon chạy PostgreSQL port 55533; spec file đã kiểm tra cú pháp và contract sẵn sàng cho CI.

- **Trạng thái:** `STATUS: READY_FOR_CODEX_REVIEW`.
