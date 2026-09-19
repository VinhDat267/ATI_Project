# AI-04 Offline Evaluation Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement task-by-task directly in the current checkout, following the user's preference. Main agent implements; independent Code Reviewer reviews the completed evaluator. Steps use checkbox syntax. Preserve existing changes; commit/push requires a separate user request.

**Status:** IMPLEMENTED_MAIN_VERIFIED — offline dataset/oracle/runner/report/CLI, strengthened freeze gate, isolation test, fresh dev/holdout evidence, and separate engine-safety checks were verified on 2026-09-18. Live-provider quality, paid usage, and provider end-to-end latency remain `NOT_RUN`.

**Goal:** Xây bộ chạy đánh giá offline có dataset contract, oracle, provenance, freeze/holdout gate và báo cáo tái lập cho retrieval → planner/repair → validation và replan adapter.

**Architecture:** Module `packages/engine/src/ai/evaluation/` chạy các adapter hiện có với dependency injection. Scorer kiểm candidate bằng DSL/engine validator và read fixtures; chỉ tính write intents. CLI riêng xuất artifacts; engine runtime và API không import evaluator. Safety của execution/recovery được dẫn chứng bằng integration suites riêng, không giả lập lại một engine trong evaluator.

**Tech Stack:** TypeScript, Node theo package engines hiện có (`^22.12.0 || >=24.0.0`), Zod 4, Vitest 4.1.11, Node filesystem/crypto. Không thêm dependency hoặc migration.

**Spec:** `docs/superpowers/specs/2026-09-17-ai-backend-design.md` §2.8, §4, §7–8; `docs/superpowers/plans/2026-09-17-ai-backend.md` AI-04; `testdata/experiment-manifest.json`; scope authority `docs/BASELINE.md`.

## Quyết định và ràng buộc

- Người dùng chọn A: evaluation/holdout offline, chưa cần API key. Plan đề xuất bao phủ pipeline offline theo recommendation trong conversation; không giới hạn ở retrieval.
- “Runner chạy cùng các adapter nhưng không được gọi receiver hoặc mutate demo database.” Runner không nhận DB/Gateway, không đọc credentials, không mở network/MCP, không gọi API runtime.
- “Giữ split manifest: b01–b06 development, b07–b10 holdout.” Đọc đúng dataset có sẵn, không tự thêm hoặc sửa đáp án để tăng điểm.
- “Không dùng test pass, model confidence, hand-plan hoặc fixture result làm AI quality evidence.” Kết quả mock là `OFFLINE_HARNESS_PASS` hoặc `OFFLINE_HARNESS_FAIL`; `AI_EVALUATION_NOT_RUN` và live gate vẫn mở.
- Planning tối đa 3 calls tính cả lần đầu; local replan tối đa 2 thuộc engine. Giữ policy, approval TTL 10 phút, owner/version và unknown-write reconciliation hiện có.
- Mỗi run thực thi tuần tự. Ba repetitions không được tính thành ba nhiệm vụ độc lập; nhóm dev/holdout báo cáo riêng.
- Không frontend, queue mới, provider/model change, hybrid/BM25, auto-resume, sửa rubric hoặc bật API AI mode.

## Evidence đã kiểm tra và tác động lên thiết kế

1. `testdata/test-cases.json` có 10 cases cùng `runtime`, `read_fixture`, `expected_writes`, `expected_outputs`, `forbid_extra_writes`. Sáu cases dev có 4 plan/1 refusal/1 clarification; holdout có 2 plan/1 refusal/1 clarification.
2. `packages/dsl/tests/fixtures.test.ts` có oracle bằng DSL resolver, strict read-argument match và comparison write/output. Đây là logic tham chiếu, không phải production executor. Evaluator cần structured results thay vì Vitest assertions.
3. `ai-retrieval-benchmark.test.ts` dùng vector từ character hashing, fake expansion và artifact hash tổng hợp nhưng metadata mang tên provider/model thật. Đổi metadata của test thành `offline-synthetic` và tên algorithm thực; sửa claim p95 trong status cho đúng measured scope.
4. Benchmark và DSL fixtures đã dùng cả holdout. Ghi `holdoutExposure: "previously_exercised_by_offline_tests"`; không khẳng định untouched/untuned chỉ từ Git hash. Không có bằng chứng đủ để kết luận đã tune bằng holdout; giữ distinction này trong report. Untouched live evaluation sau này có thể cần bộ cases mới được phê duyệt riêng.
5. Runtime ports `ToolRetriever`, `StructuredModelClient`, `QueryExpansionPort`, `AiPlannerAdapter`, `AiReplanAdapter` đã có. Reuse các port thật, không tạo planner hoặc retrieval logic mới trong runner.

