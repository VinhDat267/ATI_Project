# Pilot v2 Advisory Offline Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans after owner approval of this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** PLAN_PROPOSED — direction approved, implementation not started.

**Goal:** Loại lệch prompt/schema và thiết lập ranh giới input oracle-blind
được kiểm trên fake adapter, trước khi xây campaign evaluator/provider transport.

**Architecture:** Thêm output contract advisory có opt-in vào context builder
hiện tại; API pilot chọn rõ mode này. Một projection thuần chỉ đưa các trường
được phép từ dataset vào fixture intake, không trao whole record cho callback.
Test PostgreSQL/HTTP dùng runtime admission/claim/settle hiện có; không tạo
ledger, authorization hoặc evaluator song song.

**Tech Stack:** TypeScript, Zod, Vitest, PostgreSQL fixture của API; không thêm dependency.

**Spec:** [Đề xuất advisory-first đã duyệt hướng](2026-09-27-pilot-v2-evaluation-readiness-proposal.md),
[MVP v2](../specs/2026-09-21-workflow-platform-mvp-v2-design.md),
[offline admission design](../specs/2026-09-27-pilot-v2-offline-ai-admission-design.md).

## Global Constraints

- Batch này **offline only**: fake provider, fixture Sheets, không Trello thật,
  không key, không phí; không thêm CLI `--execute` hay cài adapter vào `main.ts`.
- Không đổi `PilotPlannerProposalSchema`, quyền model, policy/approval, TTL
  10 phút, one-claim, ledger unknown hold hoặc no-auto-resume/no-blind-retry.
- Không đọc prompt/oracle holdout để thiết kế code/test. Dùng synthetic unit
  records tự tạo; public data chỉ khi cần fixture và không sửa đáp án.
- Giữ legacy context builder behavior khi không truyền output contract.
- Không đổi simulated P6 runner thành live bằng cách đổi nhãn.
- Một writer; preserve dirty files ngoài scope. Không `git add .`, reset/stash,
  push hay stage nguyên các docs có hunk không thuộc batch.
- Mốc code để đối chiếu: `187ee06`; kiểm HEAD/status lại trước implementation.

## Review Focus

1. Lệch default legacy/advisory: output không được yêu cầu full DSL hay lookup
   trong advisory; legacy phải giữ instruction/catalog cũ (Task 1).
2. Oracle nằm trong nested object/metadata: không shallow spread record, không
   gửi mutable references cho callback; poison-field/metamorphic tests (Task 2).
3. Business ID/free text vẫn có thể mang đáp án: allowlist chỉ chứng minh field
   separation, không chứng minh dataset content sạch; giữ gate Phase B (Task 2).
4. Có cost/timeout nhưng không valid proposal: settle đúng, unknown giữ hold,
   không retry; dữ liệu model không trở lại public outcomes (Task 3).
5. Deterministic bypass và callback counters: không tính mọi record là model
   success, không tạo approval/remote write cho refusal/needs-input (Task 3).

## File map

| Path | Vai trò |
|---|---|
| `packages/engine/src/pilot/planner-context.ts` | Existing escaping/redaction/envelope + explicit output-contract option |
| `packages/engine/tests/pilot-planner-prompt.test.ts` | Legacy/advisory compatibility and poison-text boundaries |
| `apps/api/src/pilot-router.ts` | Chọn advisory contract tại context construction, không thay admission |
| `packages/engine/src/pilot/evaluation-input.ts` (new) | Pure strict projection + parse/schema, không provider/network/DB |
| `packages/engine/tests/pilot-evaluation-input.test.ts` (new) | Metamorphic field exclusion và cloning/rejection |
| `packages/engine/src/index.ts` | Export projection types/functions để API tests dùng |
| `apps/api/tests/pilot-approval.integration.test.ts` | Capture real callback payload qua HTTP + isolated DB |
| `apps/api/tests/pilot-planner.test.ts` | Giữ strict proposal/accounting regression |

Không import app/API vào engine. Source parser có sẵn là
`packages/engine/src/pilot/source.ts::parseRequest`; intake thật là
`packages/engine/src/pilot/adapters/sheets.ts::readSheetsRequest` — không gọi
adapter network đó trong test mới.

### Task 1: Đồng bộ output contract mà không phá legacy

**Interfaces**

Extend `BuildPilotPlannerContextParams` bằng optional
`outputContract?: 'planner-result' | 'pilot-advisory-v1'`.
`buildPilotPlannerContext` vẫn trả `PilotPlannerContext` không đổi shape.
Omitted option tương đương `'planner-result'`. API pilot tại call site trong
`pilot-router.ts` truyền `'pilot-advisory-v1'`.

