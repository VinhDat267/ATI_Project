# Pilot v2 — Phase B offline campaign harness design

**Status: DESIGN_APPROVED — 2026-09-27.** Chủ project trả lời “duyệt” cho
thiết kế Phase B này; bước tiếp là lập implementation plan để duyệt trước code.
Không cho phép gọi provider, dùng dữ liệu khách, phát sinh phí hoặc ghi SaaS.

## 1. Mục tiêu và ranh giới

Xây một harness campaign **fake-only**, có freeze, observation bền vững và
report đối chiếu ledger, sử dụng chính API admission đã kiểm thay vì viết lại
quyền/budget trong một evaluation engine riêng.

Phase A checkpoint `049cdfe` đã có advisory context/projection và regression
fake/HTTP/PG; bằng chứng trước đó: clean `npm run check`, API52/52, ledger6/6.
Không chạy lại test trong batch thiết kế này. Phase B chỉ nghiệm thu **measurement
plumbing/structural metrics**, không phải AI quality hay provider readiness.

Giữ [baseline](../../BASELINE.md), [execution contract](../../EXECUTION-CONTRACT.md),
[dataset contract](../../MVP-V2-DATASET.md) và
[advisory-first direction](../plans/2026-09-27-pilot-v2-evaluation-readiness-proposal.md).
Các mục tiêu full v2 trong spec (semantic/QE, manual/fixed/AI, facts/args,
customer acceptance) không bị xóa, chỉ chưa đo ở batch này.

### Ba cách triển khai đã cân nhắc

| Cách | Lợi ích | Rủi ro / quyết định |
|---|---|---|
| **API composition cô lập + observer wrapper** | Kiểm đúng auth/admission/claim/settle, không lặp logic production | Chậm hơn unit runner, cần lifecycle cleanup; **đề xuất chọn** |
| Engine-only runner riêng | Nhỏ, dễ loop nhiều cases | Có thể né grant/owner và khác hành vi API; không chọn làm evidence runtime |
| Thêm measurement hooks vào production router | Có đầy đủ event ở mọi điểm | Tăng attack surface/retention, thay contract runtime khi chưa cần; defer |

## 2. Kiến trúc đề xuất

```text
reviewed synthetic fixture + oracle (control/grader side only)
  -> strict projection + predeclared route/eligibility table
  -> frozen fake-only manifest
  -> sequential coordinator -> real loopback createApi HTTP lifecycle
       -> persisted intake -> existing admission/claim
       -> observer wrapper -> hard-coded fake adapter
       -> existing runtime settle/outcome
  -> reconcile DB + append sealed measurement
  -> independent grading phase -> structural report
```

Runner không được nhận arbitrary callback từ CLI hoặc dynamic import provider.
Chỉ có builtin fake adapter registry và `executionMode: offline_fake`; schema
reject mọi mode khác. Không đọc API key, không import real transport factory,
không sửa `main.ts` và không thêm `--execute` ở batch này.

Sheets intake inject fixture; Trello effects bị fail-closed, write flag false.
Coordinator chỉ gọi login, submit run, owner detail và owner **reject** approval;
không gọi server/tool connectivity, UC3 Trello read hoặc approval `approved`.
Tests phải kiểm đúng exercised HTTP clients và adapter counters. Fetch spy
không được mô tả là network sandbox hoặc chứng minh mọi transport bị chặn.

## 3. Campaign identity, DB và quyền

Một campaign measurement = một database evaluator mới, riêng, một coordinator,
không dùng DB demo/API hiện có. Không chia dữ liệu của nhiều campaign vào cùng
DB trong phiên bản này: tránh reset/reuse principal-bound call caps.

`measurementId` là UUID khác với accounting campaign
`pilot-v2:<principalId>` bị ràng buộc bởi migration0013. Mapping bất biến:

`measurementId -> fixturePrincipalAlias -> principalId -> accountingCampaignId`

và từng slot:

`measurementId + slotId -> runId -> pilot_ai_attempts.call_id -> ai_provider_calls.call_id`.

Hai principal tổng hợp phục vụ owner-isolation negative controls, không phải
hai người dùng/customer thật. Các record không bị đổi principal để vượt cap.
Grant và campaign limit tính fake accounting units, ghi rõ không phải tiền đã
thu. B/local provider call tables là nguồn sự thật accounting; evaluator không
cộng trừ hold, reset call count hoặc thay status trực tiếp.

