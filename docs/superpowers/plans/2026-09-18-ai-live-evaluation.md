# AI Live Evaluation Preparation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement task-by-task directly in the current checkout. Main implements, respecting the user's preference; independent review checks the sensitive boundaries. Steps use checkbox syntax. No new worktree, forced model routing, commit or push without a separate request.

**Status:** PROPOSED — created 2026-09-18; amended 2026-09-19 after user confirmed Gemini for BOTH planning and embedding in this delivery. No implementation, credential access, paid provider request or database mutation was performed for this plan. `LIVE_EVALUATION_NOT_RUN`.

**Goal:** Chuẩn bị pipeline có thể đánh giá planning/retrieval/QE/replan với provider thật, kiểm soát chi phí và tạo bằng chứng trung thực, trước khi mở lượt chạy trả phí.

**Architecture:** Engine dùng canonical ports/validator; embedding port bổ sung document/query purpose. Triển khai native OpenAI và Google Gemini adapters, schema codecs riêng, registry/config/ledger dùng chung; provider planning/QE/embedding chọn độc lập. Live evaluator có config/freeze/journal/report theo profile, không dùng oracle-replay làm nguồn sinh plan. Integration safety chạy tách biệt trong DB/gateway test, không thực thi writes trên dữ liệu demo.

**Tech Stack:** TypeScript, Node theo engines hiện có (`^22.12.0 || >=24.0.0`), Zod 4, Vitest 4.1.11, PostgreSQL 16/pgvector, native `fetch`, PowerShell. Không thêm queue, UI framework hay migration nếu schema provenance hiện tại đủ dùng.

**Spec:** `docs/superpowers/specs/2026-09-17-ai-backend-design.md`, amended by `docs/superpowers/specs/2026-09-19-ai-multi-provider-design.md`; `testdata/experiment-manifest.json`. Historical AI-00 plan is context, not an OpenAI-only constraint. Scope authority: `docs/BASELINE.md`; execution authority: `docs/EXECUTION-CONTRACT.md`. AI-04 offline plan là bằng chứng tiền đề, không phải chứng nhận live readiness.

## Global Constraints

- B/local: catalog 8 task_hub + 2 filesystem tools đã review; exact cosine pgvector; không SaaS/GitHub, hybrid/BM25 hay tool ngoài catalog.
- Một planner, tối đa 3 planning calls gồm lần đầu; local replan tối đa 2. Không retries ngầm nhân các giới hạn này.
- Một sequential worker; không auto-resume, không thực thi song song application workflows.
- Giữ DSL, validator, policy, preview bất biến, approval TTL 10 phút, owner/version/lease/currentness và unknown-write reconciliation. Không để provider trực tiếp dispatch tools hoặc phê duyệt writes.
- Secret chỉ ở backend process; không repo, command arguments, prompt, evidence, frontend, log hay MCP child environment. Không lấy credential từ cấu hình/token của Codex.
- Không đổi model đã chọn khi gặp lỗi. Mọi fallback phải explicit; default là fail closed.
- OpenAI và Google Gemini phải có implementation cho cả planning/replan, QE và embedding trong cùng delivery; Google không được chỉ là enum hoặc deferred stub. Không tự động chạy đồng thời nhiều profile hoặc mở rộng sang Vertex AI/proxy.
- Không coi test pass, mock, oracle-replay hoặc model confidence là AI quality evidence.
- Giữ thay đổi đang có trong worktree và evidence lịch sử. Plan này không tự chuyển status hiện tại sang PASS.

## 1. Readiness đã đối chiếu

| Hiện trạng kiểm tra từ source | Việc phải làm trước live |
|---|---|
| `ai/ports.ts`, planner, repair, replan và pgvector index đã tồn tại | Reuse seams; không viết lại engine |
| `apps/api/src/ai-planner.ts` dùng character-hash cho catalog, `InMemoryToolRetriever`, metadata cũ; model mặc định báo unconfigured | Production AI path phải bỏ synthetic embedding và nhận provider/retriever thật |
| `apps/api/src/main.ts` chỉ nối `loadAiPlanner`, chưa nối `loadAiReplan` | Nối cả hai bằng cùng config/provenance; giữ default AI disabled |
| `PlannerResultSchema` là root discriminated union, có dynamic maps và optional fields | Không gửi nguyên Zod schema sang strict Structured Outputs; cần provider wire codec |
| Offline config/report khóa `offline`, `oracle_replay`, paid usage `NOT_RUN` | Live contracts/report riêng; không đổi nhãn report offline thành live |
| Offline runner có model factory nhận cả `EvalCase` chứa gold answer | Live model factory không được nhận oracle; tách input công khai và scorer data |
| b07–b10 đã được fixtures/tests offline sử dụng | Chỉ dùng lại làm live regression có disclosure; không gọi là untouched holdout |
| Oracle hiện so fixture reads/write intents/outputs khá chặt | Tách structural executability khỏi semantic quality; nhận diện equivalent plans và ca cần người review |
| Rubric nguồn chính thức và tác vụ đại diện người dùng vẫn OPEN | Pilot có thể exploratory; không tuyên bố đạt rubric hoặc chất lượng tổng quát |

Không cần API key để triển khai và kiểm thử Tasks 1–7 bằng transport giả. Key chỉ cần ở Task 8 sau readiness review và phê duyệt ngân sách.

## 2. Quyết định đề xuất cho lần đánh giá đầu

