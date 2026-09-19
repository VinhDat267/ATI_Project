# AI/main Integration and T4 Closure — Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` task-by-task in the current checkout, honoring the user's direct implementation preference. Independent Code Reviewer reviews the completed sensitive changes under AGENTS.md. This document authorizes no execution by itself.

**Status:** IMPLEMENTED — execution and regression closure completed 2026-09-19. Tasks 1–5 and Task 6 evidence are committed; the complete engine integration suite passes 93/93 when run serially against the isolated PostgreSQL fixtures. Paid provider execution remains intentionally blocked pending T6/T8.

**Goal:** Tích hợp AI backend đã lưu trên nhánh riêng với main hiện hành, sửa các khoảng trống T4 có bằng chứng, đạt regression gates để bắt đầu T5.

**Architecture:** Giữ engine ports/DSL và PostgreSQL outbox hiện tại. Tách composition AI khỏi main để kiểm thử bằng fake transport, chặn paid runtime cho tới durable authorization/accounting T6. Pgvector giữ một active index/user/catalog và bổ sung fingerprint/currentness cho một phiên planning hoặc replan.

**Tech Stack:** TypeScript, Node `^22.12.0 || >=24.0.0`, Vitest 4.1.11, PostgreSQL 16 + pgvector, native fetch, PowerShell; không thêm runtime dependency.

**Spec:** `docs/BASELINE.md`, `docs/EXECUTION-CONTRACT.md`; AI requirements đọc từ `2a42c0f:docs/superpowers/specs/2026-09-19-ai-multi-provider-design.md` và `2a42c0f:docs/superpowers/plans/2026-09-18-ai-live-evaluation.md`. Sau integration hai file này phải có trên checkout. Plan này cụ thể hóa integration/T4; T5–T8 tiếp tục theo live-evaluation plan.

## 1. Baseline đã xác minh và phạm vi

| Nội dung | Bằng chứng tại thời điểm lập plan |
|---|---|
| Checkout | main, HEAD `53fb536`; sạch trước khi tạo plan này |
| AI source | fix/api-audit-20260915, commit `2a42c0f`, 105 files thay đổi gồm AI/evidence/port config |
| Common ancestor | `d3c44f4691191f8f8735491d23653f942fb45d1b` |
| Divergence | main thêm 36 commits; nhánh AI thêm 1 commit |
| T4 trên main | Chưa có; main vẫn gọi `loadAiPlanner({ root })` |
| Paid gate trong AI commit | main.ts tạo ledger in-memory cap 20,000,000 micros và ports trực tiếp; chưa gọi assertAiLiveApproval |
| Embedding Gemini 001 | formatter gọi template.replace, trong khi template là RETRIEVAL_DOCUMENT/QUERY không có `{content}`; mất text đầu vào |
| Index currentness | activeIndex trả id/provenance; search dùng index_id, chưa fingerprint vectors hoặc phát hiện supersession trong request |

Không suy luận tất cả T4 đã hoàn tất chỉ từ các tests cũ pass. Các kết quả cũ là lịch sử; chỉ kết quả trên cây tích hợp mới nghiệm thu regression.

Đợt này gồm integration, sửa T4, verification và tài liệu. Không triển khai UI mới, T5 scorer, T6 campaign runner hoặc live evaluation. Phần T5 ở cuối là bàn giao kế tiếp.

## 2. Global constraints

