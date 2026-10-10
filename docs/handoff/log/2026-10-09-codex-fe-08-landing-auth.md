# FE-08 — Landing và xác thực

Ngày 09/10/2026. Task: [FE-08](../tasks/FE-08-landing-and-auth-screens.md). Nhánh `feat/fe-08-landing-auth`; worktree `C:/Users/VinhDat/orca/workspaces/ATI_Project/fe-08-landing-auth`; base `129d9c0b20f1d3afa087cdc0aec8383c381008f7`. Mã cuối `07ce40f203c1c14fb51e9a410ef9b8364fb511d8`. Check đầy đủ và review độc lập tại `f09d9d8a6b53dfb5fabc751bdad036bbdf5d2248` (production `aa57267dc46207d7a86fe618acf11ebea76720d8`); sau đó chỉ đổi fallback email tại `07ce40f`. Sau mã có một commit selector fixture-only; commit bàn giao cuối chỉ thêm Results/log. CI đúng head PR còn chờ parent; không merge.

## Thay đổi và phạm vi

Chép nguyên hai trang/CSS React, thay JS demo bằng auth/store/API; giữ class/font/màu và đường dẫn. Landing có 5 moment, stage desktop/fallback mobile/reduced-motion, nguyên tắc/8 dịch vụ/onboarding; route auth sử dụng modal nguồn. AuthAction dùng verify/resend/reset/Google/blocked states thật. API client chỉ bổ sung `Response` metadata cho public-auth/login và login ownership guard đã được parent duyệt; không đổi protected transport hoặc endpoint backend. `scripts/test-v3-browser.mjs` do parent thêm FE-08/FE-09 vào grep chung; include trong PR này theo thỏa thuận. Selectors login được cập nhật `exact: true` vì nút hiện mật khẩu cũng có tên chứa “Mật khẩu”; CTA/contrast/body-scope assertions theo nguồn mới, giữ coverage Back/Forward/cleanup/private flow. FE-09 sở hữu account/admin/history; hai bên đã thống nhất các helper login cùng file, không đổi private assertions.

- `apps/chat-web/src/components/AuthGate.tsx`
- `apps/chat-web/src/components/LoginView.tsx`
- `apps/chat-web/src/pages/AuthAction/AuthActionPage.tsx`
- `apps/chat-web/src/pages/AuthAction/page.css`
- `apps/chat-web/src/pages/Landing/LandingPage.tsx`
- `apps/chat-web/src/pages/Landing/page.css`
- `apps/chat-web/src/routes.ts`
- `apps/chat-web/src/services/api-client.ts`
- `apps/chat-web/src/views/ForgotPasswordView.tsx`
- `apps/chat-web/src/views/GoogleCallbackView.tsx`
- `apps/chat-web/src/views/LandingView.tsx`
- `apps/chat-web/src/views/ResetPasswordView.tsx`
- `apps/chat-web/src/views/SignupView.tsx`
- `apps/chat-web/src/views/VerifyEmailView.tsx`
- `apps/chat-web/tests/app-routing.test.tsx`
- `apps/chat-web/tests/auth-signup-reset.test.tsx`
- `apps/chat-web/tests/browser/auth-01-sessions.spec.ts`
- `apps/chat-web/tests/browser/auth-02-signup-reset.spec.ts`
- `apps/chat-web/tests/browser/auth-03-admin-users.spec.ts`
- `apps/chat-web/tests/browser/auth-04-google-login.spec.ts`
- `apps/chat-web/tests/browser/auth-05-account.spec.ts`
- `apps/chat-web/tests/browser/auth-05-google-actions.spec.ts`
- `apps/chat-web/tests/browser/fe-02-routing-history.spec.ts`
- `apps/chat-web/tests/browser/fe-03-readable-workflows.spec.ts`
- `apps/chat-web/tests/browser/fe-03b-new-conversation-race.spec.ts`
- `apps/chat-web/tests/browser/fe-04-shell-theme.spec.ts`
- `apps/chat-web/tests/browser/fe-04b-prototype-foundation.spec.ts`
- `apps/chat-web/tests/browser/fe-05-cockpit.spec.ts`
- `apps/chat-web/tests/browser/fe-05-regressions.spec.ts`
- `apps/chat-web/tests/browser/fe-05b-parity-a.spec.ts`
- `apps/chat-web/tests/browser/fe-05b-parity-b.spec.ts`
- `apps/chat-web/tests/browser/fe-06a-recovery.spec.ts`
- `apps/chat-web/tests/browser/fe-06b-responses.spec.ts`
- `apps/chat-web/tests/browser/fe-07-settings.spec.ts`
- `apps/chat-web/tests/browser/fe-08-landing-auth.spec.ts`
- `apps/chat-web/tests/browser/v3-sandbox.spec.ts`
- `apps/chat-web/tests/components/login-view.test.tsx`
- `apps/chat-web/tests/fe-04b-prototype-foundation.test.tsx`
- `apps/chat-web/tests/fe-08-landing-auth.test.tsx`
- `docs/superpowers/plans/2026-10-09-fe-08-landing-auth.md`
- `scripts/test-v3-browser.mjs`

Thêm tài liệu bàn giao: Results task card và file log này. Không sửa App, styles.css, AuthNav, prototype, backend, CURRENT-STATE/ROADMAP, user files hoặc root dependency/config.

## RED → GREEN và kiểm tra

Evidence root bền vững: `C:/Users/VinhDat/AppData/Local/Temp/ati-fe08-2026-10-09`. Toàn bộ packet sao chép khỏi `node_modules/.cache/fe08` và đối chiếu SHA256, giữ cache gốc; cài lại dependencies không xóa packet ngoài này. Sandbox PG16 tmpfs `ati-fe08-pg`, DB port56548, API3048, web5148, prototype5348. Mỗi trạng thái browser/visual được tạo qua HTTP/PostgreSQL/outbox thật. Chỉ dùng danh tính dữ liệu thử riêng; không ghi dịch vụ/model/live provider.

| Gate | Kết quả thực tế |
|---|---|
| Baseline focused đúng Vitest setup | `baseline-corrected.log`: 64/64 pass, exit 0 |
| RED trước port | `red-corrected.log`: 7 fail, exit 1 |
| RED login ownership | `red-login-race.log`: 2 fail qua deferred real Response body, exit 1 |
| RED theme control | `red-theme.log`: 1 fail, exit 1 |
| RED review đã sửa selector footer | `red-review-corrected.log`: 9 fail/10 skip, exit 1 |
| GREEN cuối sau copy fallback | `green-copy-final.log`: 76/76, 4 files, exit 0 tại `07ce40f` |
| Frontend TypeScript cuối | `typecheck-copy-final.log`: `npx tsc -p apps/chat-web/tsconfig.json --noEmit`, exit 0 |
| Full check | `check-review-final4.log`: `npm run check`, 1590 v3 + 173 evaluation; typecheck/build/security/launcher/native-env/OIDC 10; exit 0 tại `f09d9d8` |
| FE-08 focused browser default | `browser-review-focused.log`: 9 pass, 1 skip có chủ đích, exit 0 tại `f09d9d8` |
| FE-08 focused local OIDC Google | `browser-review-google.log`: 1/1 pass, exit 0 tại `f09d9d8` |
| Full canonical cuối | `browser-final-source.log`: `npm run test:browser:v3`, 88 pass, 11 scenarios,exit 0 tại `07ce40f`; default 1 skip được thực thi trong AUTH-04 |
| Visual cuối | 96 pairs / 192 PNG, 4 variants, 0 app horizontal overflow; real API/PG/local signed OIDC |

