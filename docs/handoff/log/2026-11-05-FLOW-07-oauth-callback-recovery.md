# FLOW-07 — Sửa callback Gmail/Jira chặn nghiệm thu native

- Ngày: 05/11/2026, Asia/Bangkok. Task: [FLOW-07](../tasks/FLOW-07-live-acceptance.md).
- Nhánh: `test/flow07-app-acceptance`; base `63f91f9ea0befce61e1b78a69bd8df228a6fa6c5`; source fix `6268e482891143b530b8e4d3500b53bd77a389ea`.
- Giữ nguyên checkout main và các artifact cũ. Không sửa CURRENT-STATE/ROADMAP, không merge, không bật scheduler. Sau khi người vận hành báo không kết nối được Gmail/Jira sau redirect, ưu tiên sửa blocker này trước 18 lượt nghiệm thu.

## Nguyên nhân và hành vi sau sửa

1. Redirect Jira đang cấu hình dùng `/connections/jira/callback`; router trước đó chỉ chấp nhận `/connections/myjira/callback`. Hỗ trợ cả hai đường dẫn chính xác, cùng một parser và callback handler.
2. Cookie/localStorage tách theo `localhost` và `127.0.0.1`. Nếu host nhận callback giữ token cũ hết hạn, AuthGate hydration xóa session và điều hướng về login sau khi useRoute đã xóa code/state khỏi URL. Giữ input trong route để hop có giới hạn sang loopback host còn lại trước điều hướng login. Backend vẫn kiểm state/user/session/browser binding như cũ; không sao chép session/token sang host khác.
3. Không phục hồi callback đã hủy hoặc logout chủ động, không phục hồi sau storage logout từ tab khác, không chuyển sang domain ngoài loopback. Không thêm grant, fallback shared connection hoặc replay một callback đã được xác thực.

## Bằng chứng thực thi

- RED Jira alias: 1 fail / 20 existing PASS qua fixture HTTP loopback.
- RED stale session: ba ca Gmail/Jira đều mất callback trước sửa; ba ca domain ngoài, hủy và cross-tab logout đã PASS.
- GREEN: `npm test -w @wap/chat-web -- tests/oauth-callback-session.test.tsx tests/jira-callback.test.tsx tests/gmail-callback.test.tsx`: **3 files / 50 tests PASS**.
- `npm run typecheck:v3`: **PASS**, exit 0. Lần kiểm tra trước phát hiện ba lỗi kiểu `exact` trong selector của test mới; đã sửa rồi chạy lại.
- Reviewer độc lập chạy lại 7 file callback/auth/session/storage/return-target: **82 tests PASS**, web tsc và diff check PASS tại source `6268e482`; không còn phát hiện P1/P2 cụ thể trong bản vá này.
- Browser thật, API production composition `runtimeMode=live`, DB thử PostgreSQL: Gmail/Jira quay về host khởi tạo, state thật được consume cùng session/browser binding gốc, đúng một request callback đã xác thực, session gốc vẫn HTTP 200. Bản xuất Gmail có callback 401 tại host session cũ; Jira phục hồi qua AuthGate và bản xuất chỉ có phản hồi callback tại host gốc. Probe dùng authorization code cố ý không hợp lệ; API callback trả HTTP 400 sau exchange bị từ chối là mong đợi và **không chứng nhận đã hoàn tất consent provider**.
- Browser desktop Jira alias, mobile canonical Jira và desktop Gmail: callback lỗi có hướng xử lý, query được scrub, không rơi vào 404. Không dùng route mock cho các probe browser này.
- Đã chạy lại hai probe native trên runtime source khớp `6268e482`. [Bản xuất kết quả đã bỏ dữ liệu tài khoản](../../ai-evidence/FLOW-07-OAUTH/2026-11-05/native-callback-probes.json) được commit cùng PR; ảnh, mã probe và output riêng giữ trong artifact cục bộ.
- Full check đầu chạy khi test RED đang được bổ sung: schemas/adapters/planner/executor/API PASS; web fail đúng ba ca stale session chưa sửa. Sau bản sửa, `DATABASE_URL=<isolated test DB> VITEST_MAX_WORKERS=2 npm run check` **PASS, exit 0**: schemas 579, adapters 636, planner 547, executor 55, API 2.471, web 1.187 test; evaluations 500 PASS / 1 preflight chủ động SKIP; build/security/launcher/Node checks PASS. Những commit sau source `6268e482` chỉ cập nhật tài liệu và bằng chứng, không đổi runtime/test sources.

## Cấu hình thử và giới hạn

- DB app thử vốn đang dừng được khởi động lại; dùng nguyên tài khoản thử và kết nối được cấp quyền, không seed token giả để gọi đó là live. DB tổng kiểm thử dùng container riêng.
- Token Slack trong workspace thử bị `invalid_auth`, khác token thử hợp lệ trong cấu hình local. Đã cập nhật qua API cho đúng workspace thử và chỉ kênh `ati-test`. Read-only `auth.test`, channel info/history PASS; chưa gửi tin nhắn. Bản cấu hình cũ mã hóa giữ riêng trong `.audit/flow07-app/`.
- Gmail/Jira OAuth `/start` đều HTTP 200; Google authorize URL tới được trang đăng nhập. Các kết quả này chưa chứng minh consent/token exchange thật thành công.
- Các file chuẩn bị bộ thu bằng chứng native được giữ trong scratch và hoãn lại khi có blocker callback; không đưa module chưa tích hợp vào PR sửa lỗi.
- Artifacts RED/GREEN/browser/native/SQL và output đầy đủ ở `.audit/flow07-app/`, không commit dữ liệu tài khoản, credential hoặc authorization input.
- **FLOW-07 OPEN:** còn consent/exchange thực trên bản vá, 18 lượt workflow native/provider readback, sáu persona qua app/history và review/CI đúng head nghiệm thu. DeepSeek planner 18/18 và oracle 36/36 đã có bằng chứng trước đó, không chạy lại hoặc phủ nhận trong phiên sửa callback.
