# JIRA-02 · Hợp đồng công cụ Jira OAuth cá nhân, Workspace và Provenance

**Trạng thái:** Đã triển khai; review mã nguồn và kiểm tra local đạt; chưa merge.
**Nhiệm vụ:** Thiết lập toàn bộ type definitions, schemas, canonical JSON provenance helpers, policy/lease contracts, DTOs, typecheck fixture và error models tại `packages/tool-schemas` chuẩn bị cho chuỗi JIRA-03–11. Không sửa runtime, không bật cờ, không gọi mạng.
**Quyền lực chuẩn tắc:**
- Thiết kế: [Jira cá nhân/workspace](../../superpowers/specs/2026-10-30-jira-personal-workspaces-design.md) (Mục 4–13).
- Bằng chứng feasibility: [JIRA-01 Provider Facts](../../ai-evidence/JIRA-01-PROVIDER-FACTS.md).
- Kế hoạch chi tiết: [JIRA-02 Contracts Implementation Plan](../../superpowers/plans/2026-11-01-jira-02-contracts.md).
- Hiệu chỉnh sau review: mục 6 của kế hoạch chi tiết; không cần tài liệu ignored để nhận việc.
**Vai trò phụ trách:** Integration Engineer (`packages/tool-schemas`).
**Review độc lập:** Backend Engineer, AI Engineer, Frontend Engineer cùng review trước khi merge.
**Nhánh thi công:** Làm việc trực tiếp trên nhánh `codex/jira-02-contracts` (base `origin/main` tại `b29ab2e`). Không tạo nhánh feature rẽ nhánh từ feature branch khác.

---

## 1. Mục tiêu và phạm vi

Xây dựng hệ thống hợp đồng kiểu dữ liệu và schema hoàn chỉnh tại `packages/tool-schemas` làm nền tảng vững chắc cho các công việc tiếp theo (JIRA-03 Backend DB/Repo, JIRA-04 OAuth, JIRA-05 Policy, JIRA-06 Adapters, JIRA-07 Planner, JIRA-08 Executor, JIRA-09 UI).

### Phạm vi bao gồm:
1. **5 Tool Contracts `myjira.*`:** `myjira.list_sites`, `myjira.search_projects`, `myjira.search_issues`, `myjira.create_issue`, `myjira.add_comment`.
   - `myjira.ts` tái sử dụng/import trực tiếp `JIRA_PROJECT_PATTERN` và `JIRA_ISSUE_PATTERN` từ `./jira.js`, tuyệt đối không re-export gây xung đột symbol mơ hồ với `export * from './jira.js'` tại `index.ts`.
   - `myjira.list_sites` chỉ tiêu thụ danh mục site trong workspace đã qua xác minh policy (`siteId` là opaque server handle, không phải raw URL/cloudId).
2. **Server-owned Binding & Plan Connections:**
   - `JiraBinding` phân định rạch ròi 7 trường danh tính: `atiUserId`, `jiraAccountId`, `atlassianAccountId`, `workspaceId`, `membershipVersion`, `grantId`, và `identityVersion`.
   - `JiraPlanConnection extends JiraBinding` giữ đủ bảy trường, gồm `atiUserId`, thêm `workspaceVersion` và `siteSteps: Record<string, JiraPlanStepScope>`.
   - `JiraPlanStepScope` tách biệt `sitePolicyVersion` và `projectPolicyVersion?` (không dùng một version chung).
   - Hàm `validateJiraPlanConnection(value: unknown): JiraPlanConnection` kiểm tra đệ trình, làm sạch (sanitization), xác thực safe integer > 0 cho mọi version.
   - Token refresh làm tăng `tokenVersion` trong DB grant nhưng **không** làm thay đổi `identityVersion` và không làm thay đổi plan hash. `tokenVersion` không thuộc plan hash.
   - Không thêm thuộc tính thừa `siteId` vào `PlanStep`; `siteId` nằm trong `step.args`, target có thẩm quyền nằm ở server `PlanConnections.myjira`.
