# `@wap/api`

API HTTP local của MVP B. API-01 cung cấp boundary chạy trên `127.0.0.1`, đăng nhập một tài khoản demo duy nhất, bearer session trong bộ nhớ và `GET /api/v1/servers`. API-02 nối `POST /api/v1/runs` (durable `202`) và worker planner bất đồng bộ qua PostgreSQL outbox. API-03 bổ sung `GET /api/v1/runs`, detail read model, polling events (tối đa 200), trace cursor HMAC trên snapshot REPEATABLE READ (100 attempt/trang, tối đa 10.000) và reconciliation projection chỉ đọc. API-04 nối approval/cancel qua HTTP, dispatcher execute outbox, startup orphan recovery và expiry maintenance theo đồng hồ PostgreSQL. API-05 có acceptance loopback cho task_hub và filesystem + task_hub, kèm frontend handoff. API-CATALOG bổ sung catalog reviewed sâu: `GET /api/v1/servers/catalog` chỉ đọc, không launch/ensure MCP; `POST /api/v1/servers/check` là active check duy nhất, dùng preset reviewed cố định, không nhận executable/slug/args từ client và rate-limit 5 giây mỗi principal.

## Cấu hình bắt buộc

Không có mật khẩu hay secret mặc định trong mã nguồn. Trước khi chạy cần đặt:

- `G1_DATABASE_URL`: PostgreSQL của workspace.
- `API_DEMO_EMAIL`: email tài khoản demo đã seed trong database.
- `API_DEMO_PASSWORD_HASH`: chuỗi scrypt theo định dạng `scrypt$16384$8$1$<salt-hex-32>$<key-hex-128>`.
- `API_CURSOR_KEY`: khóa 32 byte ở dạng base64 chuẩn (ký HMAC cho trace cursor).

Tuỳ chọn: `API_PORT` (mặc định `3001`), `API_SESSION_TTL_MS` (mặc định 8 giờ), `G1_USER_ID`, `API_PLANNER_MODE` (`disabled` hoặc `dev_fixture`), `API_NEW_RUNS_ENABLED` (`1` mặc định; đặt `0`/`off` để tạm ngắt nhận run mới), và `AI_PROVIDER_CALLS_ENABLED` (`1` mặc định; đặt `0`/`off` để chặn provider call trước credential/ledger/fetch). Tạo hash/key trong một phiên shell riêng hoặc secret manager; không truyền mật khẩu như command-line argument.

### OIDC cookie session (feature-gated)

OIDC mặc định tắt để giữ Baseline B/local. Chỉ bật trong môi trường cô lập sau khi
đã đăng ký redirect URI và scope với issuer:

- `OIDC_ENABLED=1`
- `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`
- `OIDC_REDIRECT_URI` và `OIDC_WEB_ORIGIN` (HTTPS ngoài loopback)
- tuỳ chọn `OIDC_AUDIENCE`, `OIDC_SCOPES`, `OIDC_SESSION_COOKIE_NAME`,
  `OIDC_TRANSACTION_TTL_MS`, `OIDC_SESSION_TTL_MS`, `OIDC_CLOCK_SKEW_SECONDS`

Khi bật, API dùng Authorization Code + PKCE, lưu identity/session/transaction
ở PostgreSQL dạng hash cần thiết, và đặt cookie session HttpOnly/SameSite. Cookie
CSRF double-submit là giá trị riêng, không chứa provider token. Password login bị
tắt bởi cấu hình OIDC; provider secret không bao giờ đi qua browser. Chạy
`npm run check:oidc` để tạo manifest bằng chứng đã scrub; manifest `OPEN` không
phải production approval.

Mẫu biến môi trường staging không chứa secret ở
[`config/oidc-staging.env.example`](../../config/oidc-staging.env.example); quy
trình nạp secret và acceptance evidence ở
[`docs/auth-evidence/OIDC-01/STAGING-PREP.md`](../../docs/auth-evidence/OIDC-01/STAGING-PREP.md).

## Lệnh

Từ root workspace:

```text
npm run build -w @wap/api
npm run test:unit -w @wap/api
npm run test:integration -w @wap/api
npm run api:generate
npm run check:api
npm run check:oidc
npm run api:dev
```

