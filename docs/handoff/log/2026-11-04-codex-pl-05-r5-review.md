# 2026-11-04 · Codex · PL-05 re-review vòng 5

## Kết luận

**ĐẠT — nghiệm thu hoàn tất PL-05 (Chat Feed & One-Composer Policy) trên HEAD `e97d71862cee773be9e37f9ef9e456ea36975932`.** Finding R5 (P2) được đóng bằng kiểm chứng browser thật và thử nghiệm độ nhạy regression; không phát hiện lỗi chức năng cần sửa thêm trong phạm vi vòng review này.

Khuyến nghị **fast-forward integration branch `codex/planora-ui`** từ `b9230b8b592237275866e027c1744362ef4c6eda` tới HEAD đã review, theo quyền tích hợp của coordinator và gate CI hiện hành. Reviewer không thực hiện merge, push hay cập nhật `CURRENT-STATE.md` / `ROADMAP.md`.

## Identity, phạm vi và môi trường

- Base: `b9230b8b592237275866e027c1744362ef4c6eda`.
- Head đã kiểm: `e97d71862cee773be9e37f9ef9e456ea36975932`.
- Parent / Round 4: `5bf4b501a64124a6bab0f6161fa480083a08bb9f`.
- Feature branch: `longnguyen005/feat-planora-pl-05`; review branch: `longnguyen005/review-planora-pl-05-r5`.
- Worktree: `C:\Users\Admin\orca\workspaces\ATI_Project\review-planora-pl-05-r5`.
- SHA đầy đủ ban đầu trong dispatch (`e97d7186f8a4bf5f510ba4dae286cf2571cb145e`) không tồn tại trong object database; coordinator/user đã xác nhận dùng full SHA thực tế ở trên trước khi hoàn tất review.
- `git merge-base --is-ancestor codex/planora-ui e97d7186`: exit **0**; integration ref tại thời điểm kiểm là đúng Base, đủ điều kiện ancestry cho fast-forward.
- Working tree sạch khi bắt đầu; không sửa code production hay test được track. Chỉ thêm báo cáo này; probe tạm và ảnh được chuyển ra thư mục evidence cục bộ sau kiểm tra.
- Chromium headless qua Playwright của repository, API/Vite sandbox riêng ở port **3045/5195**; PostgreSQL thật, cluster mới riêng ở **127.0.0.1:55545**, migration và provision admin đều exit **0**. Không dùng `.env` live, DB của agent khác hoặc provider thật.
- Máy chỉ có PostgreSQL **18** cài sẵn và Docker Desktop không khởi động được; review dùng PostgreSQL 18 riêng, **không claim đã chạy PostgreSQL 16**.

## Đối chiếu diff và R5

Đọc diff Base→Head cùng các component feed, active turn, workspace, composer và CSS containment; đối chiếu task card, migration design, handoff và review checklist. Delta Round 4→Head chỉ có:

1. `apps/chat-web/tests/browser/planora-chat.spec.ts`: locator duy nhất `page.locator('#btn-tech-toggle')` ở dòng 275, giữ nguyên assertion đáy nút nằm trên footer và hit-test tại tâm nút; bổ sung wheel + kiểm tra document scroll bằng 0.
2. `docs/handoff/log/2026-11-04-gemini-pl-05-review-r4-fixes.md`: log bàn giao.

Locator không còn có thể chọn nhầm nút Duyệt kế hoạch. Assertion hình học và pointer target kiểm đúng nút kỹ thuật ở cuối thanh hành động. Ngoài chạy spec nguyên bản, reviewer dùng probe riêng để di chuyển con trỏ thực sự vào feed trước wheel, chờ animation frames, đồng thời kiểm `document.scrollHeight <= viewportHeight`; vì vậy kết luận không dựa riêng vào lần đọc scrollTop tức thì trong spec.

### Bằng chứng độ nhạy (RED → GREEN)

