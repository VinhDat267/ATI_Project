# Audit hiện trạng và phản biện kế hoạch ATI v3 — 29/09/2026

**Kết luận: NEEDS WORK.** Repo đã có code trải từ foundation đến frontend và ba scenario của Task 26–28. Các test hiện có chạy xanh, nhưng sản phẩm hiện là bản tích hợp có nhiều đường mô phỏng; chưa đủ bằng chứng nghiệm thu luồng AI → dịch vụ thật hoặc các cam kết an toàn v3. Không thể suy ra mức hoàn thành nghiệp vụ từ số file, commit hay test xanh.

## 1. Snapshot và phạm vi

- HEAD kiểm tra: `5948ecc45c4c1658c178e5053969b619ffe10ba8`, nhánh `main`; working tree sạch trước audit.
- Nguồn chuẩn: `AGENTS.md` hiện tại, đặc tả v3 ngày 29/09, kế hoạch cùng ngày, `docs/team-workflow.md`. Báo cáo và README là các tuyên bố cần kiểm chứng, không phải bằng chứng thực thi.
- Audit tập trung mã v3, cấu hình chạy/test và khả năng thực hiện kế hoạch. Legacy v2 chỉ đối chiếu ranh giới và root scripts; không đánh giá lại toàn bộ v2.
- Đọc CodeGraph trước khi truy xuất code; các vùng bị lược bớt hoặc có cảnh báo stale được đọc trực tiếp.
- Không sửa application code, không migrate/reset DB, không commit, không gọi provider AI hoặc dịch vụ SaaS thật. Chỉ thêm báo cáo và ca phản chứng dưới thư mục audit này.
- `CONFIRMED`: đọc được trong code hoặc chạy tái hiện được, có phân biệt dưới đây. `PARTIAL`: có thành phần nhưng chưa đáp ứng hợp đồng. `NOT_RUN`: chưa chạy kiểm chứng. `PROPOSED`: hướng sửa đề xuất, chưa triển khai.

## 2. Bằng chứng chạy thực tế

| Lệnh | Kết quả | Giới hạn bằng chứng |
|---|---|---|
| `npm run test:v3` | Exit 0, 111 tests / 29 files | Sáu workspace; không bao gồm evaluation và scaffold ở root |
| `npx --no-install vitest run tests/scaffold.test.ts evaluations/eval.test.ts` | Exit 0, 2 tests / 2 files | Evaluation dùng đáp án dựng sẵn, không phải đo AI thật |
| `npm run typecheck:v3` | Exit 0 | TypeScript API và web; không chứng minh đúng contract runtime khi dùng `any` |
| `npm run build:v3` | Exit 0 | Script này chỉ build chat-web, không phải bản đóng gói toàn backend |
| `node --import tsx docs/audits/2026-09-29-v3-review/offline-probes.mjs` | Exit 0, 16 quan sát lỗi được tái hiện | Assertions xác nhận lỗi tồn tại; đây không phải acceptance tests đạt |

Phân bố 111 tests: tool-schemas **5**, tool-adapters **22**, planner **14**, executor **13**, chat-api **37**, chat-web **20**. Tổng có thêm scaffold/evaluation là **113**, không tính các ca phản chứng audit vào số test sản phẩm.

[Mã tái hiện](./offline-probes.mjs) và [output JSON](./offline-probes-output.json) được lưu cùng báo cáo. Các fixture chỉ thay transport ngoài, dữ liệu repository hoặc runner cần điều khiển; middleware, route, validator, controller, StepRunner, adapter và ExecutionService liên quan đều là code hiện tại. Không dùng kết quả fixture để tuyên bố PostgreSQL hoặc SaaS đã được kiểm chứng.

**NOT_RUN:** PostgreSQL v3 integration thật; concurrency/crash recovery trên DB thật; Gemini evaluation thật; Trello/Slack live writes; browser E2E, responsive/accessibility; đo latency thực tế. Không có kết luận xác nhận các phần này.

## 3. Repo hiện đã làm gì?

