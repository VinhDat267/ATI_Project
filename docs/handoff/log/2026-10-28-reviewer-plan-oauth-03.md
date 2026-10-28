# 28/10/2026 · reviewer · Kế hoạch OAUTH-03 (Google Sheets của riêng bạn)

**Loại:** chỉ tài liệu. Không đổi mã, không chạy test.
**Nhánh:** `docs/oauth-03-plan`, tách từ `docs/record-176` (`fe3f7a0`, PR #178 chưa merge), để không xung đột ROADMAP và CURRENT-STATE với #178.

## Bối cảnh

Nhóm trưởng yêu cầu "làm handoff OAuth cho Google Sheets". Reviewer đọc trạng thái mới nhất (nhánh của #178), đặc tả và task card OAUTH-02, `SheetsAdapter`, route MyCalendar và Google giả trên `origin/main` (`f616d01`), rồi hỏi nhóm trưởng từng câu.

## Nhóm trưởng quyết

1. **Bốn tình huống** đều cần: ghi vào bảng riêng; Jira → bảng riêng; bảng riêng → Slack; lịch chạy đọc bảng riêng. Reviewer gợi ý bốn tình huống khi nhóm trưởng chưa hình dung được; nhóm trưởng chọn cả bốn.
2. **Làm phần mã trong ngày 28/10.** Trước đó nhóm trưởng tưởng OAUTH-02 đã xong; reviewer nói rõ OAUTH-02 mới merge mã, cờ tắt, còn Google Cloud project, đo ×3 và P-LIVE.
3. **Phương án B, Google Picker với quyền `drive.file`**, thay cho phương án A (quyền `spreadsheets`, dán link) mà reviewer đề xuất. Reviewer đã nêu trước: B cần nạp script của Google, cần API key, và test browser cần Picker giả.
4. **Có `/guide` và Landing**, và **không đưa OAUTH-03 vào danh sách bỏ khi thiếu thời gian.** Nhóm trưởng đổi hai đề xuất ban đầu của reviewer sau khi đọc bản đầu: "không thiếu thời gian đâu, trong hôm nay tôi sẽ làm xong luôn".

## Reviewer kiểm trước khi viết

- [Phạm vi quyền Sheets](https://developers.google.com/workspace/sheets/api/scopes): `spreadsheets` là *sensitive*; `drive.file` là *non-sensitive* và được khuyến nghị.
- [Hướng dẫn Picker cho web](https://developers.google.com/workspace/drive/picker/guides/web-picker): cần `setOAuthToken`, `setDeveloperKey`, `setAppId` (project number), bật Picker API; API key giới hạn website phải có `https://docs.google.com/*`.
- [Drive `about.get`](https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get) nhận `drive.file`, nên lấy được email mà không thêm quyền.
- `origin/main`: `GmailConnectionRepo` và `GmailTokenManager` đã nhận tham số dịch vụ từ OAUTH-02; luật router "lịch riêng thắng lịch chung" viết riêng cho `scopeKey === 'calendars'`; `SheetsAdapter` gắn cứng `apiBase`; `chat-web` không có CSP.

## Đã viết

- Đặc tả [`2026-10-28-oauth-03-personal-sheets-design.md`](../../superpowers/specs/2026-10-28-oauth-03-personal-sheets-design.md).
- Task card [OAUTH-03](../tasks/OAUTH-03-personal-sheets.md).
- ROADMAP: một dòng và đoạn "Cập nhật 28/10 (OAUTH-03, kế hoạch)".
- FINISH-PLAN: quyết định 29/10 ở mục 4; ghi chú ở mục 5 rằng OAUTH-03 không nằm trong danh sách bỏ; dòng task card ở mục 8.
- CURRENT-STATE mục 7: thêm ý "OAUTH-03, chốt 28/10" vào "Chốt 25/10/2026 (OAuth)".

## Tự kiểm của reviewer

Không có review độc lập. Reviewer đọc lại đặc tả với vai người thi công và sửa hai chỗ:
- tình huống 3: model thường đọc bảng bằng tra cứu lúc lập kế hoạch, nên kế hoạch có thể không có bước đọc; bỏ yêu cầu giao diện mới cho lần tra cứu;
- thêm hai rủi ro chưa kiểm được trước P-LIVE (đặc tả mục 1.4): Picker có cấp quyền `drive.file` khi dùng token do server làm mới hay không; trình duyệt đăng nhập tài khoản Google khác.

## Quyết định của reviewer, chờ nhóm trưởng xem

Đặc tả mục 12: từ chối thêm dòng vào bảng "Chỉ xem"; tối đa 10 bảng tính; `picker-session` 10 lần/phút; bộ đo 9 câu, ngưỡng 23/27.
