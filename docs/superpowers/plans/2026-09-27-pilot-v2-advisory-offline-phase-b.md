# Pilot v2 Advisory Offline Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans after plan approval. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** IMPLEMENTATION_APPROVED; chủ project trả lời “duyệt” cho plan.
Triển khai fake-only được phép; completion cần tests, review và checkpoint gates.

**Goal:** Harness fake-only có campaign freeze, append/seal observations và
structural grading đối chiếu ledger, qua chính API authentication/admission.

**Architecture:** Một database mới cho mỗi measurement; coordinator tuần tự gọi
API loopback với fixture intake và builtin fake planner. Observer pin đúng
callId đã claim, runtime hiện tại vẫn sở hữu accounting. Store evaluator riêng
không sửa migration production. Report đọc observations đã seal, không dispatch.

**Tech Stack:** TypeScript, Zod, postgres.js/@wap/db, createApi, Vitest; không dependency mới.

**Spec:** [Phase B design đã duyệt](../specs/2026-09-27-pilot-v2-advisory-phase-b-design.md).
Các quyết định sau là chi tiết triển khai của spec, không mở live execution.

## Global Constraints

- Chỉ `offline_fake`; không provider factory/SDK import, API key, HTTP SaaS,
  model thật, price fetch, CLI live/`--execute`, production `main.ts` hay UI.
- Giữ owner/grant/snapshot/TTL10m/one-claim/one-active-run/unknown-hold/no-retry.
  Không tạo reserve/settle thứ hai, không cập nhật ledger thay runtime.
- Không giữ raw proposal prose/exception/headers; report fake usage/cost/timing
  gắn nhãn simulated. Không AI_QUALITY_MEASURED/customer readiness.
- Không đọc holdout prompt/oracle hoặc sửa dataset. Test dùng synthetic matrix
  riêng. Public40/holdout20 mapping/campaign thật nằm ngoài batch.
- Mọi commit chỉ owned files; giữ pre-existing dirty docs/config/deletions.
  Không `git add .`, reset/stash/clean, amend/push; baseline code `049cdfe`.
- Một writer; hai app instances phục vụ hai identity không có nghĩa hai worker.
  Không parallel slot/DB fixture runs. Không DB locks xuyên HTTP/fake wait.

## Review Focus

1. Marker đúng nhưng role là owner/admin hoặc DB sai: không bootstrap/run,
   không DDL trên database có sẵn (Task2).
2. Claim/event có nhưng submission/result không chắc chắn: không replay sau
   restart; late settlement không nâng incomplete thành complete (Task3–4).
3. Fail persist sau return không được làm mất known cost; hash/seal integrity
   khác observation completeness (Task3–5).
4. Hai principals phải qua auth thật, không monkeypatch authenticate; cleanup
   reject không được chấm là model refusal (Task4).
5. Call orphan/unknown usage không biến thành0 hoặc bị loại khỏi denominator;
   report read-only không gọi runtime hoặc provision (Task5–6).

## File map và dependency order

Tất cả code mới ở `apps/api/src/pilot-evaluation/`, tests tương ứng ở
`apps/api/tests/`. Không engine→app dependency hay sửa application routing.

| Unit | Files | Phụ thuộc |
|---|---|---|
| Contract/freeze | `contracts.ts`, `manifest.ts` | Phase A projection/schema |
| Dedicated DB/store | `schema.ts`, `provision.ts`, `store.ts` | contract/freeze |
| Capture | `fake-adapter.ts`, `observer.ts` | store + existing pilot attempt/call |
| Orchestration | `coordinator.ts` | manifest/store/observer/createApi |
| Output | `report.ts`, `index.ts` | sealed store snapshots; no coordinator import |
| Evidence/how-to | `apps/api/README.md` subsection only | verified results |

