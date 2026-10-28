# Slack Personal Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây hợp đồng danh tính/quyền dữ liệu, kiểm kê phương thức Slack có nguồn và HTTP fixture/probe để bắt đầu OAuth nhiều workspace mà chưa tác động Slack thật.
**Architecture:** Thêm contract thuần vào tool-schemas, không đăng ký dịch vụ/tool. Script chỉ đọc docs công khai để tạo inventory; HTTP fixture có state và probe giới hạn loopback cung cấp kiểm chứng offline cho các đợt sau.
**Tech Stack:** Node.js `^22.12.0 || >=24.0.0`, TypeScript hiện có, Vitest, `node:test`, HTTP/crypto/fetch. Sau fix review 29/10, collector khai báo trực tiếp devDependency `saxes@6.0.0` đã có trong lockfile; không thêm package/version vào cây dependency. Xem [log sửa P2](../../handoff/log/2026-10-29-slack-01-p2-fixes.md) về ngoại lệ này với kế hoạch ban đầu.
**Spec:** [Slack cá nhân và trợ lý công việc trong ATI](../specs/2026-10-28-slack-personal-oauth-design.md), bản sửa `d479b098`.
**Task card:** [SLACK-01](../../handoff/tasks/SLACK-01-foundation.md).
**Status:** năm task Native đã thi công trên `feat/slack-01-foundation`; review độc lập đã chạy, Important được sửa và toàn suite local đạt. CI đúng head/owner review còn là gate trước tích hợp. Kết quả chi tiết ở task card.

## Global Constraints

- “Các thao tác Slack dùng danh nghĩa người đã cấp quyền.”
- “Không có allowlist kênh ở connector cá nhân.”
- “Mọi gather/search/lookup mang binding do server xác nhận gồm `ATI user`, `connectionId`, `workspaceId`, `Slack user`, `identityVersion`.”
- Các quyền được xin từ bảng kiểm kê; không có wildcard “full Slack”. Các row chưa chứng minh khả dụng không được công bố là đã hỗ trợ.
- “Chưa đủ điều kiện thì kết nối chỉ hiển thị metadata thiết lập cần thiết và trạng thái chờ cho phép xử lý.”
- “Chưa chứng minh được thì chưa bật nhận tin chủ động trong live.” Probe fixture không chứng minh hành vi provider thật.
- User token, Free/Pro, nhiều workspace, ba mode cấu hình riêng và duyệt trong ATI là phạm vi đích; không đóng feature bằng SLACK-01.
- Không thêm vào `ALL_TOOLS`/`SERVICE_REGISTRY`, không route/API/UI nghiệp vụ, không migration/refresh DB trong card này.
- Chỉ docs nguồn công khai hoặc loopback fixture; không OAuth, tạo app, gửi/xóa Slack thật, gọi model hay thay cờ.

## Review Focus

1. Workspace/kênh trùng tên hoặc ID: không được coi hai binding là một — test Task 1.
2. OAuth có scope nhưng chấp thuận/provider đã hết hiệu lực: không cho đưa nguồn vào model, kể cả mode luật — test Task 2.
3. Frontmatter không có `scopes.user`: không suy thành unsupported hay supported; thiếu trang/docs drift không được coi inventory đầy đủ — test Task 3.
4. HTTP 200 nhưng Slack body `ok:false`, cursor còn trang và token sai workspace: probe phải phát hiện — test Task 4–5.
5. Redirect khỏi loopback, abort hoặc write timeout sau commit: không gọi live, không retry write, report phải ghi fixture/UNKNOWN trung thực — test Task 4–5.

## Lộ trình toàn bộ feature

Mỗi dòng sau có task/plan riêng khi đến lượt. SLACK-01 là phần đầu có thể kiểm tra độc lập; các dòng còn lại vẫn mở và không phải tính năng đã triển khai.

