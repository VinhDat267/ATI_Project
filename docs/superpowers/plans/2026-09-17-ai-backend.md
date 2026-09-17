# AI backend implementation plan — AI-00 → AI-04

**Status:** `AI-00_IN_PROGRESS`; runtime AI chưa được triển khai.
**Scope:** B/local; giữ nguyên engine/policy/approval/reconciliation contracts.

## AI-00 — design and gate

- [x] Đọc baseline, execution contract, engine planner seam, API planner mode,
      prompt builders, catalog và evaluation manifest.
- [x] Ghi design deep modules/seams: `PlannerPort`, reviewed catalog,
      `ToolRetriever`, `QueryExpansionPort`, `StructuredModelClient`,
      `AiPlannerAdapter`, `LocalReplanPort`, `EvaluationRunner`.
- [x] Ghi failure semantics: không fallback fixture, không bypass validator,
      không replan unknown write, approval mới sau thay đổi.
- [x] Ghi queue proposal: PostgreSQL outbox vẫn là authority; BullMQ chỉ là
      transport tương lai nếu có quyết định riêng.
- [ ] Chọn provider/model/embedding và hoàn tất structured-output probe.
- [ ] Reviewer chuyển design từ `DRAFT_FOR_REVIEW` sang
      `APPROVED_FOR_IMPLEMENTATION`.

**Gate:** chưa sửa runtime AI trước khi bốn mục chưa hoàn thành được giải
quyết. Credentials không nằm trong plan hoặc evidence.

## AI-01 — reviewed semantic retrieval

**Owner modules:** retrieval adapter, catalog snapshot/index, isolated tests.
**Không sửa:** engine approval/execute, frontend, raw MCP launch policy.

- [ ] Chuẩn hóa reviewed catalog 8+2 thành `ReviewedCatalogSnapshot` có
      canonical hash.
- [ ] Chọn và ghi rõ storage adapter: pgvector từ catalog snapshot, không query
      raw/unreviewed MCP metadata.
- [ ] Implement `all_tools`, `semantic`, `semantic_qe` với top-K 3/5/10.
- [ ] Không gọi biến thể semantic là hybrid/BM25.
- [ ] Query expansion tối đa 6 intent, có usage/latency/cost riêng.
- [ ] Test empty gold set, missing tool, duplicate tool, catalog drift và
      deterministic hash.
- [ ] Gate p95 retrieval ≤500ms cho catalog 10 tool theo FR-NFR-02, ghi điều
      kiện đo; không suy rộng sang catalog lớn.

**Evidence:** snapshot hash, embedding metadata, retrieval rows, recall theo
case và latency report. Không có provider key trong artifact.

## AI-02 — provider planner and bounded repair

**Owner modules:** structured model adapter, AI planner orchestration, API mode
selection.
**Không sửa:** `PlannerResultSchema` để ép output provider.

- [ ] Implement fake `StructuredModelClient` trước live adapter.
- [ ] Implement live provider adapter sau provider/model probe.
- [ ] Nối retrieval output vào `buildPlanningPrompt`.
- [ ] Parse strict `PlannerResultSchema`; refusal/clarification không tạo
      version/approval.
- [ ] Implement bounded repair tối đa tổng 3 planning calls; ghi từng issue,
      prompt hash, usage, latency và cost.
- [ ] Provider error không fallback `DEV_FIXTURE_PLANNER`.
- [ ] API configuration phải tách explicit `dev_fixture`, `ai`, `disabled`;
      default không được âm thầm gọi mạng.
- [ ] Tests: valid plan, refusal, clarification, malformed JSON, invalid plan,
      repair success/exhaustion, timeout, provider error, prompt injection data.

**Gate:** API loopback với fake model PASS; live provider chỉ được claim sau
structured-output probe và sanitized evidence.

## AI-03 — local replan

**Owner modules:** engine replan orchestration, AI replan adapter, version/
approval evidence.
**Không sửa:** unknown-write semantics thành retryable.

- [ ] Map failed attempt certainty và completed steps trước khi gọi AI.
- [ ] Reject replan nếu write đã dispatch nhưng certainty unknown.
- [ ] Gọi `LocalReplanPort` với scope local, max 2, completed outputs và failed
      approaches đã redacted.
- [ ] Giữ nguyên successful steps/operations; chỉ cấp operation mới cho phần
      chưa chắc chắn và chưa hoàn tất.
- [ ] Validate plan, snapshot, catalog/policy/artifact hash trước preview mới.
- [ ] Supersede approval cũ và yêu cầu approval mới.
- [ ] Events/trace phải ghi replan count, changed steps, old/new version và
      approval tuple.
- [ ] Tests: safe read failure, changed args, changed tool, changed read data,
      second replan limit, unknown write, already-successful write, cancel and
      expiry race.

**Gate:** không có blind write replay; mọi replan live result phải có new
preview/approval evidence.

## AI-04 — evaluation and final backend gate

- [ ] Freeze `b01–b06` development and `b07–b10` holdout after provider/prompt
      changes.
- [ ] Freeze catalog/dataset/prompt/model/provider/embedding hashes.
- [ ] Run `all_tools`, `semantic`, `semantic_qe`; top-K 3/5/10; three
      repetitions per case/variant as manifest requires.
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
