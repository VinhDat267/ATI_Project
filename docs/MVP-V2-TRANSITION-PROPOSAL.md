# Lộ trình chuyển đổi B/local → MVP v2

**DESIGN_APPROVED / EXECUTION_NOT_AUTHORIZED — 21/09/2026.**

Ngày: 21/09/2026. Đọc trước:
[đặc tả MVP v2](superpowers/specs/2026-09-21-workflow-platform-mvp-v2-design.md).
Chủ project đã duyệt đặc tả; baseline được đồng bộ phạm vi đích MVP v2.
Đây không phải implementation plan đã chốt symbol/schema/patch; bước đó cần
đặc tả được duyệt và phân tích impact mới trước sửa code.

## 1. Kết quả của đợt tài liệu này

- Một đặc tả có người dùng, ba use case, ranh giới pilot và 20 tình huống.
- Một bản đồ phần giữ lại/phần mới dựa trên source, không suy ra từ tên tool.
- Thứ tự chuyển đổi và gate kiểm chứng; không hứa thời gian khi chưa biết hạn
  nộp/quỹ giờ còn lại.
- Đã đồng bộ baseline đích; không đổi code, config, DB, dataset đang chạy hoặc Design System.
- Không tạo tài khoản SaaS, connection, live run hay đánh giá AI có tính phí.

## 2. Mốc bằng chứng

Source được kiểm tra tại HEAD `5157a19d58957e771bceb7b0dd0101c255d63bf1`.
Working tree đã có 7 file đổi tên sản phẩm chưa commit; đợt này giữ nguyên.
`README.md` trong bản đồ là working-tree version; source engine/API được đọc
hiện tại bởi Codebase Onboarding Engineer, không chỉ suy ra từ status cũ.

GitNexus `ATI_Project` ở `59b275d`, chậm HEAD hai commit, chỉ dùng điều hướng.
Một số cạnh cùng tên không đáng tin để kết luận ownership; CodeGraph trả source
trên đĩa, kiểm source là căn cứ chính. Không refresh index, không chạy regression
hay runtime acceptance trong đợt chỉ làm tài liệu. Bản đồ là phạm vi đọc có
giới hạn, không phải audit bảo mật hay danh sách đầy đủ mọi dependency.
Mô tả transaction receipt của receiver `task_hub` bên dưới dựa trên execution
contract; source receiver không được kiểm lại trong đợt mapping này.

## 3. Bản đồ giữ lại và khoảng cách

Các đường dẫn dưới đây là file hiện có; số dòng ghi theo mốc source trên.
Tên module/tables mới chỉ được thiết kế chi tiết ở implementation plan.