3. **Canonical JSON Composite Provenance & Source References:**
   - Mã hóa khóa tổng hợp chuẩn tắc: `JSON.stringify([workspaceId, cloudId, resourceType, providerId])` (mảng 4 phần tử chuỗi nghiêm ngặt). Chống va chạm tuyệt đối khi ID chứa ký tự phân cách (ví dụ `['a:b', 'c', 'issue', '1']` khác biệt với `['a', 'b:c', 'issue', '1']`).
   - `JiraSourceRef` gắn liền với `binding`, `workspaceId`, `workspaceVersion`, `siteId`, `cloudId`, `sitePolicyVersion`, cùng `projectId` và `projectPolicyVersion` (bắt buộc đi liền với nhau đối với tài nguyên project/issue/comment, bỏ qua đối với site).
   - `workspaceId` phải trùng khớp với `source.binding.workspaceId`.
   - `sameJiraSourceRef` so sánh đệ quy chính xác danh tính và thế hệ ủy quyền, phân biệt rạch ròi giữa nguồn tương đương và nguồn đã đổi revision/version.
   - Định danh resource trong provenance dùng stable provider ID (numeric ID), không dùng key có thể đổi.
   - `isCrossSiteReference` phát hiện nỗ lực dùng resource của Site A làm target tại Site B.
4. **Policy & Quyết định Đưa Nguồn vào Model (`decideJiraModelUse`):**
   - Loại bỏ toàn bộ các điều kiện sao chép từ Slack (`noTraining`, `verified`, `retention`). Đặc tả Jira không có consent gate mới cho LLM provider.
   - Cả `policy` và `request` đều phải gắn với một `JiraSourceRef` chính xác (`policy.source` và `request.source`).
   - `decideJiraModelUse` so khớp nguồn, tài khoản và workspace trước khi áp dụng bằng chứng native. Phân biệt các lý do từ chối: `identity_changed`, `source_mismatch`, `workspace_inactive`, `membership_inactive`, `site_disabled`, `project_denied`, `policy_stale`, `native_permission_denied`, `provider_unavailable`, và `invalid_evidence`.
   - Fail closed khi dữ liệu malformed, thiếu trường, version không hợp lệ, hoặc boolean bị kế thừa qua prototype (`invalid_evidence`), hoặc khi native state là unavailable/unknown. Local versions hay scopes không bao giờ thay thế kiểm tra quyền native thật ở JIRA-05.
   - `currentBinding: JiraBinding` là bằng chứng danh tính/membership hiện tại do server cung cấp, độc lập với hai source refs lịch sử. Nguồn và request cùng cũ không đủ để cấp quyền; khác current binding trả `identity_changed`, dữ liệu sai cấu trúc trả `invalid_evidence`.
5. **Đặc tả Giao thức Đồng bộ Hóa PostgreSQL (Dành cho Backend JIRA-03–05/08):**
   - Tài liệu hóa thứ tự và quy tắc khóa (không phải lời hứa runtime trong schema):
     - Bước 1: Lấy/refresh token trước khi khóa authorization.
     - Bước 2: Khóa grant refresh / advisory locks là luồng độc lập; tuyệt đối không giữ khóa grant refresh khi yêu cầu khóa authorization và ngược lại.
     - Bước 3: Outbound nắm giữ `FOR SHARE` có thời hạn (authorization lease) theo thứ tự tăng dần định sẵn (sắp xếp tập PK tăng dần trước khi khóa):
       `ati_workspaces` (sorted PK) → `ati_workspace_memberships` (sorted PK) → `jira_accounts` (sorted PK) → `ati_workspace_jira_sites` (sorted PK) → `ati_workspace_jira_projects` (sorted PK).
       *(Loại trừ rõ ràng hàng `jira_oauth_grants` khỏi thứ tự outbound authorization; thêm `ati_workspace_jira_projects`).*
     - Bước 4: Kiểm tra current versions. Giữ lease qua AbortSignal deadline xuyên suốt bước kiểm tra quyền native và gửi/kết toán HTTP request. Snapshot giải phóng trước HTTP bị nghiêm cấm vì TOCTOU.
     - Bước 5: Thao tác thu hồi quyền (revocation) tại ATI lấy khóa `FOR UPDATE` theo đúng thứ tự trên.
     - Token refresh không đảm bảo đổi identity generation; disconnect làm vô hiệu generation bằng CAS.
     - Kiểm thử concurrency 2 PostgreSQL clients thật thuộc JIRA-03–05/08.
