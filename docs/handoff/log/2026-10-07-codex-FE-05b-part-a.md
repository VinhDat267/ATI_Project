# 2026-10-07 · Codex · FE-05b · Cockpit parity, phần (a)

- Yêu cầu: mục 1–4 và 10 của task FE-05b bản 07/10; phần (b) để PR sau. Đọc AGENTS, handoff README/CURRENT-STATE, ba log 07/10 của FE-04b, DESIGN và kế hoạch port trước khi sửa.
- Base: `7df8eacfbbdd686aeda632530b62f2ce3c606aee`; #98/#99 đã có trên main dù CURRENT-STATE chưa ghi. Commit mã: `7501a17b550b0b2652808d64451fd1ad0e7816aa`.
- Worktree: `C:/Users/VinhDat/.codex/worktrees/fe-05b-cockpit-parity-a/ATI_Project`. Nhánh: `feat/fe-05b-cockpit-parity-a`. Primary checkout có PRODUCT.md và các file riêng chưa commit; không đưa chúng vào nhánh này.
- Môi trường: container riêng `ati-fe05ba-pg`, postgres16; `/var/lib/postgresql/data` là tmpfs, bind 127.0.0.1:55533; sandbox, tài khoản test theo CI. Không đọc/copy .env, không dùng 15433, không gọi provider/model thật.
- Mã frontend: App/Workspace/Cockpit nối trang nguồn mới; UserNavMenu thêm variant prototype giữ hành vi/vai trò; CockpitDialog thêm id để aria-controls của header trỏ đúng ngăn; ServiceLogo thêm kích thước tùy chọn, mặc định của phần FE-05 giữ nguyên. `pages/Cockpit/page.css` trùng byte với nguồn; SHA256 cả hai: `F86119DF6A151CF29776A1D8DF46EDFDAC130F4F46D5B7DDB49C45AF1BFE3728`.

## Kiểm chứng lần thi công đầu, mã 7501a17

| Lệnh/ca | Output thật |
|---|---|
| Baseline `npm test -w @wap/chat-web -- --reporter=dot` | 423/423, exit 0 |
| RED unit ban đầu | 6/6 failed, exit 1: markup/meta/một textarea/focus chưa có |
| RED browser ban đầu, 1440 sáng | Thiếu data-proto-page app-stage, exit 1 |
| RED radio keyboard | Phím mũi tên không chuyển lựa chọn, exit 1 |
| RED focus dialog recovery | Focus bị chuyển từ dialog sang h1, exit 1 |
| RED review regressions | 3 failed / 10 passed, exit 1: class nguồn, hướng dẫn thiếu dịch vụ, Enter ngăn gửi radio cũ |
| GREEN regression sau sửa | 13/13, exit 0 |
| Review độc lập nội bộ, 6 file frontend | 94/94, exit 0; hai P2 đã sửa, chưa thay Claude Code review PR |
| `npm run check` sau sửa | exit 0; test:v3: 47 + 340 + 196 + 25 + 349 + 438 = 1395; eval:165; typecheck/build/bundle security/launcher/node checks đạt |
| `npm run test:browser:v3` | exit 0; 61/61 qua 11 scenario: default 44, auth02 2, auth04 5, clarification 2, partial_failure 2; three_service, sheets_slack, calendar_slack, notion_slack, telegram_slack, jira_slack mỗi scenario 1 |
| `git diff --check` | exit 0 |

Log gate cuối ngoài repo: `C:/Users/VinhDat/.codex/fe05b-check-accepted.txt` và `C:/Users/VinhDat/.codex/fe05b-browser-accepted.txt`. Log RED/GREEN ngoài repo: `C:/Users/VinhDat/.codex/fe05b-*.txt`; các lần gate giữa chừng có lỗi selector tên/role/vị trí mới, một lỗi fixture prompt và một lỗi kiểu test (exact của Playwright dùng nhầm trong Testing Library), đã sửa rồi chạy lại. Không dùng lần chạy fail làm bằng chứng đạt. AUTH-04 chạy với OIDC fixture cục bộ, không phải nghiệm thu Google thật.

