# JIRA-02 · Jira Personal OAuth & Workspaces Contracts Plan

> **For agentic workers:** Coordinator dùng superpowers:subagent-driven-development; Integration implementer thực hiện TDD trong một card JIRA-02, với năm phần nội bộ. Steps dùng checkbox để theo dõi.

**Goal:** Xây dựng toàn bộ hợp đồng kiểu dữ liệu, schemas, canonical JSON provenance helpers, policy/lease contracts, DTOs và error taxonomy cho Jira OAuth cá nhân và Workspace ATI tại `packages/tool-schemas` trước khi triển khai backend, adapter và UI.
**Architecture:** Mở rộng `packages/tool-schemas` bằng các module hợp đồng thuần túy (pure contracts). Công cụ `myjira.*` và dịch vụ `myjira` được tách biệt hoàn toàn khỏi catalog mặc định (`ALL_TOOLS`, `SERVICE_REGISTRY`) theo cơ chế flag-off. Không chứa runtime I/O, không lưu trữ token/secret trong binding hay DTO, không tạo mock concurrency boolean giả tạo.
**Tech Stack:** Node.js `^22.12.0 || >=24.0.0`, TypeScript, Vitest, Ajv `^8.20.0`.
**Spec chuẩn tắc:** [Jira cá nhân và workspace ATI — thiết kế](../specs/2026-10-30-jira-personal-workspaces-design.md) (Mục 4–13).
**Task Card:** [JIRA-02 Contracts](../../handoff/tasks/JIRA-02-contracts.md).
**Phán quyết review:** các sửa chốt về nguồn, lease và định danh đã được ghi trong ràng buộc bên dưới; không cần tài liệu cục bộ ignored để thực thi kế hoạch.
**Vai trò thực thi:** Integration Engineer (`packages/tool-schemas`).
**Nhánh thi công:** Trực tiếp trên nhánh `codex/jira-02-contracts` (base `origin/main` tại `b29ab2e`).
**Reviewers:** Backend Engineer, AI Engineer, Frontend Engineer độc lập trước khi merge.

---

## 1. Ranh giới chuẩn tắc & Ràng buộc toàn cục (Global Constraints)

1. **Bảo mật & Phân định Danh tính Rạch ròi (Zero Credential Leakage & Identity Model):**
   - Access token, refresh token, client secret, invite token hash **TUYỆT ĐỐI KHÔNG** xuất hiện trong `JiraBinding`, `PlanConnections`, `JiraSourceRef`, `JiraCompoundKey`, DTOs công khai hoặc error responses.
   - **Protocol Boundaries:** OAuth `authUrl` được phép mang protocol `state`. Endpoint callback nhận `code` và `state` làm sensitive inputs cần thiết; endpoint join nhận `inviteToken`. Output thông thường, listing và logs **tuyệt đối không** echo `code`, `state` hay secret invite. Tạo invite trả secret một lần duy nhất tại response `POST /api/workspaces/:id/invites`.
   - `JiraBinding` phân định rạch ròi 7 trường:
     - `atiUserId`: ID người dùng ATI (UUID).
     - `jiraAccountId`: ID khóa chính bản ghi local trong bảng `jira_accounts`.
     - `atlassianAccountId`: Opaque accountId của Atlassian từ User Identity API (`/me`).
     - `workspaceId`: ID workspace ATI.
     - `membershipVersion`: Thế hệ membership của người dùng trong workspace.
     - `grantId`: ID bản ghi OAuth grant trong DB local.
     - `identityVersion`: Thế hệ danh tính Atlassian (tăng khi reconnect hoặc switch account).
   - `validateJiraBinding` tự động loại bỏ (strip) trường nhạy cảm nếu có, trả về bản sao sạch, không mutate input.

2. **Cách ly cờ tắt (Flag-Off Isolation):**
   - Dù cờ `MYJIRA_ENABLED` tắt hay bật trong env process, `ALL_TOOLS.length` giữ nguyên **33** công cụ và `SERVICE_REGISTRY.length` giữ nguyên **8** dịch vụ trong `tool-schemas`. Việc nạp động catalog theo cờ thuộc về runtime ở các task sau.
   - `myjira.ts` import và tái sử dụng trực tiếp `JIRA_PROJECT_PATTERN` và `JIRA_ISSUE_PATTERN` từ `./jira.js`. Không re-export trùng tên để tránh xung đột với `export * from './jira.js'` tại `index.ts`. Không đổi định nghĩa legacy `jira.ts`.

3. **Mã hóa Khóa Tổng hợp Chuẩn tắc & Source References:**
   - Khóa tổng hợp trong working memory và provenance BẮT BUỘC mã hóa theo định dạng chuẩn tắc:
     `JSON.stringify([workspaceId, cloudId, resourceType, providerId])`
   - Bóc tách nghiêm ngặt dạng tuple 4 phần tử chuỗi: kiểm tra mảng độ dài 4, tất cả phần tử là non-empty string, `resourceType` hợp lệ. Chống va chạm tuyệt đối khi ID chứa ký tự `:` (ví dụ `['a:b', 'c', 'issue', '1']` khác biệt hoàn toàn với `['a', 'b:c', 'issue', '1']`).
   - `providerId` trong provenance là stable provider ID (numeric ID), không dùng project/issue key có thể bị rename hoặc move.
   - `JiraSourceRef` gắn liền với `binding`, `workspaceId`, `workspaceVersion`, `siteId`, `cloudId`, `sitePolicyVersion`, cùng `projectId` và `projectPolicyVersion` (bắt buộc đi liền với nhau đối với tài nguyên project/issue/comment, bỏ qua đối với site).
   - `workspaceId` phải trùng khớp với `source.binding.workspaceId`.
   - `sameJiraSourceRef` so sánh đệ quy chính xác danh tính và thế hệ ủy quyền, phân biệt rạch ròi giữa nguồn tương đương và nguồn đã đổi revision/version.
   - `isCrossSiteReference` chặn nỗ lực dùng issue của Site A làm target cho bước thuộc Site B. Cho phép nội dung comment nhắc tới issue của site khác dưới dạng văn bản.