**SQL packaging:** dùng `schema.ts` export static versioned SQL string thay
candidate `schema.sql` trong design. `tsc` hiện chỉ emit TS; cách này tránh SQL
asset bị mất ở dist mà không thay build pipeline hoặc fallback đọc source tree.

**Entry:** library entrypoints qua `index.ts`, chưa thêm CLI/root package scripts.
Unit/integration callers thực thi campaign qua API dưới đây. Không auto-provision
khi import, report hoặc run. Hướng dẫn tối thiểu chỉ fake-only programmatic flow.

## Shared interfaces cần khóa trong Task1

Tạo Zod schemas strict và inferred types; mọi hash là SHA-256 lowercase64,
UUID canonical, counter/micro-unit là safe integer; không dùng unknown payload
JSONB tùy ý. Bounds cho harness (không phải live token cap): JSON artifact <=1MiB,
1–100 slots, event payload <=16KiB, timeout1–30000ms; không silently truncate/hash
một giá trị đã mất nội dung. Timestamp ISO UTC, duration finite/nonnegative.

- `FrozenManifest`: format `pilot-advisory-offline-v1`, measurementId, exact
  gitCommit, artifact hashes (code/projection/prompt/schema/fixtures/oracle/
  fakeScript/rubric), `executionMode:'offline_fake'`,
  `outputContract:'pilot-advisory-v1'`, `catalogMode:'fixed'`,
  `costEvidence:'SIMULATED_NOT_BILLED'`, two principal aliases/UUID mappings,
  per-principal limits, timeout, ordered slot descriptors và schema/rubric versions.
- `SlotDescriptor`: opaque slotId, ordinal, inputHash, language, principalAlias,
  declaredEligibility `eligible|deterministic|out_of_scope`, exact frozen
  fixture config/policy mapping. Không expected answer/fault label gửi callback.
- `FixtureBundle`: strictly parsed projected inputs + builtin fake script;
  oracle nằm ở artifact riêng, runner chỉ biết oracleHash, không mở oracle file.
- `DatabaseIdentity`: measurementId, databaseName, schemaVersion, random marker
  nonce hash, expected runtimeRole. Không credential trong manifest/report.
- `SafeEvent`: seq, type, slotId, optional runId/callId, monotonic duration,
  bounded allowlisted payload; previousHash/eventHash. Types:
  `slot_intent|callback_entered|fake_return|fake_error|http_outcome|cleanup|late_return`.
- `SlotSeal`: event range/hash, ledger snapshot hash, `complete|incomplete`,
  fixed reason enum. `CampaignReport` mang n/N đầy đủ và simulated labels;
  verdict `OFFLINE_MEASUREMENT_CONTRACT_TESTED|INCOMPLETE|BLOCKED`.

Export operations (exact signatures finalized together in `contracts.ts`):

```ts
freezeManifest(input: ManifestDraft, artifacts: ArtifactHashes): FrozenManifest
assertFrozen(manifest: FrozenManifest, artifacts: ArtifactHashes): void
provisionOfflineCampaign(adminUrl: string, manifest: FrozenManifest): Promise<PrivateBootstrapReceipt>
openEvaluationStore(runtimeUrl: string, expected: DatabaseIdentity): Promise<EvaluationStore>
runOfflineCampaign(input: OfflineRunInput): Promise<CampaignRunResult>
buildOfflineReport(store: ReadonlyEvaluationStore, oracle: StructuralOracle): Promise<CampaignReport>
```

`PrivateBootstrapReceipt` contains identity, runtime connection and temporary
login credentials, không JSON-log/stringify hoặc đưa vào evidence/public return.
`OfflineRunInput` chứa frozen manifest, validated fixture bundle, store identity
và private login config; không admin URL/provider/custom callback factory.
`CampaignRunResult` chỉ có measurementId/manifestHash, state/completeness và
optional sealHash; chưa có grade/verdict quality. Producer không cần oracle để
trả kết quả chạy. `ReadonlyEvaluationStore` chỉ SELECT/snapshot verification;
separate DB role. Các typed library calls là trusted in-process API; external
artifacts phải qua bounded JSON bytes parser trước, không nhận executable JS
object/proxy/custom adapter như dữ liệu CLI.

