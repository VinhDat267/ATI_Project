# AI backend design — B/local

Ngày: 17/09/2026
Trạng thái: **OFFLINE_IMPLEMENTATION_APPROVED / LIVE_GATE_OPEN**
Phạm vi: AI-00, trước khi triển khai provider/retrieval runtime

## 0. Cổng phát triển

AI-00 chốt interface, seam, dữ liệu bất biến, failure semantics và bằng
chứng cần có. Ngày 17/09/2026 người dùng đồng ý tách gate offline/live và sẽ
bổ sung API key sau. Thiếu credential không khóa công việc offline.

- `OFFLINE_IMPLEMENTATION_APPROVED`: được chuẩn hóa reviewed catalog, xây
  interfaces/adapters nhận dependency injection, fake model/embedding clients
  trong tests và unit tests cho retrieval/planner/failure semantics. Không đọc
  credential, gọi provider/MCP, truy cập DB demo hoặc bật mode AI của API.
- `LIVE_GATE_OPEN`: account access, schema probe, effective settings và numeric
  timeout/retry/rate/cost budgets phải được kiểm chứng trước live integration.
  Live implementation/evaluation không được coi là pass từ fake-client tests.

Không đưa credential vào repo; `AI_EVALUATION=NOT_RUN` giữ nguyên.

Engine hiện đã có seam `PlannerPort`. `DEV_FIXTURE_PLANNER` và adapter AI là
hai adapter khác nhau của seam đó; fixture không được dùng làm fallback im lặng
khi provider AI lỗi.

## 1. Mục tiêu và giới hạn

Mục tiêu là cho phép một planner AI tạo `PlannerResult` hợp lệ để engine tiếp
tục dùng cùng validator, policy, preview, approval và reconciliation hiện có.
AI được phép chọn từ catalog 10 capability local đã review, nhưng không được
thực thi tool, tự cấp quyền hoặc thay đổi snapshot.

Trong B/local:

- semantic retrieval và query expansion là hai biến thể cần so sánh;
- một planner có bounded repair, tối đa ba lần planning tính cả lần đầu;
- local replan tối đa hai lần, chỉ cho phần chưa hoàn tất và chỉ khi lỗi chắc
  chắn không tạo side-effect;
- hybrid/BM25, parallel execution, automatic resume, SaaS thật và workflow
  editor nằm ngoài thiết kế này.

## 2. Các module và seam

### 2.1 `PlannerPort` — seam bên ngoài

Engine chỉ biết một interface nhỏ:

```ts
interface PlannerPort {
  readonly mode: "dev_fixture" | "ai";
  produce(input: {
    runId: string;
    userId: string;
    request: CreateRun;
    runtime: Record<string, string>;
  }): Promise<PlannerResult>;
}
```

Adapter phải trả về `PlannerResult` parse được. Engine vẫn là authority cho
schema, graph, tool registry, side-effect policy, resolved args, preview,
approval và write safety. Provider không được trả operation ID, approval,
policy decision hoặc lệnh thực thi.

### 2.2 `ReviewedCatalog` — module dữ liệu đầu vào

Catalog AI nhận một snapshot đã review gồm server, tool, input/output schema,
side-effect, policy version và artifact hash. Snapshot có canonical hash và
được gắn với từng planning/evaluation run.

Catalog không được lấy trực tiếp từ:

- MCP description/annotation chưa review;
- executable, server slug hoặc args do client gửi;
- dữ liệu provider trả về.

`GET /servers/catalog` là nguồn quan sát hiện hành; fixture/evaluation dùng
snapshot file đã hash. Nếu snapshot thay đổi giữa preview và execute, approval
cũ phải stale theo invariant hiện có.

### 2.3 `ToolRetriever` — deep module cho retrieval

Interface đề xuất:

```ts
type RetrievalVariant = "all_tools" | "semantic" | "semantic_qe";

interface ToolRetriever {
  retrieve(input: {
    query: string;
    catalog: ReviewedCatalogSnapshot;
    variant: RetrievalVariant;
    topK: number;
  }): Promise<{
    tools: readonly ReviewedTool[];
    variant: RetrievalVariant;
    topK: number;
    queryHash: string;
    latencyMs: number;
  }>;
}
```

