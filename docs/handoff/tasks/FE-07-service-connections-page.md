# FE-07 · Trang Kết nối dịch vụ

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/fe-07-service-connections` · **Phụ thuộc:** FE-04b đã merge (lớp nền bản React; FE-04 đã merge); UI-API-01 phần 2 để lưu riêng nơi được dùng · **Mốc:** 20/10/2026
**Đặc tả:** mục 3, 6, 9 · **Bản mẫu:** `settings.html`

## Vì sao quan trọng

Đề tài là nền tảng đa dịch vụ, nhưng `SettingsModal` hiện là lưới thẻ có chữ kỹ thuật ("Allowed Scope (Write Safety)", "AES-256-GCM", biểu tượng chữ cái). Quản trị viên khó biết dịch vụ nào đang dùng được và vì sao.

## Hiện trạng

- `SettingsModal` + `ServiceCard`: ô khoá, danh sách nơi được dùng, nút Kiểm tra và Lưu cấu hình. `GET /api/services` trả `configured`, `connectionStatus`, `lastCheckedAt`, `allowedScope`, `credentialFields`, `scopeLabel`, `tools`.
- Lưu bắt buộc gửi đủ khoá (`hasValidCredentials`), chỉ quản trị viên (`isAdmin`); kiểm tra kết nối ai cũng gọi được; kết quả kiểm tra lưu trong bộ nhớ tiến trình.

## Việc cần làm

**Cách làm (đổi 07/10/2026, đặc tả mục 1.2):** chép `Settings/SettingsPage.tsx` từ `docs/design/prototypes/react/src/pages/` sang app sau khi FE-04b đã merge; giữ nguyên markup, class, cỡ chữ và màu của bản mẫu; bỏ JS demo, nối store/API; giữ các bảo đảm hành vi đang có. Ảnh "giống bản mẫu" so với trang tương ứng của bản React (`npm run dev` trong `docs/design/prototypes/react/`). Các mục dưới đây là phần dữ liệu và hành vi phải đúng.

1. Trang `/settings` thay `SettingsModal`:
   - tóm tắt "x / 8 dịch vụ đã thiết lập · y kết nối tốt";
   - hai nhóm "Đã thiết lập" / "Chưa thiết lập" theo `configured`;
   - mỗi hàng: logo SVG, tên, việc làm được (diễn đạt từ `tools`), nhãn trạng thái 4 giá trị (đặc tả mục 6) kèm giờ kiểm tra.
2. Ngăn chi tiết (phải trên desktop, toàn màn hình dưới 640px), 3 phần:
   - **Khoá truy cập:** nhãn ô theo `credentialFields`; "Lấy khoá ở đâu?" lấy nội dung từ `guide` (FE-10) hoặc chuỗi tĩnh cùng nguồn; khoá đã lưu không hiện lại, placeholder "Đã lưu · nhập lại nếu muốn thay";
   - **Nơi ATI được phép dùng:** chip theo `scopeLabel`, kiểm định dạng (GitHub `owner/repo`, Jira site `https://…atlassian.net`), cần ít nhất một mục;
   - **Kiểm tra kết nối:** khoá khi chưa `configured` kèm câu "Lưu khoá và ít nhất một nơi được dùng trước, rồi mới kiểm tra được"; kết quả trong vùng `aria-live`: thành công kèm thời gian phản hồi, bị từ chối, quá 10 giây.
3. Lưu:
   - đổi khoá: gửi đủ khoá như hiện tại;
   - chỉ đổi nơi được dùng: dùng API của UI-API-01, không bắt nhập lại khoá; khi UI-API-01 chưa merge thì giữ cách cũ và hiện ghi chú "Muốn lưu thay đổi, nhập lại đủ các ô khoá";
   - lưu xong nhãn về "Chưa kiểm tra".
4. Thành viên: ô khoá, chip, nút Lưu bị khoá kèm câu "Chỉ quản trị viên thay đổi được khoá dùng chung của nhóm."; nút Kiểm tra vẫn dùng được khi đã thiết lập.
5. `/settings#<service>` mở thẳng ngăn của dịch vụ đó; mã không tồn tại thì không mở gì.
6. Giữ bảo đảm của W3-00b: phản hồi lưu của dịch vụ A không xoá khoá đang nhập dở của dịch vụ B; chỉ xoá trường còn bằng giá trị đã gửi.

## Tiêu chí nghiệm thu

- [ ] Test: dịch vụ chưa thiết lập không kiểm tra được (cả hai vai trò); sau khi lưu nhãn là "Chưa kiểm tra" và hàng chuyển nhóm.
- [ ] Test: thành viên không lưu được, vẫn kiểm tra được dịch vụ đã thiết lập.
- [ ] Test: `#notion` mở đúng ngăn; Esc đóng và trả focus về hàng Notion kể cả khi danh sách vừa vẽ lại.
- [ ] Test W3-00b (giữ draft khi phản hồi lưu đến muộn) chuyển sang trang mới và vẫn xanh.
- [ ] Không còn các chữ "Allowed Scope", "Write Safety", "Least Privilege", "AES" trên giao diện.
- [ ] Browser: quản trị viên lưu và kiểm tra một dịch vụ sandbox; không cuộn ngang ở 375px; chế độ tối giống bản React.
- [ ] **Giống bản mẫu** (đặc tả mục 1, 1.1, 1.2 bản 07/10; chép trang của bản React rồi nối dữ liệu thật): ảnh app và ảnh bản React của `settings.html` (danh sách, ngăn từng dịch vụ, vai trò quản trị viên và thành viên) đặt cạnh nhau ở 1440×900 và 375×812, sáng và tối. Danh sách ảnh và SHA256 ghi trong log; ảnh không commit. Mọi khác biệt còn lại nằm trong đặc tả 1.1 hoặc ghi ở phần "Kết quả" kèm lý do.
- [ ] `npm run check` và `npm run test:browser:v3` exit 0.