| Nhóm task | Thành phần đã có — CONFIRMED | Đánh giá so với đặc tả |
|---|---|---|
| 1 | Workspaces, TypeScript config, env helper, scripts v3 | PARTIAL: env helper dùng giá trị mặc định và cho thiếu cấu hình, chưa có chế độ live fail-closed |
| 2 | 11 tool definitions, plan/reference/scope types | Có contract khai báo; enforcement runtime còn thiếu |
| 3 | AES-256-GCM, StepError, limiter class | Limiter chưa được gọi trong đường request adapter |
| 4a–4c, 5 | Trello 9 tools, Slack 2 tools, HTTP/error mapping, một phần allowed scope | PARTIAL: mất signal, Trello write không kiểm scope, chưa tích hợp limiter/retry đầy đủ |
| 6–7 | SQL 6 bảng/4 indexes, pool, 5 repositories, conditional approval SQL | PARTIAL: không có bằng chứng migration/integration DB thật; auth user chưa nối users table |
| 8–10 | Gemini/mock providers, WorkingMemory class, router, validator, retry validation 1 lần | PARTIAL: thiếu gather runtime, memory qua nhiều turn, schema validation đầy đủ |
| 11 | 50 golden prompts, evaluator và test | Chỉ xác nhận harness offline; chưa qua quality gate AI |
| 12–14 | Resolver, StepRunner, controller pause/retry/skip/stop | PARTIAL: thiếu state guard khi retry, durable recovery và transaction boundary |
| 15–18 | JWT helpers, Express, message 202, SSE, approval/execution services, AdapterFactory | PARTIAL: bypass auth, thiếu owner checks, adapter thật chưa nối, thiếu nhiều endpoints |
| 19–25 | React app, Zustand, SSE hook, chat/preview/progress/settings components | Đã có UI và build; nhiều thao tác vẫn mô phỏng/no-op, chưa phải UX hoàn chỉnh |
| 26–28 | Ba HTTP scenario tests và E2E harness | Đạt flow với mock; không chứng minh gather, DB, browser hoặc SaaS thật |

`PROJECT-REPORT.md:538–553` vẫn nói 20/28 và Phase 5–6 chưa làm; HEAD có thêm 18 commits sau commit báo cáo nêu (`3e18cea`), bao gồm frontend và scenario tests. README còn ghi 88 tests, report ghi 89. Cần cập nhật cả hai.

Kế hoạch có **30 mục `### Task`**, vì Task 4 tách 4a/4b/4c. Nếu giữ cách gọi 28 task cha, phải gộp ba mục này khi tính tử số. Không dùng 20 subtask chia 28 task cha. Không đề xuất một phần trăm hoàn thành mới khi chưa lập ma trận requirement → implementation → evidence.

## 4. Findings cần xử lý

P0 là chặn phát hành; P1 là lỗi ảnh hưởng luồng chính, dữ liệu hoặc an toàn; P2 là lỗi độ tin cậy và nghiệm thu. Đây là review chức năng/kiến trúc có kiểm tra security liên quan, không phải chứng nhận security toàn repo.

### F01 — P0: Token cố định vượt qua xác thực, kể cả ngoài chế độ demo

**Source:** `apps/chat-api/src/auth/jwt.ts:161–165`, `apps/chat-web/src/App.tsx:29`, `apps/chat-api/src/config/env.ts:9–13`.

Middleware nhận `Bearer demo-token` rồi gán identity admin mà không verify JWT, không có điều kiện môi trường. Probe gọi `/api/auth/me` nhận **200/u_admin**. `validateEnv({ NODE_ENV: 'production' })` vẫn chấp nhận cấu hình thiếu và cấp default secrets. Đây là lỗi được đưa vào đường chạy hiện tại, không chỉ là test fixture.

**Đề xuất:** loại bypass khỏi đường ứng dụng thường; demo phải là chế độ tách biệt, không có credentials thật. Live thiếu secret/DB config phải dừng khởi động. Kiểm thử token cố định, token sai và cấu hình production thiếu phải bị từ chối.