- Tạo bản sao tạm của đúng test `R4 multiline`, chỉ thêm CSS override `padding-bottom: 112px !important` cho feed để tái tạo khoảng đệm tĩnh cũ; không sửa production hoặc spec gốc.
- `node scripts/test-v3-browser.mjs r5-sensitivity.spec.ts`: **exit 1**, **1 failed**, đúng assertion `toggleBox.y + toggleBox.height < footerBox.y`; **Expected < 610, Received 662**. Đây là RED có chủ đích, chứng minh nút kỹ thuật bị footer che được phát hiện; không phải lỗi HEAD.
- `node scripts/test-v3-browser.mjs planora-chat.spec.ts --grep 'R4 multiline'` trên HEAD nguyên bản: **exit 0**, **1 passed (5.3s)**.
- **R5: CLOSED.**

## Lệnh kiểm tra và output thực tế

Các browser command dưới đây dùng environment sandbox riêng nêu trên; helper environment và artifact nằm tại `%TEMP%\pl05-r5-review`, không chứa thông tin xác thực production.

| Lệnh | Kết quả quan sát | Exit code |
| --- | --- | --- |
| `npm run typecheck:v3` | API và web TypeScript không lỗi | **0** |
| `npm test -w @wap/chat-web` | `Test Files 100 passed (100)`; `Tests 1115 passed (1115)`; 33.83s | **0** |
| `npm run build:v3` | `196 modules transformed`; `built in 633ms`; sinh production assets | **0** |
| `node scripts/test-v3-web-build-security.mjs` | `PASS: production build excludes credential sentinels and 7 forbidden UI claims` | **0** |
| `node scripts/test-v3-browser.mjs planora-chat.spec.ts` | **16 passed (21.5s)** trên HEAD hiện tại | **0** |
| `node scripts/test-v3-browser.mjs fe-05-cockpit.spec.ts` | **4 passed (11.0s)**: sandbox request → preview/edit → drawer → approve → receipt; desktop/mobile, light/dark | **0** |
| `node scripts/test-v3-browser.mjs r5-review-probe.spec.ts` (probe reviewer tạm) | **12 passed (24.2s)**: 10 tổ hợp layout + 2 nhóm route ngoài chat | **0** |
| `node scripts/test-v3-browser.mjs r5-review-probe.spec.ts --grep 'review probe (1440\|375) light'` | **2 passed (7.8s)**; chụp và xem ảnh preview/composer nhiều dòng desktop/mobile | **0** |
| `node scripts/test-v3-browser.mjs planora-chat.spec.ts --grep 'R4 multiline'` | **1 passed (5.3s)** sau sensitivity RED | **0** |

## Probe layout, scroll và padding độc lập

Reviewer tạo hội thoại thật trong PostgreSQL với **40 tin nhắn + pending plan** cho mỗi tổ hợp viewport/theme, mở deep link `/c/:id` qua ứng dụng thật; không cho phép test thoát sớm khi thiếu user. Spec nguyên bản bổ sung kiểm tra feed 80 tin nhắn.

Các số dưới đây được đo khi dock chứa **14 dòng draft** và feed ở đáy; light và dark đều đạt cùng kết quả hình học:

| Viewport | Feed client / scroll height (px) | Footer height / feed padding-bottom (px) | Đáy nút kỹ thuật / đỉnh footer (px) | Document scrollHeight / viewport (px) |
| --- | --- | --- | --- | --- |
| 1440×900 | 821 / 4801 | 206 / 246 | 598.5 / 694 | 900 / 900 |
| 1024×768 | 689 / 4821 | 206 / 246 | 466.5 / 562 | 768 / 768 |
| 768×1024 | 886 / 4821 | 206 / 246 | 726.5 / 818 | 1024 / 1024 |
| 375×812 | 674 / 6644 | 202 / 242 | 532 / 610 | 812 / 812 |
| 320×568 | 430 / 6726 | 202 / 242 | 288 / 366 | 568 / 568 |

Tất cả 10 tổ hợp đều xác nhận:

- Feed bị giới hạn trong viewport, `scrollHeight > clientHeight`, không nở theo lịch sử; document scrollTop bằng 0 sau wheel ở đáy feed; không tràn ngang.
- Padding thực tế bằng `max(96, footerHeight + 16) + 24`; tăng khi textarea giãn và giảm khi draft trở lại một dòng. Ví dụ desktop **138→246→138px**, mobile 375 **146→242→130px**.
- Hit-test tâm `#btn-tech-toggle` trả về chính nút hoặc phần tử con; nút nằm hoàn toàn trên footer. Xem ảnh ở desktop/mobile xác nhận action bar và dock tách rời, nút không bị textarea che.
- Dock desktop bắt đầu ở **x=248px**, các viewport dưới 1024 ở **x=0px**.
- Khi đang đọc lịch sử ở `scrollTop=100`, thêm message vào store thật của ứng dụng vẫn giữ vị trí **100**; khi ở gần đáy, thêm message tự cuộn tới đáy với sai số không quá **1px**. Phần lịch sử ban đầu đến từ DB thật; message bổ sung dùng trực tiếp store frontend để kiểm riêng phản ứng của feed, không claim đây là kiểm thử SSE transport.
- Dock → “Sửa qua Chat” → drawer hội thoại → Escape → đóng ô sửa đều giữ **đúng 1 textarea hiển thị**, bảo toàn nội dung draft và không tự gửi. Bộ unit 17 test PL-05 cùng FE-05 tiếp tục kiểm IME, Enter/Shift+Enter, các moment và approval/receipt.
- Chuyển sang `/settings`, `/guide`, `/history`, `/account` ở 1440px và 375px đều gỡ containment chat và cuộn document được bằng wheel. Ví dụ desktop scrollTop sau wheel: settings **1405**, guide **1307**, history **1446**, account **3000**; mobile tương ứng **2136**, **3000**, **2742**, **3000**. Spec PL-05 nguyên bản cũng kiểm settings ở cả light/dark.

## Evidence, giới hạn và bàn giao

- Evidence cục bộ: `C:\Users\Admin\AppData\Local\Temp\pl05-r5-review\` gồm `browser.log`, `fe05.log`, `probe.log`, `sensitivity.log`, `r5-green.log`, `visual.log`, 10 file `metrics-<width>-<theme>.json`, ảnh `preview-1440-light.png` / `preview-375-light.png`, cùng source probe tạm được lưu để tái chạy. Đây là artifact máy reviewer, không phải CI artifact được upload.
- Vite có warning `ResizeObserver loop completed with undelivered notifications` khi giãn/thu textarea. Ghi nhận warning; các phép đo sau animation frames, giữ vị trí đọc, bám đáy, padding, hit-test và ảnh đều đạt; không quan sát lỗi chức năng từ warning trong các probe đã chạy. Build có warning chunk >500kB; build vẫn exit 0.
- Không chạy lại toàn bộ browser suite hay provider/OAuth/model live, không xác minh CI từ GitHub trong phiên này. Không diễn giải **16/16 PL-05 + 4/4 FE-05** thành full browser PASS.
- `fe-02-routing-history.spec.ts:60`: theo kết quả đối chứng baseline độc lập Round 4 đã được dispatch xác nhận, đây là lỗi có sẵn ở `b9230b8b`, không quy cho PL-05; vòng 5 không tuyên bố lỗi đó đã được sửa và không chạy lại đối chứng baseline.
- Full SHA được khóa ở phần đầu báo cáo; kết luận áp dụng cho scope PL-05 tại SHA đó, không phải nghiệm thu toàn bộ nền tảng đa dịch vụ hay production readiness.
- **Việc tiếp theo:** coordinator có thể nghiệm thu PL-05 và fast-forward `codex/planora-ui` tới HEAD đã review khi gate CI/quyền tích hợp thỏa mãn; cập nhật tài liệu trạng thái sau tích hợp theo quy trình repo.

**STATUS: REVIEW_PASS — PL-05 ACCEPTED, R5 CLOSED.**
