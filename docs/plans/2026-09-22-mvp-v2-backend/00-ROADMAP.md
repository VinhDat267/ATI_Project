# Backend MVP v2 — Roadmap và chỉ mục 30 task

Ngày lập: 22/09/2026. Cập nhật trạng thái 23/09/2026 tại commit `9335620`:
**PLAN_RECORDED / CODE_PRESENT / LIVE_NOT_RUN / FULL_ACCEPTANCE_OPEN**.

Đây là kế hoạch gốc, không phải bảng nghiệm thu. Sau ngày lập đã có code/test
cho nhiều task BE-01…29 và giao diện pilot. [Review P1](P1-REVIEW.md),
[P2](P2-REVIEW.md), [P3](P3-REVIEW.md), [P4](P4-REVIEW.md) ghi kết quả tại thời
điểm tương ứng; [audit P6](P6-REVIEW.md) rút lại verdict live `PASS`.
Không suy `SAAS_LIVE_EXERCISED`, `AI_QUALITY_MEASURED` hay `FULL_PRODUCT_ACCEPTANCE`
từ commit hoặc unit test. Tài liệu/code không cấp quyền gọi API trả phí hoặc tạo
card thật.

## 1. Mục tiêu và cách dùng

Triển khai backend cho điều phối viên nhóm thiết kế/web: một nguồn Google Sheets
chỉ đọc → kiểm thông tin → AI chọn tool/lập kế hoạch → preview bất biến → owner
duyệt → một card Trello → receipt và tra cứu. Giữ nguyên toàn bộ UI/UX hiện tại.

Đọc file này để hiểu dependency và DoD gốc, rồi đối chiếu source/commit/review
mới nhất trước khi chọn việc tiếp theo. `NEW`, `TODO`, tên interface và đường dẫn
trong phần kế hoạch là ảnh chụp ngày 22/09, không phản ánh trạng thái file hiện tại.

Nguồn thẩm quyền:

- [Baseline đã duyệt](../../BASELINE.md).
- [Đặc tả MVP v2](../../superpowers/specs/2026-09-21-workflow-platform-mvp-v2-design.md).
- [Execution contract](../../EXECUTION-CONTRACT.md), [API delta](../../API.md),
  [FR](../../functional-requirements.md), [dataset contract](../../MVP-V2-DATASET.md).
- [P1a đã sửa sau review](../../superpowers/plans/2026-09-21-mvp-v2-foundation-connectors.md).

P1a vẫn là chi tiết có thẩm quyền cho BE-01/02/03; không thực hiện lại hai bộ task.
Bộ tài liệu này mở rộng phần còn lại, không tự phê duyệt thay đổi scope.

## 2. Ảnh chụp hiện trạng ngày lập kế hoạch

Evidence pin: HEAD `b4e97b6b386ccce8729d71029c85a60353b367f9` + working tree ngày lập.
Working tree có scope docs chưa commit và các thay đổi branding/UI từ trước;
đặc biệt plan P1a/dataset đang untracked. Không được tạo worktree từ HEAD rồi mặc
định cho rằng các tài liệu này đã có trong đó.

`[verified]` bên dưới chỉ nghĩa là đã đọc source/config **tại evidence pin cũ**,
không phải trạng thái của commit `9335620` hoặc kết quả chạy lại runtime.

| Source hiện có | Quan sát và tác động tới kế hoạch |
|---|---|
| `packages/engine/src/prepare.ts:83` | `prepareAccepted` gọi planner trước dry-run; chưa truyền source snapshot. Cần preflight, không chỉ sửa prompt. |
| `packages/engine/src/planner-port.ts:10` | Planner nhận run/user/request/runtime; phải mở seam context có kiểu và provenance. |
| `packages/engine/src/snapshot.ts:29` | Tool chỉ nhận task_hub/filesystem; snapshot strict `b-local-preview-1`. Cần profile/version riêng, không đổi bytes cũ. |
| `packages/engine/src/gateway-types.ts:4` | ToolTarget là union hai server; CallContext chưa có binding nguồn/remote operation. |
| `packages/dsl/src/contracts.ts:61` | CreateRun strict, inputs chỉ scalar; không nhét cấu trúc nguồn vào inputs để lách schema. |
| `packages/dsl/src/contracts.ts:187` | Catalog B/local đúng hai server có thứ tự. Không thêm SaaS thẳng vào response cũ. |
| `packages/engine/src/ai/local-catalog.ts:47` | Manifest B/local cố định 8+2; phải có reviewed manifest pilot riêng. |
| `apps/api/src/ai-planner.ts:38` | Runtime AI đang nạp local catalog. Pilot cần composition riêng, không fallback fixture. |
| `apps/api/src/main.ts:163` | Engine factory hiện từ chối principal OIDC thứ hai khi AI mode bật. BE-23 phải giải quyết context/budget mỗi principal, không chỉ tạo hai login. |
| `packages/engine/src/receiver-policy.ts:13` | Mapping receiver đóng; SaaS create không được gắn `local_transaction`. |
| `packages/engine/src/store.ts:202` | Read model reconstruct từ DB, không gọi remote khi đọc history; phải giữ tính chất này. |
| `packages/db/src/migrate.ts:7` | Migration đọc `db/migrations`, kiểm filename/checksum. Không sửa SQL cũ; file cuối hiện là `0009_oidc_identity.sql`. |