## File map và thứ tự phụ thuộc

T1 contracts/freeze → T2 scorer → T3 runner/fixtures → T4 report/CLI → T5 gates/evidence.

| File dự kiến | Trách nhiệm |
|---|---|
| `packages/engine/src/ai/evaluation/contracts.ts` | Dataset, config, freeze, observation, metric/report schemas và types |
| `packages/engine/src/ai/evaluation/dataset.ts` | Parse, split checks, canonical hashes, freeze comparison |
| `packages/engine/src/ai/evaluation/scorer.ts` | Pure fixture oracle, recall và denominators |
| `packages/engine/src/ai/evaluation/runner.ts` | Sequential trial scheduling, port instrumentation, outcomes |
| `packages/engine/src/ai/evaluation/offline-fixtures.ts` | Explicit scripted model/embedding/QE fixtures và dev fault probes |
| `packages/engine/src/ai/evaluation/report.ts` | Aggregation, JSON/Markdown report, evidence labels |
| `packages/engine/src/ai/evaluation/cli.ts` | Offline-only dev/freeze/holdout commands, exclusive artifact writes |
| `packages/engine/tests/ai-evaluation-{dataset,scorer,runner,report,cli}.test.ts` | Targeted automated gates; unit config đã include các file này |
| `package.json` | `ai:eval:offline` command |
| `packages/engine/tests/ai-retrieval-benchmark.test.ts` | Honest synthetic provenance và test names |
| `docs/AI-STATUS-2026-09-17.md`, AI backend plan, engine README | Hướng dẫn/evidence mới sau implementation |

Không sửa `testdata/experiment-manifest.json` thành PASS. Giữ manifest nghiên cứu gốc; lưu config/freeze/results riêng dưới `docs/ai-evidence/AI-04/<run-id>/` khi implementation thực sự được chạy. Không sửa artifacts lịch sử FS-06.

## Task 1 — Contracts, split và freeze

**Files:** Create `contracts.ts`, `dataset.ts`; test `ai-evaluation-dataset.test.ts`.

**Interfaces:** Các types sau được khai báo trong `contracts.ts`; runtime schemas strict bằng Zod, không cast JSON thẳng sang type.

```ts
type Split = "dev" | "holdout";
type Cell = { variant: "all_tools" | "semantic" | "semantic_qe"; topK: 3 | 5 | 10 };
type FixtureWrite = { server: string; name: string; args: Record<string, unknown> };
type EvalCase = {
  id: string; split: Split; profile: string; prompt: string;
  expected_result: PlannerResult;
  read_fixture: Array<FixtureWrite & { output: unknown }>;
  expected_writes: FixtureWrite[];
  expected_outputs: Record<string, unknown>;
  forbid_extra_writes: boolean;
};
type EvalDataset = {
  profile: string; evidence: "HAND_AUTHORED_EXECUTABILITY_FIXTURES_NOT_MODEL_RESULTS";
  runtime: { now: string; run_id: string; user_id: string; time_zone: string };
  cases: EvalCase[];
};
type EvalConfig = {
  mode: "offline"; cells: Cell[]; repetitions: 3;
  maxPlanningCalls: 3; deadlineMs: number;
  modelFixture: string; embeddingFixture: string; expansionFixture: string;
};
type Fingerprints = {
  dataset: string; experimentManifest: string; catalog: string;
  prompts: string; evaluator: string; fixtures: string; config: string;
  policiesAndArtifacts: string; lockfile: string;
};
type FrozenEvaluation = {
  format: "ati-ai04-freeze-v1"; mode: "offline";
  fingerprints: Fingerprints; config: EvalConfig;
  holdoutExposure: "previously_exercised_by_offline_tests";
};
// dataset.ts exports:
function parseDataset(raw: unknown, manifest: unknown): EvalDataset;
function selectCases(dataset: EvalDataset, split: Split): readonly EvalCase[];
function assertFrozen(actual: FrozenEvaluation, saved: FrozenEvaluation): void;
```