Browser mới đo header + strip, một textarea, overflow và scroll/focus thật: ở 4 → 5 → 6, h1 nhận focus và nằm trọn vùng nhìn; bắt đầu yêu cầu mới từ textarea giữ focus textarea. Các ca cũ giữ kiểm phản hồi muộn theo hội thoại/plan/request, reload/Back/Forward, trap/Esc/trả focus, Shift+Enter, pipeline sandbox/DB và auth.

## Những test FE-04/FE-04b được điều chỉnh

- `fe-04-shell-theme.spec.ts`, “solid brand buttons…”: mở lịch sử để tìm New; bỏ assertion font-weight=600 cho nút cockpit vì typography prototype. Assertion login/save settings vẫn 600.
- Cùng file, “mobile drawer…”: giữ kiểm mở/đóng/dùng được; ghi kích thước nút lịch sử, không ép 40×40 cho cockpit/close/rename. Settings scope-removal vẫn phải 40×40.
- `fe-05-cockpit.spec.ts`: bỏ ngưỡng contrast 4.5 cho preview cockpit theo spec1.2.6; vẫn ghi màu/tỷ lệ vào measurements và giữ các ca dialog/focus/composer/overflow/outcome link.
- FE-04b unit/browser Back/Forward: route cockpit giờ có app-stage/theme/page CSS; 404 có scope riêng, rời về màn chưa chuyển gỡ prototype; assertion gradient không đổi.
- Landing contrast, login sizing, settings sizing, focus ring và cross-tab theme được giữ. Không bỏ ca hồi quy hành vi; đổi selector theo aria/role/source id. Ca empty transcript dùng saved preview trống tin để ngăn có thể mở, vì nút chat ở moment1 là hidden!. Test revoke session dùng request lịch sử làm thao tác tiếp theo.

## So ảnh với bản React lần đầu, mã 7501a17

Nguồn chạy `npm run dev -- --host 127.0.0.1 --port 5180 --strictPort` trong `docs/design/prototypes/react`, chuyển bằng phím 1–3. App chạy sandbox scenario clarification trên DB tạm. Khoảnh khắc 2 chặn POST tạm ở browser để chụp discovery trước khi API trả lời; không ghi dữ liệu gather giả. Ảnh app dùng dữ liệu API, tài khoản CI chưa cấu hình dịch vụ. Không có dữ liệu mẫu hard-code trong app.

Thư mục ảnh ngoài repo: `C:/Users/VinhDat/.codex/fe05b-evidence-20261007/images`. Có 24 ảnh riêng và 12 ảnh đặt cạnh nhau, không commit. Không tuyên bố pixel-diff=0: nội dung hai bên khác nhau.

| Kích thước/theme | Header 1/2/3 (px) | scrollWidth tối đa | textarea 1/2/3 |
|---|---|---|---|
| 1440 / light | 86/94/94 | 1440 | 1/1/1 |
| 1440 / dark | 86/94/94 | 1440 | 1/1/1 |
| 375 / light | 86/90/90 | 375 | 1/1/1 |
| 375 / dark | 86/90/90 | 375 | 1/1/1 |

Font h1 theo bản React: moment1 52px desktop/36px mobile, moment2 30px/24px, moment3 44px/30px; Playfair Display. Header nằm trong max-w-5xl, main max-w-4xl. CSS trang chép nguyên. Các cặp ảnh được kiểm trực quan; không gán dữ liệu demo vào app để tạo ảnh khớp giả.

Khác biệt có chủ đích: demo menu/phím/timer bị bỏ; avatar/counter/query/question/options/services theo API; không có 3–5 giây, Khuyên dùng hay Cập nhật...; hướng dẫn thiếu dịch vụ theo spec1.1.5; nút rỗng/planning disabled; thẻ custom mở sẵn và textarea thay input để đúng một ô nhập/Shift+Enter. Logo theo asset/catalog đã có, cỡ SVG theo nguồn. Không có thao tác hủy discovery/nhảy thẳng sang plan của demo trong API hiện có nên bỏ hai nút demo. Ô nhắn thêm vẫn FE-05 trong document; drawer/preview/moment4–6 và số giây chưa port, thuộc phần (b). FE-04 accessibility về kích thước/chữ/contrast ngừng áp dụng cho toàn cockpit đúng spec1.1.4/1.2.6; thêm focus-visible cam cho control từng tắt outline.

