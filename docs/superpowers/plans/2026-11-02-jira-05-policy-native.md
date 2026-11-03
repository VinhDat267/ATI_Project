# JIRA-05 · Kế hoạch Triển khai Chính sách Quyền Native, Capability Directory, Revocation Lease & Source Revalidation

**Ngày lập:** 02/11/2026 (Asia/Saigon).
**Trạng thái:** Sẵn sàng thi công (Plan Revised after Independent Review; P1/P2 Resolved).
**Nhiệm vụ:** Hiện thực hóa cơ chế quản lý chính sách, kiểm tra quyền native Atlassian thực tế (cả admin và user), quản lý authorization lease bền vững với transaction ngắn hạn kiểm tra snapshot version và commit ngay, xử lý đánh dấu thu hồi khi policy thay đổi, cung cấp capability directory qua giao điểm quyền, revalidate nguồn gốc dữ liệu Jira cho lịch sử hội thoại, và xây dựng component bộ đệm SSE stream độc lập. Giữ nguyên ranh giới sẵn sàng 503 cho thao tác tạo hội thoại Jira ở môi trường production cho tới JIRA-08.
**Quyền lực chuẩn tắc:**
- [Đặc tả Jira cá nhân và workspace ATI](../../superpowers/specs/2026-10-30-jira-personal-workspaces-design.md) (Mục 6, 7.1, 7.2, 8, 9, 11, 12).
- [Bổ sung thiết kế Jira dùng workspace tổ chức chung](../../superpowers/specs/2026-11-02-jira-shared-workspace-amendment.md).
- [Báo cáo Phản biện Độc lập JIRA-05](../../../.superpowers/sdd/2026-11-02-jira-05-policy/plan-review-findings.md).
- [JIRA-01 Provider Facts](../../ai-evidence/JIRA-01-PROVIDER-FACTS.md).
- Hợp đồng kiểu dữ liệu đã MERGE: `packages/tool-schemas/src/myjira-policy.ts`, `myjira-context.ts`, `myjira-dto.ts` (Commit `6c53436`, PR #232).
- Nền tảng JIRA-03: [JIRA-03 Workspaces Task Card](../handoff/tasks/JIRA-03-workspaces.md) (PR #240).
- Nền tảng JIRA-04: [JIRA-04 OAuth Token Task Card](../handoff/tasks/JIRA-04-oauth-token.md).

---

## 1. Tổng quan Kiến trúc & Ranh giới Kỹ thuật

JIRA-05 chịu trách nhiệm xây dựng tầng kiểm soát quyền hạn (Authorization & Policy Enforcement Layer) cho tích hợp Jira cá nhân trong `apps/chat-api`.

```
               ┌────────────────────────────────────────────────────────┐
               │         API Caller / FrontEnd (apps/chat-web)          │
               └───────────┬────────────────────────────────┬───────────┘
                           │                                │
        GET /api/.../jira-capabilities        GET /api/conversations/:id
                           │                                │
                           ▼                                ▼
               ┌───────────────────────┐        ┌───────────────────────┐
               │  Capability Directory │        │   History Sanitizer   │
               │  (Intersection Calc)  │        │   (Source Masking)    │
               └───────────┬───────────┘        └───────────┬───────────┘
                           │                                │
                           ▼                                ▼
               ┌────────────────────────────────────────────────────────┐
               │           JiraPolicyService (Source Revalidation)      │
               │     decideJiraModelUse (10 Block Reasons Evaluation)   │
               └───────────┬────────────────────────────────┬───────────┘
                           │                                │
                           ▼                                ▼
               ┌───────────────────────┐        ┌───────────────────────┐
               │   JiraLeaseManager    │        │  JiraNativeVerifier   │
               │ (Short-Tx Version Snap│        │  (Atlassian REST API  │
               │  Commit Immediately)  │        │  /mypermissions HTTP) │
               └───────────┬───────────┘        └───────────┬───────────┘
                           │                                │
                           ▼                                ▼
               ┌───────────────────────┐        ┌───────────────────────┐
               │  PostgreSQL Database  │        │   JiraTokenManager    │
               │ (0022 Leases Schema)  │        │   (JIRA-04 Transport) │
               └───────────────────────┘        └───────────────────────┘
```

### 1.1. Các nguyên tắc bất biến (Invariants) & Hiệu chỉnh Phản biện

1. **Scope OAuth không thay thế Quyền Native:** Token OAuth dù có scope `read:jira-work` và `write:jira-work` vẫn không chứng minh user có quyền trên project hay issue cụ thể. Mọi quyền truy cập phải được xác minh thông qua `GET /rest/api/3/mypermissions` trên đúng `cloudId` Atlassian cho cả quyền admin (`ADMINISTER`) và quyền user (`BROWSE_PROJECTS`, `CREATE_ISSUES`, `ADD_COMMENTS`).
2. **Tách rời Hoàn toàn Transaction Database khỏi Thời gian sống (TTL) của Lease:**
   - **Thực tế kỹ thuật của PostgreSQL:** Khóa dòng (`FOR SHARE`, `FOR UPDATE`) chỉ tồn tại trong vòng đời của một transaction SQL mở, được quản lý bởi lock manager (`lmgr`) của PostgreSQL. Row lock **không hề biết** và **không thể tự hết hạn** theo timestamp của cột (`expires_at`, `ttl_ms`).
   - **Tuyệt đối không giữ mở transaction hay khóa dòng qua cuộc gọi mạng:** Việc giữ transaction DB trong lúc gọi HTTP sang Atlassian là phản mẫu (anti-pattern) nghiêm trọng gây cạn kiệt pool kết nối và treo toàn bộ hệ thống nếu mạng trễ.
   - **Cơ chế Lease trong JIRA-05:**
     - `acquireLease`: Mở transaction ngắn hạn, kiểm tra các phiên bản version snapshot bằng câu lệnh `FOR SHARE` theo đúng thứ tự lock hierarchy, ghi nhận bản ghi lease vào bảng `jira_authorization_leases` với `expires_at = clock_timestamp() + ($15::int * interval '1 millisecond')`, và **commit ngay lập tức**.
     - `markRevoked`: Khi xảy ra thao tác thu hồi quyền (archive workspace, remove member, deactivate site, deselect project), transaction thu hồi cập nhật policy version (`policy_version + 1`) và cập nhật trạng thái các lease active liên quan trong bảng thành `revoked`.
     - `revalidateLease`: Kiểm tra trạng thái lease bằng truy vấn `SELECT status, expires_at FROM jira_authorization_leases WHERE lease_id = $1` với điều kiện `status = 'active' AND expires_at > clock_timestamp()`.
   - **Phân định Ranh giới JIRA-05 vs JIRA-08:** Bản ghi lease ngắn hạn đã commit trong JIRA-05 **không** tự động chặn thao tác thu hồi bằng row lock vật lý và **không** đảm bảo tính nguyên tử cho request outbound. Trách nhiệm thiết lập guard tuyến tính cuối cùng (linearizable outbound execution guard) trước khi phát lệnh ghi sang Jira thuộc về Executor ở **JIRA-08**. JIRA-05 chỉ triển khai bản ghi lease kiểm tra version trong transaction ngắn, cơ chế reaper dọn dẹp lease hết hạn, và đánh dấu thu hồi khi có biến động quyền.
3. **Cây khóa Tuần tự PostgreSQL & Triệt tiêu Deadlock với Token Rotation:**
   - Thứ tự khóa đồng bộ đầy đủ (tích hợp giữa JIRA-03 Shared-Workspace Amendment và Spec v3):
     1. `workspaces`
     2. `workspace_members`
     3. `ati_workspaces`
     4. `ati_workspace_memberships`
     5. `users`
     6. `jira_accounts`
     7. `ati_workspace_jira_sites`
     8. `ati_workspace_jira_projects`
   - **Sửa câu lệnh khóa trong `jira-token-manager.ts`:** Truy vấn xoay vòng token hiện tại dùng `SELECT ... FROM jira_oauth_grants g JOIN jira_accounts a ON a.id = g.account_id WHERE a.user_id = $1 AND g.id = $2 FOR UPDATE`. Do thiếu mệnh đề `OF g`, PostgreSQL khóa cả `jira_accounts`. JIRA-05 sửa thành `FOR UPDATE OF g` để token rotation chỉ khóa dòng bảng `jira_oauth_grants`, loại trừ hoàn toàn nguy cơ tranh chấp deadlock với các thao tác lease.
   - **Thao tác Disconnect Độc lập Cấp Tài khoản:** Thao tác ngắt kết nối (`disconnect` trong `jira-oauth-repo.ts`) là hành động ở cấp user account, độc lập với workspace (một user có thể thuộc 0, 1 hoặc nhiều workspace). Thao tác này chỉ khóa và cập nhật `jira_accounts` và `jira_oauth_grants`, không lấy khóa trên các bảng workspace, ngăn ngừa triệt để nguy cơ deadlock AB/BA. Khi disconnect xảy ra, việc tăng `identity_version` sẽ tự động khiến mọi lease và cache cũ bị coi là vô hiệu hóa (fail-closed).
4. **Phân tách Cache Quyền Native (Cache Isolation):**
   Bộ nhớ đệm quyền native được đánh khóa bằng bộ 6 trường composite:
   `cacheKey = ${userId}:${accountId}:${identityVersion}:${workspaceId}:${cloudId}:${projectId ?? 'global'}`
   Bất kỳ biến động nào về `identityVersion` hoặc hết hạn TTL (mặc định 60 giây) sẽ tự động làm mất hiệu lực cache cũ.
5. **Fail-Closed khi Revalidate Nguồn gốc & Tách bạch Route Lịch sử:**
   - Hàm `decideJiraModelUse` kiểm tra đủ 10 lý do chặn chuẩn. Khi Atlassian bị lỗi mạng/timeout/5xx, kết quả là `provider_unavailable`, dữ liệu Jira phụ thuộc bắt buộc phải bị che mờ (mask/redact).
   - Tuyệt đối không đưa cấu trúc plan vào message sanitizer: Route `GET /api/conversations/:id/plans/active` được bảo vệ qua `assertConversationAccessWithFallback` (404 Hidden Pattern) và trả về plan bị vô hiệu hóa nếu ngữ cảnh Jira không còn hợp lệ, không dùng chung logic xử lý chuỗi của message masking.
6. **Thành phần SSE Stream Buffer Độc lập (Không sửa `stream-routes.ts`):**
   - File `apps/chat-api/src/routes/stream-routes.ts` là consumer subscription endpoint (`GET /api/conversations/:id/stream`), chỉ đăng ký client và phát lại missed events. Không có logic sinh content delta hay bắt sự kiện `step_complete` tại đây.
   - JIRA-05 xây dựng `JiraStreamBuffer` là một component độc lập, có unit test kiểm tra khả năng buffer content delta và hủy bỏ khi lease bị revoked. Việc tích hợp buffer vào pipeline producer (`ChatService` / executor event publisher) được chuyển tiếp sang **JIRA-08** khi có engine thực thi.
7. **Bảo tồn Ranh giới Sẵn sàng 503 & Cờ Tắt:**
   - Endpoint tạo hội thoại `POST /api/conversations` với cờ `jiraContext: true` tiếp tục trả về HTTP 503 `WORKSPACE_CONVERSATIONS_UNAVAILABLE` trong môi trường server production. Chỉ mở qua cờ test nội bộ `enableWorkspaceConversations: true` trong fixture.
   - Mặc định `MYJIRA_ENABLED=off`. Không làm thay đổi 33 tools và 8 services hiện hành.

---

## 2. Danh mục File & Ranh giới Sở hữu

Toàn bộ công việc thuộc sở hữu của **Backend Engineer** (`apps/chat-api`, `db/v3`). Tuyệt đối không sửa đổi các package ngoài phạm vi (`packages/tool-schemas`, `packages/tool-adapters`, `packages/planner`, `packages/executor`, `apps/chat-web`).

### 2.1. File mã nguồn triển khai

| File | Hành động | Mục đích |
|---|---|---|
| `db/v3/0022_jira_authorization_leases.sql` | Tạo mới | Additive migration: Bảng `jira_authorization_leases`, check constraint `expires_at > acquired_at`, compound partial index `(workspace_id, cloud_id, expires_at) WHERE status = 'active'` |
| `apps/chat-api/src/services/jira/jira-native-verifier.ts` | Tạo mới | Client kiểm tra quyền native Atlassian: mở rộng interface verifier cho cả admin và user permissions (`BROWSE_PROJECTS`, `CREATE_ISSUES`, `ADD_COMMENTS`), quản lý cache in-memory TTL phân vùng khóa composite 6 trường |
| `apps/chat-api/src/services/jira/jira-lease-manager.ts` | Tạo mới | Trình quản lý authorization lease: transaction ngắn hạn kiểm tra version snapshot và commit ngay, đánh dấu `markRevoked`, dọn dẹp lease hết hạn `reapExpiredLeases` |
| `apps/chat-api/src/services/jira/jira-token-manager.ts` | Cập nhật | Sửa câu lệnh khóa sang `FOR UPDATE OF g` để triệt tiêu nguy cơ deadlock với `jira_accounts` |
| `apps/chat-api/src/services/jira/jira-policy-service.ts` | Tạo mới | Dịch vụ revalidation nguồn gốc dữ liệu Jira: tích hợp `decideJiraModelUse`, revalidate `JiraSourceRef`, kiểm tra 10 block reasons |
| `apps/chat-api/src/services/jira/jira-history-sanitizer.ts` | Tạo mới | Lọc và làm sạch lịch sử tin nhắn: phát hiện `sourceRefs`, che mờ nội dung phụ thuộc Jira khi mất quyền |
| `apps/chat-api/src/sse/jira-stream-guard.ts` | Tạo mới | Thành phần bộ đệm SSE stream độc lập: buffer content delta Jira, flush khi lease active, hủy bỏ buffer khi quyền bị thu hồi (unit-testable component) |
| `apps/chat-api/src/db/repositories/workspace/workspace-site-project-repo.ts` | Cập nhật | Mở rộng options verifier, hiện thực hóa `getCapabilities` (xóa bỏ mã 503 tạm thời), tích hợp `JiraNativeVerifier` thật |
| `apps/chat-api/src/routes/conversation-routes.ts` | Cập nhật | Tích hợp `jira-history-sanitizer` cho các endpoint đọc tin nhắn (`GET /:id`, `GET /:id/messages/latest`); bảo vệ `GET /:id/plans/active` bằng context access |
| `apps/chat-api/src/app.ts` | Cập nhật | Wire `JiraNativeVerifier`, `JiraLeaseManager`, `JiraPolicyService` và truyền vào các routes liên quan |
| `apps/chat-api/src/server.ts` | Cập nhật | Khởi tạo các dịch vụ chính sách Jira và inject vào `createApp` |

### 2.2. File kiểm thử (TDD Test Files)

| File | Hành động | Mục đích |
|---|---|---|
| `apps/chat-api/tests/helpers/jira-native-test-fixture.ts` | Tạo mới | Helper dựng loopback HTTP mock server chuẩn Atlassian REST API `/rest/api/3/mypermissions` và `/rest/api/3/project/search` |
| `apps/chat-api/tests/db/jira-policy-lease-migration.test.ts` | Tạo mới | Test PostgreSQL thật: idempotence migration 0001–0022, check constraints, compound partial index |
| `apps/chat-api/tests/services/jira-native-verifier.test.ts` | Tạo mới | Test HTTP loopback: kiểm tra quyền admin và user, timeout AbortSignal, giới hạn 64KB, cache composite hit/miss/eviction |
| `apps/chat-api/tests/services/jira-lease-manager.test.ts` | Tạo mới | Test PostgreSQL thật: transaction ngắn hạn cấp lease, đánh dấu thu hồi khi policy thay đổi, reaper dọn dẹp lease hết hạn, và kiểm tra `FOR UPDATE OF g` không khóa lây `jira_accounts` |
| `apps/chat-api/tests/routes/jira-capabilities.test.ts` | Tạo mới | Test HTTP API route: giao điểm grant sites và workspace sites, project allowlist, 404 hidden pattern |
| `apps/chat-api/tests/services/jira-source-revalidation.test.ts` | Tạo mới | Test revalidation nguồn gốc: kiểm chứng đủ 10 lý do chặn của `decideJiraModelUse`, che mờ nội dung message cũ |
| `apps/chat-api/tests/sse/jira-stream-guard.test.ts` | Tạo mới | Test unit component `JiraStreamBuffer`: buffer content delta, flush khi lease active, hủy bỏ khi lease bị revoked |

---

## 3. Đặc tả Kỹ thuật Chi tiết

### 3.1. Additive Migration (`db/v3/0022_jira_authorization_leases.sql`)

```sql
-- 0022_jira_authorization_leases.sql: Durable tracking for Jira authorization leases.
-- Every migration runs repeatedly on runner start, each statement must be idempotent.

CREATE TABLE IF NOT EXISTS jira_authorization_leases (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id                TEXT UNIQUE NOT NULL,
  workspace_id            UUID NOT NULL REFERENCES ati_workspaces(id) ON DELETE CASCADE,
  cloud_id                TEXT NOT NULL,
  ati_user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jira_account_id         UUID NOT NULL REFERENCES jira_accounts(id) ON DELETE CASCADE,
  atlassian_account_id    TEXT NOT NULL,
  grant_id                UUID NOT NULL REFERENCES jira_oauth_grants(id) ON DELETE CASCADE,
  membership_version      INTEGER NOT NULL CHECK (membership_version > 0),
  identity_version        INTEGER NOT NULL CHECK (identity_version > 0),
  workspace_version       INTEGER NOT NULL CHECK (workspace_version > 0),
  site_policy_version     INTEGER NOT NULL CHECK (site_policy_version > 0),
  project_id              TEXT CHECK (project_id IS NULL OR project_id ~ '^[1-9][0-9]*$'),
  project_policy_version  INTEGER CHECK (project_policy_version IS NULL OR project_policy_version > 0),
  ttl_ms                  INTEGER NOT NULL CHECK (ttl_ms > 0 AND ttl_ms <= 60000),
  acquired_at             TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at              TIMESTAMPTZ NOT NULL,
  released_at             TIMESTAMPTZ,
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'expired', 'revoked')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT chk_jira_leases_expiry CHECK (expires_at > acquired_at)
);

-- Compound partial index for active lease lookups that filters out expired rows efficiently
CREATE INDEX IF NOT EXISTS idx_jira_leases_active
  ON jira_authorization_leases (workspace_id, cloud_id, expires_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_jira_leases_user
  ON jira_authorization_leases (ati_user_id, status);
```

### 3.2. Native Verifier Client & Interface Mở rộng (`jira-native-verifier.ts`)

1. **Mở rộng Interface Verifier trong `WorkspaceSiteProjectRepo`:**
   ```typescript
   export interface NativeUserPermissionsEvidence {
     actorId: string;
     workspaceId: string;
     cloudId: string;
     projectId?: string;
   }

   export interface NativeUserPermissionsResult {
     canBrowse: boolean;
     canCreateIssue: boolean;
     canAddComment: boolean;
   }

   export interface ExtendedNativeVerifier extends NativeAdminVerifier {
     verifyUserPermissions(evidence: NativeUserPermissionsEvidence): Promise<NativeUserPermissionsResult>;
   }
   ```
2. **Cài đặt `JiraNativeVerifier`:**
   - Nhận `JiraTokenManager` để tự động xoay vòng bearer token an toàn.
   - Nhận `mode: 'live' | 'fixture'`, `fixtureBaseUrl?: string`.
   - `verifyAdminister`: Gọi `GET /rest/api/3/mypermissions?permissions=ADMINISTER` và `GET /rest/api/3/project/search`.
   - `verifyUserPermissions`: Gọi `GET /rest/api/3/mypermissions?permissions=BROWSE_PROJECTS,CREATE_ISSUES,ADD_COMMENTS&projectId={projectId}`.
   - Phòng vệ: Chặn HTTP redirect, giới hạn body 64 KB, không echo secret, chuyển tiếp `AbortSignal`.
   - Cache in-memory LRU với khóa composite 6 trường: `${userId}:${accountId}:${identityVersion}:${workspaceId}:${cloudId}:${projectId ?? 'global'}`.

### 3.3. Trình Quản lý Authorization Lease (`jira-lease-manager.ts`)

1. **Transaction Ngắn hạn Cấp Lease (`acquireLease`):**
   ```typescript
   async acquireLease(params: AcquireLeaseParams): Promise<JiraAuthorizationLease> {
     // 1. Lấy token trước ngoài phạm vi transaction
     const accessToken = await this.tokenManager.getAccessToken(params.userId, { signal: params.signal });

     // 2. Mở short-lived SQL transaction kiểm tra version snapshot
     const client = await this.pool.connect();
     try {
       await client.query('BEGIN');
       // Khóa tuần tự FOR SHARE theo lock hierarchy:
       // workspaces -> workspace_members -> ati_workspaces -> ati_workspace_memberships
       // -> users -> jira_accounts -> ati_workspace_jira_sites (-> ati_workspace_jira_projects)
       const wsRes = await client.query('SELECT version, status FROM ati_workspaces WHERE id = $1 FOR SHARE', [params.workspaceId]);
       // ... validate versions, status active ...

       const leaseId = randomUUID();
       const ttlMs = params.ttlMs ?? 15000;
       await client.query(
         `INSERT INTO jira_authorization_leases (
            lease_id, workspace_id, cloud_id, ati_user_id, jira_account_id,
            atlassian_account_id, grant_id, membership_version, identity_version,
            workspace_version, site_policy_version, project_id, project_policy_version,
            ttl_ms, expires_at, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, clock_timestamp() + ($15::int * interval '1 millisecond'), 'active')`,
         [...]
       );

       await client.query('COMMIT'); // COMMIT NGAY LẬP TỨC
       return validateJiraAuthorizationLease(...);
     } catch (err) {
       await client.query('ROLLBACK').catch(() => {});
       throw err;
     } finally {
       client.release();
     }
   }
   ```
2. **Đánh dấu Thu hồi (`markRevoked`):**
   ```typescript
   async markRevoked(filter: { workspaceId: string; cloudId?: string; userId?: string }): Promise<number> {
     const res = await this.pool.query(
       `UPDATE jira_authorization_leases
        SET status = 'revoked', released_at = clock_timestamp()
        WHERE workspace_id = $1
          AND ($2::text IS NULL OR cloud_id = $2)
          AND ($3::uuid IS NULL OR ati_user_id = $3)
          AND status = 'active'`,
       [filter.workspaceId, filter.cloudId ?? null, filter.userId ?? null]
     );
     return res.rowCount ?? 0;
   }
   ```
3. **Dọn dẹp Lease Quá hạn (`reapExpiredLeases`):**
   ```typescript
   async reapExpiredLeases(): Promise<number> {
     const res = await this.pool.query(
       `UPDATE jira_authorization_leases
        SET status = 'expired', released_at = clock_timestamp()
        WHERE status = 'active' AND expires_at <= clock_timestamp()`
     );
     return res.rowCount ?? 0;
   }
   ```

### 3.4. Sửa Đổi Khóa trong `jira-token-manager.ts`

Trong `apps/chat-api/src/services/jira/jira-token-manager.ts` (khoảng dòng 273):
```typescript
// SỬA: Thêm "OF g" để PostgreSQL chỉ khóa dòng của bảng jira_oauth_grants
`SELECT
   a.id as account_id,
   ...
 FROM jira_oauth_grants g
 JOIN jira_accounts a ON a.id = g.account_id
 WHERE a.user_id = $1 AND g.id = $2
 FOR UPDATE OF g`
```

### 3.5. Capability Directory (`GET /api/jira-workspaces/:id/jira-capabilities`)

1. **Kiểm tra Tư cách:** 2 lớp membership active (`workspace_members` và `ati_workspace_memberships`). Người ngoài nhận 404 `WORKSPACE_NOT_FOUND`.
2. **Tính Giao điểm:**
   - Active linked sites: `ati_workspace_jira_sites WHERE workspace_id = $1 AND active = true`.
   - Granted sites: `jira_grant_sites` thông qua active grant của user.
   - Giao điểm = các site có `cloud_id` xuất hiện ở cả hai.
3. **Lấy Quyền User trên Project:**
   - Với từng site trong giao điểm: lấy các project `selected = true` trong `ati_workspace_jira_projects`.
   - Gọi `verifier.verifyUserPermissions` để lấy quyền `canBrowse`, `canCreateIssue`, `canAddComment`.
   - Trả về `WorkspaceJiraCapabilitiesResponse` chuẩn schema.

### 3.6. Source Revalidation & History Sanitization (`jira-policy-service.ts`, `jira-history-sanitizer.ts`)

1. **Revalidation:** Gọi `decideJiraModelUse(policy, request)` từ `@wap/tool-schemas`.
   - Nạp trạng thái DB: workspace version, membership status, identity version, site version, project version, native permission.
   - Nếu bất kỳ kiểm tra nào thất bại: ghi audit và trả về block reason tương ứng.
2. **Làm sạch Lịch sử Tin nhắn:**
   - Quét tin nhắn có `metadata.sourceRefs`. Nếu nguồn không còn hợp lệ, che mờ nội dung:
     `"[Nội dung Jira đã bị ẩn do quyền truy cập bị thay đổi hoặc thu hồi: ${reason}]"`
   - Xóa bỏ metadata ticket nhạy cảm.
3. **Route `plans/active`:** Kiểm tra quyền ngữ cảnh hội thoại qua `assertConversationAccessWithFallback`, trả về 404 Hidden Pattern khi mất quyền, không truyền plan vào message sanitizer.

### 3.7. Thành phần Bộ đệm SSE Stream (`jira-stream-guard.ts`)

- Xây dựng class `JiraStreamBuffer`:
  - `pushProgressEvent(event)`: chuyển tiếp ngay.
  - `pushContentChunk(chunk)`: lưu vào mảng buffer tạm thời.
  - `commitAndFlush(leaseId)`: kiểm tra `leaseManager.revalidateLease(leaseId)`. Nếu hợp lệ, trả về toàn bộ chunks đã buffer. Nếu không, xóa sạch buffer và ném lỗi thu hồi quyền.
- **Không can thiệp vào `stream-routes.ts`** ở JIRA-05. Việc tích hợp vào pipeline producer (`ChatService` / executor) thuộc về JIRA-08.

---

## 4. Kế hoạch Thi công TDD Chi tiết (RED -> GREEN -> REFACTOR)

### Giai đoạn 1: Additive Migration & Database Schema

#### Bước 1.1: Viết bài test Schema PostgreSQL (RED)
- **Tập tin:** `apps/chat-api/tests/db/jira-policy-lease-migration.test.ts`
- **Mục tiêu:** Kiểm tra sự tồn tại và tính hợp lệ của bảng `jira_authorization_leases` trên schema PostgreSQL cô lập thật.
- **Nội dung kiểm tra:**
  1. Chạy lặp lại toàn bộ chuỗi migration 0001–0022 trong cùng transaction, bảo đảm tính idempotent.
  2. Kiểm tra ràng buộc check `expires_at > acquired_at`.
  3. Kiểm tra chỉ mục compound partial index `idx_jira_leases_active` trên `(workspace_id, cloud_id, expires_at) WHERE status = 'active'`.
- **Trạng thái RED:** Test thất bại do migration `0022` chưa tồn tại.

#### Bước 1.2: Tạo Migration `0022_jira_authorization_leases.sql` (GREEN)
- **Tập tin:** `db/v3/0022_jira_authorization_leases.sql`
- **Thực thi:** Khai báo bảng `jira_authorization_leases` và chỉ mục theo đặc tả mục 3.1.
- **Chạy kiểm tra:**
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/db/jira-policy-lease-migration.test.ts
  ```
- **Kỳ vọng:** PASS (100% assertions xanh).

---

### Giai đoạn 2: Native Verifier Client & Loopback HTTP Fixture

#### Bước 2.1: Xây dựng Test Fixture & Test Client Quyền Native (RED)
- **Tập tin:** `apps/chat-api/tests/helpers/jira-native-test-fixture.ts`, `apps/chat-api/tests/services/jira-native-verifier.test.ts`
- **Nội dung kiểm tra:**
  1. *Administer Check:* Fixture giả lập Atlassian `/rest/api/3/mypermissions` trả về `ADMINISTER: { havePermission: true }` và `/rest/api/3/project/search` trả về 2 projects. Verifier trả về `status: 'granted'` kèm metadata projects.
  2. *Administer Denied:* Fixture trả về `havePermission: false`. Verifier trả về `status: 'denied'`.
  3. *User Permissions Check:* Kiểm tra `BROWSE_PROJECTS`, `CREATE_ISSUES`, `ADD_COMMENTS` theo `projectId`.
  4. *Network Defense:* Redirect bị từ chối; body vượt quá 64 KB bị từ chối; timeout kích hoạt hủy bỏ qua `AbortSignal`.
  5. *Cache Composite Partitioning:* Cùng query nhận cache hit; đổi `identityVersion` hoặc gọi `clearCache` kích hoạt fetch mới; không dùng chung cache giữa các user/account khác nhau.
- **Trạng thái RED:** Test thất bại do `JiraNativeVerifier` chưa được cài đặt.

#### Bước 2.2: Hiện thực hóa `JiraNativeVerifier` (GREEN)
- **Tập tin:** `apps/chat-api/src/services/jira/jira-native-verifier.ts`
- **Thực thi:**
  - Triển khai interface mở rộng `ExtendedNativeVerifier` cho cả admin và user.
  - Sử dụng `JiraTokenManager` để lấy token an toàn.
  - Tích hợp cache in-memory TTL với khóa composite 6 trường.
- **Chạy kiểm tra:**
  ```bash
  RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/services/jira-native-verifier.test.ts
  ```
- **Kỳ vọng:** PASS.

---

### Giai đoạn 3: PostgreSQL Lease Manager, Revocation Marking & Token Manager Update

#### Bước 3.1: Viết test Lease Manager & Deadlock Freedom trên PostgreSQL thật (RED)
- **Tập tin:** `apps/chat-api/tests/services/jira-lease-manager.test.ts`
- **Nội dung kiểm tra:**
  1. *Lease Acquisition & Immediate Commit:* Gọi `acquireLease`, xác minh transaction ngắn đã commit ngay và bản ghi `active` tồn tại trong DB với `expires_at` chính xác.
  2. *Revocation Marking:* Tạo active lease; gọi `markRevoked` (mô phỏng thao tác site deactivate hoặc member remove); xác minh lease chuyển thành `revoked`. Lời gọi `revalidateLease` trả về `revoked: true`.
  3. *Reaper Test:* Tạo lease có `expires_at` trong quá khứ; gọi `reapExpiredLeases`; xác minh trạng thái chuyển sang `expired`.
  4. *Token Manager `FOR UPDATE OF g` & Deadlock Freedom:*
     - Khởi tạo 2 worker connection.
     - Worker 1 gọi `tokenManager` thực hiện refresh token (khóa `jira_oauth_grants` với `FOR UPDATE OF g`).
     - Worker 2 đồng thời xin lease trên cùng tài khoản (đọc `jira_accounts` với `FOR SHARE`).
     - Chứng minh: Worker 2 không bị chặn bởi Worker 1 (không có khóa trên `jira_accounts`), không xảy ra deadlock.
- **Trạng thái RED:** Test thất bại do `JiraLeaseManager` chưa được tạo và `jira-token-manager.ts` chưa cập nhật `FOR UPDATE OF g`.

#### Bước 3.2: Cập nhật `jira-token-manager.ts` và Tạo `JiraLeaseManager` (GREEN)
- **Tập tin:** `apps/chat-api/src/services/jira/jira-token-manager.ts`, `apps/chat-api/src/services/jira/jira-lease-manager.ts`
- **Thực thi:**
  - Sửa câu lệnh khóa trong `jira-token-manager.ts` sang `FOR UPDATE OF g`.
  - Cài đặt `JiraLeaseManager` với `acquireLease`, `markRevoked`, `revalidateLease`, `reapExpiredLeases`.
- **Chạy kiểm tra:**
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/services/jira-lease-manager.test.ts
  ```
- **Kỳ vọng:** PASS.

---

### Giai đoạn 4: Capability Directory Service & Route Endpoint

#### Bước 4.1: Viết test HTTP API `GET /api/jira-workspaces/:id/jira-capabilities` (RED)
- **Tập tin:** `apps/chat-api/tests/routes/jira-capabilities.test.ts`
- **Nội dung kiểm tra:**
  1. *Intersection Success:* Workspace liên kết 2 sites (S1, S2); User grant có 2 sites (S2, S3). Endpoint trả về duy nhất site S2 (giao điểm) kèm các project đã cấu hình và permissions tương ứng.
  2. *Empty Intersection:* Không có site chung, trả về `{ sites: [] }` với HTTP 200.
  3. *Unconnected User:* User chưa kết nối Jira danh tính, trả về trạng thái yêu cầu kết nối phù hợp, không lỗi 500.
  4. *404 Hidden Pattern:* Người ngoài, user bị reject/remove, hoặc workspace archived đều nhận HTTP 404 `WORKSPACE_NOT_FOUND`.
- **Trạng thái RED:** Test thất bại do route đang trả về HTTP 503 `CAPABILITIES_UNAVAILABLE`.

#### Bước 4.2: Cập nhật `WorkspaceSiteProjectRepo.getCapabilities` (GREEN)
- **Tập tin:** `apps/chat-api/src/db/repositories/workspace/workspace-site-project-repo.ts`, `apps/chat-api/src/routes/workspace-routes.ts`
- **Thực thi:** Mở rộng options, thay thế mã ném 503 bằng logic tính toán giao điểm và gọi `JiraNativeVerifier`.
- **Chạy kiểm tra:**
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/routes/jira-capabilities.test.ts
  ```
- **Kỳ vọng:** PASS.

---

### Giai đoạn 5: Source Revalidation & Lọc Lịch sử Hội thoại

#### Bước 5.1: Viết test Source Revalidation & History Masking (RED)
- **Tập tin:** `apps/chat-api/tests/services/jira-source-revalidation.test.ts`
- **Nội dung kiểm tra:**
  1. *10 Block Reasons Matrix:* Tạo fixture kiểm chứng đủ 10 lý do chặn của `decideJiraModelUse`:
     - `identity_changed`: accountId hoặc identityVersion đổi.
     - `source_mismatch`: binding không khớp.
     - `workspace_inactive`: workspace bị archive.
     - `membership_inactive`: member bị remove hoặc pending.
     - `site_disabled`: site bị admin deactivate.
     - `project_denied`: project bị uncheck khỏi danh sách cho phép.
     - `policy_stale`: version của site hoặc project bị tăng.
     - `native_permission_denied`: verifier trả về denied.
     - `provider_unavailable`: Atlassian lỗi mạng/timeout.
     - `invalid_evidence`: dữ liệu đầu vào thiếu hoặc sai kiểu.
  2. *History Masking:* Hội thoại có tin nhắn chứa `sourceRefs` Jira. Khi user bị remove khỏi workspace, gọi `GET /api/conversations/:id` kiểm tra: nội dung tin nhắn được che mờ bằng thông báo masked; metadata nhạy cảm bị loại bỏ; không rò rỉ dữ liệu ticket thô.
  3. *Decoupled Plans/Active Check:* Xác minh `GET /api/conversations/:id/plans/active` trả về 404 Hidden Pattern khi mất quyền hội thoại, không truyền plan vào message sanitizer.
- **Trạng thái RED:** Test thất bại do service chưa tồn tại.

#### Bước 5.2: Hiện thực hóa `JiraPolicyService` và `JiraHistorySanitizer` (GREEN)
- **Tập tin:** `apps/chat-api/src/services/jira/jira-policy-service.ts`, `apps/chat-api/src/services/jira/jira-history-sanitizer.ts`, `apps/chat-api/src/routes/conversation-routes.ts`
- **Thực thi:**
  - Đóng gói hàm revalidation gọi `decideJiraModelUse`.
  - Tích hợp sanitizer vào `conversation-routes.ts`.
- **Chạy kiểm tra:**
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/services/jira-source-revalidation.test.ts
  ```
- **Kỳ vọng:** PASS.

---

### Giai đoạn 6: Thành phần SSE Stream Buffer Độc lập

#### Bước 6.1: Viết test Component `JiraStreamBuffer` (RED)
- **Tập tin:** `apps/chat-api/tests/sse/jira-stream-guard.test.ts`
- **Nội dung kiểm tra:**
  1. *Progress Event Pass-Through:* Sự kiện điều khiển/tiến trình không mang payload Jira được emit trực tiếp.
  2. *Content Delta Buffering:* Content delta chứa dữ liệu Jira được đưa vào buffer tạm thời.
  3. *Commit and Flush on Valid Lease:* Khi bước kết thúc và lease còn active, buffer được flush đầy đủ.
  4. *Buffer Discard on Revocation:* Khi lease bị revoke/hết hạn, buffer bị xóa sạch ngay lập tức và ném lỗi thu hồi quyền, không rò rỉ dữ liệu ra ngoài.
- **Trạng thái RED:** Test thất bại do component chưa được tạo.

#### Bước 6.2: Hiện thực hóa `JiraStreamBuffer` (GREEN)
- **Tập tin:** `apps/chat-api/src/sse/jira-stream-guard.ts`
- **Thực thi:** Xây dựng class `JiraStreamBuffer` hoàn toàn độc lập, sẵn sàng để JIRA-08 tích hợp vào producer pipeline.
- **Chạy kiểm tra:**
  ```bash
  RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/sse/jira-stream-guard.test.ts
  ```
- **Kỳ vọng:** PASS.

---

### Giai đoạn 7: Server Wiring, Typecheck & Regression Verification

#### Bước 7.1: Server & App Wiring
- **Tập tin:** `apps/chat-api/src/app.ts`, `apps/chat-api/src/server.ts`
- **Thực thi:**
  - Khởi tạo `JiraNativeVerifier`, `JiraLeaseManager`, `JiraPolicyService`.
  - Bổ sung vào `AppOptions` và truyền tới các route handlers.
  - Bảo đảm cờ `enableWorkspaceConversations` mặc định là `false` trong server production để giữ ranh giới sẵn sàng 503.

#### Bước 7.2: Chạy Toàn bộ Kiểm thử Hệ thống (Full Check)
- **Lệnh kiểm tra:**
  ```bash
  npm run typecheck:v3
  DATABASE_URL="$TEST_DATABASE_URL" npm run check
  ```
- **Kỳ vọng:**
  - Toàn bộ suite v3 và evaluation tests đạt PASS (không có test bị skip hoặc lỗi).
  - Không có cảnh báo typecheck hoặc lint.

---

## 5. Chiến dịch Kiểm thử Đột biến (Mutation Testing Plan)

Dự kiến triển khai tối thiểu 12 đột biến có chủ đích để chứng minh các bài test có khả năng bắt lỗi (catch rate 100%):

| Mã | Vị trí đột biến | Hành vi cố ý thay đổi | Kết quả kỳ vọng |
|---|---|---|---|
| MUT-01 | `jira-lease-manager.ts` | Bỏ kiểm tra `membership.status === 'active'` khi cấp lease | Test phát hiện lỗi cấp lease cho removed member |
| MUT-02 | `jira-lease-manager.ts` | Thay đổi thứ tự khóa: đọc `ati_workspace_jira_sites` trước `ati_workspaces` | Test deadlock / ordering bắt được vi phạm hierarchy |
| MUT-03 | `jira-token-manager.ts` | Xóa `OF g` khỏi câu lệnh `FOR UPDATE` | Test concurrent token refresh + lease acquisition bắt được tranh chấp khóa |
| MUT-04 | `jira-native-verifier.ts` | Luôn trả về `granted` mà không kiểm tra `havePermission` | Test negative native permissions thất bại |
| MUT-05 | `jira-native-verifier.ts` | Bỏ trường `identityVersion` khỏi cache key | Test account reconnect dùng nhầm cache cũ thất bại |
| MUT-06 | `workspace-site-project-repo.ts` | Không tính giao điểm, trả về toàn bộ workspace sites | Test capabilities intersection rò rỉ ungranted sites |
| MUT-07 | `workspace-site-project-repo.ts` | Bỏ 404 Hidden pattern khi membership bị removed | Test trả về 200/403 thay vì 404 bí mật |
| MUT-08 | `jira-policy-service.ts` | Bỏ qua kiểm tra `policy_stale` khi site version tăng | Test stale policy detection thất bại |
| MUT-09 | `jira-policy-service.ts` | Bỏ qua kiểm tra `native_permission_denied` | Test native permission block thất bại |
| MUT-10 | `jira-history-sanitizer.ts` | Không che mờ tin nhắn khi revalidation thất bại | Test history masking phát hiện rò rỉ dữ liệu cũ |
| MUT-11 | `jira-stream-guard.ts` | Flush delta ngay lập tức mà không buffer | Test revocation cutoff phát hiện dữ liệu rò rỉ |
| MUT-12 | `jira-stream-guard.ts` | Bỏ kiểm tra `revalidateLease` trước khi flush | Test phát tán dữ liệu sau khi lease bị hủy thất bại |

---

## 6. Tiêu chuẩn Nghiệm thu & Lệnh Chạy cho Parent Codex

Parent Codex điều phối Git commits và chạy các lệnh kiểm tra:

```bash
# 1. Chạy unit & integration tests cho JIRA-05
DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- \
  tests/db/jira-policy-lease-migration.test.ts \
  tests/services/jira-native-verifier.test.ts \
  tests/services/jira-lease-manager.test.ts \
  tests/routes/jira-capabilities.test.ts \
  tests/services/jira-source-revalidation.test.ts \
  tests/sse/jira-stream-guard.test.ts

# 2. Chạy Typecheck toàn bộ dự án
npm run typecheck:v3

# 3. Chạy Full Check toàn bộ repository (3300+ tests)
DATABASE_URL="$TEST_DATABASE_URL" npm run check
```