| Card tiếp theo | Phạm vi phải giữ | Phụ thuộc/gate |
|---|---|---|
| SLACK-01 | Contract nguồn/quyền, inventory và fixture/probe | Kế hoạch này |
| SLACK-02 | OAuth/confidential client, credential nhiều workspace, callback CAS, refresh/disconnect PostgreSQL, chấp thuận/provider, Settings | Contract 01; app/setup live làm riêng |
| SLACK-03 | Catalog/tool theo từng nhóm hợp lệ của inventory; lookup → memory → plan → execution binding; source store/tombstone/purge/history và preview | 01–02; quyền và vòng đời nguồn phải hoàn chỉnh trước bật công cụ cá nhân |
| SLACK-04 | Ingress ký số, authorizations fanout, queue, vòng đời nguồn độc lập cờ, echo/outbox và UNKNOWN | 01–03 cho các tool đã có; không cần đợi mọi nhóm tool mới xây ingress |
| SLACK-05 | Luật/AI/kết hợp, mức liên quan, theo dõi thread, configVersion, budget/backlog và pause | 02–04 |
| SLACK-06 | Hộp đề xuất trong ATI, sửa/duyệt, cross-service, tổng hợp ngày, privacy/guide và UI nghiệm thu | 03–05; daily cần scheduler mở rộng |
| SLACK-07 | Label trước model, ba lượt/mode, Free/Pro + hai người cùng workspace, readback từng nhóm và PR bật cờ | Tất cả phần hợp lệ được inventory theo dõi; chưa đủ thì feature còn mở |

Các nhóm tool trong SLACK-03 có thể chia thành card con sau inventory; mỗi method có mapping tới card/tool hoặc lý do hạn chế. Không tự bỏ phần khó. Không cam kết ngày giao toàn feature hay thay mốc freeze hiện tại bằng kế hoạch này.

## File structure và ownership

| File | Trách nhiệm |
|---|---|
| `packages/tool-schemas/src/myslack-context.ts` | Binding/source reference và phép so khớp danh tính |
| `packages/tool-schemas/src/myslack-policy.ts` | Quyết định cho phép nguồn đi vào model; thuần, không I/O |
| `packages/tool-schemas/src/index.ts` | Chỉ export contract, không thêm tool/service |
| `packages/tool-schemas/tests/myslack-context.test.ts`, `myslack-policy.test.ts` | Kiểm bất biến identity/quyền và giữ catalog cũ |
| `scripts/slack/inventory.mjs`, `inventory.test.mjs` | Thu thập/chuẩn hóa/kiểm coverage docs |
| `docs/slack/method-inventory.json`, `method-inventory.md` | Snapshot có provenance và hướng dẫn đọc kết quả |
| `scripts/fake-slack-personal.mjs`, `fake-slack-personal.test.mjs` | Provider HTTP có state, token/workspace/scope, phân trang và lỗi |
| `scripts/slack/contract-probe.mjs`, `contract-probe.test.mjs` | Probe fixture có giới hạn endpoint và báo cáo không chứa secret |
| `package.json` | Lệnh kiểm tra mới và nối node tests vào check hiện có |

Schema thuộc Integration/AI theo team-workflow; script/provider fixture thuộc Integration/Backend; root package là shared file cần owner review trong PR. Cùng card không có nghĩa một subagent được sửa chéo module; nếu thực thi nhiều agent phải giao ownership theo file và thống nhất contract trước.

### Task 1: Binding và source reference không mất workspace

**Files:** create `packages/tool-schemas/src/myslack-context.ts`, `packages/tool-schemas/tests/myslack-context.test.ts`; modify `packages/tool-schemas/src/index.ts`.
**Interfaces:** produce `SlackBinding { atiUserId:string; connectionId:string; workspaceId:string; slackUserId:string; identityVersion:number }`, `SlackSourceRef { binding:SlackBinding; resourceType:'conversation'|'message'|'file'; resourceId:string; revision:string }`, `sameSlackBinding(a:SlackBinding,b:SlackBinding):boolean`. No credential/token fields; version is positive safe integer, IDs nonempty; export `validateSlackBinding(value:unknown):SlackBinding` throwing `TypeError` on invalid input.

- [x] **Step 1:** Write tests including the assertions below and each individual field mismatch. Invalid versions include 0, -1, fractional, Infinity and unsafe integer; reject empty IDs and absent fields.
  ```ts
  expect(sameSlackBinding(a, { ...a })).toBe(true);
  expect(sameSlackBinding(a, { ...a, workspaceId: 'T_OTHER' })).toBe(false);
  expect(sameSlackBinding(a, { ...a, identityVersion: a.identityVersion + 1 })).toBe(false);
  expect(() => validateSlackBinding({ ...a, identityVersion: 0 })).toThrow(TypeError);
  expect(ALL_TOOLS.some(t => t.service === 'myslack')).toBe(false);
  expect(SERVICE_REGISTRY.some(s => s.id === 'myslack')).toBe(false);
  ```