6. **DTOs Hoàn chỉnh & Protocol Boundaries:**
   - Phân biệt rõ các trạng thái kết nối độc lập: `identity_connected`, `scope_required`, `reconnect_required`, `connected`, `disconnected`.
   - Phân biệt trạng thái membership: `pending`, `active`, `rejected`, `removed`.
   - Phân biệt lỗi 403 native permission denied với lỗi mất token/hết hạn credentials; bổ sung `upstream_not_found` (404 non-retryable).
   - Tiếp thu bổ sung từ Frontend review: danh sách workspace (`GetWorkspacesResponse`, `WorkspaceSummary`), danh sách thành viên với phiên bản CAS (`ListWorkspaceMembersResponse`, `WorkspaceMemberItem`), quản trị site workspace (`ListWorkspaceSitesResponse`, `LinkWorkspaceSiteRequest/Response`, `UpdateWorkspaceSiteRequest/Response`), quản trị project theo numeric IDs (`GetWorkspaceProjectsResponse`, `ConfigureWorkspaceProjectsRequest/Response`), quản trị invite không chứa secret (`ListWorkspaceInvitesResponse`, `RevokeInviteResponse`), `displayName` tài khoản Jira, và `identityVersion` khi disconnect.
   - Tách biệt rõ `workspaceVersion` và `membershipVersion` trong `WorkspaceSummary`.
   - Boundary bảo mật: OAuth `authUrl` mang tham số protocol `state` hợp lệ; endpoint callback nhận `code` và `state` làm sensitive inputs cần thiết; endpoint join nhận `inviteToken`. Output thông thường, listing và logs **tuyệt đối không** echo `code`, `state` hay secret invite. Tạo invite trả secret một lần duy nhất tại response `POST /api/workspaces/:id/invites`.
   - Che giấu sự tồn tại của workspace người dùng không được phép biết (trả về 404 thay vì 403).
7. **Typecheck Fixture Độc lập:**
   - Bổ sung `packages/tool-schemas/tsconfig.contracts.json` mở rộng `./tsconfig.json`, bao gồm `src/**/*` và `tests/fixtures/consumer-compile-fixture.ts`, bật `noEmit: true`.
   - Lệnh kiểm tra typecheck chuẩn: `npx tsc --noEmit -p packages/tool-schemas/tsconfig.contracts.json`.
8. **Tương thích cờ tắt (Flag-Off Isolation):**
   - `ALL_TOOLS` giữ nguyên 33 tools, `SERVICE_REGISTRY` giữ nguyên 8 services.

---

## 2. Danh mục file phụ trách

| File | Hành động | Mục đích |
|---|---|---|
| `packages/tool-schemas/src/myjira.ts` | Tạo mới | Định nghĩa 5 tool `myjira.*`, import pattern từ `./jira.js`, scopes Atlassian 3LO |
| `packages/tool-schemas/src/myjira-context.ts` | Tạo mới | `JiraBinding`, `JiraSourceRef` đầy đủ versions, canonical JSON compound keys, cross-site detection |
| `packages/tool-schemas/src/myjira-policy.ts` | Tạo mới | Policy kiểm soát model gắn nguồn, authorization lease type, verified directory, lock order constants |
| `packages/tool-schemas/src/myjira-dto.ts` | Tạo mới | DTOs API endpoints đầy đủ, CAS decision, invite lifecycle, error taxonomy, protocol boundaries |
| `packages/tool-schemas/src/registry/myjira.ts` | Tạo mới | `MYJIRA_SERVICE: ServiceDefinition` dạng `personal` |
| `packages/tool-schemas/src/types.ts` | Cập nhật | Cập nhật `JiraPlanConnection`, `JiraPlanStepScope` và `PlanConnections` (không thêm `siteId` thừa vào `PlanStep`) |
| `packages/tool-schemas/src/index.ts` | Cập nhật | Export các module mới; giữ nguyên `ALL_TOOLS` và `SERVICE_REGISTRY` |
| `packages/tool-schemas/tsconfig.contracts.json` | Tạo mới | Cấu hình tsconfig kiểm tra biên dịch contracts và compile fixture |
| `packages/tool-schemas/package.json` | Cập nhật | Chạy compiler fixture trước Vitest để CI cũng kiểm hợp đồng kiểu |
| `packages/tool-schemas/tests/myjira-schemas.test.ts` | Tạo mới | Kiểm thử schema Ajv, tham số, side-effects, risk levels |
| `packages/tool-schemas/tests/myjira-context.test.ts` | Tạo mới | Kiểm thử binding purity, strip credentials, version invalidation, canonical JSON tuples, swap tests |
| `packages/tool-schemas/tests/myjira-policy.test.ts` | Tạo mới | Kiểm thử quyết định model policy gắn nguồn, cấm mượn quyền giữa các resource, hierarchy invariants |
| `packages/tool-schemas/tests/myjira-dto.test.ts` | Tạo mới | Kiểm thử DTOs request/response, sensitive input boundaries, error mapping |
| `packages/tool-schemas/tests/myjira-regression.test.ts` | Tạo mới | Bảo vệ bất biến `ALL_TOOLS.length === 33`, `SERVICE_REGISTRY.length === 8` |
| `packages/tool-schemas/tests/fixtures/consumer-compile-fixture.ts` | Tạo mới | Fixture kiểm tra typecheck người dùng contract |

