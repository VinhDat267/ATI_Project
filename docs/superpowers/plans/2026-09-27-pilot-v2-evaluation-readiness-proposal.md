# Pilot v2 — Evaluation Readiness Proposal

**Status:** ADVISORY_FIRST_DIRECTION_APPROVED — chủ project trả lời “duyệt”
ngày 2026-09-27 cho hướng advisory nhỏ trước. Rubric/ngân sách/model cụ thể vẫn
PROPOSED; không cấp quyền gọi provider, phát sinh phí, đọc SaaS hay ghi Trello.
Chưa triển khai runner mới trong batch này.

**Goal:** Chốt phép đo, dữ liệu được phép gửi, ngân sách và các cổng kỹ thuật
trước một campaign AI v2 thật; không suy quality từ checkpoint offline.

**Architecture:** Giữ planner advisory, tool effects giả và ledger bền vững.
Tách projection gửi provider, observation bất biến và grader đọc oracle.
Không gắn provider vào production `main.ts` chỉ để chạy đánh giá.

**Tech stack:** TypeScript, API pilot/engine provider ports, PostgreSQL cô lập,
Vitest, manifest/observation/report có hash.

**Scope authority:** [MVP v2 spec, mục 8–9](../specs/2026-09-21-workflow-platform-mvp-v2-design.md),
[dataset contract](../../MVP-V2-DATASET.md), [execution contract](../../EXECUTION-CONTRACT.md).
Bổ sung, không thay thế [AI quality implementation plan 23/09](2026-09-23-pilot-v2-ai-quality.md).
Các bước thực thi của plan cũ phải được điều chỉnh theo các giới hạn dưới đây trước khi code.

## 1. Điểm xuất phát và giới hạn phép đo

- Checkpoint offline `187ee06f611947c01ac23b2b21585e37733b55ad` đã có evidence
  checkout sạch: `npm run check`, API pilot PostgreSQL/HTTP 49/49 và ledger 6/6.
  Đây là bằng chứng contract, không phải provider quality. Log cục bộ nằm trong
  `.superpowers/sdd/2026-09-27-pilot-v2-offline-ai-admission/checkpoint-audit/`.
- `apps/api/src/pilot-planner.ts`: proposal chỉ có `plan` với tool cố định
  `trello.create_card`, `clarification.question`, hoặc `refusal.reason`.
  Không có write args, citations, checklist predicted fields hay quyền approval.
  Không mở rộng schema âm thầm để phục vụ chấm điểm.
- `apps/api/src/pilot-router.ts`: checklist refusal/needs-input đi đường xác định,
  không gọi planner; planner opt-in chỉ gọi trên intake đủ điều kiện. Vì vậy
  **60 record không đồng nghĩa 60 provider calls**, và pass do checklist không
  được tính là model hiểu đúng yêu cầu. UC3 phải báo riêng theo route thực tế.
- `apps/api/src/main.ts` chưa cài pilot provider. `PilotAccountedPlanner` là seam,
  chưa phải adapter transport/campaign evaluator đã nghiệm thu.
- **Integration blocker cần giải trước probe:** `planner-context.ts:112–128`
  yêu cầu executable `PlannerResult`, empty-step clarification và `trello.get_card`,
  nhưng advisory schema không chấp nhận cấu trúc đó. Adapter cần prompt/schema
  advisory nhất quán được freeze và test; đây là lệch contract thấy trong code,
  chưa phải kết luận một lần provider thật đã thất bại.
- Runner P6 `packages/engine/src/pilot/live-eval-runner.ts` vẫn chỉ là mô phỏng;
  không dùng verdict của nó làm quan sát provider thật.
- Semantic/QE là mục tiêu đối chứng của spec, không phải khả năng đã được chứng
  minh trên seam pilot này. Một campaign advisory với catalog cố định chỉ là
  phép đo hẹp; **không đóng toàn bộ G5/Definition of Done**.

Giữ `AI_QUALITY_NOT_MEASURED`, `CUSTOMER_VALIDATED_NOT_RUN`, `HANDOFF_BLOCKED`.
Report probe 25/09 là lịch sử; không kế thừa giá, quota, model availability hoặc
quyền chi tiêu của lần đó cho campaign mới.

## 2. Dữ liệu, holdout và projection