- [x] **Step 2:** Run `npm test -w @wap/tool-schemas -- tests/myslack-context.test.ts`; expected FAIL on missing exports/module.
- [x] **Step 3:** Implement the two exact functions and export contract from index. Compare every identity field; do not compare only names/resource ID. No service registration or changes to existing PlanConnections yet.
- [x] **Step 4:** Re-run that command; expected PASS with all invalid/mismatch cases covered.
- [x] **Step 5:** Commit only the three task files: `feat(slack): add personal workspace identity contracts`.

### Task 2: Policy contract cho dữ liệu nguồn vào model

**Files:** create `packages/tool-schemas/src/myslack-policy.ts`, `packages/tool-schemas/tests/myslack-policy.test.ts`; modify `packages/tool-schemas/src/index.ts`.
**Consumes:** Task 1 `SlackBinding`, `sameSlackBinding`.
**Produces:** `SlackModelPolicy { binding:SlackBinding; connectionActive:boolean; consent:{status:'pending'|'granted'|'revoked'; policyVersion:string; providerId:string; retentionDays:number}; provider:{id:string; verified:boolean; noTraining:boolean; maxRetentionDays:number} }`; `SlackModelRequest { binding:SlackBinding; policyVersion:string; requestedRetentionDays:number }`; `decideSlackModelUse(policy:SlackModelPolicy,request:SlackModelRequest):{allowed:true}|{allowed:false;reason:'connection_inactive'|'identity_changed'|'consent_missing'|'policy_changed'|'provider_unverified'|'retention_exceeded'}`.

- [x] **Step 1:** Write table tests: inactive connection; any binding mismatch; pending/revoked consent; mismatched policy version; wrong provider ID, not verified or noTraining false; request retention above either approved cap; finite nonnegative retention validation. Valid boundary exactly at both caps returns `{allowed:true}`. When multiple reasons apply, priority follows the reason list above.
- [x] **Step 2:** Run `npm test -w @wap/tool-schemas -- tests/myslack-policy.test.ts`; expected FAIL because decision function does not exist.
- [x] **Step 3:** Implement decision in that priority; invalid numeric values fail closed as `retention_exceeded`. Function does not infer organization authority from OAuth/user scopes. Trusted backend constructs policy only after its own evidence checks in SLACK-02; this helper is not that evidence or an already-enforced API gate.
- [x] **Step 4:** Re-run the test command; expected PASS. Contract does not accept a mode-based exemption; actual enforcement in rule-planner/manual/classifier consumers is tested in 02–06, not claimed by these pure-function tests.
- [x] **Step 5:** Commit only these files: `feat(slack): define source model authorization policy`.

### Task 3: Kiểm kê toàn bộ danh mục phương thức có nguồn

**Files:** create `scripts/slack/inventory.mjs`, `inventory.test.mjs`, `docs/slack/method-inventory.json`, `method-inventory.md`.
**Consumes:** public docs only; no OAuth/token. **Produces:** exports `extractMethodLinks(xml:string):string[]`, `parseMethodFacts(markdown:string,sourceUrl:string):MethodFacts`, `validateInventory(snapshot:Inventory):string[]`, plus CLI below.
`MethodFacts`: `method, sourceUrl, fetchedAt, sourceSha256, httpMethod, rateLimit, userScopes:string[]|null, userToken:'documented'|'undetermined'`.
`Inventory`: `schemaVersion:1, collectedAt, index:{url,sha256,methods:string[]}, methods:Array<MethodFacts & {planRequirement:string;roleRequirement:string;sideEffect:'read'|'write'|'undetermined';risk:'low'|'medium'|'high'|'undetermined';disposition:'candidate'|'excluded'|'probe_required';reason:string;evidenceUrls:string[];atiMapping:string|null;deliveryStatus:'not_implemented';reviewState:'unreviewed'|'reviewed'|'source_changed'}>`.