### Task1 — Contracts và freeze

**Files:** create contracts/manifest; tests `pilot-evaluation-manifest.test.ts`.

- [ ] RED: parse rejects nonfake mode/provider transport settings/extra keys,
      overbound artifact, unsafe integer, duplicate slot/ordinal/principal mapping,
      mismatched input/script hashes, mutable config/order after freeze.
- [ ] RED: canonical object key order không đổi hash; array order đổi hash;
      đổi mỗi frozen field/cap/rubric/code digest bị `assertFrozen` từ chối.
- [ ] Run `npm run test:unit -w @wap/api -- tests/pilot-evaluation-manifest.test.ts`.
- [ ] Implement bounded data-only parsers, canonical JSON và immutable copies.
      Data entry từ JSON bytes, không stringify arbitrary objects/proxies; builtin
      fake registry sau này chỉ trả plain records do code tạo từ parsed primitives.
- [ ] GREEN rồi commit exact files. Manifest tests không đọc holdout/oracle đáp án.

### Task2 — Provision database và append/seal store

**Files:** create schema/provision/store; tests
`pilot-evaluation-store.integration.test.ts`; helper
`tests/helpers/pilot-evaluation-fixture.ts`.

**Storage contract:** evaluator-only schema `pilot_eval` với campaigns, slots,
events, seals, grades và identity marker. Typed FK/composite uniqueness gắn
measurement/slot; callId references actual public ledger identity khi tồn tại.
Events/seals/grades immutable; slot lifecycle cập nhật trước seal, sealed fields
protected. Campaign states `frozen|running|completed|incomplete|blocked`.
`claimCampaign()` là CAS frozen→running dưới transaction, đúng một process thắng;
không reopen running/incomplete/blocked. `appendEvent`, `sealSlot`, `sealCampaign`
serialize seq/hash/state bằng transaction; không giữ lock khi invoke/HTTP.

- [ ] RED: admin bootstrap chỉ CREATE một random `pilot_eval_<uuidhex>` DB mới
      và generated runtime/report roles; collision bị từ chối, không reuse/migrate
      existing DB. Migrate public runtime schema qua @wap/db chỉ ở DB mới.
      Không dùng `G1_DATABASE_URL` fallback hoặc makeApiFixture auto-drop.
      Inject failure sau từng bootstrap stage; cleanup chỉ resources có receipt
      chứng minh vừa được invocation tạo. Không drop theo prefix đơn thuần, không
      cascade qua objects/role grants ngoài receipt. Nếu không chứng minh được
      ownership sau interruption, báo setup-incomplete để operator xử lý; không đoán.
- [ ] RED: wrong marker/DB/schema/role, superuser/CREATEDB/CREATEROLE/BYPASSRLS,
      table ownership hoặc DDL privileges của runtime role → fail before writes.
      Runtime role không member của provisioner/owner; không grant CREATE schema.
      Chỉ trên DB mới: revoke default PUBLIC CREATE/TEMP database và schema
      CREATE, chỉ grant CONNECT/schema USAGE + explicit DML cần thiết cho từng
      role. Không động grants của DB có sẵn. Identifier DB/role sinh từ UUID
      hex và quote có kiểm tra; không interpolate identifier do fixture cung cấp.
- [ ] RED: runtime role có đúng SELECT/INSERT/UPDATE trên bảng public cần cho
      createApi pilot, không DDL; events/seals/grades không UPDATE/DELETE;
      marker immutable; report role SELECT-only, không EXECUTE mutation helpers.
      Negative SQL permission tests phải chạy dưới role đó, không chỉ inspect grant:
      thử INSERT/UPDATE/DELETE, mutation helper và SET ROLE sang provisioner đều
      phải bị chặn dưới report role; không chỉ kiểm function code dùng SELECT.