Advisory system instruction định nghĩa đúng ba JSON shapes:
`{kind:'plan',tool:'trello.create_card'}`, `{kind:'clarification',question:string}`,
`{kind:'refusal',reason:string}`; string không rỗng và tối đa 500 ký tự theo parser.
Cấm extra fields, markdown, steps/args/targets/approval. Plan chỉ là recommendation,
không là quyền dispatch. Advisory catalog chỉ hiện `trello.create_card`; không
đưa lookup `trello.get_card` như một model action hợp lệ. Envelope, escaping,
redaction và bound 16000 ký tự vẫn giữ. Legacy instructions/catalog giữ nguyên.

- [ ] **RED:** thêm test omitted contract == explicit legacy với cùng input;
      legacy vẫn chứa full PlannerResult instruction; advisory chỉ chứa đúng
      proposal contract và một reviewed tool, không yêu cầu executable steps.
      Poison XML/source/operator text vẫn được escape/redact ở cả hai mode.
- [ ] Chạy `npm run test:unit -w @wap/engine -- tests/pilot-planner-prompt.test.ts`;
      ghi expected RED của mode mới, không coi lỗi import/setup là RED hợp lệ.
- [ ] Implement option và router call site tối thiểu, không refactor caller khác.
- [ ] **GREEN:** chạy lại test prompt; build engine rồi chạy
      `npm run test:unit -w @wap/api -- tests/pilot-planner.test.ts`.
      Cả ba example proposal parse được, full DSL/get-card/extra args bị reject.
- [ ] Review diff rồi commit riêng các hunk prompt/router/tests đã sở hữu.

### Task 2: Projection typed, oracle field không tới callback

**Interfaces**

`projectPilotEvaluationInput(record: V2TestCase): PilotEvaluationInput`
trong `evaluation-input.ts`; export qua engine index.
`PilotEvaluationInputSchema` strict ở mọi object level, shape:

```ts
type PilotEvaluationInput = {
  language: 'vi' | 'en';
  prompt: string;
  principal: string;
  sourceFixture: {
    headers: string[];
    rows: (string | number | boolean | null)[][];
    requestId: string;
    spreadsheetId?: string;
    tabId?: string;
  };
  resourcePolicy: {
    allowedSources: string[];
    allowedTargets: string[];
    allowedPrincipals: string[];
  };
};
```

Build shape bằng positive allowlist từng property; deep-copy arrays; schema
reject nested objects/arrays trong cell, non-finite number hoặc non-JSON data,
không stringify object để vô tình serialize oracle. Không nhận provider,
manifest/grader/DB handle ở hàm này. Unknown keys khi parse projected input
phải reject; excluded metadata ở full record được bỏ qua khi project.

`caseId`, `variantId`, `expected`, `evidence`, `fault`, `note`, `sourceRefs` chỉ
ở test/controller/grader scope, không trong projected input hoặc context.
Request ID nghiệp vụ giữ nguyên để `parseRequest` chọn đúng source row; không
hash nó và coi như đã giải quyết leakage. Các source IDs và free text cần
content audit riêng trước Phase B/provider; API run IDs là opaque IDs tự sinh.

- [ ] **RED:** trên synthetic record, thay lần lượt mọi excluded field bằng
      sentinel hợp lệ theo loại nhưng khác đáp án; projection và context tạo từ
      `parseRequest([headers,...rows],requestId)` + `evaluateChecklist(row)` phải
      byte-equivalent. Không đọc oracle để chọn fake proposal.
- [ ] **RED:** đổi source deliverable/raw_request hợp lệ làm context thay đổi;
      extra projected keys/nested cell/NaN bị reject; mutate original arrays
      sau projection không làm đổi projected result.
- [ ] Chạy `npm run test:unit -w @wap/engine -- tests/pilot-evaluation-input.test.ts`.
- [ ] Implement projection/schema/export; rerun cùng prompt tests tới GREEN.
      Test fake callback nhận **only** projected/context data; closure spy không
      dùng expected/caseId để sinh answer.
- [ ] Commit riêng projection/export/tests. Không thay dataset hoặc holdout.

### Task 3: Harness regressions qua runtime thật, transport giả

**Interfaces**