- [x] **Step 1:** Write Node tests using small synthetic XML/frontmatter: dedup/sort canonical URLs; reject foreign host or off-method paths; matching `method_name`; parse `scopes.user`; absent user scopes stays `undetermined`; malformed/unrecognized metadata throws instead of inventing facts. Validation rejects duplicate/missing/extra rows relative to index, missing provenance/reason/evidence or any `deliveryStatus` claiming implemented.
- [x] **Step 2:** Run `node --test scripts/slack/inventory.test.mjs`; expected FAIL importing missing module.
- [x] **Step 3:** Implement strict extraction/parser and validator. Source is `https://docs.slack.dev/sitemap.xml`, filtered to canonical method URLs; per-method markdown is the canonical URL without trailing slash plus `.md`, as Slack's llms.txt documents. Parse only supported frontmatter scalar/JSON-array forms; unsupported forms become explicit collection errors needing review, never an empty successful row. User field absent does not mean bot-only. No automatic read/write inference from GET/POST.
- [x] **Step 4:** Re-run Node tests; expected PASS. Add CLI `node scripts/slack/inventory.mjs collect --output docs/slack/method-inventory.json`: docs.slack.dev HTTPS allowlist, reject foreign redirects, 10 s/request, at most 2 in flight, Retry-After on 429 and at most 2 retries. Store extracted metadata/hashes only, not full provider documentation.
- [x] **Step 5:** Collect public docs, then inspect/annotate every row using its official method page. New rows start `reviewState:unreviewed`; initialize unproven eligibility as `probe_required`, not as unsupported/supported. Record the exact unknown and evidence; requirements may state “not specified by docs; live probe required”. After review mark `reviewed`, including cases requiring future native proof. Safe retry preserves annotations for matching hashes; changed hashes mark `source_changed` until reviewed again.
- [x] **Step 6:** Add `node scripts/slack/inventory.mjs verify --input docs/slack/method-inventory.json`; expected exit 0 only when row count equals frozen index and every row is `reviewed`; print disposition and unresolved probe counts. Duplicate/omitted row or unreviewed/source_changed mutation must exit 1. Verify is offline and never silently fetches a new index. Write reading guide: candidates are not implemented and reviewed probe-required rows still remain open in full-feature acceptance.
- [x] **Step 7:** Commit the four files: `docs(slack): inventory public API capabilities with provenance`. A collection failure cannot be reported as complete inventory; stop the task with exact error if the source cannot be read after bounded retries.

### Task 4: HTTP Slack fixture với state và phân quyền

**Files:** create `scripts/fake-slack-personal.mjs`, `scripts/fake-slack-personal.test.mjs`.
**Produces:** `startFakeSlackPersonal({port?:number}={}):Promise<FakeSlackFixture>`; fixture exposes `origin:string`, `tokens:{a:string;b:string;colleague:string}`, `setFault(method:string,{delayMs?:number;afterCommit?:boolean}):void`, `close():Promise<void>`. Seed: user A in T_FREE and T_PRO, colleague in T_FREE; two same-name channels, private/DM visibility differs. Fixture tokens clearly synthetic; bind only 127.0.0.1.

Seed values are fixed for Task 5: tokens a/b/colleague identify `(T_FREE,U_FREE_A)`, `(T_PRO,U_PRO_A)`, `(T_FREE,U_FREE_B)` respectively. Both workspaces have public `C_GENERAL` named general, with isolated histories. A also sees `G_PRIVATE` and `D_PRIVATE`; colleague sees only C_GENERAL; Pro sees only its C_GENERAL. Thus visible list counts a/b/colleague = 3/1/1. These collisions are adversarial fixture inputs, not a claim Slack always reuses IDs. All resource access keys include workspace.

Token a/b scopes are `channels:read,groups:read,im:read,channels:history,groups:history,im:history,chat:write`; colleague scopes are `channels:read,channels:history`, so posting with colleague proves the missing_scope path. Invalid/unknown tokens return invalid_auth; resource access outside visible set returns channel_not_found. No OAuth exchange, app-level token or event signing API in this fixture version; those belong to 02/04.

- [x] **Step 1:** Node HTTP tests: `auth.test` gives exact user/team; `conversations.list/history/replies` enforce scope/visibility and pagination; `chat.postMessage` stores a message with token owner's identity; another workspace cannot read it; insufficient scope returns HTTP 200 with `{ok:false,error:'missing_scope'}`. Add real fetch AbortSignal timeout against delayed server and after-commit delay proving a timed-out write can still exist once.
- [x] **Step 2:** Run `node --test scripts/fake-slack-personal.test.mjs`; expected FAIL missing module.
- [x] **Step 3:** Implement those five methods with state; API paths `/api/<method>`, Authorization header, Slack-shaped JSON. Default list page size 1; cursor encodes fixture collection/offset and rejects invalid cursor. Fault only applies to named method; afterCommit delay stores write before delaying response. No fabricated database locking claims and no additional fake method advertised as supported.
- [x] **Step 4:** Re-run HTTP tests; expected PASS, including actual client abort and readback of one timed-out write. Close all servers after each test; no port/process left running.
- [x] **Step 5:** Commit the two files: `test(slack): add stateful personal Slack HTTP fixture`.

