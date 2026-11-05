# 2026-11-04 · Codex Reality Checker · Review độc lập PL-07

**Kết luận: CHƯA ĐẠT — cần sửa F1 và F2 (P2) trước khi nghiệm thu PL-07.**

Các lệnh bắt buộc đều đạt, gồm 102/102 web test files và 20/20 browser tests. Probe độc lập phát hiện thiếu prefill clarification và các cặp màu không đạt tương phản. Không phát hiện regression cho phép Retry/Continue trên Unknown hoặc Escape gửi Stop trong các ca đã kiểm chứng.

## 1. Định danh và phạm vi

- Reviewer: Codex, review độc lập; không sửa product code.
- Thời gian: 04/11/2026, khoảng 05:13–05:30, Asia/Saigon.
- Base: `514d982fd9fc152290feb305b0d97f2c40dda21a`.
- Head được review: `4405fd36bfda8e46623261c81aaa971301ec834c`.
- Nhánh thi công: `longnguyen005/feat-planora-pl-07`.
- Nhánh reviewer: `longnguyen005/review-planora-pl-07`.
- Worktree reviewer: `C:/Users/Admin/orca/workspaces/ATI_Project/review-planora-pl-07`.
- Card: [PL-07-planora-responses-recovery.md](../tasks/PL-07-planora-responses-recovery.md).
- Worker log: [2026-11-04-gemini-pl-07.md](2026-11-04-gemini-pl-07.md).

Đã kiểm tra HEAD, `git status`, `git log -5`, diff thật của 13 file; đọc handoff, checklist review, module ownership, spec/plan/prompt liên quan. Worktree reviewer ban đầu sạch và đã là nhánh riêng tại head yêu cầu. Diff chỉ gồm 10 file trình bày, một test file, task card và worker log; không thay backend, protocol, `selectMoment` hay controller phục hồi.

## 2. Môi trường và bằng chứng lệnh

Windows, Node.js `v24.14.0`, Playwright Chromium headless. Docker báo `Docker Desktop is unable to start`; reviewer tạo **cluster PostgreSQL native 18.3 riêng**, không dùng DB/server của worker hoặc ứng dụng đang chạy. DB riêng tại `127.0.0.1:55547`, API `3047`, web `5247`, `RUNTIME_MODE=sandbox`; migrate và provision tài khoản kiểm thử riêng đều exit 0. Không nạp `.env` live. PostgreSQL 16 theo hướng dẫn COMMON chưa được chạy; bằng chứng browser cục bộ ở đây dùng 18.3. Cluster đã được dừng sau kiểm thử, dữ liệu fixture được giữ tại thư mục bằng chứng.

| Lệnh chạy lại ở reviewer worktree | Kết quả thực tế | Exit code |
| --- | --- | --- |
| `npm run typecheck:v3` | API và web TypeScript đạt | 0 |
| `npm test -w @wap/chat-web` | **102/102 files, 1141/1141 tests**, 34.60s | 0 |
| `npm run build:v3` | Production build thành công | 0 |
| `node scripts/test-v3-web-build-security.mjs` | `PASS: production build excludes credential sentinels and 7 forbidden UI claims` | 0 |
| `node scripts/test-v3-browser.mjs planora-chat.spec.ts fe-05-cockpit.spec.ts` | **20 passed (34.1s)**, sandbox/PostgreSQL riêng | 0 |
| `node node_modules/playwright/cli.js test --config node_modules/.cache/pl07-review/playwright.config.mjs` | **13 passed, 2 failed (1.1m)**: lỗi prefill và contrast nút dừng | 1 |
| `node node_modules/playwright/cli.js test --config node_modules/.cache/pl07-review/focused.config.mjs` | **1 passed, 1 failed (7.4s)**: thứ tự Stop→send đạt; contrast nhãn đích/banner không đạt | 1 |