Bootstrap/migration dùng credential chỉ của hạ tầng test cô lập, ngoài runner.
Runner không nhận superuser/CREATEDB credential; role chỉ được cấp quyền cần
thiết trên evaluator DB. Kiểm marker measurementId/schema version/random nonce
và DB identity trước tạo schema/seed hoặc run. Prefix DB name **không đủ**.
Không đổi quyền của DB hiện có để làm bootstrap chạy được. Nếu không provision
được isolation này thì dừng ở setup blocker, không fallback sang demo DB.

Evaluator schema có phiên bản riêng, chỉ cài trên DB đã xác minh marker; không
thêm bảng measurement vào migration production/global trong Phase B. Không
seed hay migrate khi lệnh chỉ có nhiệm vụ đọc report.

## 4. Manifest freeze

Manifest strict, canonical JSON + SHA-256; lưu full canonical bytes trong
measurement campaign row trước attempt. Hash là tamper evidence, không là chữ
ký chống DB admin. Mọi thay đổi field frozen tạo measurementId/DB mới.

Các trường bắt buộc:

- Version; exact clean Git commit + relevant code/projection/prompt/schema hashes.
- `executionMode=offline_fake`, `outputContract=pilot-advisory-v1`, fixed-catalog.
- Fixture source hashes/version; synthetic origin; per-slot input hashes,
  ordering, language, principal mapping, route classification và eligibility.
- Frozen config/policy/resource mapping cho từng slot; không lấy board/list
  từ model output; ánh xạ nhiều resource không được tùy tiện chọn sau response.
- Fake adapter script/version/hash, metadata `provider` hợp lệ theo ledger và
  `model=offline-fixture-*`; trường metadata không ngụ ý gọi provider đó thật.
- Call caps, integer reserve/settle unit caps, timeout <=30000ms, no retry;
  `costEvidence=SIMULATED_NOT_BILLED`, không price card thật hay claims0USD actual.
- Observation schema, rubric/version, denominator rules, handling of aborted
  cases, retention/access và zero-write/no-approval constraints.

Không đóng băng wall-clock outcome/latency vào input. Runtime request hash chứa
run/version IDs nên khác giữa runs; lưu riêng canonical model-context hash và
runtime request hash, không normalize away business source inputs.

Eligibility/route table được chốt trước output, từ input/policy/checklist hoặc
reviewed mapping riêng. Không branch theo `expected`, case labels hay `fault`
trong invocation. Controller fault schedules chỉ dùng cho fault tests và được
freeze ngoài callback input. Fixture fake responses cố định độc lập oracle;
fake pass rate chỉ là plumbing self-check, tuyệt đối không model accuracy.

Bản đầu dùng synthetic test matrix tự tạo. Không đọc/tuning holdout; full public40/
holdout20 execution mapping và trạng thái unseen cần duyệt trước campaign thật.
Slot lookup ngoài narrow advisory ghi `OUT_OF_SCOPE_ROUTE`, không ép qua planner.

## 5. Observation store: ít dữ liệu nhưng đủ đối chiếu

Đề xuất tables trong evaluator-only schema:

1. `campaigns`: manifest bytes/hash, DB marker, state
   `frozen|running|completed|incomplete|blocked`, created/sealed timestamps.
2. `slots`: ordinal/opaque slotId, projectedInputHash, predeclared eligibility,
   principal mapping, optional runId, pre-cleanup application status và
   post-cleanup status; unique `(measurementId, slotId)`.
3. `events`: append-only seq/eventType + strict payload + previous/event hashes;
   optional exact callId/runId, timestamps/durations và producer version.
4. `seals`: unique immutable per-slot seal referencing event range and ledger
   snapshot hash; campaign seal includes every selected slot, including not-run.
   Seal có `completeness=complete|incomplete`: held/orphan/missing evidence chỉ
   được seal snapshot **incomplete/blocked**, không được tuyên bố reconciliation
   success. Hash integrity không tương đương data completeness hoặc test pass.
5. `grades`: rubric hash + slot seal hash + grade/safe reason enum; grader phase
   only sau sealing. Regrade append version mới, không sửa observation.

Giữ branch, valid/invalid schema, safe failure enum, usage nullable, cost/hold/
status từ ledger, call timing, proposal digest và actual callback count.
**Không giữ raw question/reason, raw exception, credential, request headers hoặc
provider response body.** Structural extraction/hash dùng data-only input
bounded; không gọi arbitrary `toJSON` hay getters từ object adapter.

Do không lưu prose, Phase B không đo clarification specificity, refusal semantic
correctness, citations, hallucination chi tiết hoặc ngôn ngữ. Nếu cần semantic
review ở pha live sau này, phải thiết kế explicit sanitized artifact store,
retention/ACL và approval mới; không lén dùng public outcome table để giữ prose.
Digest chỉ hỗ trợ ràng buộc observation, không cho grader khôi phục raw answer.

