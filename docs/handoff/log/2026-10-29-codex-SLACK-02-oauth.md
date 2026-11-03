# 29/10/2026 · Codex · SLACK-02 OAuth/setup

**Ủy quyền:** chủ dự án yêu cầu thực hiện Slack OAuth và Notion OAuth. Fetch main thấy SLACK-01 #183 vừa merge; dùng nền `fc12e3f`, nhánh `codex/slack-02-oauth`, worktree riêng. Không sửa checkout Gmail/PR #182 hoặc CURRENT-STATE/ROADMAP. Đọc handoff và ba log mới nhất trên main; thiết kế Slack user-token/nhiều workspace/không allowlist kênh được giữ. Người dùng chọn tự giao reviewer hiện tại; không tạo subagent hay gửi yêu cầu review cho người khác.

## Thay đổi

- Kho `slack_connections` riêng với ownership/identity uniqueness/generation; state hash gắn session/browser và CAS một lần. Giao dịch save khóa user/session và owner; disconnect xóa state đang chạy trước revoke, xóa bí mật local và tăng identityVersion. Một tài khoản có nhiều workspace; hai tên trùng vẫn theo ID, identity không bị chiếm bởi tài khoản ATI khác.
- OAuth confidential client xin `user_scope`, lấy `authed_user.access_token`, đối chiếu app/team/user với `auth.test`; không dùng bot token, không Google PKCE. Endpoint live cố định; callback HTTPS; sandbox literal loopback. HTTP deadline bằng AbortSignal, không redirect và response giới hạn 128 KiB; lỗi không đưa token/body vào response.
- Rotation dùng advisory lock PostgreSQL theo owner giữa các manager/process; autocommit checkpoint trước single-use refresh, ghi cặp token mới trong một UPDATE. Crash/unknown cần reconnect, không tái dùng refresh cũ; refresh không đổi generation. Chưa có consumer tool cá nhân; token manager dùng ở kiểm tra metadata.
- API start/callback/list/check/disconnect, Settings và callback hoàn tất. GET services chỉ thêm capability khi thực sự có cấu hình/DB/session; cờ tắt không phát sinh request mới hoặc đổi catalog. `revoked:true` chỉ là access token đã được auth.revoke xác nhận, không phải uninstall. Cấu hình mẫu và docs/slack/oauth-setup.md.
- Chưa có kho chấp thuận/provider hoặc API cấp quyền xử lý. Tất cả kết nối pending; không đọc hội thoại, không gọi model, không ingress, không thêm mys lack/tool tùy ý (namespace đích là `myslack.*`). Đây là phần OAuth/setup của SLACK-02, không phải đóng toàn bộ card/lộ trình.

## Bằng chứng

PostgreSQL16 tạm riêng `ati-oauth-test-20261029`, tmpfs, bind127.0.0.1:56538. Docker Desktop ban đầu dừng, đã khởi động nền. Không dùng DB dev/cấu hình thật. Browser API3996/web5196, OAuth HTTP Worker loopback; không Slack/model thật. Dependency npmci offline khóa đúng lockfile, 302 packages; không thêm dependency.

| Lượt | Kết quả thật |
|---|---|
| RED client/repo, rotation/config, UI | Module mới chưa tồn tại; test import fail trước code. Lượt đầu EPERM file tạm không dùng làm RED, chạy lại elevated xác nhận module missing |
| API RED | 4/4 fail vì 404; thêm ca revoked metadata fail vì chưa có trạng thái reconnect |
| Backend focused | 22 test mới qua HTTP và PostgreSQL, thuộc client5/repo4/rotation4/config4/routes5; kiểm state race, owner, generation, logout, disconnect/exchange, refresh hai manager và uncertain checkpoint |
| Frontend focused | 3 test mới +7 Settings cũ =10/10; HTTP thật, StrictMode, scrub query, 401 không replay, ngắt riêng workspace |
| Full check đầu | 3 Settings regression: request metadata phụ làm đổi luồng lưu/focus; không sửa assertion, dùng capability từ GET services và chỉ mount panel khi bật. Typecheck trước đó bắt lỗi fixture và trường response; đã sửa đúng kiểu |
| Browser đầu | 4 fail do HTTP fixture chạy cùng process đang spawnSync; chuyển Worker. Không coi đây là lỗi Slack thật hay RED sản phẩm |
| Full check cuối | exit0: **2.583 v3 =116 schemas+443 adapters+381 planner+42 executor+715 API+886 web;406 eval;1 launcher+66 Node**; typecheck/build/security scan đạt |
| Browser cuối | exit0, **4/4**, 375/1440 light/dark, OAuth redirect/callback thật qua HTTP, hai workspace, ngắt một; xem ảnh375dark và không overflow |
| Mutations | 3/3 caught, từng exit1: bỏ state-used predicate, bỏ tăng generation khi reconnect, bỏ checkpoint unknown-refresh; mỗi file khôi phục nguyên byte |

Logs/helper/screenshot bị ignore tại node_modules/.cache/oauth và node_modules/.cache/v3-browser-results. Test dùng credential/email fixture rõ ràng, không lưu secret thật. `git diff --check` được kiểm trước commit. Không chạy lại model campaign, không sửa prompt/label/catalog.

## Còn mở

Reviewer do chủ dự án giao; CI đúng head và review độc lập trước merge. Chưa cấu hình Slack app/HTTPS thật, chưa nghiệm thu Free/Pro hoặc bật flag. Kho chấp thuận/provider/enforcement content và source lifecycle vẫn mở; trạng thái pending không được coi là đã có phép xử lý. Không tuyên bố full Slack hoặc toàn bộ SLACK-02 đã xong. Notion được làm card/nhánh riêng, không lẫn vào PR này.