AI-01 triển khai adapter pgvector tách riêng: `reviewed_catalog_snapshots`,
`reviewed_embedding_indexes` và `reviewed_tool_embeddings`. Adapter đồng bộ
snapshot reviewed, không truy vấn cột `tools.embedding` lịch sử và không dùng
full-text/BM25/hybrid. Vì catalog B/local tối đa mười tools, không tạo HNSW/
IVFFlat: truy vấn cosine là exact. API/provider runtime vẫn chưa wire.

### 2.4 `QueryExpansionPort` — adapter tùy chọn của biến thể `semantic_qe`

Expansion chỉ nhận user prompt, trả tối đa sáu intent ngắn và có usage,
latency, provider/model metadata. Mọi intent được hash và ghi vào evidence.
Nếu expansion lỗi hoặc vượt ngân sách, run phải có failure rõ ràng; không âm
thầm chuyển sang `all_tools` hay fixture.

### 2.5 `StructuredModelClient` — seam provider

Provider adapter nhận system prompt, user prompt, schema và metadata; trả
structured candidate cùng usage/latency/provider request ID. Nó không biết
database, gateway, approval hay receiver.

Tách seam này để:

- fake client kiểm repair/refusal/clarification mà không gọi mạng;
- live adapter kiểm structured output và quota riêng;
- toàn bộ prompt/model/cost metadata được ghi mà không log credential hoặc raw
  secret.

### 2.6 `AiPlannerAdapter` — adapter thực hiện `PlannerPort`

Adapter này điều phối catalog → retrieval → prompt → model → parse. Nó được
phép yêu cầu repair khi candidate không parse/validate được, nhưng không được
tự ghi DB hoặc tự bypass `validateManualPlan`/engine policy.

`PlannerResult` có ba kết quả hợp lệ:

- `plan`: chuyển cho engine validate và dry-run;
- `refusal`: kết thúc `refused`, không tạo executable version;
- `clarification`: kết thúc `needs_input`, không tạo write.

### 2.7 `LocalReplanPort` — seam riêng cho AI-03

Replan không được giả làm planning lần đầu. Interface phải nhận current
version, failed step, error class, completed outputs, failed approaches,
remaining steps và replan count; trả một `PlannerResult` mới cùng provenance.

Engine là nơi quyết định:

- operation nào đã hoàn tất và bị cấm lặp;
- lỗi có certainty đủ để replan hay phải reconciliation;
- version/preview/approval mới;
- giới hạn tối đa hai local replan.

Unknown write tuyệt đối không đi qua `LocalReplanPort`.

### 2.8 `EvaluationRunner` — module ngoài runtime

Runner chạy cùng các adapter nhưng không được gọi receiver hoặc mutate demo
database. Nó lưu manifest, hashes, model/provider settings, usage, latency,
cost và outcome theo từng case/variant/repetition.

## 3. Luồng dữ liệu dự kiến

```text
POST /runs
  -> durable run + prepare outbox
  -> AiPlannerAdapter
       -> ReviewedCatalog snapshot
       -> all_tools | semantic | semantic_qe
       -> StructuredModelClient
       -> PlannerResult parse
       -> bounded repair nếu còn ngân sách
  -> engine validation/policy/graph
  -> read-only dry-run
  -> immutable preview + approval
  -> existing execution/reconciliation path
```

Model không gọi MCP. Model chỉ tạo candidate; mọi side effect vẫn đi qua
engine/gateway hiện có.

## 4. Failure semantics bắt buộc

| Tình huống | Kết quả bắt buộc |
|---|---|
| Provider timeout/unavailable | Lỗi planning có mã rõ; không tạo version/write; không fallback fixture |
| JSON/schema sai | Repair có giới hạn; hết giới hạn thì `failed`, giữ provenance |
| Capability thiếu | `refusal`, không gọi write |
| Thông tin thiếu | `clarification`, không tạo plan rỗng |
| Tool description có prompt injection | Coi là dữ liệu; neutralize/fence; validator và policy độc lập |
| Plan chọn tool/payload sai | Engine reject, không trust model |
| Read lỗi có thể retry | Chỉ theo giới hạn engine đã chốt; mọi lần gọi được đo |
| Write timeout/lost response | `unknown`/`reconciliation_required`; không AI replan mù |
| Replan thay args/tool/read data | Version, snapshot và approval mới; approval cũ mất hiệu lực |
| Queue duplicate | DB outbox/job state guard quyết định; không dispatch trùng |

