# PL-07 · Trả lời, hỏi lại, từ chối, lỗi và phục hồi (Responses, Clarification, Refusal & Recovery Moments)

**Trạng thái:** sẵn sàng nhận · **Nhánh gợi ý:** `longnguyen005/feat-planora-pl-07` · **Phụ thuộc:** PL-05 và PL-06 đã hoàn tất và được Codex duyệt Đạt.  
**Base SHA:** `514d982fd9fc152290feb305b0d97f2c40dda21a` (trên integration branch `codex/planora-ui`).  
**Target branch:** `codex/planora-ui`.  
**Đặc tả:** [Planora migration design](../../superpowers/specs/2026-11-02-planora-migration-design.md) mục 4.3, 8.3 · **Kế hoạch:** [Planora migration plan](../../superpowers/plans/2026-11-02-planora-migration.md) mục PL-07.  
**Prompt thi công:** [PL-07.md](../planora-prompts/PL-07.md).  
**Quy ước chung:** [COMMON.md](../planora-prompts/COMMON.md).

---

## 1. Mục tiêu

Chuyển đổi các thẻ phản hồi của hệ thống sang chuẩn nhận diện Planora, bảo toàn toàn bộ state machine, logic phân loại moment và các quy tắc phục hồi an toàn:
1. **Answer & Sources:** Thẻ trả lời trực tiếp (Response Moment / Moment 6) với nguồn tham chiếu (sources/citations), hiển thị trích dẫn có thể click xem an toàn.
2. **Clarification Moment (Moment 3):** Thẻ hỏi làm rõ với các câu hỏi và lựa chọn đa dạng (single/multi-choice, text input), bảo toàn logic pre-fill draft vào dock composer khi bấm gợi ý (không tự ý gửi tin).
3. **Refusal Moment (Moment 2):** Thẻ từ chối/yêu cầu quyền khi thiếu kết nối dịch vụ hoặc phạm vi tài nguyên (scope_required / needs_membership), hiển thị nút CTA kết nối thật (ví dụ: "Kết nối Trello", "Chọn kho GitHub", v.v.) và nút "Gửi lại yêu cầu" chỉ gửi khi người dùng bấm trực tiếp.
4. **Planning Errors & Slow Notice:** Thẻ thông báo lập kế hoạch chậm (slow planning notice sau 10s), lỗi mạng/offline, lỗi lập kế hoạch (`PlanningErrors`), hiển thị thông điệp trung thực từ server.
5. **Recovery Moments (Moments 7, 8, 9 & Unsuccessful):**
   - Phân biệt rõ ràng giữa lỗi thất bại xác định (`failure`), trạng thái không rõ (`unknown`/`needs_attention`), và hòa giải (`reconciliation`).
   - Trạng thái `unknown` TUYỆT ĐỐI KHÔNG hiển thị nút Retry.
   - Thao tác Dừng (`Stop`) phải có hộp thoại xác nhận.
   - Nhấn phím Escape chỉ đóng hộp thoại, không được dừng hay hủy execution đang chạy.
   - Sửa đổi kế hoạch phục hồi (`RecoveryEditor`) chỉ gửi yêu cầu mới sau khi Stop thành công đúng kế hoạch hiện hành.

---

## 2. Ranh giới sở hữu & Phạm vi file

- **Sửa đổi cho phép:**
  - `apps/chat-web/src/pages/Responses/ResponseMoment.tsx`
  - `apps/chat-web/src/pages/Responses/page.css`
  - `apps/chat-web/src/pages/Errors/PlanningErrors.tsx`
  - `apps/chat-web/src/pages/Errors/page.css`
  - `apps/chat-web/src/pages/Cockpit/ClarificationMoment.tsx`
  - `apps/chat-web/src/pages/Cockpit/RequestMoments.tsx`
  - `apps/chat-web/src/pages/Cockpit/RecoveryMoment.tsx`
  - `apps/chat-web/src/pages/Cockpit/RecoveryEditor.tsx`
  - `apps/chat-web/src/pages/Cockpit/RequestEcho.tsx`
  - `apps/chat-web/src/components/CockpitDialog.tsx`
  - Tests liên quan trong `apps/chat-web/tests/`.
