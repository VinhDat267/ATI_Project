# 2026-11-05 · gemini · PL-07 · Sửa 2 Findings P2 (F1–F2) từ Independent Review

- **Đã làm:**
  - **F1 — P2: Chọn gợi ý clarification không prefill draft của composer:**
    - `PlanoraChatWorkspace.tsx`:
      - Định nghĩa hàm `handleSelectOption`: đồng thời gọi `setSelected(option)` và `if (typeof option === 'string') setDraft(option)`.
      - Truyền `onSelect={handleSelectOption}` xuống `PlanoraActiveTurn`.
    - `PlanoraActiveTurn.tsx`:
      - Truyền prop `onDraft={onDraft}` vào `ExpandedClarificationMoment`.
    - `ClarificationMoment.tsx`:
      - Cập nhật cả sự kiện click (`onClick`) và điều hướng phím mũi tên (`onKeyDown`) để gọi cả `onSelect(option)` và `onDraft(option)`.
    - `ResponseMoment.tsx` (`ExpandedClarificationMoment`):
      - Nhận thêm prop tuỳ chọn `onDraft?: (value: string) => void`.
      - Cập nhật cả sự kiện click và điều hướng phím mũi tên để đồng bộ sang `onDraft`.
    - **Bảo toàn an toàn:** Khi click radio option chỉ pre-fill draft vào textarea / dock composer, không tự ý gửi tin nhắn; chỉ gửi khi người dùng trực tiếp bấm nút "Xác nhận và tiếp tục" hoặc nút gửi.
  - **F2 — P2: Ghép sai màu chữ/nền làm mất tương phản ở các trạng thái PL-07:**
    - `RecoveryMoment.tsx`:
      - Nút "Dừng hẳn quy trình" trong hộp thoại xác nhận chuyển sang dùng cặp màu semantic error của Planora: `bg-[var(--planora-error-bg)] hover:bg-[var(--planora-error-border)] text-[var(--planora-error-text)] border border-[var(--planora-error-border)]`.
      - Tỷ lệ tương phản đạt chuẩn WCAG AA (≥ 4.5:1) ở cả Light mode (5.45:1) và Dark mode (8.36:1), khắc phục lỗi chữ trắng trên nền `#fca5a5` (chỉ 1.898:1 ở Dark mode).
    - `ResponseMoment.tsx` (`ExpandedClarificationMoment` destination variant):
      - Nhãn option và nhãn "Đã chọn" kế thừa `--planora-on-primary` trên nền `--planora-primary` (`text-[var(--planora-on-primary)]`), loại bỏ class hardcode `text-white`.
      - Tỷ lệ tương phản đạt chuẩn WCAG AA (≥ 4.5:1) ở cả Light mode (7.76:1) và Dark mode (7.07:1), khắc phục lỗi chữ trắng trên nền `#8fb68e` (chỉ 2.270:1 ở Dark mode).
    - `PlanningErrors.tsx` (`OfflineBanner`):
      - Chuyển sang cặp màu cảnh báo / offline của Planora: `bg-[var(--planora-pending-bg)] text-[var(--planora-pending-text)] border-b border-[var(--planora-pending-border)]`.
      - Tỷ lệ tương phản đạt chuẩn WCAG AA (≥ 4.5:1) ở cả Light mode (4.54:1) và Dark mode (8.62:1), khắc phục lỗi `bg-amber-600 text-white` (chỉ 3.186:1 ở Light mode).
  - **Kiểm thử bổ sung (`apps/chat-web/tests/planora-responses-recovery.test.tsx`):**
    - Bổ sung 7 unit và integration tests mới (tổng số test tăng từ 13 lên 20):
      1. Khẳng định `ClarificationMoment` khi click option hoặc dùng phím mũi tên đều đồng bộ draft và selection mà không tự động gửi tin nhắn.
      2. Khẳng định `ExpandedClarificationMoment` (read-only variant) khi click option hoặc dùng phím mũi tên đều đồng bộ draft và selection mà không tự động gửi tin nhắn.
      3. Khẳng định `ExpandedClarificationMoment` (destination variant) đồng bộ draft, sử dụng class `text-[var(--planora-on-primary)]` đạt tương phản cao và không có `text-white`.
      4. Test tích hợp trên `PlanoraChatWorkspace` với read-only clarification: click option -> textarea hiển thị đúng giá trị draft -> `onSendMessage` chưa từng được gọi -> bấm "Xác nhận và tiếp tục" mới gửi đúng 1 lần.
      5. Test tích hợp trên `PlanoraChatWorkspace` với destination clarification: click option -> textarea hiển thị đúng giá trị draft -> `onSendMessage` chưa từng được gọi -> bấm xác nhận mới gửi đúng 1 lần.
      6. Test tích hợp trên `PlanoraChatWorkspace` với standard clarification: click option -> `#custom-sheet-input` hiển thị đúng giá trị draft -> `onSendMessage` chưa từng được gọi -> bấm xác nhận mới gửi đúng 1 lần.
      7. Test toán học đo tương phản WCAG AA (≥ 4.5:1) trích xuất trực tiếp từ `tokens.css` cho các cặp màu và kiểm tra class trên DOM thực tế của nút dừng, destination option và OfflineBanner.

- **PR / commit:**
  - Nhánh: `longnguyen005/feat-planora-pl-07` (target `codex/planora-ui`).
  - Worktree: `C:\Users\Admin\orca\workspaces\ATI_Project\feat-planora-pl-07`.
  - Base SHA: `514d982fd9fc152290feb305b0d97f2c40dda21a`.
  - Không sửa `CURRENT-STATE.md` hay `ROADMAP.md` (chỉ reviewer cập nhật sau khi merge).

- **Kiểm tra đã chạy (lệnh và kết quả thật):**
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm test -w @wap/chat-web`: PASS (102/102 test files, 1148/1148 tests, exit code 0).
  - `npm run build:v3`: PASS (exit code 0).
  - `node scripts/test-v3-web-build-security.mjs`: PASS (exit code 0).
  - `npm test -w @wap/chat-web -- planora-responses-recovery`: PASS (20/20 tests, exit code 0).

- **Trạng thái:** `STATUS: READY_FOR_CODEX_RE_REVIEW`.
