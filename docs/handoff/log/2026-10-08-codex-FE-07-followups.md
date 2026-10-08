# FE-07 — Năm P3 sau review #108

08/10/2026 · Codex · nhánh `fix/fe-07-followups` · chờ CI đúng head và Claude Code review độc lập; không tự merge.

## Phạm vi và lý do không có task card

Người dùng chỉ định sửa trực tiếp năm P3 ở hàng “P3 từ review FE-07 #108” trong CURRENT-STATE mục 5 và [bình luận Claude Code](https://github.com/VinhDat267/ATI_Project/pull/108#issuecomment-6056958988), đồng thời ghi rõ không có task card riêng. Vì vậy kết quả đợt sửa nằm trong log này; không tạo/sửa task card, CURRENT-STATE hoặc ROADMAP. FE-07 gốc đã merge tại `d5e7a9e`; không tiếp tục worktree cũ.

Đã đọc AGENTS.md, handoff README/CURRENT-STATE và ba log mới nhất lúc nhận việc: `2026-10-08-codex-FE-07-review-p2.md`, `2026-10-08-codex-FE-07.md`, `2026-10-08-codex-fe-06a-cockpit-recovery.md`. Đã kiểm `git status` và `git log -5`: main có thay đổi của người dùng ở `.gitignore`, `PRODUCT.md`, `docs/reports/`, `skills-lock.json`; không đụng vào chúng. Đã fetch origin, tạo worktree Orca mới `C:/Users/VinhDat/orca/workspaces/ATI_Project/fe-07-followups` từ origin/main `c37e2e95eeac8881153b0bd0ff23dae423ac9b2c`, đổi tên nhánh thành `fix/fe-07-followups`. Worktree mới không có .codegraph; trước đó đã dùng CodeGraph trên main khi đọc đường đi API/hook.

## Kết quả

Commit mã: `cd35c612435e155a88d1a99975436ac40fcf2dcc` (`fix(settings): resolve FE-07 review followups`).

1. `assets/settings-services.json` thêm `fieldHints.placeholder` cho Site URL/Email Atlassian và clientEmail của Sheets/Calendar. `pages/Settings/data.ts` đọc metadata theo khóa trường; chỉ ô text dùng gợi ý. Password/multiline vẫn “Nhập khoá truy cập”, không có giá trị khoá mẫu, không rẽ nhánh TypeScript theo mã dịch vụ.
2. GET `/api/services` trả `canConfigure` bằng đúng `isAdmin(req.user, options.adminUserIds)`, chung luật với POST credentials/PUT scope. ApiClient khai báo trường này; hook chỉ cho sửa khi API trả đúng boolean true, mặc định khoá nếu thiếu/false, xoá quyền khi đổi người dùng và giữ guard của response muộn. Thanh trên vẫn lấy role thật của người dùng: thành viên trong allowlist sửa được nhưng không bị gọi là quản trị viên. Bốn test HTTP dùng session/user/credentials thật trên PostgreSQL (admin, member allowlist, member thường, thay role DB không đổi token); GET khớp cả hai route ghi. Các fixture GET cũ được bổ sung capability tường minh.
3. Xoá `components/ServiceCard.tsx` (không còn sản phẩm nào dùng), ba ca riêng trong `settings.test.tsx` và hai ca riêng trong `service-naming.test.tsx`. Giữ tất cả ca SettingsPage, gồm bảo đảm W3-00b và focus khi hàng được thay thế. Guard kiến trúc bắt file cũ quay lại. Sáu file Settings hiện có 57 test đạt; không mất ca của trang mới.
4. Hai nhóm dùng wrapper không class `role=listitem` bao quanh hàng `role=button`; các thông báo nhóm trống cũng có role=listitem. Giữ nguyên class của hàng và CSS. Test kiểm trực tiếp list > listitem > button ở cả hai nhóm, class của hàng và wrapper không class. `page.css` của app và React đều có SHA256 `A4CF38E9660041BE2A6E2DCBBFD568F8D9F896009AA9D3AEB939413D6BB49FA7`; không sửa theme.css/index.css/App.tsx hay prototype.
5. Ca browser thành viên tự đăng nhập admin qua API và POST credentials Notion giả với phạm vi hợp lệ trước khi đăng nhập thành viên. Assertion riêng kiểm nút Kiểm tra enabled; chạy `--grep 'FE-07: member'` đạt trên DB chưa có Notion, không cần ca admin chạy trước.

Không sửa pages/Cockpit, components/Cockpit.tsx, packages/planner hoặc evaluations. Test FE-05 chỉ cập nhật shape GET fixture để khớp hợp đồng API mới; không sửa hành vi cockpit.

## TDD và bỏ sửa để kiểm test

Evidence ngoài repo: `C:/Users/VinhDat/orca/workspaces/ATI_Project/fe-07-followups-evidence/`; ảnh và raw output không commit. Plan/ledger cũng nằm ngoài worktree để giữ phạm vi giao việc và không sửa .gitignore.

