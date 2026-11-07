# 2026-11-04 · gemini · PL-05 · Sửa finding R5 từ Codex review vòng 4

- **Đã làm:**
  - **(R5 - P2) Khắc phục locator test R4 chọn nhầm nút và bảo đảm độ nhạy kiểm thử:**
    - Cập nhật file `apps/chat-web/tests/browser/planora-chat.spec.ts`:
      - Thay thế bộ chọn kết hợp `#btn-tech-toggle, button:has-text("Chi tiết kỹ thuật"), button:has-text("Duyệt kế hoạch")` (vốn ưu tiên chọn nút `#btn-approve-plan` trên mobile khiến test PASS sai ý nghĩa trên layout cũ) bằng bộ chọn chính xác:
        `const techToggle = page.locator('#btn-tech-toggle');`
      - Giữ nguyên xác thực tọa độ hình học: đáy của nút `#btn-tech-toggle` phải strictly nằm trên đỉnh của bottom bar footer (`toggleBox.y + toggleBox.height < footerBox.y`).
      - Giữ nguyên hit-test pointer target tại tâm nút để bảo đảm nhận sự kiện trực tiếp, không bị composer textarea che khuất.
      - Bổ sung thao tác cuộn chuột `await page.mouse.wheel(0, 1000)` và xác nhận `document.scrollingElement.scrollTop === 0` để khóa chặt vùng cuộn phụ document.

- **PR / commit:**
  - Nhánh: `longnguyen005/feat-planora-pl-05` (target `codex/planora-ui`).
  - Reviewed Head vòng 4: `5bf4b501a64124a6bab0f6161fa480083a08bb9f`.
  - Không sửa `CURRENT-STATE.md` hay `ROADMAP.md` (chỉ reviewer cập nhật sau khi merge).

- **Kiểm tra đã chạy (lệnh và kết quả):**
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm test -w @wap/chat-web -- tests/planora-chat.test.tsx`: PASS 17/17 tests (exit code 0).
  - `node scripts/test-v3-web-build-security.mjs`: PASS (exit code 0).

- **Trạng thái:** `STATUS: READY_FOR_CODEX_REVIEW`.