---

## 3. Tiêu chí nghiệm thu (Checklist)

- [x] **Import/Export an toàn:** `myjira.ts` import `JIRA_PROJECT_PATTERN` và `JIRA_ISSUE_PATTERN` từ `./jira.js`, không tạo duplicate export mơ hồ ở `index.ts`.
- [x] **Tool schemas:** 5 tools `myjira.*` chuẩn xác: `list_sites`, `search_projects`, `search_issues`, `myjira.create_issue`, `myjira.add_comment`.
- [x] **Clean & Distinguishable Binding:** `validateJiraBinding` phân biệt `atiUserId`, `jiraAccountId`, `atlassianAccountId`, `workspaceId`, `grantId`, `membershipVersion`, `identityVersion`. Loại bỏ toàn bộ token/secret và không mutate input.
- [x] **Deep Plan Connection Sanitization:** `validateJiraPlanConnection` làm sạch và xác thực `workspaceVersion`, `sitePolicyVersion` và `projectPolicyVersion` dương.
- [x] **Canonical JSON Compound Keys:** `formatJiraCompoundKey` dùng `JSON.stringify([workspaceId, cloudId, resourceType, providerId])`. Bóc tách với `parseJiraCompoundKey`. Test chống va chạm với ID chứa ký tự `:`.
- [x] **Source-Bound Policy (No Slack Artifacts):** Xóa bỏ hoàn toàn `noTraining`, `verified`, `retention`. Policy và Request cùng gắn với `JiraSourceRef`. Bị chặn khi tráo `cloudId`, `siteId`, `projectId`, `actor` hoặc mượn `nativePermission` của resource khác.
- [x] **PostgreSQL Sync Protocol Documentation:** Khai báo cấu trúc `JiraAuthorizationLease` và mảng thứ tự khóa 5 bảng (thêm `ati_workspace_jira_projects`, không chứa `jira_oauth_grants`), quy định thứ tự khóa khi có nhiều site/project (sort PK).
- [x] **Rich DTOs & Protocol Boundaries:** Đủ DTO workspace/member listing, site/project admin, invite list/revoke; phân biệt các thế hệ version. `authUrl` mang protocol `state`, callback nhận `code`/`state`, join nhận `inviteToken`. Response thông thường không có sensitive fields. 403 native permission khác reconnect/auth error. Kiểm tra kiểu không thay thế serializer/HTTP validation của Backend.
- [x] **No Redundant PlanStep Metadata:** `PlanStep` không thêm `siteId`. Target được phân giải qua `PlanConnections.myjira.siteSteps[stepId]`.
- [x] **TypeScript Consumer Compile Fixture:** Có `packages/tool-schemas/tsconfig.contracts.json` và fixture `tests/fixtures/consumer-compile-fixture.ts` chạy pass với `npx tsc --noEmit -p packages/tool-schemas/tsconfig.contracts.json`.
- [x] **Flag-Off Invariant:** `ALL_TOOLS.length === 33`, `SERVICE_REGISTRY.length === 8`.
- [x] **Grounding Metadata:** Site output có `id` alias của `siteId`; ba read tools khai báo `observedFields` giữ site metadata. Source ID project/issue/comment là chuỗi thập phân dương chuẩn, không phải mutable key.
- [x] **Current Authority & Lease Shape:** Policy đối chiếu `currentBinding`; lease cùng workspace và khoảng thời gian bằng `ttlMs`. Khóa SQL/AbortSignal thực thuộc các card Backend sau.

---

## 4. Lệnh kiểm tra

### Chạy test package tool-schemas:
```bash
npm test -w @wap/tool-schemas -- tests/myjira-schemas.test.ts tests/myjira-context.test.ts tests/myjira-policy.test.ts tests/myjira-dto.test.ts tests/myjira-regression.test.ts
```

### Chạy kiểm tra Typecheck Contracts Fixture (bắt buộc):
```bash
npx tsc --noEmit -p packages/tool-schemas/tsconfig.contracts.json
```

### Typecheck toàn repo:
```bash
npm run typecheck:v3
```

---

## 5. Quy trình bàn giao và phối hợp sau JIRA-02

1. **Implementer (Integration):** Làm việc trực tiếp trên nhánh `codex/jira-02-contracts`, code tuần tự 5 task trong plan, bảo đảm RED → GREEN thật.
2. **Review độc lập (Cross-Module Review):**
   - **Backend Engineer:** Soát `JiraBinding`, `validateJiraPlanConnection`, synchronization protocol, lock hierarchy, DTOs và error categories.
   - **AI Engineer:** Soát 5 tool schemas, canonical JSON compound keys, `decideJiraModelUse`, source ref swap tests, và `PlanConnections`.
   - **Frontend Engineer:** Soát DTOs kết nối, protocol state/code boundaries, join request, member decision, capabilities.