Canonical scenario counts: 70, 2, 6, 2, 2, 1, 1, 1, 1, 1, 1 = 88. AUTH-02/AUTH-04/AUTH-05 units/browser và các regressions còn nguyên coverage. Browser mới kiểm tra mật khẩu ngắn không gọi API, lockout thật đọc Retry-After và chạy đồng hồ, pending email cả đã/chưa xác minh/disabled, đúng opener header/hero/footer, primary heading, Google start thật bị giữ body tại browser boundary rồi đóng modal; phản hồi muộn không điều hướng/token.

Giữ cả output lỗi, không dùng lần pass để khẳng định nguyên nhân flake. Raw baseline đầu tiên dùng sai Vitest setup (`baseline.log`) và RED footer selector chưa đúng (`red-review-focus-google.log`) là harness/selector diagnostic, không dùng làm chứng minh baseline/RED chính. `check-final.log` có API memory stdout snapshot rỗng, focused unchanged 2/2 rồi `check-delivery.log` đầy đủ pass. Canonical lần1/2 dừng sau selector không strict và CTA/copy cũ; lần3 default68/69 fail expectation scope landing cũ; focused14/14 và lần4 `browser-delivery4.log` pass86/86 ở `6cb749b`. Các log đã giữ và lần cuối trên mã sửa review là88/88.

Check review lần1/typecheck fail2 vì test getByRole dùng option `exact` không hợp lệ, sửa test-only. Lần2 frontend612/613 với native HTTP Google first-enabled-action không tìm nút trong query deadline; giữ log và focused nguyên2/2 pass. Lần3 API memory readiness10s fail, frontend 613/613 pass; focused API nguyên2/2 pass, fresh fullcheck lần4 exit 0. Không chỉnh backend, timeout hay weaken query, không kết luận nguyên nhân từ một lần pass. `visual-review-extras-clock-fail.log`: capture-only prototype clock.pauseAt nhắm thời gian quá khứ; đổi clock fixture sang mốc tương lai cố định và capture lại exit 0, app source không đổi.

Sau check đầy đủ, parent duyệt đúng một copy-only fallback bỏ lặp “địa chỉ”; chạy lại76 focused+tsc và canonical88 trên `07ce40f`, chưa chạy fullcheck cục bộ tại chuỗi này. Parent sẽ xác nhận full CI trên commit PR chính xác, không suy ra CI từ gate local.


Follow-up fixture-only `219a0b790e7c3f544e59c726e0816dd5fe88188e`: parent đồng bộ một assertion AUTH-05 Google logout bằng OR CTA cũ/nguồn React với FE-09; token-null, real delayed-body và SQL guard giữ nguyên. `browser-final-auth05-compat.log`: 1/1 pass, exit 0 qua OIDC cục bộ thật. Production `07ce40f` không đổi; canonical88 trên source này và focused follow-up1 được parent chấp nhận, không lặp full canonical. Root merge-tree với FE-09 `5726cd27b43c1919ada03073eaaa6299fdeb54e9` exit 0.

## Review độc lập

Receipt `C:/Users/VinhDat/AppData/Local/Temp/ati-fe08-2026-10-09/independent-review-f09d9d8.json`, code verdict **PASS: không còn P1/P2/P3**; acceptance trong receipt vẫn pending refresh browser/visual/CI/docs. Reviewer chạy frontend 613/613, focused 76/76, probes 7/7. Phát hiện P2 mất focus khi close/Escape, P2 pending email gán trạng thái verification không có trong API, P3 thiếu active h1 đã có RED và sửa. Regression root Google CTA modal trước đây vô hình cũng đã sửa với real deferred Response và browser thật. Mutation controls của reviewer: bỏ focus restore2 fail + 4 pass, bỏ late Google closeguard1 fail, bỏ transport ownership2 fail, bỏ invalidation1 fail + 1 pass. Các mutant harness sai cú pháp/Proxy ban đầu bị loại, receipt ghi rõ.

Khôi phục focus giữ actual opener identity qua remount, chỉ explicit close arms restoration, không focus-steal với route tùy ý. Pending OAuth cũ giữ latch tới khi actual response settle để tránh hai start cạnh tranh; close invalidates navigation ngay, lần mở sau khi settle hoạt động. Parent duyệt copy cuối `07ce40f`; reviewer receipt source vẫn ghi f09d9d8, không gán lần chạy độc lập613 cho source sau copy.

## Đối chứng prototype và khác biệt được ghi nhận

CSS so bytes sau chuẩn hóa CRLF/LF, không sửa nguồn prototype:

- Landing `2e25b786a65b968c0215c3277ed8338faec378e5c63e27b4184702c50d44f78f`.
- AuthAction `06e5d83bdd984f391addf56c5f1e21f2eeaf20fb917ef2fe0530de96ae6df928`.

Manifest `C:/Users/VinhDat/AppData/Local/Temp/ati-fe08-2026-10-09/visual/manifest.json`, SHA256 `377ce13a7e8e443979bf5e71fec89139b62a6307d04c43985ea0081ab201b5eb`; `comparison.html` cùng thư mục đặt192ảnh thành96cặp. Viewports1440×900 và375×812, light/dark. Phases:88pairs ở aa57267/f09d9d8; sau copy chỉ4verify-success pairs cần chụp lại tại07ce40f; thêm8Google transfer/linked-ready pairs ở07ce40f. Case/sourcehead riêng có trong manifest;84views còn lại source-identical sau copy. Backup176ảnh trước review ở `visual-source-2107a69/`, backup176ảnh trước copy ở `visual-source-aa57267-pre-copy/`; giữ các packet gốc.

Manually inspected paired login/mobile hero trước review, verify-success1440light, pending375light, Google transfer/linked-ready375dark sau review. Google transfer layout trùng nguồn; spinner phase thay đổi theo thời điểm. Demo controls bỏ làm card/source scroll hint dịch vị trí; dữ liệu thật và alert làm card cao hơn. Không dùng ảnh để kết luận provider live. Reduced-motion nonsticky được assert trong browser thật, không chỉ suy ra ảnh.

- `landing-hero`: Prototype email-preview demo control removed.
- `landing-onboarding`: Email simulation button removed.
- `modal-login`: Demo blocked-login links, demo mailbox and quick-fill credentials removed; live form semantics/capabilities retained.
- `modal-signup`: Demo blocked-login links, demo mailbox and quick-fill credentials removed; live form semantics/capabilities retained.
- `modal-forgot`: Demo blocked-login links, demo mailbox and quick-fill credentials removed; live form semantics/capabilities retained.
- `verify-success`: Real API message retained; token response contains no user identity, so source prefix uses safe generic email fallback. Demo scenarios/tabs removed.
- `verify-combined-vs-verify-expired`: API returns invalid/used/expired together. App gives neutral combined reason and resend form; does not invent a distinct status.
- `verify-combined-vs-verify-used`: API returns invalid/used/expired together. App gives neutral combined reason and resend form; does not invent a distinct status.
- `reset-password`: Token response contains no email; safe generic identity.
- `blocked-pending`: ACCOUNT_PENDING does not reveal email verification state; step1 is neutral: verify only if not completed. This account completed real email verification; no administrator identity. Neutral chip wraps more tightly at375px without viewport overflow.
- `blocked-attempts`: Deadline from real API Retry-After rather than hardcoded 14:59; anonymous error alert is real.
- `google-pending`: Real local OIDC callback; no stored session while pending. API has no display name/email on failure.
- `google-error`: Callback query scrubbed before processing. Safe cancellation error replaces provider details.
- `modal-google-transfer`: App transfer is a real API start with response delivery held at the browser boundary only for capture; prototype demo timer paused. This image proves layout, not Google live provider acceptance.
- `google-ready-link`: Real local signed OIDC linking callback succeeds and preserves its session; app retains the required return-account action. Active Google login redirects immediately rather than adding the prototype fake wait.