- B/local: tối đa 10 reviewed tools, task_hub 8 + filesystem 2; filesystem theo launch policy, không ép bật.
- Một worker tuần tự; tối đa 3 planning calls gồm lần đầu, local replan tối đa 2; không tự resume, không đổi fallback model.
- Giữ owner/version/lease/currentness, immutable preview, approval TTL 10 phút và reconciliation cho unknown writes.
- Không dùng API keys thật; test với canary/fake fetch, không truy cập credential Codex.
- Không tự build catalog tại startup hoặc request. Paid preparation CLI thuộc T6/T8.
- Giữ toàn bộ frontend/API/security tests mới trên main; không chọn nguyên file ours/theirs để giải quyết xung đột ngữ nghĩa.
- Giữ evidence lịch sử, kể cả INVALIDATED; tạo báo cáo mới riêng. Không đổi nhãn lịch sử thành PASS.
- Không reset database/volume. Migration chỉ kiểm trên database test độc lập; không migrate demo trong đợt này.
- Không push hoặc sửa lịch sử commit. Commit thực thi theo checkpoint sau khi người dùng giao triển khai; hiện chỉ tạo plan.

## 3. Review focus

1. Key có mặt nhưng chưa có durable authorization: zero network, kể cả restart — Task 2.
2. Text khác nhau cho Gemini 001/document/query: request body phải mang đúng text — Task 3.
3. Index B thay A trong lúc QE/model đang chờ: kết quả A không được dùng tạo plan/preview — Task 4–5.
4. Key canary xuất hiện trong completed outputs/error context: không tới provider, trace, child env — Task 5.
5. Integration không conflict text nhưng làm mất check:web, security tests hoặc sai DB port của browser runner — Task 1, 6.

## 4. File map

| Files | Trách nhiệm |
|---|---|
| package.json, .gitignore, compose.g1.yaml, docs hiện hành | Kết hợp scripts/config hai nhánh; bảo toàn WEB-03 |
| apps/api/src/ai-runtime.ts (new), main.ts, ai-planner.ts | Composition có injection, pin phiên AI, redaction, paid dispatch deny |
| packages/engine/src/ai/providers/approval.ts, registry.ts | Per-call authorization seam và đúng request body |
| packages/engine/src/ai/embedding-policy.ts, catalog-embedding.ts | Versioned policy manifest, canonical text và validated rows |
| packages/engine/src/ai/pgvector-index.ts, retrieval.ts | Fingerprint persisted vectors; kiểm currentness và provenance |
| db/migrations/0008_ai_embedding_fingerprints.sql (new) | Lưu fingerprint/manifest/text hash, giữ unique active index từ 0007 |
| packages/engine/src/ai/index.ts, packages/engine/src/index.ts | Exports của contracts bổ sung |
| packages/engine/tests/ai-provider-{approval,clients,config}.test.ts | Paid deny, profile routing, embedding content |
| packages/engine/tests/ai-live-index.integration.test.ts, ai-pgvector.integration.test.ts | Provenance và race với DB cô lập |
| apps/api/tests/ai-runtime.test.ts (new), ai-planner-http.test.ts | Production composition qua transport giả |
| packages/engine/tests/ai-replan.integration.test.ts | Replan/currentness và lease regressions |
| docs/ai-evidence/AI-T4-INTEGRATION-2026-09-19.md (new) | Findings, commands, counts, limitations, final SHA |

Migration bổ sung là thay đổi có lý do so với mong muốn ban đầu không thêm migration: 0007 hiện không lưu vector fingerprint hoặc policy manifest. Không sửa checksum migration cũ, không thêm multi-active schema. Executor phải xác nhận 0008 còn trống trước khi tạo; nếu main đã có migration mới thì chọn số kế tiếp và ghi lại trong report.

## Task 1 — Tích hợp hai lịch sử, giữ frontend hiện hành

**Files:** package.json, .gitignore và các path thực sự overlap theo git diff; README/status theo trạng thái đã xác minh.

- [ ] Chụp HEAD, branch, status và merge-base. Nếu SHA khác baseline, cập nhật overlap trước khi tiếp tục.
- [ ] Lưu plan vào commit tài liệu khi bắt đầu thực thi để working tree sạch; bảo toàn mọi thay đổi người dùng phát sinh sau plan.
- [ ] Chọn merge thông thường để giữ ancestry của `2a42c0f`, không cherry-pick rồi xóa branch. Chạy khi implementation được giao:

```powershell
git status --short
git rev-parse HEAD
git merge-base main fix/api-audit-20260915
git diff --name-only d3c44f4691191f8f8735491d23653f942fb45d1b main
git diff --name-only d3c44f4691191f8f8735491d23653f942fb45d1b fix/api-audit-20260915
git merge --no-ff --no-commit fix/api-audit-20260915
```

- [ ] Kết hợp package scripts: giữ `check:web` và `check:full` của main, thêm `ai:eval:offline`; giữ lockfile/dependency versions hiện hành.
- [ ] Hai path cùng thay đổi trên cả hai nhánh đã xác minh là `.gitignore` và `package.json`. Giữ ignore `/docs/web-evidence/**/` và một entry `.codegraph/`; AI không thay dependencies hoặc lockfile. Overlap ít không chứng minh không có xung đột ngữ nghĩa.
- [ ] Đồng bộ DB port theo endpoint local đã kiểm tra; quét cả browser fixtures, runner scripts, docs và API/engine tests. Không chỉ sửa compose.
- [ ] Sửa cụ thể `scripts/check-web.mjs:66–74` và `apps/web/tests/live/cleanup.ts:6–8`: main còn default `55432`, trong khi AI fixture/compose chuyển sang `55532`. Runner luôn thêm default cũ vào cleanup oracle dù có env override, nên chỉ đặt `API_TEST_ADMIN_URL` không đủ. Oracle phải kiểm đúng endpoint tạo DB; giữ volume hiện có, không reset.
- [ ] Giữ code frontend, DTO/auth/session và browser canary tests của main; kiểm diff theo từng chức năng khi cùng sửa API tests.
- [ ] `git diff --check`, `npm run check`; nếu lỗi compile/fixture do integration, sửa đúng contract với test hiện có. Ghi rõ integration-only checkpoint chưa đóng T4.
- [ ] Tạo merge checkpoint sau khi checks pass, trước các commit sửa độc lập bên dưới. Không push.

**Exit:** Cả ancestry AI và 36 commits main còn nguyên; scripts/backend/frontend compile; AI vẫn disabled mặc định.

## Task 2 — Chặn paid dispatch chưa được kiểm soát

**Files:** new apps/api/src/ai-runtime.ts; modify main.ts, providers/registry.ts, providers/approval.ts; tests ai-runtime.test.ts, ai-provider-approval.test.ts, ai-provider-clients.test.ts.

**Proposed interfaces:**

```ts
// Added to CreateAiPortsOptions; all clients use the same hook.
type AuthorizeProviderCall = (
  request: ProviderCallReservation,
) => Promise<void>;
// Required authorizeCall on options; production composition always denies
// until T6 supplies durable scope/budget enforcement.
// Pure factory returns existing AiPorts, receives explicit credentials,
// ledger, fetchImpl and authorizeCall; never reads process.env itself.
```

- [ ] RED: fake fetch spy, dummy credential, deny hook; invoke planning, repair/replan, QE, document and query embedding. Assert every operation rejects with `AI_LIVE_NOT_READY`, fetch/reserve are never called.
- [ ] RED: create a fresh runtime twice with credentials; no restart silently grants calls or resets an usable campaign budget.
- [ ] Implement hook before credential lookup/reserve/network; carry actual call identity from explicit execution context, remove hardcoded campaignId/runId when live context is supplied. No automatic approval record generation.
- [ ] Extract composition into ai-runtime.ts for tests. Remove implicit $20 runtime grant. Backend AI startup reports live-not-ready with sanitized code; disabled/dev_fixture boot without keys.
- [ ] Offline test composition may explicitly authorize fake transport. This is an injection in tests, never an env option allowing fake evidence to authorize native network.
- [ ] Tighten approval schema: exact fields, SHA-256 config hash, valid role model strings, provider set, approvedAt <= now < expiresAt; scope checks cover providers/models as well as campaign/profile/phase/config hash. T6 must still supply durable accounting before native runtime is enabled.
- [ ] GREEN: run provider unit tests + API runtime unit tests. No actual key/network involved.

