# 2026-11-04 · gemini · PL-05 · Sửa findings R1–R2 từ Codex review vòng 2

- **Đã làm:**
  - **(R1) Khắc phục triệt để feed nở theo lịch sử & thiết lập scroll container độc lập thực thụ:**
    - Cập nhật `apps/chat-web/src/planora/styles/shell.css`:
      - Thiết lập chiều cao hữu hạn (bounded height) và chống tràn xuyên suốt chuỗi cha từ layout ngoài cùng:
        - `.planora-shell`: `height: 100dvh; max-height: 100dvh; min-height: 0; overflow: hidden;`
        - `.planora-screen-layout`: `height: 100%; max-height: 100%; min-height: 0; overflow: hidden;`
        - `.planora-main-work`: `height: 100%; max-height: 100%; min-height: 0; overflow: hidden;`
        - `.planora-content-body`: `height: 100%; max-height: 100%; min-height: 0; overflow: hidden;`
        - `.planora-chat-workspace`: `height: 100%; max-height: 100%; min-height: 0; overflow: hidden;`
        - `.planora-conversation-feed`: `flex: 1; min-height: 0; overflow-y: auto; box-sizing: border-box;`
      - Loại bỏ hoàn toàn lỗi feed nở lên 10.177px khi có 80 tin nhắn (trước đây `clientHeight === scrollHeight = 10177px`). Giờ đây feed có `clientHeight < 900px` và `scrollHeight > clientHeight`, cuộn độc lập bên trong vùng làm việc.
    - Cập nhật `apps/chat-web/src/planora/workspace/PlanoraConversationFeed.tsx`:
      - Tăng padding dưới lên `pt-6 pb-28 sm:pb-32 space-y-5`, đảm bảo tin nhắn cuối cùng và action buttons không bao giờ bị `#global-bottom-bar` che khuất.
    - Cập nhật unit test `apps/chat-web/tests/planora-chat.test.tsx`:
      - Thay thế kiểm tra lỏng lẻo `if (document.scrollingElement)` bằng kiểm tra trực tiếp trên `.planora-conversation-feed` element.
      - Kiểm tra đầy đủ contract classes (`overflow-y-auto`, `min-h-0`, `flex-1`), mock scroll dimensions trên feed và xác nhận moment transition không làm reset `feed.scrollTop`.
      - Bổ sung unit test kiểm tra layout feed độc lập và padding chống che khuất của `#global-bottom-bar`. Tổng số unit test: 17/17 PASS.
    - Bổ sung Playwright browser test trong `apps/chat-web/tests/browser/planora-chat.spec.ts`:
      - Tạo test case độc lập với 80 tin nhắn chèn vào DB, kiểm tra thực tế `scrollHeight > clientHeight`, `clientHeight < 900`, vị trí đọc `scrollTop = 100` được giữ nguyên khi có tin nhắn mới, và khoảng cách tới bottom bar hợp lệ.
  - **(R2) Đồng bộ các browser regression test với One-Composer Policy & scope locator:**
    - Cập nhật `apps/chat-web/tests/browser/fe-05-cockpit.spec.ts`:
      - Thay đổi assertion kiểm tra số lượng textarea ở trạng thái preview từ 0 sang đúng 1 (`expect(page.locator('textarea:visible')).toHaveCount(1)`), tuân thủ đúng One-Composer Policy (dock composer luôn sẵn sàng). Giữ nguyên toàn bộ assertions về focus, duyệt kế hoạch, và hủy.
    - Cập nhật `apps/chat-web/tests/browser/fe-02-routing-history.spec.ts`:
      - Giới hạn phạm vi (scope) của locator tin nhắn số 24: thay `page.getByText(/Saved message 24:/)` thành `area.getByText(/Saved message 24:/)`, tránh strict-mode violation khi tin nhắn xuất hiện đồng thời trong feed và drawer sau khi mở lịch sử.

- **PR / commit:**
  - Nhánh: `longnguyen005/feat-planora-pl-05` (target `codex/planora-ui`).
  - Reviewed Head vòng 2: `52865cd651d4e728c7622ff5d8f943367f67e250`.
  - Không sửa `CURRENT-STATE.md` hay `ROADMAP.md` (chỉ reviewer cập nhật sau khi merge).

- **Kiểm tra đã chạy (lệnh và kết quả):**
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm test -w @wap/chat-web -- tests/planora-chat.test.tsx`: PASS 17/17 tests (exit code 0).
  - `npm test -w @wap/chat-web`: PASS 100/100 test files, 1115/1115 tests (exit code 0).
  - `npm run build:v3`: PASS (exit code 0).
  - `node scripts/test-v3-web-build-security.mjs`: PASS (exit code 0).

- **Trạng thái:** `STATUS: READY_FOR_CODEX_REVIEW`.
