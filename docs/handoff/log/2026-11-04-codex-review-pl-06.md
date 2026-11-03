# 2026-11-04 · Codex · Review độc lập PL-06

**Kết luận: CHƯA ĐẠT — 3 finding P2 (F1–F3).** Các lệnh kiểm tra bắt buộc đều đạt, nhưng giao diện tích hợp chưa đáp ứng mục tiêu step cards và có hai thông tin/hành động hiển thị sai khả năng thực tế.

- Base: `e97d71862cee773be9e37f9ef9e456ea36975932`.
- Reviewed HEAD: `ee5b1814ba1c70490644df4ac87d0339a79847c0`.
- Worktree: `C:\Users\Admin\orca\workspaces\ATI_Project\review-planora-pl-06`.
- Task card: `docs/handoff/tasks/PL-06-planora-workflow-cards.md`.
- Worker log: `docs/handoff/log/2026-11-04-gemini-pl-06.md`.
- Reviewer tự thực hiện; không dùng subagent, không sửa product code/backend/task card, không gửi GitHub/Slack, không merge.
- Kiểm tra đầu phiên: HEAD đúng SHA được giao, `git status --short` sạch; đọc handoff, checklist review, tài liệu ownership và spec/plan/prompt PL-06.

## 1. Finding cần sửa

### F1 — P2: Step cards mới bị tắt ở cả ba moment thực tế

**Vị trí:** `apps/chat-web/src/pages/Cockpit/PlanMoment.tsx:106`, `PlanMoment.tsx:110`, `ExecutionMoment.tsx:98`, `ReceiptMoment.tsx:365`.

Cả ba consumer đều truyền `showStepCards={false}`. Vì vậy người dùng vẫn thấy orbital/service router; phần mới có `toolDefinition(...).sideEffect`, `dependsOn`, status và grid hai cột chỉ tồn tại khi mount riêng `PlanoraWorkflowSteps`. PlanMoment tiếp tục render danh sách cũ `v3-space-y-3`; không có Read/Write hoặc phụ thuộc thuần `dependsOn` trong các card đó. Các `$ref`/`$template` có badge riêng không bù được việc mất quan hệ phụ thuộc không truyền dữ liệu.

**Tái hiện:** mở pending plan có bước đọc Trello, bước ghi phụ thuộc bước đọc, rồi Sheets/Gmail; đo DOM ở 1440/1024/768/375/320 × light/dark. Trong cả 10 tổ hợp:

- `[data-testid="planora-step-cards-grid"]` không tồn tại trong PlanMoment.
- Nhãn `Chỉ đọc`/`Ghi` trong `#plan-cards-container`: 0; `Phụ thuộc:`: không có.
- Tại 1440 light, cả bốn card có `x=308`, `width=1072`, khác `y`: vẫn một cột ở desktop.
- Khi mount riêng cùng component với cùng dữ liệu, grid có 4 card và hai cột ở ≥768px. Đây là lỗi tích hợp, không phải thiếu CSS grid trong component.

**Ảnh/bằng chứng:** `metrics-1440-light.json`, toàn bộ `metrics-*.json`, `plan-*.png` trong thư mục evidence ở mục 4. Acceptance assertion F1 thất bại `Expected true / Received false`, exit 1.

**Hướng sửa:** sử dụng step-card renderer mới trong các moment, hoặc hợp nhất phần card hiện tại với renderer chung; bảo toàn selector/callback và tránh render trùng. Kiểm thử consumer thật: grid hai cột desktop/một cột mobile, Read/Write từ catalog, thứ tự, phụ thuộc chỉ có `dependsOn`, data-flow và cập nhật trạng thái. Unit test chỉ render component độc lập sẽ không bắt được lỗi này.

### F2 — P2: Trường “plan_hash” thực tế hiển thị UUID kế hoạch

**Vị trí:** `apps/chat-web/src/pages/Cockpit/PlanMoment.tsx:197`; test sử dụng dữ liệu không có trong contract tại `apps/chat-web/tests/planora-workflow-steps.test.tsx:159`.

Code ép kiểu thêm `plan_hash?: string`, rồi dùng `plan.id` làm fallback dưới nhãn “Mã băm ràng buộc kế hoạch (plan_hash)”. `ActivePlan` không khai báo `plan_hash`; pending-plan response hiện tại cũng không đưa hash DB vào payload. UUID là định danh, không phải cryptographic hash. Unit test tự thêm `plan_hash` vào fixture nên không kiểm chứng đường dữ liệu thực tế.

**Tái hiện/đối chiếu DB thật:** tại 1440 light, nội dung `plan-hash-binding code` là `6f25ead6-9f3b-4b95-8bfd-f5a310506fe0`, đúng bằng `plans.id`. `plans.plan_hash` là `5bc727925f60283bc322382e5a77f3015b3a2890905f92802c77e5d02b099131`. Mismatch lặp lại cả 10 tổ hợp. Acceptance assertion F2 thất bại với hai giá trị trên, exit 1.

