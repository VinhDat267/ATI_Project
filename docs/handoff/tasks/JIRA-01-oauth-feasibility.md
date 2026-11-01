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

- Hai PR đã mở: [#229 thiết kế](https://github.com/VinhDat267/ATI_Project/pull/229) vào `main` và [#230 probe](https://github.com/VinhDat267/ATI_Project/pull/230) dựa trên nhánh thiết kế; diff tách 6 docs và 21 file JIRA-01. Reviewer nêu P3 ở checklist kế hoạch nói mọi response no-referrer dù GET `/` phải same-origin để form POST mang Origin; đã sửa mô tả, source không đổi. CI `v3` của hai PR đang chạy, chưa merge. [Log PR](../log/2026-11-01-codex-jira-01-stacked-prs.md).

- Audit chốt kỹ thuật 01/11 tại `a54a897`: reviewer độc lập không thấy P1–P3 mới trong probe và bằng chứng native; rerun package `npm test -w @wap/tool-adapters` **443 Vitest +32 Node PASS, exit 0**. `npm run check` từ workspace không có `.env` fail ở chat-api do không có PostgreSQL; thử lại với database `ati_v3_test` riêng vẫn fail vì suite cũ yêu cầu tên database `ati_v3`, public migrations và pool lớn. Không gọi full check/CI xanh. `gh auth status` chưa đăng nhập nên chưa thể push/PR/CI. Reviewer còn ghi một lỗi quy trình: diff nhánh hiện chứa cả JIRA-00 và JIRA-01; phải tách scope trước PR. [Log audit](../log/2026-11-01-codex-jira-01-final-audit.md).

- Ca tài khoản thứ hai 01/11: tài khoản được mời vào site B, sau đó đã xác nhận truy cập được Jira. Trên session OAuth cũ, consent bằng tài khoản này trả `ACCOUNT_CHANGED`, `connected: false`; sau ngắt phiên local, consent Jira thật bằng tài khoản thứ hai trả `connected: true`, `siteCount: 1`, `adminSiteCount: 0`, `permissionsRead: true`. Hai lần refresh riêng biệt đều ghi nhận rotation và giữ snapshot quyền/site. Bằng chứng safe trong ignored `.artifacts/jira-probe/2026-11-01-non-admin-and-two-refreshes.json`. Không suy ra quyền project/issue hoặc hoàn tất workspace approval. Native wrong-account và non-admin cases đã có LIVE_OBSERVED; gate tổng thể còn review độc lập/CI/đóng checklist bởi reviewer. [Log](../log/2026-11-01-codex-jira-01-native-non-admin.md).

- Khai báo dữ liệu 01/11: draft Yes theo thiết kế runtime tương lai bị chọn quá sớm; console yêu cầu xác nhận Personal Data Reporting API nhưng chưa có implementation. Đã đối chiếu source probe chỉ giữ accountId/token, không giữ profile name/email, và giải thích đã đính chính của Atlassian về bare accountId. Draft No chỉ cho diagnostic tối giản được chuẩn bị, rồi chủ dự án lưu Sharing within organization; đã xác minh console hiển thị No. Không xác nhận API giả. Runtime lưu thêm dữ liệu cá nhân phải xét lại Yes và reporting/refresh/erasure trước phát hành. [Log](../log/2026-11-01-codex-jira-01-data-declaration.md).

- Mới nhất 01/11, sau Accept site thứ hai: **hai Jira site đồng thời LIVE_OBSERVED** trong cùng process với site đầu tiên; `connected: true`, `siteCount: 2`, `adminSiteCount: 2`, identity/jiraAuthorization/permissionsRead true. Hai refresh mới đều đạt và account-match guard giữ nguyên danh tính. Đã lưu ba snapshot safe; refresh giữ resource snapshot từ consent, không tự gọi lại resources. Còn grant-model console, wrong-account/non-admin native và review/CI; chưa đóng task tổng thể. [Log hai site](../log/2026-11-01-codex-jira-01-native-two-sites.md).

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
- Tiếp tục với site đầu tiên 01/11: chủ dự án đã hiển thị Jira site truy cập được. Browser phát hiện consent UI nằm ở `api.atlassian.com`, ngoài hai host auth/login đã cho phép; thêm chính xác host này vào CSP sau RED, full package **443 Vitest +32 Node PASS, exit 0**, browser GREEN tới consent hợp lệ. Restart probe làm mất memory grant; bằng chứng identity/refresh cũ vẫn lưu riêng. Cancel một consent identity mới trả CONSENT_DENIED; đã mở Jira consent thật và đang chờ chủ dự án Accept. Chưa ghi site/permission PASS hoặc nâng verdict review/CI. [Log](../log/2026-11-01-codex-jira-01-consent-host.md).
- Sau Accept Jira 01/11 (mới nhất): reload trực tiếp tab callback xác nhận `connected: true`, `siteCount: 1`, `adminSiteCount: 1`, `identity/jiraAuthorization/permissionsRead: true`, đủ bốn scopes đã chốt. Hai lần refresh Jira riêng biệt đều thành công, guard token thay thế và account-match qua; lưu ba snapshot safe riêng. Còn site thứ hai đồng thời, console grant model, wrong-account và non-admin case; native write vẫn chưa thực hiện. Gate tổng thể NOT_COMPLETE, chưa sang JIRA-02–11. [Log](../log/2026-11-01-codex-jira-01-native-one-site.md).