4. **Policy Gắn Nguồn Chặt Chẽ (Không Slack Artifacts):**
   - Xóa bỏ hoàn toàn các điều kiện `noTraining`, `verified`, `retention`.
   - Cả `policy` và `request` đều gắn với một `JiraSourceRef` chính xác (`policy.source` và `request.source`).
   - `decideJiraModelUse` so khớp nguồn, tài khoản và workspace trước khi áp dụng bằng chứng native. Phân biệt các lý do từ chối: `identity_changed`, `source_mismatch`, `workspace_inactive`, `membership_inactive`, `site_disabled`, `project_denied`, `policy_stale`, `native_permission_denied`, `provider_unavailable`, và `invalid_evidence`.
   - Không được phép mượn quyền `nativePermission='granted'` của resource khác: tráo `cloudId`, `siteId`, `projectId`, `providerResourceId`, `actor` hay `workspace` đều bị chặn.
   - Fail closed khi dữ liệu malformed, thiếu trường, version không hợp lệ, hoặc boolean bị kế thừa qua prototype (`invalid_evidence`), hoặc khi native state là unavailable/unknown. Local versions hay scopes không bao giờ thay thế kiểm tra quyền native thật ở JIRA-05.
   - Phân biệt rõ lỗi 403 native permission denied với lỗi mất token/hết hạn kết nối.

5. **Đặc tả Giao thức Đồng bộ Hóa PostgreSQL (Dành cho Backend JIRA-03–05/08):**
   - Tài liệu hóa thứ tự và quy tắc khóa (không phải lời hứa runtime trong schema):
     - Bước 1: Lấy/refresh token trước khi khóa authorization.
     - Bước 2: Khóa grant refresh (hoặc advisory lock cho token rotation) là luồng riêng biệt; tuyệt đối không giữ grant lock khi yêu cầu authorization lock và ngược lại. Hàng `jira_oauth_grants` bị loại trừ khỏi thứ tự authorization outbound.
     - Bước 3: Outbound nắm giữ `FOR SHARE` có thời hạn (authorization lease) theo thứ tự tăng dần định sẵn (sắp xếp tập PK tăng dần trước khi khóa):
       `ati_workspaces` → `ati_workspace_memberships` → `jira_accounts` → `ati_workspace_jira_sites` → `ati_workspace_jira_projects`.
     - Bước 4: Kiểm tra current versions. Giữ lease qua AbortSignal deadline xuyên suốt bước kiểm tra quyền native và gửi/kết toán request HTTP. Không giải phóng lease trước khi gửi request (chống TOCTOU).
     - Bước 5: Thao tác thu hồi quyền (revocation) tại ATI lấy khóa `FOR UPDATE` theo đúng thứ tự trên.
     - Token refresh làm tăng `tokenVersion` trong DB grant nhưng KHÔNG làm thay đổi `identityVersion` và KHÔNG làm thay đổi plan hash. `tokenVersion` không thuộc plan hash. Disconnect làm vô hiệu hóa generation bằng CAS.
     - *Lưu ý:* Kiểm thử concurrency 2 client PostgreSQL thật thuộc phạm vi JIRA-03–05/08; không viết test boolean giả lập trong schemas.

6. **Không Thêm Metadata Thừa vào PlanStep:**
   - `siteId` của công cụ đã nằm trong `step.args.siteId`. Target có thẩm quyền của server nằm ở `PlanConnections.myjira.siteSteps[stepId]`. Không thêm trường `siteId` vào `PlanStep`.
   - `JiraPlanConnection` mang `workspaceVersion`, `sitePolicyVersion` và `projectPolicyVersion?` per-step. Có hàm `validateJiraPlanConnection(value: unknown): JiraPlanConnection` làm sạch và kiểm tra phiên bản an toàn.

7. **Kiểm tra Type Safety Bằng TypeScript Compile Fixture:**
   - Tạo file fixture `tests/fixtures/consumer-compile-fixture.ts` và cấu hình riêng `packages/tool-schemas/tsconfig.contracts.json` mở rộng `./tsconfig.json`, bao gồm `src/**/*` và `tests/fixtures/consumer-compile-fixture.ts`, bật `noEmit: true`.
   - Chạy lệnh: `npx tsc --noEmit -p packages/tool-schemas/tsconfig.contracts.json`.

---

## 2. Tiêu điểm Review (Review Focus Items)

1. **Collision-Safe Canonical JSON:** `formatJiraCompoundKey` dùng `JSON.stringify` chống va chạm khi ID chứa ký tự `:`. `parseJiraCompoundKey` bắt buộc tuple 4 chuỗi.
2. **7-Trường Định danh trong JiraBinding:** Phân biệt rõ `atiUserId`, `jiraAccountId`, `atlassianAccountId`, `workspaceId`, `grantId`, `membershipVersion`, `identityVersion`.
3. **Purity & Deep Sanitization:** `validateJiraBinding` và `validateJiraPlanConnection` loại bỏ sạch `accessToken`, `refreshToken`, `clientSecret` và không mutate input.
4. **Source-Bound Policy & Anti-Borrowing:** `decideJiraModelUse` gắn chặt với `JiraSourceRef`. Cấm mượn quyền giữa các resource khi tráo site, project, actor, cloudId.
5. **Synchronization Protocol Specification:** Hàng `ati_workspace_jira_projects` có mặt; `jira_oauth_grants` được loại trừ khỏi outbound authorization; quy định thứ tự khóa rõ ràng (sort PK sets).
6. **No Slack Artifacts:** Không có `noTraining`, `verified`, `retention` trong Jira policy.
7. **Error Taxonomy & Protocol Security:** 403 native permission phân biệt với AuthError; workspace không được phép truy cập trả về 404 để giấu sự tồn tại; `authUrl` mang protocol state, callback code/state là sensitive input.
8. **Contracts Compile Fixture:** `packages/tool-schemas/tsconfig.contracts.json` kiểm tra typecheck với `npx tsc --noEmit -p packages/tool-schemas/tsconfig.contracts.json`.
9. **Regression Invariants:** `ALL_TOOLS.length === 33` và `SERVICE_REGISTRY.length === 8`.