## 5. Queue decision — `CONFIRMED` (17/09/2026)

AI-00 giữ PostgreSQL outbox và worker hiện đã được kiểm chứng làm authority
cho MVP. BullMQ/Redis chưa được thêm chỉ để đổi transport. Nếu sau này chọn
BullMQ, queue chỉ mang `job_id`; worker vẫn đọc state từ PostgreSQL, claim
compare-and-set và giữ recovery/unknown semantics hiện có.

Người dùng đã đồng ý giữ PostgreSQL outbox + một worker tuần tự cho B/local;
BullMQ/Redis được defer, không phải hạng mục đã triển khai. Compose hiện vẫn
có Redis; biến nó thành profile tùy chọn là công việc riêng, không xóa volume.
Thêm broker không giải quyết thời gian planner giữ worker lease. Không mở
parallel execution hoặc automatic resume để né thời gian chờ này.

## 5.1 Bộ quyết định AI-00 đã xác nhận

**Amendment 19/09/2026:** Người dùng xác nhận hỗ trợ Gemini cho cả planning và
embedding ngay đợt này. [Multi-provider design](2026-09-19-ai-multi-provider-design.md)
là phần bổ sung có hiệu lực cho cấu hình provider; các safety/live gates ở đây
không đổi. Hỗ trợ provider trong thiết kế không phải bằng chứng đã triển khai.

| Hạng mục | Quyết định | Giới hạn bằng chứng |
|---|---|---|
| Provider/model | Configurable OpenAI hoặc Google Gemini; profile OpenAI giữ lựa chọn GPT-5.6 Terra | Adapter/capability/probe riêng từng provider/model; không fallback hoặc chọn model mới ngầm |
| Embedding | Configurable OpenAI hoặc Google, độc lập planning; explicit dimensions=1536, cosine; profile OpenAI giữ `text-embedding-3-large` | Đổi space phải có index tương ứng và document/query policy đúng model; chưa có live comparative evidence |
| Search | Exact cosine trên reviewed catalog tối đa 10 tool | Kiểm query thực tế không dùng approximate HNSW; không coi index có sẵn là runtime retrieval |
| Secret local | Inject vào backend process environment lúc chạy; mặc định prompt ẩn, vault mã hóa tùy chọn | Không bắt buộc SecretStore; launcher/isolated-secret tests chưa triển khai |
| Queue | PostgreSQL outbox authority, single sequential worker; defer BullMQ | Không cam kết exactly-once arbitrary MCP writes |

Embedding records phải gắn provider/model/dimension, preprocessing version,
canonical content hash và reviewed catalog hash. Không trộn embedding space
khi đổi model dù cùng dimension; tạo snapshot/index mới, validate đầy đủ rồi
activate nguyên tử. Không sửa migration đã áp dụng để thay lịch sử schema.

Key không nằm trong source, prompt, log, evidence, frontend hoặc environment
của MCP subprocess. Launcher không nhận key qua command-line literal/history;
dùng environment allowlist cho child và test bằng canary secret giả. Vault chỉ
bảo vệ khi lưu trữ, không loại bỏ plaintext khỏi memory lúc sử dụng. Không cài
vault hoặc gọi API tính phí như một bước ngầm của việc cập nhật tài liệu.

Đổi model cùng provider chỉ là config-only khi capability contract tương thích.
Đổi provider cần adapter và regression/evaluation lại; không hứa portability
chỉ bằng đổi tên model. Không có kết luận model/embedding nào tối ưu trên ATI
trước evaluation.

Planning phải có deadline tổng bao gồm retrieval, query expansion, provider,
repair và backoff. SDK transport retries phải explicit, có giới hạn riêng và
tính vào tổng deadline/cost; không nhân retry ngầm với 3 planning attempts.
Đo riêng queue wait và service time. Cancellation/timeout phải abort transport
khi có thể và loại bỏ late/stale response trước khi tạo version; không thay
đổi unknown-write/reconciliation semantics của engine.

## 6. Provider/model gate — `OPEN`