## SHA256 ảnh lần đầu, mã 7501a17

| File | SHA256 |
|---|---|
| app-1-1440-dark.png | `031a47021aba1d902096d0fdf3f69d3f41155c3a353e312fc587c9853e6dbfcf` |
| app-1-1440-light.png | `8339ecc15e1e892ce2f01dfacaa5a7afe912a2bdf289558c754c8bbe6722e17f` |
| app-1-375-dark.png | `3aaa533d2a16a88908d958009805c79f19e38209fde42c666501dc4010a616cc` |
| app-1-375-light.png | `fe4ac3dc6fde901612240aee1fca92a4eca69c93301ebcabf79a8caf10aac801` |
| app-2-1440-dark.png | `862c9a80c7b982685b95c1db72cce5cf9eada2a56c5db809b546fec384468b2e` |
| app-2-1440-light.png | `35b1125691d086434b1647f69244b1b28a6f214db7df5ab4bbd0c49826f472c8` |
| app-2-375-dark.png | `2a0d03d54addba1a05c9e7f7a9628a3a887b1c6c08931689ac3271ce8a6fac0b` |
| app-2-375-light.png | `9b553fe67a004a7dfaafc942ee19b697e2d1e7cdbc222b2cb3305176a66c515a` |
| app-3-1440-dark.png | `4c67f8501029d99fdb23f25485af1b721341712f980c84a88ff1b227cd8f4362` |
| app-3-1440-light.png | `7e46bd22c06e70f631638561456295dbc6b44dcabc1ea1a97d7c24f708a707da` |
| app-3-375-dark.png | `edff1e064ad2db050ef84f11f5c4ba5a097d9fce04c3c2cef7931c27dc03609f` |
| app-3-375-light.png | `460a4f8ecd6d93d0326aaeeab2b47e58032ef730641e8387b4875da6a9c8936e` |
| compare-1-1440-dark.png | `39ae95f3dc500ae2b0fd23a1622f2e8f7ab7bc1de7c252041472309605f5c234` |
| compare-1-1440-light.png | `0028dd7a7edba92a6fc2ce44f971171477b573e4253f3f2cfa5c99a8a062e728` |
| compare-1-375-dark.png | `404d1f566444bab0370a0b56f386288e3a6c410705b08f1aea9cb47566c70764` |
| compare-1-375-light.png | `45dc9962c7a082f9ce4b54a650438a8db7a560ac0158db95f33dbdc48769b688` |
| compare-2-1440-dark.png | `3bc8ec5e9d823f930d1f271f3a56f3ebd3ce0d9e8406a6a766c222d8b0f552a8` |
| compare-2-1440-light.png | `2527e9d8fab3d750a6c361ceeae288f470f6ff9dca07c8c3898d5b9cde98baf1` |
| compare-2-375-dark.png | `4f7241b776dea597adf72443387cdb565bc227c945bbac5e6a5db050c6531500` |
| compare-2-375-light.png | `dc1272213fd4786b0cf9aa0d2aab398abe332e20991606b5e2227a1b76b6b911` |
| compare-3-1440-dark.png | `bd48c5d0d3c287383fbe46874d906265344b1bd7abe13f8149abeb56619627c0` |
| compare-3-1440-light.png | `48ffe903e032acd89587c2f800cc189612b4f0994a2e8e382d00bd97560165f9` |
| compare-3-375-dark.png | `2be68f596c39136b13f3360d62b1160aefaeaa9e2d501b0874fd2fe5d2a0a466` |
| compare-3-375-light.png | `2a34566887b38d862210693aa8703f5d60cac99bdf814b71160a33d65f4a4a5f` |
| prototype-1-1440-dark.png | `1c768978f041d6d0456a094f1ae18284e0d2326cc978abfa878b669648e93203` |
| prototype-1-1440-light.png | `d4adff357236669f5b422f520f059091ce709200517ec138fc616067c1c0d9ca` |
| prototype-1-375-dark.png | `1360ca3b33d22ba009836666c368dc0c81fed5d302c46f43021f154411a35306` |
| prototype-1-375-light.png | `3a26c7b6457847dab0dbd48cae8b925c458133913fc86181871a23c79199f1a9` |
| prototype-2-1440-dark.png | `1911d173459e2b017dec98229ca2a4780028b795b581ef95b89151f9d83e0da5` |
| prototype-2-1440-light.png | `8e28d67186605137935e2efcb586d85f509f021cf0bb68be84349f9dadb8c3b3` |
| prototype-2-375-dark.png | `3193021f87ef50387d3da1e958b0d5cc178bbc9b0fa52bf7a08c26732046290f` |
| prototype-2-375-light.png | `929f857315fcebf2ae3f2d812e8d049647c23ecaeabf6896982d6048aa8a9db3` |
| prototype-3-1440-dark.png | `848ca4b80fe8094f5de91cb1b2875e46fe6ec97d432bfc1b6acc9c2a6b88d141` |
| prototype-3-1440-light.png | `6ef4d8d90da2c90e25fd163d2b162e6c7d94ab99d45981b38a4df93978f842b2` |
| prototype-3-375-dark.png | `04ebf871a4903d763e172dea7e7356629381b71902045afc11377d9a0bd8b286` |
| prototype-3-375-light.png | `2d4a15e1f22969833fd0ee74df8c26c145f0bd9510cae8b6b7fb86d12c124849` |