- **Ngoài phạm vi:**
  - Không sửa `apps/chat-api` hay backend protocol.
  - Không thay đổi thứ tự ưu tiên trong `selectMoment`.
  - Không tự ý cấp các quyền/hành động mà `recoveryActions` từ server không cho phép.

---

## 3. Interfaces & Yêu cầu kỹ thuật

1. **State Machine & Priority:**
   - Bảo toàn thứ tự ưu tiên của `selectMoment` từ Sprint 1/2 và v3 design.
   - Tiếp tục sử dụng `RecoveryControls`, `snapshot.recoveryActions` từ controller.
2. **Bố cục & Styling:**
   - Sử dụng CSS tokens của Planora (`--planora-text`, `--planora-paper`, `--planora-divider`, `--planora-primary`, etc.).
   - Responsive trên 5 viewports (1440, 1024, 768, 375, 320) và cả 2 theme (light/dark).

---

## 4. Tiêu chí nghiệm thu (Acceptance Criteria)

- [x] Các moment Answer, Clarification, Refusal, PlanningErrors và Recovery Moments hiển thị chuẩn phong cách Planora, responsive và không tràn ngang.
- [x] Refusal hiển thị đúng CTA kết nối dịch vụ tương ứng và nút "Gửi lại" chỉ gửi khi người dùng bấm trực tiếp.
- [x] Bấm gợi ý trong Clarification chỉ điền draft vào dock composer, không tự ý gửi tin nhắn.
- [x] Trạng thái `unknown` không hiển thị nút Retry.
- [x] Thao tác Stop có xác nhận, Escape chỉ đóng modal mà không ngắt execution.
- [x] `npm run typecheck:v3` đạt exit code 0.
- [x] `npm test -w @wap/chat-web` đạt exit code 0 (102/102 test files, 1141/1141 tests).
- [x] `node scripts/test-v3-web-build-security.mjs` đạt exit code 0.
- [x] Các tests liên quan (`fe-06a-recovery`, `fe-06b-responses`, `fe-06b-errors`, `fe-11-error-and-paths`, `oauth-01-refusal`, `read-answers`, `planora-responses-recovery`) đều PASS.

---

## 5. Kết quả (Worker điền sau khi hoàn thành)

