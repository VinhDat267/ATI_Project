# NOTION-01 · OAuth cá nhân và chọn database

**Ủy quyền:** chủ dự án yêu cầu triển khai Notion OAuth ngày 29/10/2026. Trước đó main chưa có card Notion OAuth; tạo card này trong PR riêng, nền `fc12e3f`.

## Thiết kế triển khai

- Public Notion integration qua confidential OAuth; kết nối thuộc người ATI đang đăng nhập, có thể thêm nhiều workspace. Đây là phương án cá nhân được agent đề xuất theo yêu cầu OAuth; không tự đổi connector Notion dùng chung hoặc di chuyển token của nhóm.
- Callback lấy workspace/bot/owner thực từ token response và đối chiếu bot qua `users/me`. Không giả định Notion thao tác dưới danh nghĩa người dùng: Notion API dùng integration bot được cấp quyền.
- Kho/state riêng và token mã hóa. State hash dùng một lần, gắn browser/session; nhiều workspace không ghi đè nhau; reconnect tăng identityVersion, refresh giữ version; callback thua disconnect/logout không được hồi sinh kết nối.
- Chọn tối đa10 database đã chia sẻ. Search dùng API version đang pin `2026-03-11`, data_source → database_id, hiển thị giới hạn kết quả; server xác minh từng database được chọn, không tin ID từ UI. Đổi phạm vi CAS theo version, không ghi đè kết nối mới.
- Chỉ endpoint Notion chính thức ở live; sandbox chỉ HTTP loopback. `MYNOTION_ENABLED=off` mặc định. User tự cấu hình public integration/cấp quyền thật khi code sẵn sàng.
- API/UI OAuth + chọn phạm vi là deliverable card này. **Không đăng ký tool cá nhân hoặc âm thầm dùng token OAuth cho `notion.*` chung**. Tích hợp catalog/binding/preview/executor và nghiệm thu workflow cần card tiếp theo; trạng thái UI nói rõ chưa mở công cụ cá nhân. Không tuyên bố toàn bộ Notion integration đã xong.

## Kiểm chứng và điều kiện bàn giao

TDD; PostgreSQL thật cho state/CAS/identity/session/rotation; HTTP fixture cho Basic auth/token/identity/search/scope/revoke/abort; query scrub/StrictMode, nhiều workspace và ngắt riêng. Hồi quy shared Notion không sửa assertion. Full check và browser375/1440 sáng/tối; một log bàn giao, CI đúng head và reviewer do chủ dự án giao trước merge.

## Kết quả

- OAuth confidential public integration, owner/workspace/bot verification, nhiều workspace, state/session/browser/CAS, token mã hóa, refresh/checkpoint và ngắt riêng đã có mã.
- API chọn database xác minh qua Notion; đổi phạm vi tăng identityVersion/CAS. UI lưu lựa chọn qua nhiều lượt tìm; callback scrub query và StrictMode không replay. Mọi response `toolsAvailable:false`, không thay token/công cụ chung.
- Bản Notion độc lập: full check exit0 **2.579 v3+406 eval+1 launcher+66 Node**, trước khi bổ sung một ca DB scope race; ca mới và rotation kiểm riêng **8/8**. Browser **4/4**,375/1440 sáng/tối, đã xem ảnh375dark. **4/4 mutation** replay/generation/scope-CAS/unknown-refresh bị bắt, khôi phục nguyên byte.
- Đang ghép điểm tích hợp với PR Slack #184 và sẽ kiểm toàn bộ lại trên cây chung; số liệu cuối ở log. Reviewer do chủ dự án giao. Chưa public integration, quyền Notion thật, model campaign hoặc bật flag. Công cụ cá nhân/workflow còn [NOTION-02](NOTION-02-personal-tools.md).