3. **Merge Gate:** Chỉ merge PR sau khi 3 reviewer approve và CI v3 xanh.
4. **Kích hoạt song song sau merge:** JIRA-03 (Backend), JIRA-06 (Integration), JIRA-09A (Frontend). (JIRA-03, 04, 05, 08 chạy tuần tự).

---

## 6. Kết quả

- **Nhánh/base:** codex/jira-02-contracts từ origin/main b29ab2e6a51b6fadc9c7553ae59ec09c83c9f7c2.
- **Source commit:** 6c53436626149b304195446c2add51bbc1e92651 — feat(tool-schemas): define personal Jira workspace contracts.
- **Thực thi:** Integration worker dùng Gemini 3.8 Flash High, effort high. Khi 9Router hết quota, tiếp tục bằng Antigravity CLI native cùng model/effort theo yêu cầu chủ dự án. Codex thực hiện kiểm thử độc lập, tích hợp và hoàn thiện bàn giao.
- **Phạm vi:** 15 file package gồm 5 tool, registry opt-in, binding/source/plan validators, pure policy/currentBinding, lease shape/SQL protocol, API DTOs, compiler fixture và tests. Không đổi catalog mặc định (33 tools/8 services).

### Bằng chứng RED

- Trước source: năm suite thiếu module mới, exit 1, **0 assertions**; compiler thiếu exports/PlanConnections.myjira, exit 2. Đây là feature-absent RED, không phải assertion hành vi.
- Các test hành vi bổ sung trước sửa: 36 fail / 79 pass (115), exit 1; sau review đầy đủ: 27 fail / 197 pass (224), exit 1. Bao gồm matched version 0, truthy flags, source mismatch, currentBinding cũ, TTL và metadata grounding. Compiler probes cho DTO thiếu exit 2 trước định nghĩa.
- Fixture chia sẻ source và fixture __proto__ dựng sai đã được sửa. Không tính lần fail do dựng sai fixture là bằng chứng guard; mutation sau sửa xác nhận guard thực tế.

### Bằng chứng GREEN trên source commit

| Lệnh | Kết quả thực tế |
|---|---|
| npm test -w @wap/tool-schemas | Compiler fixture + 17 files, **341/341 PASS**, exit 0 |
| npx tsc --noEmit -p packages/tool-schemas/tsconfig.contracts.json | exit 0 |
| npm run typecheck:v3 | API + web, exit 0 |
| npm run check | exit 0; schemas 341, adapters 456, planner 381, executor 42, API 779, web 893 tests PASS; eval **406/406 PASS**; build/security/launcher/Node checks PASS |

Full check dùng PostgreSQL tạm độc lập trên loopback 56533; không dùng database ATI runtime. Không nạp .env của checkout gốc.

### Mutations và review

- **9/9 mutation bị bắt bằng assertion hành vi:** bỏ kiểm version dương; làm lọt credential; gán step map qua prototype setter; nối khóa bằng colon; bỏ so cloud; mượn native permission; bỏ currentBinding; cho retry write_indeterminate; đưa myjira vào catalog theo env ON. Không tính syntax/import/type failure là mutation kill. Mỗi lần phục hồi byte gốc và kiểm SHA.
- **Backend, AI và Frontend review độc lập: ĐẠT** trên source 6c53436; các finding trước đều ADDRESSED, không còn Critical/Important. AI đã review toàn branch. Codex Reality Checker chạy lại các lệnh và mutations nêu trên; reviewer chuyên môn đọc diff, không tự tuyên bố đã chạy lệnh.
- **Merge gate:** PR vào main phải có CI xanh đúng final head và review đạt. Tình trạng CI cuối cùng xem tại checks của PR; chưa merge hoặc mở consumer trong lần ghi bàn giao này. CURRENT-STATE.md và ROADMAP.md không sửa trong PR thi công.

### Chưa làm

Runtime PostgreSQL lease/rotation, HTTP adapter/AbortSignal, policy nguồn thật, planner/executor, API/UI và live acceptance thuộc JIRA-03–11. Validator thuần chỉ kiểm hợp đồng, không chứng minh quyền native hay lease có hiệu lực. Cờ chưa bật; không có Jira live write hoặc chiến dịch model mới. Sau merge mới giao JIRA-03, JIRA-06 và JIRA-09A.
