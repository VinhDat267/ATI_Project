# AI multi-provider — amendment to B/local AI design

Ngày: 19/09/2026. **Scope confirmed by user:** hỗ trợ Google Gemini cho cả planning và embedding ngay đợt này, song song OpenAI. **Implementation/live evidence: NOT_RUN.** Các chi tiết thiết kế dưới đây là phương án triển khai; không có quyền gọi API trả phí từ việc duyệt scope.

Tài liệu này điều chỉnh lựa chọn provider tại §5.1 của `2026-09-17-ai-backend-design.md` và được thực thi bằng `../plans/2026-09-18-ai-live-evaluation.md`. Các invariant của `docs/BASELINE.md` và `docs/EXECUTION-CONTRACT.md` không đổi.

## 1. Ranh giới và cấu hình

Triển khai hai adapter native: `openai` và `google` (Gemini API trực tiếp). Không dùng endpoint giả lập OpenAI làm abstraction, không thêm framework orchestration, proxy router hoặc Vertex AI trong đợt này. Engine vẫn nhận `StructuredModelClient`, `QueryExpansionPort`, `EmbeddingPort` và canonical `PlannerResult`.

Một profile đã resolve gồm:

- `planning`: provider, model, API mode và settings riêng của provider; replan dùng cùng lựa chọn này.
- `queryExpansion`: provider/model/settings riêng; nếu bỏ trống thì resolve từ planning và ghi cấu hình hiệu lực vào freeze.
- `embedding`: provider/model, dimensions=1536, document/query task policy, normalization và preprocessing version.
- Limits dùng chung: deadline, tối đa calls, concurrency=1 và budget. Model reasoning/thinking và usage không được ép cùng semantics chỉ vì có tên gần giống.

`AI_PLANNING_PROVIDER`, `AI_PLANNING_MODEL`, `AI_EMBEDDING_PROVIDER`, `AI_EMBEDDING_MODEL` là inputs bắt buộc của live profile. `AI_QE_PROVIDER`/`AI_QE_MODEL` là cặp override tùy chọn; cấu hình nửa cặp bị reject. Không chọn Google model ngầm. Profile mẫu OpenAI giữ `gpt-5.6-terra` và `text-embedding-3-large`; đây không còn là khóa cứng toàn ứng dụng. Google model IDs/settings được cung cấp qua config và kiểm capability; model chưa có contract đã kiểm thử không được tự coi là tương thích.

Key chỉ được resolve cho các provider profile thực sự dùng: `OPENAI_API_KEY` và/hoặc `GEMINI_API_KEY`. Pure Google không cần OpenAI key và ngược lại. Backend không đọc config/key của Codex. Host allowlist gắn với provider: `api.openai.com` hoặc `generativelanguage.googleapis.com`; credential không được chuyển sang host/provider khác, kể cả qua redirect. Các quy tắc child-env, redaction, hidden prompt và không lưu plaintext từ spec gốc giữ nguyên cho cả hai key.

## 2. Adapter và capability contract

Module dùng chung quản lý config/registry, authorization, deadline/cancellation, credential routing, durable call ledger và normalized errors. Module từng provider quản lý auth headers, request/response protocol, JSON schema codec, generation settings, usage mapping và price rules.

OpenAI dùng Responses; Google dùng Gemini Interactions cho structured generation và `embedContent` cho embeddings theo tài liệu hiện tại. API mode/version thuộc capability/freeze. Không tự chuyển API mode nếu schema/model bị từ chối. Khi implementation xác nhận model đòi endpoint khác, phải khai báo capability và kiểm thử riêng trước live.

Canonical DSL không thay đổi. Codec có thể khác giữa provider nhưng phải round-trip cùng fixtures, giữ constraints và trả kết quả đi qua cùng validator. Không đưa yêu cầu riêng của OpenAI như `reasoning.effort` vào Google payload; không coi refusal/safety block của provider là domain refusal đúng về nghiệp vụ.

Model capabilities được khai báo và kiểm thử theo provider/model/API mode: schema subset, output/token/thinking limits, dimension support, embedding task policy và usage fields. Fake contract tests chứng minh adapter behavior; account/schema probe mới chứng minh cấu hình live cụ thể dùng được.

