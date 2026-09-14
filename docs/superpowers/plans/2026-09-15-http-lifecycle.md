# Đợt 3A — API-01 đến API-05 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nối HTTP/session vào engine B/local, cung cấp dữ liệu cho hai màn hình và nghiệm thu lifecycle bằng HTTP/PostgreSQL/MCP thật.

**Architecture:** HTTP adapter nhỏ trong `apps/api`; lifecycle vẫn ở `packages/engine`. PostgreSQL status/event/outbox và worker lease hiện có giữ quyền quyết định. Một dispatcher tuần tự; planner demo có nhãn rõ trong lúc planner AI chưa có.

**Tech Stack:** Node >=22, TypeScript ESM/NodeNext, `node:http`, `node:crypto`, Zod hiện có, `@wap/db`, `@wap/dsl`, `@wap/engine`, postgres.js hiện có, Vitest hiện có. Không thêm framework, Redis/BullMQ hoặc model SDK trong đợt này.

**Spec:** [2026-09-15-http-lifecycle-design.md](../specs/2026-09-15-http-lifecycle-design.md). Executor đọc cả spec lẫn task; spec chứa quyết định về auth, admission, cursor, startup, redaction và HTTP delta.

## Global Constraints

- `PROPOSED`, chưa implementation; viết plan không phải bằng chứng runtime.
- Baseline: `B/local`; Node `>=22`; PostgreSQL `16`; polling `2 giây`.
- `Một tài khoản demo, session và owner check.`
- `Một worker thực thi tuần tự theo thứ tự topo; lớp DAG dùng cho validation/hiển thị.`
- `TTL 10 phút theo đồng hồ server; hết hạn → expired; replan → superseded approval cũ.`
- `Status/event seq/outbox commit cùng transaction; phát hiện orphan sau crash, không tự resume.`
- `Không credential trong prompt/log/trace; không SaaS credentials trong local mode`.
- `Exact launch allow-list và local file root confinement`.
- Approval request wire field là `workflow_version_id`; không gửi `version_id`.
- Không sửa migrations0001–0005, raw evidence lịch sử, expected outputs/holdout để làm test xanh.
- Không thay persistent demo DB/root khi test. Tạo fixture UUID, kiểm resolved path trước cleanup.
- Chỉ stage exact paths theo `docs/GIT-POLICY.md`; commit từng task sau review, push là bước riêng.
- Không dispatch implementation/subagents chỉ vì đọc plan này; user hiện chỉ giao viết plan. Khi được giao task, dùng phương thức triển khai user đã chọn.

---

## 0. Trạng thái đầu vào, thứ tự và đầu ra

Checkpoint screen: `35cd003` — `docs: add proposed two-screen layouts and component examples`. Mỗi executor phải lấy lại `git status`, `git log -1`, đọc source thật; không giả định HEAD còn nguyên sau khi agent khác làm việc. Untracked captures tồn tại từ trước, không tự add/delete.

```text
API-01 HTTP + auth
  → API-02 durable acceptance + planner seam + prepare worker
  → API-03 detail/events/trace/history/reconciliation
  → API-04 approval/cancel/expiry + execute worker
  → API-05 actual-socket acceptance + evidence + frontend handoff
  → WEB-01 component shell (plan riêng) → WEB-02 lifecycle → WEB-03 browser gate
```

API-03 có thể review read model độc lập sau API-02. Không triển khai API-03 và API-04 đồng thời vì cùng sửa engine/store/routes. Mỗi task là một checkpoint review; các checkbox bên trong là thao tác nhỏ. Nếu một checkbox cần quá nhiều context, chia thành các commits phụ trong chính task, không bỏ tiêu chí nghiệm thu.

| Task | Sản phẩm nghiệm thu riêng | Điều kiện chuyển tiếp |
|---|---|---|
| API-01 | HTTP chạy thật, login/session thật, từ chối request không hợp lệ | Unit + socket/auth integration pass |
| API-02 | 202 sau commit, một run ID, chuẩn bị read/approval async | DB/MCP read integration, CLI regression |
| API-03 | Dữ liệu UI có nguồn thật, paging/reconnect/owner/redaction | Pagination/concurrency/source-isolation tests pass |
| API-04 | Duyệt/từ chối/huỷ/expiry/execution qua HTTP | Race/crash/unknown tests pass |
| API-05 | Acceptance loopback hai server + evidence tái lập | API technical gate pass; browser/AI vẫn nhãn riêng |

## 1. File map

Các path dưới đây là **đề xuất tạo mới**, trừ các file ghi Modify. Không import file đề xuất trước task tạo nó.

| File | Trách nhiệm | Task |
|---|---|---|
| `apps/api/package.json`, `tsconfig.json`, `vitest.unit.config.ts`, `vitest.integration.config.ts` | Workspace build và test | 01 |
| `apps/api/src/config.ts` | Parse config trusted; bind loopback, credentials, cursor key | 01 |
| `apps/api/src/http.ts` | Body byte limit, JSON parse, response/error safe | 01 |
| `apps/api/src/auth.ts` | Scrypt verifier, bearer sessions/throttle | 01 |
| `apps/api/src/app.ts` | Route matching, principal, delegate service | 01–04 |
| `apps/api/src/main.ts` | Bootstrap DB/server/worker; close có thứ tự | 01–04 |
| `apps/api/src/dev-planner.ts` | Ba entry dev allowlist, không AI | 02 |
| `apps/api/src/worker.ts` | Nonoverlap dispatcher, error reporting, stop | 02,04 |
| `apps/api/src/gateway-manager.ts` | Open/close gateway theo principal + trạng thái discovery | 02,03 |
| `apps/api/src/cursors.ts` | Trace HMAC token codec | 03 |
| `apps/api/src/read-model.ts` | Paginated trace snapshots + response projection | 03 |
| `apps/api/src/redaction.ts` | Copy/project safe, không sửa persisted evidence | 01,03 |
| `packages/engine/src/accept.ts` | Atomic admission/create planning/outbox | 02 |
| `packages/engine/src/planner-port.ts` | Planner seam typed | 02 |
| `packages/engine/src/jobs.ts` | Claim/routing/recovery cho durable jobs | 02,04 |
| `packages/engine/src/maintenance.ts` | Pending approval expiry | 04 |
| `packages/engine/src/prepare.ts`, `engine.ts`, `store.ts`, `index.ts` (Modify) | Split accepted-run path; giữ API CLI cũ | 02–04 |
| `packages/engine/src/recovery.ts` (Modify) | Atomic strict cancel; startup recovery helper dưới lease | 04 |
| `packages/engine/src/execute.ts` (Modify nếu cần) | Tách lease wrapper, giữ dispatch/operation guards | 04 |
| `db/migrations/0006_http_trace_snapshots.sql` | Bảng snapshot trace phục vụ paging | 03 |
| `packages/db/src/schema.ts` (Modify) | Mapping table mới | 03 |
| `packages/dsl/src/contracts.ts`, `index.ts`, `scripts/emit-openapi.ts` (Modify) | Schema display/errors/login/reconciliation + generator | 01,03,04 |
| `docs/API.md`, `docs/EXECUTION-CONTRACT.md` (Modify khi implement) | Wire fields và phạm vi runtime đã chứng minh | 02–05 |
| `docs/openapi.yaml` (Generate) | Contract versioned; không edit tay | 01,03,04 |
| `apps/api/tests/fixture.ts` | Owned DB/root/server + helpers | 01–05 |
| `apps/api/tests/*.test.ts`, `*.integration.test.ts` | Test liệt kê theo task | 01–05 |
| `scripts/check-api.mjs` | Gate subprocess + evidence directory mới | 05 |
| `docs/API-STATUS-2026-09-15.md`, `docs/FRONTEND-HANDOFF.md` | Status evidence và bàn giao UI | 05 |