SQL privileges/constraints cấm update/delete sealed observations trong runner
role; campaign state chuyển qua store transaction có kiểm điều kiện. Hash chain
không chống admin có quyền rewrite toàn DB, phải ghi giới hạn này trong report.

## 6. Lifecycle và observation failure semantics

1. Validate manifest + DB marker + grant/caps + no pending hold trước từng slot.
   Chỉ một active run toàn DB theo router hiện có; không parallel submit.
2. Submit qua HTTP thật. Trong wrapper, input đã có `runId/principalId`.
   Query exact `pilot_ai_attempts` (runId là PK, callId unique ở migration0013),
   join ledger với campaign/owner/run đúng; yêu cầu `dispatch_claimed` và callId
   non-null. Pin callId cho mọi event; không lấy “latest call”.
3. Append `callback_entered` bền vững **trước** fake invocation. Đây không phải
   chứng minh provider packet đã gửi. Thiếu/mâu thuẫn linkage hoặc persist fail:
   không invoke fake; throw lỗi cố định. Runtime có thể giữ hold bảo thủ vì
   claim đã xảy ra; evaluator không tự chuyển thành zero cost để giải hold.
4. Fake invocation đúng một lần. Capture bounded structural return trước khi
   trả nguyên envelope cho runtime settle. Persist failure **sau** fake return
   không được gây call lại hoặc làm mất envelope known cost: giữ result để
   runtime xử lý, coordinator đánh dấu observation gap và dừng campaign.
   Nếu DB outage không ghi được trạng thái blocked, missing seal/event vẫn
   khiến report incomplete và restart không được dispatch.
5. Sau HTTP, đối chiếu runtime outcome/attempt/call/hold. Không coi terminal run
   status là settled cost. Unknown usage hoặc cost, held reservation, conflict,
   overrun, missing event, manifest drift đều chặn slot kế tiếp.
6. Với awaiting_approval: lưu status/preview hash **trước cleanup**, dùng đúng
   owner gọi approval `rejected` để kết thúc. Router cho rejected khi live write
   false; validate owner/version/hash/TTL vẫn giữ. Không gửi approved, không
   trực tiếp UPDATE runs/approvals. Cleanup reject/expiry failure chặn tiến độ;
   rejection không được báo là model refusal hoặc accounting settlement.
7. Seal sau reconciliation và cleanup quan sát được. Case error/ineligible vẫn
   có row, safe reason và denominator; không xóa case để report trông tốt hơn.
   Persist slot intent trước HTTP submit. Nếu mất response/runId và không có
   callback để pin identity, không submit lại: stop và báo unlinked run/slot.
   Reconciliation tính mọi call trong accounting campaign, kể cả orphan chưa
   ghép slot; không đoán kết quả hoặc bỏ chi phí chỉ vì thiếu HTTP response.

Crash/timeout: toàn measurement `incomplete/blocked`, không auto-resume case
hoặc campaign. Restart chỉ cho **report/reconcile read-only**; không đọc lại
projection để redispatch. Late runtime settlement có thể được phản ánh trong
report snapshot mới, không sửa sealed event cũ hoặc giả định rollback charge.
Nếu process chết giữa response và persist, gap giữ UNKNOWN/missing evidence.
Envelope giữ trong RAM không phải crash recovery; persisted slot intent có
submission không chắc chắn luôn chặn dispatch sau restart, kể cả chưa có runId.

## 7. Structural grader và report

Invocation module chỉ nhận projection/config; grader nhận oracle và sealed
observations **sau** kết thúc invocation. Đây là module/data-flow separation,
không tuyên bố OS sandbox nếu cùng process còn quyền đọc dataset. Test đổi
excluded metadata phải không đổi payload/adapter behavior; source sensitivity
phải giữ. Không dùng P6 `runPilotQualityEvaluation` để sản xuất observation.

Báo riêng các tầng:

- Selected slots; model-eligible / deterministic-only / out-of-scope / blocked /
  not-attempted. Giữ n/N theo language/principal/route, kể cả campaign dừng.
- Claim count, actual fake invocation count, valid/invalid output và errors;
  khác biệt claim/invoke được ghi, không suy call charge từ status HTTP.
- Proposal kind so với structural oracle; API pre-cleanup outcome; cleanup riêng.
  Không dùng `failed == refused` để tạo pass.
- Runtime accounting totals từ tất cả call rows, including failures;
  fake usage/cost luôn gắn nhãn SIMULATED, missing không đổi thành0.
- Timing fake callback/application/report chỉ là local harness timing, không
  provider median/p95 hoặc model performance.