**Hướng sửa:** bỏ fallback gán nghĩa hash cho ID. Nếu chỉ có ID từ contract hiện hành, ghi rõ là mã định danh và không tuyên bố đó là hash; nếu cần hiển thị hash thật, thống nhất nguồn dữ liệu/interface với coordinator trong phạm vi được phép. Không tự đổi backend contract hoặc tự hash một object frontend khác với approved bytes. Test phải dùng payload thực tế, phân biệt UUID/hash, và vẫn giữ kiểm tra integrity phía server.

**Giới hạn finding:** chưa phát hiện bypass integrity phía server. Probe sửa `plan_text` nhưng giữ hash cũ nhận HTTP 409 và không tạo execution step (mục 3). Finding này là thông tin bảo mật hiển thị sai, không phải chứng cứ thực thi được plan bị sửa.

### F3 — P2: Nút đặt lịch được thêm vô điều kiện khi lịch chạy đang tắt

**Vị trí:** `apps/chat-web/src/pages/Cockpit/ReceiptMoment.tsx:437` (nút `receipt-schedule-workflow-btn`); consumer `apps/chat-web/src/planora/workspace/PlanoraActiveTurn.tsx:310`.

Nút mới luôn xuất hiện trong receipt, không nhận/kiểm tra `schedulesEnabled`. Trong khi đó workspace đã có capability này và dùng `data?.schedulesEnabled === true` để bật UI lịch. Spec migration mục 8 yêu cầu giữ feature flags và trạng thái nghiệp vụ.

**Tái hiện:** chạy sandbox mặc định, không đặt `SCHEDULES_ENABLED`, hoàn tất workflow Trello → Slack. `apiClient.getRuntime()` trả `{ "status": "ok", "version": "v3", "runtimeMode": "sandbox" }` (không bật `schedulesEnabled`), nhưng nút vẫn visible. Click chỉ điền draft `Mỗi sáng 08:00, tự động thực hiện: ...` dù runtime không hỗ trợ lịch. Acceptance assertion F3 thất bại `Expected false / Received true`, exit 1.

**Hướng sửa:** truyền capability đã có xuống ReceiptMoment và chỉ hiện hành động khi lịch được bật; giữ luồng draft/đề xuất/xác nhận theo policy server. Thêm test receipt thực tế ở cả flags off/on. Không bật flag server để làm UI pass và không mô tả click điền draft là đã tạo lịch.

## 2. Lệnh bắt buộc chạy lại

Chạy đúng HEAD review trên Windows/Node; PostgreSQL 18 mới khởi tạo riêng cho phiên review, DB `ati_v3`, port `55546`, API `3046`, Vite `5246`, `RUNTIME_MODE=sandbox`. Migration và provision tài khoản test đều exit 0. Không dùng DB runtime/production hoặc credential provider thật.

| Lệnh | Kết quả thực chạy | Exit |
|---|---|---|
| `npm run typecheck:v3` | TypeScript API + web đạt | 0 |
| `npm test -w @wap/chat-web` | **101/101 files, 1124/1124 tests** | 0 |
| `npm run build:v3` | Build thành công; cảnh báo chunk lớn | 0 |
| `node scripts/test-v3-web-build-security.mjs` | `PASS: production build excludes credential sentinels and 7 forbidden UI claims` | 0 |
| `node scripts/test-v3-browser.mjs planora-chat.spec.ts fe-05-cockpit.spec.ts` | **20/20 passed**, 31.7s | 0 |

Browser suite trên gồm 4 ca FE-05 và 16 ca PL-05. Đây là suite hiện có, không phải bằng chứng rằng các yêu cầu PL-06 còn thiếu đã đạt. Không chạy lại `fe-02-routing-history.spec.ts`; strict-mode violation baseline đã được coordinator xác nhận không được tính là finding PL-06.

Selector: `#moment-4`, `#heading-moment-4`, `[data-request-echo]`, `#plan-cards-container`, `[data-od-id]` vẫn có. Nút preview thực tế dùng `#preview-<step.id>` ở cả base và head; `#btn-preview-step-N` được nêu trong dispatch không có trong cả hai cây, nên không ghi thành regression do commit PL-06.

## 3. Probe độc lập bổ sung

Probe tạo pending plans qua PostgreSQL thật, mở UI thực để đo PlanMoment/Gmail/Sheets, sau đó mount component/moment xuất xưởng qua Vite với CSS thật để kiểm đủ năm mode. Không dùng mô phỏng boolean cho DB/concurrency. Hai lỗi harness ban đầu (cleanup vi phạm FK và import namespace `react-dom/client`) đã sửa trong probe; không tính là lỗi sản phẩm. Bản probe cuối lưu riêng để tái chạy.

- `node scripts/test-v3-browser.mjs pl06-independent-review.spec.ts`: **12/12 passed**, exit 0, 33.1s. Đây là harness thu thập observations; các assertion acceptance được kiểm riêng bên dưới.
- `node scripts/test-v3-browser.mjs pl06-independent-review.spec.ts --grep 'real double'`: **1/1 passed**, exit 0, 7.1s. Lượt này bổ sung runtime capability qua chính `apiClient.getRuntime()`; ghi đè `safety.json` bằng kết quả đã xác thực.
- `node scripts/test-v3-browser.mjs pl06-acceptance-findings-review.spec.ts`: **3 failed (F1/F2/F3)**, exit **1**. Các assertion đọc observations DOM/DB đã thu thập; không phải thêm ba lần tương tác browser độc lập.