---

## 3. Danh mục Tasks thi công

```
JIRA-02 (Integration Engineer)
├── Task 1: Định nghĩa 5 Tool Schemas `myjira.*` (Tái sử dụng Regex, Không xung đột Export)
├── Task 2: Canonical JSON Provenance, 7-Trường Binding, Source References, Deep Sanitization & Swap Tests
├── Task 3: Policy Decisions Gắn Nguồn (Không Slack Artifacts), Authorization Lease & PostgreSQL Lock Hierarchy
├── Task 4: DTOs Đầy đủ, Protocol Boundaries, Workspace Admin CAS & Error Taxonomy
└── Task 5: Opt-in Service Registry, PlanConnections, tsconfig.contracts.json, Compile Fixture & Regression Tests
```

---

### Task 1: Định nghĩa 5 Tool Schemas `myjira.*` (Tái sử dụng Regex, Không xung đột Export)

**Files:**
- Tạo mới: `packages/tool-schemas/src/myjira.ts`
- Tạo mới: `packages/tool-schemas/tests/myjira-schemas.test.ts`

**Trách nhiệm & Kiểu dữ liệu:**
1. Import patterns từ `./jira.js`:
```typescript
import { JIRA_PROJECT_PATTERN, JIRA_ISSUE_PATTERN } from './jira.js';

export const JIRA_SITE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
export const JIRA_CLOUD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MYJIRA_SCOPES = [
  'offline_access',
  'read:me',
  'read:jira-work',
  'write:jira-work',
] as const;
```
*(Tuyệt đối không re-export `JIRA_PROJECT_PATTERN` hoặc `JIRA_ISSUE_PATTERN` từ file này để tránh xung đột tại `index.ts`).*

2. 5 Công cụ Jira OAuth cá nhân (Đặc tả Mục 7.2):
- `myjira.list_sites`: Đọc danh mục site trong workspace đã qua xác minh policy. Listable: true. Discovers: `jira_site`. Input: `query` (string, max 2000), `limit` (integer, 1..10, default 10). Output: `Array<{ siteId: string, cloudId: string, name: string, url: string }>`.
- `myjira.search_projects`: Tìm project trong site đã xác minh. Listable: true. Discovers: `jira_project`. Input: `siteId` (pattern `JIRA_SITE_ID_PATTERN`, x-resource: `jira_site`, x-resource-field: `siteId`), `query` (string, max 2000), `limit` (integer, 1..20, default 20). Output: `Array<{ siteId: string, id: string, key: string, name: string }>`.
- `myjira.search_issues`: Tìm issue trong site và project. Listable: false. Discovers: `jira_issue`. Input: `siteId`, `projectKey` (pattern `JIRA_PROJECT_PATTERN`, x-resource: `jira_project`, x-resource-field: `key`), `query` (string, max 2000), `limit` (integer, 1..20, default 20). Output: `{ issues: Array<{ siteId: string, id: string, key: string, url: string, title: string, status: string }> }`.
- `myjira.create_issue`: Tạo issue mới. SideEffect: `write`, RiskLevel: `medium`. Input: `siteId`, `projectKey`, `summary` (1..255 chars), `description?` (max 4000), `issueType?` (1..255). Output: `{ siteId: string, id: string, key: string, url: string }`.
- `myjira.add_comment`: Thêm comment văn bản thuần. SideEffect: `write`, RiskLevel: `medium`. Input: `siteId`, `issueKey` (pattern `JIRA_ISSUE_PATTERN`, x-resource: `jira_issue`, x-resource-field: `key`), `body` (1..4000 chars). Output: `{ siteId: string, id: string, issueKey: string, url: string }`.

- [x] **Step 1:** Viết test `packages/tool-schemas/tests/myjira-schemas.test.ts`:
  - Khởi tạo Ajv, biên dịch toàn bộ `inputSchema` và `outputSchema` của 5 công cụ.
  - Kiểm tra `discovers`, `listable`, `sideEffect`, `riskLevel` của từng công cụ.
  - Kiểm tra `x-resource` và `x-resource-field` trên `siteId`, `projectKey`, `issueKey`.
  - Kiểm tra validation với các tham số hợp lệ và không hợp lệ (vượt max length, sai regex, thiếu trường bắt buộc).
- [x] **Step 2:** Chạy test xác nhận RED (Coordinator đã chạy: exit 1, missing `../src/myjira.js`, 0 assertions, `.codex/jira02/contracts-red.log`):
  ```bash
  npm test -w @wap/tool-schemas -- tests/myjira-schemas.test.ts
  ```
- [x] **Step 3:** Triển khai `packages/tool-schemas/src/myjira.ts`.
- [x] **Step 4:** Chạy lại test xác nhận GREEN:
  ```bash
  npm test -w @wap/tool-schemas -- tests/myjira-schemas.test.ts
  ```

---

### Task 2: Canonical JSON Provenance, 7-Trường Binding, Source References, Deep Sanitization & Swap Tests

**Files:**
- Tạo mới: `packages/tool-schemas/src/myjira-context.ts`
- Tạo mới: `packages/tool-schemas/tests/myjira-context.test.ts`