| Vùng | Source đã đối chiếu | Hành vi hiện tại | Quyết định đề xuất |
|---|---|---|---|
| Tiếp nhận run | [accept.ts](../packages/engine/src/accept.ts), dòng 7–45; [app.ts](../apps/api/src/app.ts), 565–568 | Tạo UUID run mới; chặn nếu DB có bất kỳ nonterminal run | Giữ admission tuần tự và busy rõ ràng; không gọi đó là multi-run queue |
| Owner | [store.ts](../packages/engine/src/store.ts), 56–66 | Read run ràng buộc `user_id` | Giữ; kiểm hai principal, không mở shared run history |
| Dữ liệu planner | [ai/planner.ts](../packages/engine/src/ai/planner.ts), 214–232; [prepare.ts](../packages/engine/src/prepare.ts), 95–138 | Planner trước business read; input có prompt/inputs/runtime/catalog, chưa có kết quả read nghiệp vụ ban đầu | Mới: pre-planning source snapshot có giới hạn và trace; checklist/provenance đưa vào planner |
| Hỏi lại | [prepare.ts](../packages/engine/src/prepare.ts), 119–138; [recovery.ts](../apps/web/src/core/recovery.ts), 163–182 | `needs_input` kết thúc; bổ sung bằng draft/run mới | Giữ ngữ nghĩa, thêm liên kết request/source revision, không triển khai resume |
| Preview và approve | [prepare.ts](../packages/engine/src/prepare.ts), 206–350; [approval.ts](../packages/engine/src/approval.ts), 12–99 | Read-only dryrun, snapshot bất biến, TTL 10 phút, owner/version/hash | Tái sử dụng invariant; mở snapshot schema/version để ràng buộc source/checklist/connection |
| Hạn chế plan | [tool-policy.ts](../packages/dsl/src/tool-policy.ts), 109–119; [snapshot.ts](../packages/engine/src/snapshot.ts), 120–135 | Cấm downstream args/key/condition tham chiếu output write; cấm read phụ thuộc write | Giữ; UC2 chỉ tạo một card, không ghi URL về Sheet trong cùng plan |
| Trả kết quả | [execute.ts](../packages/engine/src/execute.ts), 194–203 | Final `plan.outputs` có thể dùng output write thành công | Tận dụng hiển thị card ID/URL; không nhầm giới hạn downstream step với final output |
| Catalog/registry | [snapshot.ts](../packages/engine/src/snapshot.ts), 28–38; [gateway-types.ts](../packages/engine/src/gateway-types.ts), 5; [ai/catalog.ts](../packages/engine/src/ai/catalog.ts), 102–105 | Server enum local; AI catalog tối đa 10 entry | Cần mở registry theo profile SaaS, schema/policy/namespace mới; không chỉ thay endpoint |
| Launch | [mcp-presets.json](../config/mcp-presets.json); [launch-policy.ts](../packages/engine/src/launch-policy.ts), 257–315 | Preset filesystem pin/allowlist; chưa có reviewed Trello/Sheets trong cấu hình đã đọc | Adapter/connection riêng; không tự cài MCP server ngoài hay tin tools/list |
| Dedupe | [prepare.ts](../packages/engine/src/prepare.ts), 292; [0002_audit_contracts.sql](../db/migrations/0002_audit_contracts.sql), 62–69 | Operation UUID và unique theo run/version/step, không chống cùng yêu cầu qua run mới | Mới: source identity + cross-run reservation theo nhóm/source/board, kể cả unknown |
| Kết quả chưa rõ | [execute.ts](../packages/engine/src/execute.ts), 153–191, 216–224; [execution contract](EXECUTION-CONTRACT.md) | Không blind retry; task_hub có receipt nội bộ cùng transaction | Giữ engine certainty; không áp bảo đảm receiver local sang Trello; thêm đối chiếu remote read-only |
| Browser data mode | [vite.config.ts](../apps/web/vite.config.ts), 19; [main.live.tsx](../apps/web/src/main.live.tsx), 13–21 | Chỉ mode `live` dùng live bootstrap; mode khác fixture | Cấu hình launch pilot rõ, báo mode/thiếu cấu hình, không demo fallback âm thầm |
| Visual và identity | [System Design](../System%20Design/DESIGN.md); [README](../README.md) | Visual đã approved; product rename đang dirty | Giữ nguyên; phần UI interaction mới phải duyệt riêng |

**Không suy ra từ bản đồ:** SSO đã có không chứng minh shared workspace; tool có
tên `send_slack_message` không chứng minh Slack thật; test local qua không
chứng minh SaaS auth, AI quality hoặc correctness nghiệp vụ của MVP v2.

## 4. Thứ tự chuyển đổi và cổng ra

### P0 — Duyệt và đồng bộ scope

Spec approval và đồng bộ docs: hoàn tất trong batch tài liệu ngày 21/09/2026.
Implementation plan P1a (nền tảng thuần, chưa trọn P1/P2): xem [kế hoạch giai đoạn đầu](superpowers/plans/2026-09-21-mvp-v2-foundation-connectors.md).
Schema tích hợp engine, reservation DB và adapter được tách thành batch kế tiếp;
không coi bản đồ P2 trong plan này là lệnh thực thi P2.
Phần dưới là thứ tự gate; không có nghĩa code P1–P5 đã được triển khai.

Chủ project duyệt đặc tả, cặp tích hợp và giới hạn một nhóm/two operators nhưng
chỉ một active run. Sau đó mới lập implementation plan chi tiết bằng workflow
planning, phân tích impact source/graph mới cho từng thay đổi hợp đồng.

Một batch docs sau duyệt phải rà và đồng bộ:
[BASELINE](BASELINE.md), [PRODUCT](../PRODUCT.md),
[quyết định](../QUYET-DINH.md), [API](API.md),
[execution contract](EXECUTION-CONTRACT.md),
[lịch](KE-HOACH-6-TUAN.md), README và các yêu cầu chức năng/dataset thực tế tìm
thấy khi lập plan. Không đổi trạng thái evidence cũ thành V2_PASS. Không sửa
hoặc viết đè dataset benchmark cũ để khớp một kết quả mới.

Gate: scope có hiệu lực rõ ràng; danh sách non-goals không mâu thuẫn; plan đã
được user xem và chọn cách thực hiện. Spec approval không tự cấp quyền gọi
provider hoặc ghi vào tài khoản bên ngoài.

### P1 — Hợp đồng dữ liệu và môi trường thử