Mỗi dòng dưới được đo riêng ở **cả light và dark**, xác nhận `documentElement[data-theme]` đúng theme:

| Viewport | Document width | Modal Gmail/Sheets scrollWidth/clientWidth | Sheets grid scrollWidth/clientWidth | Grid component độc lập |
|---|---|---|---|---|
| 1440×900 | 1440 | 574/574 | 1152/532 | 2 cột |
| 1024×900 | 1024 | 574/574 | 1152/532 | 2 cột |
| 768×900 | 768 | 574/574 | 1152/532 | 2 cột |
| 375×900 | 375 | 341/341 | 1152/299 | 1 cột |
| 320×900 | 320 | 286/286 | 1152/244 | 1 cột |

- Bảng Sheets 12 cột × 80 dòng, range và nội dung dài không khoảng trắng: scroll ngang cục bộ đặt `scrollLeft=240` thành công; modal cuộn dọc `scrollTop=500` thành công; không nở ngang document/stage/feed.
- Gmail: người nhận/subject/body dài; chuỗi HTML có `<img onerror>`/`<script>` được render thành text, không có image/script trong nội dung modal và không chạy payload.
- Focus modal: focus ban đầu đúng nút đóng, Shift+Tab quay về nút cuối, Escape đóng và trả focus đúng nút mở, đạt cả 10 tổ hợp.
- Cả `preview`, `executing`, `receipt`, `schedule`, `blueprint` mount riêng có 4 cards, breakpoint đúng và không tràn ngang. PlanMoment tích hợp không render chúng — F1.
- ExecutionMoment/ReceiptMoment mount với fixture trạng thái/kết quả đúng hình dạng props ở cả 10 tổ hợp: chiều rộng vùng cuộn bằng clientWidth. Receipt không tạo link từ `javascript:` hoặc URL có username/password; link HTTPS an toàn giữ `target="_blank" rel="noopener noreferrer"`. Luồng thực thi sandbox thật và receipt end-to-end cũng đạt trong FE-05.
- Double approve qua `dblclick()` trên UI: **1 request approve**, DB plan `completed`, **3 execution_steps**.
- Cancel pending qua UI: DB plan `rejected`, **0 execution_steps**.
- Stale integrity: thêm khoảng trắng vào `plans.plan_text` nhưng giữ `plan_hash`; approve nhận **HTTP 409**, DB vẫn `pending`, **0 execution_steps**; UI quay lại trạng thái cho phép thao tác.
- API approve lỗi 503 được chặn bằng Playwright route để kiểm tra phục hồi UI: **1 request**, nút approve được enable trở lại. Nghi vấn local busy lock không nhả đã bị loại bằng tái hiện integration; không báo thành finding.

Browser log có cảnh báo `ResizeObserver loop completed with undelivered notifications`; suite và probe hoàn thành. Chưa kết luận cảnh báo này do PL-06, không gán thành regression mới.

## 4. Evidence và bàn giao

Evidence cục bộ, không chứa credential provider thật: `C:\Users\Admin\AppData\Local\Temp\pl06-review-ee5b1814\`.

- Log: `typecheck.log`, `web-tests.log`, `build.log`, `browser.log`, `probes-expanded.log`, `safety-final.log`, `findings.log`, `migrate.log`, `provision.log`.
- Observations: 10 file `metrics-<width>-<theme>.json`, `approval-retry.json`, `safety.json`.
- Ảnh: `plan-*`, `sheets-*`, `gmail-*`, `ExecutionMoment-*`, `ReceiptMoment-*` cho cả 10 tổ hợp; đã mở kiểm tra trực quan các ảnh mobile đại diện.
- Source probe được giữ tại `pl06-independent.spec.ts` và `pl06-acceptance-findings.spec.ts`. Để tái chạy, copy vào `apps/chat-web/tests/browser/` với tên lệnh ở mục 3 rồi chạy trong sandbox; đây là test review tạm, đã dọn khỏi tracked workspace sau phiên.
- Các ảnh tự sinh từ suite bắt buộc cũng được chuyển khỏi workspace sang evidence. Chỉ file báo cáo này được bàn giao trong repo; không sửa `CURRENT-STATE.md`/`ROADMAP.md`.

**NOT_RUN:** CI GitHub trên HEAD, provider/OAuth/model live, tạo lịch thật, full browser suite ngoài hai spec được giao, probe mới cho scope-change/old-snapshot ở tất cả provider. Không dùng kết quả sandbox để tuyên bố live hoặc toàn nền tảng đã hoàn tất.

**Cần làm tiếp:** sửa F1–F3, bổ sung test ở consumer/payload thật/capability flags, chạy lại các lệnh và probe liên quan trên HEAD mới rồi giao review lại. Chưa đủ điều kiện nghiệm thu/merge PL-06 tại HEAD này.