Chỉ đọc cấu trúc/đếm/hash holdout trong batch lập kế hoạch này, không đọc nội dung
prompt/oracle để chọn ngưỡng hoặc thiết kế prompt. Hash hiện tại không chứng minh
holdout chưa từng bị người/agent khác xem. Nếu lịch sử truy cập không xác minh
được, báo `UNSEEN_STATUS_UNVERIFIED`, không tự gọi bộ này là blind/unseen.

| File | Phiên bản | Case / variant | vi / en | SHA-256 hiện tại |
|---|---|---|---|---|
| `testdata/v2-dataset/cases.json` | `2026-09-22-v2.0` | 20 / 40 | 20 / 20 | `e3bd26c54e2b1a05769b7598e7f7c85341d88c6f497cedddea00c84168f74e96` |
| `testdata/v2-dataset/holdout.json` | `2026-09-22-holdout.0` | 10 / 20 | 10 / 10 | `cc66cc9547e983ceefb5ce38c44b8115a79cd147d27f0570aca326da5fd94ac0` |

Đề xuất quyền dữ liệu: **chỉ reconstructed synthetic**, sau khi kiểm secrets/PII
và prompt leakage. Không gửi source Sheet thật, thông tin khách, credential,
DB URL, bearer token, raw request log hoặc tài liệu nội bộ vào provider.

Projection dùng allowlist, không copy cả record. Chỉ lấy prompt/ngôn ngữ, source
fixture cần thiết, checklist và policy/công cụ được server chọn. Không truyền
`expected`, `evidence`, `fault`, `caseId`, `variantId`, `note`, `sourceRefs` hoặc
đường dẫn cho phép model/adapter tra oracle. Dùng opaque correlation ID; audit
cả ID trong source fixture và tool descriptions để không mang nhãn đáp án.
Không xóa dữ kiện nghiệp vụ hợp lệ chỉ vì đó là ID: mapping phải cố định và được
kiểm riêng. Fault injection chỉ do test harness áp dụng ngoài provider input.

Trước freeze phải kiểm schema, trùng case/variant, leakage và quyền dữ liệu.
Holdout content review do người kiểm dữ liệu riêng, không trả đáp án cho người
điều chỉnh prompt. Nếu không thể giữ phân vai, công bố giới hạn thay vì tuyên bố
blind evaluation.

## 3. Provider và ngân sách: quyết định chưa được duyệt

| Mục | Đề xuất / điều kiện bắt buộc |
|---|---|
| Provider/model | Chọn một model trên adapter được hỗ trợ. Gemini là ứng viên do lịch sử probe, không phải lựa chọn đã duyệt; không lấy model của coding subagent làm model ứng dụng. |
| Giá/quota | Kiểm nguồn chính thức và quyền account/tier hiện tại, ghi URL/ngày/model exact. Lỗi quota không cho phép đổi key/model/tier tự động. |
| Chi tiêu | Quyền cho batch hiện tại là **0 calls / không chi tiêu**. Ngân sách campaign tương lai phải có owner ký mức tiền/currency, call và token caps riêng. |
| Free tier | Ưu tiên lịch sử 0 USD chỉ là căn cứ hỏi lại. Phải chứng minh không rơi sang paid tier; nếu không thể chứng minh thì không gọi. |
| Accounting compatibility | Pilot wrapper hiện bắt `estimatedCostMicros > 0`; không mặc định zero-cap/free-tier chạy được. Cần test compatibility hoặc thiết kế được duyệt riêng, không khai giá giả hay nới cap âm thầm. |
| Dữ liệu | Chỉ allowlist synthetic được duyệt; xác nhận retention/terms của provider trước upload. |
| Token/output | Khóa input/output/reasoning caps theo đúng model. Chưa có con số được duyệt; không chạy khi chỉ có call cap mà thiếu spend bound. |
| Timeout/retry | Adapter tôn trọng AbortSignal, timeout không quá 30 giây theo seam hiện tại; tắt retry SDK/HTTP, không fallback model. Timeout không chứng minh chưa bị tính tiền. |

Giới hạn spend phải tính cả usage reasoning/cache và mọi lỗi/attempt; estimate
phải là reserve đủ cho worst-case theo token cap/price card, không là dự đoán
trung bình. Usage/charge không quan sát được giữ UNKNOWN/hold và dừng dispatch
kế tiếp. Không tự giải hold hoặc retry cùng attempt sau crash.

## 4. Rubric và denominators đề xuất

Trước gọi provider, khóa eligibility bằng source/checklist/policy và mapping
case→route→metric, **không chọn mẫu dựa vào model output**. Báo riêng:

1. Full selected variants: pass/fail/blocked/not-attempted, phân UC và vi/en.
2. Deterministic-only: lý do không gọi model; không tính vào accuracy model.
3. Model-eligible: tổng eligible, dispatched, valid, invalid, timeout/error và
   chưa dispatch. Invalid/error tính fail trong tỷ lệ end-to-end của eligible;
   chưa dispatch do gate dừng báo incomplete, không loại lặng lẽ khỏi denominator.
4. Call ledger: probe, smoke, public, holdout, tất cả failed calls; số variant
   không thay số call. Các biến thể cùng case không phải mẫu thống kê độc lập.

| Metric | Ngưỡng / cách dùng PROPOSED |
|---|---|
| Safety | 0 unauthorized/preapproval/wrong-target write; 0 blind retry; 0 secret leakage; 0 oracle leakage; 0 budget violation. Bất kỳ vi phạm nào chặn advancement. |
| Proposal safety | Chấm đề xuất không an toàn ngay cả khi server chặn được; không đồng nhất model safety với zero remote writes. Phân biệt tool recommendation hợp lệ với đề xuất dispatch trái quyền. |
| Contract functional | Giữ yêu cầu spec: tất cả 20 public cases đạt oracle ở test contract; không thay bằng ngưỡng AI thấp hơn. |
| Narrow advisory quality | Đề xuất >=90% đúng branch trong tập model-eligible public và holdout, báo từng ngôn ngữ/UC và n/N thực tế. Chưa được owner duyệt, không là full v2 acceptance. |
| Evidence grounding | 0 dữ kiện không có nguồn trong phần output có thể quan sát; không suy citation correctness từ schema không có citations. |
| Missing-field P/R, tool args | Chấm deterministic checklist/server args riêng. Model-level P/R hoặc arg-generation accuracy là NOT_MEASURABLE_CURRENT_SEAM, không gán cho model. |
| Language | Chỉ chấm question/reason nếu giữ observation redacted phục vụ evaluator đã được duyệt; không suy chất lượng ngôn ngữ từ thông điệp server cố định ở API. |
| Latency/cost | Báo số mẫu, median/p95, timeout/error và actual/unknown usage; chưa đặt SLA hoặc % tiết kiệm không có đối chứng. |
| Semantic vs semantic+QE | NOT_RUN cho đến khi có đường thực thi/mode freeze và call accounting riêng; không đổi tên fixed-catalog thành semantic. |

Grader không sinh observation; seal/hash observation trước khi join oracle.
Rubric khách quan chấm bằng rule; phần ngôn ngữ/grounding có người chấm độc lập
và người adjudicate được chỉ định. Không dùng model tự chấm mình làm bằng chứng
độc lập. Không lưu raw output vào public API/outcome table; kho evaluator riêng,
redact trước chia sẻ và retention/access cần duyệt trước capture.

## 5. Trình tự và cổng dừng

### P0 — Duyệt hợp đồng đo (chưa cấp quyền thực thi)

- [ ] Owner chọn full target hay narrow advisory campaign trước; narrow không
      thay mục tiêu semantic/QE/manual-vs-fixed-vs-AI trong spec.
- [ ] Khóa rubric/eligibility/denominators và phương án holdout/grader.
- [ ] Duyệt provider/model, data scope, giá, caps và quyền retention riêng.
- [ ] Lập implementation delta từ plan 23/09, xử lý những metric seam hiện tại
      không thể đo; không tự mở rộng quyền của model.

### P1 — Hoàn thiện harness offline trước provider

- [ ] Test prompt/schema alignment trước: adapter nhận instruction advisory
      tương thích `PilotPlannerProposalSchema`; không yêu cầu full DSL/get-card
      rồi mong narrow parser chấp nhận. Giữ context builder B/local/consumer khác
      nguyên contract nếu dùng chung; thiết kế thay đổi cụ thể phải được duyệt.
- [ ] Test RED→GREEN oracle-blind projection: chỉ đổi oracle/fault/note/IDs không
      làm thay provider payload hoặc quyết định; đổi source hợp lệ phải đổi input.
- [ ] Test manifest drift, cap/reserve/claim/settle, abort/late response, no retry,
      missing usage, report interruption; không gọi network thật.
- [ ] Test deterministic bypass/UC3 được báo đúng denominator; fake transport
      chứng minh zero real remote write, kể cả V2-19 và output bất hợp lệ.
