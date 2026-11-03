# 2026-11-03 · gemini · PL-04 · Khắc phục Codex Re-Review Finding R1 (Vòng 2)

- **Đã làm:**
  - **Khắc phục triệt để R1 (P2) · Locator footer trong browser spec vi phạm strict mode do trùng link:**
    - Vấn đề: `page.getByRole('link', { name: 'Trang chủ' })` trong màn `/resend-verification` khớp cả 2 elements: link `← Quay lại trang chủ` trong nội dung form và link `Trang chủ` ở footer, dẫn đến lỗi strict mode violation trong 10 tests verify-expired.
    - Sửa đổi:
      - Trong `apps/chat-web/tests/browser/planora-auth-lifecycle.spec.ts`:
        - Scoped locator vào container footer: `const footer = page.locator('.planora-auth-footer');`
        - Dùng exact matching: `footer.getByRole('link', { name: 'Trang chủ', exact: true })` và `footer.getByRole('link', { name: 'Chính sách an toàn & Dữ liệu', exact: true })`.
        - Áp dụng nhất quán ở cả 2 test case (`verify-expired` tại dòng 43-55 và `reset-password` tại dòng 107-119).
        - Giữ nguyên các assertions kiểm tra kích thước hit area tap target $\ge 44\text{px}$ và không tràn viền.
      - Trong `apps/chat-web/tests/planora-auth-lifecycle.test.tsx`:
        - Bổ sung assertion kiểm tra `.planora-auth-footer` hiển thị trong DOM.

- **PR / commit:**
  - Nhánh: `longnguyen005/feat-planora-pl-04` (target `codex/planora-ui`).
  - Base SHA: `5633e6b856af8e23a005b5e82280305afc7e4c89`.
  - Reviewed Head Vòng 2: `a024801f772b682c2ac5fcf41118afda3c8feed1`.
  - Commit message: `fix(planora): resolve Codex PL-04 finding R1 footer locator`.

- **Kiểm tra đã chạy (lệnh và kết quả thực tế):**
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm run build:v3`: PASS (exit code 0, 193 modules transformed).
  - `node scripts/test-v3-web-build-security.mjs`: PASS (exit code 0).
  - `npm test -w @wap/chat-web -- tests/planora-auth-lifecycle.test.tsx`: PASS (23/23 tests, exit code 0).
  - `npm test -w @wap/chat-web`: PASS (99 files, 1098/1098 tests, exit code 0).

- **Trạng thái:** `STATUS: READY_FOR_CODEX_REVIEW_R3`.