**DOCS_VERIFIED — 17/09/2026, không phải live probe:**
[OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
liệt kê `gpt-5.6-terra`, Structured Outputs và reasoning `medium` (default).
Giá text tiêu chuẩn mỗi 1M token: input $2, cached input $0.20, output $12;
trên 272K input áp dụng hệ số input 2x/output 1.5x; cache writes 1.25x uncached
input. Đây là pricing reference có ngày, không phải actual usage/cost evidence.
Quyền truy cập tài khoản, schema ATI, effective settings và latency chưa probe.

AI-02 không được bắt đầu live run cho tới khi có:

- provider và model ID/version;
- structured-output/schema probe;
- embedding model và dimension;
- temperature/seed nếu provider hỗ trợ;
- timeout, rate limit và pricing snapshot;
- secret delivery local không ghi vào Git/log/evidence.

Lựa chọn công nghệ đã được người dùng xác nhận ở mục 5.1, nhưng các probe và
numeric timeout/rate/cost budgets vẫn OPEN. Không tự thay model nếu ID đã chọn
không khả dụng: báo bằng chứng và xin quyết định thay thế. Chỉ chạy probe sau
khi credential được cấp an toàn và phạm vi gọi API tính phí được cho phép.

## 7. Evidence contract

Mỗi run/evaluation phải lưu được:

- catalog, dataset, prompt và policy/artifact hashes;
- provider/model/embedding metadata;
- retrieval variant, top-K, expanded intents và query hash;
- mỗi model call: latency, usage, cost input, cost output và error class;
- PlannerResult kind, validation issues, repair count và final outcome;
- replan count, changed step IDs, new version/approval tuple;
- redacted output đủ để kiểm chứng, không credential/raw secret.

Không dùng test pass, model confidence, hand-plan hoặc fixture result làm AI
quality evidence.

Giữ split manifest: b01–b06 development, b07–b10 holdout. Chỉ tune bằng dev;
freeze cấu hình trước khi chạy holdout, không dùng kết quả holdout để tiếp tục
chọn model/prompt rồi báo như đánh giá chưa thấy. top-K=10 trên 10 tool là
all-tools control, không phải thành tựu recall. Ba repetitions đo biến thiên,
không biến 10 cases thành 30 nhiệm vụ độc lập. Refusal/clarification đúng là
kết quả hợp lệ, không ép mọi case phải tạo plan.

## 8. AI-00 exit criteria — tách offline/live

### Offline design gate — `APPROVED_FOR_OFFLINE_IMPLEMENTATION`

Người dùng đã duyệt tách gate. Review thiết kế offline phải xác nhận:

1. `PlannerPort`, catalog, provider, retrieval, replan và evaluation seams rõ
   owner và không tạo vòng phụ thuộc engine ↔ provider;
2. queue decision được chấp nhận hoặc ghi rõ lý do defer;
3. provider/model/embedding targets và secret delivery được khai báo; chưa có
   key/probe không chặn fake-client implementation;
4. failure table không cho fallback fixture, blind retry write hoặc bypass
   approval;
5. test/evidence matrix ở implementation plan phủ đủ refusal, clarification,
   invalid output, repair budget, catalog drift, unknown write và reapproval;
6. `AI_EVALUATION` vẫn `NOT_RUN` cho tới khi có live evidence.

### Live integration gate — `OPEN`

Trước live application integration/evaluation, phải hoàn tất mục 6: quyền API,
exact schema/settings probe, pricing và numeric budgets. Riêng bounded probe
được chạy sau khi credential được cấp an toàn, probe budgets được chốt và
phạm vi gọi tính phí được cho phép; probe là bước tạo bằng chứng, không phải
bằng chứng đã có sẵn. Không tự tìm key từ cấu hình Codex hoặc dùng
credential của công cụ phát triển làm credential ứng dụng.

AI-01/AI-02 được triển khai phần offline theo plan tương ứng ngay bây giờ.
AI-03 engine integration vẫn cần test matrix approval/reconciliation riêng;
gate offline không chứng nhận phần này. AI-04 live evaluation vẫn `NOT_RUN`.
Chỉ đóng toàn bộ AI-00 khi cả offline design và live readiness gates hoàn tất.
