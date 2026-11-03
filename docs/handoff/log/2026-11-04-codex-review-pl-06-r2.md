# 2026-11-04 · Codex · Re-review PL-06 vòng 2

**Kết luận: ĐẠT trong phạm vi re-review PL-06/F1–F3 tại HEAD `514d982fd9fc152290feb305b0d97f2c40dda21a`.** Cả ba finding vòng 1 đã được khắc phục; không phát hiện finding chức năng mới cần chặn trong phần thay đổi được review. Bốn lệnh bắt buộc exit 0; các probe độc lập, acceptance assertions và browser regression cuối đều GREEN.

**Khuyến nghị fast-forward `codex/planora-ui` lên đúng HEAD đã review**, sau khi coordinator kiểm tra điều kiện CI theo quy trình repository. Phiên này không merge, cập nhật branch tích hợp, gửi GitHub/Slack hoặc xác nhận CI từ xa.

## 1. Mốc và phạm vi

- Base: `e97d71862cee773be9e37f9ef9e456ea36975932`.
- Parent / Round 1 HEAD: `ee5b1814ba1c70490644df4ac87d0339a79847c0`.
- Reviewed HEAD: `514d982fd9fc152290feb305b0d97f2c40dda21a`.
- Worktree: `C:\Users\Admin\orca\workspaces\ATI_Project\review-planora-pl-06-r2`, branch `longnguyen005/review-planora-pl-06-r2`.
- Task card: `docs/handoff/tasks/PL-06-planora-workflow-cards.md`.
- Worker log: `docs/handoff/log/2026-11-04-gemini-pl-06-review-fixes.md`.
- Đã đọc handoff, ba log mới nhất, checklist, ownership, tài liệu PL-06 và báo cáo vòng 1; kiểm tra git đầu phiên sạch, HEAD đúng dispatch.
- Reviewer tự thực hiện, không subagent. Đọc diff vòng 2 và đối chiếu phần thay đổi từ base; không sửa product code, backend, task card, `CURRENT-STATE.md` hay `ROADMAP.md`.
- `git merge-base --is-ancestor <base> <head>` exit 0; `codex/planora-ui` tại thời điểm kiểm tra vẫn là base trên. Fast-forward khả thi về quan hệ lịch sử, chưa thực hiện.

## 2. Đóng các finding vòng 1

### F1 — ĐẠT: Step cards được tích hợp vào cả ba moment

Vị trí: `PlanMoment.tsx:105`, `ExecutionMoment.tsx:111`, `ReceiptMoment.tsx:383`; renderer `PlanoraWorkflowSteps.tsx:655` trở đi.

- Cả ba consumer truyền `showStepCards={true}`. PlanMoment bỏ danh sách card cũ `v3-space-y-3`; chỉ có một `#plan-cards-container` chứa grid mới và đúng một article cho mỗi step.
- DOM PlanMoment thực tế, mở từ pending plan lưu trong PostgreSQL, có `[data-testid="planora-step-cards-grid"]` bên trong `#plan-cards-container`; giữ `role="list"`, aria label, `data-od-id="plan-item-N"` và `#preview-<step.id>`.
- Với tool đọc hợp lệ trong catalog (`trello.search_boards`) và ba bước ghi, nhãn đo được là `Chỉ đọc`, `Ghi`, `Ghi`, `Ghi`. Bước ghi thứ hai chỉ có `dependsOn`, không có `$ref`/`$template`, vẫn hiện `Phụ thuộc: Việc 1`.
- Data-flow được kiểm riêng bằng fixture có `$ref` trong ReceiptMoment và PlanoraActiveTurn: có đúng một badge `plan-step-data-flow-badge`. Workflow sandbox thực tế cũng hiển thị các badge `id`/`url` của Trello → Trello/Slack.
- Grid thực tế hai cột ở 1440/1024/768, một cột ở 375/320, cả light/dark. Mount ExecutionMoment/ReceiptMoment thật qua Vite đều có bốn step cards ở cả 10 tổ hợp; unit regression kiểm trạng thái succeeded/running/pending và nội dung receipt cũng nằm trong full web suite đã chạy.
- Cả năm mode `preview`, `executing`, `receipt`, `schedule`, `blueprint` đều có đúng bốn cards, breakpoint đúng và không tràn ngang trong probe component độc lập.

### F2 — ĐẠT: UUID được gọi đúng là mã định danh

Vị trí: `PlanMoment.tsx:110–120`.