Root `package.json`, `package-lock.json`, `tsconfig.json` chỉ cập nhật để include workspace/scripts. Giữ phiên bản các dependencies/pinned MCP đã có; không chạy upgrade hàng loạt. Báo cáo mới dưới `docs/api-evidence/batch-03/API-01.md` đến `API-05.md`; raw capture trong `<task>/<unique-run-id>/`, không ghi lại cùng đường dẫn.

## 2. Interface dùng xuyên task

Định nghĩa trong file đúng task, export ở barrel được chỉ ra. Đây là signatures đích, không phải API đã tồn tại.

```ts
// packages/engine/src/planner-port.ts (API-02)
import type { z } from 'zod';
import type { CreateRunSchema, PlannerResult, RunDetailSchema } from '@wap/dsl';
export type CreateRun = z.infer<typeof CreateRunSchema>;
export type RunDetail = z.infer<typeof RunDetailSchema>;
export interface PlannerPort {
  readonly mode: 'dev_fixture' | 'ai';
  produce(input: {
    runId: string;
    userId: string;
    request: CreateRun;
    runtime: Record<string, string>;
  }): Promise<PlannerResult>;
}
```

Engine public API đích bổ sung, giữ tất cả method CLI cũ:

```ts
accept(request: unknown): Promise<{ run_id: string; status: 'planning' }>;
prepareAccepted(id: string, planner: PlannerPort): Promise<RunDetail>;
events(id: string, sinceSeq?: number, limit?: number): Promise<EventPage>;
cancel(id: string, options?: { strictTerminal?: boolean }): Promise<RunDetail>;
list(): Promise<RunDetail[]>;
```

`EventPage` là `z.infer<typeof EventPageSchema>`. `prepareAccepted` có gateway và tự quản lý worker lease; `accept`, list/detail/events/cancel không cần gateway. `execute`/`decide` tiếp tục signature hiện có. Nội bộ worker gọi hàm đã tách dưới lease, không gọi public wrapper gây lock lồng nhau.

```ts
// apps/api/src/app.ts, tạo ở API-01
import type { Server } from 'node:http';
import type { Database } from '@wap/db';
export interface ApiConfig {
  host: '127.0.0.1'; port: number; userId: string;
  email: string; passwordHash: string;
  sessionTtlMs: number; cursorKey: Buffer;
  plannerMode: 'disabled' | 'dev_fixture';
}
export interface ApiRuntime {
  server: Server;
  listen(): Promise<string>; // URL includes /api/v1, port0 resolved after listen
  close(): Promise<void>;
}
export interface WorkerControl {
  start(): void; wake(): void;
  stop(): Promise<void>;
}
export function createApi(options: {
  db: Database; config: ApiConfig;
  worker?: WorkerControl;
}): ApiRuntime;
```

Thêm dependencies planner/gateway/read model vào options ở task sở hữu chúng bằng named fields; không dùng global mutable singleton hoặc unsafe casts. `createApi()` không tự migrate/seed/listen. `main.ts` là nơi cấu hình runtime, test import app không được mở port ngầm.

Test fixture trong `apps/api/tests/fixture.ts` phải cung cấp những helper được dùng ở các ví dụ sau:

```ts
export interface ApiFixture {
  baseUrl: string; // includes /api/v1
  userId: string;
  db: Database;
  password: string; email: string;
  b02Prompt: string; // lấy entry dev b02 thật, không hardcode dịch lại
  login(): Promise<string>;
  call(method: string, path: string, body?: unknown, token?: string): Promise<Response>;
  close(): Promise<void>;
}
export function makeApiFixture(options?: {
  workerEnabled?: boolean;
  filesystemEnabled?: boolean;
  plannerMode?: 'disabled' | 'dev_fixture';
}): Promise<ApiFixture>;
```

`call` dùng Node `fetch(baseUrl+path)`, headers JSON khi có body, bearer chỉ khi token được truyền; không retry. `login` assert200 rồi trả token, không console.log token. `close` idempotent, stop worker/server trước gateway, đóng DB trước drop đúng tên `api_it_<uuid>`, xóa đúng root tạm đã xác nhận nằm dưới temp prefix do fixture tạo. Không lặp lại admin URL/credentials trong output.

API-01 fixture mới chỉ cần DB+HTTP, các option worker/filesystem được nối ở API-02/API-04. Test API-01 không gọi chức năng chưa có. Trong fixtures chỉ test được phép inject fault hooks; public request không được bật hooks.

## API-01 — HTTP boundary và demo session

**Files:** tạo package/config/http/auth/app/main/redaction và test fixture ở file map; sửa root scripts/typecheck include; thêm LoginRequest/LoginResponse/ApiError schemas và generator. Tests: `http.test.ts`, `auth.test.ts`, `auth.integration.test.ts`. Report `docs/api-evidence/batch-03/API-01.md`.