### F02 — P1: Đăng nhập chưa bảo đảm cô lập dữ liệu theo user

**Source:** `apps/chat-api/src/routes/conversation-routes.ts:49–107,116–142`, `routes/stream-routes.ts:13–36`, `routes/execution-routes.ts:13–81`, `services/execution-service.ts:40–65`.

Các route kiểm có identity nhưng không đối chiếu owner của conversation/plan. Với JWT hợp lệ của A, probe đọc conversation do B sở hữu nhận **200 và dữ liệu B**. Stream, active-plan và execution controls cũng không có owner lookup tại các đường đọc đã kiểm tra. Sửa F01 đơn lẻ không khắc phục F02.

**Đề xuất:** enforce ownership tại API/service/repository cho từng resource; kiểm tra trước khi đổi trạng thái hoặc mở SSE. Test A/B trên read, post-message, SSE, approve/retry/skip/stop; không chỉ test thiếu header.

### F03 — P1: Entry point chỉ thực thi adapter giả; nối AdapterFactory thật còn lỗi async

**Source:** `apps/chat-api/src/server.ts:267–298`, `services/adapter-factory.ts:26`, `services/execution-service.ts:94–97`, `packages/executor/src/runner.ts:90–95`.

Server import AdapterFactory nhưng dùng object trả card URL mock và Slack success giả. Nhánh này không phụ thuộc việc có credentials thật. Khi thay bằng AdapterFactory hiện có, factory trả Promise nhưng runner gọi trực tiếp `adapter.execute` không `await`. Probe tái hiện **`adapter.execute is not a function`**, bị phân loại thành `unknown` dù chưa gọi external tool.

**Đề xuất:** thống nhất interface sync/async không qua `any`; integration test đi qua CredentialRepo → decrypt → AdapterFactory → StepRunner, mock ở HTTP transport. Live phải fail rõ nếu thiếu adapter/credentials.

### F04 — P1: Timeout đã test ở runner nhưng mất khi qua adapter thật

**Source:** `packages/executor/src/runner.ts:80–95`, `packages/tool-adapters/src/trello/index.ts:10`, `trello/write-tools.ts:23–27`, `slack/slack-adapter.ts:177–203`.

Runner truyền `{ signal }`, nhưng concrete adapters không tiếp nhận/truyền tiếp tới fetch. Probe qua **chính TrelloAdapter và SlackAdapter**, transport chờ lâu hơn timeout: fetch không nhận signal, step vẫn **success** sau 48–75ms với timeout 10ms. Test hiện có chỉ kiểm fake adapter biết lắng nghe abort.

**Đề xuất:** truyền cancellation xuyên mọi lớp HTTP; kiểm tra pre-abort, timeout và write UNKNOWN. Bổ sung overall execution timeout 3 phút theo spec; stop hiện chỉ đặt cờ, chưa truyền hủy tới request đang chạy.

### F05 — P1: Allowed Scope không bảo vệ Trello writes

**Source:** `packages/tool-adapters/src/trello/write-tools.ts:8–132`, `trello/read-tools.ts:96–123`, `base-adapter.ts:67–104`.

Create/update/add-member/add-checklist không xác minh board cha của list/card. Probe với whitelist `allowed-board` vẫn đi thẳng **POST** tới list khác; không có parent lookup. Search cards cũng không lọc board trong response dù caller truyền boardId đã được whitelist. Việc lọc kết quả tìm board không đủ làm security boundary.

**Đề xuất:** resolve và kiểm scope trên resource thực tế trước mọi write/read nhạy cảm, gồm destination khi move card. Chốt rõ ý nghĩa scope rỗng. Hiện live server còn dùng adapter giả; nguy cơ external write này xuất hiện khi nối adapter thật.

### F06 — P1: Validator chấp nhận plan sai và router loại bỏ tool cần cho chính demo