| Mục | RED thật | GREEN | Bỏ sửa/đột biến |
|---|---|---|---|
| Placeholder | 3 failed, 2 passed, exit 1 (`p1-red.log`): Site URL/email Google vẫn có placeholder khoá | 5 passed, exit 0 | Bỏ mapping metadata: 3 failed, 2 passed, exit 1 (`p1-mutation.log`) |
| Quyền GET trên PostgreSQL/HTTP | 4 failed, exit 1 (`p2-http-red.log`): canConfigure chưa có | 4 passed, exit 0 | Bỏ trường GET: 4 failed, exit 1 (`p2-http-mutation.log`) |
| Quyền frontend | 3 failed, exit 1 (`p2-web-red.log`); hai ca false/thiếu bắt được ô vẫn enabled; ca allowlist ban đầu vấp lookup banner ở nền inert | Sau sửa lookup thành hidden:true: 4 passed, exit 0 (gồm response muộn của người dùng trước) | Quay hook về bản gốc: 3 failed, 1 passed, exit 1 (`p2-web-mutation.log`), fail đúng quyền cho allowlist/false/thiếu; không lấy lỗi lookup làm bằng chứng chức năng |
| Xoá ServiceCard | 1 failed, exit 1 (trong `p3-p4-red.log`) | 1 passed, exit 0 | Khôi phục đúng file gốc: 1 failed, exit 1 (`p3-mutation.log`) |
| Cấu trúc list | 1 failed, exit 1 (trong `p3-p4-red.log`): không có listitem | 1 passed, exit 0 | Bỏ cả hai wrapper: 1 failed, exit 1 (`p4-mutation.log`) |
| Browser thành viên độc lập | 1 failed, exit 1 (`p5-red.log`), nút Kiểm tra disabled sau 10 giây khi Notion chưa configured | 1 passed, exit 0 (`p5-green.log` và `p5-green-final.log`), chỉ chọn ca member | Bỏ seed, xoá riêng fixture Notion trong container tạm của nhánh: 1 failed, exit 1 (`p5-mutation.log`), cùng lỗi disabled. Khôi phục mã rồi chạy riêng đạt lại |

Mỗi phép đều phục hồi đúng byte của mã đã sửa bằng finally trước khi kiểm tiếp; không để lại đột biến. Chỉ reset Notion của DB tmpfs do nhánh này tạo, không chạm DB dev.

Lượt `check` đầu exit 1 (`check-first-fail.log`): 3 ca draft/focus của `components/settings-page.test.tsx` còn dùng fixture JSON thiếu canConfigure; 544 frontend ca khác đạt. Đã cập nhật đúng ba fixture GET, giữ nguyên assertion. Chạy lại nhóm Settings gồm sáu file: **57/57, exit 0** (`settings-green-final.log`). Không coi lần fail này là flaky.

## Nghiệm thu toàn bộ

Môi trường: PostgreSQL16 tmpfs riêng `ati-fe07-followups-pg`, DB55538/API3008/web5188, V3_LOCAL_DB_PORT/PORT/V3_WEB_PORT tường minh, sandbox. Admin test theo `.github/workflows/v3-check.yml`. Không có .env mới/sửa và không dùng DB15433. Migration/provision exit 0 sau khi PostgreSQL ready (lần migrate ngay lúc container vừa khởi động báo connection terminated; chờ ready rồi chạy đạt).

- `npm run check`: **exit 0** (`check-final.log`). V3 **47 + 340 + 196 + 25 + 353 + 547 = 1.508**; eval **165**; typecheck/build đạt; build security PASS; launcher **1**, fixture/environment guards **10**, không fail.
- `npm run test:browser:v3`: **exit 0**, **73/73** qua 11 nhóm, lần chạy đầy đủ đầu tiên đạt (`browser-final.log`): default 56, auth02 2, auth04 5, clarification 2, partial_failure 2, sáu workflow nhóm sau mỗi nhóm 1. Cả bốn ca FE-07 (admin, mobile sáng/tối, member) đạt.
- Browser thành viên chạy riêng sau khôi phục đột biến: **1/1, exit 0** (`p5-green-final.log`).
- `git diff --check`: không lỗi khoảng trắng.
- Review nội bộ độc lập trên `c37e2e9..cd35c61`: không thấy lỗi correctness/regression cần sửa; reviewer tự chạy **57/57**, sáu file, exit 0 và diff check sạch. Reviewer không chạy DB/browser/full CI; bằng chứng đó thuộc lượt chạy của agent chính. Không thay thế Claude Code review PR.

## Giới hạn và quyết định để người dùng xem

API kiểm tra kết nối vẫn gọi dịch vụ thật trong sandbox. Browser dùng khoá Notion giả và nhận phản hồi từ chối/lỗi mạng hoặc hết 10 giây; CI còn phụ thuộc mạng ra ngoài. Đợt này chỉ làm ca thành viên độc lập, không thêm fetch giả hoặc đổi kết quả kiểm tra kết nối. Người dùng quyết định riêng có cần thay đổi cách kiểm tra ở sandbox hay không.

Không chạy nghiệm thu provider với khoá thật và không chụp lại ma trận ảnh FE-07 của đợt port trước; không nhận bằng chứng cũ là ảnh mới. Class/CSS được giữ và kiểm bởi test nguyên văn/structure, browser sáng/tối 375px và focus đều đạt trong bộ nghiệm thu vừa chạy. Chưa tự merge; bàn giao cho Claude Code review và exact-head CI.

Sau nghiệm thu: giữ worktree/nhánh cho review; đã xoá đúng container tmpfs ati-fe07-followups-pg và xác nhận DB55538/API3008/web5188 không còn listener. Hai container FE-06A của agent khác còn nguyên. Raw logs/plan/ledger nằm ngoài repo và giữ lại để đối chứng.