- [ ] RED: two claimers chỉ một thành công; append seq collision/invalid foreign
      links/seal drift bị reject; post-seal mutation thất bại; incomplete seal
      không được report thành complete. Không CHECK bằng timestamp volatile.
- [ ] Run targeted integration test; implement SQL static versioned string,
      migration/bootstrap marker, explicit grant allowlist và transaction store.
      Nếu dùng triggers/helper functions, owner là provisioner, fixed search_path,
      revoke PUBLIC EXECUTE cho mutation helpers, validate identity trong helper.
- [ ] Seed two synthetic users và pilot grants/campaigns qua provisioner trước
      runtime start; password hash/session secrets chỉ ở private bootstrap config.
      Marker verify trước evaluator schema installation, dùng bootstrap-owned
      identity record đã tạo trên DB mới; không nhận client tự ghi marker tùy ý.
- [ ] Verify runtime/campaign budgets dương dùng simulated units, exact provider
      enum của ledger + `offline-fixture-*` model. Không giả làm zero-dollar approval.
- [ ] GREEN + build API và import compiled schema/store trong test smoke. Đảm bảo
      dist hoạt động không đọc `.sql` dưới src hay AGENTS.md local.
- [ ] Commit exact files. Test cleanup đóng pools, xóa **chỉ** DB/roles trong
      receipt do test vừa tạo; failure cleanup được báo. Durable provision function
      không auto-drop DB/roles trên success hoặc khi run/report kết thúc.

### Task3 — Observer và builtin fake adapter

**Files:** create fake-adapter/observer; tests
`pilot-evaluation-observer.integration.test.ts`.

**Interfaces:** `createObservedFakePlanner({store, manifest, slot, script}):
PilotAccountedPlanner`; chỉ script validated từ fixed registry, không caller
`propose`/dynamic module. Builtins: valid plan, clarification, refusal, invalid
proposal, throw, unknown usage/cost, delayed response. Script không đọc oracle
và không nhận whole V2 record. Test fault injection ở storage adapter, không là
production flag/CLI nhận arbitrary code.

- [ ] RED: callback query attempt by input runId/principal; require exact claimed
      callId/campaign/owner ledger match, unique slot mapping; fail before fake
      invocation on missing/mismatch. Không query latest-created call.
- [ ] RED: persist callback_entered trước fake; storage fail → invocation0,
      runtime conservative hold có thể còn. Không tự settle0/cancel từ observer.
- [ ] RED: store capture fail sau fake return → original known-cost envelope
      vẫn về runtime settle; observer taints campaign in memory và coordinator
      blocks next slot; DB gap đủ để report/restart incomplete nếu blocked-state
      write cũng thất bại. Fake invoked exactly once.
- [ ] RED: count và timing giữa callback_entered/fake_return độc lập ledger claim;
      timeout/late return không tạo second call hoặc thay sealed outcome. Cho
      append late_return chỉ vào incomplete campaign như evidence bổ sung, không
      upgrade completeness hay reopen run.
- [ ] RED: bounded structural payload chỉ lưu schema validity/kind/usage/safe
      codes/hash, không raw question/reason/exception/provider body. Hash canonical
      data do builtin tạo, không enumerate getters/proxies từ external adapter.
- [ ] Run targeted integration test; implement observer without reserve/settle
      calls, then GREEN/commit. Assert public runtime parser/ledger vẫn unchanged.

### Task4 — Sequential HTTP coordinator qua authentication thật

**Files:** create coordinator; tests
`pilot-evaluation-coordinator.integration.test.ts`.