- **Ngày hoàn thành ban đầu:** 2026-11-04
- **Ngày hoàn thành sửa review F1-F2:** 2026-11-05
- **Người thực hiện:** Gemini (Orca worker)
- **Base SHA:** `514d982fd9fc152290feb305b0d97f2c40dda21a`
- **Các thay đổi chính:**
  1. **Answer & Sources (`ResponseMoment.tsx`, `page.css`):**
     - Chuyển đổi ResponseCard và AnswerMoment sang hệ thống CSS tokens Planora (`--planora-text`, `--planora-paper`, `--planora-primary`, `--planora-divider`, etc.).
     - Hiển thị citations và lookups an toàn qua giao thức HTTPS (`safeLink`), hỗ trợ mở rộng danh sách tra cứu (`#answer-lookups`) và bảo toàn `[data-answer-text]`.
  2. **Clarification Moment (`ClarificationMoment.tsx`, `ResponseMoment.tsx`, `PlanoraChatWorkspace.tsx`, `PlanoraActiveTurn.tsx`):**
     - Nâng cấp radio cards và custom text input sang style Planora.
     - **Sửa finding F1 (P2):** Nối thao tác chọn gợi ý clarification vào cả selection và draft của composer dock / textarea (`handleSelectOption` trong workspace, `onDraft` trong `ClarificationMoment` và `ExpandedClarificationMoment`).
     - Áp dụng cho cả clarification thông thường, read-only clarification và destination clarification.
     - Bảo toàn an toàn: Tuyệt đối không tự động POST/submit message khi click radio option; chỉ prefill draft vào textarea, việc gửi tin nhắn chỉ kích hoạt khi người dùng trực tiếp bấm "Xác nhận và tiếp tục" hoặc nút gửi.
  3. **Refusal Moment (`ResponseMoment.tsx`):**
     - Style các thẻ dịch vụ thiếu kết nối/phạm vi sang nhận diện Planora với status badge rõ ràng.
     - Giữ nguyên các CTA kết nối cá nhân (`#trello-connect`, `#github-connect`, `#telegram-connect`, Gmail, Calendar, Sheets) và nút "Gửi lại yêu cầu" chỉ gửi khi người dùng bấm trực tiếp.
  4. **Planning Errors & Offline (`PlanningErrors.tsx`, `page.css`):**
     - Nâng cấp `SlowPlanningMoment` hiển thị tiến trình tra cứu (`gatherState`) và nút thôi chờ giữ lại câu yêu cầu.
     - Nâng cấp `PlanningErrorMoment` phân biệt sự cố máy chủ vs mất kết nối mạng.
     - **Sửa finding F2 (P2):** Cập nhật `OfflineBanner` sang cặp màu warning/pending Planora (`--planora-pending-bg`, `--planora-pending-text`, `--planora-pending-border`) đạt chuẩn tương phản WCAG AA (≥ 4.5:1) ở cả Light và Dark mode (thay vì `bg-amber-600 text-white` chỉ đạt 3.186:1 ở Light mode).
  5. **Recovery Moments (`RecoveryMoment.tsx`, `RecoveryEditor.tsx`, `CockpitDialog.tsx`):**
     - Moment 7 (Lỗi đã biết): Giữ đầy đủ hành động Retry, Skip, Stop và Sửa rồi thử lại theo `recoveryActions`.
     - Moment 8 (Chưa chắc kết quả): TUYỆT ĐỐI KHÔNG mở Retry, Edit hay Continue ngay cả khi server trả về không nhất quán.
     - Moment 9 (Khôi phục phiên): Hiển thị danh sách việc đã làm và chỉ mở Continue khi an toàn.
     - Hộp thoại Dừng quy trình: Phím Escape chỉ đóng modal mà không dừng hay hủy execution. Thao tác dừng yêu cầu xác nhận rõ ràng.
     - **Sửa finding F2 (P2):** Nút "Dừng hẳn quy trình" trong hộp thoại xác nhận chuyển sang cặp màu semantic error của Planora (`--planora-error-bg`, `--planora-error-text`, `--planora-error-border`), đạt tỷ lệ tương phản WCAG AA (≥ 4.5:1) ở cả Light và Dark mode (thay vì `text-white` trên nền `#fca5a5` chỉ đạt 1.898:1 ở Dark mode).
     - **Sửa finding F2 (P2) trên ResponseMoment:** Nhãn option destination và badge "Đã chọn" kế thừa `--planora-on-primary` trên nền `--planora-primary`, đạt tương phản 7.07:1 ở Dark mode và 7.76:1 ở Light mode (thay vì hardcode `text-white` chỉ đạt 2.270:1 ở Dark mode).
     - Sửa kế hoạch (`RecoveryEditor`): Chỉ gửi yêu cầu mới sau khi người dùng xác nhận dừng kế hoạch cũ.
- **Bằng chứng kiểm tra thực tế:**
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm test -w @wap/chat-web`: PASS (102 test files, 1148 tests, exit code 0).
  - `npm run build:v3`: PASS (exit code 0).
  - `node scripts/test-v3-web-build-security.mjs`: PASS (exit code 0).
- **Trạng thái:** `STATUS: READY_FOR_CODEX_REVIEW`.
