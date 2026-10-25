# 25/10/2026 · Kế hoạch OAuth: phạm vi và OAUTH-01

**Người viết:** reviewer. **Nhánh:** `docs/oauth-01-plan`, tách từ `main` `7bb752d`. Chỉ có tài liệu.

## Quyết định của nhóm trưởng

- Ngày 24/10, nhóm trưởng quyết triển khai đề xuất "OAuth và tạo lịch workflow bằng AI" của `longnguyen005`: lịch chạy làm trước, OAuth làm sau (#166).
- Ngày 25/10, nhóm trưởng nhờ reviewer đề xuất phạm vi OAuth ("bạn đề xuất phạm vi luôn đi") rồi duyệt ("duyệt, viết đặc tả OAUTH-01 đi"):
  - **OAUTH-01**, bắt buộc: kết nối Gmail ngay trong hội thoại, quay về đúng hội thoại, gửi lại yêu cầu;
  - **OAUTH-02**, tuỳ chọn: Google Calendar riêng, quyết ngày 29/10, mốc cắt 01/11;
  - các provider khác không làm, ghi vào báo cáo là hướng phát triển.

## Cơ sở đề xuất

- **Hiện trạng** (đọc mã ngày 25/10):
  - nút "Kết nối Gmail" của màn từ chối (`RefusalMoment`) đi tới `/settings#gmail`, và callback cũng quay về `/settings#gmail`;
  - người dùng mất hội thoại và phải gõ lại;
  - màn từ chối cũ vẫn ghi Gmail "chưa thiết lập" vì đọc trạng thái từ `unavailableServices` của lần từ chối.
- **Chọn lưu `returnTo` ở server** (cột `oauth_states.return_to`), không ở `sessionStorage`:
  - nó gắn với đúng state một lần của luồng;
  - quyền sở hữu hội thoại được kiểm lúc `start`;
  - không còn giá trị cũ từ một lần kết nối bỏ dở.

  Đổi lại, khi người dùng huỷ ở Google thì không quay về được hội thoại. Đặc tả ghi đây là giới hạn, ở mục 7.
- **Calendar và Sheets** đang dùng `GoogleServiceAccount` bên trong adapter, và allowlist chung (`allowedScope.calendars`, `spreadsheets`). Muốn có kết nối riêng (OAUTH-02) thì phải:
  - cho adapter nhận nguồn token;
  - có allowlist theo người;
  - có cache adapter theo người;
  - gắn kết nối vào kế hoạch như Gmail.

  Đây là lý do OAUTH-02 chỉ là tuỳ chọn.

## Thay đổi

- [Đặc tả OAUTH-01](../../superpowers/specs/2026-10-25-oauth-connect-from-chat-design.md).
- Task card [OAUTH-01](../tasks/OAUTH-01-connect-from-chat.md).
- ROADMAP: thay dòng "OAuth cho các dịch vụ" bằng hai dòng OAUTH-01 và OAUTH-02, thêm "Cập nhật 25/10 (OAuth)".
- CURRENT-STATE mục 7: thêm "Chốt 25/10/2026 (OAuth)".

## Chưa làm

- Đặc tả OAUTH-02, nếu nhóm trưởng quyết làm ngày 29/10.
- Chưa có review độc lập cho đặc tả. Đặc tả do reviewer lập theo phạm vi nhóm trưởng đã duyệt, giống #166.
