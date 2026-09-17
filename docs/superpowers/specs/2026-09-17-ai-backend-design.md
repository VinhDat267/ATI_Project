# AI backend design — B/local

Ngày: 17/09/2026
Trạng thái: **DRAFT_FOR_REVIEW**
Phạm vi: AI-00, trước khi triển khai provider/retrieval runtime

## 0. Cổng phát triển

AI-00 chỉ chốt interface, seam, dữ liệu bất biến, failure semantics và bằng
chứng cần có. Không gọi model thật, không đưa credential vào repo và không
đổi verdict từ `AI_EVALUATION=NOT_RUN`.

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

Implementation có thể dùng pgvector, nhưng phải có adapter đồng bộ snapshot
reviewed vào index. Cột `tools.embedding` hiện có trong migration không phải
bằng chứng retrieval runtime đã tồn tại. Không dùng full-text index để gọi đó
là BM25/hybrid.

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

## 5. Queue decision — `PROPOSED`

AI-00 giữ PostgreSQL outbox và worker hiện đã được kiểm chứng làm authority
cho MVP. BullMQ/Redis chưa được thêm chỉ để đổi transport. Nếu sau này chọn
BullMQ, queue chỉ mang `job_id`; worker vẫn đọc state từ PostgreSQL, claim
compare-and-set và giữ recovery/unknown semantics hiện có.

Quyết định này cần được ghi nhận là approved hoặc thay đổi trước AI-04. Không
được cập nhật baseline ngầm bằng cách coi BullMQ là đã triển khai.

## 6. Provider/model gate — `OPEN`

AI-02 không được bắt đầu live run cho tới khi có:

- provider và model ID/version;
- structured-output/schema probe;
- embedding model và dimension;
- temperature/seed nếu provider hỗ trợ;
- timeout, rate limit và pricing snapshot;
- secret delivery local không ghi vào Git/log/evidence.

Provider có thể được chọn sau khi thiết kế được duyệt; thiết kế này không tự
đặt một nhà cung cấp hay API key thay người dùng.

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

## 8. AI-00 exit criteria

AI-00 chỉ được chuyển `APPROVED_FOR_IMPLEMENTATION` khi reviewer xác nhận:

1. `PlannerPort`, catalog, provider, retrieval, replan và evaluation seams rõ
   owner và không tạo vòng phụ thuộc engine ↔ provider;
2. queue decision được chấp nhận hoặc ghi rõ lý do defer;
3. provider/model/embedding inputs và secret delivery được khai báo;
4. failure table không cho fallback fixture, blind retry write hoặc bypass
   approval;
5. test/evidence matrix ở implementation plan phủ đủ refusal, clarification,
   invalid output, repair budget, catalog drift, unknown write và reapproval;
6. `AI_EVALUATION` vẫn `NOT_RUN` cho tới khi có live evidence.

Sau cổng này mới triển khai AI-01 retrieval, AI-02 provider planner, AI-03
local replan và AI-04 evaluation theo plan tương ứng.
