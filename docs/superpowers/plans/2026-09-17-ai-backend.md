# AI backend implementation plan — AI-00 → AI-04

**Status:** `AI-00_OFFLINE_SLICE_IMPLEMENTED / API_RUNTIME_WIRED / LIVE_GATE_OPEN`; native runtime composition and durable accounting are implemented, while live quality/evaluation remains gated.
**Scope:** B/local; giữ nguyên engine/policy/approval/reconciliation contracts.

## AI-00 — design and gate

- [x] Đọc baseline, execution contract, engine planner seam, API planner mode,
      prompt builders, catalog và evaluation manifest.
- [x] Ghi design deep modules/seams: `PlannerPort`, reviewed catalog,
      `ToolRetriever`, `QueryExpansionPort`, `StructuredModelClient`,
      `AiPlannerAdapter`, `LocalReplanPort`, `EvaluationRunner`.
- [x] Ghi failure semantics: không fallback fixture, không bypass validator,
      không replan unknown write, approval mới sau thay đổi.
- [x] Chốt queue decision: PostgreSQL outbox vẫn là authority; BullMQ chỉ là
      transport tương lai nếu có quyết định riêng.
- [x] Người dùng xác nhận Terra, embedding large@1536/cosine, runtime secret
      injection với vault tùy chọn và PostgreSQL outbox/worker tuần tự.
- [ ] Xác minh API model ID/quyền truy cập, settings, pricing và numeric budgets;
      hoàn tất structured-output probe có sanitized evidence.
- [x] Người dùng duyệt tách offline implementation khỏi live integration;
      key bổ sung sau không chặn fake-client work.
- [x] Kiểm tra nhất quán design/plan/status sau khi tách gate; independent
      Code Reviewer chỉ ra thứ tự probe/live gate, đã làm rõ bounded probe
      là bước tạo bằng chứng trước live application integration/evaluation.

**Offline gate:** được chuẩn hóa reviewed catalog, tạo injectable interfaces,
fake model/embedding clients trong tests và unit tests; không credential,
provider/MCP calls, DB demo writes hoặc kích hoạt API AI mode. Credentials
không nằm trong plan hoặc evidence. Không hạ yêu cầu validation/policy.

**Live gate:** API access/schema/settings probe, numeric budgets và safe
credential delivery vẫn OPEN; phải hoàn tất trước live integration/evaluation.

### Đợt offline đầu tiên

Người dùng chọn làm tại checkout/nhánh hiện tại và sau đó cho phép main agent
tự triển khai, thay yêu cầu giao Luna trước đó. Không tự commit/push; giữ các
chỉnh sửa hiện có.

**Slice hiện tại — AI-00 IMPLEMENTED / AI-01 PARTIAL_MAIN_VERIFIED:** catalog,
ports, in-memory exact retrieval, provider-neutral fake planner orchestration
và pgvector reviewed-index adapter nằm trong `packages/engine/src/ai/`.
Migration `0007` và tests engine dùng database tạm riêng; không ghi DB demo.
Reviewer của foundation trước không chạy được vì usage limit; planner hardening
và AI-01 đã có review độc lập. Đây không phải chứng nhận production-ready.
Adapter đã được wire qua API AI runtime với explicit retrieval variant; semantic
modes chỉ dùng active index đã chuẩn bị và không fallback sang `all_tools`.
Native provider transport/codec và durable accounting đã có, nhưng không tự
thay thế engine validator/policy và chưa đóng live quality/evaluation gate.

1. Chuẩn hóa immutable reviewed catalog snapshot, canonical hash, kiểm duplicate
   tool/missing policy/catalog drift; không coi raw MCP DTO là reviewed policy.
2. Khai báo model/embedding ports không phụ thuộc SDK; scripted fake clients chỉ
   trong test utilities. Không thêm fallback fake vào production API.
3. Unit tests bằng vectors tổng hợp kiểm exact-cosine ranking, top-K, dimension
   mismatch, zero/non-finite vector và provenance mismatch. AI-01 sau đó thêm
   pgvector integration cô lập; cả hai không phải semantic-quality evidence.
4. Kiểm thử orchestration bằng fake client: plan/refusal/clarification, malformed
   output, bounded repair, timeout/cancel và không fallback.

