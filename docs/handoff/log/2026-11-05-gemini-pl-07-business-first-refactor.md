# 2026-11-05 · gemini · PL-07 · Refactor Business-First UX & Design Brief v2.0

- **Nhiệm vụ:** Refactor toàn diện PL-07 theo Design Brief v2.0 (Mẫu 3 & Mẫu 4) và Business-First UX (05/11/2026). Giải quyết triệt để 4 findings từ đợt re-review của Argon (`2026-11-05-argon-review-pl-07-r2.md`: `UX-F1`, `UX-F2`, `UX-F3`, `UX-P3-1`) và chuẩn an toàn D2.

- **Đã làm:**
  1. **UX-F1: Loại bỏ toàn bộ rác kỹ thuật, raw tool names, raw JSON dumps và schema forms:**
     - `apps/chat-web/src/pages/Responses/ResponseMoment.tsx` & `apps/chat-web/src/pages/Cockpit/presentation.tsx`:
       - Thay thế toàn bộ tên tool kỹ thuật (`trello.list_cards`, `slack.post_message`, `slack.send_message`, `mysheets.read_range`, `gmail.send_message`, `trello.add_member`, v.v.) bằng tên hành động tiếng Việt thân thiện thông qua bảng từ điển `TOOL_ACTION_LABELS` và helper `toolActionLabel(tool)`.
       - Không còn hiển thị raw tool identifier dạng monospace cho người dùng.
     - `apps/chat-web/src/pages/Cockpit/RecoveryMoment.tsx`:
       - Loại bỏ khối `<code>{paused.tool}</code>` và raw `<pre>{JSON.stringify(...)}</pre>` trong accordion "Chi tiết để đối chiếu".
       - Thay bằng danh sách thông tin đối chiếu nghiệp vụ thân thiện: Hành động tiếng Việt (`toolActionLabel`), Nội dung công việc (`paused.description`), Lý do gián đoạn (`paused.error`), Thời gian thực hiện (`paused.duration`), và danh sách trường dữ liệu liên quan được ánh xạ qua `recoveryFieldLabel`.
     - `apps/chat-web/src/pages/Cockpit/RecoveryEditor.tsx`:
       - Thay thế hoàn toàn form textarea JSON thô cho Slack/Telegram/Trello.
       - Cung cấp form nhập liệu nghiệp vụ thân thiện: ô kênh Slack có placeholder rõ ràng (`"Ví dụ: #general, #thong-bao hoặc C12345"`), ô nội dung tin nhắn là `<textarea>` văn bản thuần có label `"Nội dung tin nhắn"`.
       - Phím Escape khi đang ở bước xác nhận dừng chỉ hủy xác nhận mà không đóng editor ngoài ý muốn.
     - `apps/chat-web/src/planora/workspace/PlanoraActiveTurn.tsx`:
       - Loại bỏ khối raw JSON `<pre>{JSON.stringify(state.activePlan, null, 2)}</pre>` trên dòng 365, thay bằng hiển thị danh sách bước kế hoạch sạch sẽ.

  2. **UX-F2: Xóa bỏ nhận diện cam cũ, badge Make.com Orbital Flow, nhãn "ATI" và lặp bong bóng tin nhắn:**
     - `apps/chat-web/src/pages/Cockpit/RequestMoments.tsx`:
       - Xóa bỏ hoàn toàn huy hiệu `"Make.com Orbital Flow"` và các class màu cam cũ (`bg-brand-primary`, `border-[#FFDFC6]`, `focus-within:shadow-orange-glow`).
       - Đồng bộ 100% sang tokens ngữ nghĩa của Planora (`--planora-paper`, `--planora-divider`, `--planora-primary`, `--planora-surface-inset`, v.v.).
     - `apps/chat-web/src/pages/Responses/ResponseMoment.tsx`:
       - Avatar đổi từ `"A"` sang `"P"`, nhãn thương hiệu đổi từ `"ATI"` sang `"Planora"`.
       - Xóa bỏ huy hiệu máy trạng thái `"Chưa lập kế hoạch"` (unplanned badge), thay bằng status badge theo ngữ cảnh nghiệp vụ ("Thông tin tra cứu", "Cần kết nối thêm", "Làm rõ yêu cầu").
     - `apps/chat-web/src/pages/Errors/PlanningErrors.tsx`:
       - Thay thế các thông báo "ATI đang suy nghĩ..." bằng "Planora đang suy nghĩ lâu hơn thường lệ".
       - Xóa bỏ class `font-mono` trên `#failed-prompt-text`.
     - `apps/chat-web/src/planora/workspace/PlanoraChatWorkspace.tsx`:
       - Cập nhật `activeMessageIds` để loại bỏ bong bóng tin nhắn bị lặp lại ở đầu feed khi hiển thị `AnswerMoment`, `RefusalMoment` và `ClarificationMoment`.

  3. **UX-F3: Khắc phục thanh composer dock cố định ở đáy che khuất nút hành động:**
     - `apps/chat-web/src/planora/styles/components.css`:
       - Bổ sung `padding-bottom: calc(var(--cockpit-bottom-space, 120px) + 24px);` và `scroll-padding-bottom: calc(var(--cockpit-bottom-space, 120px) + 24px);` cho `.planora-chat-feed`.
       - Bổ sung `padding-bottom: calc(var(--cockpit-bottom-space, 120px) + 20px);` và `scroll-padding-bottom: calc(var(--cockpit-bottom-space, 120px) + 20px);` cho `@media (max-width: 1023px) .planora-chat-feed`.
       - Đảm bảo thanh composer dock không bao giờ che khuất các nút hành động `"Xác nhận và tiếp tục"` và `"Sửa yêu cầu"` của `ExpandedClarificationMoment`.

  4. **UX-P3-1: Nâng tỷ lệ tương phản nút Dừng ở Light mode đạt chuẩn WCAG AA ≥ 4.5:1:**
     - `apps/chat-web/src/pages/Cockpit/RecoveryMoment.tsx`:
       - Nút "Dừng hẳn quy trình" trong modal xác nhận chuyển sang `bg-[var(--planora-error-bg)] hover:bg-[var(--planora-error-bg)] text-[var(--planora-error-text)] border border-[var(--planora-error-border)] hover:border-[var(--planora-error-text)] hover:shadow-xs`.
       - Tỷ lệ tương phản đo được đạt **5.55:1** ở Light mode và **8.42:1** ở Dark mode (cả hai đều vượt ngưỡng WCAG AA 4.5:1, khắc phục mức 4.46:1 trước đây khi dùng `hover:bg-[var(--planora-error-border)]`).

  5. **Chuẩn an toàn D2 (Xử lý an toàn tuyệt đối khi `delivery_unknown`):**
     - `apps/chat-web/src/pages/Cockpit/RecoveryMoment.tsx`:
       - Khi `paused.status === 'delivery_unknown'`, ẩn hoàn toàn các nút "Thử lại", "Sửa rồi thử lại", "Làm tiếp" và "Bỏ qua việc này".
       - Chỉ hiển thị duy nhất 2 hành động an toàn:
         1. Liên kết ngoài kiểm tra trực tiếp trên dịch vụ đích ("Kiểm tra trên Slack", v.v.).
         2. Nút "Dừng kế hoạch" (mở modal xác nhận dừng an toàn: *"Không thể tiếp tục sau khi dừng. Các kết quả đã hoàn thành trước đó được giữ nguyên."*).

  6. **Bảo toàn an toàn Clarification (F1):**
     - Giữ nguyên luồng an toàn F1 đã sửa: click radio option chỉ pre-fill draft vào composer dock, không tự ý POST submit. Không đặt thêm nút gửi thứ hai trên thân thẻ card.