**Trách nhiệm & Kiểu dữ liệu:**
1. `JiraBinding` với 7 trường danh tính:
```typescript
export interface JiraBinding {
  atiUserId: string;
  jiraAccountId: string;        // Khóa chính bảng jira_accounts local
  atlassianAccountId: string;   // Opaque ID từ Atlassian /me
  workspaceId: string;
  membershipVersion: number;
  grantId: string;
  identityVersion: number;
}
```
2. `validateJiraBinding(value: unknown): JiraBinding`:
   - Kiểm tra `atiUserId`, `jiraAccountId`, `atlassianAccountId`, `workspaceId`, `grantId` là non-empty string.
   - Kiểm tra `membershipVersion`, `identityVersion` là safe integer > 0.
   - Loại bỏ các trường nhạy cảm (`accessToken`, `refreshToken`, `clientSecret`), trả về object mới, không mutate input.
3. `sameJiraBinding(a: JiraBinding, b: JiraBinding): boolean`:
   - So khớp tuyệt đối toàn bộ 7 trường.
4. Canonical JSON Compound Keys & Cross-site Detection:
```typescript
export type JiraResourceType = 'site' | 'project' | 'issue' | 'comment';

export interface JiraCompoundKey {
  workspaceId: string;
  cloudId: string;
  resourceType: JiraResourceType;
  providerId: string; // Stable provider ID; site dùng cloudId, project/issue/comment thường là numeric ID.
}

export function formatJiraCompoundKey(key: JiraCompoundKey): string {
  return JSON.stringify([key.workspaceId, key.cloudId, key.resourceType, key.providerId]);
}

export function parseJiraCompoundKey(raw: string): JiraCompoundKey;
export function isCrossSiteReference(
  a: { workspaceId: string; cloudId: string },
  b: { workspaceId: string; cloudId: string }
): boolean;
```
*(Hàm `parseJiraCompoundKey` kiểm tra nghiêm ngặt `Array.isArray(parsed) && parsed.length === 4`, tất cả là non-empty string, và `parsed[2]` thuộc `JiraResourceType`).*

5. `JiraSourceRef`:
```typescript
export interface JiraSourceRef {
  binding: JiraBinding;
  workspaceId: string;
  workspaceVersion: number;
  siteId: string;
  cloudId: string;
  sitePolicyVersion: number;
  projectId?: string;
  projectPolicyVersion?: number;
  resourceType: JiraResourceType;
  providerResourceId: string; // Stable provider ID
  revision: string;
}

export function validateJiraSourceRef(value: unknown): JiraSourceRef;
export function sameJiraSourceRef(a: JiraSourceRef, b: JiraSourceRef): boolean;
```
*Ràng buộc `validateJiraSourceRef`:*
- `source.workspaceId === source.binding.workspaceId`.
- Mọi versions (`workspaceVersion`, `sitePolicyVersion`, `projectPolicyVersion` nếu có) phải là positive safe integer (> 0).
- Nếu `resourceType` là `'project' | 'issue' | 'comment'` thì BẮT BUỘC có cả `projectId` và `projectPolicyVersion`. Nếu `resourceType === 'site'` thì bỏ qua `projectId` và `projectPolicyVersion`.
- `sameJiraSourceRef` so sánh đệ quy danh tính `binding` và mọi trường authorization generation, phân biệt rõ giữa nguồn tương đương và nguồn đã đổi revision/version.

- [x] **Step 1:** Viết test `packages/tool-schemas/tests/myjira-context.test.ts`:
  - Kiểm tra `validateJiraBinding` với đầy đủ 7 trường danh tính.
  - Chứng minh loại bỏ các trường bí mật: `{ ...valid, accessToken: 'leak', refreshToken: 'leak2' }` được làm sạch, không mutate input.
  - Kiểm tra từ chối các versions không hợp lệ (0, -1, 1.5, NaN, Infinity, string, undefined).
  - Kiểm tra `sameJiraBinding` khi sai khác từng trường trong 7 trường.
  - **Canonical JSON Collision Tests:**
    - Test chuỗi chứa dấu phân cách: `['a:b', 'c', 'issue', '1']` và `['a', 'b:c', 'issue', '1']` sinh ra 2 JSON chuỗi khác nhau.
    - Test 2 site cùng có issue `1001` nhưng khác `cloudId` sinh ra 2 compound key khác biệt.
    - Test `parseJiraCompoundKey` từ chối tuple không đủ 4 phần tử, phần tử không phải chuỗi, hoặc `resourceType` không hợp lệ.
  - **Source Ref Validation & Swap Tests:**
    - Kiểm tra `validateJiraSourceRef` hợp lệ cho cả site và issue.
    - Từ chối khi `workspaceId !== binding.workspaceId`.
    - Từ chối khi `resourceType === 'issue'` nhưng thiếu `projectId` hoặc thiếu `projectPolicyVersion`.
    - Tráo đổi `cloudId`, `siteId`, `projectId`, `providerResourceId`, `actor` hoặc `workspace` làm `sameJiraSourceRef` trả về false.
    - Thay đổi `revision` phân biệt với thay đổi version.
  - Kiểm tra `isCrossSiteReference` trả về true khi khác `workspaceId` hoặc khác `cloudId`.
- [x] **Step 2:** Chạy test xác nhận RED (Coordinator đã chạy: exit 1, missing `../src/myjira.js`, 0 assertions, `.codex/jira02/contracts-red.log`):
  ```bash
  npm test -w @wap/tool-schemas -- tests/myjira-context.test.ts
  ```
- [x] **Step 3:** Triển khai `packages/tool-schemas/src/myjira-context.ts`.
- [x] **Step 4:** Chạy lại test xác nhận GREEN:
  ```bash
  npm test -w @wap/tool-schemas -- tests/myjira-context.test.ts
  ```

---

### Task 3: Policy Decisions Gắn Nguồn (Không Slack Artifacts), Authorization Lease & PostgreSQL Lock Hierarchy