**Exit:** T4 is code-testable through real adapters/fake HTTP; production paid execution remains explicitly blocked pending T6. This is a stated readiness limitation, not a claim of live-ready.

## Task 3 — Sửa document/query content và provenance manifest

**Files:** providers/registry.ts, config.ts, embedding-policy.ts, catalog-embedding.ts; ai-provider-clients.test.ts, ai-provider-config.test.ts, ai-live-index.integration.test.ts.

- [ ] RED regression uses `gemini-embedding-001`, input `unique tool description canary` and captures JSON body; assert exact input text and corresponding taskType for BOTH purposes.

```ts
expect(body.content.parts[0].text).toBe(inputText);
expect(body.taskType).toBe("RETRIEVAL_DOCUMENT");
// A second independent query case requires RETRIEVAL_QUERY.
```

- [ ] Implement model-specific mapping: 001 sends raw text and separate taskType; 2 uses declared content prefix; OpenAI sends raw input. Do not use a taskType string as a content template.
- [ ] Tests verify two distinct texts produce distinct payloads; prefix applied once; cancellation issues zero subsequent calls; dimensions exactly 1536; invalid/zero/sparse/nonfinite vectors fail.
- [ ] Export `EmbeddingPolicyManifest` with format, serializerVersion, adapterVersion, provider/model/apiMode/dimensions, document/query policies and normalization. `buildEmbeddingPolicyVersion` hashes this manifest canonically; strict version syntax, no substring matching.
- [ ] Serializer tests permute nested object key order and expect same bytes/hash; change description/schema/policy/artifact and expect different text hash. Hash text as UTF-8 bytes explicitly and version that rule.
- [ ] Require and validate document purpose/text hash for live activation rows; keep synthetic fixtures explicitly in offline evaluator. Validate exact text hash against serializer, not just a 64-character regex.
- [ ] GREEN run provider unit tests and catalog tests. Record that actual API/model compatibility still needs T8 probe; consult official docs if changing provider protocol beyond the confirmed text-loss fix.

**Exit:** All four planning×embedding combinations retain correct request content with traceable preprocessing identity.

## Task 4 — Persist fingerprint và phát hiện index thay đổi

**Files:** migration 0008, pgvector-index.ts, retrieval.ts, exports; ai-pgvector.integration.test.ts, ai-live-index.integration.test.ts.

**Proposed contracts:**

```ts
interface PinnedEmbeddingIndex {
  readonly id: string;
  readonly provenance: EmbeddingProvenance;
  readonly vectorHash: string;
  readonly policyHash: string;
}
// Add to PgvectorCatalogIndex:
// pin(catalog, expectedProfile): Promise<PinnedEmbeddingIndex>
// assertCurrent(catalog, pinned): Promise<void>
// Same pinned token passed to search and reused during one AI session.
```