- [ ] Viết failing tests: duplicate/missing IDs, overlap split, wrong split on a case, profile mismatch, unrecognized tool, malformed expected result, missing fixture output, invalid runtime/timezone; validate ngày bằng runtime helper hiện có.
- [ ] Run `npm run test:unit -w @wap/engine -- ai-evaluation-dataset.test.ts`; xác nhận fail do contract chưa có.
- [ ] Implement parse/schema; top-level `evidence` phải là literal `HAND_AUTHORED_EXECUTABILITY_FIXTURES_NOT_MODEL_RESULTS`. Unknown fields bị reject tại execution-bearing objects. Gold tools phải tồn tại trong snapshot 8+2. Runtime IDs hiện là `fixture-run`/`fixture-user`; giữ nguyên fixture identifiers, không ép UUID hoặc mở engine persistence để dùng chúng.
- [ ] Freeze chính xác raw input file hashes và canonical config/catalog hash; prompts/evaluator/fixtures dùng sorted path→SHA-256 map. Ghi Git HEAD cùng dirty content hashes khi report; HEAD một mình không đủ trong dirty checkout. Exclude output directory khỏi input hash để tự sinh report không làm freeze drift.
- [ ] Test holdout thiếu freeze hoặc đổi một trong các fingerprints phải fail trước bất kỳ model/embedding call nào. Freeze của mode khác phải reject.

```ts
expect(() => assertFrozen(
  { ...saved, fingerprints: { ...saved.fingerprints, prompts: "b".repeat(64) } },
  saved,
)).toThrow(/freeze/i);
expect(selectCases(dataset, "dev").map(c => c.id))
  .toEqual(["b01", "b02", "b03", "b04", "b05", "b06"]);
```

- [ ] Rerun targeted suite, thêm default dev selection và sorted hashes independent of filesystem iteration order.

## Task 2 — Oracle và metric có denominator rõ ràng

**Files:** Create `scorer.ts`; test `ai-evaluation-scorer.test.ts`.

**Interfaces:** Consume `EvalCase`, `EvalDataset.runtime`, `ReviewedCatalogSnapshot` hiện có. Define and export từ contracts:

```ts
type Score = {
  resultKind: "plan" | "refusal" | "clarification" | "invalid";
  kindCorrect: boolean; planValid: boolean | null;
  fixtureTaskCorrect: boolean | null;
  writeIntents: FixtureWrite[];
  issues: Array<{ code: string; message: string }>;
};
type Ratio = { numerator: number; denominator: number; value: number | null };
// scorer.ts exports:
function scoreCandidate(input: {
  candidate: unknown; testCase: EvalCase;
  runtime: EvalDataset["runtime"]; catalog: ReviewedCatalogSnapshot;
}): Score;
function retrievalRecall(selected: readonly string[], gold: readonly string[]): number | null;
```