Các kết quả pass lịch sử không chứng minh Sheets/Trello/AI MVP v2 đã chạy.

## 3. Kiến trúc và quyết định triển khai đề xuất

```text
Admission owner + một active run/DB
  → preflight qua policy/adapter đã review
  → immutable source + checklist + evidence
  → manual plan (gate P2) hoặc AI plan (gate P3)
  → validate + dry-run reads → immutable pilot preview
  → owner approval, TTL 10 phút
  → durable intent + dispatch marker → đúng một remote create
  → validated receipt / unknown, tuyệt đối không blind retry
```

1. Dùng namespace `google_sheets` và `trello`; không đổi nghĩa tool `task_hub`.
   Pilot catalog: `google_sheets.read_request`, `trello.list_lists`,
   `trello.list_members`, `trello.get_card`, `trello.create_card`.
2. Adapter HTTP đặt trong engine sau Gateway đã review; không thêm MCP server
   process/dependency chỉ để bọc HTTP. Tool identity/schema/policy/trace vẫn qua
   cùng ranh giới kiểm soát. Nếu rubric bắt buộc remote MCP process, mở quyết
   định kiến trúc riêng trước BE-13, không âm thầm thay transport.
3. `pilot-v2` là profile đóng, mặc định tắt. Fixture là cấu hình test tường minh;
   live thiếu credential/config phải lỗi. Không cho browser/LLM chọn host/token.
4. Đề xuất API namespace `/pilot/v2/...` để không phá strict DTO/frontend cũ.
   Shared engine/read models phải hỗ trợ snapshot có version, nhưng legacy route
   không trả run/catalog pilot cho client cũ. Một active run tính toàn DB, không
   tách giới hạn theo profile. BE-19 khóa contract trước coding HTTP.
5. Không thêm trạng thái run mới khi chưa cần; source/checklist/result là DTO
   pilot. `needs_input` terminal, bổ sung tạo run mới có parent link owner-scoped.
6. Unknown reservation không tự được giải phóng qua timeout, restart hay GET.
   Read-only reconciliation chỉ cung cấp evidence; chưa thêm nút force-success,
   retry hoặc administrative reset. UC3 có thể đọc candidate đã kiểm nhưng không
   được biến marker tương quan thành receipt nguyên tử.

Đây là các lựa chọn của plan, **chưa là implementation**. Approval tài liệu này
cần xác nhận namespace/profile/API riêng; UI vẫn hoàn toàn không đổi.

## 4. Kết quả graph và giới hạn evidence

CodeGraph được dùng trước tìm/đọc code, trả source hiện hành ở các seam trên.
GitNexus `query` và `context(prepareAccepted, prepare.ts)` được dùng để định vị.
Index tại `59b275dce709a02312c7aaca8d64d34c2b500b72`, chậm 3 commit.
`impact` với UID chính xác trả `risk: UNKNOWN`, direct=0: **không phải low risk**.
Đối chiếu source tìm được wrapper `engine.ts:67`, worker `apps/api/src/worker.ts:74`,
các test `ai-replan.integration.test.ts`, `ai-live-wiring.integration.test.ts`,
`audit-worker.integration.test.ts`. Tất cả phải regression khi đổi prepare.

Không refresh index trong lượt lập tài liệu; chưa xác minh đầy đủ runner/build
provenance. Graph chỉ hỗ trợ navigation, không làm chứng nhận blast radius.
Trước mỗi batch code, chạy impact với symbol cụ thể và source-verify callers;
UNKNOWN phải được xử lý, không bỏ qua vì số caller bằng 0.

## 5. PDG / source constraints

