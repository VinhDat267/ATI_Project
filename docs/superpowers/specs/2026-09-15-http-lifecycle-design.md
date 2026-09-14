# Đợt 3A — HTTP lifecycle, session và dữ liệu cho frontend

**Status: PROPOSED implementation design, 2026-09-15.** Người dùng giao commit `docs/screens.html` và viết plan API-01–API-05. Tài liệu này chốt đề xuất để triển khai; không xác nhận HTTP, UI hoặc AI đã hoạt động. Không thay thế các contract hiện hành trước khi task tương ứng được triển khai và review.

## 1. Mục tiêu và bằng chứng đầu vào

Đưa engine B/local đã có lên HTTP: đăng nhập → tạo run → poll → xem preview → quyết định → thực thi → đọc trace. Kết quả đợt này là `API_TECHNICAL_PASS` nếu kiểm thật đạt. G3 cần thêm browser/frontend; G1 overall và đánh giá AI vẫn giữ nhãn riêng.

Checkout khảo sát: `69e70ae`; checkpoint màn hình đã commit `35cd003`. `apps/api` và `apps/web` hiện chỉ có README. FS-06 báo 258 passed, 1 skipped trong báo cáo đã lưu; không chạy lại suite đó trong lượt viết plan này.

Đọc các nguồn hiện hành, theo thứ tự:

1. [Baseline](../../BASELINE.md), [execution contract](../../EXECUTION-CONTRACT.md), [API](../../API.md), [FR](../../functional-requirements.md).
2. [Contract Zod](../../../packages/dsl/src/contracts.ts), [events](../../../packages/dsl/src/events.ts), [OpenAPI generator](../../../packages/dsl/scripts/emit-openapi.ts).
3. [Engine](../../../packages/engine/src/engine.ts), [prepare](../../../packages/engine/src/prepare.ts), [store](../../../packages/engine/src/store.ts), [approval](../../../packages/engine/src/approval.ts), [execute](../../../packages/engine/src/execute.ts), [recovery](../../../packages/engine/src/recovery.ts).
4. [Filesystem status](../../G1-FILESYSTEM-STATUS-2026-09-13.md), [rubric map](../../G1-RUBRIC-MAP.md), [wireframes](../../wireframes.html), [screens](../../screens.html), [Git policy](../../GIT-POLICY.md).

Các khoảng thiếu xác nhận trực tiếp từ source:

| Hiện trạng | Hệ quả cần xử lý | Task |
|---|---|---|
| `prepare(plan)` tự tạo ID, validate rồi chạy read trước khi trả | Không thể gọi trực tiếp và coi đó là `POST /runs → 202 planning` | API-02 |
| `Store.detail()` luôn trả `planner_result: null` | Refusal/clarification không có dữ liệu cho UI | API-02 |
| `Store.events()` giới hạn 100; contract cho tối đa 200 | Không giả định mỗi trang đủ 200; HTTP chọn cap 200 qua tham số mới | API-03 |
| `Store.trace()` trả tất cả, cursor luôn null | Chưa đáp ứng watermark + phân trang 100 | API-03 |
| RunDetail thiếu source prompt/thời điểm/read outputs/receipt inspection | UI lịch sử và disclosure không được bịa dữ liệu | API-03 |
| `cancel()` terminal là no-op; HTTP contract yêu cầu 409 | Cần strict cancel nguyên tử ở engine, giữ CLI tương thích | API-04 |
| `seedDemo()` dùng `LOCAL_DEMO_LOGIN_DISABLED` | Không thể dùng chuỗi sentinel làm password | API-01 |
| Outbox/worker lease có sẵn nhưng chưa có dispatcher | Cần điều phối prepare/execute và orphan startup | API-02, API-04 |

## 2. Quyết định kiến trúc đề xuất

