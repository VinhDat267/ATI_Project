# SLACK-02 · OAuth cá nhân và nhiều workspace

**Ủy quyền:** chủ dự án yêu cầu thực hiện Slack OAuth và Notion OAuth ngày 29/10/2026. Card này chỉ triển khai Slack; Notion là card/nhánh tiếp theo. Nền `fc12e3f`, SLACK-01 #183 đã merge.
**Thiết kế:** [Slack cá nhân](../../superpowers/specs/2026-10-28-slack-personal-oauth-design.md), đặc biệt mục 4.1–4.5, 9 và 10.

## Phạm vi

- Confidential OAuth user token (`user_scope`), danh tính đối chiếu `auth.test`, một tài khoản ATI có nhiều workspace. Giữ connector bot chung nguyên trạng.
- Kho kết nối OAuth workspace riêng, token mã hóa; unique identity; state hash một lần, cookie browser + phiên ATI, callback CAS và khóa PostgreSQL thật. Kết nối lại tăng identityVersion; refresh không tăng.
- Refresh token rotation có khóa DB xuyên process và checkpoint trước network: kết quả không xác định cần kết nối lại, không dùng lại refresh cũ. Ngắt chỉ đúng connection/owner, xóa bí mật và vô hiệu callback đang chạy.
- Settings: thêm workspace, trạng thái/identity/quyền còn thiếu, ngắt kết nối; callback không spinner sau thành công và không tự gửi lại yêu cầu.
- Cờ `MYSLACK_ENABLED=off` mặc định; live endpoint cố định và HTTPS callback; sandbox chỉ loopback fixture. Không thay prompt/catalog và không thêm `myslack.*` trong card này (SLACK-03).
- Sau OAuth chỉ có metadata thiết lập, `processing_pending`. Chưa có bằng chứng tổ chức/provider được phép thì không đọc nội dung hoặc gọi model. Không dùng checkbox OAuth làm chấp thuận tổ chức. Ingress/purge/nguồn và công cụ nghiệp vụ tiếp tục ở SLACK-03–06; live acceptance ở 07.

## Kiểm chứng

- PostgreSQL thật: callback một lần, khác owner/session/browser, hết hạn/logout, callback vs disconnect, hai workspace và identity conflict, reconnect generation; ciphertext không chứa token, list không lộ secret.
- HTTP fixture: user token thay vì bot token, scope thiếu, auth.test mismatch, timeout/redirect; rotation hai manager chỉ refresh một lần; lỗi không xác định không retry token cũ; revoke connection đúng danh tính.
- Frontend: OAuth start/callback/cancel, nhiều workspace, ngắt riêng, xóa code/state khỏi URL, StrictMode không callback lặp; Settings sáng/tối và 375/1440.
- Typecheck/check và browser liên quan; kết quả ghi thật, không tuyên bố fixture là Slack live.
- CI đúng head và review độc lập trước merge. App credentials/cấp quyền thật do chủ dự án thực hiện khi mã đã sẵn sàng.

## Kết quả

- Đã triển khai phần OAuth/setup: migration 0014, kho riêng, state/session/browser, nhiều workspace, user token xác minh `auth.test`, ciphertext, identityVersion, rotation có checkpoint PostgreSQL và ngắt từng kết nối. Không có content tool/model call.
- API `.../:id/check` phân biệt quyền bị thu hồi với lỗi mạng. Settings chỉ tải metadata khi capability được bật; cờ tắt giữ hành vi và số request cũ. Callback xóa query trước request, StrictMode không gửi lặp, màn hoàn tất không spinner.
- `npm run check` exit 0: **2.583 v3 + 406 eval + 1 launcher + 66 Node**, typecheck/build/security đạt. Browser `slack_oauth` **4/4**, 375/1440 sáng/tối; đã xem ảnh 375 dark. Ba mutation replay/generation/refresh đều bị bắt, khôi phục nguyên byte.
- RED: thiếu module ban đầu; API 4/4 fail vì route chưa có; ca revoke metadata fail trước sửa. UI 401 ban đầu không thoát trạng thái chờ đã sửa; full check tìm 3 hồi quy Settings vì request capability phụ, đã sửa bằng metadata capability trong GET services, giữ assertion cũ; lượt check cuối xanh. Lượt browser đầu fixture bị chặn bởi launcher đồng bộ, chuyển fixture sang Worker, lượt cuối 4/4.
- Hướng dẫn [thiết lập](../../slack/oauth-setup.md). Log [triển khai](../log/2026-10-29-codex-SLACK-02-oauth.md).
- **Chưa đóng toàn bộ SLACK-02:** kho chấp thuận tổ chức/provider có chứng cứ chưa triển khai; pending là fail-closed, không phải chấp thuận. Tool/binding/source/ingress/purge/Inbox vẫn theo SLACK-03–07. Chưa app setup, Slack/model live hoặc bật flag; chưa review độc lập, người dùng sẽ giao reviewer hiện tại. PR nháp, không merge.