- Payload thực tế không có `plan_hash`: cả 10 tổ hợp hiển thị `Mã định danh kế hoạch: <plans.id>`, không có nhãn `Mã băm`/`plan_hash`. Giá trị code đúng UUID trong DB, khác SHA-256 đã lưu trong `plans.plan_hash`.
- Probe browser mount PlanMoment với hash có giá trị hiển thị đúng nhãn `Mã băm ràng buộc kế hoạch (plan_hash)` và đúng giá trị được cung cấp. Các trường hợp thiếu trường, `null`, chuỗi rỗng đều dùng nhãn mã định danh.
- Không thay backend contract, tự tính hash frontend hoặc thay kiểm tra integrity phía server. Probe sửa bytes `plan_text` nhưng giữ hash cũ vẫn nhận HTTP 409, xem mục 4.

### F3 — ĐẠT: Nút lịch tuân thủ capability

Vị trí: `ReceiptMoment.tsx:455`, `PlanoraActiveTurn.tsx:334`.

- ReceiptMoment chỉ render `receipt-schedule-workflow-btn` khi `schedulesEnabled === true`; PlanoraActiveTurn truyền capability xuống consumer.
- Browser probe kiểm trực tiếp cả ReceiptMoment và PlanoraActiveTurn, mỗi consumer ba giá trị: `true` → có nút, `false`/`undefined` → không có nút. Khi bật, click chỉ chuyển prompt lịch sang callback draft, không tự tạo lịch.
- Luồng sandbox end-to-end trả runtime `{status:"ok",version:"v3",runtimeMode:"sandbox"}` không bật schedules; sau thực thi thành công, nút lịch thực tế không hiển thị. Không bật flag máy chủ để làm test pass.

## 3. Bằng chứng lệnh thực chạy

Windows, Node, Chromium headless; dùng lại cluster PostgreSQL 18 riêng của review vòng 1 tại `%TEMP%\pl06-review-ee5b1814\pgdata`, cổng **55546**, DB test `ati_v3`, API **3046**, Vite **5246**, `RUNTIME_MODE=sandbox`. Không dùng DB ứng dụng hoặc credential provider thật; PL-06 chỉ đổi UI nên không yêu cầu migration mới.

| Lệnh | Output cuối | Exit |
| --- | --- | --- |
| `npm run typecheck:v3` | TypeScript API + web đạt | 0 |
| `npm test -w @wap/chat-web` | **101/101 files, 1128/1128 tests passed**, 31.83s | 0 |
| `npm run build:v3` | Build thành công, 198 modules; có cảnh báo chunk lớn | 0 |
| `node scripts/test-v3-web-build-security.mjs` | `PASS: production build excludes credential sentinels and 7 forbidden UI claims` | 0 |
| `node scripts/test-v3-browser.mjs pl06-independent-review.spec.ts pl06-consumer-review.spec.ts` | **13/13 passed**, 34.0s | 0 |
| `node scripts/test-v3-browser.mjs pl06-acceptance-findings-review.spec.ts planora-chat.spec.ts fe-05-cockpit.spec.ts` | **23/23 passed**, 28.1s: 3 acceptance assertions + 16 PL-05 + 4 FE-05 | 0 |
| `node scripts/test-v3-browser.mjs pl06-visual-review.spec.ts` | **3/3 passed**, 10.9s; ảnh bổ sung card/preview ở 1440 light, 375 dark, 320 light | 0 |

Probe vòng 1 được giữ và tái sử dụng, với các điều chỉnh minh bạch:

1. F2 acceptance cũ yêu cầu text bằng hash trong DB. Vòng 2 cho phép nhãn mã định danh khi API không trả hash, nên assertion kiểm rõ nhãn ID, UUID đúng và khác hash đã lưu; không khẳng định UUID là hash. Nhánh có hash được kiểm thêm riêng.
2. F3 bỏ thao tác click vô điều kiện vào nút phải ẩn khi flag off, thay bằng assertion vắng mặt; thêm cả hai consumer ở ba giá trị capability.
3. Fixture đọc vòng 1 dùng tên không có trong catalog `trello.list_boards`; đổi sang `trello.search_boards` để xác minh Read/Write bằng tool hợp lệ. Giữ ca phụ thuộc thuần và toàn bộ stress payload Gmail/Sheets.
4. Thêm assertions trực tiếp vào observations về grid, số card, breakpoint, nhãn, không tràn, focus và HTML safety.

Các lượt đầu chưa xanh được lưu riêng: PostgreSQL khởi động thiếu `-p 55546` khiến API fallback in-memory; sau đó chuỗi tiếng Việt mới trong script tạm bị PowerShell pipe đổi encoding; cuối cùng assertion đọc phát hiện fixture `list_boards` không tồn tại trong catalog. Đã xác định nguyên nhân, sửa môi trường/harness và chạy lại đầy đủ như bảng trên; không sửa sản phẩm để che lỗi. Browser vẫn có cảnh báo `ResizeObserver loop completed with undelivered notifications` giống vòng 1, không làm suite cuối thất bại. `git diff --check` còn báo khoảng trắng/blank EOF trong diff thi công, là lưu ý định dạng không chặn kết luận chức năng F1–F3.

