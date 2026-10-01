# 2026-10-02 · Claude Code · Review kế hoạch tuần 3 trước khi giao việc

- **Phạm vi:** tự review các task card W3-00 → W3-07 và `W3-service-common.md` (commit `3ca1b2e`, PR #25), đối chiếu từng khẳng định với mã nguồn trên `main` `2ae2a16`. Sửa trong cùng PR trước khi merge.
- **Lỗi nghiêm trọng đã sửa** (nếu để nguyên, agent làm đúng task card vẫn ra tính năng hỏng):
  - **Output tool không khớp bộ nhớ grounding.** `compact()` trong `packages/planner/src/search.ts` bỏ hẳn thực thể không có `id` và chỉ giữ các trường `id, name, fullName, number, title, boardId, boardIds, url`. Task card cũ quy định:
    - `sheets.list_sheets` trả `sheetId` (không có `id`): mọi tab bị bỏ;
    - `jira.search_issues` không có `id`: mọi issue bị bỏ;
    - Calendar dùng `summary`: model không thấy tên lịch;
    - Jira dùng `x-resource-field: 'key'` trong khi `key` không được giữ: mọi plan Jira bị grounding từ chối.

    Đã thêm mục "Hợp đồng output với planner" vào yêu cầu chung, sửa output của Sheets, Calendar, Jira, và thêm `key` vào `KEPT_FIELDS` trong W3-00.
  - **Test bất biến từ khóa mâu thuẫn với registry hiện có.** Danh sách cấm có `task`, nhưng Trello đang dùng `task` trong `fallbackIntentKeywords`, nên test sẽ fail ngay. Đã sửa: danh sách cấm chỉ áp dụng cho service mới, từ khóa cũ được ghi là ngoại lệ, so sánh nguyên cụm.
  - **Kiểm tra tĩnh không bắt được chỗ cần bắt.** Mẫu `'trello'` không khớp `'trello.create_card'` trong `validator.ts` hay khóa `{ trello: 'Trello' }` trong `ReconciliationNotice.tsx`. Đã đổi mẫu và thêm danh sách ngoại lệ có lý do.
  - **Label golden bị vô hiệu.** `rf06` của bộ 50 câu yêu cầu đặt lịch Google Calendar và có label `refusal`. Sau W3-02, label này sai. W3-06 phải sửa label trong commit riêng, người dùng chốt, và báo cáo so sánh trên các câu không đổi label.
- **Thiếu sót đã bổ sung:**
  - W3-00 bỏ sót `SettingsModal.tsx:174` (nhãn allowlist viết cố định) và các quy tắc riêng Trello trong lõi planner (`validator.ts` kiểm thành viên đúng board, ví dụ plan trong `system-prompt.ts`). Hai quy tắc planner được giữ và ghi là ngoại lệ.
  - Hợp đồng prefetch: tool `listable` nhận `{ query: '', limit: 10 }`; tool con được truyền `id` của cha. `list_sheets` thành `listable`; `list_events` (cần khoảng thời gian) và `jira.search_issues` (cần `key` của project) không được `listable`.
  - Service mới chỉ hỗ trợ `PLANNER_SEARCH_MODE=llm`; W3-06 chạy ở chế độ này.
  - Định tuyến: thay "5 câu bất kỳ" bằng bộ câu hồi quy dùng toàn bộ câu của bộ 50, bộ 18 và các câu mẫu, so với snapshot (W3-00). Planner không import từ `apps/chat-web`.
  - Jira: không viết cố định loại issue `Task`; `query` rỗng thì bỏ `text ~`; escape ký tự đặc biệt.
  - W3-07:
    - cảnh báo chính sách tổ chức có thể chặn tạo key service account;
    - Telegram cần `/start@<bot>` vì chế độ privacy;
    - ca lỗi thật đổi từ "chặn ngoài allowlist" (không gọi API, unit test đã đủ) sang "credentials sai bị service thật từ chối".
- **Tách việc:** phần giao diện và câu từ chối nêu tên service chuyển sang W3-00b, không chặn các task service. Lý do: W3-00 chặn năm task nên càng nhỏ càng merge sớm. Router giữ `classifyIntent` làm lớp bọc vì test và script audit đang dùng.
- **Đã kiểm, không phải lỗi:**
  - `memoryValues` đổi số thành chuỗi, nên chat ID số của Telegram vẫn grounding được.
  - Executor và luồng phục hồi không có nhánh theo tên tool.
  - CI hiện chạy khoảng 2 phút, nên thêm 5 kịch bản browser không đáng lo.
  - Câu golden "họp sprint", "tài liệu API", "lịch bảo trì", "lịch nghỉ lễ" không bị từ khóa mới bắt nhầm với danh sách từ khóa đã chọn (Calendar dùng `fallbackIntentKeywords` cho `họp`; Jira không dùng `sprint`; Notion không dùng `tài liệu` làm từ khóa chính).