### Task 5: Probe offline và tích hợp lệnh kiểm tra

**Files:** create `scripts/slack/contract-probe.mjs`, `contract-probe.test.mjs`; modify `package.json`.
**Consumes:** fixed seed of fixture Task 4. **Produces:** `runFixtureProbes({baseUrl:string,tokens:{a:string;b:string;colleague:string},signal?:AbortSignal,requestTimeoutMs?:number}):Promise<{mode:'fixture';verifiedLive:false;checks:Array<{name:string;status:'pass'|'fail'|'unknown'}>}>`; default per-request timeout 1000 ms. CLI `node scripts/slack/contract-probe.mjs --fixture` starts/closes own fixture and prints only that report.

- [x] **Step 1:** Node tests: reject HTTPS/public host/userinfo before network I/O; reject a foreign redirect after only the allowed loopback request, without following it. Allow only literal 127.0.0.1 or IPv6 loopback HTTP. Check exact fixed actor/team/list counts from Task 4; token errors/ok:false or a missing page fails. External cancellation rejects with AbortError, while a per-request deadline after sending a write reports unknown without retry. Verify mode fixture, verifiedLive false and no tokens/body in output; invalid CLI args including `--live` are rejected.
- [x] **Step 2:** Run `node --test scripts/slack/contract-probe.test.mjs`; expected FAIL missing module.
- [x] **Step 3:** Implement checks for actor/team, pagination, per-user/workspace visibility and write identity/readback using the five fixture methods; reject redirects (`redirect:'error'`). A per-request deadline after sending a write reports unknown and never re-sends; external cancellation follows Step 1 and rejects with AbortError. A read-only verification cannot turn an unrelated or absent message into proof of the write. CLI exits 0 only if all normal checks pass; tests fault scenarios individually.
- [x] **Step 4:** Re-run Node tests and CLI; expected PASS and `verifiedLive:false`. Tests demonstrating behavior against a fixture are recorded as offline only.
- [x] **Step 5:** Add `test:slack:foundation` running the three new Node test files followed by the two tool-schemas tests. Extend the existing final `node --test` list in `check` with the three new Node files, preserving every existing command. Existing `test:v3` already runs schema tests, so do not duplicate them in the main check command.
- [x] **Step 6:** Run `npm run test:slack:foundation`, `npm run typecheck:v3` and `npm run check`; expected all exit 0. Use the project's real PostgreSQL/local runner setup for existing integration suites; missing setup is NOT_RUN/blocker, not permission to mock DB or weaken assertions. Record actual outputs and immutable snapshot/probe mode.
- [x] **Step 7:** Review exact diff for no tool registration, app routes, feature flags or live calls; update SLACK-01 results and add a new handoff log with commands/RED→GREEN/remaining probes. Commit only task files: `test(slack): verify foundation contracts without live effects`. Independent review and exact-head CI precede integration; no automatic merge or live enable.

## Self-review và handoff

- Contract dependencies: Task 2 consumes exact Task 1 fields; Task 3 is docs-only and independent; Task 5 consumes exact Task 4 tokens/methods. No model-facing runtime exposes contracts yet.
- Spec coverage: this plan implements preparation in design sections 2, 4.4–4.5 and 10. F3 purge enforcement, DB concurrency, signed ingress/echo and actual catalog are explicitly assigned to 02–04, not claimed tested by pure helper/fixture tests.
- All five Review Focus items have owning tests. Method restrictions still requiring provider proof remain explicit probes, not guessed constraints.
- Implementation needs one isolated feature branch per card, preserving main checkout/unrelated logs. No npm installation or app scaffolding was performed while writing this plan.
- Execution proposal: **Native** for this first card, because its tasks share contracts and fixture state; fresh independent whole-branch review at the end. Subagent-driven is also available for review after each task. User reviews this concrete plan and chooses the method before code, as required by writing-plans.
