# FE-09 · Account, Users và History theo bản React

- Ngày: 09/10/2026, Asia/Saigon. Task: [FE-09](../tasks/FE-09-account-users-history.md).
- Worktree riêng: `C:/Users/VinhDat/orca/workspaces/ATI_Project/fe-09-account-users-history`; nhánh `feat/fe-09-account-users-history`.
- Base phụ thuộc: `1792f120ed02842cb57688d182867d8462333705`, `fix/auth-google-unlink-password`, [PR #120](https://github.com/VinhDat267/ATI_Project/pull/120). Backend kiểm mật khẩu thật nằm trong PR đó. Merge #120 trước, sau đó retarget PR FE-09 về main; không tự merge.
- Head tại gate: `b63d586ea945b4e26f5f219f403de0dc6b2b367c` (production `1b2ac12e11a1853e17142ee63284fae0e5d7e8cd`, commit sau chỉ sửa selectors browser của fixture mới). Parent phụ trách reviewer độc lập, PR tiếng Việt và exact-head CI. Chưa coi PR đang mở là đã nghiệm thu/merge.
- Head sau whitespace cleanup: `4ca2b700216edfb30ad8f9f4e19cd67906f93506`, chỉ xoá hai dòng space-only và một dòng trống EOF. Giữ CRLF của source/CSS theo `.gitattributes '* -text'`. `git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check fix/auth-google-unlink-password...HEAD` exit 0; không đổi hành vi.
- Head test compatibility cuối: `5726cd27b43c1919ada03073eaaa6299fdeb54e9`, khôi phục LF gốc của hai AUTH-05 browser specs và thống nhất ba login Email selectors `exact:true` với FE-08. Giữ assertion logout chấp nhận source header hoặc landing cũ để từng PR chạy độc lập; không đổi private assertions hoặc source ứng dụng. Parent chạy readonly merge-tree giữa FE-08 `219a0b790e7c3f544e59c726e0816dd5fe88188e` và FE-09 head này: exit 0, không conflict app/test/docs. Đây là bằng chứng ghép diff, không phải một working merge hoặc gate sản phẩm kết hợp.
- [Kế hoạch](../../superpowers/plans/2026-10-09-fe-09-account-users-history.md). Đã đọc AGENTS, CURRENT-STATE/README, ba log mới nhất, đặc tả frontend/v3 và team workflow. Checkout không có `.codegraph`; không tạo index. `npm ci` riêng; không dùng junction/build cache chung. FE-08 làm checkout khác; không sửa AuthGate, backend, schema, CURRENT-STATE hoặc ROADMAP.

## Thay đổi và ngoại lệ dữ liệu

Chép source JSX/classes/CSS của `Account`, `Users`, `History` từ bản React, nối API thật, bỏ demo; các route này sở hữu trang riêng thay AppShell. Giữ wrapper import cũ để bảo toàn regression. Ba CSS SHA256 bằng source byte-for-byte.

Account giữ draft tên khi response đến muộn, protected Google transport, mật khẩu mới 12–128 ký tự, thu hồi phiên thực tế, modal mật khẩu hiện tại để gỡ Google và lý do khóa gỡ khi chưa có mật khẩu. Không điểm bảo mật hoặc vị trí giả. Trạng thái xác minh lấy từ authenticated user vì AccountProfile không có trường đó; thiếu trường thì không tự khẳng định đã xác minh. Không khẳng định backend thu hồi riêng các phiên Google theo provider.

Users chỉ duyệt tài khoản đã xác minh, không mời/từ chối, dòng của chính mình không có thao tác; khóa/đổi vai trò có xác nhận. Hiện nguyên lỗi email 503 của API và giữ modal/retry. Counts lấy tổng thật từ server. Tab thành viên ghép trang active và disabled độc lập: mỗi stream 20, có thể 40 dòng; tiếp tục khi một stream còn trang, không ghi giả định 20 dòng/trang. Bỏ selector lọc vai trò vì API không hỗ trợ, theo đặc tả 1.1(2); vẫn giữ thao tác đổi vai trò.

History chỉ gọi API hội thoại của chính user, tìm tiêu đề, cursor, đổi tên Enter/Esc và mở `/c/:id`. Bỏ statistics demo, filter nhóm/trạng thái/công cụ, prompt/tool chips và receipts không được API hỗ trợ. Tiêu đề null có fallback `Hội thoại mới`. Response cũ không đóng editor/draft mới; đổi search/user không để busy kẹt. Focus trở lại nút đổi tên sau khi editor được React gỡ, thay vì gọi focus trước DOM commit.

UserNavMenu có hai props class tùy chọn được parent đồng ý; mặc định không đổi. Các trang FE-09 truyền classes avatar source và classes menu thực tế, tránh phụ thuộc CSS riêng Cockpit. Test keyboard/open-menu/viewport giữ hành vi menu.

Reviewer độc lập phát hiện P2: guard `.trim()` chặn mật khẩu hiện tại hợp lệ gồm 12 dấu cách dù change-password/login/unlink thật chấp nhận. Đã sửa thành kiểm tra chuỗi rỗng, giữ nguyên literal gửi API; vẫn giữ empty/max-length/masked/protected behavior. P3: meter vẫn hiện độ dài cũ sau khi response đổi mật khẩu thành công xoá input. Hook nay đồng bộ từ giá trị input sau conditional cleanup, giữ độ dài draft mới nếu user đã gõ trong lúc chờ. Cả hai có RED trước fix và GREEN; reviewer chạy probe 14/14 và mutants bỏ đồng bộ/đặt 0 vô điều kiện đều fail đúng hành vi. Review source ĐẠT qua `4ca2b700`, whole-frontend độc lập 607/607 tại `b63d586`, exit 0. Receipt `independent-review-4ca2b70.json` xác nhận không còn P1/P2/P3, kiểm riêng whitespace-only delta. Name/history/session-owner mutants trước đó cũng bị bắt. First meter probe dùng sai selector được giữ và loại khỏi bằng chứng; corrected probe mới cung cấp RED thật. Final canonical đã đạt bên author; reviewer không chạy lại canonical độc lập. Exact-head CI/PR/merge do parent xác nhận sau push.

## TDD và gate thực tế

Artifacts ngoài repo: `C:/Users/VinhDat/orca/artifacts/fe-09/`.

| Bước/lệnh | Kết quả | Log |
|---|---|---|
| `npm test -w @wap/chat-web -- tests/account-view.test.tsx tests/account-action-regressions.test.tsx tests/admin-users.test.tsx tests/app-routing.test.tsx` baseline | 35/35, exit 0 | `baseline-focused.log` |
| FE-09 page tests trước port | 3 fail, exit 1 → 3/3, exit 0 | `red-pages.log`, `green-pages.log` |
| API 503 message trước fix | 1 fail / 3 pass, exit 1 | `red-503.log` |
| Deferred search/name busy và null title trước fix | 3 fail / 4 pass → 7/7, exit 0 | `red-async-title.log`, `green-async-title.log` |
| Avatar/menu source classes trước fix | 1 fail / 7 pass → 22/22 gồm UserNavMenu/FE-04 regressions, exit 0 | `red-avatar-menu.log`, `green-avatar-menu.log` |
| Role-filter omission/paging trước fix | 1 fail / 8 pass → 18/18 gồm admin regressions, exit 0 | `red-role-filter-pagination.log`, `green-role-filter-pagination.log` |
| Focus sau Esc trước fix | 1 fail / 8 pass → 9/9, exit 0; Enter cũng trả focus | `red-history-focus.log`, `green-history-focus.log` |
| AUTH-07 caller mask/clear/cancel/empty, account/draft regressions | 27/27, exit 0 | `green-auth07-rebased.log` |
| `npx playwright test --config apps/chat-web/playwright.config.ts --grep 'FE-09:'` trước hai fix review | 4/4, exit 0 | `browser-focused-final.log` |
| Native no-email backend HTTP 503 + menus | 2/2, exit 0 | `browser-real-503-and-menu.log` |
| Focused AUTH-03/AUTH-05 account + FE-09 trước refinements | 5/5, exit 0 | `browser-focused-regressions.log` |
| Literal current password trước fix | Unit 1 fail / 9 pass → focused 30/30, exit 0; HTTP/PostgreSQL browser 1 fail → 1/1, exit 0 | `red-legacy-password.log`, `green-legacy-password.log`, `red-legacy-password-browser.log`, `green-legacy-password-browser.log` |
| Password meter clear/newer draft trước fix | 1 fail / 11 pass, exit 1 → focused account/draft/FE-09 32/32, exit 0 | `red-password-length-meter.log`, `green-password-length-meter.log` |
| `npx playwright test --config apps/chat-web/playwright.config.ts --grep 'FE-09:'` cuối tại `4ca2b700` | 6/6, exit 0 (21,0s), gồm literal unlink, meter clear/newer draft với real HTTP/PostgreSQL | `browser-focused-review-final.log` |
| Review độc lập source qua `4ca2b700` | Frontend 607/607, probe 14/14, exit 0; omit-sync mutant 1 fail / 1 skip và unconditional-zero mutant 1 fail / 1 pass / 10 skip, exit 1 | `independent-frontend-b63d586.log`, `independent-meter-fixed-1b2ac12.log`, `independent-mutant-meter-omit.log`, `independent-mutant-meter-zero.log`, `independent-review-4ca2b70.json` |
| FE-04 private shell assertion ở source History | 1 fail trước adaptation → 1/1, exit 0; giữ theme/keyboard/runtime-warning trên Cockpit | `browser-fe04-shell-before-adaptation.log`, `browser-fe04-shell-adapted.log` |
| `npm run check` tại head gate cuối | 1.599 v3 = 47+340+212+25+368 API+607 web, 173 eval; typecheck/build/security/launcher 1/env-OIDC 10, exit 0 | `check-final.log` |
| `npm run test:browser:v3` trước hai fix review | 82/82 trong 11 groups, exit 0 tại `d8a87999fd45080dd63fa04d3fdbe8f0675a491e` | `browser-before-legacy-password-review-fix.log` |
| `npm run test:browser:v3` cuối tại `5726cd27b43c1919ada03073eaaa6299fdeb54e9` | 84/84 trong 11 groups, exit 0, lần final đầu tiên: 67 default + 2 AUTH-02 + 5 AUTH-04 + 2 clarification + 2 partial_failure + 6 service groups × 1 | `browser-final.log` |

503 browser chạy createApp thật, UserRepo/AdminUserRepo thật và PostgreSQL sandbox; chỉ bỏ emailSender ở fixture native. Browser chuyển tiếp response HTTP thực tế, xác nhận code `APPROVAL_EMAIL_UNAVAILABLE`, lỗi hiện đúng, retry trả 503 lần hai và SQL status vẫn pending. Không tự chế body 503. Deferred browser PATCH dùng route.fetch thật, giữ response rồi thả; GET API chứng minh title đã lưu trong khi input còn draft mới.

Lỗi setup giữ riêng: baseline sai config/root trước khi sửa workspace command; browser fixture ban đầu mong creation nhận title dù API tạo untitled và cleanup vướng FK; đã seed bằng PATCH thật và xóa conversations trước users. Native static createApp import ban đầu khiến frontend noUnusedLocals kiểm các file backend chưa đổi; runtime loading tách compiler scope, hai tsconfig vẫn chạy trong full gate. `check-final-static-import-failure.log` không được tính là PASS. Capture lặp đã chạm rate limit signup; restart runtime sandbox rồi mới capture thành công, không bỏ qua 429. Các packet trước fix được giữ nguyên.

## Visual và bootstrap review

`visual/comparison.html` đặt app/source cạnh nhau. `visual/manifest.json`, `visual/SHA256SUMS.txt` có 40 PNG: 12 cặp bắt buộc cho ba trang ở 1440×900 và 375×812 sáng/tối, bốn cặp Users members bổ sung và tám ảnh menu mở. App và menu không vượt viewport. Đã xem các cặp desktop/mobile và menu; không tuyên bố pixel-equal với dataset demo.

Capture Account/History tại `97a76fe`, Users refresh tại `77fd367`; các fix sau đó về focus Enter/Esc, literal current password và meter sau đổi mật khẩu không đổi trạng thái ban đầu đã chụp. Page classes/CSS giữ nguyên. Manifest chứa head cuối, SHA nguồn app và khác biệt hợp lệ: tên/email/ngày/session/count/status thật, quyền/nav thật, bỏ demo/unsupported UI, session không vị trí, không điểm bảo mật, không role selection khi approve. Ảnh không commit. Hash manifest tại head gate: `3882bfd749f19d0e5346474aa2a81fa3a3eab3bf289354c149c31e7264cd57b0`.

CSS source/app:

| Trang | SHA256 cả source và app |
|---|---|
| Account | `49891e78d5f0ba8580630c320fa0944d5d492402b880effc9b238c4c082d75dd` |
| Users | `b55ded33a4a7234584d3119f19b2ab67f8c8311d0ccf342c8ef93d779b6d5584` |
| History | `e97da6b10f651f0f0af4102f8491ccf065870561d9996630eab3f073f66669b6` |

DB review giữ lại: PostgreSQL 16 `ati-fe09-pg`, tmpfs, bind `127.0.0.1:56549`, database riêng `ati_v3`. Port 55549 nằm trong excluded range Windows nên dùng 56549. API/web/prototype `3049/5149/5349` dừng sau capture/gates; không dừng container của task khác. Bootstrap fixture ngoài repo: dot-source `C:/Users/VinhDat/orca/artifacts/fe-09/env.ps1` từ checkout review riêng rồi `npm ci`, `npm run check`; canonical browser phải phối hợp slot. Không đọc/copy `.env` thật, không gọi SMTP/Google/model/dịch vụ live. Signup/verify/approve/title screenshot fixtures dùng API thật và outbox sandbox; cleanup chỉ fixtures của capture.

## Danh sách ảnh và SHA256

| PNG | SHA256 |
|---|---|
| `account-1440x900-light-app.png` | `113f7a785cc7010d40fcc49cd79f142e20547d6036829f4ea7566c7909f023b6` |
| `account-1440x900-light-menu.png` | `e498d430f2437ec0cdc7978b2dacc6daeca4c5d9c241229bfe6a2b436fe60aa6` |
| `account-1440x900-light-prototype.png` | `c8c0d54c2a6e30bf3efe1976defccadc9736793c46b4e51909609087a9033b23` |
| `history-1440x900-light-app.png` | `ada78cc561eba98e9d8a8df0447974afbd0b49bcc02a82ee8908c6cd872994a6` |
| `history-1440x900-light-prototype.png` | `f7db48b5531d5e9a3456e0231639a1f228fc8a84aed987c4b9d7547c6c8acf3d` |
| `account-1440x900-dark-app.png` | `925bf5450651b28ba1c79f0eafd3292b7c6e9efea5ce73f297787f66b33bfec3` |
| `account-1440x900-dark-menu.png` | `8871ca7435e4117fe9e043d1ff642123327dacd8b09d1e03fe277842ab2905b7` |
| `account-1440x900-dark-prototype.png` | `5f2211c9ab503ef898921d841c30eedf581980f47947e35b2096a43bf95f47e0` |
| `history-1440x900-dark-app.png` | `21ceed24e8d1c79cf74d6c14365eb082c92365cc871998fd7ba67ce9b8db76fa` |
| `history-1440x900-dark-prototype.png` | `2b1e0720d1750af0e057a85dad2c1f9be8b66faaf7706b5c8185d6c56e866d7e` |
| `account-375x812-light-app.png` | `819fb8eb7b16d8975c5f3f1d912880a3a62998757e98c07bc1a6ec2c877a5849` |
| `account-375x812-light-menu.png` | `a213115097937acfc2fbb28a45d92cb6bfa33325bfbb428c172e13f92aa895fc` |
| `account-375x812-light-prototype.png` | `18b25a20997e40471b26b507315bf2c748578bb4a0c72bdf8968f4c4205b24c0` |
| `history-375x812-light-app.png` | `ecbe554a088930d268356b2dfc6fe778ee7b01a5202cb56d4956510afc599132` |
| `history-375x812-light-prototype.png` | `4b67b2ee46c9faa1b1affd376b9409255c02a63ffc70af799b23661be89bec7c` |
| `account-375x812-dark-app.png` | `461e86e88bb38b495d876bbe13e3d8f0337d2b6e81df4d65e102c704c58096c5` |
| `account-375x812-dark-menu.png` | `3bcf6fabab491cb0050dcf56ec8d11a568c534213a3cb03b2ca21cd254849b06` |
| `account-375x812-dark-prototype.png` | `18db1f1ef3a6411d297906a535971177a056288a9d5e44ca55d9ee6ecc3f8f86` |
| `history-375x812-dark-app.png` | `757a3357f8ccbf675114314103b6f3f886db91be83a2bb64b679035999b48503` |
| `history-375x812-dark-prototype.png` | `6ce117d6909cddf7e33c4ca0b7a9bf0148aec70c10d623d3b797f9db7ca4e1b8` |
| `users-1440x900-light-app.png` | `3e94f585bc78a636c98310850fc10e45595bf4b8de7a2ba201cc0144deb5e6df` |
| `users-1440x900-light-prototype.png` | `96783878560fad730f4115aede5bb37a57482df107bd7f2de2ec598fd7928a86` |
| `users-members-1440x900-light-app.png` | `54668f7d2c8366595107300c935712b5a05af54b90d08803f293f1c0ba3df480` |
| `users-1440x900-light-menu.png` | `cf6b50e7fd45769f564f808429dc951abad57cf70fda36665d8c65750d142123` |
| `users-members-1440x900-light-prototype.png` | `498bf659d50618c2929ff94c807382da97639ccaf299d4cea42814cae60afa18` |
| `users-1440x900-dark-app.png` | `2a13cc326e6a7f3b3239e463853eabe531218698beb91abf8a941a0d47ca7485` |
| `users-1440x900-dark-prototype.png` | `9d019979ff363dce23eee4993c9e16834792eeb37d4ba9d23aebb725e62a7385` |
| `users-members-1440x900-dark-app.png` | `966d88edd4b9a3fa527cb3f026f6e283ce33a1c5ecec89ca2ae42566b17d0d01` |
| `users-1440x900-dark-menu.png` | `4a7d5e61a116595fed33a3836711b4eaf1d71dd66ef02dcd6275ede95c256085` |
| `users-members-1440x900-dark-prototype.png` | `4ca4c49db10c9748c8f23f3118ab426f3bce715c3be165d2d5dc955e242fedf6` |
| `users-375x812-light-app.png` | `934b9c39273c352f7a3db8b24bd4a6d41c174c2c71920e3bf1ab1bc6d1429b9f` |
| `users-375x812-light-prototype.png` | `07f51350050a935c6f24a28f8056516eb1306d9bb801857c5f8979b384c15158` |
| `users-members-375x812-light-app.png` | `d440060be44de193edcd98c882196692aca5f14c9a90b5d72acb041a36f41857` |
| `users-375x812-light-menu.png` | `2d4df6367712675cd3ff459659a25ace632c85acb41fc034752f9a01476a05b3` |
| `users-members-375x812-light-prototype.png` | `af7e00f6f237e9df2bf73b707bd25ad98a06f84fb6f6f3cd3c297b83668248e2` |
| `users-375x812-dark-app.png` | `80c3b825fe5b3d49192c4b0f00f2f33200f1f822ebaaa5b3f4a4797f4132a299` |
| `users-375x812-dark-prototype.png` | `d19157fffa0e81d1a20bc4a235ff316523bbffb9c0e4f374c1b14c48844eaff2` |
| `users-members-375x812-dark-app.png` | `edbc5f21711dbf694e5ed39514da94af773422fd57f9aaed469a692596ffc1f5` |
| `users-375x812-dark-menu.png` | `b31f622b22c057eace9623ae64be2ae4f69e071ccf7a4c70730870a0f7faadba` |
| `users-members-375x812-dark-prototype.png` | `60a7f1220df2b6db14a2778ff107ba3b424033cdfc0c7f7a45df83c1647d6b16` |
