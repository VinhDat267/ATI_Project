# Notion OAuth cá nhân — thiết lập NOTION-01

Card [NOTION-01](handoff/tasks/NOTION-01-oauth-connections.md) thêm OAuth public integration và chọn database. Token integration dùng chung hiện tại không đổi. Tool cá nhân/workflow theo card tiếp theo [NOTION-02](handoff/tasks/NOTION-02-personal-tools.md); OAuth setup không tự mở quyền thực thi qua token mới.

1. Tạo public integration trong Notion Developer portal. Chọn phạm vi workspace phù hợp và khả năng đọc/insert/update theo công cụ dự kiến; không thay internal integration của nhóm.
2. Khai báo redirect chính xác `https://<web-origin>/connections/mynotion/callback`. API `/api` phải nằm sau cùng origin với web để cookie browser được gửi đúng. Server live của ATI yêu cầu HTTPS; sandbox cho HTTP loopback fixture.
3. Điền `.env` trên máy chủ, không gửi secret vào chat/commit: `MYNOTION_ENABLED=on`, `MYNOTION_OAUTH_CLIENT_ID`, `MYNOTION_OAUTH_CLIENT_SECRET`, `MYNOTION_OAUTH_REDIRECT_URI`.
4. Migrate DB và khởi động API/web; vào Kết nối dịch vụ → Notion của bạn → Kết nối workspace Notion. Người dùng chọn workspace/trang chia sẻ trong màn cấp quyền Notion. API thao tác bằng integration bot, không mạo danh người cấp quyền.
5. Sau khi về ATI, chọn database đã chia sẻ (tối đa10). Tìm kiếm có giới hạn20 kết quả, có nhắc khi còn nữa. Server xác minh từng ID với Notion trước khi lưu; database không được chia sẻ sẽ bị từ chối. Quyền đọc không đảm bảo quyền ghi; Notion vẫn quyết định quyền native khi công cụ được mở sau này.
6. Có thể thêm workspace khác và ngắt riêng từng kết nối. Đổi database hoặc reconnect tăng identityVersion. Refresh token không đổi generation. Không tự đổi token chung hoặc dùng kết nối của người khác.

Live cố định endpoint `https://api.notion.com/v1`; sandbox phải có cả `MYNOTION_OAUTH_AUTH_URL` và `MYNOTION_API_BASE_URL` là HTTP loopback literal. Sandbox thiếu endpoint không xuất hiện panel, không gọi Notion thật.

OAuth state hash một lần gắn session/browser; callback không tự retry; query code/state được xóa trước request. Token mã hóa; khi token bị từ chối, refresh tối đa một lần dưới khóa PostgreSQL. Checkpoint trước refresh ngăn process mới tái dùng token cũ sau kết quả không xác định. Refresh không khôi phục quyền cho workspace/owner khác.

`POST /api/connections/mynotion/:id/check` kiểm bot metadata; `DELETE .../:id` chặn local/xóa token trước rồi thử revoke ở Notion. Nếu remote revoke chưa xác nhận, UI hướng dẫn gỡ quyền integration trong Notion. Ngắt không tự xóa dữ liệu đã được người dùng tạo ở dịch vụ ngoài.

Đợt này không thêm catalog tool cá nhân, planner hay workflow; UI nêu rõ điều đó. Cờ mặc định off; chưa cấu hình app, cấp quyền, gửi nội dung vào model hoặc nghiệm thu provider thật thay người dùng. Reviewer do chủ dự án giao, CI đúng head và nghiệm thu thật là các gate riêng.

Nguồn đối chiếu 29/10/2026: [public authorization](https://developers.notion.com/guides/get-started/authorization), [token](https://developers.notion.com/reference/create-a-token), [refresh](https://developers.notion.com/reference/refresh-a-token), [bot identity](https://developers.notion.com/reference/get-self), [revoke](https://developers.notion.com/reference/revoke-token).