Chốt source schema/checklist, request identity/revision, oracle 20 case; tạo
dataset tổng hợp mới có nhãn và provenance. Chốt schema của snapshot/receipt,
business reservation, quyền principal/connection và privacy/redaction.
Thiết kế migration bổ sung có kế hoạch rollback không phá dữ liệu B/local.

Mở registry theo profile: giữ catalog local 8+2 cho regression; profile pilot
chỉ publish tool SaaS cần thiết và số lượng được review. Không tăng trần catalog
một cách tùy tiện để vượt validation; kiểm retrieval/evaluation manifest theo
profile, không trộn kết quả với benchmark catalog cũ.

Chuẩn bị runbook tài khoản thử, quyền Sheets/Trello, một board/list và Sheet
allowlisted, hai principal. Credential server-side; không đưa key thật vào
fixture. Chọn phương thức auth dựa trên tài liệu provider tại thời điểm setup.

Gate: unit/contract test schema/policy và oracle đạt; migration được review;
connection chưa có credential phải fail closed. Account hoặc budget chưa có
không ngăn viết mock test, nhưng live gate vẫn NOT_RUN.

### P2 — Adapter thật và một plan tay an toàn

Xây read source/board/member/card và create-card adapter; strict input/output,
principal + target allowlist, egress cố định, credential redaction, dispatch
certainty. Receiver SaaS không có receipt transaction chung với DB; reservation
không được coi là bằng chứng card đã tạo.

Kiểm plan tay: source read → frozen preview → approval → một create-card;
race/retry/expiry/unknown bằng transport cô lập trước. Live chỉ dùng tài nguyên
đã cho phép; read-only xác nhận card đúng. Không nhảy thẳng vào AI để che lỗi
adapter bằng prompt. Nếu thiếu quyền live, ghi adapter contract PASS và
LIVE_NOT_RUN, không coi P2 live gate đã qua.

Gate: payload đúng sau duyệt; unknown dừng an toàn; cross-run dedupe không tạo
thêm card khi chạy lại; có receipt ID/link và kiểm lại ở sandbox thật.

### P3 — AI nhận dữ liệu nguồn và lập kế hoạch

Thêm pre-planning read vào orchestration với schema/policy/trace đầy đủ. Ràng
buộc source snapshot giữa checklist, planner, preview và approval. Giữ ba
outcome refusal/clarification/plan; input không đủ phải kết thúc không write.
Không thêm loop/LLM-transform vào DSL. Catalog mở rộng phải đi qua retrieval,
budget/accounting và evaluation freeze hiện có, không bypass trong adapter.

Kiểm các biến thể NL chọn kiểm tra-only, tạo task, tra cứu task; phân biệt quy
trình cố định với planner thật. Model không được chọn credential, principal,
intent key hay nâng quyền bằng văn bản nguồn. Source đổi revision phải re-prepare,
không dùng approval cũ. Tất cả call kể cả repair/replan được tính ngân sách.

Gate: V2-01–13,16,20 có oracle; provider-backed UC1–3 được ghi bằng chứng riêng,
không thay bằng fixture planner. Nếu provider chưa được cho phép, chỉ báo phần
offline đã kiểm và giữ live gate NOT_RUN.

### P4 — Browser end-to-end trên UI đã duyệt

Trình interaction delta trong các view hiện có trước sửa UI. Đưa source selector,
thông tin thiếu/đích/preview và link thật vào luồng; không chọn visual direction
mới. Làm needs_input → draft/run mới, busy, expiry, unknown và connection unavailable
dễ hiểu. Không mở chức năng share history hoặc approval chéo.

Gate: browser UC1–3; hai principal không truy cập run nhau; live không fallback;
refresh/polling/relogin không tạo write mới. Dữ liệu giữ lại giữa các phiên pilot
trừ khi user chủ động cho phép cleanup, khác fixture tự dọn của integration test.

### P5 — Thực nghiệm và bàn giao môn học

Chạy đủ matrix 20 case, adversarial/contract suite; kiểm remote effect bằng API
read/browser thay vì chỉ status nội bộ. Đóng băng holdout mới trước evaluation,
budget, model/catalog/prompt hashes. So sánh workflow cố định với AI; giữ đối
chứng semantic vs semantic+QE có cùng điều kiện và báo kết quả âm nếu có.

Tách bốn nhãn: CONTRACT_TESTED, SAAS_LIVE_EXERCISED, AI_QUALITY_MEASURED,
CUSTOMER_VALIDATED. Nhãn cuối vẫn NOT_RUN khi chỉ nhóm đóng vai. Không gộp lỗi
API/permission với planner accuracy hoặc loại run fail khỏi denominator.

Gate: nguồn/dataset/phương pháp đo, hạn chế, demo và technical defense giải thích
được bởi thành viên nhóm; không tuyên bố production hoặc thị trường đã xác thực.