- [ ] Viết failing tests với b02 dev: plan structurally valid nhưng sai channel `#wrong`, thiếu một row, duplicate write, sai read filter, read output không đúng schema, thêm write ngoài oracle. Candidate step IDs đổi nhưng references tương đương phải vẫn được chấm theo resolved behavior.
- [ ] Run `npm run test:unit -w @wap/engine -- ai-evaluation-scorer.test.ts` để lấy red.
- [ ] Implement theo oracle hiện có: `PlannerResultSchema` → `validateManualPlan` → `validateGraph` → `buildRuntime`/`evaluate`/`resolveArgs` → lookup read fixture bằng server/name/deep args → `normalizeToolResult` → collect ordered write intents → `resolveValue` outputs. Không invent write outputs; unresolved reference là lỗi chấm candidate, không skip.
- [ ] So sánh ordered writes và outputs bằng deep equality. Thiếu/thừa/sai destination hoặc payload đều sai. Scorer tuyệt đối không nhận expected plan làm candidate mặc định; candidate và oracle là hai arguments tách biệt.

```ts
const wrong = structuredClone(b02.expected_result);
if (wrong.kind !== "plan") throw new Error("b02 must be plan");
wrong.plan.steps[2]!.tool.args.channel = "#wrong";
const score = scoreCandidate({ candidate: wrong, testCase: b02, runtime, catalog });
expect(score.planValid).toBe(true);
expect(score.fixtureTaskCorrect).toBe(false);
expect(retrievalRecall(["task_hub.list_cards"], [])).toBeNull();
```

- [ ] Refusal/clarification báo `kindCorrect`; nội dung câu hỏi/lý do chưa có semantic oracle thì `semantic_task_correctness=null`, reason `NOT_MEASURED`. Không gọi đúng kind là đúng toàn bộ ngữ nghĩa.
- [ ] Retrieval deduplicate qualified identities; gold từ expected plan, empty gold trả null/N/A. Report macro recall trên cases có gold. Plan validity denominator là mọi candidate plan đã trả; task pass trên expected-plan cases kể cả planner fail/refusal sai phải tính fail. Báo đúng count, không chia cho repetitions như số nhiệm vụ.
- [ ] Rerun suite; deliberate mutation tests phải chứng minh scorer phân biệt schema-valid với fixture-correct.

## Task 3 — Sequential runner và pipeline probes

**Files:** Create `runner.ts`, `offline-fixtures.ts`; test `ai-evaluation-runner.test.ts`.

**Interfaces:** Consume T1–T2. Define in contracts:

```ts
type Trial = { caseId: string; split: Split; cell: Cell; repetition: number };
type Observation = {
  trial: Trial; status: "completed" | "error" | "cancelled";
  score: Score | null; retrievalRecall: number | null;
  calls: Array<{
    stage: "embedding" | "expansion" | "planning" | "replan";
    provider: string; model: string; latencyMs: number;
    usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null;
    costUsd: number | null; errorCode: string | null;
    requestHash: string;
  }>;
  serviceTimeMs: number; errorCode: string | null;
};
// runner.ts exports:
function scheduleTrials(cases: readonly EvalCase[], config: EvalConfig): Trial[];
async function runOfflineEvaluation(input: {
  dataset: EvalDataset; split: Split; config: EvalConfig;
  catalog: ReviewedCatalogSnapshot;
  makePorts: (trial: Trial) => {
    model: StructuredModelClient; embedding: EmbeddingPort; expansion: QueryExpansionPort;
  };
  signal?: AbortSignal;
}): Promise<Observation[]>;
```

- [ ] Viết scheduler tests cho 7 cells: all_tools/k10 một control; semantic và semantic_qe mỗi loại k3/k5/k10. 6×7×3 = 126 dev rows; 4×7×3 = 84 holdout rows. Không chạy all_tools lại dưới nhãn k3/k5 vì port luôn trả toàn catalog. Record cả requested K và actual returned tool count.
- [ ] Thêm failure tests: invalid→valid repair; 3 invalid calls rồi exhausted; refusal/clarification không repair; expansion throw không fallback; deadline/cancel; score của row failure không biến thành pass. Run targeted suite red.
- [ ] Implement từng trial bằng `InMemoryToolRetriever` + `AiPlannerAdapter`; instrument ports để thu cả failed/repair calls. Reuse validator và prompt builders thật. Mỗi trial có scripted client mới; không carry state giữa repetitions. Một retrieval phục vụ planner đồng thời cung cấp recall observation, không gọi retrieval lần hai chỉ để đo.
- [ ] Offline ports dùng `provider=offline-synthetic`, tên fixture/algorithm version thực. Mock response chỉ đo wiring. Nếu replay expected result để smoke harness, tag scenario `oracle_replay` trong report; không đưa gold labels vào retrieval/query expansion input. Model fixture không trở thành baseline AI.
- [ ] Freeze runtime từ dataset; IDs của trial phải deterministic nhưng runtime dùng cho resolution phải consistent với oracle. Đo time bằng monotonic clock, tests inject clock khi cần exact expected latency.
- [ ] Thêm dev-only replan probes qua `AiReplanAdapter`: failed-step-only fix được chấp nhận; đổi completed/nonfailed step bị reject; malformed output exhaustion; error/cancel. Probes có IDs riêng, không thêm vào mẫu 10 business cases. Unknown-write prohibition và new approval được xác minh bằng engine suites trong T5.