`AiPlannerAdapter` đã triển khai phần offline của mục 4: retrieval → prompt →
strict `PlannerResultSchema` parse → engine validator + callback → bounded repair tối đa
3 calls; refusal/clarification trả trực tiếp, provider error không fallback,
deadline tổng (mặc định offline 60 giây, injectable) bao gồm retrieval và mọi
repair, có thể kết thúc chờ client không tuân thủ abort. Repair giữ catalog,
runtime và inputs của prompt gốc. Synchronous evidence sink tùy chọn nhận
metadata từng model call (success/error/cancel/timeout); không nhận raw prompt,
output hoặc error message. Sink lỗi thì fail closed; chưa persist DB evidence.
Unknown usage là null, không giả định chi phí bằng 0. Adapter chưa được nối API hoặc live
provider và chưa tự thay thế engine validator/policy.

Đợt hardening có 6 regression cases thất bại trước sửa và 16 planner tests pass
sau sửa/bổ sung edge cases; không suy diễn toàn bộ code cũ đều có TDD evidence.
Code Reviewer xác nhận lỗi exception nội bộ validator bị gửi vào repair;
đã sửa để chỉ candidate INVALID_PLAN được repair, callback exception dừng ngay.
AI-01 vẫn partial vì chưa có query expansion, embedding provider hoặc latency/
recall evaluation; AI-02 vẫn mở vì chưa provider runtime/live evidence.

Catalog constructor chỉ kiểm cấu trúc/snapshot. AI-01 `loadLocalReviewedCatalog`
chỉ gắn description từ manifest sau khi so schema/policy/side-effect với đủ
10 `EngineTool` đã được gateway review; manifest riêng lẻ không tạo capability.
Mỗi vector phải khớp catalog/content hashes và embedding provenance;
missing/duplicate/foreign, zero/non-finite và dimension khác 1536 bị reject.
`reviewed_*` tables tách khỏi raw `tools`, không có ANN index; activation dùng
transaction + advisory lock và chỉ một active index. `all_tools` không gọi
embedding; semantic query có cancel guard trước/sau await và deterministic tie-break.

## AI-01 — reviewed semantic retrieval

**Owner modules:** retrieval adapter, catalog snapshot/index, isolated tests.
**Không sửa:** engine approval/execute, frontend, raw MCP launch policy.

- [x] Chuẩn hóa reviewed catalog 8+2 thành `ReviewedCatalogSnapshot` có
      canonical hash.
- [x] Chọn và ghi rõ storage adapter: pgvector từ catalog snapshot, không query
      raw/unreviewed MCP metadata.
- [x] Exact cosine search; version embedding theo provider/model/dimension,
      preprocessing/content/catalog hashes; không trộn vector space. Validate
      snapshot mới trước atomic activation; migration mới nếu cần schema mới.
- [x] `all_tools` + `semantic` + `semantic_qe` đã có adapter exact; benchmark
      top-K 3/5/10 đã hoàn thành.
- [x] Không gọi biến thể semantic là hybrid/BM25.
- [x] Query expansion tối đa 6 intent, có usage/latency/cost riêng.
- [x] Test empty gold set, missing tool, duplicate tool, catalog drift và
      deterministic hash.
- [x] Gate p95 retrieval ≤500ms cho catalog 10 tool theo FR-NFR-02, ghi điều
      kiện đo; không suy rộng sang catalog lớn.

**Evidence:** snapshot hash, embedding metadata, retrieval rows, recall theo
case và latency report. Không có provider key trong artifact.

**AI-01 implementation evidence (isolated, not live-provider evaluation):**
`0007_ai_reviewed_catalog_index.sql` stores immutable per-user reviewed catalog
JSON, provenance-bound 1536-dimension indexes and vectors. An index is active
only after all catalog rows are written in one transaction; a model change
supersedes the old index atomically. Integration tests open both local MCP
gateways, build the exact 8+2 snapshot, persist ten synthetic vectors and run
exact cosine search. Separate concurrency test leaves exactly one active index.
`InMemoryToolRetriever` and `PgvectorToolRetriever` implement multi-query max-score
aggregation for `semantic_qe` with a 6-intent limit. Retrieval benchmark
verifies p95 latency ≤500ms for the 10 reviewed tools catalog (FR-NFR-02).

## AI-02 — provider planner and bounded repair

**Owner modules:** structured model adapter, AI planner orchestration, API mode
selection.
**Không sửa:** `PlannerResultSchema` để ép output provider.