Mở rộng fixture test hiện có trong `pilot-approval.integration.test.ts`, không
export harness test thành production runner. Dùng `projectPilotEvaluationInput`
để tạo intake fixture bằng `parseRequest` và `evaluateChecklist`, inject
`readSheetsRequestFn` như test hiện có. `fakePlanner.propose` capture callback
input trước khi trả constant proposal/envelope; requestId/source keys ánh xạ
nhất quán trong test, không dựa oracle. `liveWriteEnabled=false` cho test mới.
Harness dùng projected prompt làm operator prompt, projected principal qua mapping
UUID fixture cố định và resourcePolicy thành allowlist tương ứng; source IDs
đi đúng intake request. `language` chỉ là metadata của phép đo khi runtime hiện
không có language parameter: không thêm API field hoặc tuyên bố nó đã tới model.
Không dùng nguyên record để dựng session/policy/context ở bước sau projection.

- [ ] **RED:** HTTP submit intake hợp lệ → DB snapshot đã commit trước callback,
      xác nhận visibility bằng connection DB riêng, không đọc từ transaction viết.
      Callback system prompt dùng advisory-v1, nguồn đúng, không sentinel oracle.
      Một invocation; ledger settled đúng known cost; awaiting approval chưa có
      business reservation/card POST. Inject fake provider + Sheets intake và
      fail-closed Trello path; kiểm exercised clients dùng fetch stub nếu dùng
      stub đó. Loopback HTTP vẫn cho phép; không suy zero-network từ fetch spy
      nếu còn transport khác ngoài interception.
- [ ] **RED:** hai HTTP runs cô lập, chỉ đổi excluded metadata, phải có callback
      context byte-equivalent. So sánh cả sourceRevision; runId/correlation ID
      được sinh riêng thì kiểm opaque/không chứa labels, không đòi UUID giống nhau.
      Giữ business inputs/session mapping/policy và runtime timezone cố định;
      test không normalize away source hoặc prompt khác biệt.
- [ ] **RED:** checklist refusal và needs-input → callback count 0, không approval,
      không provider call record; status đúng, không gán đây là model pass.
- [ ] **RED:** không grant hoặc cap không đủ → callback 0, reserve không thành;
      partial setup không để active run/reservation bị mắc kẹt ngoài contract.
- [ ] **Regression:** invalid output + known cost settle `invalid_output`; timeout
      hoặc unknown cost giữ hold, không approval/retry; late result không sinh
      outcome/approval thứ hai. Tận dụng tests hiện có nếu đã assert đầy đủ,
      chỉ bổ sung assert còn thiếu, không copy cả fault suite.
- [ ] Chạy targeted tests tới GREEN bằng:
      `npm run build -w @wap/engine && npm run test:integration -w @wap/api -- tests/pilot-approval.integration.test.ts tests/pilot-ai-admission.integration.test.ts`.
      Fixture phải tạo/drop DB riêng; không dùng DB demo hay credential thật.
- [ ] Chạy `npm run check` và
      `npm run test:integration -w @wap/engine -- tests/ai-postgres-ledger.integration.test.ts`.
      Kiểm branch/unknown outcomes không chứa model text/raw remote errors.
- [ ] Independent Code Reviewer (hoặc compatible exposed read-only role) kiểm
      changed scope, không buộc phải có finding. Main kiểm bằng chứng và sửa nếu cần.
- [ ] Commit đúng hunk; tái lập tại checkout sạch với `npm ci`, `npm run check`
      và hai integration commands trên; báo actual counts, giữ unrelated dirt.

## Done criteria và những gì chưa được làm

Phase A complete chỉ khi legacy/advisory contract, projection invariance và
runtime fake/DB gates đạt, reviewer coverage/limitations được ghi, checkpoint
sạch tái lập được. Nhãn: **OFFLINE_ADVISORY_CONTRACT_TESTED**, không quality.

Phase B vẫn phải có **thiết kế/plan được duyệt riêng** cho immutable campaign
freeze, eligibility/modes/denominators, sanitized durable observations/grader,
crash recovery cho report, price/quota/usage và real adapter. Hiện chưa có đủ
harness để gọi provider; Phase A không dựng CLI nửa vời và gọi là ready.

Sau Phase B mới xin runtime approval cho exact model, token/call/spend cap,
synthetic data/retention/grader/holdout. Probe <=1 và smoke <=6 vẫn là trần
đề xuất, không phải quyền cấp. Zero-dollar/free-tier với positive reservation
estimate còn là compatibility blocker cần xử lý trước live, không sửa trong
batch Phase A. Semantic/QE/manual comparisons và customer acceptance giữ NOT_RUN.

## Execution handoff

Đề xuất một native writer **GPT-6 Sol High** xử lý Task 1→2→3 tuần tự; main
review/integrate, reviewer riêng read-only sau thay đổi safety-adjacent. Không
cần parallel writers vì builder/projection/API tests phụ thuộc sát nhau.
Chưa spawn writer hoặc chỉnh product code; cần chủ project duyệt plan này.