**Source:** `packages/planner/src/validator.ts:105–224`, `router.ts:3–24`, `prompts/system-prompt.ts:65`, `packages/tool-schemas/src/slack.ts:49–59`, `packages/executor/src/runner.ts:83–95`.

Probe xác nhận validator trả `valid: true` cho thiếu args bắt buộc, dependency không tồn tại, `$ref` tới output field không tồn tại và zero-step plan. Runner cũng không validate args sau resolve. Few-shot/evaluator dùng `channelId`, còn schema và SlackAdapter yêu cầu `channel`.

Với chính câu demo “Tạo task cập nhật homepage cho team frontend, deadline thứ 6, gán Minh, báo trên Slack”, regex router chỉ trả **slack**, loại Trello khỏi catalog. Router hiện không phải LLM Router như report mô tả.

**Đề xuất:** executable schemas cho plan và tool args; kiểm output reference, dependency existence/topology; validate resolved args/output trước ghi nhận success. Test ví dụ trong prompt bằng cùng schema. Routing phải bảo toàn yêu cầu nhiều dịch vụ và context đa lượt.

### F07 — P1: Chưa triển khai luồng Gather/Clarify và Working Memory như đặc tả

**Source:** `packages/planner/src/planner.ts:29–85`, `apps/chat-api/src/services/chat-service.ts:81–96,126–132`, `apps/chat-api/src/server.ts:237–243`.

Planner chỉ generatePlan → validate → retry; không có executor gọi search tools ở Chat Mode. Mỗi message tạo WorkingMemory mới; không lưu entities vào DB. Assistant clarification/refusal được emit nhưng không được ChatService lưu vào messages. Không có conversation summary/execution state injection như spec.

Server còn bắt mọi lỗi primary planner rồi trả plan từ MockLLMProvider. Lỗi provider hoặc lỗi validation vì vậy có thể biến thành preview được viết sẵn. `GeminiProvider` dùng default model khác plan, tự fallback sang model khác và không truyền `input.signal`. Audit xác nhận sự không nhất quán cấu hình từ code, **không kiểm tra online khả dụng của các model**.

**Đề xuất:** xây Chat Mode thực với read tools, lưu entity provenance và memory theo conversation, phân biệt lỗi với plan hợp lệ; bỏ tự động thay AI lỗi bằng plan mock trong live. Chốt model/prompt/version và cancellation trước evaluation.

### F08 — P1: Retry không có state guard, có thể thực thi lại write đã thành công

**Source:** `packages/executor/src/controller.ts:69–91,119–141`.

`retryStep` chỉ cần step tồn tại rồi reset pending; không yêu cầu failed/paused và không khóa execution đang chạy. Probe chạy thành công một lần, gửi hai retry đồng thời, runner được gọi **tổng 3 lần**. Đây là tái hiện concurrency thật của controller với external side effect thay bằng bộ đếm, không phải bằng chứng concurrency PostgreSQL.

**Đề xuất:** state transitions được định nghĩa rõ, compare-and-set/lock bền vững, chống retry succeeded/running; UNKNOWN cần reconciliation trước quyết định chạy lại. Kiểm thử retry/skip/stop đồng thời và sau restart.

### F09 — P1: Approval chưa kiểm expiry/hash; thiếu ràng buộc một pending plan

**Source:** `apps/chat-api/src/db/repositories/plan-repo.ts:18–35,56–61`, `services/execution-service.ts:40–65`, `db/v3/0001_v3_core.sql:35–47`.

SQL approve chỉ kiểm pending, không kiểm `expires_at`; execution không đọc/verify `plan_hash`. Việc query pending preview có lọc expiry không bảo vệ POST approve trực tiếp bằng ID. CreatePlan không invalidate pending plan trước và schema không có unique constraint tương ứng. Gửi nhiều message có thể giữ các preview cũ vẫn duyệt được.

**Evidence:** đọc code/SQL, chưa chạy PostgreSQL để thử race. **Đề xuất:** atomic approval gắn owner + status + expiry + approved plan version/hash, ràng buộc một pending plan theo conversation, tests DB thật cho expired/tampered/superseded/double approve.

