# 26/10/2026 · Nhóm trưởng xác nhận việc sửa assertion cũ của OAUTH-01

**Người viết:** reviewer. **Nhánh:** `docs/oauth-01-assertion-confirmed`, tách từ `origin/main` `88791d9`. Chỉ tài liệu.

## Quyết định

Ngày 26/10, sau merge #172, #173, #174, nhóm trưởng viết: "đồng ý sửa assertion gmail-migration".

Câu này xác nhận việc #172 sửa test cũ `apps/chat-api/tests/db/gmail-migration.test.ts` ("runs the whole migration set again…"):
- trước: "đúng 2 ràng buộc CHECK của `oauth_states` có chữ `mode`";
- sau: "đúng tập tên `oauth_states_mode_check`, `oauth_states_mode_owner_check`, `oauth_states_return_to_check`".

Mục đích là để ràng buộc của migration 0011 giữ đúng đặc tả OAUTH-01 mục 4.1 (có `mode = 'connect_gmail'`). Đây là assertion cũ duy nhất #172 sửa. Review độc lập lần 2 thấy chỗ sửa phù hợp và không nới kiểm tra.

## Đã sửa

- `CURRENT-STATE.md`:
  - mục đầu file ghi "đã xác nhận";
  - bỏ dòng "chờ nhóm trưởng xác nhận" ở mục 4 và mục 5;
  - mục 7 "Chốt 25/10/2026 (OAuth)" thêm quyết định này.
- `ROADMAP.md`: dòng OAUTH-01 ghi đã xác nhận.
- Task card OAUTH-01 (phần Kết quả) và đặc tả OAUTH-01 (ghi chú ở mục 4.1): "chờ xác nhận" đổi thành "nhóm trưởng xác nhận ngày 26/10".

Không đổi mã hay test.
