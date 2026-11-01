# Slack OAuth cá nhân — thiết lập và giới hạn SLACK-02

Mã kết nối OAuth có trong card [SLACK-02](../handoff/tasks/SLACK-02-oauth-connections.md). Đây là bước lưu danh tính nhiều workspace; không phải toàn bộ trợ lý Slack. Connector `slack.*` bằng bot token vẫn độc lập.

## Cấu hình app và máy chủ

1. Tạo Slack app riêng cho tích hợp cá nhân. Dùng confidential web client, không bật PKCE hoặc Sign in with Slack.
2. Cấu hình callback HTTPS công khai chính xác: `https://<web-origin>/connections/myslack/callback`. Slack không chấp nhận callback loopback HTTP trong live; dùng môi trường HTTPS của nhóm. API `/api` phải phục vụ cùng web origin để cookie browser được gửi đúng.
3. Trong OAuth & Permissions, cấu hình User Token Scopes: `channels:read`, `groups:read`, `im:read`, `mpim:read`, `channels:history`, `groups:history`, `im:history`, `mpim:history`, `users:read`, `search:read`, `chat:write`. Không dùng Bot Token Scopes thay thế user scopes. Kết nối cũ thiếu `users:read` cần kết nối lại để dùng users.list/users.info; thiếu quyền bị chặn trước transport. Đây là gói đầu cho hội thoại/tìm kiếm/thao tác; các nhóm full Slack còn mở, không xin wildcard.
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

## OAuth và quyền xử lý dữ liệu là hai bước riêng

Sau OAuth, Settings hiện metadata và **chờ cho phép xử lý dữ liệu** nếu chưa có chấp thuận hợp lệ. Không có endpoint để người dùng tự chứng nhận tổ chức/provider; checkbox OAuth không thay bằng chứng đó. Provider phải được xác minh và chấp thuận workspace phải cho phép đúng mục đích, thời hạn và cấu hình model hiện hành. Không dùng kết nối OAuth đã lưu để rơi về bot chung.

## Tra cứu có duyệt trong ATI · M2

Luồng [03B4](../handoff/tasks/SLACK-03B4-public-read-integration.md) nối tám thao tác đọc cá nhân: liệt kê/xem kênh, lịch sử/thread/thành viên, liệt kê/xem người dùng và lấy permalink. Luồng này xuất hiện khi máy chủ có PostgreSQL, cấu hình OAuth cá nhân và `MYSLACK_ENABLED=on`; mặc định triển khai vẫn tắt.

1. Trong Không gian làm việc, bật **Tra cứu Slack của bạn**. Nếu có nhiều workspace, chọn rõ một workspace; kiểm tra tên, ID và danh tính Slack.
2. Gửi yêu cầu như “Liệt kê kênh” hoặc “Đọc 10 tin kênh C0123456789”. Nếu chỉ biết tên, liệt kê trước rồi dùng mã đã chọn trong yêu cầu tiếp theo. Model chỉ nhận yêu cầu bạn gõ và metadata công cụ, không nhận kết quả Slack hoặc lịch sử hội thoại từ luồng này.
3. Kiểm tra workspace và các bước trong kế hoạch rồi bấm **Duyệt kế hoạch**. Chưa duyệt thì chưa gọi API đọc Slack. Máy chủ tự gắn kết nối và kiểm tra lại quyền ở từng lần thực thi.
4. Xem kết quả trong ATI. Nội dung được tải qua API có kiểm tra nguồn/quyền; sự kiện thay đổi nguồn xóa cache trước khi tải lại. Kết quả đang mở cũng được kiểm tra định kỳ/khi cửa sổ được kích hoạt; tải lại quá hạn sẽ ẩn dữ liệu cũ.

Luồng có lịch sử này cần các mục đích `planning`, `manual_lookup` và quyền `storage` tối thiểu1ngày; kết quả lưu tối đa1ngày, có thể bị ẩn sớm hơn khi nguồn/quyền thay đổi. Workspace chỉ cho retention0 không dùng luồng lưu lịch sử này. Kết nối lại workspace hoặc thay đổi chấp thuận có thể buộc lập và duyệt lại kế hoạch.

API đề xuất: `POST /api/conversations/:id/slack-read-plans` với `{content,connectionId,tempId?}`. Chỉ chủ hội thoại được gọi; máy chủ không nhận binding/workspace/policy do client tự gán. Mọi thao tác ghi cá nhân, lịch tự chạy, ba mode/Inbox và full API vẫn nằm ngoài M2.

## Authorizations fanout ·04B3