**Files:**
- Tạo mới: `packages/tool-schemas/src/myjira-policy.ts`
- Tạo mới: `packages/tool-schemas/tests/myjira-policy.test.ts`

**Trách nhiệm & Kiểu dữ liệu:**
1. Quyết định cho phép đưa nguồn vào model (`decideJiraModelUse`):
```typescript
export interface JiraModelPolicy {
  currentBinding: JiraBinding;
  source: JiraSourceRef;
  workspaceActive: boolean;
  currentWorkspaceVersion: number;
  membershipStatus: 'active' | 'pending' | 'rejected' | 'removed';
  siteActive: boolean;
  currentSitePolicyVersion: number;
  projectAllowed: boolean;
  currentProjectPolicyVersion?: number;
  nativePermission: 'granted' | 'denied' | 'unavailable';
}

export interface JiraModelRequest {
  source: JiraSourceRef;
}

export type JiraModelBlockReason =
  | 'identity_changed'
  | 'source_mismatch'
  | 'workspace_inactive'
  | 'membership_inactive'
  | 'site_disabled'
  | 'project_denied'
  | 'policy_stale'
  | 'native_permission_denied'
  | 'provider_unavailable';

export type JiraModelUseDecision =
  | { allowed: true }
  | { allowed: false; reason: JiraModelBlockReason };

export function decideJiraModelUse(
  policy: JiraModelPolicy,
  request: JiraModelRequest
): JiraModelUseDecision;
```
*Thứ tự ưu tiên kiểm tra:*
1. `!sameJiraBinding(policy.source.binding, request.source.binding)` → `'identity_changed'`
2. `!sameJiraSourceRef(policy.source, request.source)` → `'source_mismatch'`
3. `!policy.workspaceActive` → `'workspace_inactive'`
4. `policy.membershipStatus !== 'active'` → `'membership_inactive'`
5. `!policy.siteActive` → `'site_disabled'`
6. `policy.source.resourceType !== 'site' && !policy.projectAllowed` → `'project_denied'`
7. Kiểm tra stale policy version:
   - `policy.source.workspaceVersion !== policy.currentWorkspaceVersion` → `'policy_stale'`
   - `policy.source.sitePolicyVersion !== policy.currentSitePolicyVersion` → `'policy_stale'`
   - `policy.source.resourceType !== 'site' && policy.source.projectPolicyVersion !== policy.currentProjectPolicyVersion` → `'policy_stale'`
8. `policy.nativePermission === 'denied'` → `'native_permission_denied'`
9. `policy.nativePermission === 'unavailable'` → `'provider_unavailable'`
10. Chỉ khi `policy.nativePermission === 'granted'` mới trả về `{ allowed: true }`.

*(Không có bất kỳ trường nào về `noTraining`, `verified`, hay `retention`).*

2. Hợp đồng Authorization Lease:
```typescript
export interface JiraAuthorizationLease {
  leaseId: string;
  binding: JiraBinding;
  workspaceId: string;
  cloudId: string;
  acquiredAt: string; // ISO-8601
  expiresAt: string;  // ISO-8601
  ttlMs: number;
}

export function validateJiraAuthorizationLease(value: unknown): JiraAuthorizationLease;
```

3. Danh mục Site đã xác minh:
```typescript
export interface JiraVerifiedDirectorySite {
  siteId: string;
  cloudId: string;
  name: string;
  url: string;
  active: boolean;
  policyVersion: number;
}

export function validateVerifiedDirectory(sites: unknown): JiraVerifiedDirectorySite[];
```

4. Chuẩn tắc thứ tự khóa PostgreSQL (Đầy đủ 5 bảng, loại trừ grants):
```typescript
export const JIRA_SQL_LOCK_HIERARCHY = [
  'ati_workspaces',
  'ati_workspace_memberships',
  'jira_accounts',
  'ati_workspace_jira_sites',
  'ati_workspace_jira_projects',
] as const;
```

- [x] **Step 1:** Viết test `packages/tool-schemas/tests/myjira-policy.test.ts`:
  - Happy path: Tất cả điều kiện thỏa mãn, `nativePermission === 'granted'` → `{ allowed: true }`.
  - Bảng test kiểm tra từng lý do từ chối: `workspace_inactive`, `membership_inactive`, `site_disabled`, `project_denied`, `policy_stale`, `native_permission_denied`, `provider_unavailable`.
  - **Cấm mượn quyền giữa các resource (Swap Tests):**
    - Tráo `cloudId`, `siteId`, `projectId`, `providerResourceId`, hoặc `actor` giữa `policy.source` và `request.source` → trả về `source_mismatch`, tuyệt đối không mượn được `nativePermission === 'granted'`.
  - Kiểm tra thứ tự ưu tiên khi cùng lúc có nhiều vi phạm.
  - Kiểm tra validate `JiraAuthorizationLease`.
  - Kiểm tra validate `JiraVerifiedDirectorySite`.
  - Kiểm tra tính bất biến của mảng `JIRA_SQL_LOCK_HIERARCHY` (đúng 5 bảng, không chứa `jira_oauth_grants`).
- [x] **Step 2:** Chạy test xác nhận RED (Coordinator đã chạy: exit 1, missing `../src/myjira.js`, 0 assertions, `.codex/jira02/contracts-red.log`):
  ```bash
  npm test -w @wap/tool-schemas -- tests/myjira-policy.test.ts
  ```
- [x] **Step 3:** Triển khai `packages/tool-schemas/src/myjira-policy.ts`.
- [x] **Step 4:** Chạy lại test xác nhận GREEN:
  ```bash
  npm test -w @wap/tool-schemas -- tests/myjira-policy.test.ts
  ```

---

### Task 4: DTOs Đầy đủ, Protocol Boundaries, Workspace Admin CAS & Error Taxonomy