Các lệnh browser dùng biến môi trường sandbox riêng từ `node_modules/.cache/pl07-review/env.ps1`. Probe reviewer và config nằm trong cache, không thêm vào production/tests của head được review. Các lỗi thiết lập probe ban đầu (TypeScript dưới node_modules, ép kiểu tham số SQL và endpoint fixture) đã được sửa trước các lần chạy cuối trong bảng; không tính những lỗi harness đó là finding sản phẩm.

Build có cảnh báo chunk >500 kB. Browser có cảnh báo `ResizeObserver loop completed with undelivered notifications`, cũng xuất hiện trong bộ browser bắt buộc; không làm bộ đó fail. Lần kiểm thứ tự edit thành công có background planning error sau khi gửi request mới: assertion chỉ chứng minh Stop→send đúng thứ tự, không chứng nhận planner sinh được kế hoạch mới cho request fixture đó.

## 3. Findings cần sửa

### F1 — P2: Chọn gợi ý clarification không prefill draft của composer

**Vị trí:** `apps/chat-web/src/pages/Responses/ResponseMoment.tsx:435`, `apps/chat-web/src/pages/Cockpit/ClarificationMoment.tsx:133`; wiring liên quan `apps/chat-web/src/planora/workspace/PlanoraChatWorkspace.tsx:326` và `:249`.

**Tái hiện bằng UI thật:**

1. Mở hội thoại có clarification `reason: 'read_only'`, options `Gửi Slack`, `Ghi Google Sheets`.
2. Bấm radio `Gửi Slack`.
3. Composer hiển thị vẫn có value `""`, thay vì `"Gửi Slack"`.

Probe `contract: clarification selection must prefill the dock draft` fail với output:

```text
Locator: locator('textarea:visible')
Expected: "Gửi Slack"
Received: ""
Timeout: 8000ms
```

Nhánh destination cũng chỉ đổi lựa chọn, không điền draft. Probe riêng xác nhận click lựa chọn không POST và không thêm message vào PostgreSQL; bấm `Xác nhận và tiếp tục` mới POST đúng một lần. Vì vậy phần **không tự gửi đạt**, nhưng phần **prefill** trong yêu cầu và acceptance card chưa đạt.

**Nguyên nhân:** cả hai renderer chỉ gọi `onSelect(option)`. Workspace truyền trực tiếp `setSelected`, trong khi composer đọc state `draft` riêng; không có bước đồng bộ lựa chọn vào draft. Test mới của worker chỉ kiểm `onSelect` mock được gọi và `onSend` chưa gọi, nên không phát hiện thiếu tích hợp này.

**Đối chiếu base:** wiring này đã có tại base `514d982f`; đây là **thiếu sót còn tồn tại trong phạm vi nghiệm thu PL-07**, không phải regression hành vi mới do commit CSS gây ra. Card/worker log vẫn khẳng định đã bảo toàn prefill, nên chưa thể đánh dấu tiêu chí đó hoàn thành.

**Hướng sửa:** nối thao tác chọn gợi ý vào cả selection và draft dùng chung cho composer, giữ việc gửi ở hành động xác nhận trực tiếp. Bao phủ read-only, destination và clarification thường; thêm integration/browser assertion cho giá trị textarea và số POST trước/sau xác nhận. Nếu cần sửa wiring ở `PlanoraChatWorkspace`/`PlanoraActiveTurn` ngoài danh sách file của card, coordinator thống nhất ownership trước, không chỉ sửa mock expectation.

### F2 — P2: Ghép sai màu chữ/nền làm mất tương phản ở các trạng thái PL-07

**Vị trí và số đo từ DOM thực:**

| Thành phần | Vị trí | Theme | Chữ / nền | Contrast |
| --- | --- | --- | --- | --- |
| `Dừng hẳn quy trình` | `apps/chat-web/src/pages/Cockpit/RecoveryMoment.tsx:117` | dark | `#ffffff` / `#fca5a5` | **1.898:1** |
| Nhãn option destination, và nhãn `Đã chọn` cùng class | `apps/chat-web/src/pages/Responses/ResponseMoment.tsx:436–437` | dark | `#ffffff` / `#8fb68e` | **2.270:1** |
| Nội dung/banner offline | `apps/chat-web/src/pages/Errors/PlanningErrors.tsx:66` | light | `#ffffff` / `#d97706` | **3.186:1** |

