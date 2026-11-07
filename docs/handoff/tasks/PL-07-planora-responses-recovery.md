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
  1. **Answer & Sources (`ResponseMoment.tsx`, `page.css`, `presentation.tsx`):**
     - Chuyển đổi ResponseCard và AnswerMoment sang hệ thống CSS tokens Planora (`--planora-text`, `--planora-paper`, `--planora-primary`, `--planora-divider`, etc.).
     - **Giải quyết UX-F1:** Thay thế toàn bộ tên tool kỹ thuật bằng tên hành động tiếng Việt tự nhiên (`toolActionLabel` trong `presentation.tsx`, ví dụ `trello.list_cards` ➔ *"Đọc danh sách công việc Trello"*, `slack.post_message` ➔ *"Gửi thông báo Slack"*, `mysheets.read_range` ➔ *"Đọc dữ liệu bảng tính Google Sheets"*, `gmail.send_message` ➔ *"Gửi email Gmail"*). Tuyệt đối không còn hiển thị raw tool identifier dạng monospace cho người dùng.
     - **Giải quyết UX-F2:** Xóa bỏ hoàn toàn nhãn "ATI" (đổi thành "Planora" với avatar "P"), xóa huy hiệu "Chưa lập kế hoạch" (unplanned badge), thay bằng status badge phù hợp ngữ cảnh ("Thông tin tra cứu", "Cần kết nối thêm", "Làm rõ yêu cầu").
     - Hiển thị citations và lookups an toàn qua giao thức HTTPS (`safeLink`), hỗ trợ mở rộng danh sách tra cứu (`#answer-lookups`) và bảo toàn `[data-answer-text]`.
  2. **Clarification Moment (`ClarificationMoment.tsx`, `ResponseMoment.tsx`, `PlanoraChatWorkspace.tsx`, `PlanoraActiveTurn.tsx`):**
     - Nâng cấp radio cards và custom text input sang style Planora.
     - **Bảo toàn F1 (P2):** Nối thao tác chọn gợi ý clarification vào cả selection và draft của composer dock / textarea (`handleSelectOption` trong workspace, `onDraft` trong `ClarificationMoment` và `ExpandedClarificationMoment`).
     - Tuyệt đối không tự động POST/submit message khi click radio option; không đặt thêm nút gửi thứ hai trên thân thẻ card.
     - **Giải quyết UX-F3:** Cấu hình lại `padding-bottom` và `scroll-padding-bottom` cho `.planora-chat-feed` (`calc(var(--cockpit-bottom-space, 120px) + 24px)` trên desktop, `+ 20px` trên mobile), ngăn chặn hoàn toàn việc thanh composer dock cố định ở đáy che khuất các nút hành động của `ExpandedClarificationMoment`.
     - **Giải quyết UX-F2 (lặp bong bóng):** Điều chỉnh `activeMessageIds` trong `PlanoraChatWorkspace.tsx` để deduplicate tin nhắn người dùng và tin nhắn phản hồi của trợ lý khi hiển thị AnswerMoment, RefusalMoment và Clarification.
  3. **Refusal Moment (`ResponseMoment.tsx`):**
     - Style các thẻ dịch vụ thiếu kết nối/phạm vi sang nhận diện Planora với status badge rõ ràng.
     - Giữ nguyên các CTA kết nối cá nhân (`#trello-connect`, `#github-connect`, `#telegram-connect`, Gmail, Calendar, Sheets) và nút "Gửi lại yêu cầu" chỉ gửi khi người dùng bấm trực tiếp.
  4. **Planning Errors & Offline (`PlanningErrors.tsx`, `RequestMoments.tsx`):**
     - Loại bỏ toàn bộ từ khóa và nhãn "ATI", thay bằng "Planora".
     - Xóa bỏ class font monospace trên `#failed-prompt-text`.
     - **Giải quyết UX-F2:** Xóa bỏ hoàn toàn huy hiệu "Make.com Orbital Flow" và các class màu cam cũ trong `RequestMoments.tsx`, đồng bộ 100% sang bảng màu và token Planora.
     - Nâng cấp `SlowPlanningMoment` hiển thị tiến trình tra cứu (`gatherState`) và nút thôi chờ giữ lại câu yêu cầu.
     - Nâng cấp `PlanningErrorMoment` phân biệt sự cố máy chủ vs mất kết nối mạng.
     - Cặp màu warning/pending Planora (`--planora-pending-bg`, `--planora-pending-text`, `--planora-pending-border`) đạt chuẩn tương phản WCAG AA (≥ 4.5:1) ở cả Light và Dark mode.
  5. **Recovery Moments & Safe D2 (`RecoveryMoment.tsx`, `RecoveryEditor.tsx`, `CockpitDialog.tsx`):**
     - **Giải quyết UX-F1:** Loại bỏ `<code>{paused.tool}</code>` và raw JSON `<pre>` trong accordion "Chi tiết để đối chiếu". Thay bằng danh sách thông tin đối chiếu nghiệp vụ thân thiện gồm hành động tiếng Việt (`toolActionLabel`), mô tả công việc, lý do gián đoạn, thời gian thực hiện và các trường dữ liệu liên quan được ánh xạ qua `recoveryFieldLabel`.
     - **Chuẩn an toàn D2 (delivery_unknown):** Khi trạng thái là `delivery_unknown`, TUYỆT ĐỐI KHÔNG hiển thị Retry, Edit, Continue hay Skip (ngăn chặn gửi lặp). CHỈ hiển thị liên kết kiểm tra ngoài trên dịch vụ đích ("Kiểm tra trên Slack", v.v.) và nút "Dừng kế hoạch".
     - **Giải quyết UX-P3-1 (Tương phản nút Dừng ở Light mode):** Nút "Dừng hẳn quy trình" trong modal xác nhận duy trì `bg-[var(--planora-error-bg)]` kết hợp `hover:border-[var(--planora-error-text)] hover:shadow-xs`, đạt tỷ lệ tương phản 5.55:1 ở Light mode và 8.42:1 ở Dark mode (vượt ngưỡng WCAG AA 4.5:1).
     - **Giải quyết UX-F1 trên RecoveryEditor:** Xóa bỏ textarea JSON thô cho Slack/Telegram/Trello; cung cấp các trường nhập liệu nghiệp vụ rõ ràng (kênh Slack có placeholder thân thiện, nội dung tin nhắn là textarea văn bản thuần). Phím Escape chỉ hủy bước xác nhận mà không đóng editor ngoài ý muốn.
     - Loại bỏ raw JSON `<pre>` dump trên `PlanoraActiveTurn.tsx:365`.
- **Bằng chứng kiểm tra thực tế:**
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm test -w @wap/chat-web`: PASS (102 test files, 1153 tests, exit code 0).
  - `npm run build:v3`: PASS (exit code 0).
  - `node scripts/test-v3-web-build-security.mjs`: PASS (exit code 0).
- **Trạng thái:** `STATUS: READY_FOR_CODEX_REVIEW`.