- Safety counters: unauthorized calls/writes, preapproval writes, wrong-target,
  retry, metadata leakage và accounting mismatch. Bất kỳ vi phạm chặn success.

Report thành công chỉ là `OFFLINE_MEASUREMENT_CONTRACT_TESTED`.
Không phát `AI_QUALITY_MEASURED`, không áp ngưỡng90% model để chốt G5,
không dùng zero fake writes làm bằng chứng write execution đúng trên SaaS.
Human grading/semantic output retention và thresholds là phase sau.

## 8. Proposed module boundaries (chưa tạo code)

Đặt composition trong `apps/api/src/pilot-evaluation/` để dùng API seam mà
không tạo dependency engine→app:

- `manifest.ts`: strict schema/canonical hashes/validation.
- `store.ts` + `schema.sql`: evaluator-only append/seal/state transaction.
- `fake-adapter.ts`: registry fake script, counters và no live imports.
- `observer.ts`: exact attempt linkage + structural events, failure semantics.
- `coordinator.ts`: sequential HTTP orchestration + stop/owner-reject cleanup.
- `report.ts`: read-only reconciliation/structural grading/seal references.

CLI/entrypoint nếu thêm chỉ có offline commands, không nhận arbitrary module,
provider config hoặc URL ngoài loopback. DB bootstrap thiết kế riêng trong
implementation plan, không tái sử dụng test fixture có auto-drop để làm durable
campaign runner. Integration tests vẫn dùng random DB và cleanup của fixture;
evidence campaign DB giữ lại cho tới operator duyệt cleanup sau export.

Không tạo cả hệ thống lớn trong một task: triển khai freeze/store trước,
observer/coordinator sau, report/fault matrix cuối; mỗi phần có RED→GREEN riêng.

## 9. Acceptance và failure matrix bắt buộc

- Freeze mutation ở từng cấu hình/token/call/unit cap, input/order/adapter/rubric
  hash → chặn trước callback. Forbidden mode/import/target DB → fail closed.
- Wrong principal/call/run/campaign linkage, duplicate callId, grant revoke,
  insufficient cap → không additional invocation, bằng chứng lỗi cố định.
- Observer write fail trước fake; sau fake trước settle; sau settle trước seal;
  crash sau claim; timeout + late result → có gap/hold phù hợp, không redispatch.
- Two eligible slots sequential: pre-cleanup awaiting approval, owner rejection,
  next slot chỉ chạy khi no active run và no unresolved accounting.
- Missing usage với cost biết hoặc không biết → report UNKNOWN và stop policy
  của evaluator; không sửa existing ledger settlement semantics để vừa report. Existing ledger
  không tự halt mọi null-cost outcome: evaluator stop gate phải kiểm held calls
  và uncertain attempts, không chỉ `campaign.halted`.
- Corrupt event/seal/manifest → report từ chối final pass; grades không đọc
  observations chưa seal và không đổi expected để đạt success.
- Bypass/refusal/needs-input, off-scope lookup và campaign abort → denominator
  đầy đủ; data projection không có oracle labels; không đọc holdout để tune.
- Cross-owner detail/rejection bị chặn; zero business reservation/Trello POST;
  all error/output evidence sanitised, public API outcome vẫn fixed message.
- Clean checkout `npm ci`, `npm run check`, new isolated PG/HTTP fault tests,
  existing pilot integration + provider-ledger regression; independent review.

## 10. Các gate sau Phase B

Provider adapter thực, pricing/quota/token caps, zero-dollar/positive-estimate
compatibility, single-owner transport accounting, data upload/retention,
user rubric/grader, holdout history và
public40 coverage mapping vẫn cần spec/approval riêng. Không dùng model của
coding subagent làm model ứng dụng. Không cài provider vào production launcher. Đặc biệt không nest `createAiPorts`
transport ledger reserve vào pilot admission đã reserve: future live adapter
phải có một owner reservation/settlement cho mỗi physical attempt, cần thiết
kế riêng trước khi tái dùng registry.

Read-only audit `scout` (`e10035ca-912e-43b1-89d2-6258cef8f5a2`) đối chiếu
principal campaign binding, active-run gate, observer linkage, unknown-hold stop
và fake accounting; không chạy tests/network/DB. Main đối chiếu source và paths;
những modules/tables trên chưa được tạo hay kiểm chứng runtime.

**Quyết định đã duyệt:** API-composition isolated/fake-only và Phase B chỉ
structural plumbing, không lưu model prose. Implementation plan là gate tiếp
trước code; các modules/tables vẫn chưa được triển khai.