`pdg_query(controls, packages/engine/src/prepare.ts)` có dữ liệu nhưng trả truncated;
không dùng làm chứng minh đầy đủ. Các điều kiện liên quan được source-verify ở
`prepare.ts:231–264`: validate resolved args trước read; chỉ nhánh read gọi
`callStep`; replan đòi certainty không unknown và chưa đạt giới hạn 2.
`explain(prepare.ts)` không có finding nhưng không mô hình hóa đầy đủ callback/
property flow; không phải security pass. Các task approval/dispatch vẫn cần review
và fault test độc lập.

## 6. Chỉ mục task và phụ thuộc (kế hoạch gốc)

Owner A/B là vai trò đề xuất, chưa gán thành viên: A = engine/DB/API;
B = connector/AI/QA. Một người cũng làm được theo thứ tự. Không đồng nghĩa hai
worker trong ứng dụng. Cột dưới đây là danh mục và dependency gốc, **không phải
trạng thái TODO hiện tại**. Xem review theo phase và bảng trạng thái P6.

| ID | Task | Phụ thuộc kỹ thuật | Owner | Batch |
|---|---|---|---|---|
| BE-00 | Handoff tài liệu và baseline test | User duyệt execution | A | [P1 review](P1-REVIEW.md) |
| BE-01 | Source/business identity | BE-00 | A | 01 |
| BE-02 | Bounded source parser | BE-00 | A | 01 |
| BE-03 | Pure resource policy | BE-00 | A | 01 |
| BE-04 | Checklist/evidence/revision | BE-01,02 | B | 01 |
| BE-05 | DB run profile/source snapshot | BE-04 | A | 01 |
| BE-06 | DB business reservation/receipt | BE-01,05 | A | 01 |
| BE-07 | Internal pilot schemas/profile | BE-04,05,06 | A | 01 |
| BE-08 | Config/credential boundary | BE-03,07 | B | [P2 review](P2-REVIEW.md) |
| BE-09 | Bounded HTTP và lỗi/redaction | BE-08 | B | 02 |
| BE-10 | Sheets read-only adapter | BE-02,09 | B | 02 |
| BE-11 | Trello read/target resolution | BE-03,09 | B | 02 |
| BE-12 | Trello create contract adapter | BE-11 | B | 02 |
| BE-13 | Reviewed pilot Gateway/catalog | BE-07,10,11,12 | A | 02 |
| BE-14 | Manual source preflight | BE-04,05,13 | A | [P2 review](P2-REVIEW.md) |
| BE-15 | Snapshot/preview/approval binding | BE-06,07,14 | A | 03 |
| BE-16 | Dispatch + outcome transaction | BE-06,12,15 | A | 03 |
| BE-17 | Recovery/reconcile/cancel/expiry | BE-16 | A | 03 |
| BE-18 | Manual vertical slice + fault gate | BE-17 | B | 03 |
| BE-19 | Pilot HTTP contracts/read models | BE-18 | A | [P3 review](P3-REVIEW.md) |
| BE-20 | Source-aware planner/evidence | BE-14,19 | B | 04 |
| BE-21 | Retrieval/QE/replan/accounting | BE-13,16,20 | B | 04 |
| BE-22 | UC1/UC3/new-run clarification | BE-17,19,20 | A | 04 |
| BE-23 | Hai principal + security regression | BE-19,21,22 | A | 04 |
| BE-24 | Dataset 20 case × vi/en + holdout | BE-04,07 | B | [P4 review](P4-REVIEW.md) |
| BE-25 | Backend acceptance/regression gate | BE-18,23,24 | A+B | 05 |
| BE-26 | SaaS setup và live read preflight | BE-13 + user consent/resources | User+B | [06](06-LIVE-HANDOFF.md) |
| BE-27 | Live manual UC2 + receipt | BE-18,26 + write approval | A+B | 06 |
| BE-28 | Live AI/quality evaluation | BE-25,27 + provider/budget approval | B | 06 |
| BE-29 | Runbook/evidence/handoff | BE-25; BE-27/28 có verdict thật | A+B | 06 |

## 7. Thứ tự và cổng dừng đề xuất ngày 22/09

Thứ tự bên dưới là kế hoạch lịch sử. Code/test P1–P4 đã được thêm trước khi có
bằng chứng G2-live; **G2-live và G5-live/report vẫn `NOT_RUN`**. Ưu tiên hiện tại:
sửa lỗi chặn trong [audit P6](P6-REVIEW.md), test đường API pilot thực tế,
rồi mới xem xét preflight/live write/AI evaluation được phép.