## Ngoài phạm vi

Gỡ khoá dịch vụ, lưu tên tài nguyên kèm ID, kiểm tra kết nối bền qua khởi động lại.

## Kết quả

**Thi công xong, chờ Claude Code review độc lập; chưa merge.** Nhánh `feat/fe-07-service-connections`, worktree riêng trên `eb48f0b` (main mới hơn `564b6cb`). Commit mã: f4ea1283a82328f67fa5298a22fcc82532877d19.

- Chép markup/class của trang React Settings và `page.css` nguyên byte; `usePrototypePage(meta)`, route ngoài AppShell, header dùng user thật và UserNavMenu prototype. Xoá SettingsModal; không sửa prototype/theme, Cockpit, planner/evaluations, CURRENT-STATE hay ROADMAP.
- API thật cho danh sách, lưu đủ khoá, PUT scope riêng và kiểm tra kết nối; nhãn 4 trạng thái + giờ kiểm tra, nhóm theo configured, xoá draft theo đúng dịch vụ và giá trị đã gửi. Giữ toàn bộ 4 ca HTTP W3-00b và các ca hành vi Settings cũ, gồm metadata tải lại sau lưu.
- Ngăn phải desktop/toàn màn hình mobile, focus trap, Esc/backdrop, trả focus bằng id hàng hiện tại; hash hợp lệ mở đúng dịch vụ. Thành viên chỉ đọc cấu hình và vẫn kiểm tra được dịch vụ đã thiết lập. Hướng dẫn lấy khoá dùng nguồn AUTH-06/W3-07/evaluations và link chính thức.
- TDD: RED 15/15 trên UI cũ; RED bổ sung token refresh, AbortSignal thật, câu phản hồi tiếng Việt, hướng dẫn scope rỗng và HTTP trả headers nhưng treo body. GREEN: `npm run check` exit 0 (1.454 unit/integration + 165 eval + build/typecheck + 11 launcher/fixture); `npm run test:browser:v3` exit 0 (69 ca/11 scenario) trên PostgreSQL tmpfs riêng DB55536/API3006/web5186.
- Visual: 160 ảnh source/app (2 viewport × 2 theme × 2 vai trò × 10 trạng thái × 2 nguồn), 80 ảnh ghép + 16 contact sheets; đã xem 16 bảng đối chiếu. Không cuộn ngang; mobile panel 375×812; desktop panel 576×900. SHA256 đầy đủ trong [log FE-07](../log/2026-10-08-codex-FE-07.md); ảnh nằm ngoài repo, không commit.
- Khác biệt có lý do: bỏ demo, thêm menu user thật (1.1); tool/field/scope/giờ và trạng thái thật (1.1.2/6); logo theo cockpit-services.json theo yêu cầu; sửa gợi ý Notion/Google/Telegram và placeholder để không bịa hoặc trình bày giá trị khoá mẫu; ghi chú scope-only theo UI-API-01 đã merge; aria-live/focus/100dvh không đổi kiểu mẫu (1.1.4). Khoá giả bị provider từ chối, nên không dựng trạng thái healthy cho ảnh.
- FE-04: bỏ đúng assertion 40×40 cho nút xoá chip settings (1.1.4/1.2.6); giữ test thêm/xoá chip và các assertion khác.
- NOT_RUN: provider healthy bằng khoá thật/ghi dịch vụ thật, screen reader và nghiệm thu sản phẩm. Timeout/healthy UI được kiểm bằng HTTP loopback thật; browser dùng API/PostgreSQL thật và nhận thất bại thật từ provider với khoá giả. Không tuyên bố nghiệm thu toàn nền tảng.

**Sửa P2 sau review Claude Code (08/10):** [review trên 003719c](https://github.com/VinhDat267/ATI_Project/pull/108#issuecomment-6056958988) kết luận “Đạt sau khi sửa nhỏ”. Commit `658420c3725bc737a843459c93a1e685723eee7a` chỉ dựng tóm tắt/hai nhóm khi đã có danh mục, không báo số liệu hoặc câu trống khi GET đầu tiên đang tải/lỗi. Hai test HTTP mới RED 2/2 trước sửa, GREEN cùng 4 file Settings 46/46; kiểm cả release/retry hồi phục. `npm run check` exit 0 (1.456 v3 + 165 eval, typecheck/build), browser 69/69 exit 0 trên tmpfs riêng 55536. Thêm 8 ảnh tải/lỗi ở hai viewport, sáng/tối; SHA256 trong [log sửa P2](../log/2026-10-08-codex-FE-07-review-p2.md), ảnh không commit. Không đổi class/CSS khi đã có dữ liệu. Năm P3 và AUTH-01 chập chờn theo reviewer được ghi trong log để xử lý sau. Chờ Claude Code review lại delta; chưa merge.
