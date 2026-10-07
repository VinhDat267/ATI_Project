# FE-05b phần (b) · khoảnh khắc 4–6, composer và overlay

- Ngày: 07/10/2026, Codex.
- Task: [FE-05b](../tasks/FE-05b-cockpit-visual-parity.md), chỉ mục 5–9 và 11; giữ mục 10 đã làm ở phần (a).
- Nhánh: `feat/fe-05b-cockpit-parity-b`, worktree riêng `C:/Users/VinhDat/orca/workspaces/ATI_Project/fe-05b-cockpit-parity-b`.
- Base main: `8155c03d5e93f7491c5d6136f121bf03dd3c4e3f` (#100), đã gồm #98 `7df8eac` và #99 `b41031d`; CURRENT-STATE trên main còn chậm như người dùng báo.
- Commit mã: `fd13a486b3cd93bbad3843caef085ad78fe5a153` (`feat(chat-web): port cockpit approval execution and drawers`). Các gate dưới đây chạy trên nội dung mã của commit này; sau đó chỉ chuẩn hóa CRLF thành LF ở file mới và thêm bàn giao.
- Chưa merge. Claude Code review độc lập sau PR; FE-05b chỉ đóng khi phần (b) merge.

## Nhận việc và phạm vi

Đã đọc AGENTS.md, handoff README/CURRENT-STATE, ba log người dùng chỉ định (Codex phần a, Claude phần a P3, Claude FE-04b), task card, đặc tả redesign mục 1.1/1.2/5/6/7 và quy tắc team. Kiểm Git trước khi thi công. Main có thay đổi không thuộc task tại .gitignore/PRODUCT.md và tài liệu riêng: giữ nguyên, không đưa vào worktree mới.

Nhánh/worktree part-a đã không còn trong Git/Orca khi kiểm tra. Thư mục dư được xác nhận rỗng, nằm đúng đường dẫn part-a rồi xóa không đệ quy; không dùng lại nhánh cũ, không đụng commit Claude `65f2c9a`. Worktree phần b tạo từ main đã fetch `8155c03`.

Không sửa packages/planner, evaluations, tool-schemas, store, API, selector hay hành vi duyệt/thực thi. Không đụng PRODUCT.md, DESIGN.md, .gitignore, .github/agents, .github/hooks, docs/reports, skills-lock.json, .env, CURRENT-STATE.md, ROADMAP.md. Phần (b) không dựng lại khoảnh khắc 7–9/refusal/lỗi chung của FE-06.

## Mã và hành vi

| File/nhóm | Kết quả |
|---|---|
| PlanMoment | Markup/class moment-4, từng thẻ thật, warning ghi thật, action bar sticky, editor sửa ngay trên thanh |
| ExecutionMoment | Markup/class moment-5; số terminal succeeded/skipped chia tổng; output/chip thành công/thời lượng chỉ khi succeeded |
| ReceiptMoment | Markup/class moment-6; rộng 1120px; hai cột desktop/một mobile; connector ngang/Z theo tham chiếu thật, đúng trường output |
| ChatComposer | Ba bố cục footer fixed/inline/drawer từ source; một draft, textarea tự giãn, Enter gửi và Shift+Enter xuống dòng |
| ConversationDrawer/HistoryDrawer/DrawerBackdrop | Source 420px/380px và backdrop blur; tin thật; plan/receipt một dòng; giữ lịch sử FE-02, nút tạo mới |
| PreviewModal/PreviewContents | Khung/modal và nội dung card/issue/rows/message theo source; tham số thật, không dựng output hay người gửi giả |
| presentation/useDialogFocus | Metadata theo catalog/asset, HTTPS an toàn, vi-VN duration, phân tích reference; focus trap/Esc/return focus, inert và khóa cuộn nền |
| Cockpit/SidebarHistory/ExecutionProgress/index.css/asset | Nối các component vào dữ liệu FE-05; giữ ownership và recovery; scoped app-stage CSS riêng; link đọc cũng chỉ HTTPS |
| Test cũ và mới | Giữ toàn bộ ca, đổi selector/source contract; 25 unit mới và bốn browser matrix mới |
| Runner/Playwright/OIDC fixture | Cổng DB/API/web riêng khi nhiều agent; callback OIDC đúng cổng được chọn; mặc định cũ và kiểm chặn DB dev được giữ |

`prototype/theme.css` và `pages/Cockpit/page.css` không đổi; các test giữ nguyên văn bản nguồn qua. Class gradient dùng các tên đã loại khỏi Tailwind v4 ở `@source not inline`; không thêm utility gradient khác. Logo lấy `logoPath`/`logoParts`, màu từng dịch vụ lấy palette asset. Không demo timer, phím 1–9 hay executionMode trong app.

Progress không đếm phần trăm dự đoán. Bước skipped là bước đã kết thúc, nhưng không có chip “✓ Đã tạo/ghi/gửi”. Dữ liệu output chỉ dùng ở bước succeeded. Ref/template được duyệt theo cấu trúc args lồng nhau; forward/self reference, dependsOn và chuỗi thường không tạo connector. Link HTTPS từ output có target/rel an toàn, không dùng URL chứa thông tin đăng nhập.

Một editor theo chế độ: 1/3 giữ editor nội dung của phần a, 4 mặc định không editor, Sửa qua Chat mở inline, 2/5/6 mở footer; ngăn hội thoại thay mọi editor nền bằng editor trong ngăn. Các màn phục hồi FE-05 giữ composer/hành động cũ. Trap và draft được kiểm ở hai ngăn/preview, có Shift+Enter. Focus khi đổi moment vẫn về h1 nếu editor vừa bị tháo khỏi DOM; đang gõ hoặc trong dialog giữ focus. Thông báo SR hoàn thành nằm ngoài section v3-space-y-7 để không thêm 28px lệch source.

## TDD và gate thật

Log stdout/stderr đầy đủ nằm ngoài repo tại `C:/Users/VinhDat/.codex/fe05bb-*.txt`. Không commit ảnh hoặc output có dữ liệu môi trường. Bảng sau chép các dòng kết quả thật; RED chạy trước phần sửa tương ứng.

| Lệnh/ca RED | Output | Exit | Bằng chứng |
|---|---|---:|---|
| `npm test -w @wap/chat-web -- --reporter=dot tests/fe-05b-parity-b.test.tsx` trước thi công | `Tests 14 failed \| 1 passed (15)` | 1 | fe05bb-red-unit.txt |
| Cùng file, nested template/HTTPS đọc/history source class | `Tests 3 failed \| 15 passed (18)` | 1 | fe05bb-red-edges.txt |
| Giữ prefix sửa kế hoạch | `Tests 1 failed \| 19 passed (20)` | 1 | fe05bb-red-edit-prefix.txt |
| Header/tag preview theo source | `Tests 1 failed \| 20 passed (21)` | 1 | fe05bb-red-preview-parity.txt |
| Editor bị tháo khi đổi moment vẫn focus h1 | `Tests 1 failed \| 21 passed (22)` | 1 | fe05bb-red-removed-input-focus.txt |
| Nội dung preview Sheets/Slack từ source | `Tests 2 failed \| 22 passed (24)` | 1 | fe05bb-red-preview-contents.txt |
| SR announcement không thêm khoảng cách receipt | `Tests 1 failed \| 24 passed (25)` | 1 | fe05bb-red-receipt-spacing.txt |
| `node --test scripts/v3-local-env.test.mjs`, DB riêng | `tests 4; pass 3; fail 1` | 1 | fe05bb-red-runner.txt |
| `node --test scripts/google-oidc-fixture.test.mjs`, callback cổng riêng | `tests 2; pass 1; fail 1` (400 thay 302) | 1 | fe05bb-red-oidc-isolation.txt |

GREEN cuối focused: `npm test -w @wap/chat-web -- tests/fe-05b-parity-b.test.tsx`: `Test Files 1 passed (1); Tests 25 passed (25)`, exit 0 (`fe05bb-green-receipt-spacing.txt`). Test unit chờ dữ liệu bất đồng bộ bằng findBy/waitFor. Test locale có 1200ms → `1,2 giây`, 7/0ms → `< 0,1 giây`; pending/running có output cũng không lộ số hay link. Progress kiểm cả 0/50/100%; arrow kiểm ref/template thật và các trường hợp không reference. Asset được kiểm riêng từng dịch vụ.

`npm run check` cuối: exit 0, `fe05bb-check-review.txt`:

```text
typecheck:v3: exit 0
tool-schemas: Tests 47 passed (47)
tool-adapters: Tests 340 passed (340)
planner: Tests 196 passed (196)
executor: Tests 25 passed (25)
chat-api: Tests 349 passed (349)
chat-web: Tests 475 passed (475)
test:v3: 1432 passed tổng
test:eval:v3: Tests 165 passed (165)
build:v3 và kiểm bundle: exit 0
test:launcher:v3: tests 1; pass 1; fail 0
local-env/fake-oidc/google-fixture: tests 10; pass 10; fail 0
```

`npm run test:browser:v3` cuối: exit 0, `fe05bb-browser-review.txt`:

```text
default: 48 passed (1.6m)
auth02: 2 passed (12.5s)
auth04: 5 passed (15.9s)
clarification: 2 passed (9.7s)
partial_failure: 2 passed (10.5s)
three_service: 1 passed (8.8s)
sheets_slack: 1 passed (5.8s)
calendar_slack: 1 passed (7.4s)
notion_slack: 1 passed (7.0s)
telegram_slack: 1 passed (6.1s)
jira_slack: 1 passed (6.0s)
Tổng: 65 passed, 0 failed, 11 scenario
```

Bốn browser mới dùng PostgreSQL thật, plan/receipt thuộc đúng user/conversation, HTTP approval được giữ tại route để đo frontend đang chờ duyệt 0/2, rồi trả 409 có giới hạn rõ. Receipt completed được lưu vào PostgreSQL và kiểm sau reload; đây là fixture trạng thái lưu bền, không giả vờ có controller đang chạy. Các scenario v3-sandbox riêng và ảnh bên dưới thực thi workflow thật qua API sandbox. Trap history tìm một title duy nhất để phần tử cuối không đổi do phân trang giữa hai lần Tab; ca FE-02 kiểm riêng phân trang/cuộn thực tế vẫn giữ.

Các lần chạy chưa đạt khi chuyển selector/fixture không được tính là nghiệm thu: history flex chưa cho vùng danh sách cuộn; prefix sửa kế hoạch bị đổi; fixture Google chưa theo cổng; fixture “executing” không có controller bị reconciliation đưa đúng về recovery. Có sửa và chạy lại toàn bộ hai gate. Không bỏ ca để làm xanh.

## Môi trường và thay đổi assertion

PostgreSQL 16 `ati-fe05bb-pg`, tmpfs `/var/lib/postgresql/data`, bind `127.0.0.1:55534`; API 3002, web 5176. Người dùng xác nhận “bạn có thể chạy cổng khác” khi W3-10 chiếm 55533; 3000/5174 cũng đang được dùng. `RUNTIME_MODE=sandbox`, tài khoản test từ `.github/workflows/v3-check.yml`, không dùng DB dev 15433 hoặc sửa .env. Runner cho chọn V3_LOCAL_DB_PORT có kiểm số/cổng canonical, chặn 5432/15433 và URL không khớp; CI dùng URL riêng của workflow như trước.

Theo đặc tả 1.2.6, đổi assertion FE-03/FE-05: tên region/h1 của source; ở moment-4 mở “Sửa qua Chat” trước khi tìm textbox; tool/resource kỹ thuật nằm trong disclosure thay span/chip thô; completion là số việc/công cụ từ snapshot; link tìm theo href HTTPS/nhãn source; duration tiếng Việt. Preview có hai nút đóng như source nên trap kiểm cả hai. Gợi ý ở moment-6 chỉ dịch vụ đã thiết lập, không dịch vụ thì settings/new request theo 1.1.5. Không bỏ test case cũ, không bỏ thêm kiểm tương phản trong phần (b); phần (a) đã ghi các thay đổi tương phản/40px.

FE-02/03/03b, W2-04, AUTH-05, FE-05 và phần a qua trong gate đầy đủ; ownership phản hồi muộn, plan/conversation mới, Back/Forward/reload, ReconciliationNotice/PartialFailureModal và các moment 7–9 vẫn được kiểm. Bộ test giữ cuộn đầu/focus h1 4→5→6 ở 1440/375 sáng/tối; thêm ca editor nguồn đã biến mất. Test mới đo main 1120/375, không overflow và link cuối nằm phía trên form footer sau scrollIntoView.

## Ảnh đối chiếu và khác biệt có lý do

Nguồn chạy `npm run dev` trong `docs/design/prototypes/react`, port 5180, route `/app-stage`; dùng phím 4/5/6 và mở history/chat/preview. App chạy sandbox `three_service`: đăng nhập tài khoản CI; lưu credentials giả GitHub/Trello/Slack/Sheets qua `POST /api/services/:service/credentials`; gửi yêu cầu, xem kế hoạch, chờ duyệt rồi gọi approval thật và nhận completion từ API. Không dùng dữ liệu demo để dựng receipt app.

Có 24 PNG nguồn, 28 PNG app (24 đối xứng + bốn full-page mobile moment4/6), 24 ảnh đặt cạnh nhau và tám contact sheet: 84 PNG. Đã xem các contact sheet cho 1440×900/375×812 sáng/tối, kiểm lại ảnh riêng mobile và full-page. Chờ animation hữu hạn kết thúc và compositor ổn định trước ảnh cuối; bỏ ảnh trung gian lúc stagger chưa vẽ đủ. Ảnh và manifest ở `C:/Users/VinhDat/.codex/fe05bb-visual`, không commit; `all-image-sha256.json` liệt kê toàn bộ SHA256 bên dưới. `app-measurements.json` ghi width/editor/focus/footer; viewport mobile không tràn ngang, moment4 không editor, moment5/6 một editor, chat một editor. Capture kiểm link receipt cuối không bị footer che.

| Khác biệt | Lý do |
|---|---|
| Ba bước GitHub→Trello→Slack, demo bốn bước Trello→GitHub→Sheets→Slack | Plan/API thật, 1.1; đã cấu hình bốn dịch vụ nhưng scenario thực thi ba dịch vụ |
| Moment5 app 0/3, nguồn 35%/Việc2/4 và có bước thành công | Ảnh chụp HTTP đang chờ phản hồi duyệt, chưa bước nào xong; không tiến độ/number/time giả, mục 6 |
| Chiều cao thẻ và điểm căn giữa khác theo số bước/độ dài nội dung | Giữ class/layout source; nội dung/dữ liệu thực tế khác; không ép chiều cao bằng demo |
| Duration `< 0,1 giây`, không 3,8/1,2 demo | Thời lượng thực tế từ execution snapshot; quy tắc duration mục 6/11 |
| Connector ghi `url`, ba cạnh; không `link card`/`link issue` demo | `$ref`/`$template` được duyệt dùng github.url→Trello.desc và github.url/Trello.url→Slack.text; mục 6 |
| Không link Slack, không tên board/list được đoán | Output Slack không có URL; plan chưa có label human cho Trello list; 1.1 và quy tắc trung thực |
| Receipt cao hơn bởi duration/disclosure kỹ thuật | Tool/time/raw output phải thu gọn; mục 6, toàn bộ dữ liệu vẫn mở xem được |
| Preview h3 “Xem trước nội dung”, tag tên dịch vụ, tham số thật | Giữ tên truy cập hợp đồng FE-05, nội dung card/issue/table/message source theo tool; không thêm title/sender/row demo |
| Hội thoại ít tin hơn; giờ, title và status lịch sử khác | Tin lưu bền/giờ máy từ API; plan/receipt chỉ một dòng tóm tắt; không sinh demo conversation |
| History có new/search/rename/pagination; nhãn “Đang trao đổi” từ status chatting | Task mục9/FE-02 bắt buộc giữ; không suy diễn “Hoàn thành” từ title/demo |
| Footer mobile textarea xuống dòng, khoảng cuối trang dành cho footer | Shift+Enter/auto-grow và không che hành động/link; ResizeObserver theo chiều cao thật. fullPage chụp fixed theo viewport, kiểm vị trí link thực dùng browser scroll |
| Nút Gửi disabled khi draft trống/planning; bỏ menu demo/phím tắt/bỏ animation | Hành vi API thật/không có contract demo, 1.1; giữ một editor |

## Danh sách ảnh và SHA256

| Ảnh (ngoài repo) | SHA256 |
|---|---|
| `app-1440-dark-chat.png` | `447c98d927036ad09aec5c4c6c5d34b24e3d123dc477af15fe60afb54c4088e5` |
| `app-1440-dark-history.png` | `109392f04f507120f474faa196a6e13f43dfd2bb578c0d382757693129d11555` |
| `app-1440-dark-moment4.png` | `359f94995d2608c967339b31fda313e11f1d375f9dd4956c2d8b91d7d9c47001` |
| `app-1440-dark-moment5.png` | `75c1935c58155dbaf8578dbf4ec0acbc21750c5f20560027f463305a139d02cf` |
| `app-1440-dark-moment6.png` | `4f0d6861a702356ec882e7a68391c96a882dfcb91b77c7c349f7a47c0902e224` |
| `app-1440-dark-preview.png` | `8b8f4b6ade4f616209517c2c8812b4e95422963a142b4261af4df97529d2a14d` |
| `app-1440-light-chat.png` | `b98537220367d584e5fe3e7d19e731e970bb6500d2c4720770964ce30b445b1c` |
| `app-1440-light-history.png` | `26b40f5f0d91d0ef753aa7fa8938e864934fdaedfc38cf6897f36da4f6ecba6a` |
| `app-1440-light-moment4.png` | `d9ed607e10c5cbf7e217fcaba6b5590280a395e198426743a3a75ad3170b9f4b` |
| `app-1440-light-moment5.png` | `1688310496acce9c95c93f0049ed27c5dde0054e13545aeb4624dfd5a68253a6` |
| `app-1440-light-moment6.png` | `d9ec5bc744ee4bfb0c55eb720d9dc44f5312a3e58152f9860810f02f6847800b` |
| `app-1440-light-preview.png` | `2db8fb24d63d1dec328ddc978a5757ed049f455c83724ac21601f6e0e234c091` |
| `app-375-dark-chat.png` | `d884bed568d09962be7408cfb2887f7b2c872b1e8c5a1feb1e8f47a6bd031053` |
| `app-375-dark-history.png` | `212469055d077432887655b65726a9d496b769fe198ab7f3de3d063905d060f2` |
| `app-375-dark-moment4-full.png` | `228e347632d38f925e7d60c9d20b74e019e9cd565dea194ed8be6eb2f716d904` |
| `app-375-dark-moment4.png` | `d34c55a385364bdf149c46982784039df9216c79fa088db5922f0869a4a35861` |
| `app-375-dark-moment5.png` | `f3089ebef52ea04492288da6f72e55e9ab72cd828cce0ee74de62a1a4916eb17` |
| `app-375-dark-moment6-full.png` | `d5af6bde3aa056d720cefc2312801c78e8871079077a0d351b566cb157156e60` |
| `app-375-dark-moment6.png` | `fa8d022276fc49d50e4c5592669bec5dc3beeb443c0e7541193968b6b60df5a6` |
| `app-375-dark-preview.png` | `fabd408b7d96cffdf9f99c48b68a7a35778f58a2c05146306435c747976ae11d` |
| `app-375-light-chat.png` | `c523348be6914972e3eb617701478c6b34b7998a4d1c63d6dcba70f6c43ca86a` |
| `app-375-light-history.png` | `6c367fed109b9fea9de4cac483eb0b5612e07e6cbd9d20bf90ee70bba28115c7` |
| `app-375-light-moment4-full.png` | `e50e5c6b082fbd7ef2203c268e8615f0f9a921519abad843fb64cdd7fec3730b` |
| `app-375-light-moment4.png` | `0dd6180a9bbe00e1eb13385f7d76aeb2ea804df4d7baea2de596ad99d6ac06e5` |
| `app-375-light-moment5.png` | `345fe90d94f1eb9ee77f2fc6f25fd2ddefaa00e3646e3db5cad2dcb9945f074f` |
| `app-375-light-moment6-full.png` | `d03d228754a637a99a24df46aeb38eed48431f84e1b353b635232af28d1dd23a` |
| `app-375-light-moment6.png` | `219ba3eaeb7398639076c8c4244723ceb15db302187eb87d2dea391328f275aa` |
| `app-375-light-preview.png` | `b0c9f111a1b125cc6636c101474b81d99c82f68c30f5984d590659d364e57813` |
| `compare-1440-dark-chat.png` | `9af4737227c3d8eee2a46832a068ee5caf6404a570e7b77d406c3e09eee05a54` |
| `compare-1440-dark-history.png` | `e4ac313c277c4cc8d981e5f69a7c164e3e8e3eefe0232f84aa6380d3541b9c41` |
| `compare-1440-dark-moment4.png` | `80a3061bfa823b9e86ceab051ed8e6ab65118da5f7298d9bf0e85ed3f9cca1cb` |
| `compare-1440-dark-moment5.png` | `2858a9960dc5f2ed95d1c80e5a31ba799e49fe1fe1d775810132586e8508a88e` |
| `compare-1440-dark-moment6.png` | `317853c2c25d5aae87a32c75cb98010025a89078a439e56b795a95026efaaf04` |
| `compare-1440-dark-preview.png` | `5567fa86ee47a32217703a0f527bc6643e97ae48f78bdc751e1f5e532f1aa2e5` |
| `compare-1440-light-chat.png` | `4ee6b4e82acd5e46ed1e20221062c0cc8adddfd4b4edba263828b5a66a4cd54d` |
| `compare-1440-light-history.png` | `8f62aa20e7fa66ed1bd6f650da08e533a093284f269308be1f47cebad44ff6ae` |
| `compare-1440-light-moment4.png` | `1002b003b2e9735dec31a113c0f3ae6ab412f2a0f22264b295c43ee65692d5c4` |
| `compare-1440-light-moment5.png` | `d0885e7d121143e999e6d1311db716a4be646c455b2fa31c4cd7f230e8334aaa` |
| `compare-1440-light-moment6.png` | `b1b6e516edaa255fca87474d97f432b26de1507fe436b1299cdc9b88f46f1fc8` |
| `compare-1440-light-preview.png` | `1fe9f3b2fb5b5dddd583865cfc3110514057cd00c2b7a1df8ced2e4d8049f5b9` |
| `compare-375-dark-chat.png` | `7d378b67846551a46d02c2883f43c9120aa2a854117cd88612a86d42267a4698` |
| `compare-375-dark-history.png` | `8ac7c87f75864b2922bda75bdd99f79c62af09f1325f733ec36b602de13a9f6c` |
| `compare-375-dark-moment4.png` | `2b2eafc37ecc14848a90a11447994099e4443d814048458463e47509e9b1993c` |
| `compare-375-dark-moment5.png` | `fa7f81d90a01742fb2de3f3f292f1ecc1bfb85bdad980191e4140bc3824e204d` |
| `compare-375-dark-moment6.png` | `a68c0f8042539e415307d1ff6ea11f0fe09667a1f969d878275059ae86abb608` |
| `compare-375-dark-preview.png` | `379162b375354ae4cd46397f951e3b3fc6c6b93a54dceb4ba68b1f5176f19929` |
| `compare-375-light-chat.png` | `38575dc7eefdc3481cccb440f6eaae10b1d79039f2461738de1632796d204094` |
| `compare-375-light-history.png` | `39dc966eba2d05ce6bf36a168ee7c462cc39b27d9a4d697b1474e8a122c46415` |
| `compare-375-light-moment4.png` | `4550191b0d0b8149ea94a6c714decd689d87935ff40ecd467809dccbd1c9de2c` |
| `compare-375-light-moment5.png` | `7d0e64de5639b629ecd4b2ea90c0ec076d63d9ce04376c1857630e81d52e9fc4` |
| `compare-375-light-moment6.png` | `97b9b5b33b9b4972cb27eb8cafea51a6b5b785beac3efa06afb2b608f4e140a1` |
| `compare-375-light-preview.png` | `7221fcb63d857236a814d81b89f283008575911a4792aacf49128af65fd37368` |
| `contact-1440-dark-moments.png` | `d7872ed4bd93ceb42410492ad5d0a77ad7f417fc92921237bb0943f1b4465ad8` |
| `contact-1440-dark-overlays.png` | `d4fb0d063d13a69d68553fb682b85af5adc1b2b133795003201801171834d68b` |
| `contact-1440-light-moments.png` | `d37bb62fea52e986d01fdcf93e8186c4b7e9b7d8d5d0fdb69b1383dfe9372bfc` |
| `contact-1440-light-overlays.png` | `63c964a53d77faecb7885acadecbe9b7c5ee8496eb2df982d88e2cf34b718969` |
| `contact-375-dark-moments.png` | `d9bd07d50029a72068e4027e342e2864bf405807841a915f37365f2915894773` |
| `contact-375-dark-overlays.png` | `e73605cfcd882d128834f9c49d2936c8b2f142c9e943fbbaed88da3d1016ca22` |
| `contact-375-light-moments.png` | `63e34282ad818b23e6105bb3508067b129abfc60f3247bc8c8f9d69d999a7b41` |
| `contact-375-light-overlays.png` | `9a756514a4b1ed84de1f66960be4853cd086a459a9fc39cc906a323b79a0473d` |
| `prototype-1440-dark-chat.png` | `a49118b35dc632a788734a76e0cb3d80faf930cb0db9b659c1f93173a063776f` |
| `prototype-1440-dark-history.png` | `1ce9f88f3fae315f8cd7ecefd5f649d967610cd7de917f68508c8d45182fdfa4` |
| `prototype-1440-dark-moment4.png` | `5e6bfdaa429d3c753d3515aa4a235490122f0aadce6781af9c4ef22f3fab8705` |
| `prototype-1440-dark-moment5.png` | `2c02dab9ffedcd9fb9e81d5cc071749dce618853e560fa95e5c193296352b181` |
| `prototype-1440-dark-moment6.png` | `640fe9150053a05de2c5b25bb5c1a8304475a83f2c6846113b9de2071b4c6b6f` |
| `prototype-1440-dark-preview.png` | `47ed80590da92e65926859b61a72634f28573653bf322d2cd85bc501b73bb482` |
| `prototype-1440-light-chat.png` | `e73af169b06715467111940d0774d8cd08c483f07ccceab3b2da306f677cef8c` |
| `prototype-1440-light-history.png` | `51fa523dd5b902e8ceb788be7aaa809760bf0335fe6b8509e389c2a484e7fd99` |
| `prototype-1440-light-moment4.png` | `406b9c342a13f64d221ec6fee9183defa6cd3f4420715bf93b02b52d96cd72bd` |
| `prototype-1440-light-moment5.png` | `720dbacc4d874135796edee9c168b2aebb2c0e95d2361bc9a39e584c9a7b933b` |
| `prototype-1440-light-moment6.png` | `98d570c6875337161f70a6b45fcf6104ad3da3f47a35552f1be1318457cf1f59` |
| `prototype-1440-light-preview.png` | `1e263b68072759b12f932b712219481a9ffc392c15a64720e32519fb6fbfa943` |
| `prototype-375-dark-chat.png` | `f7e37250b3c490e2ba6de75baa0bb564f2f915dba5d51c5d4063c2ea7842ad0d` |
| `prototype-375-dark-history.png` | `8a46ca59cf5b97966db5b9233ff37f005fd67e7ffd91c5152712e8dcba17c900` |
| `prototype-375-dark-moment4.png` | `4a254e6d4458ea8bab161b92fae7c279afca755b94b94d83c9faebe97d58a526` |
| `prototype-375-dark-moment5.png` | `fd1d656cd5c3626794da275ce65ea14c09e84e674d62957d2c48e15f15c4b365` |
| `prototype-375-dark-moment6.png` | `c8aa54345e0d4fd06c0ab86931c1f8afe8dd19d13619e2574658ca02f30568e8` |
| `prototype-375-dark-preview.png` | `9c3800c1b4391c6bc877bbba72aa72b5877477d5a7b9d7805985daeb5af3e802` |
| `prototype-375-light-chat.png` | `b97ad4c56e03ca5acecd600371c05ab3f61a6be669e4a449dc5a8a06ce03eacd` |
| `prototype-375-light-history.png` | `dd202051bf8eb893773ce82eca6eacc0690ce3f2488b67ab4f3d9e5c778d4ca8` |
| `prototype-375-light-moment4.png` | `f156984a87a650130ec6e8c44e5e218900895ce423a6b91ab47904c362af6a28` |
| `prototype-375-light-moment5.png` | `6c69791b6e01afcf7fae15e118b2f34c3b122d63279851233b2fe40f57f6001f` |
| `prototype-375-light-moment6.png` | `f4621ce4da4a846aafd139dbae414b17c84bb415a093309e8ed6c085e727e59f` |
| `prototype-375-light-preview.png` | `af83bb041deb0ea4c09de90de716012caf838e8fc8c786b0c39d736bd7184a16` |

## Bàn giao và giới hạn bằng chứng

Gate local đạt; CI trên PR được báo trong trạng thái GitHub, không suy từ kết quả local. Reviewer độc lập chưa chạy lại: **CHỜ CLAUDE CODE REVIEW**, không đánh dấu task toàn bộ đã đóng. Không tự merge.

NOT_RUN: model thật, ghi lên provider thật, screen reader và nghiệm thu sử dụng với người dùng. Sandbox/fixture không chứng minh các mục này. Không thay hình thức moment7–9/refusal/lỗi chung FE-06.

Đã dừng đúng các process API3002/web5176/prototype5180 có command line của worktree này và xóa riêng container tmpfs `ati-fe05bb-pg` sau nghiệm thu; giữ worktree/branch để review. Không dừng process/container của agent khác. Kiểm lại main giữ các thay đổi riêng ban đầu. Ảnh, RED/GREEN và log gate vẫn còn ngoài repo để đối chiếu SHA256.
