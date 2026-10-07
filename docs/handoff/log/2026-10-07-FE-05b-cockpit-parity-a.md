# 2026-10-07 · FE-05b · Cockpit parity, phần (a)

- Yêu cầu: mục 1–4 và 10 của task FE-05b bản 07/10; phần (b) để PR sau. Đọc AGENTS, handoff README/CURRENT-STATE, ba log 07/10 của FE-04b, DESIGN và kế hoạch port trước khi sửa.
- Base: `7df8eacfbbdd686aeda632530b62f2ce3c606aee`; #98/#99 đã có trên main dù CURRENT-STATE chưa ghi. Commit mã: `7501a17b550b0b2652808d64451fd1ad0e7816aa`.
- Worktree: `C:/Users/VinhDat/.codex/worktrees/fe-05b-cockpit-parity-a/ATI_Project`. Nhánh: `feat/fe-05b-cockpit-parity-a`. Primary checkout có PRODUCT.md và các file riêng chưa commit; không đưa chúng vào nhánh này.
- Môi trường: container riêng `ati-fe05ba-pg`, postgres16; `/var/lib/postgresql/data` là tmpfs, bind 127.0.0.1:55533; sandbox, tài khoản test theo CI. Không đọc/copy .env, không dùng 15433, không gọi provider/model thật.
- Mã frontend: App/Workspace/Cockpit nối trang nguồn mới; UserNavMenu thêm variant prototype giữ hành vi/vai trò; CockpitDialog thêm id để aria-controls của header trỏ đúng ngăn; ServiceLogo thêm kích thước tùy chọn, mặc định của phần FE-05 giữ nguyên. `pages/Cockpit/page.css` trùng byte với nguồn; SHA256 cả hai: `F86119DF6A151CF29776A1D8DF46EDFDAC130F4F46D5B7DDB49C45AF1BFE3728`.

## Kiểm chứng

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

## So ảnh với bản React

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

## SHA256 ảnh

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

## Bàn giao

Điền Result của task trong cùng PR. Không sửa CURRENT-STATE/ROADMAP hoặc các file người dùng cấm. Part(b) còn mở; không merge. Claude Code review độc lập tiếp theo. Pipeline thật/provider/model và semantic acceptance ngoài scope: NOT_RUN.