```ts
expect(scheduleTrials(devCases, config)).toHaveLength(126);
expect(scheduleTrials(holdoutCases, config)).toHaveLength(84);
// Recorded calls from a scripted invalid, invalid, valid response sequence:
expect(observation.calls.filter(c => c.stage === "planning")).toHaveLength(3);
expect(observation.score?.planValid).toBe(true);
```

- [ ] Rerun tests; no-network/import-boundary test forbids evaluator dependencies on DB client, gateway openers, API bootstrap or receiver. Test CLI with network APIs and child-process spawn made to throw; runner vẫn hoạt động.

## Task 4 — Reports và CLI freeze/holdout

**Files:** Create `report.ts`, `cli.ts`; modify root `package.json`; test `ai-evaluation-report.test.ts`, `ai-evaluation-cli.test.ts`.

**Interfaces:** `summarize(observations: readonly Observation[]): EvalSummary`, `renderMarkdown(report: EvalReport): string`; define `EvalSummary`/`EvalReport` as strict schemas in contracts, including per-cell/per-split ratios, unique case counts, observed timing, total call counts, provenance and limitations below.

- [ ] Red tests: empty dataset/no observations không pass; missing trial/duplicate trial reject; failed trials included in appropriate denominator; unknown usage không thành zero; no mixed splits; report không claim AI quality; K10 control labelled correctly.
- [ ] Implement aggregate latency p50/p95 nearest-rank (`ceil(p*n)-1`), sample count và timing scope. Chỉ hiển thị offline in-process timings; không certify provider/pgvector end-to-end SLA từ các số này. Missing metric là null kèm reason. Cost bằng 0 chỉ cho verified synthetic calls có `costBasis=synthetic_no_billing`; live cost/latency vẫn null. Fixture token usage, nếu có, gắn synthetic.
- [ ] `EvalReport` chứa `format`, `mode`, `harnessVerdict`, `aiEvaluationVerdict`, fingerprints, freeze hash, dirty source hashes, runtime/platform, exposure note, observations, summary, limitations; không embed environment hay credential. Store only safe error codes, fixed messages; test canary secret không lọt report.
- [ ] CLI có default `dev`; `freeze` ghi cấu hình hiện tại; `holdout --freeze <path>` verify trước chạy. Output mỗi run có directory mới, ghi bằng exclusive create (`wx`); không overwrite evidence. Nếu failed/cancelled, report giữ completed rows cùng planned/completed/failed counts và nonzero exit. Không âm thầm resume.

```json
{ "ai:eval:offline": "npm run build -w @wap/dsl && npm run build -w @wap/engine && node packages/engine/dist/ai/evaluation/cli.js" }
```

Lệnh mới chỉ dùng sau khi script được tạo:

```powershell
npm run ai:eval:offline -- dev
npm run ai:eval:offline -- freeze
# Windows paths with spaces are safest when passed directly to the built CLI:
$ai04FreezePath = 'D:\\absolute path returned by freeze\\freeze.json'
node packages/engine/dist/ai/evaluation/cli.js holdout --freeze $ai04FreezePath
```