- [ ] RED DB tests: activate OpenAI A, request Google B -> reject before QE/fetch; build/activate B -> succeeds, A superseded. Concurrent activation leaves exactly one active row.
- [ ] RED: mutate vector while retaining row content_hash -> fingerprint mismatch; replace active index while query/QE awaits -> `INDEX_CHANGED`; incomplete/cross-user/catalog/policy rows reject.
- [ ] Add nullable legacy-compatible columns: index vector_hash/policy_manifest and row embedding_text_hash/document purpose. New activation requires all; old rows remain identifiable and unqueryable on live path. Never fabricate provenance for legacy rows.
- [ ] Compute vector hash from sorted server/name, content/text hash, purpose and persisted float32 vector values. pgvector rounds JS doubles: fingerprint canonical DB readback inside activation transaction, not the original JS float64 array. Add round-trip test with noninteger vectors.
- [ ] Activation validates full batch before transaction; insert/readback/hash/supersede/activate atomically using existing advisory lock. Any embedding/build/transaction failure preserves previous active index.
- [ ] pin reads metadata+rows consistently in a transaction; validates manifest/hash/catalog/expected profile. assertCurrent verifies id still active and fingerprint unchanged. search validates same pinned state and row completeness.
- [ ] Retriever checks pin before every QE/query provider request, after awaited request and before returning candidate results. Cancellation stays cancellation; mismatch has no provider fallback.
- [ ] No DB lock held during network. Explicit profile switch requires drained execution; concurrent administrative change is caught at check boundaries and discards stale result. Do not claim zero paid cost for a call already in flight.
- [ ] GREEN isolated DB tests; rollback/migration tests confirm original data and unique active constraint survive. Add artifact-reuse test: exact persisted identity can reuse; mismatching policy/text/vector cannot.

**Exit:** Persisted artifact fingerprint exists, active-index switch is detectable, unchanged profile does not trigger automatic rebuild.

## Task 5 — Nối session currentness, replan và secret boundaries

**Files:** ai-runtime.ts, ai-planner.ts, main.ts, engine ai/planner.ts and ai/replan.ts only where validation hooks are needed; API runtime/HTTP tests and engine replan integration tests.

**Proposed session contract:**

```ts
interface AiRetrievalSession {
  readonly retriever: ToolRetriever;
  assertCurrent(): Promise<void>;
}
// createSession(catalog: ReviewedCatalogSnapshot): Promise<AiRetrievalSession>
// semantic modes pin one index per planning/replan invocation.
// all_tools uses reviewed catalog without embedding-index requirement.
```

- [ ] RED integration constructs real loadAiPlanner/loadAiReplan with fake provider HTTP and real isolated pgvector; test OpenAI/OpenAI, Google/Google, OpenAI/Google, Google/OpenAI plus QE override.
- [ ] Each session pins once, checks after model/repair output and before handing result back; replan retains existing owner/version/lease checks before persistence. Add deferred model test: switch A→B before response, assert no new workflow version/preview/write.
- [ ] Configure retrieval variant/topK explicitly in composition; verify semantic requests invoke pgvector, semantic_qe invokes QE, all_tools invokes neither embeddings nor QE. Missing semantic index is explicit error, no fixture fallback.
- [ ] Pass configured secrets into AiReplanAdapter, not only WorkflowEngine. Assert canaries in completedOutputs and error context never reach HTTP payload/evidence. Use sanitized messages rather than exposing raw provider bodies.
- [ ] Test selected credential resolver using getter spies: pure Google never reads OpenAI key, vice versa; mixed reads only selected keys. Check actual MCP transport spawned env for both child servers with canaries.
- [ ] Test missing key/index/QE, timeout, provider error, stale owner/version/lease, query cancellation. Planner refusal/clarification preserve current HTTP outcomes and do not create empty plans.
- [ ] Separate max local replans (2) from model-call/repair allowance (3); avoid using one config variable as both counters. Pin tests to independent bounds.
- [ ] GREEN targeted API tests + engine replan integration; maintain default disabled and dev_fixture browser behavior.

**Exit:** Tests exercise the composition used by main, actual replan invocation and currentness rejection; no claim based solely on source wiring.

## Task 6 — Regression, review và commit handoff

**Files:** current docs/status, new docs/ai-evidence/AI-T4-INTEGRATION-2026-09-19.md; no historical evidence rewrites.

- [ ] Run targeted RED/GREEN once per task; after last source change run final gates serially to avoid competing DB/browser fixtures:

```powershell
npm run check:backend
npm run check:web
git diff --check
```

