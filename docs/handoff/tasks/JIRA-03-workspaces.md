# JIRA-03 · Cơ sở dữ liệu và API Quản trị Workspace cá nhân Jira

**Trạng thái:** Đã lập kế hoạch chi tiết (Ready for Root review and staged TDD implementation); chưa có code sản phẩm/test.  
**Nhiệm vụ:** Xây dựng additive migration `0015_jira_workspaces.sql` và toàn bộ backend DB/API repository mô đun hóa (`WorkspaceRepo` façade), route handlers quản trị workspace, bootstrap admin nguyên tử, hệ thống invite bảo mật với token 256-bit lưu duy nhất băm SHA-256, gia nhập có điều kiện kết nối danh tính Atlassian server-side, SQL CAS duyệt/từ chối/loại bỏ thành viên chống race condition và write-skew, cô lập mọi đường dẫn hội thoại theo workspace bất biến, và chính sách fail-closed cho liên kết Jira site/project trước khi nối native verifier tại JIRA-05.  
**Quyền lực chuẩn tắc:**  
- Thiết kế: [Đặc tả Jira cá nhân và workspace ATI](../../superpowers/specs/2026-10-30-jira-personal-workspaces-design.md) (Mục 4–9 và 11).  
- Hợp đồng kiểu dữ liệu đã MERGE: `packages/tool-schemas/src/myjira-context.ts`, `myjira-policy.ts`, `myjira-dto.ts` (Commit `6c53436`, PR #232).  
- Kế hoạch triển khai chi tiết: [JIRA-03 Workspaces Implementation Plan](../../superpowers/plans/2026-11-01-jira-03-workspaces.md).  
**Vai trò phụ trách:** Backend Engineer (`db/v3`, `apps/chat-api`).  
**Phụ thuộc:** JIRA-02 (Contracts). JIRA-03 là nền móng dữ liệu cho JIRA-04 (OAuth token transport), JIRA-05 (Policy & native check), JIRA-08 (Executor), JIRA-09 (UI).  
**Nhánh thi công:** `longnguyen005/jira-03-workspaces` (base `origin/main` tại commit `2afa48816b9ef725de1c34658ffcf071b995acd5`).  

---

## 1. Mục tiêu và phạm vi

### 1.1. Mục tiêu cốt lõi
Cung cấp hạ tầng lưu trữ PostgreSQL và hệ thống API hoàn chỉnh cho Workspace ATI phục vụ tích hợp Jira cá nhân. Đảm bảo tính cô lập tuyệt đối giữa các tổ chức/workspace, bảo vệ bí mật invite token, ngăn chặn write skew và race condition bằng SQL CAS thật và transaction-level locks, bảo vệ toàn diện mọi đường dẫn hội thoại chat-api, đồng thời giữ vững nguyên tắc Fail-Closed đối với cấu hình Jira site/project khi chưa có native verifier.

### 1.2. Phạm vi bao gồm (Scope In):
1. **Additive Migration (`db/v3/0015_jira_workspaces.sql`):**
   - Bảng `ati_workspaces`: UUID PK, `slug` unique, `name`, `status` (`active`, `archived`), `version`, `created_by`.
   - Bảng `ati_workspace_memberships`: PK kép `(workspace_id, user_id)`, `role` (`admin`, `member`), `status` (`pending`, `active`, `rejected`, `removed`), CAS `version`, `requested_at`, `decided_at`, `decided_by`.
   - Bảng `ati_workspace_invites`: UUID PK, `workspace_id`, `token_hash` unique (SHA-256), `inviter_user_id`, `expires_at` (mặc định 7 ngày), `revoked_at`.
   - Bảng `jira_accounts`: UUID PK, `user_id`, `atlassian_account_id`, `display_name`, `status` (`connected`, `disconnected`), `identity_version`.
     - Ràng buộc partial unique kép cho trạng thái `connected`:
       - `CREATE UNIQUE INDEX jira_accounts_user_active_idx ON jira_accounts (user_id) WHERE status = 'connected';`
       - `CREATE UNIQUE INDEX jira_accounts_atlassian_active_idx ON jira_accounts (atlassian_account_id) WHERE status = 'connected';`
       - Bảo đảm: Một người ATI chỉ có tối đa 1 Atlassian identity active, VÀ một Atlassian identity active không thể bị gán cho 2 người ATI khác nhau (spec 5.3).
   - Bảng `jira_oauth_grants`: UUID PK, `account_id`, `app_client_id`, `grant_kind`, `encrypted_access_token`, `encrypted_refresh_token`, `scopes`, `token_version`, `expires_at`, `refresh_state`.
   - Bảng `jira_grant_sites`: UUID PK, `grant_id`, `cloud_id`, `site_url`, `site_name`, `product_type`, `last_verified_at`, unique `(grant_id, cloud_id)`. Phối hợp metadata scope thực tế cho JIRA-04; không tự suy diễn trạng thái danh tính từ scope.
   - Bảng `ati_workspace_jira_sites`: UUID PK, `workspace_id`, `cloud_id`, `site_name`, `site_url`, `active` (mặc định `false`), `policy_version`, `linked_by`, `verified_admin_by`, `admin_verified_at`, unique `(workspace_id, cloud_id)`, unique bổ sung `(workspace_id, id, cloud_id)`.
   - Bảng `ati_workspace_jira_projects`: UUID PK, `workspace_id`, `site_id`, `cloud_id`, `numeric_project_id`, `project_key`, `project_name`, `selected` (mặc định `false`), `policy_version INTEGER NOT NULL DEFAULT 1 CHECK (policy_version > 0)` riêng biệt (theo yêu cầu của source refs JIRA-02).
     - Composite Foreign Key ràng buộc toàn vẹn bộ 3:
       `CONSTRAINT fk_workspace_site_cloud FOREIGN KEY (workspace_id, site_id, cloud_id) REFERENCES ati_workspace_jira_sites (workspace_id, id, cloud_id) ON DELETE CASCADE`.
     - Ràng buộc duy nhất: `CONSTRAINT ati_workspace_jira_projects_ws_cloud_proj_uq UNIQUE (workspace_id, cloud_id, numeric_project_id)`.
   - Bảng `jira_authorization_audit`: UUID PK, `actor_id`, `workspace_id`, `site_id`, `action`, `decision`, `version`, `details` JSONB (chỉ lưu allowlisted metadata, không lưu bí mật hay untrusted JSON tùy ý).
   - Bổ sung `conversations.workspace_id`: Foreign key trỏ tới `ati_workspaces(id)` ON DELETE RESTRICT, chỉ số `(workspace_id, user_id)`. Trigger bảo vệ tính bất biến: ngăn cấm `NULL -> workspace`, `workspace -> NULL`, và `workspace A -> workspace B`. Bảo lưu trọn vẹn hội thoại legacy (`workspace_id IS NULL`).
   - Đảm bảo tính Idempotent: chạy lại script migration nhiều lần không gây lỗi.

2. **Backend Repository Mô đun hóa (`WorkspaceRepo` Façade):**
   - Tách thành các mô đun chuyên biệt dưới `apps/chat-api/src/db/repositories/workspace/`:
     - `workspace-core-repo.ts`: Tạo workspace và bootstrap admin trong một transaction; archive và recovery với local contracts.
     - `workspace-membership-repo.ts`: CAS quyết định thành viên; chống write-skew bằng khóa cấp workspace; chống self-approve, self-role-elevate; bảo vệ active admin cuối cùng; khi hai admin cùng lúc gửi yêu cầu remove lẫn nhau, người thua sau khi chờ khóa thấy actor đã bị remove nhận 404/403 access denied (chính xác 1 winner, >= 1 active admin còn lại); test riêng cho authorized sole active admin tự xóa chứng minh guard 409 LASTADMIN.
     - `workspace-invite-repo.ts`: Token 256-bit ngẫu nhiên bảo mật, chỉ lưu SHA-256 hash, plaintext trả về 1 lần duy nhất; join yêu cầu tài khoản Atlassian server-side; join lại sau reject/remove chỉ chấp nhận invite sinh SAU thời điểm quyết định (dùng `clock_timestamp()`); duplicate join của active member giữ nguyên DB active và HTTP trả về stable 409 `already_member` (không trả pending giả mạo); duplicate join của pending member trả về idempotent 200/201 pending.
     - `workspace-site-project-repo.ts`: Quản lý site/project; kiểm tra quyền ADMINISTER bằng `NativeAdminVerifier` được cấu hình ở cấp repo/service (không nhận từ request caller); Fail-Closed: không verifier => từ chối link, activate, project config; cho phép deactivation an toàn; capabilities trả về 503 cho tới khi có JIRA-05.
     - `workspace-audit-repo.ts`: Ghi nhận nhật ký kiểm toán với metadata cho phép.
     - `index.ts`: Façade tổng hợp giao diện repository.

3. **Bảo vệ Toàn diện Mọi Đường dẫn Hội thoại (`conversation-access.ts`):**
   - Xây dựng mô đun kiểm soát truy cập tập trung `assertConversationOwnerAndActiveMember`.
   - Yêu cầu đồng thời: `conversations.user_id === caller.id` VÀ nếu `workspace_id IS NOT NULL` thì caller phải là thành viên `active` trong workspace `active`.
   - Bảo vệ toàn bộ các điểm truy cập hội thoại:
     - `apps/chat-api/src/routes/conversation-routes.ts`: `POST /`, `GET /` (`listConversationPage` lọc bỏ hội thoại workspace mà caller không còn active, ngay cả khi không truyền filter), `GET /:id`, `PATCH /:id`, `GET /:id/plans/active`, `GET /:id/messages/latest`, `POST /:id/messages`.
     - `apps/chat-api/src/routes/stream-routes.ts`: `GET /api/conversations/:id/stream` (SSE stream kiểm tra quyền trước khi flush SSE headers).
     - `apps/chat-api/src/routes/execution-routes.ts`: `GET /api/conversations/:convId/executions/latest`, `POST /api/plans/:id/approve`, `POST /api/plans/:id/reject`, `POST /executions/:planId/continue`.
     - `apps/chat-api/src/routes/schedule-routes.ts`: Các endpoint xác nhận/từ chối đề xuất lịch chạm tới `convId`.
   - Ranh giới sẵn sàng cho tạo hội thoại:
     - `POST /api/conversations` với `workspaceId` trong môi trường production mặc định trả về HTTP 503 `WORKSPACE_CONVERSATIONS_UNAVAILABLE` (vì việc bảo vệ in-flight model/persist/SSE thuộc về JIRA-05/08).
     - Tầng repository `createConversation` hỗ trợ tạo transactional đầy đủ và được kiểm thử; kiểm thử HTTP tích hợp cho tạo conversation có workspace sử dụng tùy chọn internal server `enableWorkspaceConversations: true` (mặc định false ở production, không tạo dev bypass).
     - Tạo hội thoại legacy NULL (`POST /api/conversations` không có workspaceId) giữ nguyên hoạt động bình thường.
   - Unauthenticated trả về 401; Authenticated nhưng không có quyền hoặc không tồn tại trả về 404 (Hidden Privacy Pattern).

4. **HTTP API Routes:**
   - `POST /api/admin/workspaces`: System admin only (`users.role === 'admin'`).
   - `POST /api/admin/workspaces/:id/archive`, `POST /api/admin/workspaces/:id/recover-admin`: System admin recovery với body định nghĩa tường minh (`{ expectedVersion: number, ... }`).
   - `GET /api/workspaces`: Danh sách workspace cá nhân (chỉ trả về workspace caller có quan hệ).
   - `POST /api/workspace-join-requests`: Gửi yêu cầu gia nhập qua invite token; trả về 409 `already_member` nếu caller đã là active member; trả về 201/200 pending nếu caller đang pending.
   - `GET /api/workspaces/:id/members`: Danh sách thành viên (Workspace Admin).
   - `POST /api/workspaces/:id/members/:userId/decision`: CAS quyết định thành viên.
   - `POST /api/workspaces/:id/invites`, `GET /api/workspaces/:id/invites`, `DELETE /api/workspaces/:id/invites/:inviteId`: Quản trị invite (secret-free listing).
   - `GET /api/workspaces/:id/jira-sites`, `POST /api/workspaces/:id/jira-sites`, `PATCH /api/workspaces/:id/jira-sites/:siteId`: Quản trị site (Fail-Closed).
   - `GET /api/workspaces/:id/jira-sites/:siteId/projects`, `PUT /api/workspaces/:id/jira-sites/:siteId/projects`: Quản trị project (numeric IDs).
   - `GET /api/workspaces/:id/jira-capabilities`: Trả về 503 cho tới JIRA-05.

### 1.3. Ngoài phạm vi (Scope Out):
- JIRA-04: Luồng trao đổi OAuth code/token, mã hóa token AES-256-GCM runtime, HTTP exchange với Atlassian OAuth endpoint.
- JIRA-05: Native permission verification HTTP calls (`/mypermissions`), LLM source revalidation, SSE output buffer filtering.
- JIRA-06: Tool Adapters HTTP client (`myjira.*`).
- JIRA-07: AI Planner routing và multi-site grounding prompts.
- JIRA-08: Full Executor guards, execution lease locking trong quá trình chạy plan, gắn kết plan connection thật.
- JIRA-09: Giao diện người dùng Web (React/Zustand UI).
- Không sửa đổi `packages/tool-schemas` (đã đóng ở JIRA-02).
- Không kích hoạt cờ `MYJIRA_ENABLED`, giữ nguyên 33 tools và 8 services mặc định.

---

## 2. Danh mục File phụ trách

| File | Hành động | Mục đích |
|---|---|---|
| `db/v3/0015_jira_workspaces.sql` | Tạo mới | Additive migration: 9 bảng mới, composite FKs, partial unique indexes cho accounts active, policy_version riêng cho project, trigger bất biến conversation |
| `apps/chat-api/src/db/repositories/workspace/workspace-core-repo.ts` | Tạo mới | Tạo workspace, bootstrap admin, archive, recovery, listing workspace cá nhân |
| `apps/chat-api/src/db/repositories/workspace/workspace-membership-repo.ts` | Tạo mới | CAS quyết định thành viên, khóa cấp workspace, bảo vệ last admin, chống self-approve |
| `apps/chat-api/src/db/repositories/workspace/workspace-invite-repo.ts` | Tạo mới | Sinh invite 256-bit (hash-only), join bằng connected account server-side, clock_timestamp monotonic rejoin rule |
| `apps/chat-api/src/db/repositories/workspace/workspace-site-project-repo.ts` | Tạo mới | Site/project config, composite verification, fail-closed policy mutations, capabilities 503 |
| `apps/chat-api/src/db/repositories/workspace/workspace-audit-repo.ts` | Tạo mới | Ghi nhận nhật ký kiểm toán với allowlisted metadata |
| `apps/chat-api/src/db/repositories/workspace/index.ts` | Tạo mới | Façade `WorkspaceRepo` đóng gói các mô đun con |
| `apps/chat-api/src/auth/conversation-access.ts` | Tạo mới | Module kiểm soát quyền truy cập hội thoại chung cho API/Stream/Execution/Schedule |
| `apps/chat-api/src/db/repositories/conversation-repo.ts` | Cập nhật | Gắn `workspace_id` bất biến trong transaction; lọc `listConversationPage` an toàn |
| `apps/chat-api/src/db/repositories/index.ts` | Cập nhật | Re-export `WorkspaceRepo` và các types liên quan |
| `apps/chat-api/src/routes/workspace-routes.ts` | Tạo mới | Express router: `/api/workspaces`, `/api/admin/workspaces`, `/api/workspace-join-requests` |
| `apps/chat-api/src/routes/conversation-routes.ts` | Cập nhật | Áp dụng guard `conversation-access` cho mọi route hội thoại |
| `apps/chat-api/src/routes/stream-routes.ts` | Cập nhật | Áp dụng guard `conversation-access` cho SSE stream |
| `apps/chat-api/src/routes/execution-routes.ts` | Cập nhật | Áp dụng guard `conversation-access` cho execution reload và plan approval |
| `apps/chat-api/src/routes/schedule-routes.ts` | Cập nhật | Áp dụng guard `conversation-access` cho các thao tác schedule theo convId |
| `apps/chat-api/src/app.ts` | Cập nhật | Wire `workspaceRepo` và đăng ký routes workspace |
| `apps/chat-api/src/server.ts` | Cập nhật | Khởi tạo `WorkspaceRepo` với PostgreSQL pool và truyền vào `createApp` |
| `apps/chat-api/tests/helpers/jira-test-db.ts` | Tạo mới | Test helper cho JIRA-03: cho phép cổng 56534 hoặc CI loopback 5432 (từ chối 55533), schema cô lập |
| `apps/chat-api/tests/db/jira-workspace-migration.test.ts` | Tạo mới | Kiểm thử PostgreSQL thật: idempotence migration, composite FKs, partial unique indexes, trigger bất biến |
| `apps/chat-api/tests/db/jira-workspace-repo.test.ts` | Tạo mới | Kiểm thử PostgreSQL thật: 2 admin cạnh tranh CAS có barrier, bảo vệ last admin, join clock_timestamp |
| `apps/chat-api/tests/routes/jira-workspaces.test.ts` | Tạo mới | Kiểm thử API routes: system-admin create, private listing, invite secret 1 lần, site config fail-closed, 404 hidden |
| `apps/chat-api/tests/routes/jira-workspace-conversations.test.ts` | Tạo mới | Kiểm thử cô lập hội thoại: tạo atomic, stream, execution, schedule guards, bảo vệ legacy NULL |

---

## 3. Tiêu chí nghiệm thu (Checklist)

- [ ] **Migration Idempotence & Constraints:** `0015_jira_workspaces.sql` chạy an toàn nhiều lần liên tiếp không lỗi; mọi bảng có đầy đủ check constraints (version > 0, regex numeric_project_id, enum status), composite FK `(workspace_id, site_id, cloud_id)`, và unique indexes.
- [ ] **Dual Active Account Protection:** Ràng buộc partial unique trên `jira_accounts` ngăn chặn việc gán cùng 1 Atlassian account active cho 2 người dùng ATI khác nhau.
- [ ] **Independent Project Policy Version:** Mỗi project row có `policy_version` dương riêng biệt, quản lý độc lập với site version.
- [ ] **Conversation Workspace Immutability:** Cột `workspace_id` trong `conversations` không thể bị sửa đổi hoặc gắn thêm sau khi tạo; không thể chuyển đổi giữa NULL và workspace (chứng minh qua trigger / repo test).
- [ ] **Comprehensive Conversation Access Guard:** Mọi route chạm tới conversation (`conversation-routes`, `stream-routes`, `execution-routes`, `schedule-routes`) đều yêu cầu caller là owner và active member của active workspace; người dùng ngoài workspace nhận 404.
- [ ] **Safe Conversation Listing:** `listConversationPage` không bao giờ trả về hội thoại thuộc workspace mà người gọi không còn là active member, ngay cả khi không truyền filter.
- [ ] **Conversation Creation Availability Boundary:** Public HTTP `POST /api/conversations` kèm `workspaceId` trả về 503 mặc định; chỉ mở khi inject internal option trong test fixture foundation; legacy NULL tạo bình thường.
- [ ] **System Admin Atomicity:** Endpoint `POST /api/admin/workspaces` chỉ cho phép System Admin; tạo workspace và bootstrap admin trong một transaction nguyên tử duy nhất; ghi audit allowlisted.
- [ ] **Private Workspace Listing:** `GET /api/workspaces` chỉ hiển thị các workspace mà người gọi có bản ghi membership (`active` hoặc `pending`), giấu hoàn toàn các workspace khác.
- [ ] **Invite Secret Security:** Invite token sinh 256-bit ngẫu nhiên; cơ sở dữ liệu CHỈ lưu SHA-256 hash; token plaintext chỉ trả về một lần duy nhất lúc tạo; không bao giờ echo trong list, get hay log.
- [ ] **Server-Side Connected Account Requirement:** Endpoint join từ chối ngay lập tức nếu caller không có bản ghi `jira_accounts` kết nối thật ở server; tuyệt đối không tin client accountId.
- [ ] **Monotonic Invite Rejoin & Active Join Invariant:** Người dùng bị `rejected` hoặc `removed` chỉ có thể xin gia nhập lại bằng invite mới sinh SAU thời điểm bị từ chối/loại bỏ theo `clock_timestamp()`; invite cũ bị từ chối; duplicate join của active member giữ nguyên DB active và trả về 409 `already_member`; duplicate join của pending member trả về idempotent pending.
- [ ] **Real Concurrency & CAS Integrity:** 2 client PostgreSQL thật cùng gửi request CAS quyết định thành viên: đúng 1 request thành công (committed, version tăng), request còn lại nhận 409 stale version và abort sạch.
- [ ] **Mutual Remove & Last Admin Protection:** Khi 2 admin cùng remove nhau, đúng 1 winner và >= 1 active admin còn lại; người thua nhận 404/403 access denied; test riêng cho sole active admin tự xóa nhận 409 LAST_ACTIVE_ADMIN; cấm self-approve và self-role-elevate.
- [ ] **Hidden Resource Privacy (404 Pattern):** Workspace ID hoặc Conversation ID không thuộc quyền sở hữu/thành viên của caller phải trả về 404 thay vì 403 để che giấu sự tồn tại.
- [ ] **Fail-Closed Site & Project Configuration:** Mọi mutation cấu hình policy (link site, activate site, configure projects) đều yêu cầu quyền native ADMINISTER; production không có verifier mặc định fail-closed; deactivation cho phép không cần provider; capabilities trả về 503.
- [ ] **Clean Separation & Flag-Off Invariant:** Không chứa code runtime Jira OAuth token flow (thuộc JIRA-04) hay Jira HTTP execution (thuộc JIRA-06); giữ nguyên 33 tools và 8 services.

---

## 4. Lệnh kiểm tra dành cho Parent Codex

> **Quy chuẩn môi trường kiểm thử:**  
> Toàn bộ kiểm thử chạy trên instance PostgreSQL chuyên dụng cổng `56534` (hoặc CI loopback `5432` trên database `ati_v3`). Không load `.env`. Parent Codex sở hữu Git commits và chạy các lệnh kiểm tra thật.

### 4.1. Chạy test Migration PostgreSQL:
```bash
DATABASE_URL=postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56534/ati_v3 RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/db/jira-workspace-migration.test.ts
```

### 4.2. Chạy test Repository & CAS Concurrency (2 Clients + Barrier):
```bash
DATABASE_URL=postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56534/ati_v3 RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/db/jira-workspace-repo.test.ts
```

### 4.3. Chạy test API Routes & Conversation Privacy:
```bash
DATABASE_URL=postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56534/ati_v3 RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/routes/jira-workspaces.test.ts tests/routes/jira-workspace-conversations.test.ts
```

### 4.4. Kiểm tra Typecheck và Full Check toàn hệ thống:
```bash
npm run typecheck:v3
DATABASE_URL=postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56534/ati_v3 npm run check
```

---

## 5. Kết quả (Parent Codex điền sau khi hoàn thành các pha TDD)

*(Mục này sẽ được hoàn thiện sau khi Parent Codex duyệt kế hoạch và thực thi tuần tự các pha TDD).*
- **Nhánh/base:** `longnguyen005/jira-03-workspaces` từ `origin/main` `2afa48816b9ef725de1c34658ffcf071b995acd5`.
- **Source commit:** [Sẽ cập nhật sau khi commit source].
- **Bằng chứng RED:** [Sẽ ghi nhận logs test fail trước khi viết code].
- **Bằng chứng GREEN:** [Sẽ ghi nhận logs test pass, exit code 0].
- **Mutations & Review:** [Sẽ ghi nhận các mutation bị bắt và kết quả review].