- [x] Implement fake `StructuredModelClient` trước live adapter.
- [x] Implement native live provider adapters/codecs sau provider/model contract
      probe; live account access, budget approval and quality evaluation remain
      separate gates.
- [x] Nối retrieval output vào `buildPlanningPrompt`.
- [x] Parse strict `PlannerResultSchema`; refusal/clarification không tạo
      version/approval.
- [x] Implement bounded repair tối đa tổng 3 planning calls; ghi từng issue,
      prompt hash, usage, latency và cost.
- [x] Provider error không fallback `DEV_FIXTURE_PLANNER`.
- [x] Deadline tổng bao phủ retrieval/QE/model/repair/backoff; explicit SDK
      retry budget, tách queue wait/service time và loại bỏ late response khi
      cancel/timeout. Test không tạo version từ response đã stale.
- [ ] Secret launcher prompt ẩn hoặc optional vault; backend-only injection,
      MCP child environment allowlist và canary-redaction tests không key thật.
- [x] API configuration phải tách explicit `dev_fixture`, `ai`, `disabled`;
      default không được âm thầm gọi mạng.
- [x] Tests: valid plan, refusal, clarification, malformed JSON, invalid plan,
      repair success/exhaustion, timeout, provider error, prompt injection data.

**Gate:** API loopback với fake model PASS; live provider chỉ được claim sau
structured-output probe và sanitized evidence.

## AI-03 — local replan

**Owner modules:** engine replan orchestration, AI replan adapter, version/
approval evidence.
**Không sửa:** unknown-write semantics thành retryable.

- [x] Map failed attempt certainty và completed steps trước khi gọi AI.
- [x] Reject replan nếu write đã dispatch nhưng certainty unknown.
- [x] Gọi `LocalReplanPort` với scope local, max 2, completed outputs và failed
      approaches đã redacted.
- [x] Giữ nguyên successful steps/operations; chỉ cấp operation mới cho phần
      chưa chắc chắn và chưa hoàn tất.
- [x] Validate plan, snapshot, catalog/policy/artifact hash trước preview mới.
- [x] Supersede approval cũ và yêu cầu approval mới.
- [x] Events/trace phải ghi replan count, changed steps, old/new version và
      approval tuple.
- [x] Tests: safe read failure, changed args, changed tool, changed read data,
      second replan limit, unknown write, already-successful write, cancel and
      expiry race.

**Gate:** không có blind write replay; mọi replan live result phải có new
preview/approval evidence.

## AI-04 — evaluation and final backend gate

- [ ] Preserve split `b01–b06` development / `b07–b10` holdout ngay từ đầu;
      chỉ tune trên dev, freeze provider/prompt/settings trước holdout.
- [ ] Freeze catalog/dataset/prompt/model/provider/embedding hashes.
- [ ] Run `all_tools`, `semantic`, `semantic_qe`; top-K 3/5/10; three
      repetitions per case/variant as manifest requires.
- [ ] Label top-K=10 là all-tools control; repetitions không phải các nhiệm
      vụ độc lập. Không dùng holdout để tune rồi báo như untouched evaluation.
- [ ] Report plan validity, task correctness, refusal/clarification,
      retrieval recall, recovery correctness, total cost and end-to-end latency.
- [ ] Assert 0 extra/unapproved writes, 0 dry-run writes and 0 blind retry of
      unknown writes.
- [ ] Run API + DB + MCP positive/negative/fault matrix with provider mode
      explicit; retain `DEV_FIXTURE` and live AI evidence separately.
- [ ] Re-run `npm run check`, backend integrations, API gate and isolated AI
      tests; document skipped capability-dependent cases.
- [ ] Update `docs/G1-RUBRIC-MAP.md` only from official rubric and representative
      work evidence; never infer a score from technical tests.

**Final verdict options:** `AI_TECHNICAL_PASS`, `AI_EVALUATION_PARTIAL`, or
`AI_EVALUATION_NOT_RUN`. Overall G1 remains `PARTIAL` until rubric and
representative work are supplied.

## Commands planned for the implementation gates

```powershell
npm run check
npm run test:unit -w @wap/api
npm run test:integration -w @wap/api
npm run check:api
# AI-specific commands will be added only with the provider adapter and manifest.
```

No command in this plan is evidence of AI quality until it records the required
provider/model/catalog/dataset provenance.