### F10 — P1: Persist thất bại vẫn báo completed; thiếu durable execution lifecycle

**Source:** `apps/chat-api/src/services/execution-service.ts:100–150`, `db/repositories/step-repo.ts:47–73`, `packages/executor/src/controller.ts:13–15`.

onStepUpdate gọi DB không await và nuốt lỗi `.catch(() => {})`; không transaction với plan status. ExecutionService không gọi `updatePlanStatus`; controllers/outputs nằm trong Map. Probe làm mọi updateStepStatus thất bại vẫn nhận **exec_done/completed**, số lần update plan status **0**. Status hiển thị được tính từ controller memory, không chứng minh DB completed.

**Đề xuất:** DB là nguồn trạng thái, persist có await, transaction step+plan, startup recovery và unique step identity. Lưu resolved args/timestamps/duration. ACID chỉ bao phủ DB: phải thiết kế riêng cửa sổ crash sau external success nhưng trước DB commit, giữ UNKNOWN và không replay write mù.

### F11 — P1: Frontend và Settings còn báo kết quả mô phỏng

**Source:** `apps/chat-web/src/App.tsx:29,83–140,374–375`, `components/SettingsModal.tsx:55–70`, `components/ServiceCard.tsx:26–32`, `apps/chat-api/src/app.ts:46–82`.

UI dùng token cố định, khi approve trả lỗi sẽ mô phỏng bước success/failure; Edit là no-op, Cancel chỉ xóa local preview. Settings hardcode Trello connected, không truyền onSave; Test Connection sau timer luôn báo “Kết nối tốt (Ping: 120ms)”. `/api/services` probe trả **404**, không có service management routes trong createApp. Không thể cấu hình integration thật qua UI này.

Đăng nhập hiện chỉ có tài khoản demo hardcode (`auth-routes.ts:37–38`); id `u_admin` không tương thích `users.id`/`conversations.user_id` UUID của schema. Đây là mismatch source, chưa chạy PostgreSQL để tái hiện lỗi insert. Refresh không có revocation store như spec.

**Đề xuất:** tách demo mode có nhãn rõ; dựng login/session và user persistence thật; nối settings endpoints, các nút edit/reject/recovery; lỗi HTTP phải hiển thị lỗi thay vì dựng execution giả. Audit này không phê duyệt hay thay đổi hướng UI/Design System.

### F12 — P2: SSE có cơ chế replay nhưng chưa bảo đảm đồng bộ

**Source:** `apps/chat-web/src/hooks/use-sse.ts:6–13,22–96,113–121`, `App.tsx:38–78`, `apps/chat-api/src/sse/sse-manager.ts:14–35,54–60`.

Cursor dùng biến toàn module cho mọi conversation; không loại duplicate/out-of-order. Probe replay cùng seq tạo `hellohello`; `text_end` theo spec không đóng streaming vì client nghe `text_done`. Client bỏ qua error/refusal/exec_done; gửi message chưa chờ SSE open. Server buffer chỉ 100 events, không full-state sync khi cursor quá cũ hoặc process restart.

**Đề xuất:** shared event contract, cursor/dedup theo conversation, SSE-first readiness, snapshot sync và tests reconnect thật. Những helper tests hiện tại không chứng minh khả năng reconnect toàn hành trình.

### F13 — P2: Rate limiting/retry policy mới tồn tại ở mức thành phần

**Source:** `packages/tool-adapters/src/base-adapter.ts:44–54`, `rate-limiter.ts:20–49`, `trello/base.ts:62–68`, `slack/slack-adapter.ts:67–73`.

Không có lời gọi limiter trong đường HTTP adapters đã kiểm tra. 429 được ném lỗi, chưa xử lý Retry-After/retry budget theo spec; read retry cũng chưa được runner thực hiện. Các tests limiter độc lập không chứng minh global queue được sử dụng khi nhiều workflows chạy.