**Interface:** `runOfflineCampaign(OfflineRunInput)` verify freeze + DB marker,
claim campaign once, loop slots serially. Runtime API instances chỉ nhận fixture
readSheetsRequestFn, observed fake planner, `pilotLiveWriteEnabled:false`, worker/
engine/gateway/maintenance absent, host127.0.0.1 port0. Hai principals dùng hai
createApi instances với ApiConfig riêng và SessionStore mặc định, login thật;
không override authenticate/principalExists luôn true như helper test cũ.
Policy chung trong cùng slot phải có đúng principal bindings được freeze.
`listen()` trả base `/api/v1`; auth dùng base đó, pilot dùng URL origin +
`/pilot/v2`, không nối nhầm `/api/v1/pilot/v2`.

- [ ] RED: two actual password logins yield correct owner identities, cross-owner
      detail/reject denied qua instance của chính identity đó (B login ở B rồi
      truy cập run A); không dùng token A ở B để giả chứng minh owner isolation.
      Fake sessions/tokens chưa login bị chặn. Không log secrets.
- [ ] RED: verify same frozen per-slot config/source/policy mapped into API. Nếu
      config thay giữa slots, đóng instance cũ rồi tạo instance đúng slot descriptor;
      DB/source bindings vẫn fixed. Language eval metadata không giả làm API field.
- [ ] RED: before HTTP persist slot_intent; run submission interrupted/no runId
      → stop, không submit lại/retry sau restart. All claimed campaign states
      trừ frozen không được run lại; report-only vẫn được.
- [ ] RED: accepted HTTP payload có thể vẫn `status:'planning'`; phải đọc owner
      detail để lấy actual outcome/preview. Detail GET có lifecycle sweep, không
      dùng GET này trong report read-only/restart reconciliation.
- [ ] RED: successful plan ghi pre-cleanup awaiting_approval/preview hash; owner
      sends only `decision:'rejected'` với version/id/hash hiện tại. Đọc lại terminal
      status, không UPDATE runs trực tiếp. Failed reject/expired mismatch blocks next.
- [ ] RED: deterministic needs-input/refusal callback0; no-grant/cap callback0;
      out-of-scope lookup no HTTP lookup. No invocation mới nếu any unresolved call,
      hold, null cost/usage, failed settlement, conflict/overrun/halted hoặc event gap.
- [ ] RED: two eligible slots không concurrent; no business reservation/Trello
      POST, no provider factory imported. Trap exercised external clients, allow
      only owned loopback origins/routes; không gọi đây là network sandbox.
- [ ] Run targeted integration test; implement narrow coordinator. On shutdown
      close both APIs then store/runtime pools explicitly: ApiRuntime.close không
      close db pools. Không auto-drop durable campaign, không background tasks còn sống.
- [ ] GREEN/commit. Preserve actual precleanup outcome riêng với cleanup outcome.

### Task5 — Read-only structural grade/report và library entry

**Files:** create report/index; tests `pilot-evaluation-report.test.ts`,
`pilot-evaluation-report.integration.test.ts`.

**Interfaces:** `buildOfflineReport(ReadonlyEvaluationStore, StructuralOracle)`;
oracle is bounded data parsed **only at grading stage** after producer has stopped
and observations sealed. Runner knows hash only. StructuralOracle maps slotId
→ expected kind/status/schema outcomes; no equalization failed/refused. Regrade
records append with rubric+seal hashes qua explicit grader write store, không
trong read-only report operation. Export producer/grader/read-only capabilities
riêng, không cho report handle provision hoặc dispatch.

- [ ] RED: verify event chain/manifest/seal/ledger snapshot trước successful verdict;
      corrupt/missing/unknown/orphan yields INCOMPLETE/BLOCKED with exact safe codes.
      Incomplete seal is valid integrity snapshot, never successful reconciliation.
- [ ] RED: every selected slot in denominator; deterministic/out-of-scope not model
      pass; aborted/missing identity not dropped. Sum **all** ledger calls owned by
      campaign principals, including orphan, reconcile held/committed/status counts.