- `apps/api`: Node HTTP server nhỏ, TypeScript ESM, Zod; dùng các package workspace hiện có. Route table tường minh, không tự viết framework/router tổng quát. Không thêm dependency HTTP hoặc Redis trong đợt này.
- HTTP xử lý auth, parsing và serialize. Engine giữ lifecycle/transaction/claim/authorization. Không shell-out CLI trong handler.
- Một dispatcher trong cùng process, dùng `run_outbox` PostgreSQL đã có. Một job được thực thi tại một thời điểm; lock engine vẫn là hàng rào với process/CLI khác. BullMQ/Redis vẫn được ghi là dự kiến, chưa triển khai. Nếu sau này dùng BullMQ, nó chỉ giao job ID; DB vẫn quyết định có được chạy hay không.
- Không giữ transaction mở qua MCP call. Mỗi job có gateway đúng principal; đóng gateway trong `finally`. Request GET không phụ thuộc MCP đang sống. Request approval mở gateway đã review và đóng riêng; lỗi gateway trả 503, không tự cấp quyền.
- Server bind `127.0.0.1:3001`, prefix `/api/v1`. Test dùng port `0`. Không đổi firewall, public hosting hoặc kết nối SaaS.
- Một tài khoản demo. Session bearer opaque ở RAM, TTL 8 giờ, restart yêu cầu login lại; run/history vẫn ở PostgreSQL. Không cookie/JWT/signup trong đợt này; frontend sau dùng memory và dev proxy cùng origin, không lưu token vào localStorage.
- Auth dùng email cấu hình + hash scrypt cấu hình, ánh xạ tới `DEMO_USER_ID` có sẵn trong DB. Không ghi đè users/seed và không migrate demo DB khi API khởi động. Hash không phải sentinel trong seed.
- Admission khóa transaction dùng key riêng `638019815` và từ chối 409 `ACTIVE_RUN` khi DB còn run nonterminal. Quy tắc một run đang hoạt động áp toàn DB, bao gồm chờ duyệt; các terminal `reconciliation_required` không tự cấm ý định mới có chủ ý.