**Đề xuất:** gắn limiter theo service/credentials ở transport boundary, kiểm retry budgets/cancellation; không suy rộng read retry sang non-idempotent writes.

### F14 — P1 về nghiệm thu: Quality gate và E2E đang cho bằng chứng yếu hơn tên gọi

**Source:** `evaluations/evaluator.ts:55–125,147–151,175–183`, `evaluations/eval.test.ts:6`, `apps/chat-api/tests/routes/execution-routes.test.ts:7–14`, `apps/chat-api/tests/e2e/e2e-harness.ts:223–228,254–266`.

- Evaluation dựng response trực tiếp từ expectedKind/expectedTools rồi chấm nó; mặc định mock. Không chấm argument quality, extra tools/side effects, ID provenance hoặc lựa chọn entity thật.
- Test “concurrent duplicate” dùng `callCount === 1` và hai lời gọi tuần tự. SQL thật có conditional update là điểm tốt, nhưng test này không chứng minh race condition theo AGENTS.md.
- E2E harness tự ghi assistant clarification vào mock repo; ChatService thật không có hành vi này. Scenario 2 vì thế che lỗ hổng persistence/multi-turn.
- Cả ba scenario dùng canned LLM và fake adapters/repositories; không chạy browser/SaaS thật.

**Đề xuất:** giữ mock tests để kiểm orchestration, đổi tên/phạm vi evidence cho đúng. Thêm PostgreSQL integration, HTTP contract tests qua concrete adapter, browser E2E và evaluation tách held-out data. Chỉ đánh dấu live AI gate sau một run được cấp phép, có model/prompt version, rubric và kết quả lưu lại.

## 5. Phản biện kế hoạch triển khai

**Điểm hợp lý:** tách schemas/adapters/planner/executor/API/UI; giữ v2 read-only; plan-before-execute; chủ trương UNKNOWN và approval; đưa AI quality gate trước đầu tư sâu UI. Nên giữ các ranh giới này.

**Chưa nên tiếp tục dùng nguyên bản kế hoạch như checklist nghiệm thu**, vì:

1. **Spec → task chưa phủ đủ.** Task 8–10 không triển khai đầy đủ gather/tool-call/memory persistence; Task 7/14/18 không giao rõ transaction/crash recovery; không có task backend services/settings nhưng Task 25 tiêu thụ các API đó. Login/onboarding, user seeding, session revocation, reject/edit, intent dedup và overall timeout chưa có acceptance gates tương xứng.
2. **Quality gate bị thay bằng harness gate.** Task 11 test `useMock: true` tại dòng 887; spec yêu cầu AI đạt usable plan/tool accuracy. Hai loại gate phải tách biệt, không dùng test mock để mở khóa các phase tiếp theo.
3. **Kế hoạch tự mâu thuẫn với Evidence Standards.** Task 18 ở dòng 1324–1328 quy định counter mock cho approval, trong khi AGENTS yêu cầu query thật/in-memory DB có semantics thật. TDD chỉ tạo giá trị khi assertions có khả năng bắt lỗi cần phòng.
4. **E2E không đạt định nghĩa demo.** Task 26 dùng mock flow ở dòng 1849 trở đi; spec đòi 3 scenario trên dịch vụ thật. Cần phân rõ unit, integration có DB, browser E2E và live acceptance; không buộc mọi CI gọi SaaS.
5. **Interface chưa chốt tới mức executable.** Async AdapterFactory/sync runner, `channelId`/`channel`, `text_end`/`text_done`, UUID/demo ids là các mismatch compiler hiện không phát hiện vì `any` và fixture tự định nghĩa lại contract.
6. **Thứ tự thiên về xây component trước chứng minh lát cắt chạy thật.** Nên có một luồng hẹp login → gather một entity → plan một write → approve → persist → SSE trước mở rộng đủ 11 tools và UI; bước read-only/transport fake chạy trước live write được cấp phép.
7. **Cơ chế nghiệm thu chưa đủ cụ thể.** Checklist cuối plan tick “all phases covered”, nhưng Review Focus trỏ nhầm task: SSE được nói Task 19 và double approval Task 20, thực tế là 17/20 và 18. Cần ghi yêu cầu nào, test nào, command/output nào, reviewer nào và commit nào; không chỉ “PASS”.
8. **Bản thân spec cần làm rõ.** DB transaction không thể atomic với Trello/Slack; cần state machine xử lý uncertainty. “Không bao giờ credentials trong browser” cần phân biệt input admin lúc connect với việc không trả lại/lưu client sau đó. “Một model” và ngoại lệ router model nhanh hơn phải định nghĩa chính xác. Trường thinking chỉ nên được nghiệm thu như giải thích kế hoạch ngắn, không dùng độ dài reasoning làm bằng chứng chất lượng/an toàn.