1. **G0:** BE-00. Clean execution checkout có đúng scope docs đã duyệt.
2. **G1a:** BE-01…03, đúng P1a. Pure modules có test; chưa bật runtime.
3. **G1b:** BE-04…07. Source/checklist/schema/reservation qua isolated DB tests.
4. **G2-local:** BE-08…18. Manual one-card pipeline chạy với transport giả lập,
   fault suite an toàn; chưa được gọi đó là SaaS live.
5. **G2-live:** BE-26…27. User setup + consent; manual một card trên sandbox.
6. **G3:** BE-19…23. API/AI source-aware và hai principal. Theo lịch đã duyệt,
   activation P3 live sau G2-live. Nếu tài khoản chậm, chuẩn bị test/fixture
   offline trước; triển khai sớm P3 offline cần ghi rõ đổi thứ tự và được duyệt,
   không tự đánh dấu G2 đã đóng.
7. **G5-contract:** BE-24 có thể soạn sau G1b; BE-25 sau G3. Không dùng số test
   mới để xóa safety regressions của B/local.
8. **G5-live/report:** BE-28…29. Thiếu tài nguyên thì ghi BLOCKED_EXTERNAL/NOT_RUN,
   không chặn việc hoàn thiện unit/contract và runbook.

BE-08…12 có thể phát triển adapter riêng khi G1b xong, nhưng chỉ BE-16 mới mở
dispatch qua durable safety gate. Không ghép một PR khổng lồ chứa cả sáu batch.

Không đặt deadline hoặc số giờ giả chính xác: chưa biết hạn nộp/quỹ giờ. Sau G1a,
ghi actual effort và ước lượng lại từng batch. Safety không được cắt để kịp demo.

## 8. Kiểm thử và lệnh chuẩn

Các script dưới đây đã kiểm tra tồn tại trong package.json; **chưa chạy trong
lượt lập kế hoạch**. Chạy tại root execution checkout, Node theo package engines.

```powershell
npm run build -w @wap/dsl
npm run build -w @wap/db
npm run test:unit -w @wap/engine -- tests/pilot-identity.test.ts
npm run test:unit -w @wap/engine
npm run test:unit -w @wap/api
npm run check
```

Targeted file mới chỉ chạy sau khi task tạo nó. DB/API integration cần PostgreSQL
test khả dụng và dependency builds; dùng harness DB cô lập của project:

```powershell
npm run build
npm run test:integration -w @wap/engine -- tests/pilot-reservation.integration.test.ts
npm run test:integration -w @wap/api -- tests/pilot-http.integration.test.ts
npm run check:backend
```

`npm run check` có thể regenerate schema/OpenAPI; inspect diff, không sửa generated
file bằng tay. `npm run check:web`/`check:oidc:https` là regression tùy điều kiện
browser/Keycloak đã có, không phải quyền sửa UI hoặc setup service mới. Test
API fixture dùng admin connection để tạo DB riêng; không chạy destructive reset
trên DB demo. Test/live scripts mới phải được task tạo và kiểm trước khi dùng.

## 9. Rủi ro và quy tắc không thương lượng

- Một nonterminal run/DB + một worker; business dedupe vẫn cần unique DB race test
  độc lập dù admission thường serialize hai request.
- Source_key không có row index; create_intent không có operator/run/revision.
- Business confirmed không thay approval; approval đúng owner/version/hash/TTL.
- Remote write không atomic với PostgreSQL. Marker không phải receipt.
- Invalid output sau dispatch = unknown; unknown không retry/replan write.
- Thu hồi quyền phải kiểm lại trước dispatch; không hứa thu hồi được packet đã gửi.
- Giữ lịch sử B/local, credential không vào prompt/snapshot/event/trace/git/browser.
- Không sửa frontend, Design System, dataset B/local hay historical migration.
- Read history không gọi SaaS. Không mở network theo URL trong source/LLM output.
- Hai principal AI không dùng nhầm budget/authorization của configured demo user.

## 10. Ranh giới file và commit

Phạm vi tương lai: `packages/engine/src/pilot/`, các seam engine được liệt kê từng
task, `packages/dsl/src/`, `apps/api/src/`, `db/migrations/`, tests/docs/testdata v2.
Không đổi `apps/web/**`, `System Design/**`, dependency versions hoặc technical name.

