# JIRA-01 · Kiểm chứng khả thi OAuth Jira

**Trạng thái:** native identity OAuth và hai refresh đã quan sát thật 01/11; chờ xác nhận no-site của tài khoản thực dùng và nghiệm thu Jira nhiều site. Native gate NOT_COMPLETE. **Ủy quyền:** chủ dự án duyệt thiết kế và yêu cầu triển khai 31/10/2026.
**Thiết kế:** [Jira cá nhân/workspace](../../superpowers/specs/2026-10-30-jira-personal-workspaces-design.md).
**Kế hoạch:** [OAuth feasibility](../../superpowers/plans/2026-10-31-jira-oauth-feasibility.md).
**Vai trò:** Integration; chỉ package tool-adapters và tài liệu của task. Chưa sửa API/web/planner/executor/database.

## Mục tiêu

Có bộ probe local dùng OAuth thật, kiểm chứng identity trước khi có quyền site, cấp thêm site, token rotation và quyền native. HTTP fixture chứng minh bộ probe chạy đúng, không thay bằng chứng Atlassian. Không tạo issue/comment trong task này.

## Phạm vi và nghiệm thu

- [x] Client OAuth giới hạn endpoint, JSON token request, scope/identity/site parsing, timeout bằng AbortSignal và lỗi an toàn.
- [x] Session state một lần, ràng buộc browser, thế hệ kết nối; refresh dùng token mới, không hồi sinh sau disconnect.
- [x] CLI local 127.0.0.1:4187, cấu hình cục bộ ignored, hướng dẫn tạo app, report không có secret.
- [x] RED/GREEN và HTTP/process tests; package suite xanh; review độc lập đã chạy, findings sửa và kiểm hồi quy (chi tiết ở kết quả; chưa có CI/merge).
- [ ] Native identity-only bằng account chưa thuộc Jira site, có attestation của chủ tài khoản.
- [ ] Native existing-site và thêm site thứ hai; cấp scope và refresh được kiểm thật.
- [ ] Native quyền ADMINISTER và scope/read endpoints đủ bằng chứng; không lấy quyền hiển thị metadata làm bằng chứng write đã được thử.
- [ ] Facts và task/log ghi rõ DOCUMENTED/FIXTURE_VERIFIED/LIVE_OBSERVED/OPERATOR_ATTESTED/NOT_RUN.

## Cổng dừng

Nếu identity-only không đáp ứng onboarding, cần chủ dự án quyết ngoại lệ trước JIRA-02. Nếu chưa có app/credentials/consent/tài khoản phù hợp, hoàn tất tooling an toàn và ghi native NOT_RUN; không tự gán PASS hoặc vượt sang consumer.

## Kết quả

- Code commits: `7b4e2d4` client, `7a58219` session, `6a91183` runner, `b49334a` sửa review. Không thay runtime API/UI, migration, planner, executor hoặc bật cờ.
- `npm test -w @wap/tool-adapters` với sandbox env: **443/443 Vitest +31/31 Node PASS, exit 0**. Các Node case dùng HTTP loopback, code dùng một lần, rotation stateful, cookie/Origin, process CLI và response barriers thật.
- **12/12 mutation bị bắt**, trên các bản sao ignored; không sửa source để chạy mutation. Không đếm EPERM/missing-module như behavioral RED của guard.
- Independent review tại `6a91183`: 0 Critical, 2 Important/P2 (report giữ observations cũ; đếm duplicate site), 1 Minor/P3 (callback lỗi còn code trong URL). Parent tái hiện **23 pass/5 fail**, sửa → **28/28**, bổ sung ba kiểm tra race/error/close → **31/31**. Không có review lại ở head sau fix; không ghi verdict cũ thành review PASS cho head mới.
- CLI synthetic startup/Ctrl+C ở port 4197 đã quan sát listener đóng; PTY host exit 1 do interrupt, không tuyên bố Node exit 0. Không gọi provider trong smoke này.
- [Provider facts](../../ai-evidence/JIRA-01-PROVIDER-FACTS.md), [hướng dẫn app/cấu hình](../../../packages/tool-adapters/scripts/jira-probe/README.md), [log phiên](../log/2026-10-31-codex-jira-01-feasibility.md).
- Chủ dự án xác nhận chưa có app Atlassian và yêu cầu hướng dẫn tạo; đã có `.env.jira-probe` ignored, không in giá trị. Lần kiểm cuối báo thiếu Client ID/Secret. Native identity/no-site, thêm site, refresh và quyền thật đều **NOT_RUN**; không chuyển sang JIRA-02–11.
- `gh auth status` chưa đăng nhập; chưa push/mở PR, không merge. CI toàn repo và nghiệm thu model/live chưa chạy trong task tooling này.
- Tiếp tục 31/10: chủ dự án đã cập nhật cấu hình local và xác nhận có tài khoản chưa thuộc Jira site để thử. Native browser phát hiện hai lỗi khởi động: `no-referrer` làm form POST có Origin null; CSP thiếu host redirect đăng nhập chính thức. Đã tái hiện trước sửa, giữ Origin guard/callback no-referrer, cho phép đúng hai host Atlassian, và quan sát browser tới màn đăng nhập. Full package sau sửa **443 Vitest +32 Node PASS, exit 0**. Delta này chưa review độc lập; không nâng verdict review/CI hay đóng native gate. [Log](../log/2026-10-31-codex-jira-01-browser-origin.md).
- Tiếp tục 01/11: browser live có `CALLBACK_OBSERVED`, `connected: true`, `identity: true`, scopes `offline_access read:me`; hai lần bấm refresh tuần tự đều có `TOKEN_ROTATION_OBSERVED` và kết nối vẫn dùng được. Lưu ba snapshot report an toàn trong ignored local evidence trước khi đổi consent. Chưa suy ra no-site từ `siteCount: 0`; đã hỏi chủ tài khoản xác nhận account thực dùng. Chưa có Jira grant/site/permission/native write, không chuyển sang JIRA-02–11. [Log](../log/2026-11-01-codex-jira-01-native-identity.md).
- Xác nhận tiếp 01/11 (mới nhất): chủ tài khoản trả lời rõ account vừa consent chưa thuộc bất kỳ Jira site nào. Case identity-before-site có **LIVE_OBSERVED + OPERATOR_ATTESTED**; hai refresh identity vẫn đạt. Chủ dự án hiện chưa có test site, đang được hướng dẫn tạo site đầu tiên trên Jira Free. Chưa nghiệm thu một/hai site, quyền native hoặc grant model; gate tổng thể vẫn NOT_COMPLETE. Checklist/header ở trên chưa là biên bản reviewer đóng task.