## Bàn giao lần đầu

Điền Result của task trong cùng PR. Không sửa CURRENT-STATE/ROADMAP hoặc các file người dùng cấm. Part(b) còn mở; không merge. Claude Code review độc lập tiếp theo. Pipeline thật/provider/model và semantic acceptance ngoài scope: NOT_RUN.

## Sửa sau review độc lập PR #100

- Agent: Codex. Người dùng chuyển kết luận review “Đạt sau khi sửa nhỏ” và yêu cầu sửa trên cùng nhánh, có RED, cập nhật Result/log, chạy lại check/browser, không merge.
- Commit mã sửa review: `af27e82a50a3bcdd1be0df9aa455dbc952421501`; mã sản phẩm không đổi sau khi chạy hai gate cuối. Commit bàn giao tiếp theo chỉ sửa tài liệu.
- P2 empty state: chỉ hiện câu “Chưa có dịch vụ nào được kết nối” và link khi tải xong, không error và không có configured service. Hai unit riêng kiểm loading/error.
- P2 thẻ gợi ý: chép cấu trúc/class thẻ nguồn, có p-1.5, group-hover:scale-105, font-medium leading-snug và tên dịch vụ có màu; giới hạn 4. Bảng palette đặt trong asset `cockpit-services.json` cùng logo/prompt, JSX tra bằng id từ API; không thêm branch dịch vụ vào core. Có dark override cho decoration tím mới của Slack. Source grid giữ hai cột desktop, một cột mobile.
- P3 focus ring: loại `#prompt-input` và `#custom-sheet-input` khỏi outline cam chung; giữ chỉ báo focus của khung/border nguồn và outline trong suốt cho forced colors. FE-04 browser thay assertion outline cam của input bằng outline trong suốt + border khung, chờ transition kết thúc. Browser clarification kiểm custom input tương tự.
- P3 blur: null relatedTarget khi click vùng trống tắt cờ đang gõ nếu input còn trong document; input bị gỡ khi chuyển khoảnh khắc giữ ý định gõ. Có unit và browser 1440/375 sáng/tối: click input → click khoảng trống của main → hoàn thành 5 → 6, h1 nhận focus. Gate approval HTTP giữ moment5 đủ lâu để kiểm mà không giả state/execution. Các ca giữ focus đang gõ và dialog tiếp tục đạt.
- P3 clarification: chỉ nhận diện lựa chọn trùng chính xác tên/id trong catalog, không dùng service của gather làm logo mặc định. Các lựa chọn khác có icon tài liệu trung tính; context API hiện ngay dưới h1. Unit gồm GitHub, Slack, tên tài nguyên và lựa chọn nhiều dịch vụ.
- P3 bàn giao: đổi log thành `2026-10-07-codex-FE-05b-part-a.md`, thêm Codex vào tiêu đề và sửa link trong Result. Chỉ một log trong PR.