## 5. Script và kiểm thử làm nền (chưa chạy trong đợt này)

Các script dưới đây tồn tại trong root package.json theo đối chiếu source:
`check:backend`, `check:api`, `check:web`, `check:engine`, `test:integration`,
`check:oidc`, `check:oidc:local`, `check:oidc:browser`, `check:oidc:https`,
`check:full`. Dùng `npm run <script>` theo batch; đọc lại prerequisite trước khi
chạy, không mở mọi service chỉ vì có script. Trước sửa symbol phải impact; trước
commit phải detect_changes; kết quả partial/unknown không phải all-clear.

| Test có sẵn | Hợp đồng được kế thừa, không phải bằng chứng live V2 |
|---|---|
| [ai-planner.test.ts](../packages/engine/tests/ai-planner.test.ts), dòng 287 | Clarification/refusal không tiêu repair vòng ép thành plan |
| [ai-planner-http.test.ts](../apps/api/tests/ai-planner-http.test.ts), 467 | Hỏi lại không executable version/approval |
| [fixtures.test.ts](../packages/dsl/tests/fixtures.test.ts), 54 | Từ chối downstream reference từ write output |
| [controller.integration.test.ts](../packages/engine/tests/controller.integration.test.ts), 171/201 | Owner/hash/version/double approval, reject/expiry không write |
| [controller.integration.test.ts](../packages/engine/tests/controller.integration.test.ts), 276/1124/1186/1339 | Lost response/reconcile, race execute, create receipt, crash sau commit local |

Từng batch phải thêm test riêng cho gap tương ứng; không chỉ chạy lại test
local rồi đánh dấu connector v2 đã xong. Independent code review bắt buộc sau
implementation thay đổi approval/policy/transaction/recovery theo AGENTS.md.

## 6. Rủi ro và phương án cắt phạm vi

| Rủi ro | Cách kiểm/cắt có chủ đích |
|---|---|
| Không có người phỏng vấn | Vẫn làm secondary research + scenario replay; customer acceptance vẫn chưa đo |
| Chưa có tài khoản/quyền API | Hướng dẫn setup sau duyệt; mock tiếp tục nhưng không thay live DoD bằng local |
| Không đủ quỹ thời gian | Giữ UC2 + xử lý thiếu thông tin/safety; hoãn UC3/biến thể, báo scope giảm và xin duyệt trước |
| Trần enum/catalog bị bỏ sót | Lập implementation impact map cho schema/gateway/snapshot/catalog/API DTO/tests; không chỉ adapter |
| AI chưa hiểu dữ liệu nguồn | Pre-planning snapshot phải có trước evaluation; không gọi retrieval tool schema là RAG dữ liệu nghiệp vụ |
| Hai operator gây hiểu nhầm multiuser | Giữ global busy và owner-only runs; board ngoài là nơi cộng tác; không làm workspace CRUD |
| Create thành công nhưng DB/response mất | Unknown reservation chặn lần sau; đối chiếu read-only; không xóa remote hoặc blind retry |
| Benchmark đẹp nhưng thiếu thực tế | Công bố nguồn case, số mẫu nhỏ, test giả lập và lỗi; không gọi đo trong nhóm là user study |

Lịch cũ giả định hai người, 14 giờ/người/tuần, nhưng đã ghi quỹ chưa cân đối lại.
Không dùng nó để cam kết MVP v2 sẽ xong trong 4–6 tuần. Implementation plan cần
quỹ giờ/hạn thực tế; phân công A/B là vai trò gợi ý, chưa giao việc cho người
thật. Đề xuất A phụ trách engine/API/policy, B adapter/data/UI/evaluation, cùng
review và cùng giải thích được toàn luồng. Không làm song song những batch có
dependency schema/approval chưa chốt.

## 7. Việc thực hiện ngay sau khi duyệt

1. Duyệt đặc tả và ghi quyết định scope có hiệu lực; xác nhận quỹ giờ và hạn nộp.
2. Lập implementation plan chi tiết P0–P2, xác định chính xác file/schema/tests,
   dependency và migration; không lập sẵn patch lớn cho P3–P5 khi chưa đo P2.
3. Người dùng xem plan và chọn phương thức triển khai.
4. Thực hiện từng batch, verify và commit sạch; chỉ đi qua gate tiếp theo khi
   có bằng chứng. Source map này cần refresh nếu HEAD/working tree thay đổi.

**Điểm dừng hiện tại:** người dùng xem implementation plan và chọn cách thực hiện. Không còn yêu
cầu phải tự tìm người quen để project được phép tiến triển.