- [ ] Fail fast on command exit. Record per-suite output/count and final SHA; do not sum repeated runs into unique coverage. Browser gate proves retained web behavior only, not live AI quality.
- [ ] Prerequisites: dependencies đã cài, PostgreSQL test endpoint truy cập được và browser runtime sẵn sàng. `check:web` tạo evidence và có thể cập nhật `docs/WEB-STATUS.md`; review các thay đổi sinh ra trước khi commit. Không chạy thêm `check:full` trùng với hai gates phía trên.
- [ ] Inspect new migration, cleanup delta, no secret file/binary/runtime dump in candidate commit. Pattern scan is a heuristic, not proof of absence of all secrets; review exact staged files too.
- [ ] Independent Code Reviewer reads final diff with focus Tasks 2–5; no edits by reviewer. Fix concrete blockers and rerun only relevant checks unless broad impact warrants full rerun.
- [ ] Update T4 checklist honestly: implementation, integration gate, paid readiness, live quality separately. Do not weaken original unchecked requirement to make it appear complete.
- [ ] Commit logical units: integration; paid dispatch guard; embedding fix; index fingerprint/currentness; composition tests/docs. Commit only after applicable checks; no push.
- [ ] Confirm clean status (or list unrelated user edits), show commit IDs and remaining T6/T8 restrictions.

**Exit:** Verified merged backend + current frontend; no unresolved critical/high correctness findings; paid execution remains blocked; T5 can begin.

## 5. T5 handoff sau khi Tasks 1–6 đạt

T5 là đợt riêng có test cycle riêng theo live-evaluation plan. Không cần key:

1. `packages/engine/src/ai/live-evaluation/contracts.ts`: strict profile/config schemas, unique profile IDs, four fake matrix combinations.
2. `dataset.ts`: `toLiveCaseInput` chỉ copy id/prompt/runtime; gold tools/results/fixtures nằm trong private oracle. Canary phải vắng khỏi planning/repair/QE requests.
3. `scorer.ts`: tách structuralValidity, fixtureExecutability, semanticJudgment và safetyViolations; equivalent plan hợp lệ không bị đánh sai chỉ vì step IDs; thiếu fixture coverage -> needs_review.
4. `testdata/ai-live-rubric.json`: PROPOSED_EXPLORATORY, có version/hash; b07–b10 là legacy_regression. Approval người dùng/rubric owner chưa có thì formal quality gate vẫn blocked.
5. Unit tests cover extra writes/wrong arguments, justified clarification/refusal, empty recall denominator, exposure contradictions; ambiguous semantic cases cần independent adjudications như plan gốc.

Sau T5: T6 durable runner/authorization/ledger/CLI -> T7 readiness -> T8 paid probes khi có approval và ngân sách thực. Không coi T4 guard hoặc local API key là quyền chạy T8.

## 7. Execution outcome

The implementation ledger at
`.superpowers/sdd/2026-09-19-ai-main-integration-t4-closure/progress.md`
is authoritative for command counts and checkpoint SHAs. The resulting
backend remains fail-closed for native provider calls; this plan does not grant
live or paid execution authority.

## 6. Self-review và tiêu chí chốt plan

- [x] Integration không bỏ mất 36 commits trên main; có checkpoint riêng cho migration/port/browser regressions.
- [x] Mỗi finding đã chỉ ra test và module chịu trách nhiệm.
- [x] Các interfaces mới được đánh dấu proposed; không mô tả như API hiện có.
- [x] Các contract mới pin/assertCurrent/createSession dùng cùng token trong một phiên; T6 cần giữ token cho toàn trial.
- [x] Paid gate, Gemini text loss, index races, secret prompt leakage và frontend regression có task sở hữu rõ.
- [x] Phân biệt scope đợt này với T5–T8 và bằng chứng offline/live.

Ước lượng tương đối: integration vừa; authorization/content fix vừa; index fingerprint/currentness lớn; composition/regression lớn. Chia checkpoint theo deliverable, không cam kết số giờ trước khi merge và kiểm tra migration.