### RED / GREEN và gate sau review

| Lệnh/ca | Output thật |
|---|---|
| RED unit trước sửa | 9 failed / 13 passed (22), exit 1; loading, error, giới hạn 4, bốn ca markup/palette, context/logo và blur |
| RED browser trước sửa, FE-04 và 375 sáng | 2 failed, exit 1; outline cam kép và h1 moment6 không nhận focus sau click vùng trống |
| GREEN unit liên quan | 22/22, exit 0 |
| Guard kiến trúc sau chuyển palette vào asset | 2/2, exit 0 |
| `npm run check` | exit 0; v3 47 + 340 + 196 + 25 + 349 + 447 = 1404; eval 165/165; typecheck/build/bundle security/launcher/node checks đạt |
| `npm run test:browser:v3` | exit 0; 61/61, đủ 11 scenario: default44, auth02 2, auth04 5, clarification2, partial_failure2; sáu scenario liên dịch vụ mỗi scenario1 |
| `git diff --check` | exit 0 |

Log RED/GREEN ngoài repo: `C:/Users/VinhDat/.codex/fe05b-review-red-unit.txt`, `fe05b-review-red-browser.txt`, `fe05b-review-green-unit.txt`. Gate cuối: `C:/Users/VinhDat/.codex/fe05b-review-check-accepted.txt`, `fe05b-review-browser-accepted.txt`. Các lần giữa chừng không đạt do exact của Playwright dùng nhầm trong unit, assertion đọc giữa CSS transition và palette đặt trong TS trái guard kiến trúc đã được sửa; giữ logs riêng, không dùng làm bằng chứng đạt. Không sửa guard để bỏ qua palette.

Môi trường chạy lại: container riêng `ati-fe05ba-review-pg`, postgres16, tmpfs `/var/lib/postgresql/data`, bind 127.0.0.1:55533; sandbox, account theo CI. Không dùng dev15433, không đọc/copy .env. AUTH-04 vẫn OIDC fixture; provider/model thật: NOT_RUN.

### So ảnh thẻ với dịch vụ đã cấu hình

Chạy nguồn React tại `http://127.0.0.1:5180/app-stage` bằng npm run dev, app sandbox tại 5174. Lưu credentials giả của Trello/GitHub/Google Sheets/Notion bằng POST API local, GET đọc lại xác nhận configured=4; không gọi endpoint kiểm kết nối/provider. Các chip vẫn ghi “Chưa kiểm tra”; không giả healthy. Ảnh dùng dữ liệu API này, không sửa store hoặc source prototype.

Thư mục ngoài repo: `C:/Users/VinhDat/.codex/fe05b-review-evidence-20261007/images`. 18 ảnh: 8 nguồn/app viewport + 4 đặt cạnh nhau ở 1440×900/375×812 sáng/tối, thêm 4 ảnh toàn trang mobile + 2 đặt cạnh nhau để thấy đủ bốn thẻ. Đưa chuột ra khỏi card trước khi chụp, tránh hover vô tình từ nút login. Đã kiểm trực quan các cặp desktop và mobile sáng/tối, không tuyên bố pixel-diff=0.

| Viewport/theme app | Header | scrollWidth | Số thẻ / textarea | Font-weight thẻ | Padding icon |
|---|---|---|---|---|---|
| 1440 / light | 86px | 1440px | 4 / 1 | 500/500/500/500 | 6px/6px/6px/6px |
| 1440 / dark | 86px | 1440px | 4 / 1 | 500/500/500/500 | 6px/6px/6px/6px |
| 375 / light | 86px | 375px | 4 / 1 | 500/500/500/500 | 6px/6px/6px/6px |
| 375 / dark | 86px | 375px | 4 / 1 | 500/500/500/500 | 6px/6px/6px/6px |