**Files:**
- Tạo mới: `packages/tool-schemas/src/myjira-dto.ts`
- Tạo mới: `packages/tool-schemas/tests/myjira-dto.test.ts`

**Trách nhiệm & Kiểu dữ liệu:**
1. DTOs OAuth Connection Lifecycle & Protocol Boundaries:
```typescript
export type JiraConnectionState =
  | 'disconnected'
  | 'identity_connected'
  | 'scope_required'
  | 'reconnect_required'
  | 'connected';

export interface JiraOAuthStartRequest {
  mode: 'identity' | 'authorize_sites';
  returnTo?: string; // Validated internal path (e.g. /c/<uuid>)
}
export interface JiraOAuthStartResponse {
  authUrl: string; // May carry protocol state parameter
}

export interface JiraOAuthCallbackRequest {
  code: string;  // Sensitive input
  state: string; // Sensitive input
}
export interface JiraOAuthCallbackResponse {
  connected: boolean;
  connectionState: JiraConnectionState;
  jiraAccountId: string;
  atlassianAccountId: string;
  siteCount: number;
}

export interface JiraConnectionStatusResponse {
  connected: boolean;
  connectionState: JiraConnectionState;
  jiraAccountId: string | null;
  atlassianAccountId: string | null;
  sites: Array<{ cloudId: string; name: string; url: string; lastVerifiedAt?: string }>;
}

export interface JiraSyncSitesResponse {
  syncedCount: number;
  sites: Array<{ cloudId: string; name: string; url: string }>;
}

export interface JiraDisconnectResponse {
  disconnected: boolean;
  revokedAt: string;
}
```

2. DTOs Quản trị Workspace & Membership CAS:
```typescript
export interface CreateWorkspaceRequest {
  name: string;
  slug: string;
  bootstrapAdminUserId: string;
}
export interface CreateWorkspaceResponse {
  workspace: { id: string; name: string; slug: string; version: number };
}

export interface WorkspaceJoinRequest {
  inviteToken: string; // Sensitive input
}
export interface WorkspaceJoinResponse {
  requestId: string;
  workspaceId: string;
  status: 'pending';
}

export interface MemberDecisionRequest {
  expectedVersion: number;
  decision: 'approve' | 'reject' | 'remove';
}
export interface MemberDecisionResponse {
  status: 'active' | 'rejected' | 'removed';
  version: number;
}

export interface CreateInviteRequest {
  expiresInDays?: number;
}
export interface CreateInviteResponse {
  inviteId: string;
  inviteToken: string; // One-time secret returned ONLY on create response
  expiresAt: string;
}

export interface WorkspaceJiraCapabilitiesResponse {
  workspaceId: string;
  sites: Array<{
    siteId: string;
    cloudId: string;
    name: string;
    url: string;
    projects: Array<{ id: string; key: string; name: string }>;
  }>;
}
```

3. Error Taxonomy Chuẩn hóa (`JiraApiError`):
```typescript
export type JiraApiErrorCategory =
  | 'upstream_auth'
  | 'upstream_not_found'
  | 'upstream_rate_limited'
  | 'upstream_unavailable'
  | 'upstream_error'
  | 'native_permission_denied' // Phân biệt rõ với auth error
  | 'reconnect_required'
  | 'membership_required'
  | 'workspace_not_found'      // 404 để giấu sự tồn tại của workspace
  | 'stale_version'
  | 'write_indeterminate';

export interface JiraApiError {
  category: JiraApiErrorCategory;
  status: number;
  message: string;
  retryable: boolean;
  suggestedAction?: 'reconnect' | 'request_membership' | 'refresh_page' | 'retry_later';
}

export function createJiraApiError(
  category: JiraApiErrorCategory,
  message: string
): JiraApiError;
```

- [x] **Step 1:** Viết test `packages/tool-schemas/tests/myjira-dto.test.ts`:
  - Kiểm tra `createJiraApiError`:
    - `native_permission_denied` ánh xạ status 403, retryable false, không có action reconnect.
    - `upstream_auth` ánh xạ status 401, action reconnect.
    - `workspace_not_found` ánh xạ status 404 (giấu workspace).
    - `upstream_rate_limited` ánh xạ status 429, retryable true.
    - `write_indeterminate` luôn có `retryable: false`; không có overrides để đổi category/status/retryability. Message do backend cung cấp phải là câu an toàn, không dùng nguyên response provider.
  - Kiểm tra DTOs: validate các request và response với sensitive inputs hợp lệ (`code`, `state`, `inviteToken`), bảo đảm response thông thường không echo sensitive fields.
- [x] **Step 2:** Chạy test xác nhận RED (Coordinator đã chạy: exit 1, missing `../src/myjira.js`, 0 assertions, `.codex/jira02/contracts-red.log`):
  ```bash
  npm test -w @wap/tool-schemas -- tests/myjira-dto.test.ts
  ```
- [x] **Step 3:** Triển khai `packages/tool-schemas/src/myjira-dto.ts`.
- [x] **Step 4:** Chạy lại test xác nhận GREEN:
  ```bash
  npm test -w @wap/tool-schemas -- tests/myjira-dto.test.ts
  ```

---

### Task 5: Opt-in Service Registry, PlanConnections, tsconfig.contracts.json, Compile Fixture & Regression Tests

**Files:**
- Tạo mới: `packages/tool-schemas/src/registry/myjira.ts`
- Cập nhật: `packages/tool-schemas/src/types.ts`
- Cập nhật: `packages/tool-schemas/src/index.ts`
- Tạo mới: `packages/tool-schemas/tsconfig.contracts.json`
- Tạo mới: `packages/tool-schemas/tests/fixtures/consumer-compile-fixture.ts`
- Tạo mới: `packages/tool-schemas/tests/myjira-regression.test.ts`