Tất cả khác biệt còn lại phục vụ dữ liệu thật/semantics theo spec1.1. Email pending không suy ra đã/chưa verify; neutral chip quấn dòng chặt hơn ở375px nhưng không tràn viewport. Google pending biết provider verified. API verify gộp invalid/used/expired: ghi một lỗi trung tính; hai đối chứng prototype dùng/hết hạn là hai hình nguồn so cùng app combined, không phải hai trạng thái backend riêng. Token không trả identity nên generic fallback; alert/countdown là API; ready Google login chuyển ngay, linking giữ phiên và thêm success/return-account. Không hiển thị admin identity/quickfill/demo mailbox/scenarios.

Metadata pending description ban đầu còn câu cũ dù ảnh đã trung tính; đã sửa mô tả/HTML theo ảnh thực tế, giữ `manifest-before-pending-description-fix.json`. Không đổi ảnh/hash ảnh. Manifest cuối và bảng SHA ở đây dùng metadata đã sửa.

## SHA256 log chính

| File trong evidence root | SHA256 |
|---|---|
| `baseline-corrected.log` | `5cd678f7955951162576c0b6146bce17a870eb78a7cd5e985305d26b499f16db` |
| `red-corrected.log` | `6790e9d2adbffcb08e8a2d8cd17ec318abd0bde2e6f2e45cb825e5815a436f36` |
| `red-login-race.log` | `d0c30343050af77d1ea1108506562a797f913a55a6fcb1ec321ddf6ddb7089cd` |
| `red-theme.log` | `201b3b84fbdfa140e3aa50a717478f14e8247be2acb6af80cec3033e83d5a570` |
| `red-review-corrected.log` | `9618d43ecd25bcad4c9a1ef8b045b705da8f07ef50d054434eae34977a0fa2c8` |
| `green-copy-final.log` | `3adf3fca6e67b72e8d62cd2f4141f4b151206d66392f668deb970f31259ea25b` |
| `typecheck-copy-final.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `check-review-final4.log` | `9fd00b5147d3869f5e3b2c90117433c325e9dd73d6688eb244315f3453535f22` |
| `browser-review-focused.log` | `8821a495fe83800e20224bd9524ec572c550776bddad1c049fb5df41ad93d507` |
| `browser-review-google.log` | `f94938870ca4e9bb943a6a788b504d8a2f2f21f98602ceccc7159201f7d8f867` |
| `browser-final-source.log` | `b1b94f594d61fcca0436c2590cccdc2f1e01b0e13757f73daca13dac7d22ba56` |
| `visual-review.log` | `64e1106acd068996f82406dfda60b26d1fec8922f37156857346c6613f9e3f91` |
| `visual-review-copy.log` | `27513ad9bb436edaa7326406ff95967d01132ba3544aa0cc100f90ee3bb0dd3a` |
| `visual-review-extras.log` | `876c888def4bc602539dc1827a4f5f8764399954662cb295aa9c6eacd2d99b22` |
| `visual-review-extras-clock-fail.log` | `88b90f463e746853f9f275494f1f94940e9448605f930c8db4bcda298be3036d` |

| `browser-final-auth05-compat.log` | `76df5107b321f31ac273a8a5bbdbc3e77d9048aaa13b72b1f6fab57a963dfc06` |

## Ảnh và SHA256

Tên ảnh tương đối với `visual/`; thứ tự app/prototype luôn như bảng. Mỗi file đã đối chiếu manifest và bản sao ngoài node_modules; mọi app overflow=false.

| Variant / trạng thái | App file / SHA256 | React prototype file / SHA256 |
|---|---|---|
| 1440-light / landing-hero | `1440-light-landing-hero-app.png`<br>`05492c09f85af4d3a5781c6ed7c4385f1973121ed71c0c8462bedc5d723cd870` | `1440-light-landing-hero-prototype.png`<br>`4068e98ee66d872fcfe91e863c92d095d74912b935b4c1581839e964ba99d4fd` |
| 1440-light / landing-moment-1 | `1440-light-landing-moment-1-app.png`<br>`c1a43116dae2bf1e1a12bd993abfaa01d684caea48c9e353968f156330e55233` | `1440-light-landing-moment-1-prototype.png`<br>`6fd68fcfa7e027148433d40be1346384acf82fa36c6f0ad60e19ba695388acb0` |
| 1440-light / landing-moment-2 | `1440-light-landing-moment-2-app.png`<br>`d508c262784a1a2186076313ede3157e642c41908016be2dea2568e1ccb43352` | `1440-light-landing-moment-2-prototype.png`<br>`8659ec6ed0bffc79d479ac3eb96ffe2f56c6824f9f35b7072ff524826d26fdb8` |
| 1440-light / landing-moment-3 | `1440-light-landing-moment-3-app.png`<br>`e48f98757cdf2568d40f9c1877e40a268eac164832cd12a61b78610df90b571d` | `1440-light-landing-moment-3-prototype.png`<br>`e48f98757cdf2568d40f9c1877e40a268eac164832cd12a61b78610df90b571d` |
| 1440-light / landing-moment-4 | `1440-light-landing-moment-4-app.png`<br>`b1470e3669a542b57df9ff06cda078d97542dbe2e2c93374b86ba1cb53fb61b6` | `1440-light-landing-moment-4-prototype.png`<br>`95c2e2e2fbb7540cb0398563bebe2819a9bc7f583bec90672e5a539b5b8035a1` |
| 1440-light / landing-moment-5 | `1440-light-landing-moment-5-app.png`<br>`2a522a25fa696e6d1f7e6c3b79235ca5b98f4b834c5ce38f81dd8b18e987e3f9` | `1440-light-landing-moment-5-prototype.png`<br>`2a522a25fa696e6d1f7e6c3b79235ca5b98f4b834c5ce38f81dd8b18e987e3f9` |
| 1440-light / landing-principles | `1440-light-landing-principles-app.png`<br>`cb48b957975d954cf1b8f38431ca932986454d8aa9305d19edaf2dd8cba2d99d` | `1440-light-landing-principles-prototype.png`<br>`cb48b957975d954cf1b8f38431ca932986454d8aa9305d19edaf2dd8cba2d99d` |
| 1440-light / landing-integrations | `1440-light-landing-integrations-app.png`<br>`4dd16d4e98a798a17b9424c5f5a3daa3d99947e10a883a24f636a7d17d152b76` | `1440-light-landing-integrations-prototype.png`<br>`4dd16d4e98a798a17b9424c5f5a3daa3d99947e10a883a24f636a7d17d152b76` |
| 1440-light / landing-onboarding | `1440-light-landing-onboarding-app.png`<br>`62a4abca5ea50e38abdc94dcb0f67a0f001898b440277dfe264891cb384dff22` | `1440-light-landing-onboarding-prototype.png`<br>`415a8816fc30b7a66e67fc8eee2160276f3f06419c628ab8502c2c8a7067e498` |
| 1440-light / modal-login | `1440-light-modal-login-app.png`<br>`0b8bd4afd0f9e78741b8eb2fa35fa61aef7e14115b93b472fee16458c5c82235` | `1440-light-modal-login-prototype.png`<br>`907b180ae452d3fbf0d93ff2e1bf3ba5f4aaa1470ae1c796d1f31d2c07563139` |
| 1440-light / modal-signup | `1440-light-modal-signup-app.png`<br>`b58b1d7203877da5442503032be1894e32ae4f1ed3806a4e36510a99834d2c32` | `1440-light-modal-signup-prototype.png`<br>`a9191486883eacfa371d6eca9ff4f44fe26bcdb4cc3776acbc6b97a16d4e8967` |
| 1440-light / modal-forgot | `1440-light-modal-forgot-app.png`<br>`4db7188b2c0a1b41b75c663842c65438cf5910acca16aae24f9c74973c8d070c` | `1440-light-modal-forgot-prototype.png`<br>`fb30c88757583662fe6c7fb860270d7954ae5b085e6ab1f70dd75c98447dabb2` |
| 1440-light / verify-success | `1440-light-verify-success-app.png`<br>`49f07a0212218e1e0fb16ceff3b2f5ab24875cfcf73ba60a790150a42409660e` | `1440-light-verify-success-prototype.png`<br>`e4685d595662d6a07dae877a392941558034651ccbb0ba21798544dc0a333a31` |
| 1440-light / verify-combined-vs-verify-expired | `1440-light-verify-combined-vs-verify-expired-app.png`<br>`016f8651580b4ebdb05a3495743a2db2bdb54265987984858bd679c072676338` | `1440-light-verify-combined-vs-verify-expired-prototype.png`<br>`63e8267741e7b97952eece75d366c762328c05c8db7e100df6825967e06a5561` |
| 1440-light / verify-combined-vs-verify-used | `1440-light-verify-combined-vs-verify-used-app.png`<br>`016f8651580b4ebdb05a3495743a2db2bdb54265987984858bd679c072676338` | `1440-light-verify-combined-vs-verify-used-prototype.png`<br>`0bd6d33b642b8b230210d9cabcfa4cdcf72a18288b636f656cfacb4192db56f9` |
| 1440-light / reset-password | `1440-light-reset-password-app.png`<br>`be108fe78ce38cfe0fb2287c6bd24c07a3dce254a35bd22bcd871d00f7251b68` | `1440-light-reset-password-prototype.png`<br>`430b0f1bc0844f6dfe2e203e1e27a68a0c24a4aae80427fd78aba18f348b00d3` |
| 1440-light / reset-success | `1440-light-reset-success-app.png`<br>`83435152c02faefa2c7e293620bc5a79bbebe9ec34100ae4a96afa2a990c1b23` | `1440-light-reset-success-prototype.png`<br>`17b7ece3a2526bd2ef3bf29ef688042dba458d7054d2aa27bec47319d0e45264` |
| 1440-light / blocked-pending | `1440-light-blocked-pending-app.png`<br>`876a7184b20a5af80be660b273d2449b7a31c936f821238d23b487bca5be61fc` | `1440-light-blocked-pending-prototype.png`<br>`bb96aa87e467b7516c8f328ebe270bf21d0cc188ed4f977178523d06c5bee0e9` |
| 1440-light / blocked-locked | `1440-light-blocked-locked-app.png`<br>`8d0ed6a297a4d94ba7ceb9bf9e61c2bcb16e248d6bbcb43b44eefe663f1cf4cd` | `1440-light-blocked-locked-prototype.png`<br>`850bb6e53a486d5f130ecd2cab4cbadae2fe2496a580d341b022592a3db93d86` |
| 1440-light / blocked-attempts | `1440-light-blocked-attempts-app.png`<br>`0fcadbe96fa1b1121411092cba50c09732e6ab5e6499179d4e53e92aeb729b7f` | `1440-light-blocked-attempts-prototype.png`<br>`6e15c44f6fafd71c3efc56044445fad4cc71e412cc7c26ad5aaaf4f7e169190c` |
| 1440-light / google-pending | `1440-light-google-pending-app.png`<br>`d331970511a1069c4a41146e47ead889d4a69b6decd6a983e3fdfa550bb05af8` | `1440-light-google-pending-prototype.png`<br>`71e1fc9494bf153e7f05bddb326fef20939493536aceb4920bfe06410e1e8246` |
| 1440-light / google-error | `1440-light-google-error-app.png`<br>`b35c3a7cdb8acc32170cf68408b28c7608391dd5df77592ee2e5e4071626b42c` | `1440-light-google-error-prototype.png`<br>`904afd043d850dcf659ba0b12940cbe676b84961b8d5b2e6842410dc487ce6c0` |
| 1440-dark / landing-hero | `1440-dark-landing-hero-app.png`<br>`cd93969459b73be462fcb82fcafaad5389a7c0d9b0987b2a1c39815cf4fcee11` | `1440-dark-landing-hero-prototype.png`<br>`8ac356d8e0bc6db6fb7ef7789a1a267bec0f3f7460551cfeb53d98e46c9be450` |
| 1440-dark / landing-moment-1 | `1440-dark-landing-moment-1-app.png`<br>`c9f0a91386429e69a609a314579e2f8a87aa7e4532fa64719ee5a6f9909a19d5` | `1440-dark-landing-moment-1-prototype.png`<br>`0142ff485aef4d13cad072616cdf8a5e12c46a7b7a8737d3db4bd3e1d937f707` |
| 1440-dark / landing-moment-2 | `1440-dark-landing-moment-2-app.png`<br>`1557ec3d64643bf520b94dcb38b0b4943f23ea1ed894251b07ffd4ac3384d42c` | `1440-dark-landing-moment-2-prototype.png`<br>`20840aa41d3cd8369695fd3721bb1a8f819b4756edbc5e1780e56d69899cee95` |
| 1440-dark / landing-moment-3 | `1440-dark-landing-moment-3-app.png`<br>`90ad9309f9b8a1e577c1aa4478bf2f6839c94f8ceb6571fcbc6c7c7796f82efa` | `1440-dark-landing-moment-3-prototype.png`<br>`90ad9309f9b8a1e577c1aa4478bf2f6839c94f8ceb6571fcbc6c7c7796f82efa` |
| 1440-dark / landing-moment-4 | `1440-dark-landing-moment-4-app.png`<br>`6c8c283422df9e565cbc575bb44c4134e7b9cdb6557e7924a9f96cf5b3d621fa` | `1440-dark-landing-moment-4-prototype.png`<br>`abcc36f4f3df4083b2486a8f3cf8e51962fbdde2bd1fd2561c998247958a5de8` |
| 1440-dark / landing-moment-5 | `1440-dark-landing-moment-5-app.png`<br>`7cae2a8a35f12b0ad37b8986353f9b7ac062c97e636dbdd0904164f37e968331` | `1440-dark-landing-moment-5-prototype.png`<br>`7cae2a8a35f12b0ad37b8986353f9b7ac062c97e636dbdd0904164f37e968331` |
| 1440-dark / landing-principles | `1440-dark-landing-principles-app.png`<br>`a87091155a74ae9dd7a4628d98f25dcd8319011713b31600010edb65133ab7e3` | `1440-dark-landing-principles-prototype.png`<br>`a87091155a74ae9dd7a4628d98f25dcd8319011713b31600010edb65133ab7e3` |
| 1440-dark / landing-integrations | `1440-dark-landing-integrations-app.png`<br>`2a786b990a293db468d4cee8b0502f6a7b10719078b95ff5bf752b2ee63f0a37` | `1440-dark-landing-integrations-prototype.png`<br>`2a786b990a293db468d4cee8b0502f6a7b10719078b95ff5bf752b2ee63f0a37` |
| 1440-dark / landing-onboarding | `1440-dark-landing-onboarding-app.png`<br>`9f013e7e83c2b831bbcf385e642cbbaacd9125042088a84498d29f0e5ad82e7e` | `1440-dark-landing-onboarding-prototype.png`<br>`9f9120178e01ed8229e6571fe3341370a855d30e6eb46f4bd593e2bad21dda7d` |
| 1440-dark / modal-login | `1440-dark-modal-login-app.png`<br>`41a3b28c944a24b50c33db18434f2edd9cceede7b6e614ea0630b314c861fecb` | `1440-dark-modal-login-prototype.png`<br>`450b8a4e9aef02699a7c0e80ff7899135d6d7aefce8be902eecbbeb4860eec2d` |
| 1440-dark / modal-signup | `1440-dark-modal-signup-app.png`<br>`f1296b5225215e4b0e9062109624bd4f3aa61c57651b65d6a7281147391c5321` | `1440-dark-modal-signup-prototype.png`<br>`1bccb87acd4b98ad3f6119e25ab92b142b4c70e2481040c5858e329b5c493a31` |
| 1440-dark / modal-forgot | `1440-dark-modal-forgot-app.png`<br>`8842a57d91c1ee40b407c9df215dd27cdda0a2f02e82528ffe794b44c005f11d` | `1440-dark-modal-forgot-prototype.png`<br>`439654e30419f7b10b40f8223c51e5703d600cf1752624c1e2a02800d7a1dc09` |
| 1440-dark / verify-success | `1440-dark-verify-success-app.png`<br>`693262b6c76036dcfdae6b8489d347b131cbe72d28712bd56218fc2ca2f0993a` | `1440-dark-verify-success-prototype.png`<br>`d02544d2461150440a01cbdc184670bd5bf0b6894972e7c6603475f1b5f1c144` |
| 1440-dark / verify-combined-vs-verify-expired | `1440-dark-verify-combined-vs-verify-expired-app.png`<br>`1b1576384c4257004b6138115b8c262428b834d97cc565beb6360ad242508ba6` | `1440-dark-verify-combined-vs-verify-expired-prototype.png`<br>`ac20647baeea9b72ebad583123307ece59eefbee9d1c7b4eaeb0b27022b14672` |
| 1440-dark / verify-combined-vs-verify-used | `1440-dark-verify-combined-vs-verify-used-app.png`<br>`1b1576384c4257004b6138115b8c262428b834d97cc565beb6360ad242508ba6` | `1440-dark-verify-combined-vs-verify-used-prototype.png`<br>`cd7beb6c8ef2ae2c132884dc1e364f6ce6981b0bddc497a51cd6a3b338136e9d` |
| 1440-dark / reset-password | `1440-dark-reset-password-app.png`<br>`d3edd30262278618f106d2b7bd88962db64ff463639f5abc6e2da7af8874e1d8` | `1440-dark-reset-password-prototype.png`<br>`f94e3e2e00caac225f4534daa77dc389d98a47682c25be2d7e1a4be6e2e17138` |
| 1440-dark / reset-success | `1440-dark-reset-success-app.png`<br>`3ccc1e40ba10bfefe6146d5e28e3feefe2bf4237dfa4c648fd66f3f20b3db903` | `1440-dark-reset-success-prototype.png`<br>`bccec5e9579e6ab510c189cfba53746559567a232a2043d18edb39771f7cdc9a` |
| 1440-dark / blocked-pending | `1440-dark-blocked-pending-app.png`<br>`ba8332ac3fd6e4d4186172c5fbbf17fb0764952e7e7944c7e6761ad409901838` | `1440-dark-blocked-pending-prototype.png`<br>`9d13ea6481c8fffd5e5277ceb4c4dc17e42ac4a76133c5899878fa7d46ce5a19` |
| 1440-dark / blocked-locked | `1440-dark-blocked-locked-app.png`<br>`8dc242a72c5f38302059fe8707de76cc2913a4cbb94cdca94989b25255455f30` | `1440-dark-blocked-locked-prototype.png`<br>`d42cc8659b1e829c5eb6cedd71c934eb6ece2da97603b82c2725b14cbe642ac7` |
| 1440-dark / blocked-attempts | `1440-dark-blocked-attempts-app.png`<br>`586fe8b12444b7b2818615dcfcc42473d54e3e2614799d7383ff6cfb717925f3` | `1440-dark-blocked-attempts-prototype.png`<br>`5fd9a2f55fcd8aeadfe8447e632dea74c27d17d8f42b383972f28d0ff0b97b8d` |
| 1440-dark / google-pending | `1440-dark-google-pending-app.png`<br>`7ef7a9bfdad2cc0bce8d7a6fe557bbfefd3048110a392ffa7e1b346122c3ebb0` | `1440-dark-google-pending-prototype.png`<br>`05bd68d117818f1df53d21a8fe62010bef8ca07d2e9c0a4d048703cdde12a97d` |
| 1440-dark / google-error | `1440-dark-google-error-app.png`<br>`13e5550a16042657a777507868cd5846a53cc3c2ddcc6f5f14744562c08126a6` | `1440-dark-google-error-prototype.png`<br>`05ef408ee8ef9c38a09dbab7ab1ff1d52e84703fe91ef6d30611211728e6fc72` |
| 375-light / landing-hero | `375-light-landing-hero-app.png`<br>`35fbf6bf1601982d0b60450270d3930c5d590d3415cdd0317b9afe204fa98ad6` | `375-light-landing-hero-prototype.png`<br>`c92b15fe7e66501451fa7c646d9647ea967c0675fc33bb2e67f6481f00c839d8` |
| 375-light / landing-moment-1 | `375-light-landing-moment-1-app.png`<br>`e2883bf2c3b03772138c18761c42f9c09bbb9db017863e76b0cbc1ef56d40d30` | `375-light-landing-moment-1-prototype.png`<br>`e2883bf2c3b03772138c18761c42f9c09bbb9db017863e76b0cbc1ef56d40d30` |
| 375-light / landing-moment-2 | `375-light-landing-moment-2-app.png`<br>`8d0310f46a57511e0621f792602cf005aefad2d3eacd2eb544cc03ea00a97030` | `375-light-landing-moment-2-prototype.png`<br>`8d0310f46a57511e0621f792602cf005aefad2d3eacd2eb544cc03ea00a97030` |
| 375-light / landing-moment-3 | `375-light-landing-moment-3-app.png`<br>`71981ec5f25f2745916cb7544c801f1444af439063134dd9c5da58db23220b90` | `375-light-landing-moment-3-prototype.png`<br>`71981ec5f25f2745916cb7544c801f1444af439063134dd9c5da58db23220b90` |
| 375-light / landing-moment-4 | `375-light-landing-moment-4-app.png`<br>`76ac64913ca34a80aa350f5dccedb16367ec61a05393be848191966c573f1523` | `375-light-landing-moment-4-prototype.png`<br>`76ac64913ca34a80aa350f5dccedb16367ec61a05393be848191966c573f1523` |
| 375-light / landing-moment-5 | `375-light-landing-moment-5-app.png`<br>`eb7b1caa23bddd074d608da5fa00d5cfe956f8efd4080a70423f99edfd6a7b71` | `375-light-landing-moment-5-prototype.png`<br>`eb7b1caa23bddd074d608da5fa00d5cfe956f8efd4080a70423f99edfd6a7b71` |
| 375-light / landing-principles | `375-light-landing-principles-app.png`<br>`50455414ec66ff89da6e6dafb13d01a8cd3d5c45ae72c2e06a7a3501bf161238` | `375-light-landing-principles-prototype.png`<br>`76cd49ecd8c237e7b06a99a278a97ba0cc92be6a1a2720650d0704e4fcc6f5f0` |
| 375-light / landing-integrations | `375-light-landing-integrations-app.png`<br>`5dcfef5e41cd3ac462eb55203cfd90d14512a8aade321710da560ce5aa9bb18a` | `375-light-landing-integrations-prototype.png`<br>`4e25684eb02b5bcdc13fdc221f9f58b16141c11e861ac621adc7285882f962e0` |
| 375-light / landing-onboarding | `375-light-landing-onboarding-app.png`<br>`4b9cb543c86a3cc850983d7deb113e44609bf81840aea9a241ff8428ae5d3ff9` | `375-light-landing-onboarding-prototype.png`<br>`fa4c704d96089cc40be3a881bfc67211a2bd870f364a5ed51a38cff04bb769bf` |
| 375-light / modal-login | `375-light-modal-login-app.png`<br>`13e6ecad8eb0a1fac53134d921fed3815477b09c376e52b0e64587f9a36f19b8` | `375-light-modal-login-prototype.png`<br>`3b42300b65f7e1b9eb89f6bdd802d4d4201f9ce3808835120215ff83ef1a77e8` |
| 375-light / modal-signup | `375-light-modal-signup-app.png`<br>`0fabc409b04e06d82bf3d9a664e82daed90514c75b14fdd4231baaa061cb61f3` | `375-light-modal-signup-prototype.png`<br>`70a3ee878d021848e94074039d653054871eac345a89d5871194f17c3be88ae1` |
| 375-light / modal-forgot | `375-light-modal-forgot-app.png`<br>`37ebbc935e4e6d49bb43fc0632f2c00c100d2eb6a5c8cee4d17377bf0ecb8955` | `375-light-modal-forgot-prototype.png`<br>`cf0a0ca7e56a21ba6873410630914d75d22a70c1f05802bfaeac571b6947ee12` |
| 375-light / verify-success | `375-light-verify-success-app.png`<br>`31529514cfd4427e6f359aa6a12c56c91f299afea2b4d181ba1882c4e0557a84` | `375-light-verify-success-prototype.png`<br>`6f92c1e4b99923ac57b3c5b46ad4b34635ce8fbdadb112ea096001f8a33121ab` |
| 375-light / verify-combined-vs-verify-expired | `375-light-verify-combined-vs-verify-expired-app.png`<br>`6bbbed481c75faf240ba50cfc6e0f41912fe853fbbb7cee707db0fe5a57a1782` | `375-light-verify-combined-vs-verify-expired-prototype.png`<br>`1983f252d8fbb6921bc39b5f28fa8a2cdc77adf16dd3881bf2ea5db1e77a70a0` |
| 375-light / verify-combined-vs-verify-used | `375-light-verify-combined-vs-verify-used-app.png`<br>`6bbbed481c75faf240ba50cfc6e0f41912fe853fbbb7cee707db0fe5a57a1782` | `375-light-verify-combined-vs-verify-used-prototype.png`<br>`96873749cf6f610263e37aa2b723fdb7ced119bc0a87dd662e9b12738a6b41e3` |
| 375-light / reset-password | `375-light-reset-password-app.png`<br>`91abcaa8cb80f546ab3f1bb0026b2fd6215865f98bb0f3e8327304c1e6d4816c` | `375-light-reset-password-prototype.png`<br>`3e689243f3a3a1a4c91bf29883681a0cb3f5456fcea2c2b79ac1352037cec292` |
| 375-light / reset-success | `375-light-reset-success-app.png`<br>`a9e645daaed134546034155d8a24a5f019b83ae77a7b5c7b20db84d8f5c86fb8` | `375-light-reset-success-prototype.png`<br>`ad50ac81625a5a77386db5926ad840a0387f8eb72a1019d4d984b26a9255a2dd` |
| 375-light / blocked-pending | `375-light-blocked-pending-app.png`<br>`e66a7335cb3a1be1a740451cf1cb6242c6501998ae0dc7a22f1890b5cc00a149` | `375-light-blocked-pending-prototype.png`<br>`05d1b0b73b15017ac67bcceaae67857a0a266e0316de88a47e9ab972fe666608` |
| 375-light / blocked-locked | `375-light-blocked-locked-app.png`<br>`17346d8461a18d0ade1ce5a7b3eaffe469d3f6ed06d84a804d8bfc3485ef9d3c` | `375-light-blocked-locked-prototype.png`<br>`108b0e86fc4eb59aaa8d9a24e513b9549e642330a1dd842afee74dddcee20313` |
| 375-light / blocked-attempts | `375-light-blocked-attempts-app.png`<br>`adeda44a0491671a2b9bcb4fee086effcd60d95235fb85aa905062f1a4d10461` | `375-light-blocked-attempts-prototype.png`<br>`9e2d88dec3db78722ac15e77068cf0930972345afbc65e1ab47f20be77f35147` |
| 375-light / google-pending | `375-light-google-pending-app.png`<br>`32248ecdf1829bcdefa4b8340ee38dbfec039bb90ae35bb4fce8248868179412` | `375-light-google-pending-prototype.png`<br>`795b2fa90b2621d9c6a9a20c03da90dce8cd880d3712539d9a96c0e0ab114dc5` |
| 375-light / google-error | `375-light-google-error-app.png`<br>`a1d2515aba7ff59e3f60b2bac202f66e8b119ddc5b28b78765a14bd3dbb69753` | `375-light-google-error-prototype.png`<br>`2c2ecb959e29e7a202f407e61462f6f907a8b4c107af37934336ad1dc3e80fa5` |
| 375-dark / landing-hero | `375-dark-landing-hero-app.png`<br>`b587cd1ed02892a2bf814cd6497e2e821ed4228661f93da8b5c2028845bdd328` | `375-dark-landing-hero-prototype.png`<br>`e2f9cf778b0bc4bf66d2ed7ef481ec6cf121f9d54b4d9aefe850a079845f2db8` |
| 375-dark / landing-moment-1 | `375-dark-landing-moment-1-app.png`<br>`bf1678a3723c8b386a9e144180ffcefc5a472df298eeddf15b2e8081cd4b18ba` | `375-dark-landing-moment-1-prototype.png`<br>`bf1678a3723c8b386a9e144180ffcefc5a472df298eeddf15b2e8081cd4b18ba` |
| 375-dark / landing-moment-2 | `375-dark-landing-moment-2-app.png`<br>`281fb6cc33176437db5d37782cafc4cac16e8ea2885523f2bf95cacc67e155ed` | `375-dark-landing-moment-2-prototype.png`<br>`281fb6cc33176437db5d37782cafc4cac16e8ea2885523f2bf95cacc67e155ed` |
| 375-dark / landing-moment-3 | `375-dark-landing-moment-3-app.png`<br>`cfa54c83cba43d1ba8e7464d3011a87b8598f718f597b2c88086e913960dddf1` | `375-dark-landing-moment-3-prototype.png`<br>`cfa54c83cba43d1ba8e7464d3011a87b8598f718f597b2c88086e913960dddf1` |
| 375-dark / landing-moment-4 | `375-dark-landing-moment-4-app.png`<br>`f3a7b01d874ac7875e525a2c6e56c9b692b31acbf7b78dd0a7feeb06f594e014` | `375-dark-landing-moment-4-prototype.png`<br>`f3a7b01d874ac7875e525a2c6e56c9b692b31acbf7b78dd0a7feeb06f594e014` |
| 375-dark / landing-moment-5 | `375-dark-landing-moment-5-app.png`<br>`9510e40024f99bb5cc69f676f753f42a790f970e8bf3415d09cb26fb08b6b705` | `375-dark-landing-moment-5-prototype.png`<br>`9510e40024f99bb5cc69f676f753f42a790f970e8bf3415d09cb26fb08b6b705` |
| 375-dark / landing-principles | `375-dark-landing-principles-app.png`<br>`63ecb9565f67ceaa1ab32e8807548b232df92f87a332cc6b90456e19a9e57e2d` | `375-dark-landing-principles-prototype.png`<br>`c5999e2599d6c930558ef22949f25923066eeb597e67ec8d8badc332de75773d` |
| 375-dark / landing-integrations | `375-dark-landing-integrations-app.png`<br>`6f275795802f80d86a107c16c276e677a8d1e5bd78183222418f545e83ded310` | `375-dark-landing-integrations-prototype.png`<br>`94c05bc89d5a7a653773d7ea40578595bc0705acbff08ff9982437170e22fb73` |
| 375-dark / landing-onboarding | `375-dark-landing-onboarding-app.png`<br>`10ad086c50bf27222bec6701d5a4f5bd94aae8cda2c3627097736798807ce0c3` | `375-dark-landing-onboarding-prototype.png`<br>`48487ac97789d87d1e2ee4798d0d6698173de9987e9b03267a843c0bac8171df` |
| 375-dark / modal-login | `375-dark-modal-login-app.png`<br>`3920405b85a22451913086b2204316d28918a66ba15add168816ca251919fcc4` | `375-dark-modal-login-prototype.png`<br>`60f9b415cfd65a05bf16b570f11ad61e7bb8254ea2cef9b7f738a89c7e6058d5` |
| 375-dark / modal-signup | `375-dark-modal-signup-app.png`<br>`1086c8c0da6f28a1b19d16c9d8b9b2d76ed790ce2f87634d3721ded087578044` | `375-dark-modal-signup-prototype.png`<br>`c925c8b306df536174bb9e2a9b3bace384b43f8a3890ffc140cb190513af6f74` |
| 375-dark / modal-forgot | `375-dark-modal-forgot-app.png`<br>`005cf2577708fd1dba9b4329e76ff54759240aed7828799836d73fc7e55a130b` | `375-dark-modal-forgot-prototype.png`<br>`29f3e974ad5d82e4273d9b52577857e2d8d5ac53e9d9ce8eab003472d44a2880` |
| 375-dark / verify-success | `375-dark-verify-success-app.png`<br>`8c2d2f99ff30632971883ba9e74ac02dc9693db9c1f7f3dbd02441a4ff4e9043` | `375-dark-verify-success-prototype.png`<br>`1c6a6c936f3c7d2b321b79b1e9146173ead03efa38400bdc7cc340c3863cde61` |
| 375-dark / verify-combined-vs-verify-expired | `375-dark-verify-combined-vs-verify-expired-app.png`<br>`8f9b48dd8e1a303af86817b719e3ad3e397218e3f71faf700459594a999367ee` | `375-dark-verify-combined-vs-verify-expired-prototype.png`<br>`5efd5421a228bce24907154c21989122a052c73a49a5287e69cf7e60df38847d` |
| 375-dark / verify-combined-vs-verify-used | `375-dark-verify-combined-vs-verify-used-app.png`<br>`8f9b48dd8e1a303af86817b719e3ad3e397218e3f71faf700459594a999367ee` | `375-dark-verify-combined-vs-verify-used-prototype.png`<br>`0d3a2a6e4ec6e0a38003e728401693bdeb8bd3b35acd29d3675e00164d32b84f` |
| 375-dark / reset-password | `375-dark-reset-password-app.png`<br>`3dea57778d3e3c92916a37dfc26bc8f33188be3420520388d4a93c5758485e99` | `375-dark-reset-password-prototype.png`<br>`93a5996ed2568d137ced50d5b010a6035b1d01f0260b53486a62cc94ea14f7e5` |
| 375-dark / reset-success | `375-dark-reset-success-app.png`<br>`720346b2dedd3fc043c2aabf1a766ebc15478275b0572ea39fde9d53f2703fcb` | `375-dark-reset-success-prototype.png`<br>`2584eb797d303b9f8e48fe22cb93c3d35ce572ee0a2041f7f6b86f7cca9995fe` |
| 375-dark / blocked-pending | `375-dark-blocked-pending-app.png`<br>`1d9993bc16663f363d93a0a21c1f63b0d26d6ebaf3f4a69ac07fe6953473e62c` | `375-dark-blocked-pending-prototype.png`<br>`843db596b3d0ddf6893e6747db7ec6293e2d14db27381b56b9ca17ff5abc9b89` |
| 375-dark / blocked-locked | `375-dark-blocked-locked-app.png`<br>`f92a9d00ea1fe1d8dc0f88d0ecf4be9ee3f518ec8f96e42af0905cf5589fb4e3` | `375-dark-blocked-locked-prototype.png`<br>`7158e9d360b61b65b5afd4fd0021c76d385f07ff6cb93883f833d0d1e0cd0138` |
| 375-dark / blocked-attempts | `375-dark-blocked-attempts-app.png`<br>`3a92f1d03c5ed2c2aa6b04d094e5b8b5ebfa1029f8c84b9c57c3d91d48e593d0` | `375-dark-blocked-attempts-prototype.png`<br>`fa8a19148a34b98d713c7dd0312f7b1cccb2536c7859bc511c5af39ce95e0c12` |
| 375-dark / google-pending | `375-dark-google-pending-app.png`<br>`c5b887513fe866ef6fecd310188691fea3531b43bca2316ab166490bb75f5064` | `375-dark-google-pending-prototype.png`<br>`ee3f7894c9c68fbb1fadac84b04898b1c3bcdb93d142cd916c1fe6615485261e` |
| 375-dark / google-error | `375-dark-google-error-app.png`<br>`36c75e74be6e93b304fcd0bdcd1d3d3c59744765128f854e5347b8d4fea67d69` | `375-dark-google-error-prototype.png`<br>`5fd6b26abc5e1726beff22e02c5860190dcf2586013cf914648ebb1912a2fc67` |
| 1440-light / modal-google-transfer | `1440-light-modal-google-transfer-app.png`<br>`bbf2be5f758f7214ea0560a9b41557c85f7831ba6883830dfc9b485e8ab14169` | `1440-light-modal-google-transfer-prototype.png`<br>`52a037938630447690e52023b0f9beb5b03e61ac4a8251e7d3259fbd44c5e61e` |
| 1440-light / google-ready-link | `1440-light-google-ready-link-app.png`<br>`9c19ed34b4f95d4ccf3da16203d30dac78632233416aefad901643f409eb58a9` | `1440-light-google-ready-link-prototype.png`<br>`9b0d1b30c25beb64ae849098e4e35c9317f49d9c710465d8e46971782d905996` |
| 1440-dark / modal-google-transfer | `1440-dark-modal-google-transfer-app.png`<br>`e04c35f2ae7ab403c1d7fc27b20126b98100a8fc93d6ea9beaf6cc0d4ee76b68` | `1440-dark-modal-google-transfer-prototype.png`<br>`da7037faaa155df720a6f485cd27ad1dc5d7c80d0ab246de3bf3c52cc058b93d` |
| 1440-dark / google-ready-link | `1440-dark-google-ready-link-app.png`<br>`79cecba719ef8b1124eeb15480b8d04816139727fb467db609ec455cd4082c47` | `1440-dark-google-ready-link-prototype.png`<br>`2cb5c4f45e19ab343d101b9566f6ca2f92b1a5fa59fd1a0bd3cdd03238298125` |
| 375-light / modal-google-transfer | `375-light-modal-google-transfer-app.png`<br>`abbb7f88dea9496eda5ae486e3bb3539798e0b120a26e814f0cd05510894b1c0` | `375-light-modal-google-transfer-prototype.png`<br>`2ffcae22ca3b158a3956a0524cefecdaebfedc6b8522709aab384fb089139b95` |
| 375-light / google-ready-link | `375-light-google-ready-link-app.png`<br>`ff74650ff224dea25e9e49cbd20208606fc6f9602b805a19ef8b635a7bd48dae` | `375-light-google-ready-link-prototype.png`<br>`532a062a1589f25b4272387024aa7b09fd84a39da7bd2d3aa8e0aa743e63e5e5` |
| 375-dark / modal-google-transfer | `375-dark-modal-google-transfer-app.png`<br>`f7adf384d37bf0894608521e33c240faae0b0dd8fcf40277e46dd70983acce26` | `375-dark-modal-google-transfer-prototype.png`<br>`c6a83310a6d483aa536861b0c95638fefa761fe9f4a2229cb78d069e5710474e` |
| 375-dark / google-ready-link | `375-dark-google-ready-link-app.png`<br>`df8b39563d627d12f4d2806d24f6e154778ce675188a9d4b1980fb87beb9c50f` | `375-dark-google-ready-link-prototype.png`<br>`6d2df1f53c936840449f4397bd4ca941cb59053f632286ae85c5ca2d6920a6f1` |

## Chưa nghiệm thu ngoài phạm vi

Live SMTP/Google, ghi model/dịch vụ và backend token-state chi tiết chưa chạy trong FE-08. OIDC ký cục bộ xác nhận HTTP/PKCE/callback/UI, không thay live acceptance. API capability/transport contracts được giữ. FE-09 ở PR riêng; không suy ra account/admin/history parity từ FE-08. Parent kiểm tra CI đúng head, review tài liệu cuối và tạo PR; chỉ reviewer cập nhật CURRENT-STATE/ROADMAP sau merge.

## Tự review bổ sung ngày 09/10/2026

Theo yêu cầu chủ dự án, chính agent triển khai tự đọc lại ba diff FE-08, FE-09 và AUTH-07. Phát hiện **P2** trong FE-08: `AuthGate` chỉ render `blocked` khi route là `login`, nhưng route được bảo vệ vẫn hiển thị form đăng nhập tại URL gốc. Vì vậy đăng nhập tại `/c/:id`, `/account`, `/admin/users`, `/settings`, `/history` nhận pending/disabled/429 mà không có phản hồi hiển thị.

Sửa tại **6bf51de4d70401fd3e95046860e8047e8f9abb8c**: chọn màn blocked theo chính điều kiện route cần form login. Giữ URL gốc, copy trung tính, `Retry-After`, và ưu tiên phiên đã xác thực. Chỉ sửa AuthGate, thêm unit và browser regression; không đổi page markup/CSS, backend hay FE-09.

- RED: **15/15 fail**, exit 1 trên code trước sửa, đủ 3 phản hồi × 5 đường dẫn. GREEN focused: **81/81**, exit 0.
- `npm run check` trên nội dung source `6bf51de`: **1.605 v3** (47+340+212+25+353 API+628 web), **173 eval**, toàn bộ typecheck/build/security/launcher/env/OIDC đạt, exit 0.
- Canonical browser local tại `6bf51de`: **72 pass / 1 fail / 1 skip**, exit 1 ở default; các scenario sau **NOT_RUN**. Ba browser regression mới đều pass qua API/PostgreSQL thật (pending tại /history, disabled tại /account, 429 tại /c/private-deep-link).
- Failure duy nhất là FE-05 dark/375: thiếu receipt link, DOM báo “Không tải được trạng thái thực thi: Failed to fetch”. Giữ log, DOM và ảnh trong `self-review-fe05-receipt-failure/`. **Chưa chứng minh nguyên nhân**; không quy thành lỗi AuthGate hoặc khẳng định lỗi môi trường.
- Đối chứng giữ nguyên FE-05 test/source/timeout, `--repeat-each 3 --trace on`: **3/3 pass**, exit 0. Không sửa hay bỏ assertion để qua gate. CI của head bàn giao mới phải chạy đầy đủ check/browser; kết quả exact-head cập nhật trong PR, không lấy 72 pass làm canonical đạt.
- Tự review FE-09 tại `6c3e269`: **607/607 frontend**, exit 0. AUTH-07 tại `1792f12`: **368/368 API**, exit 0 trên PostgreSQL thật. Các lần chạy API trước bootstrap thất bại vì sandbox tmpfs thiếu role/schema sau restart, được giữ riêng và không tính gate.
- Năm CSS Landing/AuthAction/Account/Users/History khớp prototype từng byte. Hai page source FE-08 không đổi từ `1cbb056`; giữ bộ ảnh/manifest trước đó với provenance gốc. Không chụp lại bộ parity cho thay đổi route-only này.
- `git merge-tree --write-tree 6bf51de 6c3e269`: exit 0, tree `b50b6ccb0080051b747ac810df1d7f79bd7091e3`, không conflict; không tạo working merge.
- Đây là self review, reviewer repository vẫn duyệt trước merge. Không sửa CURRENT-STATE/ROADMAP hoặc các file đang sửa ở root.

Artifacts FE-08 dưới `C:/Users/VinhDat/AppData/Local/Temp/ati-fe08-2026-10-09/`:

| Log | SHA256 |
|---|---|
| `self-review-deep-links-red.log` | `B6220371301A843773B9B9298AD8793D407C343790F3992391CCDF09866EB5ED` |
| `self-review-deep-links-green.log` | `38657F46D8077AB15172B471B1E2EC56D9666B1BCFAB25D4DA2D165ABBDA5B94` |
| `self-review-check.log` | `2A3E2B01374DE813145C754C720B20F89449E19B30387DCD51905B52443D9114` |
| `self-review-browser.log` | `EB179999E04D711E80AC897147B6CA65445F6440A27F5BFCB27861B51B27F6EE` |
| `self-review-fe05-control.log` | `9802C4D747E80F4A62073F92C530A9EE622598118FA52D4EE9BBA7E3C6008D69` |

Các receipt `.exit` giữ mã thoát cho check/browser/control. FE-09: `C:/Users/VinhDat/orca/artifacts/fe-09/self-review-frontend.log`, SHA256 `44762A6DD0F2B997919419C9CE9888778DF2BFD8C518E49CEBDE1A7E5D2499B9`. AUTH-07: `C:/Users/VinhDat/AppData/Local/Temp/ati-auth07-2026-10-09/self-review-api-migrated.log`, SHA256 `70972951D30324E830CC6501BAED33C22AE4A4EA61F0DD97744CBF8BA38DC101`.