App và nguồn đều đo được weight500/padding6px. Palette icon khớp dịch vụ tương ứng của nguồn, gồm blue/green/neutral và GitHub nền tối, logo sáng. Khác biệt còn lại: prompt/thứ tự/card một dịch vụ lấy từ catalog đã cấu hình, nguồn có ví dụ ghép nhiều dịch vụ; số logo theo nội dung, dùng asset sẵn có; app disabled khi draft rỗng; chip có trạng thái unchecked. Header không có menu demo. Độ cao card/độ dài trang thay đổi theo câu gợi ý và trạng thái thật; các class thẻ theo nguồn.

### SHA256 ảnh mới sau review

| File | SHA256 |
|---|---|
| app-connected-1-1440-dark.png | `c8a68b4e47b0dead0f8577dbb35eebd1dc102b134c35887fb6bca306ab959c91` |
| app-connected-1-1440-light.png | `b28df3c100a2cff1a32802a9f52cee40b93eee067ed502aa054da8e8ee47c227` |
| app-connected-1-375-dark.png | `6d93ac61051083ee5368f7b9fd69000192c4fa2cfeab6d97da32824f67227d25` |
| app-connected-1-375-light.png | `5c77c73e4584097903b897f4cfaedd5e1537b3b0c2a0f613eba0992c3a95c4c7` |
| app-connected-full-1-375-dark.png | `bac712dbe190d43bf7322dbab98303ab496313b08bb248ecc9c1fd928a6c8719` |
| app-connected-full-1-375-light.png | `2e9b110bffb3dc029df0aacfc020bbbd16a04979b1655505853f1b71b48e2ddb` |
| compare-connected-1-1440-dark.png | `a26b4f7c1f9c47388f80b3c6858221f0a9436f104965704b58d492532b7de304` |
| compare-connected-1-1440-light.png | `3d931bbb4c0dbe10386511b7faf12fd5eba1bda479c12ea66f996b3b8f38d546` |
| compare-connected-1-375-dark.png | `f9dabbd5474b0c405ffc123623efda5995dfb7ae863590feebc53684a7f19084` |
| compare-connected-1-375-light.png | `3307b033c4cf175ceb50d0884d1934a5adaa6a5369dbfa1c054f380068608447` |
| compare-connected-full-1-375-dark.png | `0968fde894eee79178529526a0c2bfed1066826e18fc490fd967626f532fd5ee` |
| compare-connected-full-1-375-light.png | `c85dd3e38f41637f9d4c859b47a104ff5d08b15fa8f34347526f3f4ab1ea78b8` |
| prototype-connected-1-1440-dark.png | `1c768978f041d6d0456a094f1ae18284e0d2326cc978abfa878b669648e93203` |
| prototype-connected-1-1440-light.png | `d4adff357236669f5b422f520f059091ce709200517ec138fc616067c1c0d9ca` |
| prototype-connected-1-375-dark.png | `274378e591f041807363f7dbcd786f0711365539b16e43f7493dfbb3c7ee0fe4` |
| prototype-connected-1-375-light.png | `afc2eb7757896466fef4d96bd046f66e44d92a09e0a9073faad5317480a5d835` |
| prototype-connected-full-1-375-dark.png | `3e01ba01b9ba0aec9bbf306491828c531685a5b98e19144fa031bc26961e8b82` |
| prototype-connected-full-1-375-light.png | `70a6f15e13c05093066a10f1318f4f0ff98e72d245c571c2c6c6af104a7aa909` |

### Bàn giao sau review

PR #100 trên cùng nhánh, chưa merge; chờ reviewer kiểm delta. Phần (b), mục5–9 và11 còn mở, không chuyển P3 nào của review này sang phần(b). CURRENT-STATE/ROADMAP và file riêng bị cấm không đổi. Worktree/bằng chứng giữ để review; server và PostgreSQL tạm được dọn sau khi chụp xong.