Nền tảng HTTP/crypto được chọn dựa trên API tích hợp của Node; executor phải dùng runtime >=22 và kiểm API cụ thể trên runtime cài đặt. Tham khảo chính thức: [Node HTTP](https://nodejs.org/api/http.html), [Node crypto](https://nodejs.org/api/crypto.html). Đây là quyết định thiết kế của repo, không phải khẳng định package mới đã được cài.

## 3. Planner bridge: demo có nhãn, contract tạo run giữ nguyên

`POST /runs` tiếp tục nhận đúng `CreateRunSchema`: `source_prompt`, scalar `inputs`, `time_zone`. Không nhận `plan`, `user_id`, root, executable, operation ID, model hoặc fixture path từ browser.

API startup có `API_PLANNER_MODE=disabled|dev_fixture`, default `disabled`. Disabled: POST trả 503 `PLANNER_UNAVAILABLE`, không tạo run. Login/read/cancel/approval vẫn dùng được cho dữ liệu hiện có. Dev mode: chỉ map prompt khớp chính xác với một trong ba entry server-owned:

| Entry | Nguồn | Kết quả |
|---|---|---|
| b02 | `testdata/test-cases.json`, tìm duy nhất `id=b02`, `split=dev` | `expected_result.plan`; không sửa prompt để ép khớp |
| fs-copy-notify | `testdata/dev-hand-plans/fs-copy-notify.json` | Đọc file rồi copy và thông báo; chỉ khi filesystem được trusted launcher bật |
| fs-card-export | `testdata/dev-hand-plans/fs-card-export.json` | Export card qua filesystem; cùng điều kiện launcher |

Prompt so sánh sau trim, không fuzzy/keyword routing; lưu nguyên bản request trong runs.source_prompt. Prompt khác trả PlannerResult `{kind:'clarification',question:'Bản demo hiện chỉ chạy các yêu cầu mẫu đã liệt kê. Hãy chọn một yêu cầu mẫu.'}`. Khi entry filesystem đã chọn nhưng capability tắt: refusal có lý do rõ. Hai nhánh này kiểm HTTP lifecycle, không chứng minh AI hiểu ngôn ngữ. Không dùng holdout hoặc đọc cả bộ expected_result cho planner production.

`PlannerPort.produce()` trả PlannerResult; engine chịu validator. Test có thể inject PlannerPort để tạo refusal, clarification và lỗi có cấu trúc. Đợt này không giả lập gọi LLM, repair 3 lượt hoặc replan. Lỗi plan của provider demo kết thúc failed; để cổng repair thật cho đợt AI.

## 4. Lifecycle và job delivery

1. HTTP validate shape, IANA zone qua `buildRuntime`, auth và admission.
2. Một transaction tạo workflow name tạm, run planning/version null, runtime cố định, `run.status` đầu tiên và outbox `prepare`. Trả `RunAccepted` sau commit; không chờ gateway/read/planner. GET đầu tiên có thể đã tiến xa hơn planning; 202 mô tả lúc được nhận.
3. Worker chọn outbox chưa delivered. Trong lease engine, khóa run, kiểm planning/unclaimed/nonterminal, claim run + consume đúng prepare job cùng transaction. Trước đó không gọi planner/MCP tool.
4. Planner result lưu vào DB. Refusal/clarification → terminal, không version/operation/write. Plan → validating → validate → lưu version/steps → dry_running, tái dùng logic read/snapshot hiện có. Không tạo run/workflow thứ hai, không emit planning lần hai hoặc enqueue prepare lần hai.
5. Tới pending approval: release claim; read-only success: terminal. Approval+running+execute outbox vẫn nguyên tử theo engine hiện có.
6. Worker gọi execute khi đúng job chưa claim. `execute()` sở hữu update delivered_at; dispatcher tuyệt đối không ack trước nó. BUSY là hoãn job chưa claim, không retry write.
7. Restart: reconcile các claimed orphan dưới lease trước khi nhận job mới. Claimed prepare không có uncertain write → failed. Claimed execute có in_flight/unknown → reconciliation_required. Job chưa claim có thể bắt đầu lần đầu; run đã claim không được chạy tiếp. Không dùng chỉ tuổi heartbeat để kết luận lease đã mất.
8. Gateway/config lỗi trước claim: dưới lease, recheck row rồi kết thúc job failed/before-dispatch với thông báo safe; không để một pending job quay vô hạn. Lỗi sau claim được recovery xử lý theo certainty. Nếu mất lease không ghi kết luận mới từ worker cũ; worker mới làm recovery.
9. Dispatcher tick 250ms, không overlap. Mỗi tick xử lý tối đa một job; `wake()` chỉ giảm latency. DB là nguồn hàng đợi, timer không giữ job duy nhất.
10. Approval pending quá TTL phải tự thành expired dù không ai bấm. Maintenance riêng tick 1 giây, transaction khóa run → approval; chỉ expire awaiting_approval/pending đã hết giờ DB, không có active attempt. Không chuyển running sang expired trong maintenance; executor kiểm trước write.

Admission và maintenance dùng cùng thứ tự lock `run → approval → operations` khi có nhiều row. Không chạy `withWorker` lồng nhau; tách hàm nội bộ thực thi dưới lease đã giữ cho recovery/prepare/dispatch. Lease engine `638019814` giữ nguyên. Khi lease mất phải đóng gateway hiện hành.

## 5. HTTP contract delta register (chỉ triển khai trong task chỉ định)

| Delta | Quyết định | Task |
|---|---|---|
| Error envelope | `{error:{code,message,request_id}}`; không stack/SQL/token | API-01 |
| Login schemas | Zod strict `{email,password}` → strict `{token}`; OpenAPI vẫn bearer | API-01 |
| Login transport | Không cookie; no-store; bearer chỉ qua header Authorization | API-01 |
| RunDetail display metadata | Optional shared fields `source_prompt`, `created_at`, `read_outputs`; API mới luôn cung cấp, CLI cũ được parse | API-03 |
| Planner result | Map cột `runs.planner_result` thật, không hardcode null | API-02 |
| Events | `since_seq` safe integer >=0; HTTP cap 200, CLI giữ default100 | API-03 |
| Trace | Cursor opaque, bind owner/run/snapshot+offset; max100/page | API-03 |
| Read-only reconcile | Thêm `GET /runs/{runId}/reconciliation`, map engine.reconcile; không action ghi | API-03 |
| Cancel | strict mode trả409 cho terminal nguyên tử; 202 không body | API-04 |
| Run list | Giữ response `RunDetail[]`, order created_at DESC,id DESC; đọc max1001, >1000 trả409 HISTORY_LIMIT, không truncate âm thầm | API-03 |

Chỉ generator sinh `docs/openapi.yaml`. Tên request field chính xác là `workflow_version_id`; chữ `version_id` trong mô tả cũ chỉ là shorthand. Không thêm alias wire-format thứ hai. Error 400 gồm JSON/shape/UUID/timezone/cursor sai; 401 auth; 404 absent hoặc wrong owner; 409 conflict/expired/already terminal/active run/history limit; 413 body >64KiB; 415 không JSON; 429 login throttled; 503 dependency chưa sẵn sàng; 500 invariant nội bộ. Invalid response schema là 500, không đánh đồng Zod lỗi nội bộ với request 400.

## 6. Read models và redaction

- `RunDetail.read_outputs`: lấy từ persisted preview snapshot đã kiểm `unpackPreview`; nếu không approval thì từ persisted successful read attempts đúng version, có thứ tự; không gọi lại MCP. Giữ snapshot hash cũ; không hash lại bản hiển thị đã redact.
- List/detail/events/trace/reconciliation serialize qua một projector safe. Dữ liệu transport secrets không được ghi vào prompt/args ở nguồn. Projector bỏ/redact key nhạy cảm (`authorization`, `password`, `password_hash`, `token`, `access_token`, `refresh_token`, `secret`, `api_key`, `cookie`, `set-cookie`) và giá trị secret cấu hình đã biết trong chuỗi/lỗi. Không coi regex là chống rò rỉ toàn diện.
- Đối với preview: nếu payload thực thi chứa secret cấu hình thật, chặn tạo preview với lỗi safe trước khi reserved actions/approval được ghi. Không đưa một preview đã che nội dung khác vào duyệt như thể người dùng đã xem đủ payload. Fixture kiểm token giả trong trace dùng path đọc/seed kiểm thử; không thay raw canonical bytes lịch sử.
- History có source prompt/status/time. Cột tổng receipt chưa được suy ra từ plan, số attempt hoặc `confirmed` chung; phần receiver evidence lấy endpoint reconciliation khi mở chi tiết. Không thêm N+1 reconcile call cho mỗi run trong list.
- Trace HTTP cần snapshot ổn định vì attempt đang chạy còn có thể hoàn thiện. Materialize response attempt records trong transaction REPEATABLE READ vào bảng snapshot mới, owner/run/expiry; cursor page đọc bản đó, không join version hiện tại. Một snapshot tối đa10000 attempts, nếu quá trả409 TRACE_LIMIT; không truncate. TTL10 phút, snapshot hết hạn/mất trả400 CURSOR_EXPIRED, client restart từ trang đầu.
- Migration mới `0006_http_trace_snapshots.sql`: table `http_trace_snapshots(id uuid PK,user_id uuid FK,run_id uuid FK,attempts jsonb NOT NULL,created_at timestamptz,expires_at timestamptz)`, CHECK jsonb_typeof(attempts)='array'. attempts là array đã project an toàn, không chứa credential. Index expires_at. Cursor random snapshot UUID + offset + HMAC-SHA256 bind owner/run; key chỉ cấu hình server. Cursor watermark có cả dữ liệu open attempt tại thời điểm chụp; bắt đầu không cursor để nhận bản mới.
- `GET /servers` trả đúng schema hiện tại, status connected chỉ khi discovery + policy fingerprint đã kiểm tại lifecycle hiện hành. Không gọi tools/call để dựng status, không ghi endpoint/env/executable trong response. Sau gateway đóng: disconnected; drift: error/unreviewed. GET lúc chưa có gateway không được ghi connected chỉ từ preset file.

## 7. UI handoff và các giới hạn chưa được nghiệm thu

`screens.html` là checkpoint bố cục đề xuất. HTML parse, nút disabled, refs tồn tại không chứng minh click hay pixel đúng. Kết quả responsive do người dùng báo chưa được kiểm browser độc lập trong lượt này.

Những chi tiết executor frontend phải xử lý trước khi chốt pixel:

- Container rộng bằng khung thực; chữ 1280px hiện là nhãn mục tiêu, không phải kích thước cố định. Không hứa viewport900px giữ hai cột.
- DOM `.rail` đang trước timeline: gộp một cột sẽ đưa lịch sử lên trước, trái câu mô tả xuống dưới. Chọn timeline trước khi hẹp và kiểm thứ tự keyboard/DOM.
- Rule `.rail` hiện đứng sau `@container` cùng specificity, có thể ghi đè border/padding override. Đặt override đúng cascade khi triển khai.
- Kiểm mobile với tất cả TechDisclosure mở, row nút dài, keyboard Tab/Enter/Space, focus rõ và không cắt nội dung do `.frame{overflow:hidden}`. Không lấy scrollWidth toàn trang bằng nhau làm bằng chứng mọi thứ nhìn thấy.
- `RunDetail`/trace wire-format phải được chốt trước client; không hiển thị version/layers đang validate nếu API chưa có dữ liệu. UI render data là text, không HTML từ tool.
- `expired` khi đã ghi một phần: giữ timeline phần đã ghi, CTA mở trace; không tự phát lại. User tạo run mới vẫn cần ý định và approval mới.
- `NFR-03` gồm API+render nên chưa pass khi mới có polling bằng Node test. G3 chỉ pass sau browser E2E.

## 8. Definition of Done của API đợt 3A

HTTP thật trên loopback, PostgreSQL thật, hai MCP process thật trong fixtures riêng; 202 trước read hoàn tất; không write trước approve; double decision một thắng/một409; đúng owner; expiry/cancel/crash/lost-response giữ invariant; events replay đủ; trace snapshot paging ổn định; secrets không xuất hiện ở response/log; cleanup đúng fixture. Báo `DEV_FIXTURE_PLANNER`, `AI_NOT_RUN`, `BROWSER_NOT_RUN` rõ.

Không cần chờ rubric chính thức để làm API/frontend. Rubric và công việc nhóm thật là đầu vào song song cho nghiệm thu đồ án/AI, không được nâng nhãn overall nhờ API tests.