Các chữ này là cỡ nhỏ, cần cặp màu ≥4.5:1 theo tiêu chuẩn tokens Planora. Ảnh xác nhận trực quan nhãn trắng trên nút xanh nhạt và nút dừng hồng nhạt khó đọc. Không thể kết luận palette đạt chỉ từ token ở button cha: destination button có `--planora-on-primary` đúng, nhưng các `span` con ghi đè bằng `text-white`.

**Nguyên nhân:** nút dừng dùng `--planora-error-text` làm nền, nhưng màu này đổi thành hồng nhạt ở dark trong khi chữ vẫn trắng; destination giữ `text-white` trên nhãn con; OfflineBanner dùng cặp amber/white riêng thay vì cặp semantic Planora đã đo. Hai ca dark là hậu quả trực tiếp của thay palette trong diff. Banner đã có vấn đề contrast ở base và vẫn chưa đạt tuy worker log mô tả WCAG AA.

**Hướng sửa:**

- Với destination, để nhãn và `Đã chọn` dùng/kế thừa `--planora-on-primary` thay `text-white`.
- Với xác nhận dừng, dùng cặp màu destructive background/foreground tương thích cả hai theme; không dùng text token làm background mà giữ chữ trắng cố định. Có thể dùng cặp error-bg/error-text hiện có nếu phù hợp hình thức đã duyệt.
- Với offline, dùng cặp pending background/text/border Planora hoặc cặp đã đo đạt; giữ notice và nút thử lại hiện hành.
- Kiểm lại computed color của **nhãn thực**, kể cả hover/selected, ở cả hai theme; giữ assertion contrast và ảnh để tránh chỉ kiểm class/token có mặt.

## 4. Các hành vi đã kiểm chứng đạt

| Phần | Bằng chứng và kết quả |
| --- | --- |
| Answer & sources | Browser mở `Đã tra cứu`, thấy `#answer-lookups`, giữ `[data-answer-text]`; fixture có HTTPS, HTTP, javascript và data URL, chỉ một HTTPS link được render. Unit tests kiểm target/rel và `NoWritesNotice` đều đạt. |
| Refusal | Browser thấy danh sách dịch vụ và đủ `#trello-connect`, `#github-connect`, `#telegram-connect`; tests hiện có cho OAuth/refusal/scope/resend nằm trong 102 files đã chạy. Không gọi OAuth/provider thật trong review. |
| Clarification | Chọn option không tự gửi: số POST bằng 0 và DB vẫn hai messages; bấm xác nhận mới một POST. Prefill chưa đạt như F1. |
| Slow / planning error / offline | Các view thật render đúng selector; slow không tự bịa completed progress khi thiếu dữ liệu. Matrix slow dùng trạng thái store được seed để kiểm UI, không phải phép đo timeout/deadline thật. Offline dùng `browserContext.setOffline(true)` để phát sự kiện mất mạng thật trong trình duyệt. |
| Moment 7 | Từ plan `partial` + failed step trong PostgreSQL, có Retry/Skip/Edit/Stop theo `recoveryActions`. Các regression tests về quyền hành động đều đạt. |
| Moment 8 | Từ plan `partial` + unknown step, không có Retry/Edit/Continue; có Skip/Stop. Unit regression còn kiểm action list server không nhất quán. |
| Moment 9 | Snapshot reconciliation sạch có `Làm tiếp các việc còn lại`; snapshot còn unknown không mở Retry/Edit/Continue. SavedWork hiển thị việc đã lưu và link kết quả. |
| Stop và Escape | Browser mở modal trước Stop. Escape đóng modal, trả focus về nút mở, **0 POST Stop**; query DB vẫn plan `partial`, step `unknown`. Chỉ bấm `Dừng hẳn quy trình` mới **1 POST**, DB thành `stopped`, bằng chứng step `unknown` vẫn giữ. |
| RecoveryEditor | Xem lại là bước 1, chưa Stop/send; xác nhận bước 2 mới xử lý. Endpoint Stop trả 409 → hiển thị lỗi, **0 message POST**, plan còn `partial`. Probe thành công riêng đọc DB ngay lúc chặn message POST: đúng plan đã `stopped`, chỉ **1** request mới. |
| Unsuccessful | Render terminal receipt của plan đã stopped, không lẫn các nút phục hồi Unknown. |