Google cũng hỗ trợ Structured Outputs nhưng schema subset/complexity có giới hạn; JSON đúng cú pháp vẫn cần kiểm giá trị tại application. [Google Structured Outputs](https://ai.google.dev/gemini-api/docs/structured-output). OpenAI strict schema được xử lý riêng trong adapter tương ứng. [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## 3. Embedding space và index lifecycle

Không trộn vectors giữa provider/model dù cùng 1536 chiều. Chỉ đổi planning/QE không làm đổi index khi embedding profile/catalog không đổi. Đổi embedding provider/model, task policy, normalization, preprocessing hoặc catalog thì phải có index tương ứng đã validate; không tự embed lại khi khởi động hoặc trong request.

Mở rộng `EmbeddingPort.embed` với required `purpose: "document" | "query"`; `EmbeddingResult` cũng trả purpose để kiểm hợp đồng. Catalog builder luôn gửi document, retriever gửi query cho cả prompt gốc và QE intents. `ToolEmbeddingRow` mới bắt buộc khai báo document purpose khi activate; query mode không được dùng tạo catalog rows. Cập nhật tất cả callers/fakes, không default purpose ngầm để giữ tests cũ pass. Hai role cùng khai báo provenance của **cặp document/query policy đã được kiểm chứng**, không so task type của query bằng task type của document một cách máy móc.

Embedding profile hash bao gồm provider/model/API mode, dimensions, canonical tool text serializer, document/query templates/task modes, normalization và adapter version. Lưu hash đó trong `preprocessingVersion` hoặc provenance schema hiện có theo định dạng versioned; mọi thay đổi policy làm hash khác. Hash exact embedded text/role được ghi vào call ledger nhưng không lộ raw secret.

Ví dụ cần kiểm theo model: `gemini-embedding-001` dùng task type và cần normalization cho output giảm chiều; `gemini-embedding-2` dùng instruction prefix, không nhận task_type, và tự normalize output giảm chiều. Embedding 2 cũng có semantics aggregation khác, nên đợt đầu gửi một text item cho mỗi call để mỗi tool có đúng một vector. Đây là protocol references, không phải quyết định model nào tốt nhất. [Google embeddings](https://ai.google.dev/gemini-api/docs/embeddings?hl=en).

Mỗi model Google được bật phải có document/query contract test tương ứng, không chỉ test response length. Hai strategy đã biết phải được phân biệt; model chưa có strategy rõ thì fail preflight. Dimensions khác 1536 nằm ngoài đợt này, dù provider có hỗ trợ.

Reviewer đối chiếu `pgvector-index.ts` và migration `0007_ai_reviewed_catalog_index.sql`: hiện chỉ một index active cho mỗi user+catalog, chưa có selector theo provider/profile. Giữ giới hạn đó cho đợt này. Với một worker/profile, thực hiện explicit index activation tuần tự sau khi drain in-flight runs; giữ index cũ để truy vết. Retrieval phải đối chiếu expected embedding profile trước paid query embedding; không tự lấy bất kỳ active index nào cùng catalog. Nếu thiếu index/profile hoặc có switch giữa run, fail closed, không retry sang provider khác. Index legacy thiếu purpose-policy provenance không được nâng nhãn thành live index.

## 4. Evaluation và ngân sách

Contract/integration tests đợt này phải phủ bốn tổ hợp planning × embedding: OpenAI/OpenAI, Google/Google, OpenAI/Google, Google/OpenAI; QE default theo planning và có test override riêng. Google phải có adapter hoạt động thật sau implementation, không chỉ enum/config stub. Tests dùng fake transport, không trả phí.

Live readiness ghi riêng từng profile/provider. Sau authorization, ít nhất hai pure profiles cần probe/smoke trước khi tuyên bố cả hai đã live-verified. Nếu chỉ một profile được chạy, profile còn lại vẫn NOT_RUN dù code đã hoàn tất. Mixed profiles có thể được smoke/evaluate thêm trong phạm vi ngân sách được duyệt; không ngầm chạy tất cả tổ hợp.

Mỗi profile có freeze, model/settings/schema/index hashes, pricing snapshot, planned schedule và report. Trial identity bao gồm `profileId`. Mỗi call ledger có provider, purpose và billable usage categories; chi phí thinking/cache/token ánh xạ theo provider, unknown usage không suy thành zero hay free tier. Campaign tổng không tăng khi thêm provider.

Full dev+legacy regression là 210 trials **mỗi profile**, không phải 210 cho mọi cấu hình. So sánh hai pure profiles thay cả planner lẫn embedding chỉ cho thấy khác biệt end-to-end, không chứng minh planner nào tốt hơn. Muốn tách tác động phải cố định embedding/QE và dùng paired cases/settings, hoặc duyệt matrix factorial riêng. Các disclosure holdout đã tiếp xúc và rubric OPEN từ live plan giữ nguyên.

## 5. Acceptance checklist

- [ ] Hai adapter native có structured planning, bounded repair/replan, QE và embeddings; canonical engine semantics giữ nguyên.
- [ ] Pure Google không đọc/gửi OpenAI key; pure OpenAI không đọc/gửi Google key; mixed chỉ dùng credential đúng từng request.
- [ ] Cả bốn tổ hợp qua fake contract/integration tests; model/schema unsupported, safety block, timeout, missing usage đều có outcome rõ.
- [ ] Query/document task mapping, normalization và provenance kiểm đúng; mismatch bị chặn trước paid query call.
- [ ] Đổi planner không tự rebuild index; đổi embedding có explicit build/activation hoặc reuse đúng immutable artifact, không trộn spaces.
- [ ] Freeze và report phân biệt provider/model/settings/index/profile; đổi cấu hình giữa run bị reject.
- [ ] Budget một campaign, accounting theo provider; không fallback, không tăng spend hoặc reset cap ngầm.
- [ ] Code-ready, probe-ready và live-verified được báo riêng; không đọc key/gọi API trong giai đoạn cập nhật tài liệu.