- **Kiểm thử bổ sung (`apps/chat-web/tests/planora-responses-recovery.test.tsx`):**
  - Bổ sung 5 ca kiểm thử mới (tổng 25 tests, tất cả đều PASS):
    1. `never renders raw technical tool identifiers on DOM`: Khẳng định không còn tên tool thô (`trello.list_cards`, `slack.post_message`, `mysheets.read_range`, `gmail.send_message`) trên DOM của `ResponseMoment`.
    2. `never renders raw JSON or raw tool identifiers inside details accordion`: Khẳng định không còn thẻ `<code>` hay khối `<pre>` JSON thô trong `RecoveryMoment`.
    3. `renders structured business inputs for channels and message text without raw JSON textarea`: Khẳng định `RecoveryEditor` hiển thị form nhập liệu nghiệp vụ (channel selector/text inputs) thay vì JSON textarea.
    4. `Strict D2 safety: when paused.status is delivery_unknown, ONLY Stop button and external check link appear`: Khẳng định khi `delivery_unknown`, các nút Retry/Edit/Continue/Skip bị loại bỏ hoàn toàn, chỉ còn nút Dừng và link kiểm tra ngoài.
    5. `meets WCAG AA contrast (>= 4.5:1) for Stop button in both default and hover states across Light and Dark mode`: Khẳng định tỷ lệ tương phản nút Dừng ở cả trạng thái default và hover đều ≥ 4.5:1 trên cả Light và Dark mode.

- **Bằng chứng kiểm tra thực tế (exit code 0):**
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm test -w @wap/chat-web`: PASS (102/102 test files, 1153/1153 tests, exit code 0).
  - `npm run build:v3`: PASS (exit code 0).
  - `node scripts/test-v3-web-build-security.mjs`: PASS (exit code 0).
  - `npm test -w @wap/chat-web -- planora-responses-recovery`: PASS (25/25 tests, exit code 0).

- **Trạng thái:** `STATUS: READY_FOR_CODEX_REVIEW`.