## 5. Responsive, ảnh và giới hạn nghiệm thu

Matrix độc lập có **10/10 tổ hợp đạt kiểm tra tràn ngang**: widths `1440`, `1024`, `768`, `375`, `320`, mỗi width light/dark. Heights là 900 cho desktop/tablet và 812 cho mobile. Đã đo document và card cho 11 trạng thái ở từng tổ hợp: answer mở sources, refusal, clarification thường, destination, read-only, planning error, Moment 7, Moment 8, Moment 9 sạch, Moment 9 unknown và unsuccessful — tổng **110 lượt đo card** không tràn. Có ảnh bổ sung slow/offline/editor/modal dừng ở cả 10 tổ hợp. Tương phản vẫn fail theo F2; responsive đạt không đồng nghĩa nghiệm thu toàn bộ hình thức đạt.

Đã xem trực tiếp ảnh desktop modal dark, clarification/composer, answer mobile, destination dark mobile và các ảnh 320px slow/offline/restart/editor. Reviewer lưu 154 ảnh của suite độc lập, 2 ảnh focused cùng bộ ảnh browser bắt buộc. Không chứng nhận pixel parity toàn bộ với nhánh Planora lịch sử; đây là review PL-07 theo head/task đã khóa.

**Thư mục bằng chứng cục bộ:** `C:/Users/Admin/AppData/Local/Temp/ati-pl07-review-4405fd36/`.

- Logs: `pl07-typecheck.log`, `pl07-web-tests.log`, `pl07-build.log`, `pl07-security.log`, `pl07-browser-required.log`, `pl07-independent-browser.log`, `pl07-focused-browser.log`, `pl07-migrate.log`.
- Source probe: `probes/review.spec.ts`, `probes/focused.spec.ts`, các config và bản `.mjs` đã chạy; bản thực thi gốc còn tại `node_modules/.cache/pl07-review/`.
- Matrix: `independent-results/review-matrix-PL07-moments-<width>-<theme>/metrics.json` và ảnh tương ứng.
- F1: `independent-results/review-contract-clarificat-570f9-must-prefill-the-dock-draft/{missing-prefill.png,error-context.md}`.
- F2 Stop: `independent-results/review-contract-dark-confi-5a618-ls-retain-readable-contrast/{stop-dark-contrast.png,colors.json}`.
- F2 destination/offline: `focused-results/focused-focused-text-color-49c7a-el-and-light-offline-banner/{contrast.json,destination-dark.png,offline-light.png}`.
- Edit ordering: `focused-results/focused-focused-recovery-e-79678--plan-stopped-in-PostgreSQL/edit-order.json`.
- Browser bắt buộc: `required-screenshots/`; ảnh do runner sinh đã chuyển khỏi thư mục tests, không để lẫn vào thay đổi repo.

**NOT_RUN:** OAuth/provider/model live, full root `npm run check`, CI/PR checks trên remote, PostgreSQL 16 và so sánh pixel toàn bộ prototype. Không merge, deploy, thay flag production, sửa `CURRENT-STATE.md` hoặc `ROADMAP.md` trong phiên review này.

## 6. Bàn giao

Giữ kết luận **CHƯA ĐẠT** tại head `4405fd36bfda8e46623261c81aaa971301ec834c`. Worker sửa F1/F2, thêm bằng chứng tích hợp prefill và contrast, cập nhật card/log rồi gửi head mới để re-review. Không cần thay `selectMoment`, nới `recoveryActions` hoặc sửa backend để xử lý hai finding này.

**STATUS: REVIEW_COMPLETE — CHƯA ĐẠT.**
