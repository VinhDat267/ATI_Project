# Frontend platform WEB-01–03 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Nếu người dùng giao subagents, dùng superpowers:subagent-driven-development với review giữa các task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng 6 view/4 mục điều hướng cho vòng đời run B/local, nối HTTP thật và nghiệm thu bằng browser cùng receiver evidence.

**Architecture:** React chỉ render snapshot và nhận thao tác. Modules TypeScript thuần quản lý session generation, API validation, event ingestion, polling và quyết định không retry POST. Vite proxy loopback giữ API origin guard; fixtures và live transport tách rõ.

**Tech Stack:** React/react-dom 19.3.0, TypeScript 5.9.3, Vite 8.3.0 + @vitejs/plugin-react 6.1.1, Zod 4.6.2, Tailwind CSS 4.3.3, shadcn/ui trên radix-ui 1.6.7, lucide-react 1.47.0, TanStack Query 5.103.1, Vitest 4.1.11, Playwright Test 1.63.0 + @axe-core/playwright 4.13.0. Node `^22.12.0 || >=24.0.0`. Xem [ADR-002](../../ADR-002-FRONTEND-UI-DATA-LAYER.md).

**Spec:** [UX platform](../specs/2026-09-15-platform-ux-design.md), [ADR-001](../../ADR-001-FRONTEND-STACK.md), [ADR-002](../../ADR-002-FRONTEND-UI-DATA-LAYER.md), [frontend handoff](../../FRONTEND-HANDOFF.md).

**Trạng thái:** `PROVISIONAL` cho WEB-01B và **BLOCKED_PENDING_SYSTEM_DESIGN_REVIEW** cho WEB-01C/WEB-02/WEB-03. `docs/superpowers/specs/2026-09-15-platform-system-design.md` là cổng kiến trúc mới; phải chuyển sang `APPROVED_FOR_IMPLEMENTATION` và audit commit `23a41d8` trước khi viết thêm frontend. **Cần sửa plan theo ADR-002 trước khi giao WEB-01C:** các task WEB-01C/WEB-02 dưới đây còn mô tả CSS thuần và controller/polling tự viết; phải thêm bước setup Tailwind/shadcn/theme và chuyển GET/mutation sang query options trong `core/queries.ts`, giữ nguyên các kiểm thử hành vi. WEB-00 chỉ có kiểm lock/build mẫu trong temp; browser/application/AI vẫn NOT_RUN. Đọc toàn bộ repo có chọn lọc trước khi implement: BASELINE, FR, EXECUTION-CONTRACT, API source/contracts, engine lifecycle, policy/fingerprint, báo cáo API audit, screens/wireframes, Git policy. Không đọc secrets hoặc toàn bộ raw capture lịch sử.

## Global Constraints

- Sáu view: login, overview, new, history, run detail, tools. Bốn mục nav: Tổng quan/Tạo yêu cầu/Lần chạy/Công cụ & kết nối.
- Poll mỗi 2 giây; không chồng request; drain event pages trước dừng. Không WebSocket sản phẩm.
- Token memory của tab; reload cần login; URL chỉ giữ route và runId. Không credential trong storage/log/HTML/evidence.
- Approval dùng đúng `approval_id`, `workflow_version_id`, `snapshot_hash`, `decision`; TTL từ server; không sửa payload.
- Write chưa rõ kết quả không retry/resume; cancel cooperative không rollback. Không auto retry bất kỳ POST.
- Không editor, workflow library/reuse, rerun, schedule, SaaS, user/team admin hoặc config arbitrary MCP.
- Backend API-GATE đã đạt `API_TECHNICAL_PASS`. Fixture không phải AI; browser mock không phải receiver evidence và frontend vẫn cần live browser gate riêng.
- Styling bằng Tailwind CSS v4 với token `@theme` lấy từ DESIGN.md; component từ shadcn/ui được review và commit trong repo; không arbitrary color/spacing (ADR-002). screens.html chỉ là tham chiếu bố cục. 1280/390/320px, keyboard, focus, không tràn ngang trang. Text tiếng Việt; thuật ngữ kỹ thuật nằm trong disclosure khi có ích.
- Cài dependency chỉ khi bắt đầu WEB-01; pin exact, review lock delta và fingerprint trước live MCP. Không ghi đè lịch sử evidence, migrations hoặc data demo.
- Sau mỗi task: targeted tests, diff review, stage exact files, commit checkpoint; không push. Không gọi npm run check là full integration.

## File map và đường găng