**Consumes:** Database, `DEMO_USER_ID`, users row; bearer scheme từ generator.
**Produces:** `createApi`, `ApiConfig`, `ApiFixture`, `SessionStore.login(email,password)`, `SessionStore.authenticate(header)`; các route sau dùng cùng authentication middleware.

- [ ] Đọc spec sections1–2/5/6, Git policy, source auth seed. Ghi task preflight HEAD/status; không in `.env`/hash credentials. Chạy `node --version`, xác nhận >=22.
- [ ] Tạo workspace `@wap/api` version0.1.0, private,type module. Runtime deps `@wap/db`, `@wap/dsl`, `@wap/engine` version0.1.0 và Zod cùng version range engine; postgres.js cùng pinned3.4.9 nếu import trực tiếp. Scripts và config:

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "dev": "tsx src/main.ts",
    "test:unit": "vitest run --config vitest.unit.config.ts",
    "test:integration": "vitest run --config vitest.integration.config.ts"
  }
}
```

`tsconfig.json` extends `../../packages/dsl/tsconfig.json`, rootDir src/outDir dist, include src/**/*.ts. Vitest include tests/**/*.test.ts, unit exclude integration; integration include tests/**/*.integration.test.ts; `fileParallelism:false`, `testTimeout:30000`, `hookTimeout:60000`. Root build thêm API cuối chuỗi; root tsconfig include source/tests/config API. Root script mới `api:dev`, `api:start`; cập nhật lock bằng npm install workspace có kiểm diff pinned dependencies, không `npm update`.

- [ ] Viết test HTTP red: malformed JSON400, unknown fields400, wrong media415, body vượt65536 bytes413 kể cả chunked/no Content-Length; không gọi handler sau parse fail. `requestTimeout=15000`, `headersTimeout=10000`, body read timeout10000. Không dựa Content-Length do client khai để giới hạn memory.
- [ ] Chạy `npm run test:unit -w @wap/api`; ghi fail có liên quan. Implement helper:

```ts
// http.ts: tạo HttpError(status,code,message) và export cùng readJson
export async function readJson(req: import('node:http').IncomingMessage) {
  const media = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  if (media !== 'application/json') throw new HttpError(415,'UNSUPPORTED_MEDIA','JSON required');
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const raw of req.iterator({destroyOnReturn:false})) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    bytes += chunk.length;
    if (bytes > 65536) throw new HttpError(413,'BODY_TOO_LARGE','Body exceeds 64 KiB');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400,'INVALID_JSON','Invalid JSON'); }
}
```

Ví dụ cần bổ sung close/aborted handling trong handler: một response duy nhất; body deadline clear trong finally; disconnect trước body hoàn tất không tạo run. Khi request quá lớn, trả413 nếu socket còn writable và close connection có kiểm soát. Test qua socket thật để chứng minh không chỉ helper pass.

Không dùng iterator mặc định có thể destroy request socket ngay khi throw413, làm client chỉ nhận ECONNRESET. Với nhánh quá lớn, đặt `Connection: close`, flush error response rồi đóng socket; không tiếp tục buffer phần body còn lại.

- [ ] `ApiConfig` từ trusted env: `API_PORT` default3001 (0 chỉ test), `API_DEMO_EMAIL`, `API_DEMO_PASSWORD_HASH`, `API_CURSOR_KEY` bắt buộc; `G1_USER_ID` defaultDEMO_USER_ID; `API_PLANNER_MODE` defaultdisabled. Check user UUID tồn tại; thiếu config fail startup với tên key, không in value. `API_CURSOR_KEY` base64 decode đúng32bytes, parser reject noncanonical. `API_SESSION_TTL_MS` không expose user; config nội bộ default28800000.
- [ ] Implement scrypt encoded format `scrypt$16384$8$1$<saltHex32>$<keyHex128>`, salt16 bytes, derived64 bytes; check exact bounds trước gọi crypto. Async `scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:33554432})`, `timingSafeEqual` sau check lengths. Email phải khớp config và DB principal, sentinel login-disabled không thể authenticate. Wrong email vẫn chạy password KDF để tránh shortcut rõ ràng.
- [ ] Cấp token `randomBytes(32).toString('base64url')`; map chỉ lưu SHA256(token) → userId,expiresAt. Bearer parse đúng một header, không query token hoặc client `user_id`. Max100 sessions; prune expired, vượt giới hạn trả429. Throttle login10 attempts/IP/minute, map max100 entries, trust socket address, không tin X-Forwarded-For. Chặn hơn4 KDF đồng thời bằng429. Restart xóa sessions có chủ ý.

- [ ] Ghi hướng dẫn cấp config auth trong `apps/api/README.md`: test tự tạo password random chỉ ở RAM và tính scrypt; người dùng chạy setup tương tác đọc password không echo, xuất hash scrypt/cursor key vào cấu hình local bị ignore. Nếu thêm helper setup, tạo `apps/api/src/auth-setup.ts`, script `auth:setup`, dùng terminal raw-mode để che input và restore TTY trong finally; không nhận password qua argv/history, không tự chạy helper với credentials user. Đề xuất file env local chỉ dùng khi user chủ ý nạp; API không in hash/key trong startup log. Không hardcode password dùng chung, không biến `LOCAL_DEMO_LOGIN_DISABLED` thành mật khẩu mặc định.
- [ ] Test auth red/green: password sai/empty/sentinel401, token random401, expiry401, mới login200, wrong owner404 khi route được nối; auth failures không đọc MCP. Response/login/errors đặt `Cache-Control:no-store`; không log body/header/secret. Log chỉ method, route template, status, request_id; error nội bộ được classify trước stringify.

```ts
// auth.integration.test.ts
import { it, expect } from 'vitest';
import { makeApiFixture } from './fixture.js';
it('gives a bearer session only for the configured demo credentials', async () => {
  const f = await makeApiFixture();
  try {
    const bad = await f.call('POST','/auth/login',{email:f.email,password:'wrong'});
    expect(bad.status).toBe(401);
    const token = await f.login();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const res = await f.call('GET','/servers',undefined,token);
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(f.password);
  } finally { await f.close(); }
});
```

API-01 `/servers` trả known presets disconnected/unreviewed, không fake connected. Route chưa nối trả501 code NOT_IMPLEMENTED, có auth trước; ghi rõ tạm thời trong report, xóa toàn bộ501 stub trước API-05. Unknown URL404, known path wrong method405 với Allow; OPTIONS chỉ same-origin policy, không wildcard credential CORS. Nếu Origin có mặt phải khớp host/port local được configured, reject403; không dùng CORS để thay auth.

- [ ] Thêm shared Zod schemas strict và export; update generator errors400/413/415/429/500/503 và bearer; giữ login `{token}`. `node:http` gửi JSON content-type UTF8 và X-Content-Type-Options nosniff. `createApi.close` đóng listener/connections có timeout trước db.close do main quản lý.
- [ ] Chạy commands gate01 dưới đây; kiểm response/log dùng một secret canary test-generated nhưng không ghi secret vào report.
- [ ] Viết API-01 report files changed/tests/limits. Stage đúng files đã sửa, review cached diff/secret, commit `feat(api): add local HTTP boundary and bearer sessions`.

## API-02 — Accept run nguyên tử và chuẩn bị async

**Files:** tạo accept/planner-port/jobs trong engine, dev-planner/worker/gateway-manager API; sửa engine/prepare/store/index và app/main. Tests `packages/engine/tests/accepted-run.integration.test.ts`, `apps/api/tests/create-run.integration.test.ts`, `apps/api/tests/dev-planner.test.ts`. Report API-02.md.

**Consumes:** API-01 auth/config/fixture; `CreateRunSchema`, `RunAcceptedSchema`, `PlannerResultSchema`, `buildRuntime`, Store transactions/lease, reviewed Gateway.
**Produces:** engine.accept/prepareAccepted, dev PlannerPort, worker chuẩn bị run trong outbox, durable planner_result.

- [ ] Viết red test worker disabled: POST hợp lệ trả202, GET detail trả planning/version null, DB có đúng1 workflow/run/event/prepare outbox. Không MCP process/call trước commit. Chặn malformed JSON/zone/extra plan/user fields trước transaction, 0rows mới.

```ts
// create-run.integration.test.ts
it('commits the accepted run before background preparation', async () => {
  const f = await makeApiFixture({workerEnabled:false,plannerMode:'dev_fixture'});
  try {
    const token = await f.login();
    const res = await f.call('POST','/runs',{source_prompt:f.b02Prompt},token);
    expect(res.status).toBe(202);
    const accepted = await res.json();
    expect(accepted.status).toBe('planning');
    const detail = await (await f.call('GET',`/runs/${accepted.run_id}`,undefined,token)).json();
    expect(detail.workflow_version_id).toBeNull();
    const rows = await f.db.client`SELECT job_kind,delivered_at FROM run_outbox WHERE run_id=${accepted.run_id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].job_kind).toBe('prepare');
    expect(rows[0].delivered_at).toBeNull();
  } finally { await f.close(); }
});
```

Imports `it,expect,makeApiFixture` như gate01, không dùng test global chưa config. Minimal GET detail route ở task này gọi engine.detail; projector đầy đủ API-03. API-02 test không dựa field metadata mới.

- [ ] Implement `accept.ts` dùng `CreateRunSchema.parse`, validate timezone qua `buildRuntime`, một transaction sau auth. Admission giữ transaction advisory lock638019815; global query nonterminal phải chạy sau lock. SQL flow:

```ts
// Bên trong accept(store, request): id/workflowId sinh trusted randomUUID;
// runtime=buildRuntime({runId:id,userId:store.userId,timeZone:request.time_zone})
await store.db.client.begin(async tx => {
  await tx`SELECT pg_advisory_xact_lock(638019815)`;
  const active = await tx`SELECT 1 FROM runs WHERE status::text NOT IN
    ('succeeded','failed','rejected','cancelled','expired','refused','needs_input','reconciliation_required') LIMIT 1`;
  if (active.length) throw new EngineError('ACTIVE_RUN','A run is already active');
  await tx`INSERT INTO workflows(id,user_id,name,source_prompt)
    VALUES (${workflowId},${store.userId},'Pending plan',${request.source_prompt})`;
  await tx`INSERT INTO runs(id,user_id,workflow_id,source_prompt,inputs,runtime,time_zone)
    VALUES (${id},${store.userId},${workflowId},${request.source_prompt},
      ${tx.json(json(request.inputs))},${tx.json(json(runtime))},${request.time_zone})`;
  await store.emit(tx,id,'run.status',{status:'planning',previous:null},'prepare');
});
return RunAcceptedSchema.parse({run_id:id,status:'planning'});
```

Giữ `source_prompt` raw, use normalization riêng để match fixture. Client disconnect sau commit không rollback DB hoặc tự tạo lại run; hướng dẫn client kiểm history. Planner disabled phải503 trước accept. Nếu HTTP server đang shutdown thì503 trước transaction mới.

- [ ] Tách prepare hiện có: `prepareAcceptedUnderLease(store,gateway,id,planner)` nhận ID đã tồn tại; wrapper public giữ lease + closes onLost. Atomic claim chỉ planning/unclaimed/prepare delivered null, update claimed fields + đúng outbox row. Kết quả duplicate claim trả CONFLICT, 0read mới. Method CLI prepare cũ vẫn validateManualPlan/resolveInputs trước khi lưu như trước, rồi dùng core chung; không đổi default sốevent/attempt nếu không cần.
- [ ] Đưa lifecycle validate/read loop từ prepare hiện có vào hàm dùng run context persisted. Runtime/timezone/inputs lấy DB khi bắt đầu job, không buildRuntime lại; sau resolveInputs lưu resolved inputs trước snapshot để execute đối chiếu đúng. Version ID tạo một lần sau valid plan; request source prompt không bị provider plan ghi đè. `Store.detail` parse planner_result cột thật.
- [ ] PlannerPort result parse strict; refusal/clarification lưu raw structured result và terminal dưới lock, không version/steps/operations. Invalid result hoặc invalid plan fail có lỗi safe; không repair giả. Khi cancel đã thắng, terminal guard kết thúc worker mà không thêm event. Kiểm cancel trước planner, sau planner, trước mỗi read và trước preview; lease mất không cho thêm tool call.
- [ ] Tạo `dev-planner.ts` load đúng3 entries trong spec; verify unique id/split, schema valid, duplicate normalized prompt fail startup. Manifest entry gồm ID, path, hash bytes, prompt; chỉ log ID/hash, không toàn fixture. Chỉ import module khi mode dev_fixture. Không parse JSON/path từ source_prompt. Test prompt khác → clarification, filesystem tắt → refusal; source input không được chọn principal/root.
- [ ] `gateway-manager.ts` dùng đúng `loadFilesystemLaunch(root,userId)` + `openLocalGateway` như CLI, không bỏ artifact check. Trusted root suy từ config, không từ request. Giữ trạng thái connected khi gateway đang mở và verified; finally đóng làm disconnected. Mỗi acquisition owner tách biệt; test cùng process sai user không được dùng gateway cũ.
- [ ] Implement dispatcher explicit select undelivered `prepare|execute` ordered id; API-02 chỉ enable prepare. Pending execute không đánh delivered. `start` timer250ms, running boolean chống overlap, `wake` không tạo job. Core jobs dưới lease recheck row khi được lock; không gọi planner trước claim. Root read-only GET vẫn phản hồi trong lúc MCP bị treo.
- [ ] Recovery trước dispatcher: lấy worker lease, chạy helper recover đã tách ở recovery.ts với lease sẵn; xử lý only claimed run, không nhận job mới khi lock BUSY. Process dừng giữa accept commit và wake: startup vẫn thấy job và bắt đầu lần đầu. Process dừng sau claim: failed, không gọi read lại. Không ACK outbox tách transaction claim.
- [ ] Viết tests DB failure tại event/outbox insertion rollback workflows/runs; 2 concurrent POST chỉ một202/một409; runtime retained qua queue; invalid plan; cancel queued; b02 reads thật tạo exact2 actions và0receiver mutation; run read-only succeeded. Test 202 qua deferred planner latch (inject test-only PlannerPort), không dựa threshold latency trên máy chậm.
- [ ] Chạy gate02 + existing engine integration để chứng minh CLI vẫn hoạt động; API-02 chưa dispatch execute tự động, report rõ giới hạn. Commit `feat(engine): accept durable runs before asynchronous preparation`.

## API-03 — Detail, history, events, snapshot trace và reconciliation

**Files:** read-model/cursors/redaction, migration0006 + schema mapping; sửa contracts/index/generator, Store.detail/events/list, app GET routes, API docs. Tests `read-model.integration.test.ts`, `trace-pagination.integration.test.ts`, `redaction.test.ts`, `cursors.test.ts`. Report API-03.md.

**Consumes:** API-02 accepted run/principal; immutable preview/attempts, engine.reconcile; existing TraceSchema/EventPageSchema.
**Produces:** tất cả GET route trong spec; stable opaque trace cursor, display metadata, read-only reconcile schema.

- [ ] Viết regression cho RunDetail shape cũ vẫn parse; shape HTTP mới có `source_prompt`, `created_at`, `read_outputs`. Thêm optional fields vào shared schema; API projector bắt buộc fields mới, serialize parse sau project. `read_outputs` là `z.record(z.string(),ArgValueSchema)`. `created_at` ISOdatetime. Không thay shape `CreateRun` hoặc `ApprovalDecision`.
- [ ] History query lấy owned IDs ordered created_at DESC,id DESC LIMIT1001, >1000 error HISTORY_LIMIT. Không dùng `SELECT * FROM runs` đưa trực tiếp ra HTTP. `Store.list()` build RunDetail đọc coherent từng row; list không phải global snapshot; client dùng detail khi hành động. Không claim đầy đủ FR-CON-04 từ `/servers` chỉ có slug/status.
- [ ] Read output từ unpackPreview với hash kiểm đúng. Không approval: query successful read attempt đúng workflow_version_id và step_state side_effect read, output snapshot đã lưu; cùng step chọn successful attempt cuối, không lấy write output. `planner_result` từ DB; null cho legacy không có result, không dựng lại từ plan.
- [ ] Events limit mới default100 cho CLI, min1/max200 internal validated; HTTP truyền200. Parse since_seq bằng regex `^(0|[1-9][0-9]*)$` + Number.isSafeInteger; reject `1e3`, decimals, negative, repeated parameter, query length>2048. Empty page next_seq=since input; future since không làm current run last_seq tiến lên. Terminal polling vẫn200 empty, không404.

```ts
// Test setup tạo451 valid run events trong transaction qua Store.emit,
// với status không terminal; import Store từ source trong test, không public API.
const a = await engine.events(runId,0,200);
const b = await engine.events(runId,a.next_seq,200);
const c = await engine.events(runId,b.next_seq,200);
expect([a.events.length,b.events.length,c.events.length]).toEqual([200,200,51]);
expect(new Set([...a.events,...b.events,...c.events].map(e=>e.seq)).size).toBe(451);
const replay = await engine.events(runId,a.next_seq,200);
expect(replay).toEqual(b);
```

- [ ] Tạo migration snapshot theo spec; migration test fresh DB đủ6 migrations, rerun noop/checksum. Cập nhật tests đang kỳ vọng count5 thành kiểm list migration IDs đúng, không bỏ checksum hoặc sửa migrations cũ.
- [ ] Trace first page: ownership check trước materialization. Transaction `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` trước query; read attempts ordered started_at,id LIMIT10001; >10000 TRACE_LIMIT. Project/validate các record rồi persist JSON array snapshot UUID và expiry DB+10min; response first100, next token offset100 nếu còn. Empty trả empty/null. Không renew TTL khi page sau.
- [ ] Cursor payload strict `{v:1,snapshot_id,run_id,user_id,offset}` base64url canonical + `.` + HMAC. Offset positive integer multiple100; max10000. Verify signature constant-time, principal/run binding và snapshot ownership/expiry trước slice; signature/key never logged. Dùng `attempts.slice(offset,offset+100)` từ saved snapshot. Cleanup expired snapshots trong maintenance; request tiếp sau cleanup nhận CURSOR_EXPIRED. Key rotation sau restart làm cursor invalid; client bắt đầu lại, không ảnh hưởng runs.
- [ ] Test251 attempts với started_at trùng nhau →100/100/51 unique IDs. Sau page1 thêm attempt mới và hoàn tất attempt đang mở: page2/3 phải giữ snapshot trước; request không cursor thấy data mới. Wrong owner404 trước cursor disclosure, tampered cursor400, cursor run khác400, expiry400, duplicate page byte-equivalent. Không đưa tất cả history ra client rồi tự phân trang.
- [ ] Thêm schema Reconciliation lấy shape engine thực tế:

```ts
export const ReconciliationSchema = z.object({
  run_id: z.string().min(1), read_only: z.literal(true),
  operations: z.array(z.object({
    operation_id: z.string(), step_id: z.string(),
    state: z.enum(['reserved','in_flight','succeeded','known_failed','unknown']),
    receiver_mode: z.enum(['local_transaction','receiver_idempotent','non_idempotent']),
    receipt: z.enum(['confirmed','conflict','not_observed','not_supported']),
    result: ArgValueSchema,
    dispatch_marker: z.enum(['present','absent']).optional()
  }).strict())
}).strict();
```

`GET /reconciliation` gọi engine.reconcile, project safe; không gọi tools/call, không update operation/run/attempt. Receipt conflict phải giữ conflict, filesystem not_supported không đổi thành failed hoặc confirmed. Không suy từ file bytes.
- [ ] Redaction unit tests object/array/string/error; transport key case-insensitive, configured canary nằm trong nested value được che. Bản clone không mutate input; thông tin tool/schema/version/hash không có secret phải giữ. Cấu hình credentials tách khỏi request/planner/gateway args từ đầu. Test GET response và captured logger không chứa canary/token/password. Với action chứa actual configured secret, test prepare rejected trước approval như spec; không silently redact exact write payload rồi cho duyệt.
- [ ] Chốt `GET /servers` status từ gateway-manager; đóng gateway thì disconnected, drift error/unreviewed; không trả connected theo stale config. DB outage503; MCP outage GET trace/history vẫn hoạt động.
- [ ] Export schemas và update generator: reconcile route, RunDetail additive fields, explicit400 cursors/query, HISTORY_LIMIT/TRACE_LIMIT409. Generate OpenAPI/types; validate output response bằng Zod. Updated API.md ghi `/api/v1`, fields thật, server Date header cho TTL display.
- [ ] Gate03; report schema delta, migration, paging evidence. Commit `feat(api): expose owned run views and stable trace pagination`.

## API-04 — Approval, cancel, expiry và execute dispatcher

**Files:** maintenance/jobs/recovery/execute/engine/index, app/main/worker; tests `approval.integration.test.ts`, `cancel-expiry.integration.test.ts`, `worker-recovery.integration.test.ts`, `http-crash-worker.mjs`; report API-04.md.

**Consumes:** API-02 durable prepare, API-03 safe responses/cursors, current engine.decide/execute/recoverOrphans.
**Produces:** HTTP writes to run lifecycle, autonomous pending-expiry, first-execution dispatch; fail-closed recovery.

- [ ] Approval route parse `ApprovalDecisionSchema`, validate IDs syntactically UUID before DB to return400; authenticated principal supplies engine/gateway. Never body spreads into gateway config. `engine.decide` alone commits decision+status+event+outbox; send200 parsed RunDetail and `worker.wake()` after commit. No inline await execute in handler.
- [ ] Wire `execute` into dispatcher: don't mark outbox delivered before execute claims it. If duplicate job/restart sees terminal/delivered → no tool call. Precondition conflict terminal can mark obsolete pending job under lock; nonterminal conflict is error requiring safe state/recovery, not attempt with a new operation ID.

```ts
// approval.integration.test.ts: prepared is fetched from HTTP RunDetail,
// f is makeApiFixture({workerEnabled:true,plannerMode:'dev_fixture'}).
const a = prepared.approval;
const decision = {
  approval_id:a.id,
  workflow_version_id:prepared.workflow_version_id,
  snapshot_hash:a.snapshot_hash,
  decision:'approved'
};
const replies = await Promise.all([
  f.call('POST',`/runs/${prepared.run_id}/approval`,decision,token),
  f.call('POST',`/runs/${prepared.run_id}/approval`,decision,token)
]);
expect(replies.map(r=>r.status).sort()).toEqual([200,409]);
// Chờ terminal bằng GET có deadline, sau đó query DB: đúng2 b02 receipts,
// dest đúng2 rows, #team đúng1 message, cùng operation IDs trong approval.
```

- [ ] Test stale version/hash, extra args/user, wrong owner, expired, missing approval; 409 không tạo preview mới/execute job mới. Client recovery GET trả state thực tế. Không map every EngineError thành409: BUSY/CONFIG/DEPENDENCY503, NOT_FOUND404, validation400 chỉ ở request boundary, invariant500.
- [ ] Strict cancel bổ sung ngay trong transaction hiện tại: nếu terminal và options.strictTerminal throw EngineError CONFLICT. Default CLI giữ no-op. Không pre-read rồi dùng cancel default vì race. `cancel` HTTP accepted202 empty dù kết thúc ngay; terminal conflict409. Trong-flight giữ cancel_requested và để outcome được lưu; uncertain luôn reconcile, không trả false rollback guarantee.
- [ ] Pending-expiry maintenance tick1s, không overlap với chính nó, độc lập prepare worker để approval không treo khi read khác chậm. SQL lấy candidates pending/awaiting_approval+expires_at<=clock_timestamp; mỗi candidate lock run→approval rồi recheck giờ; update decision expired và transition expired/finished một transaction. Cancel/approve thắng thì no-op. Không append event sau finished. Expire không cần gateway, không inspect data file.
- [ ] Crash handling: lease loss đóng gateway, worker cũ không dispatch thêm; startup recovery trước job pickup. Refactor internal `recoverUnderLease` để tránh advisory lock lồng. Không reset `claimed_by` rồi execute run cũ; trạng thái in_flight/unknown kể cả marker-window phải thành reconciliation_required theo hiện có.
- [ ] Shutdown: reject new POST runs503, stop tick schedules, cho active job tối đa35s để kết thúc, đóng gateway khi hết deadline; HTTP listener đóng trước pool DB. Bị kill cứng thì next startup recover. Không xoá job vì HTTP client disconnect, không dùng request AbortSignal để rollback receiver đã dispatch.
- [ ] Fault matrix: kill trước claim (job còn chạy lần đầu); kill sau claim trước read (failed/no resume); kill sau task_hub commit trước response (reconcile/receipt confirmed, không gửi lần2); filesystem marker đã commit trước packet (unknown, marker present, bytes có thể chưa đổi); filesystem write xong mất response (unknown, không blind replay). Tái dùng fault harness FS-05 hiện có qua trusted test config, không xuất fault flags ở endpoint.
- [ ] Test approval-vs-cancel race chỉ một quyết định hợp lệ; expiry-vs-approval và double cancel strict; timer fake chỉ unit scheduling, tests expiry guard dùng PostgreSQL clock bằng fixture cập nhật expires_at tương đối now. Kiểm event seq liên tục/1finished cuối cùng, persisted receipt/marker/task state và MCP call count thật.
- [ ] Gate04 full engine regression một lượt sau cùng + API integrations. Report mọi crash timeout/cleanup/skip thực; commit `feat(api): dispatch approved runs with cancellation and expiry guards`.

## API-05 — Nghiệm thu HTTP thật và bàn giao frontend

**Files:** `apps/api/tests/http-acceptance.integration.test.ts`, `scripts/check-api.mjs`, `docs/API-STATUS-2026-09-15.md`, `docs/FRONTEND-HANDOFF.md`, API README, current status docs chỉ cập nhật theo evidence; API-05.md + capture directory mới.

**Consumes:** toàn bộ API-01–04; plan tay/expected results riêng dev; PostgreSQL/mcp fixtures.
**Produces:** technical verdict tái lập, run/events/trace evidence sanitized, typed frontend handoff; không đánh dấu G3 full hoặc AI pass.

- [ ] Tạo gate script orchestrate từng subprocess với args array và cwd, exit codes chuẩn; evidence dir `docs/api-evidence/batch-03/API-05/<timestamp>-<uuid>/`. Không set evidence env vars legacy khiến engine gate ghi đè lịch sử. Lưu command metadata, sanitized output, source SHA256, runtime versions, fixture ownership/cleanup. Bất kỳ failure/cleanup failure → exit1.
- [ ] Full acceptance chạy actual `listen(0,'127.0.0.1')`, Node fetch HTTP; không chỉ gọi route function/inject. Login → POST mẫu → lấy202 → poll2s, drain pages qua next_seq → GET preview → POST exact approval → poll terminal → trace mọi page → reconciliation.
- [ ] Chạy hai positive flows: b02 read/append/notify và fs-copy-notify hai server. Trước approve kiểm receiver DB chưa đổi, file đích chưa được tạo; sau approve đúng args/output/bytes và receipts/markers đúng receiver. Read outputs source đổi sau preview không làm write payload đổi; test này cần fixture đổi dữ liệu chủ ý sau approval preview, không dùng dữ liệu user.
- [ ] Chạy negative flow refusal/clarification rõ DEV_FIXTURE_PLANNER; rejection0write; expiry0next-write; wrong owner mọi endpoint; 409 refetch; disconnect polling rồi dùng same seq trả đủ event; invalid cursor; token expiry/login mới không tạo run lại; MCP chết GET trace vẫn200; API restart không mất run history, session cũ401.
- [ ] Poll consumer mẫu của acceptance: assert strict increasing seq trong page, bỏ duplicate khi gộp; chỉ advance cursor sau ingest thành công, empty page giữ cursor. Event `dryrun.ready` fetch RunDetail. Nếu network error giữ cursor, retry GET sau2s, không retry POST. Run terminal phải drain hết pages trước dừng; không reset cursor sang detail.last_seq khi chưa ingest các event trước nó.
- [ ] Kiểm API không còn501 stub, exported OpenAPI routes đủ auth/login/servers/runs/detail/events/trace/reconciliation/approval/cancel; runtime responses parse schemas. List/history có prompt/time; caller không cần query DB trực tiếp để dựng hai màn hình.
- [ ] Bàn giao `docs/FRONTEND-HANDOFF.md` gồm exact examples sanitized từ HTTP thật: baseURL, bearer lifecycle, CreateRun/RunAccepted/RunDetail/Decision/EventPage/Trace/Reconciliation, tất cả14 statuses và8terminal, lỗi400/401/404/409/413/415/429/503/500. Ví dụ chứa schema UUID hợp lệ nhưng không token/password. Liệt kê fields nào legacy optional.
- [ ] Handoff năm component: StatusPill←status; TechDisclosure←safe trace/preview; ProgressStrip←run.status/events; ActionCard←approval.actions; TimelineRow←event+attempt snapshot. Unknown không nút replay; write data không dùng innerHTML. Mobile/keyboard/container/cascade caveats lấy spec section7, kiểm browser ở WEB-01/03.
- [ ] Ghi evidence verdict: `API_TECHNICAL_PASS` chỉ khi gate đạt, `PLANNER=DEV_FIXTURE`, `AI_EVALUATION=NOT_RUN`, `BROWSER_E2E=NOT_RUN`, `G3=PARTIAL`, rubric/user work tiếp tụcOPEN. Nếu một negative branch chưa chạy thì ghi NOT_RUN và không chốt toàn gate.
- [ ] Review dependencies/linked reports, hash preservation files cũ; run command gate05. Stage selected checkpoint evidence đúng manifest, không toàn bộ capture tạm. Commit `test(api): verify local lifecycle over HTTP and document frontend handoff`.

## 3. Commands và tiêu chí kiểm tra

Các scripts API ở bảng là **được tạo bởi API-01/API-05**, hiện chưa chạy được ở checkout chỉ có plan. Chạy từ root, PowerShell; kiểm `$LASTEXITCODE` sau mỗi command trước đi tiếp.

| Gate | Commands | Expected |
|---|---|---|
| 01 | `npm run typecheck`; `npm run build`; `npm run test:unit -w @wap/api`; `npm run test:integration -w @wap/api -- tests/auth.integration.test.ts`; `npm run api:generate` | exit0, HTTP/auth tests thật |
| 02 | `npm run build`; `npm run test:unit -w @wap/api`; `npm run test:integration -w @wap/api -- tests/create-run.integration.test.ts`; `npm run test:integration -w @wap/engine` | exit0, accepted-run/CLI/read regressions |
| 03 | `npm run check`; `npm run test:unit -w @wap/api`; `npm run test:integration -w @wap/api -- tests/read-model.integration.test.ts tests/trace-pagination.integration.test.ts`; `npm run test:integration -w @wap/mcp-task-hub` | exit0, new migration và DTO/paging |
| 04 | `npm run check`; `npm run test:integration -w @wap/engine`; `npm run test:integration -w @wap/api` | exit0, races/crashes/cleanup |
| 05 | `node scripts/check-api.mjs` | script chạy check + unit engine/API + integration task_hub/engine/API; sanitized manifest; exit0 |

Không dùng `npm run check` riêng để tuyên bố engine/API integration đã pass: script hiện chỉ test DSL. Không chạy lặp broad suite sau khi pass nếu không có thay đổi mới. Gates tạo OpenAPI phải review diff generator/source, không dùng handwritten fix generated file.

## 4. Acceptance matrix có thể review riêng

| ID | Ca kiểm | Oracle quan trọng | Owner |
|---|---|---|---|
| H01 | login sai/đúng/expired/restart |401/200 đúng, session không leak |01 |
| H02 | shape/body/content type |400/413/415, không DB mutation |01 |
| H03 | durable202/worker paused |run planning/versionnull/event/outbox cùng commit |02 |
| H04 | concurrent admission |1accepted/1conflict, không2active |02 |
| H05 | DB error lúc accept |không orphan workflow/run/event |02 |
| H06 | fixture planner/refusal/clarification |labeldemo, 0write, no fabricatedAI |02 |
| H07 | read-only/preview |succeeded hoặc exactactions/pending |02 |
| H08 | owner matrix |401 unauth,404 other owner cho mọi run route |03,04 |
| H09 |451 events/reconnect |200/200/51, seq không mất/lặp kết quả |03 |
| H10 |251 attempts/tie/new arrival |100/100/51 snapshot ổn định |03 |
| H11 | cursor tamper/owner/run/TTL |400 hoặc404, không cross-run leak |03 |
| H12 | secrets/canonical snapshot |no leak, không mutate bytes/hash |03 |
| H13 | server drift/offline |status thật, GET history vẫn có |03 |
| H14 | double/stale decision |1decision thắng, 1execute job |04 |
| H15 | expiry before/while wait/nextwrite |serverclock, không nextwrite |04 |
| H16 | cancel queued/inflight/terminal |cooperative, strict409, unknown giữ |04 |
| H17 | crash beforeclaim/afterclaim |first execution hoặc failed, không resume |04 |
| H18 | task_hub receipt vs lost response |reconcile confirmed, 1mutation |04 |
| H19 | filesystem marker/payload lost |unknown/not_supported, no replay |04 |
| H20 | HTTP+DB+2MCP E2E |snapshot-approved exact data, evidence+cleanup |05 |

## 5. Yêu cầu không thuộc verdict của đợt này

| Yêu cầu | Đợt API cung cấp | Phần còn lại |
|---|---|---|
| FR-USR-01/02, FR-APR-01–06, FR-EXE-07/15 |HTTP auth/owner/lifecycle/guards |Browser thao tác thật |
| FR-TRC-01/02/05/07, FR-WFM-01/02 |readmodels, events paging, trace |render/poll2s trong frontend |
| FR-CON-02/03/04 |trusted gateway + status endpoint |UI tool catalog đầy đủ cần DTO riêng ở đợt frontend, không gọi slug list là10tools view |
| FR-PLN-01/02/03/09/10 |prompt accept, port provider |AI retrieval/QE/repair/cost evaluation đợt4 |
| FR-EXE-12/13/14, FR-TRC-04 |bảo toàn contract reapproval |local replan thật đợtAI |
| NFR-03 |API/poll harness đo được riêng |p95 API+render chỉ đo ở browser gate |
| G1 rubric/user work |giữ mapOPEN |người dùng cung cấp nguồn, không chặn frontend |

## 6. Prompt giao việc cho Antigravity hoặc agent khác

Mở conversation mới, gửi nguyên block rồi thay `API-01` bằng task được giao. Model do người dùng chọn trong ứng dụng; không giả định đã chọn được model từ text.

```text
Làm việc trong D:\Môn học\ATI\ATI_Project.
Trước khi implement, hãy đọc và nghiên cứu repo để giải thích project làm gì:
BASELINE, EXECUTION-CONTRACT, API, FR; schema/migrations; engine prepare/approval/
execute/store/recovery/gateway; reports FS-05/FS-06; wireframes/screens; Git policy.
Đọc spec docs/superpowers/specs/2026-09-15-http-lifecycle-design.md và plan
docs/superpowers/plans/2026-09-15-http-lifecycle.md hoàn chỉnh. Không quét node_modules,
runtime dữ liệu user hoặc secrets; không cần đọc tất cả raw capture lịch sử.

Trước sửa code, báo ngắn: kiến trúc hiện tại, 5 invariant không được phá,
task dependencies đã có hay chưa, file scope và tiêu chí nghiệm thu.
Chỉ triển khai API-01 trong lượt này. Task khác dùng để hiểu dependency.
Nếu source khác plan, chỉ rõ source/contract xung đột trước khi đổi API/schema.
Giữ DEV_FIXTURE_PLANNER khác AI; HTTP test khác browser evidence.
Test trên DB/root UUID riêng, không ghi demo data hoặc source evidence lịch sử.
Review diff và chạy checks theo task. Stage exact paths theo Git policy;
commit checkpoint sau kiểm chứng. Không push. Báo commands/exit codes,
files changed, commit, evidence mới và phần NOT_RUN; dừng ở checkpoint API-01.
```

## 7. Self-review của bộ plan

- [x] Kiểm signature hiện có `prepare/decide/execute/detail/events/trace/cancel/reconcile` trước khi đề xuất bổ sung.
- [x] Chỉ ra nơi cần tách202/prepare, giữ CLI path và không duplicate workflow/run/job.
- [x] Giữ auth bearer của OpenAPI, xác định demo login sentinel không dùng được.
- [x] Ghi rõ schema additions/migration/response gap; không sửa contract source trong lượt planning.
- [x] Định nghĩa pagination ổn định cả khi attempt open chuyển closed.
- [x] Distinguish pending first dispatch vs orphan replay, strictcancel race và expired maintenance.
- [x] Acceptance từ HTTP/PostgreSQL/MCP thật, guard riêng browser/AI/rubric.
- [x] Cung cấp file ownership/signatures/test cases/gates và prompt audit-first cho executor.

Sau plan, action đầu tiên là giao **API-01**. WEB-01 có thể dựng component/fixtures sau khi DTO ở API-03 ổn định; chưa cần chờ AI hoặc rubric. API-05 là điều kiện nối frontend vào dữ liệu thật và nghiệm thu toàn luồng.