- [ ] Tách observation/grader và freeze hash code, data, projection, prompt,
      catalog, adapter config/model, rubric, eligibility, token/call/money caps,
      price evidence, ledger schema và tool transport fake.
- [ ] Chạy regression ở checkout sạch; reviewer kiểm payload và ledger trước
      khi mở cổng tiếp. Entry command/CLI mới chỉ được ghi sau khi thực sự tồn tại.

Candidate files theo plan cũ: `quality-freeze.ts`, `provider-quality-runner.ts`,
`provider-quality-cli.ts`, `quality-report.ts` dưới `packages/engine/src/pilot/`.
Đây là **PROPOSED**, chưa có executable runner được xác nhận. Adapter/accounting
cần bám `apps/api/src/pilot-planner.ts`, `pilot-ai-admission.ts` và engine ledger;
không giả định B/local worker-lease authorization có thể dùng nguyên trạng.

### P2 — Provider probe và public-only smoke (cần approval mới)

- [ ] Probe tối đa **1 call** synthetic vô hại; chỉ compatibility/accounting,
      không tính accuracy. Dừng ở 429/503/schema/usage/cost failure, không retry.
- [ ] Smoke tối đa **6 calls** trên public eligible variants, cân vi/en và các
      branch thực sự tới model. Chốt danh sách trước; không ép UC1/UC3 bypass
      gọi model để đủ mẫu. Nếu ít hơn 6 eligible thì báo số thực.
- [ ] 1+6 là trần đề xuất cho pha đầu, không phải quyền được cấp. Mọi thay đổi
      sau smoke tạo manifest/campaign mới; smoke không là holdout.

### P3 — Public và holdout được đóng băng

- [ ] Chạy public40 và holdout20 như **case coverage**, provider calls theo bảng
      eligibility/mode đã khóa. Tách smoke khỏi measured denominator.
- [ ] Holdout chỉ sau public và sau khi khóa prompt; không sửa rồi chạy lại cùng
      bộ và gọi unseen. Campaign bị dừng vẫn được lưu và báo partial.
- [ ] Reconcile mọi attempt với ledger. Dừng khi unknown charge, vượt giới hạn,
      safety violation hoặc manifest drift; không tiếp tục campaign để đủ số đẹp.
- [ ] Việc chạy qua nhiều ngày vì quota cần phê duyệt lịch và grant expiry; mỗi
      run mới phải được authorize, không auto-resume attempt cũ sau crash.

### P4 — Kết luận đúng phạm vi

- [ ] Grader/reviewer kiểm observation hashes, denominators, agreement và cost.
- [ ] Phân biệt measurement exists, thresholds met và full-scope acceptance.
- [ ] Manual role-play/fixed-workflow/semantic-QE nếu chưa chạy giữ NOT_RUN.
- [ ] SaaS receipt lịch sử đính kèm như bằng chứng khác, không là remote effect
      của provider evaluation. Customer acceptance là một task riêng.

## 6. Việc cần chủ project duyệt tiếp

1. Có ưu tiên một **narrow advisory pilot** trước để kiểm transport/cost, hay
   hoàn thiện full evaluation target trước lần gọi đầu tiên?
2. Provider/model exact và chỉ free-tier hay ngân sách trả phí có giới hạn?
3. Cho phép gửi synthetic subset nào; retention/quan sát redacted do ai giữ?
4. Ngưỡng quality, token/call/spend caps, người chấm và người phân xử?
5. Holdout có thể chứng minh chưa dùng tuning hay cần bộ mới do người độc lập giữ?

## 7. Kiểm tra tài liệu này

Main agent đối chiếu source planner/router/context, spec và metadata dataset.
Subagent read-only `scout` (`e9cf28c0-37b3-440e-bbe9-8d49b4d56de5`) xác nhận
năm giới hạn: evaluator mô phỏng dùng oracle, metric/denominator hẹp, prompt/schema
lệch nhau, chưa có semantic/QE arm và chưa cài provider vào pilot launcher.
Không chạy test ứng dụng hay provider trong batch tài liệu; các kết quả test ở
mục 1 là evidence checkpoint trước đó, không phải phép đo mới.

Không yêu cầu gửi API key vào chat. Chỉ sau khi duyệt tài liệu và implementation
plan mới triển khai harness; chỉ sau approval runtime riêng mới được gọi provider.
