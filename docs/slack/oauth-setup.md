# Slack OAuth cá nhân — thiết lập và giới hạn SLACK-02

Mã kết nối OAuth có trong card [SLACK-02](../handoff/tasks/SLACK-02-oauth-connections.md). Đây là bước lưu danh tính nhiều workspace; không phải toàn bộ trợ lý Slack. Connector `slack.*` bằng bot token vẫn độc lập.

## Cấu hình app và máy chủ

1. Tạo Slack app riêng cho tích hợp cá nhân. Dùng confidential web client, không bật PKCE hoặc Sign in with Slack.
2. Cấu hình callback HTTPS công khai chính xác: `https://<web-origin>/connections/myslack/callback`. Slack không chấp nhận callback loopback HTTP trong live; dùng môi trường HTTPS của nhóm. API `/api` phải phục vụ cùng web origin để cookie browser được gửi đúng.
3. Trong OAuth & Permissions, cấu hình User Token Scopes: `channels:read`, `groups:read`, `im:read`, `mpim:read`, `channels:history`, `groups:history`, `im:history`, `mpim:history`, `search:read`, `chat:write`. Không dùng Bot Token Scopes thay thế user scopes. Đây là gói đầu cho hội thoại/tìm kiếm/thao tác; các nhóm full Slack còn mở, không xin wildcard.
4. Điền `.env` trên máy chủ (không gửi secret vào chat, không commit): `MYSLACK_ENABLED=on`, `MYSLACK_APP_ID`, `MYSLACK_OAUTH_CLIENT_ID`, `MYSLACK_OAUTH_CLIENT_SECRET`, `MYSLACK_OAUTH_REDIRECT_URI`.
5. Migrate DB rồi khởi động API/web; vào Kết nối dịch vụ → Slack của bạn → Kết nối workspace Slack. Người dùng tự chọn workspace và đồng ý quyền.
6. Lặp lại để kết nối workspace khác. Workspace cùng tên vẫn phân biệt bằng ID. Một danh tính Slack trong một app/workspace chỉ thuộc một tài khoản ATI; phải ngắt liên kết cũ trước khi chuyển.

Live luôn dùng endpoint Slack chính thức, không nhận endpoint override. Sandbox phải khai báo cả `MYSLACK_OAUTH_AUTH_URL` và `MYSLACK_API_BASE_URL` trên HTTP loopback literal; không có chúng thì kết nối cá nhân không xuất hiện.

Token rotation: hỗ trợ cả token không hết hạn và token xoay. Chỉ bật rotation ở app sau khi mã refresh đã được triển khai và nghiệm thu. Token xoay được refresh tuần tự qua khóa PostgreSQL; checkpoint trước request giúp process mới không dùng lại refresh token khi process cũ đã mất kết quả. Kết quả không xác định yêu cầu kết nối lại, không retry mù.

## API thiết lập

- `GET /api/connections/myslack`: metadata các kết nối của chính người gọi.
- `POST .../start`, `POST .../callback`: state hash một lần, cookie browser + session ATI; callback không được tự retry.
- `POST .../:id/check`: chỉ `auth.test` để kiểm danh tính; refresh khi cần, không đọc nội dung hội thoại.
- `DELETE .../:id`: chặn local trước, tăng identityVersion, xóa token và vô hiệu callback đang chạy; sau đó thử `auth.revoke` đúng access token. `revoked:true` chỉ xác nhận token đó, không có nghĩa app installation/events đã bị gỡ. `revoked:false` cần người dùng quản lý quyền ở Slack. Không gọi `apps.uninstall` cho ngắt một người.

## Chưa bật nội dung và AI

Sau OAuth, Settings chỉ hiện metadata và **chờ cho phép xử lý dữ liệu**. Card này không có endpoint tự duyệt chấp thuận, không dùng checkbox OAuth làm bằng chứng tổ chức/provider, không đọc/lưu hội thoại và không đưa Slack vào catalog/planner. Kho chấp thuận và provider có chứng cứ, enforcement nguồn/history/retention, ingress/purge và tool cá nhân vẫn cần triển khai trước khi mở nội dung. Không dùng kết nối OAuth đã lưu để rơi về bot chung.

Nghiệm thu thật yêu cầu app/workspace của nhóm, người dùng tự cấp/thu hồi quyền và kiểm đúng actor/workspace. Bằng chứng fixture/browser không chứng minh Slack thật. Chưa phân phối rộng hoặc tuyên bố full Slack.

Nguồn đối chiếu 29/10/2026: [OAuth](https://docs.slack.dev/authentication/installing-with-oauth/), [rotation](https://docs.slack.dev/authentication/using-token-rotation/), [auth.revoke](https://docs.slack.dev/reference/methods/auth.revoke/). Thiết kế chuẩn tắc vẫn là [Slack cá nhân](../superpowers/specs/2026-10-28-slack-personal-oauth-design.md).