| Hạng mục | Cấu hình đề xuất, chưa phải live-verified |
|---|---|
| Provider/endpoint | Select `openai` hoặc `google`; host allowlist tương ứng `api.openai.com` / `generativelanguage.googleapis.com`; reject redirect/host khác, không dùng config Codex |
| Planner + replan | Profile OpenAI: `gpt-5.6-terra`/Responses/low/4096; profile Google: model ID bắt buộc từ config, Gemini Interactions, settings đã capability-check, output cap 4096; không tự chọn Google model |
| QE | Mặc định resolve theo planning; override provider/model riêng được hỗ trợ; output cap 1024, tối đa 6 intents, không biết gold tools/answer |
| Embedding | Chọn provider/model độc lập; 1536 chiều cho cả hai, task/normalization/preprocessing policy theo model; profile OpenAI giữ `text-embedding-3-large` |
| Sampling | Không gửi temperature/seed mặc định; ghi `omitted` và capability-probe kết quả, không hứa deterministic |
| Time/calls | 120s toàn trial gồm retrieval/QE/repair; mỗi HTTP request tối đa 45s và không vượt thời gian còn lại; concurrency 1; transport retries 0 |
| Caching | Catalog embeddings tạo một lần/version; không query/QE cache giữa trials của campaign đầu; provider cache usage ghi riêng |
| Provider features | Text structured output; không hosted tools/web search/background/tool loop; storage/privacy settings kiểm theo từng API, không gửi field của OpenAI sang Google |
| Data | Chỉ synthetic local fixture prompts, catalog đã review và completed outputs đã redaction; không dữ liệu cá nhân thật |

Theo tài liệu kiểm tra ngày 2026-09-18, Terra hỗ trợ Responses/Structured Outputs; giá niêm yết input/output là $2/$12 mỗi triệu tokens, cached input $0.20. Alias không tự chứng minh phiên bản bất biến hoặc quyền truy cập của tài khoản. Probe phải ghi model requested/returned; nếu không có immutable revision, ghi rõ giới hạn tái lập. [OpenAI Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra).