`check-api.mjs` writes a new sanitized evidence directory under
`docs/api-evidence/` and returns `0` only for a technical pass, `2` for an
honest partial gate (for example, a required negative matrix that has not been
established), and `1` for a command or cleanup failure. A partial result is
not a passing process exit. The runner consumes structured Vitest reports for
the H01–H20 matrix and independently compares owned database, temp-root and
project-process snapshots after every command.

Integration test tự tạo database tạm trong PostgreSQL local và xoá database đó khi kết thúc. API chỉ bind loopback; mọi request trả `x-request-id`, JSON strict và `Cache-Control: no-store`. `GET /health/live` không auth và chỉ phản ánh process; `GET /health/ready` không auth, kiểm tra DB qua `SELECT 1` khi chạy main và trả `503 NOT_READY` nếu dependency lỗi. `POST /auth/logout` yêu cầu bearer hợp lệ, xoá session hiện tại và trả `204`; restart vẫn xoá toàn bộ session vì store hiện còn in-memory. `API_PLANNER_MODE=disabled` giữ `POST /runs` ở trạng thái `503 PLANNER_UNAVAILABLE`; `dev_fixture` chỉ nhận đúng các prompt server-owned trong `testdata` và không phải AI evaluation. Trace snapshot hết hạn sau 15 phút; cursor sai owner/run, hết hạn hoặc bị sửa trả `400`.

### Pilot v2: planner seam thử nghiệm

`POST /pilot/v2/runs` mặc định vẫn dùng checklist và preview được dẫn xuất từ source,
**không gọi AI provider**. API có port `pilotPlanner` chỉ được inject tường minh
trong `createApi` (chưa được `main.ts` cài đặt). Ở đường opt-in này, router lưu
run + source snapshot vào PostgreSQL trước khi gọi planner; callback chỉ nhận
context đã đóng gói/escape và che các credential cấu hình đã biết; chỉ được đề xuất `plan` (công cụ duy nhất
`trello.create_card`), `clarification` hoặc `refusal`. Policy tạo write args và
approval riêng sau khi kiểm lại snapshot, owner, checklist, board/list; model
không được cấp quyền duyệt, chọn target hay dispatch. Lỗi/timeout và planning
bị bỏ dở kết thúc không approval, không tự resume.

Đường planner opt-in nay nhận **adapter có provider/model/ước lượng chi phí cố định**,
đòi grant PostgreSQL còn hiệu lực cho từng principal và campaign `pilot-v2:<principalId>`
được operator provision riêng (không có endpoint cấp quyền). Admission khoá campaign/grant,
đếm call dưới khoá rồi reserve ledger cùng transaction; chỉ một claim được dispatch.
Sau claim, lỗi không rõ chi phí giữ hold và không retry tự động; chi phí xác định được
settle kể cả khi grant bị thu hồi. Trước preview approval và trước write, policy/grant
được kiểm lại. Outcome trả về cho owner chỉ dùng reason code/thông điệp server cố định,
không lưu câu hỏi/lý do thô của model. `main.ts` **chưa cài provider**; phép thử
adapter fake/PostgreSQL/HTTP là bằng chứng offline, không xác nhận chất lượng AI,
provider thật, hoặc nghiệm thu khách hàng. Gate **offline contract: CONFIRMED**
(`npm run check`, API PostgreSQL/HTTP 49/49, engine PostgreSQL ledger 6/6,
`git diff --check`, 2026-09-27); phạm vi này không xác nhận khả năng egress thực tế.
Revocation ngay sau kiểm quyền cuối và trước Trello POST là best-effort, không được
hiểu là khóa giao dịch xuyên qua network. **AI_QUALITY_NOT_MEASURED**,
**CUSTOMER_VALIDATED_NOT_RUN**, provider thật **NOT_RUN**; không nối provider thật
trước quyền, quota và rubric riêng.

Ở môi trường không phải test, API ghi một JSON log cho mỗi request với đúng
`event`, method, route template, status và `request_id`. Route template không
chứa UUID/query string; body, header, bearer token, prompt và secret không được
đưa vào log. Có thể inject `requestLogger` trong fixture để kiểm tra log mà
không bật console output.