## 6. Thứ tự sửa đề xuất — PROPOSED, chưa thực hiện

| Gate | Phạm vi/owner theo team workflow | Điều kiện kết thúc |
|---|---|---|
| G0 — Runtime trung thực và auth | Backend + Frontend | Demo/live tách rõ; thiếu config dừng live; bỏ token bypass; có login user/UUID thật; UI không dựng success khi backend lỗi |
| G1 — Contract và quyền dữ liệu | Schemas owner + Backend + AI | Shared DTO/schema; adapter async thống nhất; owner checks; scope/resource validation; input/output/$ref validation; approve owner/hash/TTL/supersession |
| G2 — Executor bền vững | Backend | Transactions có await; durable states; khóa retry; cancellation tới fetch; crash-after-write test; UNKNOWN reconciliation; rate limiter/retry budget tích hợp |
| G3 — AI có dữ liệu thật | AI + Integration | Gather read tools, clarify/memory persistence, entity provenance, prompt/schema agreement, model version cố định, bounded cancellation; offline fixtures không đọc đáp án để sinh response |
| G4 — Một luồng tích hợp qua UI | Frontend + Backend | Login, SSE-first, chat → preview → approve/reject, settings/connect/test thật; browser tests gồm reconnect/error/UNKNOWN/recovery |
| G5 — Nghiệm thu demo/evaluation | Các owner + reviewer độc lập | DB integration xanh; 50-prompt eval có rubric và artifact; 3 scenario live được cấp phép; đo latency; README/report cập nhật theo evidence |

Không mở rộng GitHub/Sheets/OAuth trước khi G0–G5 đạt. Đây là thứ tự ưu tiên sửa, không phải lịch cam kết hay ước lượng ngày công. Với chính sách sequential tasks hiện tại, cần sửa kế hoạch và traceability trước khi áp dụng các gate này làm kế hoạch thi công.

## 7. Những quyết định còn OPEN

- Đích bàn giao trước mắt là demo mô phỏng có nhãn rõ hay demo thao tác Trello/Slack thật? Spec hiện yêu cầu loại thứ hai.
- Chế độ deployment và DB v3 riêng được chọn như thế nào; startup/migration/seed sẽ chạy ở đâu?
- Ai được cấu hình shared credentials và scope; credential rotation/revocation sẽ vô hiệu adapter cache ra sao?
- Model, ngân sách, tài khoản test và phạm vi live evaluation/live writes cần được chốt trước khi chạy. Audit không cấp phép các hoạt động đó.
- Quy tắc UNKNOWN reconciliation, retry/skip một step có downstream references và crash recovery cần chốt thành state machine kiểm thử được.
- Hướng UI/Design System và bằng chứng phê duyệt nằm ngoài kết luận audit chức năng này.

**Đánh giá cuối:** công việc đã có giá trị ở cấu trúc module, contract khai báo và các thành phần cơ bản; khối lượng code vượt xa trạng thái report. Tuy nhiên, cần mở lại các task nghiệm thu tương ứng với findings, đặc biệt foundation runtime/auth, AI core, adapters, executor và settings. Không nên tuyên bố Phase 4 “Certified”, AI quality gate đạt hoặc end-to-end live hoàn tất ở HEAD này.
