# FE-06B · từ chối, hỏi lại và lỗi chung

Ngày bàn giao: 09/10/2026. Task: [FE-06](../tasks/FE-06-cockpit-recovery-and-responses.md), chỉ mục 5–7.

## Phạm vi và trạng thái

- Nhánh: `feat/fe-06-cockpit-responses-b`.
- Worktree: `C:/Users/VinhDat/orca/workspaces/ATI_Project/fe-06-cockpit-responses-b`.
- Base main: `e269743859d6096eedafa4ea156c17b5770b3638`.
- Code head đã kiểm tra: `85d9bbe228f547125d04d754e402184288fa6669`; commit bàn giao chỉ bổ sung Result/log.
- Commits code: `03ed114` port Responses/Errors; `da07d35` nhận dạng câu Liệt kê tiếng Việt; `7e19e5a` sửa history ownership/selection, cập nhật assertion browser FE-05 và LF; `85d9bbe` xử lý snapshot về trước history.
- Local checks và review agent độc lập đạt. CI phải kiểm đúng head của PR sau commit bàn giao; reviewer repository chưa nghiệm thu, chưa merge. Không sửa CURRENT-STATE/ROADMAP.
- Main workspace có thay đổi của người dùng tại `.gitignore`, `PRODUCT.md`, `docs/reports/`, `skills-lock.json`; làm trong worktree riêng và không sửa các nội dung đó.
- W3-10 [#102](https://github.com/VinhDat267/ATI_Project/pull/102) được kiểm tra bằng `gh pr view`: OPEN, mergedAt=null ngày 09/10. Không đổi planner/backend/executor hoặc policy read-only.

## Hành vi và files

- `pages/Responses/ResponseMoment.tsx`, `page.css`: 4 tình huống từ React Responses. Refusal giữ reason/suggestion/unavailableServices từ SSE hoặc history, fallback dữ liệu cũ. Service trạng thái theo API; admin link tới một dịch vụ hoặc trang chung, member chỉ hướng dẫn liên hệ admin. Edit/suggestion chỉ điền ô nhập. Clarification dùng options/context planner, chọn bằng chuột/phím và xác nhận; destination đã chọn có dấu hiệu hiển thị. Có NoWritesNotice trên cả clarification thông thường.
- `pages/Errors/PlanningErrors.tsx`, `page.css`: offline banner, slow planning và server planning failure từ React Errors. Không có promise đồng bộ/lưu nháp, fake percentage/step/cause hoặc error code tự đặt. Retry planning chỉ gửi lại câu gốc; không retry execution write.
- `hooks/use-network-status.ts`, `use-sse.ts`: browser offline/online; retry GET health và reconnect stream, abort stream cũ và nhận token hiện tại. Thử lại kết nối là read-only, không resubmit message/recovery.
- `hooks/use-planning-wait.ts`, `Cockpit.tsx`: đếm từ startedAt thực của pending owner, chỉ hiện slow khi quá 15.000 ms; gatherState thật. Thôi chờ là dismiss UI, giữ pending lock và câu gốc; plan tới muộn còn preview/chờ duyệt. Không nhận response của hội thoại A vào B.
- `hooks/use-conversation-history.ts`, `store/chat-store.ts`, `types.ts`: giữ metadata response qua reload; latest clarification/refusal/planning_error giữ stage khi snapshot terminal cũ về trước hoặc sau history. Snapshot vẫn lưu, unknown/failed vẫn ưu tiên. Giữ guard messages/revision/isPlanning chống ghi đè owner mới hơn.
- `AuthGate.tsx`: session loss về `/login` với thông báo hết hạn, logout chủ động không có thông báo hết hạn. `Workspace.tsx`: capability canConfigure từ API và banner retry; HTTP planning error có metadata chuẩn.
- `ChatComposer.tsx`, `ClarificationMoment.tsx`: footer Responses/nút cam lấy từ mẫu, một textarea chung, Edit focus và multiline/draft hiện hữu; NoWritesNotice cho màn hỏi lại thường.
- Tests mới: `fe-06b-responses.test.tsx`, `fe-06b-errors.test.tsx`, `browser/fe-06b-responses.spec.ts`. Giữ các ca cũ `fe-05-cockpit`, `fe-05-regressions`, `sse-auth-reconnect`; copy lỗi planning trên stage đổi sang câu hệ thống, raw error vẫn ở conversation log. `scripts/test-v3-browser.mjs` đưa FE-06B vào default grep.
- Task Result và duy nhất log này là phần bàn giao có commit. Artifacts nằm trong `node_modules/.cache/fe06b/`, không commit.

## Bằng chứng TDD

Baseline frontend: 54 files / 567 tests, exit 0 (`baseline.log`). API/transport là boundary mock; store, SSE handler, component, timeout và AbortSignal là code thật.

| Log trong `.cache/fe06b/` | RED trước sửa |
|---|---|
| `red-responses.log` | 10 failed, 1 passed: metadata/role link/expanded responses/slow planning/general error |
| `red-errors.log` | 2 failed: offline banner và expiry notice |
| `red-reconnect.log` | 1 failed, 6 skipped khi bỏ reconnect; test HTTP thật kiểm abort stream cũ và mở stream mới |
| `red-response-composer.log` | 1 browser failed: button nền `rgb(23,23,23)` thay vì `rgb(255,87,1)` |
| `red-vietnamese.log` | 1 failed, 11 skipped: Unicode word boundary không nhận Liệt kê |
| `red-review.log` | 4 failed, 14 passed: 3 response types bị completed receipt cũ che và thiếu visible destination selection |
| `red-review-snapshot-first.log` | 3 failed, 20 passed: snapshot về trước history che clarification/error và còn activePlan cũ ở refusal |

GREEN cuối `green-review-snapshot-first.log`: 5 files / **75 passed, exit 0**. Có cả history-snapshot-race cũ; regression mới dùng deferred API reads và real refreshExecutionSnapshot, kiểm hai thứ tự response/snapshot. Negative controls unknown/failed giữ moment8/7 trong cả hai thứ tự. Thôi chờ kiểm khóa request và plan muộn cần duyệt, không mock một boolean phê duyệt.

## Kiểm tra cuối trên code head 85d9bbe

`npm run check`: **exit 0**, log `check-delivery.log`.

| Nhóm | Kết quả |
|---|---:|
| tool-schemas | 47 passed |
| tool-adapters | 340 passed |
| planner | 200 passed |
| executor | 25 passed |
| chat-api | 353 passed |
| chat-web | 593 passed, 56 files |
| v3 tổng | **1.558 passed** |
| evaluations | **165 passed** |
| typecheck / production build / build security | exit 0 |
| launcher / local-env + OIDC helpers | 1 + 10 passed |

`npm run test:browser:v3`: **exit 0**, log `browser-delivery.log`. **78/78** qua 11 scenarios, PostgreSQL 16 tmpfs riêng `ati-fe06b-test-pg` tại `127.0.0.1:55533`, không dùng dev DB 15433. Node 24.19.0 / Chromium Playwright.

| Scenario | Passed |
|---|---:|
| default (gồm FE-06B 5 tests) | 61 |
| auth02 | 2 |
| auth04 | 5 |
| clarification | 2 |
| partial_failure | 2 |
| three_service | 1 |
| sheets_slack | 1 |
| calendar_slack | 1 |
| notion_slack | 1 |
| telegram_slack | 1 |
| jira_slack | 1 |

Browser FE-06B dùng messages/metadata bền vững trong PostgreSQL và tài khoản admin/member thật của sandbox; role-specific navigation, một textarea, Edit focus, màu nút, offline event, retry và không cuộn ngang đều có assertion. Slow dùng SSE fixture tại boundary và Playwright clock; session loss dùng auth-storage thật để kiểm routing/copy. Các test này không chứng minh model/provider live hoặc JWT tự hết hạn theo thời gian thực trong production.

Lần canonical đầu `browser-full.log` có 58 pass/3 fail do assertion FE-05 vẫn đợi raw error copy trên stage. Đã cập nhật đúng 3 assertion, giữ đủ scenario và kiểm raw error trong conversation log; các lần canonical sau, gồm delivery cuối, đều 78/78.

`git diff --check e269743`: exit 0. Responses/Errors CSS giống nguyên bản sau chuẩn hóa EOL sang LF.

## Review độc lập

Review agent độc lập xem diff base→head và mẫu React, mặc định NEEDS WORK: phát hiện P2 history hydration và P3 destination selection. Sau sửa, agent dùng hai source probes riêng cho snapshot trước/sau history và chạy lại **75/75, exit 0** trên `85d9bbe`; kết luận hai finding đóng, đạt trong phạm vi review này.

Evidence riêng: `reviewer/focused-final.log`, `reviewer/history-probe-final.log`, `reviewer/history-race-probe-final.log`. Full frontend trước các regression bổ sung: `reviewer/frontend-full.log`, 582/582, exit 0. Review visual là sampled (mobile-dark/desktop-light), không tuyên bố đã nghiệm thu cả 32 cặp. Reviewer không chạy backend/browser cuối; các lệnh cuối ở trên do implementer chạy. Reviewer repository và CI đúng head vẫn là gate riêng.

## Ảnh, đối chiếu và khác biệt

64 PNG = 32 app + 32 React prototype; 32 cặp, 8 tình huống (`unavailable`, `unsupported`, `read-only`, `destination`, `offline`, `session`, `slow`, `server`) × 2 sizes (1440×900, 375×812) × 2 themes (light/dark).

Thư mục: `C:/Users/VinhDat/orca/workspaces/ATI_Project/fe-06-cockpit-responses-b/node_modules/.cache/fe06b/screenshots/`. So sánh: `comparison.html`; script capture mẫu: `../capture-prototypes.mjs` dùng Vite bản React tại port5281. App capture bằng FE-06B browser spec. Manifest băm lại **sau lần browser delivery cuối**. Không commit ảnh, `.env` hoặc bằng chứng private.

Khác biệt có chủ đích với demo:

- Header/dải sandbox dùng cockpit đã tích hợp, không đưa tab kịch bản hay pill DEMO vào product.
- Reason/suggestion/status/service name/option/progress dùng dữ liệu có thật; không dựng accordion khả năng Trello từ danh sách demo vì response không cung cấp mô tả khả năng đó. Planner options chỉ là chuỗi nên dùng icon trung tính; không suy diễn thao tác hay đích mới từ text.
- Radio selection và xác nhận giữ hành vi hiện hữu, thêm Đã chọn cho destination; demo một đích click-submit không đủ cho nhiều option thực. Footer Responses giữ lớp/màu nút cam, dùng textarea chung để giữ multiline/draft/focus thay input demo.
- Metadata card header wrap và min-width/break-word phù hợp 375px; không cuộn ngang ở cả 4 tổ hợp viewport/theme. Shared header/sandbox và bỏ controls demo làm vị trí dọc khác trang demo.
- Offline không có promise tự đồng bộ; expiry dùng login thật với notice, không quick-login demo hay promise lưu nháp. Slow không dựng bước chờ/percentage/causes giả; dữ liệu steps và elapsed thật.
- Server chỉ dùng câu lỗi hệ thống, giữ câu gốc và retry/edit. Safety notice chỉ nói request chưa ghi lên công cụ, không “an toàn tuyệt đối” hay hứa toàn bộ dữ liệu ngoại hệ còn nguyên. Không giữ error code tự đặt hoặc nút quay về màn demo.
- Không thay 404 đã có ở FE-04b. Không làm phần A, policy read-only của W3-10, hay executor recovery.

Đã xem trực tiếp các cặp representative: unavailable desktop/mobile-dark, destination desktop, read-only mobile-light, slow desktop-dark, server desktop-dark; bảng so sánh có đủ 32 cặp cho reviewer. Bằng chứng ảnh không thay nghiệm thu accessibility/product.

## NOT_RUN / bàn giao còn chờ

Model/provider live, external write live, JWT hết hạn theo thời gian thực trong production, screen reader, reviewer repository và nghiệm thu sản phẩm. CI đúng head phải được kiểm trên PR sau commit này. Không tự merge; CURRENT-STATE/ROADMAP chỉ reviewer cập nhật sau merge.

## SHA-256

| File | SHA256 |
|---|---|
| app-destination-1440-dark.png | `6df9220097b87a2a62f51933d95438b9731675fd2972775dc142d2637ae13ad8` |
| app-destination-1440-light.png | `65d6ad24d7f8c1058560215d78c2addde20d610476a187ed9bd5b8ea257b4754` |
| app-destination-375-dark.png | `eb4aaf3195e396fca082fdac335fa7e3ec3faddfb224dbca4de216cf8ab91aab` |
| app-destination-375-light.png | `41bf365fdd4de4f653e56e5290de5a357ead335ed7272a50b0ae554270dae2c7` |
| app-offline-1440-dark.png | `1aa91f5268295f74999d5fc25dd471b6c8b267203b92ba42b69f95581a0313d2` |
| app-offline-1440-light.png | `0c1a90043a1af0fcca58a96fc0b6545aa09c2a104e6fcacf7c601213156681bf` |
| app-offline-375-dark.png | `cbd1deeeeacc6b5ab03a79cb77bf9a5539936687b725981bfd4f52e3dd3769ba` |
| app-offline-375-light.png | `673b018cedb55bb9013fb00da23994264b1dea5283ead4a4cbfe371cc652fb1c` |
| app-read-only-1440-dark.png | `17c298b43b1eaee7b211857b99497fa87e98a77af8de610a8a981e3eab2e363e` |
| app-read-only-1440-light.png | `3bdd18155b46caaa35cf47282e4db15f0d5ea03405716b47bf38ce0abba70040` |
| app-read-only-375-dark.png | `98ec3f9140f8345d24e6eb931b22e945459b0dd5c8b30ba682b3a6cc807b94a9` |
| app-read-only-375-light.png | `e4ee3aabf2297160e1533b4ba94ed13215fb775002235c141b01e0a1f1290b85` |
| app-server-1440-dark.png | `986c5a79f7ad29b488979f3a1c9045bad6d50cf2f23c448b68b29fd636923384` |
| app-server-1440-light.png | `3805dcdb842ab4d9d9e41fc337d822693253654dcce6bb24c60513eeb1bcd07c` |
| app-server-375-dark.png | `c44a5b85dfdc51e65a167ab0f2f6eca0fc0193721dbb653911f8455f25900f31` |
| app-server-375-light.png | `5bbc55d539a20dfa47afd0d65b0e247b5159e0abaa8718c362f965683e4702c9` |
| app-session-1440-dark.png | `c6f71aba7fa43d16bf5accbd688acab18d9a82102155912397352a5282190419` |
| app-session-1440-light.png | `50502a9d4572f60c1ade59f533fbc0e9c32d774d0f89ccc48fe79acfcc5b7bf2` |
| app-session-375-dark.png | `a05acfef22d101a17bab749b74b00e0850fcfe36c5c055925a659f699ebdfcf0` |
| app-session-375-light.png | `e24ca303a52e83d5f609f968e2cc27d673ab7c0872bb4eaa0015048174fd224e` |
| app-slow-1440-dark.png | `96f339c0377c58644b2bc0a3d04e06f6b48fea173034822a7d501de892e4e096` |
| app-slow-1440-light.png | `fbac3b9e57e7358334dc8750accab94027c74e77a3431a18acdaf8915a3ad390` |
| app-slow-375-dark.png | `c1e07c4836dd7102dad40ea53a32bd7ffdf5b1a59a3eb4f15f871339db7a44ec` |
| app-slow-375-light.png | `a29c676781ab9b2a0a66648b8a050167c08bbb7b7d9831219749b6997f273bfa` |
| app-unavailable-1440-dark.png | `d37bb6aa0891eb5e405ee866125d677af5f2ec50733a42627cfe0206061ea1f0` |
| app-unavailable-1440-light.png | `ebc8e808f3dba9e0320fe8db385548825698780ce894912afcb493096c951ca3` |
| app-unavailable-375-dark.png | `7b7c4fa2809f3aa7e1851c7b0612a924f3975f3bb4a33cf44b3e84b4311f6a3d` |
| app-unavailable-375-light.png | `fa3aa99883da5f8b865e6ea5904c43a52231aed261dea3c5bccc42f56e0ea74e` |
| app-unsupported-1440-dark.png | `04a9cd37d0d859fee34acaea7203ec7c8b42c266e0e966534c95cf4bb376fdcf` |
| app-unsupported-1440-light.png | `ffed432071bf7628166f457823cb3071603e3630ad5abd52107e282c148f4743` |
| app-unsupported-375-dark.png | `8a6ad517ea52b4c8e9a2e12ac89924a158d66fb0c60f7d050c9b8d1e94366bbd` |
| app-unsupported-375-light.png | `f8beed70a78e30953e458325043e707125ab88ba0ed7be67b9cd1861f2f4a20c` |
| prototype-destination-1440-dark.png | `e5e83adaf6fe00c08d79463016deec31edc311fc9a2cc2b83c6042c607f14bb7` |
| prototype-destination-1440-light.png | `68a6b65c0bb5ed3bb2f5a8cde125c913dc14744082e76ddedc5131656f3c7ea1` |
| prototype-destination-375-dark.png | `8d31d9a3f84f36ad7c6b56471156d3197976a3a659e0c9ff2e66e40a26f5907d` |
| prototype-destination-375-light.png | `54380aaa06272af13ddb7b7ee85e3c85aa522601b2cf01e03e8bbaa693e1e383` |
| prototype-offline-1440-dark.png | `eabd560270522c41bbf23c0080a0bdcf345bbfc97089dde5f6b62d5853838213` |
| prototype-offline-1440-light.png | `d41d02f6339548f1e431948e9d1804c5ced2513ed447e997e7a8cf4a6cb52b4e` |
| prototype-offline-375-dark.png | `5249fea0ab4db0c66fc9df578a36bcf32abfa5c8b655f6c1e4af2abf06742b16` |
| prototype-offline-375-light.png | `d8de3f87c712cc6b2ae86ac76805b43230a03ce89749bd01ee90e11b46398a13` |
| prototype-read-only-1440-dark.png | `db68cf4e018966707b8f18aa22185dd41e2ad755f8138bd6cfcdc11909ef226c` |
| prototype-read-only-1440-light.png | `2a6edb7b9749762cf50f4aef417e7caa8b57e69c6a51ccb3e64784bab92a096c` |
| prototype-read-only-375-dark.png | `5c63e2beaa6fd2474e0daabdd823d00da37d4c3351956221d7962a5617ef68c5` |
| prototype-read-only-375-light.png | `425a3fe0804dd1f5c4ec63d9c46164164d540ce239fc0b7ef7b7be20faca7e58` |
| prototype-server-1440-dark.png | `87d39718ae2fb4e37a0b949696bd9bd5f9cbd650589dea35d4e9e1758a64e745` |
| prototype-server-1440-light.png | `58bc5515371063cf22978ae82182e8dea85772cd59ab9f95e93ca01e95343852` |
| prototype-server-375-dark.png | `4faff53975c91fbb4057075e6f913a77216031787026fee19621ad512b6c0b4d` |
| prototype-server-375-light.png | `12dd6e2a7b072b3044ec2122bf1947b50384b205141eb7d75550970ea63a4cd0` |
| prototype-session-1440-dark.png | `8145222bce27047f933f15749b89eb3ccf9271a5697b3e9371c724ecd9faff7e` |
| prototype-session-1440-light.png | `a26e52e54aa79d08ecc7b586c47aa8ce52f4ff3f8b7220a40167994bc9ee5291` |
| prototype-session-375-dark.png | `1ee8059682aca27abffd478249b6b371f426da6bc4b633a6d947141c1b0ff7d3` |
| prototype-session-375-light.png | `376de072837823a56f3725eb1d5bf3dea81351adac63d4ecfbe684ab5dfffeee` |
| prototype-slow-1440-dark.png | `5e04f94433b2aa8fa2a430cce760907324e334676e00c46546a447acb4e1255a` |
| prototype-slow-1440-light.png | `0a1161f634c7fbe38d295f3367eab2f4eff6a0e408e3f4eca910db78a33ee1b2` |
| prototype-slow-375-dark.png | `26999a334657fce13e6c21802db320cd9a7ef0b389130df43bd07de3773ebd92` |
| prototype-slow-375-light.png | `a3efb7eba93f31cf444c4c19ab2dc2637fa48fc6bb5aa61eee2b5efd065a4992` |
| prototype-unavailable-1440-dark.png | `7771bdd39d156c492169ff14494682b89693dac92e80903dc479c076c3ed8aa0` |
| prototype-unavailable-1440-light.png | `df60d319b9f79adc1ff8732c4fe9bbdf68546d53c1a9e078cd4068053a7e6669` |
| prototype-unavailable-375-dark.png | `d50534e73f21c7c386a49183f7a1611046140e7f395ffdb4a6f39a82b3df53bf` |
| prototype-unavailable-375-light.png | `47e0d98d4477af37da1b7cf01e7d3439eb976d1b5aa58c5661a03598c248e0a3` |
| prototype-unsupported-1440-dark.png | `886819d07ee23d3198c1e38f1a1648530fe4ba7318612f43fa7d8b7ad6be8004` |
| prototype-unsupported-1440-light.png | `40c70f081c98d316857b536475c8219db2a7aec1d93af3cc902ce67b30cff480` |
| prototype-unsupported-375-dark.png | `e2e7d24bae9e8807fca047c3adbe3d7cc6e5fe11e2c36987cd6d7335bc38d1fe` |
| prototype-unsupported-375-light.png | `6c0ee36cd62230ea441d305bf47818de996ba6a5f38f7b7dc318e5ceccc13fca` |