Hạ tầng M3 dùng `MYSLACK_APP_TOKEN` riêng, có scope `authorizations:read`, để gọi `apps.event.authorizations.list` qua header Authorization và đọc đủ các trang. Token này chỉ được cấu hình ở backend; không đưa vào UI, model hoặc tool nghiệp vụ bằng user token. Tham khảo [phương thức Slack](https://docs.slack.dev/reference/methods/apps.event.authorizations.list/).

`MYSLACK_AUTOMATION_ENABLED=off` vẫn là mặc định. Khi thử đường fanout trong sandbox, dùng app token fixture và endpoint HTTP loopback riêng; live cố định endpoint Slack. Thiếu cấu hình app token khi bật automation live làm bootstrap từ chối với lỗi cố định. Ingress lifecycle/purge vẫn chạy khi automation tắt, nếu signing/app configuration được giữ lại.

Card04B3 chỉ tạo intent metadata riêng theo binding, chưa đọc nội dung, gọi model hoặc tự ghi. Processing controls là giao diện nội bộ cho05 và mặc định chưa bật. Từng intent phải qua sáu mốc bắt đầu: processing start, consent grant, identity epoch, provider attestation, config revision và resume. Khởi động/bật lại ghi mốc mới; không tự chạy bù tin cũ. Sự kiện thiếu event_context bị bỏ qua thay vì đoán người nhận; cần probe native riêng trước khi mở các đường nhận chủ động.

Nghiệm thu thật yêu cầu app/workspace của nhóm, người dùng tự cấp/thu hồi quyền và kiểm đúng actor/workspace. Bằng chứng fixture/browser không chứng minh Slack thật. Chưa phân phối rộng hoặc tuyên bố full Slack.

Nguồn đối chiếu 29/10/2026: [OAuth](https://docs.slack.dev/authentication/installing-with-oauth/), [rotation](https://docs.slack.dev/authentication/using-token-rotation/), [auth.revoke](https://docs.slack.dev/reference/methods/auth.revoke/). Thiết kế chuẩn tắc vẫn là [Slack cá nhân](../superpowers/specs/2026-10-28-slack-personal-oauth-design.md).

### Lifecycle rotation recovery (04B4)
Retain MYSLACK_OAUTH_CLIENT_ID and MYSLACK_OAUTH_CLIENT_SECRET with the existing app ID, signing secret and pinned lifecycle endpoint during flags-off draining. These private credentials permit only that app's captured lifecycle rotation; no redirect or OAuth-start flag is required. If either is missing, expired rotating credentials remain blocked for manual reconnect.

A durable refresh_in_flight checkpoint is committed before one single-use exchange. Confirmed fresh tokens are encrypted under exact owner/app/binding/config/lease fences; matching pending metadata jobs/barriers follow the new fingerprint without releasing any block. Fresh auth.test resolves one captured barrier. Transient identity probes retain confirmed credentials. Unknown exchange, crash checkpoint, expired lease or contradictory principal keeps reconnect_required and the block; never replay the old refresh token or infer grant revocation from event time. Manual reconnect/disconnect takes priority through the owner lock. No provider-wide revoke or content/model access is performed.

### Internal write-safety gate (04C)
The internal safe writer is available to reviewed server integration only; public writes remain disabled until03C2. The initial family is one literal C/G channel text post (<=4000characters), no DM/thread/reference writes. It verifies channel membership with the current user token, stores only operation/binding/digests, commits the attempt before HTTP and never retries an ambiguous same-step write. Confirmed readback returns metadata only. No Slack text/token is persisted in the outbox or receipt.

A read-only reconciliation searches at most5pages/100messages each and requires exactly one matching actor/text plus client_msg_id or an already captured native timestamp. Partial pages, ambiguity or absence retain UNKNOWN. Plan expiry blocks new dispatch but does not prevent read-only reconciliation of an existing dispatched attempt under current authority. Reconnect/generation or policy/source denial still blocks access. No automatic reconciliation loop or write replay is enabled.

Signed ordinary echoes with exact app/workspace/actor/channel and client_msg_id/native timestamp are quarantined durably before ACK. Other messages by the same human remain eligible. Native echo correlation before the provider receipt (especially absent client_msg_id), Free/Pro/Connect and proactive live automation require07 native probes; fixture evidence cannot enable that flag. Lifecycle invalidation remains independent of ordinary echo classification and flags.

### Explicit approved channel post (03C2)
MYSLACK_WRITES_ENABLED defaults off. Public send mode exists only with PostgreSQL, valid personal OAuth/MYSLACK_ENABLED=on and the separate write flag on. Fixture tests enable it only in the isolated process. Keep main/live off until native07 acceptance and a separate approved rollout.

Choose the connected workspace and a literal C/G channel ID, type the exact text (max4000characters), inspect workspace/actor/channel/content in preview, then approve. No Slack write or membership lookup happens before approval; this explicit path uses no model/history/gather. It requires chat:write plus the channel family's read/history scopes and current planning/manual-lookup consent. DM/thread/references/multi-step/automatic writes and broader APIs remain separate reviewed scope.

The executor calls the private safe writer only through an explicit server callback; default personal write dispatch stays disabled. Current app/owner/binding/epoch/origin/hash/scopes and membership are rechecked. Invalidation advisory locks precede authority rows, proven with an actual competing holder; the outbox SQL final-expiry/lease fence remains last. Metadata-only confirmed receipts are persisted; source-derived read results keep their previous provenance path.

UNKNOWN exposes read-only Đối soát Slack and Stop. Retry/skip/continue do not bypass the personal write outbox. Reconciliation verifies current authority and updates only the still-unknown step/plan under SQL CAS; a Stop that committed during readback wins. Outbox evidence remains truthful independently of the plan state. No text/token enters receipt/outbox/model; user-authored request/preview follows ordinary private conversation storage. Broader Slack F3/F4/native release is not closed by this slice.