## 4. Layout, preview và safety probes

Mỗi dòng đo riêng ở **cả light và dark**, kiểm `documentElement[data-theme]` đúng theme. Chiều cao probe layout là 900px; suite PL-05 bổ sung kích thước 1024×768, 768×1024, 375×812, 320×568.

| Viewport | Grid PlanMoment thực tế | Document width | Modal scrollWidth/clientWidth | Sheets grid scrollWidth/clientWidth |
| --- | --- | --- | --- | --- |
| 1440×900 | 508px + 508px | 1440 | 574/574 | 1152/532 |
| 1024×900 | 336px + 336px | 1024 | 574/574 | 1152/532 |
| 768×900 | 332px + 332px | 768 | 574/574 | 1152/532 |
| 375×900 | 309px | 375 | 341/341 | 1152/299 |
| 320×900 | 254px | 320 | 286/286 | 1152/244 |

- Sheets 12 cột × 80 dòng, có token dài không khoảng trắng: cuộn ngang cục bộ `scrollLeft=240`, cuộn modal `scrollTop=500`; không nở document/stage/feed. Gmail có recipient/subject/body dài: modal không tràn; payload `<img onerror>`/`<script>` chỉ thành text, không có image/script trong nội dung và không chạy payload.
- Focus preview: nút đóng nhận focus; Shift+Tab trap đúng; Escape đóng và trả focus đúng nút mở, cả 10 tổ hợp.
- Receipt không tạo link từ `javascript:` hay URL có username/password; HTTPS hợp lệ giữ `target="_blank" rel="noopener noreferrer"`. Đã kiểm observations cả 10 tổ hợp bằng script Python, exit 0.
- Double approve qua `dblclick()` UI: **1 request approve**, DB plan `completed`, **3 execution_steps**.
- Hủy pending qua UI: DB plan `rejected`, **0 execution_steps**.
- Stale integrity: sửa `plans.plan_text` nhưng giữ `plan_hash`, approve trả **HTTP 409**, DB vẫn `pending`, **0 execution_steps**; UI enable lại nút.
- Approve bị route test trả HTTP 503: **1 request**, nút enable lại. Đây là probe phục hồi UI, không thay policy API.
- Đã mở ảnh kiểm tra trực quan desktop/mobile, light/dark, card phụ thuộc và Sheets 320px; ảnh card có thể chứa thanh hành động sticky trong viewport. Không tuyên bố đối chiếu pixel đầy đủ với nhánh mẫu lịch sử.

## 5. Evidence và bàn giao

Evidence cục bộ: `C:\Users\Admin\AppData\Local\Temp\pl06-review-514d982f\`.

- Log lệnh bắt buộc: `typecheck.log`, `web-tests.log`, `build.log`, `security.log`.
- Log browser cuối: `probes-final.log`, `acceptance-browser-final.log`, `visual-final.log`; log các lượt môi trường/harness lỗi được giữ riêng.
- Observations: 10 file `metrics-<width>-<theme>.json`, `consumer.json`, `safety.json`, `approval-retry.json`.
- Ảnh: `plan-*`, `gmail-*`, `sheets-*`, `ExecutionMoment-*`, `ReceiptMoment-*`, ảnh bổ sung `card-write-*`/`sheets-top-*` và ảnh suite PL-05.
- Source probe cuối được lưu trong evidence với tên `pl06-independent-review.spec.ts`, `pl06-consumer-review.spec.ts`, `pl06-acceptance-findings-review.spec.ts`, `pl06-visual-review.spec.ts`; để tái chạy, copy vào `apps/chat-web/tests/browser/`, nạp môi trường sandbox riêng rồi chạy các lệnh trên.
- Đã dọn probe/ảnh tạm khỏi workspace. File bàn giao duy nhất trong repo là báo cáo này; HEAD product vẫn đúng SHA được review.

**NOT_RUN:** CI GitHub đúng HEAD, full backend/eval/full browser suite, provider/OAuth/model live, tạo lịch thật, probe scope-change và old-execution-snapshot mới cho mọi provider. Không suy rộng kết quả UI/sandbox thành nghiệm thu toàn nền tảng hoặc tích hợp live.

**Việc còn lại:** coordinator kiểm tra gate CI và thực hiện fast-forward được cấp quyền tới đúng HEAD trên; không còn sửa chữa F1–F3 được yêu cầu trước khi tích hợp PL-06.