Structured Outputs yêu cầu root object, không root `anyOf`, các fields required và object đóng. Đây là lý do cần wire codec, không phải lý do nới DSL. [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

Embedding large mặc định 3072 nhưng hỗ trợ tham số giảm chiều; phải request 1536, không cắt vector tùy tiện. Giá niêm yết $0.13/triệu input tokens. [Embedding guide](https://developers.openai.com/api/docs/guides/embeddings), [embedding model](https://developers.openai.com/api/docs/models/text-embedding-3-large).

`max_output_tokens` tính cả visible output và reasoning; incomplete output phải là outcome riêng. `store: false` không phải cam kết zero retention của provider. Không lưu raw HTTP response trong evidence. [Responses reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).

Các thông số/giá OpenAI bên trên chỉ áp dụng profile OpenAI. Google schema, task policy embedding, normalization và usage mapping có contract riêng theo [multi-provider spec](../specs/2026-09-19-ai-multi-provider-design.md). Cấu hình Google cần exact model IDs; chọn model được hỗ trợ bằng config không cần sửa engine nhưng phải có capability contract và live probe. Price card Google là input bắt buộc trước paid phase; không mượn giá OpenAI và không coi free tier là bảo đảm chi phí bằng zero.

## 3. Hai mốc nghiệm thu và giới hạn tiền

**Mốc A — READY_FOR_LIVE_PROBE:** Tasks 1–7 hoàn tất cho cả OpenAI và Google, gồm bốn tổ hợp planning × embedding, bằng fake transport và isolated integration tests. Không cần key; chất lượng live vẫn `NOT_RUN`. Probe readiness và live verification ghi riêng theo profile.

**Mốc B — LIVE_EVALUATION_REPORTED:** Có authorization, probe hợp lệ, cost ledger và report đầy đủ. Báo cáo hoàn tất không đồng nghĩa model đạt chất lượng; verdict phải dựa trên dữ liệu và tiêu chí khai báo trước.

Ngân sách **PROPOSED**, đơn vị USD: probe/catalog/smoke tối đa $2; dev $10; legacy regression $7; live replan smoke $1; tổng campaign đầu $20. Chưa có quyền chi tiền. Các lượt tune/dev rerun vẫn trừ cùng campaign, không reset cap bằng run ID mới. Fresh sealed holdout cần proposal/authorization riêng sau pilot, không nằm ngầm trong $20.

Amendment: $20 là tổng chung tất cả provider/profile, không phải $20 mỗi provider. Phải phân bổ profile/phase caps và chọn các matrix sẽ chạy trước authorization; hỗ trợ hai provider không tự nhân đôi ngân sách. Probe/smoke hai pure profiles là mục tiêu live readiness; thiếu quyền/key/headroom cho profile nào thì profile đó NOT_RUN/PARTIAL. Mixed-profile full campaigns chỉ chạy khi được duyệt riêng trong cùng tổng cap hoặc budget mới được user chấp thuận.

- Refresh pricing snapshot trước paid phase; xác nhận account/API access mà không đọc hoặc in key. Mọi giá/currency/rate rule có source URL, thời điểm và hash.
- Local budget control là reservation bảo thủ trước call + usage settlement sau call. Không gọi nó là billing hard cap tuyệt đối khi chưa có upper bound token đáng tin cậy hoặc hóa đơn cuối cùng.
- Unknown usage/cost là `null` với reason; giữ reservation cho request có thể đã bill, không giải phóng thành zero khi timeout/crash. Dừng campaign khi không thể chứng minh headroom còn đủ.
- Output/thinking/cache categories được ánh xạ theo provider/API/model; không cộng trùng tokens đã bao gồm nhau, không ép Google usage theo OpenAI semantics. Chỉ tính billable components khi đủ metadata/rule; nếu thiếu thì ghi estimate/unknown, không giả dạng actual cost.
- Budget exhaustion, 401/403, schema unsupported, model mismatch, safety violation, redaction failure hoặc evidence sink failure: ngừng mở call mới, lưu phần đã có, trả nonzero/partial. 429/5xx không retry tự động trong campaign đầu; ghi Retry-After nếu có và sanitized.
- Không cam kết $20 đủ chạy hết. Sau smoke dùng usage đo thật để dự báo phần còn lại; thiếu tiền thì báo partial hoặc xin đổi scope/budget, không âm thầm giảm repetitions/cells.

## 4. Dataset, số lượt và tuyên bố được phép

Giữ nguyên manifest gốc và 7 cells của AI-04: `all_tools@10`, `semantic@3/5/10`, `semantic_qe@3/5/10`. Không nhân all_tools ba lần theo K vì candidate set không đổi.

Bảng dưới tính **mỗi profile**. Hai pure profiles đầy đủ = 420 trials; cả bốn planning×embedding profiles = 840 trials, không tự được cấp quyền chạy. Profile IDs/config hashes luôn có trong trial key và report. So sánh hai pure profiles chỉ đo toàn pipeline; muốn quy kết khác biệt cho planner thì cố định embedding/QE hoặc duyệt thí nghiệm factorial riêng.

| Phase | Dataset / số trials | Mục đích |
|---|---|---|
| Capability + smoke | Mỗi profile: 3 branch probes plan/refusal/clarification, 1 QE probe, 2 embedding probes (document/query); sau đó 3 dev cases × 3 variants × 1 rep với K=10 | Compatibility/usage, không quality claim |
| Dev matrix | b01–b06 × 7 cells × 3 reps = 126 | Tune chỉ trên dev; giữ mọi run history |
| Legacy regression | b07–b10 × 7 cells × 3 reps = 84 | Paired regression sau freeze, exposure `previously_exercised_by_offline_tests` |
| Sealed holdout | Bundle mới do người dùng/reviewer phê duyệt, N cases × 7 × 3 | Đánh giá ngoài bộ đã tiếp xúc; chỉ chạy khi rubric/bundle/budget được duyệt |
| Replan integration | Fault probes riêng với case IDs/expected safety outcomes | Recovery evidence riêng, không gộp mẫu số planning quality |

210 trials đầu chỉ là 10 tasks lặp lại, không phải 210 tasks độc lập. Không kết luận superiority thống kê từ tập rất nhỏ. Báo cáo theo case/cell, tỷ lệ kèm mẫu số, variability của repetitions; refuse/clarify chỉ tính trên đúng loại case; recall chỉ tính khi expected tool set không rỗng.

Upper bound cho **126+84 trials của một profile**, chưa tính smoke/probes/replan/reruns, không transport retries: 630 planning calls + 90 QE calls + tối đa 720 query embedding calls + 10 catalog embeddings = 1450 calls nếu mỗi embedding một request. Đây là planning bound, không số call thực tế hay dự báo chi phí. Ledger đếm actual; catalog chỉ reuse khi cùng exact embedding profile/catalog và artifact đã verify; không tính hai lần chi phí setup dùng chung.

Manifest gốc yêu cầu `rubric_source`. Khi chưa có, ghi `formalManifestEligibility: blocked_missing_rubric`; chỉ cho phép mode `exploratory_regression` được user chấp thuận khi mở paid phase. Không tự sửa manifest thành PASS hoặc tạo threshold 90% hậu nghiệm. Fresh holdout không tự sinh rồi đánh dấu approved; approval record và exposure history phải có thật.

## 5. File map và thứ tự

Các đường dẫn dưới đây là **dự kiến tạo/sửa khi triển khai**, không phải files đã có đầy đủ.

| Task | Files chính | Trách nhiệm |
|---|---|---|
| T1 | Create `packages/engine/src/ai/providers/{config,capabilities}.ts`, `scripts/start-ai-local.ps1`; modify `.env.example`, `.gitignore` | Non-secret per-role profiles, hidden selected-provider keys, explicit paid authorization |
| T2 | Create `packages/engine/src/ai/providers/{openai,google}/wire-schema.ts` | Hai provider codecs, canonical DSL không đổi |
| T3 | Create `packages/engine/src/ai/providers/{registry,accounting}.ts`, `providers/{openai,google}/{transport,clients}.ts`; modify `packages/engine/src/ai/ports.ts` | Hai native adapters, document/query purpose, shared all-call ledger |
| T4 | Create `packages/engine/src/ai/catalog-embedding.ts`; modify `apps/api/src/{ai-planner,main}.ts`, `packages/engine/src/ai/{retrieval,pgvector-index}.ts`, `packages/engine/src/index.ts` | Expected embedding profile, atomic sequential activation, real planner/replan wiring |
| T5 | Create `packages/engine/src/ai/live-evaluation/{contracts,dataset,scorer}.ts`, `testdata/ai-live-eval-config.json`, `testdata/ai-live-rubric.json` | Explicit profile matrix, input/gold separation, exposure, rubric/adjudication |
| T6 | Create `packages/engine/src/ai/live-evaluation/{freeze,journal,runner,report,cli}.ts`; modify `package.json` | Scheduled trials, crash-safe evidence, freeze/CLI and report |
| T7 | Tests listed below; modify `apps/api/README.md`, `packages/engine/README.md`, `docs/AI-STATUS-2026-09-17.md`; create `docs/AI-LIVE-EVALUATION-RUNBOOK.md` | Offline readiness gate, isolated safety gate, instructions and honest status |
| T8 | Ignored `.artifacts/ai-live/<campaign>/<run>/`; reviewed summaries under `docs/ai-evidence/AI-LIVE/` | Authorized execution evidence, no production code by default |

Dependency order: T1 → T2 → T3 → T4; T5 → T6 consumes T1–T4; T7 → authorization → T8. Runtime never imports evaluator. Shared provider code never imports expected answers. Existing offline evaluator remains usable and strictly offline.

## Task 1 — Explicit config and secret boundary

**Test:** Create `packages/engine/tests/ai-provider-config.test.ts`, `scripts/tests/start-ai-local.test.ps1`. Test only dummy canaries; never request a real key in CI.

**Interfaces:** `readAiProviderConfig(env: Readonly<Record<string, string | undefined>>): AiProviderConfig`; `AiProviderConfig` contains resolved `planning`, `queryExpansion`, `embedding` and shared `limits`. Generation selections are discriminated by `provider: "openai" | "google"` with explicit model/API mode and strict provider-specific settings. Embedding selection contains provider/model/API mode, dimensions=1536, paired document/query policy and normalization. Credentials stay separate. Capability registry validates supported model/API/role/settings combinations; unknown combinations fail before calls, never silently discard unsupported settings.

- [ ] Write RED tests for invalid endpoint/dimension/deadline, missing credential only in live mode, and manual/dev_fixture startup with no key. Config parsing itself must perform zero network calls.
- [ ] Run `npm run test:unit -w @wap/engine -- ai-provider-config.test.ts`; confirm the new contract is absent/failing before implementation.
- [ ] Implement required `AI_PLANNING_PROVIDER/MODEL`, `AI_EMBEDDING_PROVIDER/MODEL` inputs and optional paired `AI_QE_PROVIDER/MODEL` override as specified in the amendment. Missing Google model ID is a configuration error, not permission to choose one. Error messages contain field names, never values.
- [ ] Resolve only selected credentials: pure Google uses `GEMINI_API_KEY`, pure OpenAI uses `OPENAI_API_KEY`, mixed uses both only for the appropriate requests. No lookup of unused-provider secrets; provider-specific host/auth allowlist cannot be overridden through arbitrary base URLs.
- [ ] Implement PowerShell launcher with hidden `Read-Host -AsSecureString`, process-local injection for the launched backend/eval process, and `finally` restoration/clearing. No `setx`, transcript, key arguments or persistent dotenv write. A key is not an authorization token for arbitrary spending.
- [ ] Add separate non-secret approval record bound to campaign, phase, profile/config hash, selected providers/models, budget and expiry. CLI `--execute` requires this record plus explicit live mode; planning/preflight defaults deny paid calls. Records document actual user approval, not fabricate it.
- [ ] GREEN tests include child-env canary absent from both MCP servers, no secret in errors/config/evidence/stdout, restoration on launcher failure, and no inherited unrelated environment spread.

Contract example, testable without a key:

```ts
import { expect, test } from "vitest";
import { readAiProviderConfig } from "../src/ai/providers/config.js";
test("does not silently choose a Gemini planning model", () => {
  expect(() => readAiProviderConfig({
    AI_PLANNING_PROVIDER: "google",
    AI_EMBEDDING_PROVIDER: "openai",
    AI_EMBEDDING_MODEL: "text-embedding-3-large",
  })).toThrow(/AI_PLANNING_MODEL/);
});
```

**Exit:** Safe config/launcher, no account probe; `LIVE_EVALUATION_NOT_RUN`.

## Task 2 — Strict wire schema without weakening DSL

**Tests:** Create `packages/engine/tests/ai-openai-wire-schema.test.ts` and `ai-google-wire-schema.test.ts`. Canonical authority remains `packages/dsl/src/schema.ts` and current engine validator.

**Interfaces:** Each provider's `wire-schema.ts` exports `plannerWireJsonSchema`, `encodePlannerWire(result: PlannerResult): unknown`, `decodePlannerWire(value: unknown): PlannerResult`. Factory selects the codec by provider/API capability; no provider branches in engine. Import `PlannerResult` from `@wap/dsl`. QE has separate `{ queries: string[] }` schema, not the planner union.

- [ ] RED tests per provider: schema obeys its declared capability subset; all 10 fixture results round-trip; malformed/duplicate map keys rejected; nested args arrays/objects/null/references preserved. OpenAI-specific root/required/closed-object assertions do not masquerade as universal Gemini requirements.
- [ ] Implement the OpenAI envelope `{ result: <nested plan|refusal|clarification union> }`. Dynamic `inputs`, `outputs`, `tool.args` maps become arrays of `{ key, value }`; optional fields use required nullable wire fields decoded to omission/default where canonical semantics permit it. Google's codec initially targets the same lossless representation but compiles JSON Schema against Google capabilities; runtime canonical constraints must not be dropped if remote schema cannot express them.
- [ ] Recursive arg wire representation: primitives, arrays, or closed `{ entries: [{ key, value }] }` for objects. Preserve literal null inside args; reject duplicate keys, enforce payload/depth bounds, build own-properties safely. Do not reinterpret strings as code or JSON programs.
- [ ] Keep canonical draft restrictions: provider must not choose runtime retry/timeout fields forbidden by `LlmPlanDraft`. Decode then `PlannerResultSchema.parse`, then existing structural/policy validators; codec success alone never authorizes execution.
- [ ] Add a provider prompt suffix describing the wire representation; hash it with normal system/planning/repair/replan prompts. Reject unsupported input schema instead of silently ignoring `StructuredModelClient.complete().schema`.
- [ ] Run `npm run test:unit -w @wap/engine -- ai-openai-wire-schema.test.ts ai-google-wire-schema.test.ts` GREEN; compile/hash each request schema and codec prompt suffix separately for the exact provider probe. Never fall back to unconstrained text because one schema is rejected.

Round-trip assertion pattern (tests read existing dataset, not provider):

```ts
const canonical = PlannerResultSchema.parse(fixture.expected_result);
expect(decodePlannerWire(encodePlannerWire(canonical))).toEqual(canonical);
```

`PlannerResultSchema` comes from `@wap/dsl`; `fixture` is each parsed case from `testdata/test-cases.json`. This test proves representation fidelity, not model quality. If the real API rejects this schema, stop at the probe, fix the codec on dev and regenerate freeze; never downgrade to unconstrained text invisibly.

## Task 3 — OpenAI + Gemini clients and accountable HTTP boundary

**Tests:** Create `packages/engine/tests/ai-openai-{transport,clients}.test.ts`, `ai-google-{transport,clients}.test.ts`, `ai-provider-{registry,accounting}.test.ts`. Update existing fake embeddings/callers for the required purpose contract; search through CodeGraph before edits, never default missing purpose silently.

**Interfaces:** `createAiPorts({config, credentials, fetchImpl, ledger})` in `registry.ts` composes `StructuredModelClient`, `QueryExpansionPort`, `EmbeddingPort` from per-role native adapters. `fetchImpl: typeof fetch` and provider-keyed credential resolver are injected. Extend `EmbeddingPort.embed` input and `EmbeddingResult` with required `purpose: "document" | "query"`. `CallLedger` exposes `reserve(input): Promise<string>` and `settle(callId, outcome): Promise<void>`; both fail closed. Reservation includes campaign/run/profile/trial IDs, provider, operation purpose, embedding role where relevant, requested model, request hash, output cap and upper cost estimate. Outcome has returned model, error, time, provider usage categories or null, request-ID hash, cost/estimate status. Ledger storage/accounting is not inside OpenAI-specific code.

- [ ] RED fake-fetch tests for planner/QE/embedding success, refusal content, incomplete response, missing usage, malformed JSON/vector, model mismatch, 401/403/429/5xx, network disconnect, caller cancel and deadline. No real provider is used by tests.
- [ ] Implement OpenAI native `/responses` and `/embeddings`, plus Google native `/v1beta/interactions` and `/v1beta/models/{model}:embedContent` with provider-specific headers/settings/response parsers. Model path is validated/encoded, never arbitrary user URL. No automatic HTTP retry/redirect, no logged header/body. Compose request timeout with caller signal, clear timers/listeners, enforce response size cap and content types.
- [ ] Reserve and persist call metadata before each dispatch, settle in all terminal paths. Count requests that fail before returning valid output. Usage accounting happens before model-output validation so billed malformed responses are included. Durable sink failure prevents the next call.
- [ ] Extract structured response text from completed output messages only; distinguish provider refusal from valid domain `{kind: "refusal"}`. Decode canonical planner result and retain current repair budget; reject unsupported/incomplete transport output without fake success.
- [ ] Embeddings must be finite/nonzero, exactly 1536 and carry the requested purpose. Implement and test model-specific document/query task policy and normalization from the amendment; send one text item per call, never aggregate the 10 catalog tools into one vector. QE validates trim/nonempty/at-most-6; every expanded query uses the selected embedding provider's query mode, not QE provider's embedding by assumption.
- [ ] Map usage and errors independently for Google and OpenAI, including Google safety block/empty output and thinking usage. Missing metadata stays unknown; billed rejected candidates still count. Capability fixtures must show that no OpenAI-only parameter or Authorization credential leaks into a Google request or vice versa.
- [ ] Implement monetary calculations using integer micro-USD or exact decimal arithmetic. Include every purpose: probe, catalog embedding, query embedding, QE, planning, repair and replan. Unknown cost does not become zero; reservation survives ambiguous timeout/crash. One exclusive campaign writer owns the ledger; a second API/eval process must fail before dispatch, and stale ownership cannot silently reset reservations.
- [ ] GREEN targeted tests plus cancellation spy: after abort/budget stop, fetch call count cannot increase. Canary in header, error body, generated text and provider request ID must not enter published artifacts.

Budget invariant to test against fake ledger state:

```text
before dispatch:
  require approval.scope matches campaign + phase + profile/config hash + providers/models
  require settled_known_cost + unresolved_reservations + next_reservation <= phase AND campaign caps
  persist reservation; only then call fetch
after response:
  persist usage/model/error even if candidate decoding fails
on ambiguous timeout:
  cost = null; keep reservation; stop if remaining headroom is uncertain
```

Actual provider IDs may remain in process memory for debugging; persisted artifacts use validated/redacted IDs or hashes. No raw HTTP payload or hidden chain-of-thought retention. Data storage flags/policies are provider-specific; never infer equivalent retention or billing semantics from a shared port.

## Task 4 — Real catalog embeddings, pgvector and runtime wiring

**Implementation status (2026-09-19):** Core T4 runtime path is implemented and
offline/isolated-tested. Paid provider calls and real catalog contents remain
`NOT_RUN`; explicit catalog preparation belongs to T6/T8.

**Tests:** Create `packages/engine/tests/ai-live-index.integration.test.ts`; extend `apps/api/tests/ai-planner-http.test.ts`, `packages/engine/tests/ai-pgvector.integration.test.ts`, `packages/engine/tests/ai-replan.integration.test.ts` using fake provider transport only.

**Interface:** `buildCatalogEmbeddingRows(catalog: ReviewedCatalogSnapshot, embeddings: EmbeddingPort, signal?: AbortSignal): Promise<readonly ToolEmbeddingRow[]>` in `catalog-embedding.ts`; types come from current catalog/retrieval modules. Serialize reviewed tool identity, description, input/output schema and side-effect policy canonically as `reviewed-tool-json-v1`; hash the exact text/preprocessing implementation. Call `PgvectorCatalogIndex.activate({catalog, rows})` only after the complete batch validates.

Call `embed({text, purpose: "document", signal})` in builder; retrievers always use `purpose: "query"` and check response purpose. `ToolEmbeddingRow` requires document purpose on activation. Extend retriever construction with expected embedding profile/provenance; compare it against activeIndex before QE/query provider calls. Paired task policy/normalization/API identity hashes are part of `preprocessingVersion`; persist the non-secret policy manifest alongside freeze. Legacy index without the new provenance is rejected, not relabelled.

- [x] RED/GREEN integration tests cover query/catalog model mismatch, synthetic and legacy provenance, incomplete index, catalog/policy drift and query cancellation. Use existing isolated DB test setup, not `wap_g1` demo data; never reset a shared volume.
- [ ] Build catalog vectors once per catalog/provider/model/dimension/preprocessing identity; persist actual vectors and activation ID/hash. Failed embedding leaves previous valid active index intact. Reuse only exact provenance match; catalog embedding cost belongs to campaign setup.
- [x] Preserve one active index per user+catalog from migration 0007. Profile switching is explicit; switching embedding is not implicit inside retrieval. Multi-active schema support was not added.
- [x] The isolated pgvector suite covers full replacement, supersession and concurrent activation; retriever profile drift fails before QE/query provider calls. Each runtime retriever pins the active index provenance and catalog hash.
- [x] Refactor `LoadAiPlannerOptions` to require an explicit retriever factory for AI production: `createRetriever(catalog: ReviewedCatalogSnapshot): ToolRetriever`. Remove hidden synthetic rows/defaults from production loader. Unit tests inject explicitly labelled synthetic ports, not default fallbacks.
- [x] In backend composition root, resolve one selected profile via `createAiPorts` and use `PgvectorToolRetriever` for planner/replan. Wire `loadAiReplan` into `WorkflowEngine`. Missing selected-provider key/index/QE dependency fails clearly; pure Google/OpenAI credentials are resolved independently; manual/dev_fixture remain unaffected.
- [x] Do not auto-build a paid catalog on API startup or ordinary plan request. Runtime only selects and validates the existing active index; explicit preparation remains a later CLI task.
- [x] Add selected-provider keys to backend secret-redaction inputs without logging them. Task-hub/filesystem child transports already receive explicit sanitized environments.
- [ ] GREEN tests verify replan is actually called in AI wiring; stale owner/version/lease results discarded; missing capability never falls back to fixture or an alternate model.

**Exit:** Offline-tested real adapter path, production AI still disabled by default. Real index contents remain `NOT_RUN` until T8.

## Task 5 — Fair dataset boundary and quality rubric

**Implementation status (2026-09-19):** Core T5 dataset boundary and semantic quality rubric implemented and verified by 25 passing unit tests.

**Tests:** Create `packages/engine/tests/ai-live-{dataset,scorer}.test.ts`. Do not alter gold data in `testdata/test-cases.json` to make a model pass.

**Interfaces:** `LiveCaseInput = { id: string; prompt: string; runtime: Record<string, string> }`; `toLiveCaseInput(caseData): LiveCaseInput` explicitly copies only these fields. Gold expected tools/results/write intents/read fixtures belong to evaluator-private `LiveCaseOracle` and are never passed to ports/model factories. `scoreLiveCandidate` returns separate `structuralValidity`, `fixtureExecutability`, `semanticJudgment`, `safetyViolations`, and `reviewReason`; semantic judgment is `correct | incorrect | needs_review`, not guessed from syntax.

- [x] RED test places a unique gold-only canary in expected results/fixtures; inspect all fake provider requests across planning/repair/QE and prove it is absent. Repair may receive validator errors, not gold answers or scorer suggestions.
- [x] Define strict `ai-live-eval-config.json` profile entries with unique IDs, resolved role selections/settings, limits and capability references. Paid execution has no default profile list. Test fixtures explicitly configure all four combinations; operator config supplies exact Google model IDs before live preflight. Reject unknown profiles and unresolved model/settings without reading a credential or calling network.
- [x] Parse existing cases without changing labels. Store original manifest split separately from evaluation exposure: b07–b10 are `legacy_regression`, not sealed holdout. Provider requests do not include gold/split/exposure fields.
- [x] Draft `testdata/ai-live-rubric.json` as `PROPOSED_EXPLORATORY`, hash/version it; define semantic success by requested read/write/output intent, refusal reason category and clarification's missing information. Human approval absent means formal quality gate remains blocked, not auto-approved by file existence.
- [x] Reuse strict offline scorer for deterministic executability, but do not let exact step IDs/output names/write ordering automatically decide live semantic correctness. Add accepted-equivalent-plan tests, clearly wrong arguments/extra writes tests, legitimate clarification and unjustified refusal tests. Never normalize away genuinely ordered side effects.
- [x] If read fixtures cannot replay a semantically equivalent candidate, record `needs_review`/coverage limitation, not success or arbitrary failure. Persist sanitized canonical candidate/intent trace privately for adjudication; no model-as-judge in campaign one.
- [x] Require two independent adjudications for ambiguous examples (at least one plan-equivalence case and one refusal/clarification case); discrepancies stay unresolved until recorded resolution. Judge review is blinded to variant where practical.
- [x] Sealed holdout entry requires an immutable bundle approved by the user/rubric owner, declared exposure history, rubric and budget; attempts to relabel old cases as untouched or change cases/rubric after freeze fail before provider calls. A coding agent cannot approve its own generated holdout by writing an approval field.
- [x] GREEN tests: empty recall denominator is N/A, transport refusal is not automatically a correct domain refusal, duplicates/exposure contradictions fail, and repeats never inflate task count.

The initial campaign is permitted to remain exploratory with descriptive metrics. A fresh holdout is an explicit later gate, not a prerequisite for writing the harness or running an authorized compatibility probe.

## Task 6 — Durable live runner, freeze, report and CLI

**Tests:** Create `packages/engine/tests/ai-live-{contracts,freeze,runner,report,cli}.test.ts`. Production imports must not reference evaluator modules; offline command must remain network-free even when an API key exists in the environment.

**Core contract:**

```ts
type TrialState = "scheduled" | "running" | "completed" | "failed" | "cancelled" | "not_started";
type LiveEvidenceKind = "LIVE_PROVIDER" | "FAKE_TRANSPORT_TEST";
type TrialKey = { profileId: string; caseId: string; variant: "all_tools" | "semantic" | "semantic_qe"; topK: 3 | 5 | 10; repetition: 1 | 2 | 3 };
type LiveTrialRecord = {
  key: TrialKey;
  state: TrialState;
  evidenceKind: LiveEvidenceKind;
  callIds: string[];
  errorCode: string | null;
  candidateHash: string | null;
};
```

Export `scheduleLiveTrials(profileIds: readonly string[], caseIds: readonly string[]): readonly TrialKey[]` for the exact 7-cell/3-repetition matrix per profile. Scheduler rejects duplicate IDs; CLI validates every ID against resolved config before scheduling/calls. `runLiveEvaluation` consumes frozen profiles, public inputs, private scorer, ports/ledger, journal and AbortSignal via explicit injection; no `modelFor(fullFixture)` API. Pure runner has no execution Gateway; pgvector retrieval is injected by CLI composition. No default all-providers execution; CLI must select an authorized profile explicitly.

- [ ] RED contracts tests reject offline fixture IDs/`oracle_replay` as live evidence; fake client report is `FAKE_TRANSPORT_TEST`, never `LIVE_PROVIDER`. Strict schemas reject unknown/missing required fields rather than passthrough.
- [ ] Create the complete trial schedule before the first call. Group into sequential profile blocks; never interleave incompatible embedding spaces on the single active index. Use a frozen seeded order for cells/repetitions within a block and disclose profile order/time confounding; scheduling seed is not provider sampling seed. Use exclusive run directory creation and append-only validated journal events; flush reservation/start/terminal transitions. Final reports derive from journal plus scheduled inventory, not just successful rows.
- [ ] On cancel/crash, retain completed observations; unfinished started requests become interrupted/failed with unknown usage where appropriate; unstarted trials remain explicitly accounted for. Recovery command may finalize a partial report but cannot call provider or resume. Any rerun is explicit, linked and charged to the same campaign.
- [ ] Preflight and per-profile freeze record dataset/manifest/rubric, all prompts/codec/QE/repair/replan, resolved provider+model+API+settings for each role, capability version, embedding paired purpose policy/normalization, catalog/policy/tool artifacts, exact index/vector hash, provider-specific pricing and shared campaign budget, source/lockfile/runtime/Git dirty hashes. Never include env dumps or secrets. Changing the requested provider invalidates authorization/freeze even if model strings or dimensions match.
- [ ] Build source manifest deterministically from relevant source directories and explicit runtime/config inputs, not a fragile handpicked list of a few files. Exclude output folders to avoid self-referential hashes. Reject missing/changed files before each paid phase; do not demand a clean worktree, but fingerprint its exact content.
- [ ] Snapshot alias model identity from probe and require matching requested/returned model settings; document if provider cannot expose immutable revision. Freeze vector contents so a silent in-place index change is caught. Budget/model/price/rubric changes invalidate freeze, including apparently beneficial changes.
- [ ] Report planned/completed/failed/cancelled/not-started per profile/cell/split; each scheduled trial has exactly one terminal accounting record. Missing/duplicate rows or any cancelled/transport-failed trials prohibit a complete quality verdict. Model semantic failure is a completed observation with a bad score, not a missing row. Pure-profile comparison is end-to-end evidence, not attribution to planner quality; all_tools controls across identical planners remain correlated observations.
- [ ] Report plan validity, semantic judgments (including unresolved), refusal/clarification accuracy, recall, all-call costs/unknowns, repair counts, and latency separately for QE, query embeddings, pgvector query, full retrieval and end-to-end planning. Never use DB-only p95 to claim provider retrieval p95 ≤500ms. Report cold setup separately; sample counts accompany p95.
- [ ] Keep local sanitized candidates/journals under ignored `.artifacts/ai-live/`; publish only reviewed summaries under `docs/ai-evidence/AI-LIVE/`. No credentials, raw HTTP messages or unrestricted generated strings in public report. Cost ledger and trial records must reconcile exactly.
- [ ] Add opt-in `ai:eval:live` package script and subcommands below. `npm run check`, normal API startup and offline evaluation never call provider. CLI rejects unknown flags and conflicting phase/split options.

Planned CLI contract (commands do not exist yet):

```powershell
npm run ai:eval:live -- preflight --offline
npm run ai:eval:live -- probe --profile <profile-id> --campaign <id> --approval <approved-json> --execute
npm run ai:eval:live -- index --profile <profile-id> --campaign <id> --approval <approved-json> --execute
npm run ai:eval:live -- run --phase smoke --profile <profile-id> --campaign <id> --approval <approved-json> --execute
npm run ai:eval:live -- run --phase dev --profile <profile-id> --campaign <id> --approval <approved-json> --execute
npm run ai:eval:live -- freeze --profile <profile-id> --campaign <id>
npm run ai:eval:live -- run --phase legacy-regression --profile <profile-id> --freeze <freeze-json> --approval <approved-json> --execute
npm run ai:eval:live -- report --run <run-directory>
```

`<profile-id>`, `<id>`/paths are operator-provided actual config/campaign/artifacts, not literal runnable values. Each profile declares all effective role providers/models; CLI rejects a mismatch between selected profile and freeze/authorization. `preflight --offline`, `freeze` and `report` do no paid calls. Database connections use dedicated eval/test DB through `AI_EVAL_DATABASE_URL`; fail if absent or pointing at normal application DB. Never log its password.

Tests include:

```ts
expect(scheduleLiveTrials(["openai-only"], ["b01", "b02", "b03", "b04", "b05", "b06"])).toHaveLength(126);
expect(scheduleLiveTrials(["google-only"], ["b07", "b08", "b09", "b10"])).toHaveLength(84);
expect(scheduleLiveTrials(["openai-only", "google-only"], ["b01", "b02", "b03", "b04", "b05", "b06"])).toHaveLength(252);
```

Inject failure after several trials and verify durable inventory, unknown cost, nonzero exit and zero automatic new requests; mutate each freeze input and verify zero fetch calls. Repeat with Ctrl+C/deadline/429 and artifact write failure.

## Task 7 — Readiness verification and independent review

**Additional tests:** Create `packages/engine/tests/ai-live-replan.integration.test.ts`, `apps/api/tests/ai-live-wiring.integration.test.ts` using fake provider transport and isolated no-op/test Gateway. Extend redaction/isolation tests as necessary; do not create live tests auto-discovered by normal Vitest configs.

- [ ] Write RED tests proving API composition uses configured ports/index, and engine faults reach provider-backed replan seam without any real tool receiver write. Record every simulated dispatch.
- [ ] Run the same native-adapter contract and fake-HTTP/API integration checks for OpenAI/OpenAI, Google/Google, OpenAI/Google and Google/OpenAI planning×embedding; additionally test QE override. Pure Google must plan, replan and embed without resolving any OpenAI key. All four combinations use separate declared embedding profiles and preserve the same safety assertions; a Google stub does not meet DoD.
- [ ] Test failed-step-only replacement, completed-output redaction, plan/owner/version/lease drift, lost heartbeat, at-most-two replans, max-three model calls per planner/replan invocation (including its repairs), approval expiry and changed snapshot. Unknown write goes to reconciliation with zero blind retry/replan.
- [ ] GREEN targeted commands from repo root: `npm run test:unit -w @wap/engine -- ai-provider ai-openai ai-google ai-live`; `npm run test:unit -w @wap/api -- ai-planner-http.test.ts`; isolated `npm run test:integration -w @wap/engine -- ai-live`; isolated `npm run test:integration -w @wap/api -- ai-live-wiring.integration.test.ts`.
- [ ] Run `npm run check` and `npm run check:backend` after verifying their test DB isolation/config; serialize integration suites. Inspect actual exit codes/results, skipped tests and generated file diffs. These commands prove regression health, not provider performance.
- [ ] Verify child env/log/report canaries, no-network offline behavior, all-call accounting, cancel/crash completeness, schema round-trip, model/index drift and gold-answer separation. Any failed safety assertion blocks paid phase.
- [ ] Independent read-only Code Reviewer checks scope/credentials/spend/freeze/oracle/replan boundaries. Main resolves concrete findings and re-runs affected tests; reviewer confidence alone does not close a gate.
- [ ] Write runbook with role config, selected-provider keys, exact per-profile launch/probe/index/dev/freeze/report commands, safe index switching, authorized-data scope and rollback to manual/dev_fixture. Update AI status to `READY_FOR_LIVE_PROBE` only with fresh tests for both adapters; quality/cost/latency remain `NOT_RUN` per unexecuted profile.

**Preparation is done at this point.** If key, spending approval or rubric is missing, stop cleanly at the corresponding gate; do not call it an implementation failure and do not solicit secrets in chat.

## Task 8 — Authorized paid execution, separate from preparation

- [ ] Record actual user approval of profiles, endpoints/models, synthetic data sent to each provider, aggregate campaign/profile/phase USD caps and exploratory scope. This user's provider-support choice is not spending approval. User supplies only selected keys through hidden local launcher; do not search for existing local secrets.
- [ ] Recheck each selected provider's prices/settings and offline evidence. Pin request/schema/config hashes before the 6 nominal probes per profile from §4; use real schema and both document/query embedding roles. Verify actual model/capability/dimensions/usage. Probe the two pure profiles before claiming both live-verified; if one lacks access or fails, stop that profile and label it NOT_RUN/PARTIAL. No silent provider/model substitution.
- [ ] In isolated eval DB, explicitly build/activate the selected profile's complete 10-tool index. Verify read-back provenance/paired policy and hashes. Profiles use the one-active-index lifecycle from T4, with no in-flight activation or demo DB reset.
- [ ] Run 9-trial smoke per authorized pure profile on dev plan/refusal/clarification cases across variants at K=10. Compare actual usage/latency with the shared remaining budget. Mixed profiles require explicit selection/authorization, not an automatic Cartesian-product run.
- [ ] For each authorized full-campaign profile, run dev matrix 126 trials sequentially. Tune only dev; retain failures/spend/config changes. Finish the frozen regression block for that profile before explicitly activating an incompatible embedding space. Set criteria before judging final dev, not after regression.
- [ ] Freeze each selected configuration, rubric/exposure, per-provider prices, source/data/index and schedule. Run its 84 legacy regression trials only if authorized budget/headroom is adequate. Keep profile/provider denominators separate; do not relabel exposed cases untouched or quietly tune and rerun as independent holdout.
- [ ] Run a separately identified, budgeted live replan smoke through the isolated engine fault suite. Provider candidates remain untrusted; fake/no-op receivers make writes inspectable. Report live recovery observations separately from the larger deterministic safety suite.
- [ ] Reconcile calls/trials/costs and publish redacted report. Possible conclusions: `LIVE_EVALUATION_PARTIAL`, `LIVE_REGRESSION_REPORTED`, or technical/safety failure. `AI_TECHNICAL_PASS` requires all relevant technical gates with evidence; it never implies official rubric/business quality acceptance.
- [ ] For fresh held-out quality claims, obtain approved cases/rubric/criteria and separate spend authorization; seal hashes before evaluation, deny tuning on that set, and retain original outcomes. If absent, final report explicitly says fresh holdout and formal quality acceptance remain OPEN.

## 6. Definition of Done and self-review

| Requirement | Task / evidence required |
|---|---|
| Both native providers, compatible schema, routed secrets | T1–T3 fake contract tests; T8 exact-account probes reported separately |
| Four planning×embedding combinations, independent QE | T7 fake integration matrix; explicit selected live profiles, no blanket verification |
| Real 8+2 catalog, paired embedding purpose, isolated spaces | T4 active-profile/normalization/role tests + T8 per-index provenance |
| No gold leakage, honest exposure and semantics | T5 canary/equivalence tests; approved rubric/adjudications |
| All calls/costs, deadlines, partial runs, freeze | T3/T6 fault tests and reconciled durable artifacts |
| Engine lease/currentness/approval/recovery safety | T7 isolated tests; T8 separate live replan smoke |
| No exaggerated quality/latency/rubric claims | Distinct report labels, denominators, pending rubric/fresh holdout |
| Existing offline/manual/dev paths preserved | T7 fresh regression checks and network isolation |

Planning self-review: 2026-09-18 live-readiness review supplied six gaps; 2026-09-19 independent reviewer checked active-index uniqueness, fixed dimensions and missing embedding purpose, incorporated above. Main checked provider-specific official docs and amended both spec and plan. No tests or paid calls were run in these planning turns. Proposed task/function/file names are not implementation evidence; confirm current source before editing the dirty checkout.

**Recommended next slice:** T1–T3 for BOTH OpenAI and Google, implemented directly in the current branch, ending with native-adapter fake-transport tests and no paid calls. Then T4–T7, including required embedding-purpose caller updates and four-profile safety tests, to earn `READY_FOR_LIVE_PROBE`. Only afterward request missing live inputs/authorization. This is not authorization to execute T8 now.