**Trách nhiệm & Kiểu dữ liệu:**
1. `packages/tool-schemas/src/registry/myjira.ts`:
```typescript
import type { ServiceDefinition } from '../types.js';
import { MYJIRA_SCOPES } from '../myjira.js';

export const MYJIRA_SERVICE: ServiceDefinition = {
  id: 'myjira',
  name: 'Jira',
  description: 'Tìm project/issue, tạo issue và thêm comment trong các Jira site được kết nối qua OAuth cá nhân và workspace của bạn',
  connection: 'personal',
  scopes: [...MYJIRA_SCOPES],
  scopeKey: 'sites',
  scopeLabel: 'Jira sites của bạn',
  credentialFields: [],
  intentKeywords: [
    'jira',
    'ticket',
    'jira của tôi',
    'jira cá nhân',
    'jira của mình',
    'jira riêng',
    'my jira',
    'my personal jira',
  ],
};
```
2. Khai báo `JiraPlanStepScope`, `JiraPlanConnection` và `validateJiraPlanConnection` trong `packages/tool-schemas/src/myjira-context.ts`. `src/types.ts` chỉ import type `JiraPlanConnection` từ `./myjira-context.js` và thêm thuộc tính `myjira?: JiraPlanConnection` vào `PlanConnections`; không đặt validator runtime trong file types.
```typescript
export interface JiraPlanStepScope {
  siteId: string;
  cloudId: string;
  projectId?: string;
  sitePolicyVersion: number;
  projectPolicyVersion?: number;
}

export interface JiraPlanConnection extends JiraBinding {
  workspaceVersion: number;
  siteSteps: Record<string, JiraPlanStepScope>;
}

export function validateJiraPlanConnection(value: unknown): JiraPlanConnection;

export interface PlanConnections {
  gmail?: { credentialId: string; email: string };
  mycalendar?: { credentialId: string; email: string; allowedCalendars: string[] };
  mysheets?: { credentialId: string; email: string; allowedSpreadsheets: string[] };
  trello?: { credentialId: string; memberId: string; username: string; boardIds: string[] };
  myjira?: JiraPlanConnection;
}
```
*(Lưu ý: Không thêm `siteId?: string` vào `PlanStep`).*

3. Cập nhật `packages/tool-schemas/src/index.ts`:
   - Export tất cả các module mới:
```typescript
export * from './myjira.js';
export * from './myjira-context.js';
export * from './myjira-policy.js';
export * from './myjira-dto.js';
export * from './registry/myjira.js';
```
   - Giữ nguyên `ALL_TOOLS` và `SERVICE_REGISTRY`.

4. Cấu hình Typecheck `packages/tool-schemas/tsconfig.contracts.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true
  },
  "include": [
    "src/**/*",
    "tests/fixtures/consumer-compile-fixture.ts"
  ]
}
```

5. TypeScript Consumer Compile Fixture (`tests/fixtures/consumer-compile-fixture.ts`):
   - Nhập khẩu tất cả types và functions của JIRA-02.
   - Sử dụng kiểm tra kiểu biên dịch thực tế của TypeScript để chứng minh tính khả dụng của contract đối với consumers (Backend JIRA-03–05, Adapter JIRA-06, Planner JIRA-07, Executor JIRA-08).

- [x] **Step 1:** Viết test `packages/tool-schemas/tests/myjira-regression.test.ts`:
  - `expect(ALL_TOOLS).toHaveLength(33)`
  - `expect(SERVICE_REGISTRY).toHaveLength(8)`
  - `expect(ALL_TOOLS.some(t => t.service === 'myjira')).toBe(false)`
  - `expect(SERVICE_REGISTRY.some(s => s.id === 'myjira')).toBe(false)`
  - Khẳng định `jira` service legacy không thay đổi.
  - Khẳng định `MYJIRA_SERVICE` có `connection: 'personal'`.
  - Kiểm tra `validateJiraPlanConnection` làm sạch và xác thực version.
- [x] **Step 2:** Chạy test xác nhận RED (Coordinator đã chạy: exit 1, missing `../src/myjira.js`, 0 assertions, `.codex/jira02/contracts-red.log`):
  ```bash
  npm test -w @wap/tool-schemas -- tests/myjira-regression.test.ts
  ```
- [x] **Step 3:** Triển khai `src/registry/myjira.ts`, cập nhật `src/types.ts`, `src/index.ts`, tạo `tsconfig.contracts.json` và `tests/fixtures/consumer-compile-fixture.ts`.
- [x] **Step 4:** Chạy lại test và typecheck xác nhận GREEN:
  ```bash
  npm test -w @wap/tool-schemas -- tests/myjira-regression.test.ts
  npx tsc --noEmit -p packages/tool-schemas/tsconfig.contracts.json
  ```

---

## 4. Xác minh tổng thể và Tiêu chuẩn Bằng chứng (Validation & Evidence)

Sau khi hoàn thành 5 task, Integration implementer phải chạy toàn bộ các lệnh kiểm tra sau và ghi lại output thực tế:

1. **Bộ test toàn bộ tool-schemas:**
   ```bash
   npm test -w @wap/tool-schemas
   ```
   *(Kỳ vọng: Toàn bộ test files đều PASS, exit code 0).*

2. **Kiểm tra invariants hệ thống:**
   ```bash
   npm test -w @wap/tool-schemas -- tests/registry-invariants.test.ts
   ```
   *(Kỳ vọng: PASS, không có trùng lặp hoặc vi phạm từ khóa cấm).*

3. **Typecheck Trình biên dịch Contracts Fixture (Bắt buộc):**
   ```bash
   npx tsc --noEmit -p packages/tool-schemas/tsconfig.contracts.json
   ```
   *(Kỳ vọng: Biên dịch sạch, exit code 0).*

4. **Typecheck toàn repository:**
   ```bash
   npm run typecheck:v3
   ```
   *(Kỳ vọng: TypeScript biên dịch sạch toàn bộ monorepo, exit code 0).*