- [ ] Exit codes: 0 harness checks pass; 1 fixture/probe failure hoặc interrupted run; 2 invalid config/freeze/input. Semantic recall của synthetic vectors thấp không làm harness fail; tính đúng metric mới là gate.
- [ ] Temp-directory CLI test: dev không xuất holdout observations; holdout thiếu freeze exit 2/zero calls; drift exit 2; hợp lệ tạo 84 rows; input paths giữ nguyên hashes; rerun không ghi đè artifact.
- [ ] JSON/Markdown dùng chung validated report. Deterministic comparison loại bỏ observed timing/timestamps/run directory; còn schedule, hashes, outcomes, intents, recall phải giống nhau.

## Task 5 — Regression gates, review và evidence

**Files:** Existing benchmark test, engine README, AI status, AI backend plan. New generated evidence chỉ sau khi chạy thành công.

- [ ] Sửa synthetic provider/model metadata trong benchmark cũ và mô tả claim p95/recall trong current status/AI plan. Không sửa lịch sử để làm holdout có vẻ chưa từng được chạy; không đổi gold dataset.
- [ ] Run toàn bộ targeted offline suites; engine build và root `npm run check`. Ghi exit code/totals/skips thật.

```powershell
npm run test:unit -w @wap/engine -- ai-evaluation-dataset.test.ts ai-evaluation-scorer.test.ts ai-evaluation-runner.test.ts ai-evaluation-report.test.ts ai-evaluation-cli.test.ts
npm run check
```

- [ ] Run dev → freeze → holdout với offline fixtures. Inspect actual JSON/Markdown, counts 126/84, canary-redaction và reproducible fields. Không claim 210 independent tasks; chỉ 10 unique cases, dev/holdout tách riêng.
- [ ] Chạy `npm run check:backend` ở final implementation state, tuần tự. Các existing suites `ai-replan.integration.test.ts`, `controller.integration.test.ts`, filesystem/HTTP integrations cung cấp engine evidence cho approval/unknown-write/dry-run write behavior; fresh test execution là evidence, không import pass cũ vào current report như đo lại.
- [ ] Recovery correctness trong offline runner là `NOT_MEASURED`; add separate engine safety evidence với command, source hashes, timestamp và report path. Missing evidence = `NOT_RUN`; không suy ra zero unapproved writes từ việc pure runner không gọi receiver.
- [ ] Independent Code Reviewer kiểm oracle false positives, denominators, freeze enforcement, metadata/secret boundaries, holdout exposure và no side effects. Main xử lý concrete findings; reviewer không sửa code.
- [ ] `git diff --check`, inspect changed/untracked files, update chỉ gate `AI-04 offline harness`. `AI-04 live evaluation` và overall AI vẫn `NOT_RUN`; rubric/representative work vẫn external OPEN.

## Acceptance và handoff

| Gate | Bằng chứng bắt buộc |
|---|---|
| Dataset/split | IDs unique, fixed 6/4, hash drift rejected |
| Oracle | Wrong recipients/rows/extra writes bị phát hiện dù plan valid |
| Pipeline | Real adapters/validators exercised with explicit synthetic ports; repair/failure captured |
| Freeze | Holdout thiếu hoặc sai freeze bị chặn trước calls |
| Report | Correct denominators/null semantics, 126/84 rows, K10 control, per-split counts |
| Isolation | Offline CLI không credentials/network/receiver/demo DB; artifact writes exclusive |
| Engine safety | Fresh isolated backend tests; separated from fixture metric tables |
| Evidence honesty | Exposure history disclosed; harness PASS không nâng live AI verdict |

AI-04 offline hoàn tất khi tất cả gates trên có evidence và không còn blocking finding. Live semantic/task/recovery quality, paid usage và provider end-to-end latency cần provider readiness và evaluation riêng sau này. Không chặn offline completion vì chưa có key.

**Execution preference:** Main triển khai trực tiếp theo T1→T5 trong checkout hiện tại. Plan này chưa triển khai code, chạy evaluation hoặc tạo commit.