| Task | Files chính tạo/sửa | Trách nhiệm |
|---|---|---|
| WEB-01A | apps/web/package.json, tsconfig.json, tsconfig.tools.json, vite.config.ts, vitest.unit.config.ts, playwright.config.ts, index.html; packages/dsl/src/browser.ts và package.json; root package.json/.gitignore | Toolchain, public browser contracts, proxy, test commands |
| WEB-01B | apps/web/src/core/{contracts,store,session,navigation}.ts; src/{main,App}.tsx; src/fixtures/{transport,scenarios}.ts | Session/nav, fixture boundary và AppShell |
| WEB-01C | src/views/{LoginView,OverviewView,NewRunView,HistoryView,RunView,ToolsView}.tsx; src/components/{StatusPill,TechDisclosure,ProgressStrip,ActionCard,TimelineRow,EmptyState,ErrorState}.tsx; src/styles.css | 6 view, 14 status, accessible interactions |
| WEB-02A | src/core/{api,errors}.ts; src/controllers/{session-controller,list-controller}.ts | HTTP runtime parsing, login/expiry, history/servers |
| WEB-02B | src/core/{events,polling}.ts; src/controllers/run-controller.ts | Ordered event ingestion, polling, stale response fences |
| WEB-02C | src/controllers/{create-controller,decision-controller,trace-controller}.ts | Mutations exact snapshot, unknown outcome, trace/reconciliation |
| WEB-03A | apps/web/tests/browser/*; apps/web/tests/live/*; scripts/check-web.mjs và scripts/check-web.test.mjs; docs/WEB-STATUS.md, docs/web-evidence/WEB-03/* | Browser+HTTP+DB/MCP oracles, cleanup và báo cáo |

Files test cụ thể trong từng task. `src/core` và controllers không import React. Store adapter chỉ trong App/views. WEB-01A→B→C→WEB-02A→B→C→WEB-03A. API-CATALOG và API-GATE độc lập; tools status có thể live trước catalog nhưng không nghiệm thu FR-CON-04 đầy đủ.

## WEB-01A — Toolchain chạy được và proxy có boundary

**Files:** map ở trên; thêm `apps/web/tooling/local-proxy.ts`, `apps/web/tests/unit/local-proxy.test.ts`, `apps/web/tests/unit/browser-contracts.test.ts`, `apps/web/tests/browser/build-smoke.spec.ts`.

**Interfaces:** `localProxy(target: string, frontendOrigin: string)` trả Vite Plugin; hook dev/preview chung middleware. `@wap/dsl/browser` export schema/events/contracts thuần. Workspace scripts: `dev`, `build`, `preview`, `typecheck`, `test:unit`, `test:browser`, `test:live`.

- [ ] Xác nhận source hiện tại và baseline lock SHA từ measurement; ghi git diff đầu task. Cài chính xác dependency ADR vào apps/web, không chạy scaffolder ghi đè. package scripts:

```json
{
  "dev": "vite --host 127.0.0.1 --port 5173 --strictPort",
  "build": "tsc -p tsconfig.json && vite build",
  "preview": "vite preview --host 127.0.0.1 --port 4173 --strictPort",
  "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.tools.json",
  "test:unit": "vitest run --config vitest.unit.config.ts",
  "test:browser": "playwright test --project=fixture",
  "test:live": "playwright test --project=live --workers=1"
}
```

- [ ] Tạo browser tsconfig với `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`, `jsx: react-jsx`, `lib: [ES2022, DOM, DOM.Iterable]`, `strict: true`, `noUncheckedIndexedAccess: true`, `skipLibCheck: true`, `noEmit: true`, `types: [vite/client]`; include src. Tools config types node, include configs/tooling/tests; test unit dùng Node environment, không jsdom. Root scripts build thêm web sau DSL/API, typecheck thêm web, `check` thêm web unit sau test hiện có. Playwright chạy riêng, không làm root test vô tình khởi động DB/browser.
- [ ] Thêm DSL browser entry:

```ts
// packages/dsl/src/browser.ts
export * from './schema.js';
export * from './events.js';
export * from './contracts.js';
```

`packages/dsl/package.json.exports["./browser"]` trỏ types `./dist/browser.d.ts`, import `./dist/browser.js`. Không sửa public root export cũ. Browser dùng entry này, không alias tới engine. Build DSL trước browser; kiểm emitted JS không còn unresolved bare `@wap/dsl` hoặc Node builtins.
- [ ] Viết test parser và proxy boundary trước implementation. Proxy chạy với upstream HTTP giả port0, gửi request thật bằng Node fetch. Những case bắt buộc: same-origin POST tới đúng path/body/auth; foreign/null Origin403 không tới upstream; Host sai403; target remote/userinfo/query bị reject lúc cấu hình; OPTIONS403; no-Origin với Sec-Fetch-Site cross-site403; valid preview origin cũng được xử lý. Kiểm cụ thể upstream Origin bằng target origin sau guard.

```ts
const response = await fetch(frontend + '/api/v1/auth/login', {
  method: 'POST', headers: { origin: 'https://foreign.invalid', 'content-type': 'application/json' },
  body: JSON.stringify({email:'synthetic@local.invalid',password:'synthetic'})
});
expect(response.status).toBe(403);
expect(upstreamCalls).toHaveLength(0);
```

`frontend`, `upstreamCalls` do beforeEach tạo loopback HTTP servers port0; afterEach đóng cả hai trong finally. Test allowed path phải assert body bằng chính synthetic body, không snapshot Authorization giá trị thật.
- [ ] `localProxy` validate target một lần bằng URL; exact frontendOrigin theo cổng fixed; trước forwarding check Host/Origin/Sec-Fetch-Site. Reject bằng403 JSON generic, không echo token/body. Cấu hình proxy `/api/v1` với target cố định, ws false, changeOrigin true; `proxyReq` set Origin target chỉ sau guard. Không set custom Origin từ browser và không bỏ API guard. Vite dev/preview chung config, `server.forwardConsole: false`, `server.cors: false`, `open: false`.
- [ ] Tạo `index.html` lang vi, viewport, title, root và module main; main dùng createRoot/StrictMode. Build smoke browser chỉ kiểm HTML render + runtime parser ném lỗi với payload sai, không tuyên bố 6 view đã có. `.gitignore` thêm `apps/web/test-results/`, `apps/web/playwright-report/`; không ignore evidence chọn lọc.
- [ ] Gate: `npm run build -w @wap/dsl`; `npm run typecheck -w @wap/web`; `npm run test:unit -w @wap/web`; `npm run build -w @wap/web`. Cài Chromium qua Playwright CLI đã pin khi chạy browser lần đầu. Kiểm audit dependency mới, lock delta +45 dự kiến, old identities, bundle <=160 KiB gzip. Gate artifact MCP dùng workflow hiện có trước live; không tự sửa reviewed JSON vì npm hoist đổi layout.
- [ ] Review diff và commit `build(web): add React browser toolchain and guarded local proxy`.

## WEB-01B — Store, session, routes và fixture boundary

**Files:** map B; thêm `apps/web/tests/unit/{store,session,navigation}.test.ts`, `apps/web/tests/browser/navigation.spec.ts`.

**Consumes:** shared browser schemas, React và proxy/toolchain. **Produces:** types sau trong `core/contracts.ts`; các type wire suy từ schema, không chép DTO bằng tay:

```ts
import {z} from 'zod';
import {RunDetailSchema,EventPageSchema,TraceSchema,ReconciliationSchema,
  ServerSummaryListSchema,CreateRunSchema,ApprovalDecisionSchema} from '@wap/dsl/browser';
export type RunDetail = z.infer<typeof RunDetailSchema>;
export type EventPage = z.infer<typeof EventPageSchema>;
export type TracePage = z.infer<typeof TraceSchema>;
export type Reconciliation = z.infer<typeof ReconciliationSchema>;
export type Servers = z.infer<typeof ServerSummaryListSchema>;
export type CreateInput = z.input<typeof CreateRunSchema>;
export type DecisionInput = z.infer<typeof ApprovalDecisionSchema>;
export interface Transport {
 login(email:string,password:string,signal:AbortSignal):Promise<string>;
 list(signal:AbortSignal):Promise<RunDetail[]>;
 servers(signal:AbortSignal):Promise<Servers>;
 create(input:CreateInput,signal:AbortSignal):Promise<{run_id:string;status:'planning'}>;
 detail(id:string,signal:AbortSignal):Promise<RunDetail>;
 events(id:string,since:number,signal:AbortSignal):Promise<EventPage>;
 decide(id:string,input:DecisionInput,signal:AbortSignal):Promise<RunDetail>;
 cancel(id:string,signal:AbortSignal):Promise<void>;
 trace(id:string,cursor:string|null,signal:AbortSignal):Promise<TracePage>;
 reconciliation(id:string,signal:AbortSignal):Promise<Reconciliation>;
}
export type Route = {page:'login'|'overview'|'new'|'history'|'tools'} | {page:'run';id:string};
export interface Store<T> {getSnapshot():T;subscribe(fn:()=>void):()=>void;set(value:T):void}
export interface Session {generation:number;token:string|null}
```

- [ ] Viết store tests: getSnapshot trả cùng reference đến khi set thay đổi, unsubscribe không nhận update; subscriber không đọc snapshot nửa cập nhật. `createStore<T>(initial:T):Store<T>` dùng Set listeners, chỉ emit sau gán snapshot mới.
- [ ] Tạo `createSession()` cung cấp `store:Store<Session>`, `setToken(token:string):void`, `clear():void`; mỗi đổi session tăng generation. Token nằm closure/store JS, không render token vào props DOM; session adapters chỉ đọc authenticated boolean. Scope request chụp generation và dùng AbortController; sau await phải check generation trước mọi cập nhật.
- [ ] `parseRoute(hash:string):Route` chỉ nhận #/login, #/overview, #/new, #/runs, #/runs/<UUID>, #/tools; invalid hash trả overview (App redirect login nếu chưa auth). `navigate(route:Route,replace?:boolean):void` chỉ serialize route đã validate. Không `returnTo` arbitrary URL; logout/login return route ở memory. Browser Back/Forward dựa hashchange; nav chỉ render, không POST.

```ts
expect(parseRoute('#/runs/11111111-1111-4111-8111-111111111111')).toEqual({page:'run',id:'11111111-1111-4111-8111-111111111111'});
expect(parseRoute('#/https://foreign.invalid')).toEqual({page:'overview'});
const s=createSession(); const before=s.store.getSnapshot().generation;
s.setToken('synthetic'); s.clear();
expect(s.store.getSnapshot()).toEqual({generation:before+2,token:null});
```

- [ ] Fixtures implement Transport với payload parse schema thật và AbortSignal; lỗi qua `ClientError` ở WEB-02A, trước đó fixture chỉ dùng Error chuẩn có message synthetic. Tạo factory scenario cho 14 status dựa fixture plan/schema/testdata đã có: executable statuses có plan/version; refusal/clarification có đúng PlannerResult. Không dùng `as RunDetail` để ép fixture sai. All fixtures là synthetic, không copy raw API captures.
- [ ] Chế độ build `--mode fixture` lấy entry fixture, có banner “Dữ liệu mô phỏng”; live build không import scenarios hoặc đưa token fixture vào code. WEB-01 default fixture vì chưa có transport HTTP; WEB-02 đổi default live. Không silently fallback sang fixture khi API lỗi.
- [ ] AppShell 4 link nav, main landmark, skip-link, mobile drawer có close/Escape/focus return. `useSyncExternalStore(store.subscribe,store.getSnapshot)` bind stable store, không tạo store lại mỗi render. LoginRoute gate bảo vệ mọi view; StrictMode không gây side effects trong render.
- [ ] Browser test login fixture → nav → Back/Forward → reload: sau reload cần login, không create/decision call. Ghi mock request count bằng test harness trong fixture mode, không thêm debug endpoint vào API. Run unit/navigation tests, build và commit `feat(web): add session navigation and labelled fixture workspace`.

## WEB-01C — Sáu view và trạng thái tương tác

**Files:** map C; thêm `apps/web/src/core/presentation.ts`, `apps/web/tests/unit/presentation.test.ts`, `apps/web/tests/browser/views.spec.ts`.

**Consumes:** Route/Transport/RunDetail và stores. **Produces:** view nhận data/loading/error + callbacks, không fetch trong component; `runPresentation(status:RunDetail['status'])` trả `{label:string,tone:'neutral'|'info'|'success'|'warning'|'danger',terminal:boolean,canCancel:boolean}` exhaustive bằng `satisfies Record<RunDetail['status'],...>`. `ActionCard` nhận một Approval.actions entry, không nhận transport/token.

- [ ] Viết table tests enum14 khớp presentation keys, 8 terminal và reconcile không canCancel. Bảng hành động theo spec: pending6states có cancel; approve/reject chỉ awaiting_approval với snapshot hợp lệ; terminal chỉ xem. Dùng fixtures validate, kiểm status đổi không remount disclosure keyed runId/attemptId.
- [ ] CSS dùng variables cho bg/text/accent/warning/success, system fonts, không remote assets. Main max-width1280, sidebar khoảng240, gap24/16, content min-width0, container breakpoint860 cho run layout. `<pre>` wrap/scroll trong vùng riêng; page không tràn ở320. Focus-visible rõ; status có text, không chỉ màu.
- [ ] Login form label email/password, autocomplete đúng, pending khóa submit, lỗi inline role alert; xóa password sau success/401. Overview ưu tiên reconciliation→approval→active, history recent, empty CTA. NewRun textarea max4000, timezone mặc định, input scalar bằng JSON textarea trong disclosure parse object strict; từ chối array/null/nested/nonfinite, lỗi theo field trước submit. Action chính “Lập kế hoạch”.
- [ ] History filter local status/prompt, giữ filter trong cùng session, empty-data khác no-match, lỗi không render zero giả. Tools hiển thị 2 server summaries và thời điểm cập nhật, disconnected mô tả kết nối theo nhu cầu; không bịa schema/tool count. Refresh chỉ gọi servers GET.
- [ ] RunView header ổn định, ba section Kế hoạch/Tiến trình/Chứng cứ. Plan list thể hiện dependency và tool read/write, không editor. Awaiting approval đưa số write và exact resolved_args lên trước, TTL dựa expires_at; tất cả data dùng React text children/JSON.stringify, tuyệt đối không dangerouslySetInnerHTML. `TechDisclosure` dùng details/summary giữ key ổn định qua poll. `TimelineRow` key event.seq hoặc attempt_id, không index.
- [ ] Refused/needs_input hiển thị reason/questions và link yêu cầu mới. Cancelled không hứa rollback. Reconcile cảnh báo unknown, receipt/marker mở xem, không retry/resume/resolved button. Read-only success không tạo bước duyệt giả. ProgressStrip theo stage/event, không % giả.

```ts
// Playwright fixture view assertions; scenario query chỉ tồn tại fixture build.
await page.goto('/?scenario=reconciliation_required#/runs/11111111-1111-4111-8111-111111111111');
await expect(page.getByRole('button',{name:/chạy lại|retry|resume|đã giải quyết/i})).toHaveCount(0);
await page.getByText('Chi tiết kỹ thuật',{exact:true}).first().click();
await page.setViewportSize({width:320,height:800});
expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
```

Fixture helper đăng nhập trước assertion nếu gate bật; query scenario không bypass login. Chạy vòng đủ14status và login/empty/error. Keyboard tab/Enter/Space/Escape, focus return và overflow1280/390/320. UI actions fixture được click thật (khác HTML design disabled), không có POST live.
- [ ] Gate WEB-01: unit+browser fixture+production build; screenshots chọn5layout và mobile, kiểm trực quan chữ/cảnh báo/overflow; không coi screenshot tồn tại là đã review. Báo `WEB_FIXTURE_PASS` chỉ cho cases thực chạy. Commit `feat(web): render six accessible workflow run views`.

## WEB-02A — HTTP client, phiên đăng nhập và danh sách thật

**Files:** map A; thêm `apps/web/tests/unit/{api,session-controller,list-controller}.test.ts`, `apps/web/tests/browser/http-client.spec.ts`, `apps/web/tests/live/{fixtures,cleanup}.ts` và `apps/web/tests/live/login.spec.ts`. Harness live được tạo ngay ở task này để gate không phụ thuộc ngược vào WEB-03; WEB-03 mở rộng case và runner.

**Interfaces:** `createHttpTransport(session: ReturnType<typeof createSession>, fetcher:typeof fetch = fetch):Transport`; `ClientError extends Error` với `kind:'http'|'network'|'protocol'|'aborted'`, `status?:number`, `code?:string`, `requestId?:string`, `uncertain:boolean`. Controllers tạo store snapshot immutable, `dispose():void` abort mọi request. `createListController(transport,session)` trả `{store,refreshRuns():Promise<void>,refreshServers():Promise<void>,dispose}`; store giữ data cũ/fetchedAt/loading/error riêng cho từng collection.

- [ ] Client chỉ relative `/api/v1`, headers Accept JSON và bearer khi authenticated; Content-Type chỉ với body JSON; credentials omit, cache no-store, redirect error. Request login không token. Không log request/response body hoặc raw ZodError chứa input.
- [ ] Map schemas: login→LoginResponseSchema; list→RunDetailSchema.array(); servers→ServerSummaryListSchema; create→RunAcceptedSchema; detail/decide→RunDetailSchema; events→EventPageSchema; trace→TraceSchema; reconciliation→ReconciliationSchema. Expected status200 trừ create202 và cancel202 empty. Body unexpected/JSON sai→protocol; error envelope parse ApiErrorSchema, hiển thị message local theo code và request_id, không echo server HTML.
- [ ] Viết mocked fetch tests dưới đây và wrong JSON/shape/redirect/empty202; fake fetch dùng Response native, spy ghi method/path không lưu secret trong assertion artifacts.

```ts
const s=createSession(); s.setToken('synthetic');
const fetcher=vi.fn().mockResolvedValue(new Response('',{status:202}));
const api=createHttpTransport(s,fetcher);
await expect(api.cancel('11111111-1111-4111-8111-111111111111',new AbortController().signal)).resolves.toBeUndefined();
expect(fetcher).toHaveBeenCalledTimes(1);
```

- [ ] `createSessionController` `{store,login(email,password),logout(),dispose}` login có inFlight guard; 401 của session hiện tại clear session/abort/clear protected stores; response401 của generation cũ bỏ qua, không logout phiên mới. Login response muộn sau logout không được setToken. Password chỉ biến handler, không store lâu dài. 429 generic retry-later khi không header thời gian.
- [ ] GET lỗi network giữ last data stale + thời điểm. List history409HISTORY_LIMIT hiện thông báo giới hạn và refresh, không empty success. Other-owner404 generic. `ACTIVE_RUN` chưa có id trong lỗi thì GET history và tìm active; không bịa id.
- [ ] Browser mock HTTP kiểm parse/render rồi **live smoke** login qua preview proxy/API thật. Tạo harness/cleanup theo thiết kế WEB-03 ngay trong task này, trước khi chạy smoke: source Origin khác target vẫn login đúng qua proxy; foreign Origin403 ở frontend và API direct giữ guard. Không tự động bật dev_fixture fallback. Mặc định frontend live; label planner fixture lấy từ cấu hình launch tin cậy. Chưa có capabilities endpoint thì bản demo luôn ghi rõ dùng kế hoạch mẫu.
- [ ] Run targeted unit/browser; commit `feat(web): connect validated HTTP transport and session lifecycle`.

## WEB-02B — Polling, seq ingestion và stale response

**Files:** map B; thêm `apps/web/tests/unit/{events,polling,run-controller}.test.ts`, `apps/web/tests/browser/polling.spec.ts`.

**Interfaces:**

```ts
export interface EventState {seq:number;events:EventPage['events'];finished:boolean}
export function ingestEvents(previous:EventState,page:EventPage,runId:string):EventState;
export interface RunSnapshot {
 runId:string;detail:RunDetail|null;events:EventState;loading:boolean;
 connection:'ok'|'retrying'|'protocol_error';fetchedAt:number|null;error:ClientError|null;
}
export function createRunController(api:Transport,session:ReturnType<typeof createSession>):{
 store:Store<RunSnapshot|null>;open(id:string):void;refresh():Promise<void>;dispose():void
};
```

- [ ] `ingestEvents` là phép cập nhật nguyên tử: seq tăng chặt trong page; lọc duplicates <= previous.seq nhưng cùng seq khác payload là protocol error nếu còn trong cache; seq mới phải liên tục từ previous.seq+1. next_seq phải bằng seq cuối đã ingest, hoặc bằng previous.seq khi page rỗng. Gap/inconsistent thì throw và giữ previous nguyên vẹn. `run.finished` là event cuối, không nhận event mới sau finished. **Event wire không có run_id**: runId là context của request/controller; tuyệt đối không tự thêm trường vào DTO. Controller phải bỏ response của run/phiên cũ trước khi gọi reducer. Tham số runId chỉ dùng gắn lỗi chẩn đoán nội bộ, không chứng minh ownership.
- [ ] Fixture event dùng `run.status`/`run.finished` với payload đúng events.ts. Kiểm 451 events chia 200/200/51, page lặp, gap, đảo thứ tự, page rỗng, next_seq sai, detail.last_seq451 khi local seq0. Wrong-run response là test của controller context guard. State chỉ advance sau page thành công.

```ts
import {EventPageSchema,RunEventSchema} from '@wap/dsl/browser';
const runId='11111111-1111-4111-8111-111111111111';
const pageWithSeqs=(seqs:number[])=>EventPageSchema.parse({
 events:seqs.map(seq=>RunEventSchema.parse({seq,created_at:'2026-09-15T00:00:00Z',
 type:'run.status',payload:{status:'planning',previous:null}})),
 next_seq:seqs.at(-1)??0
});
const before:EventState={seq:0,events:[],finished:false};
expect(()=>ingestEvents(before,pageWithSeqs([1,3]),runId)).toThrow();
expect(before.seq).toBe(0);
const one=ingestEvents(before,pageWithSeqs([1]),runId);
expect(ingestEvents(one,{events:[],next_seq:1},runId).seq).toBe(1);
```

- [ ] Controller open abort phiên/run trước, reset seq0 khi chưa cache, fetch detail/events qua cùng generation/run guard. Một loop: async tick → await events/detail → setTimeout(nextTick,2000). Page đủ200 thì drain ngay; detail terminal mà chưa run.finished thì tiếp tục GET kể cả trang trước <200 để chịu tail race. Ba empty ticks liên tiếp khi detail terminal nhưng chưa nhận run.finished thì dừng tự poll và hiện lỗi đồng bộ, cho refresh GET; không tự nhảy cursor hoặc đổi run.status thành failed. Đây là lỗi đồng bộ cần quan sát, không phải bằng chứng server mất event.
- [ ] `dryrun.ready` hoặc đổi version phải fetch detail trước khi bật approval. Detail.last_seq nhỏ hơn bản đã áp dụng thì không rollback status/snapshot; cùng seq nhưng version/status khác thì báo protocol error và refetch. Detail là authority của trạng thái; timeline không ghi status vào API. Chỉ update cursor cùng snapshot events đã ingest thành công.
- [ ] Network error giữ seq/data, retry GET sau2s; 401 clear session và dừng; 404 dừng/báo; 400/protocol dừng tự poll và cho refresh GET từ state hợp lệ. Dispose/route change phải clear timer, abort và không cho finally của request cũ schedule loop mới. StrictMode mount-cleanup-mount chỉ để lại một loop hoạt động.
- [ ] Browser test chặn trang2, chuyển run rồi thả response cũ, kiểm không nhiễm dữ liệu; giữ input focus/disclosure/scroll qua3polls; offline/online đọc đủ seq và không POST lại. Fake timers kiểm no-overlap/abort; browser dùng network fault có kiểm soát. Commit `feat(web): poll runs with ordered events and stale response guards`.

## WEB-02C — Create, quyết định và trace có kết quả chưa xác định

**Files:** map C; thêm `apps/web/tests/unit/{create-controller,decision-controller,trace-controller}.test.ts`, `apps/web/tests/browser/decisions.spec.ts`.

**Interfaces:** `createCreateController(api,session)` trả `{store,submit(input:CreateInput):Promise<void>,dispose}`; snapshot phase `idle|submitting|accepted|uncertain|error`, runId optional. `createDecisionController(api,session,runController)` trả `{store,decide('approved'|'rejected'):Promise<void>,cancel():Promise<void>,dispose}`; phase `idle|submitting|confirming|error`. `createTraceController(api,session)` trả `{store,open(runId:string),loadMore():Promise<void>,restart():Promise<void>,dispose}`; trace snapshot có runId/attempts/nextCursor/loading/error và reconciliation riêng.

- [ ] Create parse CreateRunSchema và lỗi scalar/timezone trước POST; đặt inFlight guard đồng bộ trước await. Chỉ202 với UUID hợp lệ mới navigate. Network/5xx/protocol sau POST có thể đã nhận → uncertain, không gửi lại; dùng GET history/người dùng chọn run. 400/413/415 báo lỗi request; 503 phải phân biệt code đã xác định chưa nhận (PLANNER_UNAVAILABLE/SHUTTING_DOWN) với lỗi dependency có thể chưa rõ kết quả. Draft memory giữ khi ACTIVE_RUN, clear khi logout.
- [ ] Decision lấy snapshot mới nhất tại click: awaiting_approval, approval.pending, expiry>now, run/version khớp, actions nonempty, detail không stale/loading. Capture tuple một lần; khóa approve/reject/cancel khi đang gửi. POST body chỉ4fields, không gửi actions/resolved_args. Cancel không body;202 tiếp tục poll, không tự đặt terminal.

```ts
const body={approval_id:detail.approval!.id,
 workflow_version_id:detail.approval!.workflow_version_id,
 snapshot_hash:detail.approval!.snapshot_hash,decision:'approved' as const};
ApprovalDecisionSchema.parse(body);
expect(Object.keys(body).sort()).toEqual(['approval_id','decision','snapshot_hash','workflow_version_id']);
```

- [ ] 409 → GET detail, thông báo quyết định không còn hợp lệ; người dùng đọc và click lại. Không tự thay tuple mới rồi POST. Mất phản hồi POST → confirming; GET detail/trace để xác nhận. Nếu vẫn pending thì không tự unlock/resubmit vì request cũ có thể còn chạy. Tiếp tục GET; chỉ kết luận khi decision terminal/superseded/expired hoặc server state xác định. Không có nút thử lại POST trong confirming. Giữ command state theo run trong memory qua route change; response cũ chỉ cập nhật đúng run store. Phiên mới vẫn phải fetch server trước mọi quyết định.
- [ ] TTL client về0 khóa action và refresh; server clock quyết định. Unit tests: double-click chỉ1POST, reject/approve đồng thời, response sau logout, timeout sau accepted không POST lần2, stale hash409 chỉ GET, cancel202 empty, expiry boundary. Browser delay response và kiểm trạng thái nút thực tế.
- [ ] Trace fetch khi mở section; mỗi loadMore một request, cursor opaque qua encodeURIComponent, append chỉ cùng generation/run/snapshot. 400 cursor sai/hết hạn → xóa snapshot cũ và fetch trang đầu một lần có notice; không merge cũ/mới. Lỗi lặp dừng và báo. Refresh chủ động tạo snapshot mới. Legacy null fields hiện “chưa có chứng cứ”, không suy thành known failure.
- [ ] Reconciliation chỉ GET; unknown/receipt/marker render text, không nút write. Tool output HTML hiện text; có preview ngắn/mở rộng nhưng giữ nguyên payload/hash bên dưới. API chịu redaction; frontend không lưu raw secrets vào artifacts. Kiểm trace100/100/51, restart/wrong run, HTML canary không chạy script.
- [ ] Gate WEB-02: web unit + browser mock + live lifecycle subset dùng fixture DB riêng, report rõ `API_TECHNICAL_PASS` nhưng browser/frontend còn scope riêng; commit `feat(web): guard run decisions and render trace reconciliation`.

## WEB-03A — Browser gate có receiver evidence và cleanup độc lập

**Files:** `apps/web/tests/live/lifecycle.spec.ts`, `apps/web/tests/live/fixtures.ts`, `apps/web/tests/live/cleanup.ts`, `apps/web/tests/browser/{accessibility,security,session-races}.spec.ts`, `scripts/check-web.mjs`, `scripts/check-web.test.mjs`, `docs/WEB-STATUS.md`, `docs/web-evidence/WEB-03/<timestamp-uuid>/manifest.json` + sanitized observations/screenshots.

**Consumes:** WEB-01/02 đã pass, harness tạo ở WEB-02A; `makeApiFixture` trong apps/api/tests/fixture.ts; receiver queries trong HTTP acceptance hiện có. **Produces:** browser verdict tách backend/AI; test fixture `{api:ApiFixture,frontendUrl:string,close():Promise<void>}` và cleanup report `{databaseAbsent:boolean,filesystemAbsent:boolean,portsClosed:boolean}`. Close lỗi thì gate fail, không nuốt lỗi finally.

- [ ] Playwright projects fixture/live tách testMatch; workers1 cho live, retries0 để không che lỗi chập chờn hoặc ghi hai lần. Mặc định trace/video/screenshot off vì có login/token; chỉ screenshot chủ động sau redaction. Không HAR/raw network/log password. Mỗi test dùng context riêng, không persisted storageState.
- [ ] `createLiveFixture(filesystemEnabled:boolean)` gọi `makeApiFixture({plannerMode:'dev_fixture',workerEnabled:true,filesystemEnabled})`, khởi Vite preview programmatically với target là API fixture origin, bind127.0.0.1 trên port dành riêng. Cổng test do harness cấp và truyền exact origin vào guard; không hardcode5173 cho tests. Không tạo control endpoint ở API. Password fixture chỉ qua memory để fill form, không ghi report. API fixture luôn close trong finally; setup lỗi phải dọn cả tài nguyên đã tạo một phần. WEB-02A cần harness này trước login smoke.
- [ ] Positive b02: browser login → prompt allowlist → run → preview; test process kiểm hub_receipts0 và dữ liệu đích/thông báo chưa đổi; click duyệt → poll terminal → trace. DB có đúng2receipts, Report rows và #team message đúng expected fixture. fs-copy-notify: trước approve destination absent, sau approve exact bytes, một filesystem marker và một task_hub receipt. Lấy runId từ URL/DOM đã validate, không chọn latest run mù.

```ts
await page.getByLabel('Yêu cầu').fill(fixture.api.b02Prompt);
await page.getByRole('button',{name:'Lập kế hoạch',exact:true}).click();
await expect(page.getByRole('button',{name:'Duyệt',exact:true})).toBeEnabled();
const writes=await fixture.api.db.client`SELECT count(*)::int AS n FROM hub_receipts WHERE user_id=${fixture.api.userId}`;
expect(writes[0]!.n).toBe(0);
await page.getByRole('button',{name:'Duyệt',exact:true}).click();
await expect(page.getByTestId('run-status')).toHaveText('Hoàn tất',{timeout:60000});
```

Login helper fill email/password theo labels và chờ overview. Test id dùng assertion ổn định, accessible label vẫn bắt buộc. Final oracle SQL chọn đúng owner/run operation IDs; không đếm dữ liệu user khác. Dùng expected cells/messages từ API acceptance, không suy expected từ actual output.

- [ ] Live negatives tối thiểu: reject0write, expiry theo server clock0write, cancel cooperative, bearer cũ401 sau hết phiên, wrong-owner404 qua direct API. Browser offline/online resume GET; delay approval response sau server accept không duplicate. Crash/unknown của hai receiver cần trusted fault harness và receiver oracle; nếu chưa có case thực chạy thì ghi NOT_RUN và verdict PARTIAL, không thay bằng mock rồi claim live pass.
- [ ] Browser fixture/mock: đủ14status, hai tab memory độc lập, JSON sai,200 thiếu fields,401 từ phiên cũ,409 approval mới, trace hết hạn,451event drain, XSS text canary, session clear DOM. Kiểm keyboard/drawer/disclosures,320/390/1280 không tràn ngang. Review screenshots năm bố cục chính và mobile, ghi page errors đã sanitize; không log raw request/error payload.
- [ ] Đo NFR-03 p95 <=3s trên local: ít nhất30 quan sát server event timestamp → DOM status render; report clock source, sample count, API+poll+render gồm thời gian chờ2s. Không chỉ đo response→render rồi gọi end-to-end. Clock skew hoặc không đủ mẫu thì NOT_MEASURED; không pass bằng fake clock. Không dùng browser performance thay AI planning p95.
- [ ] Cleanup oracle độc lập: capture DB name/root ownership/ports trước close; close fixture; kết nối admin riêng query pg_database để xác nhận DB không còn; kiểm exact root absent và HTTP ports đóng. Khi cần xóa filesystem, resolve absolute và kiểm nằm trong root UUID do harness tạo; dùng một API/shell từ đầu đến cuối, không đụng root demo. Đóng admin/browser trong finally. Cleanup false → exit1, giữ lý do và path đã sanitize.
- [ ] check-web runner dùng command arrays, không shell, cwd root, deadline từng process. Build/unit → fixture browser → live browser tuần tự; không chạy integration ghi DB song song. Root check chỉ chạy lại khi source mới cần kiểm. Manifest có source hashes, selected tracked/untracked files, lock/browser/Node versions, command exit, từng case/oracle/screenshot review, cleanup. Provenance bao gồm runner/harness/tests/configs/DSL/API/engine; không chỉ HEAD vì working tree có thể dirty.
- [ ] Runner tests dùng child commands tổng hợp: exit1, timeout, cleanup false, thiếu case đều không PASS; đủ required cases và cleanup true mới pass. Không đổi labels để xóa NOT_RUN. Nếu API vẫn PARTIAL, `WEB_BROWSER_EXERCISED_PASS` chỉ nói phạm vi browser đã chạy; **G3 overall PARTIAL**. FR-CON-04 thiếu catalog ghi riêng; AI/rubric/user work không tự PASS.
- [ ] Review evidence allowlist, không token/password/connection string/session trace hoặc ảnh lộ password. Commit `test(web): verify browser lifecycle with receiver and cleanup evidence`.

## Coverage và cổng bàn giao

| UX case | Task kiểm |
|---|---|
| A01 chờ duyệt → đúng snapshot | 01C,02C,03A receiver |
| A02 back/reload/noPOST | 01B,02A,03A |
| A03 all14/outcomes | 01C |
| A04 doubleclick/409/lostreply | 02C,03A |
| A05 seq/reconnect/focus | 02B,03A |
| A06 expiry/staleresponse | 02A/B,03A |
| A07 unknown không replay | 01C,02C,03A |
| A08 disconnected/catalog thật | 01C,02A; catalog API riêng |
| A09 historylimit/errors | 01C,02A |
| A10 responsive/keyboard | 01C,03A |
| A11 safeoutput/secrets | 02A/C,03A |
| A12 read-only không approval | 01C,03A |

Trước giao WEB-01: ADR + spec + kế hoạch này là đầu vào. Trước nghiệm thu live: kiểm API-STATUS/audit fix progress, policy fingerprint sau cài, preset fixtures/public prompts. `npm run test:browser -w @wap/web` và các scripts trên là lệnh **sẽ tạo**, chưa chạy được ở checkout planning.

## Prompt giao đúng một checkpoint

```text
Làm trong D:\Môn học\ATI\ATI_Project. Trước code, nghiên cứu repo để giải thích mục tiêu B/local,
kiến trúc DSL/API/engine/MCP, invariant approval/unknown/session và hiện trạng bằng chứng.
Đọc BASELINE, EXECUTION-CONTRACT, FR, FRONTEND-HANDOFF, ADR-001-FRONTEND-STACK, ADR-002-FRONTEND-UI-DATA-LAYER,
spec platform UX và toàn bộ plan 2026-09-15-frontend-platform. Không đọc secrets hoặc dữ liệu thật của user.
Triển khai WEB-01A trước; các task khác dùng để hiểu interfaces. Nếu source lệch plan, chỉ rõ
file/contract trước khi sửa. Không tự mở scope editor/library/SaaS hoặc nâng toàn bộ dependencies.
Kết thúc checkpoint: review diff, chạy checks task, báo exitcodes/evidence/NOT_RUN và commit exact files,
không push. Giữ evidence lịch sử. Không claim browser hay AI chỉ vì build/unit tests pass.
```

Sau WEB-01A có thể tiếp B/C theo quyền người dùng giao; luôn review từng checkpoint. Kế hoạch này không chứng minh đã có frontend hoặc rằng quỹ giờ sáu tuần cũ vẫn đủ.