`GET /api/v1/servers/catalog` yêu cầu bearer session và gọi
`serverCatalog({ connect: false })`; khi gateway manager chưa có connection,
route trả hai entry disconnected với `tools: []` mà không mở MCP. Chỉ
`POST /api/v1/servers/check` mới gọi `serverCatalog({ connect: true })` qua
callback launch reviewed cố định. Body nếu có được tiêu thụ và bỏ qua; nó
không thể chọn server, executable hay arguments. Active check trả `429` với
`Retry-After` integer nếu gọi lại trong 5 giây; lỗi config/connection được
sanitise thành `503`. Session vẫn in-memory; planner fixture không phải AI
evaluation, còn LLM/retrieval/replan, BullMQ và browser integration vẫn là
giới hạn ngoài technical catalog gate.

### Pilot v2 Phase B: offline fake advisory campaign (library only)

`src/pilot-evaluation/index.ts` xuất các entrypoint tách quyền: `freezeManifest` /
`assertFrozen`, `provisionOfflineCampaign(adminUrl, manifest)` cho bootstrap **database
mới** trên PostgreSQL cô lập `127.0.0.1:55532`, `openEvaluationStore` và
`runOfflineCampaign({ manifest, bundle, receipt, repoRoot })` cho producer,
`openReadonlyEvaluationStore` và `buildOfflineReport(readOnly, oracle)` cho báo cáo.
Oracle chỉ được đưa cho grader sau producer; `appendGrade` là thao tác riêng
trên evaluator store, không thuộc báo cáo chỉ đọc. Không có CLI, app launcher,
transport provider hoặc quyền write SaaS mới. `offline_fake`, provider metadata
`google|openai`, model `offline-fixture-*` và cost dương chỉ là **SIMULATED_NOT_BILLED**.

Manifest/artifact cần JSON bounded/strict, frozen hash, exact **clean Git HEAD**
và digest nguồn cố định cho evaluator code/projection/prompt/schema/fake/rubric;
producer kiểm lại cùng manifest/marker/role/fixture trước claim một lần. Hai
principal đăng nhập password qua hai `createApi` loopback thực với session mặc
định; cleanup duy nhất là owner `rejected` dùng approval hiện thời. Nếu POST/runId,
ledger, usage/cost hoặc capture không chắc chắn, campaign dừng, **không retry**;
restart chỉ mở report SQL readonly, không gọi detail GET (GET có lifecycle sweep).
`provisionOfflineCampaign` không tự drop DB/roles khi thành công; giữ measurement
bền vững cho operator đối chiếu. Chỉ test fixture mới xóa các tên DB/role ghi
trong receipt thuộc chính invocation. Không log/stringify receipt vì chứa login
và DB credentials. Bootstrap cần admin test cô lập và extension vector/pgcrypto,
không dùng DB demo hoặc biến môi trường sản phẩm làm fallback.

TDD integration trong workspace dirty chỉ mock **Git evidence reader** trong
Vitest; DB, auth, admission, ledger và HTTP là thật trên fixture synthetic.
Positive provenance không mock chỉ chạy ở detached clean checkout với
`PILOT_EVAL_CLEAN_CHECKOUT=1` và file `pilot-evaluation-clean.integration.test.ts`.
`npm run check` không tự bao gồm suite PostgreSQL; chạy các
`pilot-evaluation-*.integration.test.ts` tuần tự trên DB test cô lập. Event
hash và immutable seals chứng minh tính nhất quán dưới role bị giới hạn, **không
chống DB admin rewrite** hoặc chứng minh đủ observation khi missing/late data.
Structural oracle không thấy prose; không đo specificity/refusal semantic,
citation, hallucination hay model/provider latency. Nhãn giữ nguyên:
`AI_QUALITY_NOT_MEASURED`, `CUSTOMER_VALIDATED_NOT_RUN`, `HANDOFF_BLOCKED`.
Không dùng fake pass rate để tuyên bố chất lượng AI, bill thật hoặc SaaS live.