Mỗi task/nhóm nhỏ có test → review diff → commit riêng khi đã được phép execution.
Trước commit chạy GitNexus detect_changes; partial/truncated không là clean.
Chỉ stage exact file allowlist, không `git add .`; không commit ở lượt lập plan này.
Gate auth/approval/dispatch/transactions cần reviewer độc lập sau implementation.

## 11. Context bàn giao cho người triển khai

```yaml
backend_plan:
  version: 1
  status: PROPOSED_NOT_EXECUTED
  source_head: b4e97b6b386ccce8729d71029c85a60353b367f9
  source_state: dirty_scope_docs_and_existing_branding_changes
  graph_state: three_commits_behind_source_weighted
  first_batch: BE-00_then_BE-01_BE-02_BE-03
  existing_p1a: docs/superpowers/plans/2026-09-21-mvp-v2-foundation-connectors.md
  execution_authorized: false
  ui_changes_authorized: false
  external_calls_authorized: false
  live_writes_authorized: false
  provenance_mode: ordinary_markdown_not_gitnexus_schema2_pack
  avoid:
    - overwrite_existing_dirty_changes
    - reinterpret_task_hub_as_live_saas
    - retry_unknown_write
    - share_owner_history_or_provider_budget
    - label_mock_as_live_or_customer_validated
```

Giới hạn công cụ: safe writer/read-plan của skill gitnexus-plan đòi POSIX
O_DIRECTORY/O_NOFOLLOW; runtime kiểm tra là win32 và không có hai flag đó. Vì
vậy đây là bộ Markdown viết bằng apply_patch theo quy tắc môi trường, **không**
giả làm plan có schema-2 provenance/safe-writer receipt. Người thực thi phải
re-anchor Git status, HEAD và source seams trước batch; không nạp bằng workflow
đòi receipt đó. Không build/patch skill hoặc đổi môi trường để né giới hạn.

## 12. Giả định, quyết định còn mở và hoãn

| Mục | Quyết định mặc định của plan / cổng |
|---|---|
| Tài khoản Sheets/Trello | Chưa xác nhận sẵn; BE-26, user tự login/consent. Không chặn unit/contract. |
| Credential Google | Adapter hiện chưa tạo bearer token service account; phương thức truy cập nguồn thật vẫn OPEN. Không gắn với OIDC. |
| Credential Trello | Chọn theo tài liệu API và tài khoản thử ở BE-26; không tự giả định bearer OAuth là tương thích. |
| Date-only → deadline | BE-04 chốt chính sách pilot có timezone + giờ hiển thị; không để AI tự thêm giờ. |
| Hạn nộp/quỹ giờ | Chưa có, không cam kết hoàn thành trong sáu tuần cũ. |
| UI | UI pilot đã có code; browser MVP v2 acceptance và review interaction delta còn OPEN. |
| Backend API namespace | `/pilot/v2` đã có; chưa chứng minh đủ UC1–UC3/AI trên đường API này. |
| Reconciliation không có remote ID | Giữ unknown, owner đưa candidate ID để read-only inspect; không force clear reservation. |
| Full product acceptance | Backend pass chưa đủ frontend/live/customer/rubric acceptance. |

Hoãn: Sheet writeback, Slack/email thật, scheduler, queue nhiều run, auto-resume,
workflow editor, self-service integrations/vault, multi-tenant/public staging.

## 13. Definition of Done và bàn giao

Tách bốn trạng thái thay vì một nhãn “xong”:

1. **PLAN_READY:** 30 task có dependency/checklist/test/DoD; đủ phủ V2-FR-01…11.
2. **BACKEND_CONTRACT_PASS:** BE-01…25 qua gate với fixtures/DB/HTTP cô lập;
   cả 20 case × vi/en có observed verdict, zero safety violation; UI không đổi.
3. **SAAS_LIVE_EXERCISED / AI_QUALITY_MEASURED:** chỉ nâng riêng theo BE-27/28
   có artifact thật, không suy từ contract pass; không đảm bảo AI luôn đúng.
4. **FULL_PRODUCT_ACCEPTANCE:** vẫn OPEN nếu chưa có browser v2/rubric; không
   nâng CUSTOMER_VALIDATED từ dữ liệu tổng hợp hoặc thành viên đóng vai.

Mẫu đóng mỗi task: commit, files, command + exit code, case IDs, artifact path,
reviewer findings/resolution, limitation/NOT_RUN, task tiếp theo. Tất cả số đo chỉ
điền sau khi chạy. Không xóa unknown intent để làm demo chạy lại được.