5. **Kiểm tra Mutation Tests trên mã nguồn:**
   - Đổi thử điều kiện trong `validateJiraBinding` để không strip `accessToken` → test context phải đỏ.
   - Thêm `myjira` vào `ALL_TOOLS` trong `src/index.ts` → test regression phải đỏ.
   - Sửa `formatJiraCompoundKey` quay lại dạng nối chuỗi colon `join(':')` → test compound key với ID chứa colon phải đỏ.
   - Bỏ kiểm tra `identityVersion > 0` trong `validateJiraBinding` → test context phải đỏ.
   - Tráo `cloudId` trong `policy.source` mà không đổi `request.source` → test policy phải đỏ (`source_mismatch`).

---

## 5. Lộ trình phụ thuộc và Điều phối Đa Agent sau JIRA-02

Khi PR của JIRA-02 được mở:
1. **Quá trình Review Độc lập (Mandatory Gate):**
   - **Backend Reviewer:** Kiểm tra `JiraBinding` (7 trường), `validateJiraPlanConnection`, synchronization protocol, lock hierarchy (5 bảng), DTOs và error categories.
   - **AI Reviewer:** Kiểm tra 5 tool schemas, canonical JSON compound keys, `decideJiraModelUse`, source ref swap tests, và `PlanConnections`.
   - **Frontend Reviewer:** Kiểm tra DTOs kết nối, protocol state/code boundaries, join request, member decision, capabilities.
2. **Merge Gate:** Chỉ merge PR từ `codex/jira-02-contracts` vào `main` khi cả 3 reviewer approve và GitHub Actions CI v3 xanh trên đúng head.
3. **Phân phối công việc tiếp theo:**
   - **JIRA-03 (Backend):** Khởi tạo migrations database và Repositories theo đúng `JIRA_SQL_LOCK_HIERARCHY`.
   - **JIRA-06 (Integration):** Xây dựng HTTP Tool Adapters cho 5 công cụ `myjira.*` dựa trên schemas của JIRA-02.
   - **JIRA-09A (Frontend):** Xây dựng các UI fixtures và mockup màn hình workspace/connection dựa trên DTOs của JIRA-02.
   *(Lưu ý: JIRA-03, JIRA-04, JIRA-05, JIRA-08 đều tác động `apps/chat-api` nên phải chạy tuần tự, không được chạy song song).*

## 6. Hiệu chỉnh sau review Backend, AI và Frontend (01/11/2026)

Các bổ sung dưới đây hoàn thiện interface theo spec 4–10; áp dụng cùng các ràng buộc trước đó. Không mở thêm runtime hoặc tool.

- Policy bắt buộc có `currentBinding: JiraBinding` do server cung cấp, độc lập với source refs lịch sử. So sánh đủ bảy trường, gồm membership/identity generation; không chỉ so hai nguồn cùng cũ. Sai current binding trả `identity_changed`; malformed evidence trả `invalid_evidence`. Chỉ native permission own-property bằng `granted` mới cho phép; trạng thái thiếu/unknown/unavailable trả `provider_unavailable` sau các gate còn lại. Không thêm consent gate cho model provider.
- Source project/issue/comment dùng `providerResourceId` và `projectId` là chuỗi thập phân dương chuẩn (`^[1-9][0-9]*$`). Project self-reference có hai ID bằng nhau; site reference có provider ID bằng cloudId. Codec khóa vẫn là JSON tuple bốn chuỗi, không dùng display key và không áp thêm luật số cho codec tổng quát. Predicate cross-site từ chối dữ liệu thiếu, sai hoặc kế thừa.
- `list_sites` trả thêm `id` alias của siteId để tương thích compaction. `observedFields`: site giữ id/siteId/cloudId/name/url; project giữ id/key/name/siteId; issue giữ id/key/title/url/status/siteId. Grounding theo khóa tổng hợp thực tế và chống dedup xuyên site vẫn thuộc JIRA-07.
- Scope project trong plan phải có cả projectId lẫn projectPolicyVersion hoặc không có cả hai. Dựng own step keys an toàn, kể cả `__proto__`. Lease validator kiểm workspace bằng binding và `expiresAt - acquiredAt === ttlMs`; đây là shape contract, không phải lease PostgreSQL đang có hiệu lực. Không thêm sai số thời gian tùy ý.
- Hoàn thiện DTO danh sách workspace, thành viên và đủ bốn membership states/CAS version; quản trị site/project với expectedPolicyVersion; danh sách/thu hồi invite không chứa secret. Workspace version khác membership version; site/project policy generation khác cả hai. Link site chỉ nhận cloudId; Backend lấy name/url từ provider và kiểm grant/native ADMINISTER. Project selection là input chưa tin cậy; Backend kiểm stable numeric IDs, từ chối wildcard và CAS.
- Disconnect response có identityVersion; callback/status có displayName tùy chọn. Error factory chỉ chiếu safe metadata, không tự lọc nội dung message; Backend phải cung cấp message đã làm sạch. Unknown/inherited category bị từ chối, write_indeterminate không retry. Protocol authUrl/callback/join và create-invite secret một lần là ngoại lệ tường minh; DTO types không thay thế serializer hay runtime HTTP validation.
- Thêm `packages/tool-schemas/package.json` vào phạm vi: test script chạy `tsc --noEmit -p tsconfig.contracts.json && vitest run`, để CI thực thi compiler fixture. Không sửa root package, lockfile, dependencies hoặc workflow. DTO positive/negative probes dùng compiler; không dùng handmade object assertions làm bằng chứng serializer.

Bằng chứng RED phải phân biệt thiếu module/export với assertion hành vi thất bại. Fixture `__proto__` phải có own key trước khi gọi validator; factory tạo policy/source độc lập giữa các test. Sau GREEN, dùng mutation hành vi và phục hồi byte gốc để chứng minh guard, rồi review lại đúng diff.