- [ ] RED: fake units/usage/timing always simulated; missing !=0; cleanup rejection
      not model refusal; no qualitative language/hallucination/citation claims.
      Provider latency/cost/AI quality marked NOT_RUN, not inferred from fake samples.
- [ ] RED: read-only role cannot write/seed/migrate; repeated report no state changes,
      no invoke/HTTP detail GET (vì GET đó sweep lifecycle). Late ledger update
      yields new read-only snapshot with prior seal
      referenced, never overwrites sealed observations or upgrades incomplete status.
- [ ] Implement report builder and explicit grade append path (`appendGrade` in
      restricted store with seal FK). `buildOfflineReport` does no grade writes.
      Unit + integration GREEN; commit exact files.

### Task6 — Fault gate, independent review và clean checkpoint

**Files:** add `pilot-evaluation-faults.integration.test.ts`; update only owned
API README subsection describing fake-only entrypoints, retention and limitations.

- [ ] RED→GREEN actual interruption tests: terminate producer child process after
      persisted intent/claim/capture/settle before seal using controlled fixture
      barriers. Report reconnect read-only shows gap/unknown and refuses run restart;
      không thay crash test bằng exception mà vẫn tuyên bố process recovery.
- [ ] Test two concurrent campaign start attempts, grant drift, broken role grants,
      cleanup rejection failure, missing usage known-cost and double-count defense.
      No application network beyond local API/DB; no holdout content.
- [ ] Run `npm run check` from root (new unit tests picked by API unit config).
- [ ] Run API new suites sequentially:
      `npm run test:integration -w @wap/api -- tests/pilot-evaluation-store.integration.test.ts tests/pilot-evaluation-observer.integration.test.ts tests/pilot-evaluation-coordinator.integration.test.ts tests/pilot-evaluation-report.integration.test.ts tests/pilot-evaluation-faults.integration.test.ts`.
- [ ] Run existing API `pilot-ai-admission.integration.test.ts` and
      `pilot-approval.integration.test.ts`, engine `ai-postgres-ledger.integration.test.ts`
      via corresponding `test:integration` scripts. No assuming old test counts.
- [ ] Independent read-only reviewer validates changed scope, all failure windows,
      exact accounting owner, SQL privileges and no excessive evidence claims;
      main reproduces fixes as needed. Zero findings is valid.
- [ ] Commit owned source/docs. New detached clean checkout: `npm ci`, `npm run check`,
      same new/existing PG suites and `git diff --check`; record exact SHA/status,
      commands/counts/logs and role/DB cleanup evidence. No dirty/.env/node_modules copy.
- [ ] Report only OFFLINE_MEASUREMENT_CONTRACT_TESTED with limitations. If DB setup,
      privilege tests/crash tests unavailable, mark precise NOT_RUN and block closure.

## Execution and acceptance handoff

Read-only scout audit `f4738083-a491-4f0c-94fe-06c141d5129d` xác nhận
single-principal SessionStore, pilot/auth URL paths, detail GET lifecycle sweep,
separate pool ownership và thiếu automatic SQL asset copy. Các giới hạn này đã
được đưa vào Tasks2–5; audit không chạy tests hay xác nhận runtime implementation.

Tại thời điểm duyệt plan chưa có code/DB objects Phase B. Approval cho phép
provision/integration tests tạo DBs/roles cô lập theo plan; không production
credentials hoặc objects. If test admin lacks role-create privilege, stop and ask,
not fall back to an admin runner or alter the existing demo DB.

Recommended: native **GPT-6 Sol High** one writer, Tasks1→6 sequentially, main
integration and independent read-only review. Freeze/store and runtime observation
are coupled enough that parallel writers add ownership risk. Exact total launches
remain within project budget; no automatic extra orchestrator.

Future transport/provider pricing/quota, zero-dollar admission compatibility,
semantic grading/prose retention, full dataset/holdout and live execution remain
separate approval gates. Implementation approval đã nhận; không thay approval riêng của các gate sau.
