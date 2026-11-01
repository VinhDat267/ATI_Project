# JIRA-03 · Cơ sở dữ liệu và API Quản trị Workspace cá nhân Jira (Tích hợp Workspace Tổ chức Chung)

**Trạng thái:** Đã triển khai và kiểm chứng cục bộ trên nền PR #237; chờ review toàn nhánh, CI của PR và chủ dự án review/merge. Không bật runtime Jira.
**Nhiệm vụ:** Xây dựng additive migration `0018_jira_workspaces.sql` tích hợp trên nền migration `0015_workspaces.sql` của PR #237 (`2c62565f`), repository nghiệp vụ mô đun hóa (`WorkspaceRepo` façade), route handlers quản trị workspace, bootstrap admin nguyên tử hoặc kích hoạt Jira cho tổ chức hiện hữu, hệ thống invite bảo mật với token 256-bit lưu duy nhất băm SHA-256, gia nhập có điều kiện kết nối danh tính Atlassian server-side và thành viên tổ chức active, kiểm tra đồng thời hai lớp quyền (tổ chức + Jira), SQL CAS duyệt/từ chối/loại bỏ thành viên chống race condition và write-skew, cô lập mọi đường dẫn hội thoại theo cờ bền vững `jira_context` và workspace bất biến, và chính sách fail-closed cho liên kết Jira site/project trước khi nối native verifier tại JIRA-05.
**Quyền lực chuẩn tắc:**
- Bổ sung thiết kế tích hợp: [Jira dùng workspace tổ chức chung](../../superpowers/specs/2026-11-02-jira-shared-workspace-amendment.md) (Quyết định ngày 02/11/2026 của chủ dự án).
- Thiết kế nền tảng Jira: [Đặc tả Jira cá nhân và workspace ATI](../../superpowers/specs/2026-10-30-jira-personal-workspaces-design.md) (Mục 4–9 và 11).
- Thiết kế Đa Workspace Tổ chức (PR #237): [Thiết kế Xác thực và Đa Workspace](../../superpowers/specs/2026-11-01-personal-and-workspace-auth-design.md).
- Hợp đồng kiểu dữ liệu đã MERGE: `packages/tool-schemas/src/myjira-context.ts`, `myjira-policy.ts`, `myjira-dto.ts` (Commit `6c53436`, PR #232).
- Kế hoạch triển khai chi tiết: [JIRA-03 Workspaces Implementation Plan](../../superpowers/plans/2026-11-01-jira-03-workspaces.md).
**Vai trò phụ trách:** Backend Engineer (`db/v3`, `apps/chat-api`).
**Phụ thuộc:** JIRA-02 (Contracts), PR #237 (`0015_workspaces.sql`). JIRA-03 là nền móng dữ liệu cho JIRA-04 (OAuth token transport), JIRA-05 (Policy & native check), JIRA-08 (Executor), JIRA-09 (UI).
**Nhánh thi công:** `longnguyen005/jira-03-workspaces` (checkpoint `322d799`, merge `main` `2c62565f`).

---

## 1. Mục tiêu và phạm vi

### 1.1. Mục tiêu cốt lõi
Thực thi quyết định của chủ dự án ngày 02/11/2026: **Dùng workspace tổ chức chung, giữ duyệt Jira riêng**.
Bảng `ati_workspaces` của Jira trở thành phần mở rộng chính sách (policy extension) có khóa chính đồng thời là khóa ngoại tham chiếu `workspaces(id)` từ PR #237; không tự sinh UUID hoặc tổ chức thứ hai. Mọi quyền Jira yêu cầu đồng thời hai lớp thành viên (`workspace_members` active VÀ `ati_workspace_memberships` active). Hội thoại tổ chức thông thường giữ nguyên hoạt động; hội thoại Jira được gắn cờ bền vững `jira_context = true` bất biến sau khi tạo, kiểm tra nghiêm ngặt hai lớp quyền và tuân thủ ranh giới sẵn sàng 503 ở môi trường production cho tới khi hoàn tất JIRA-05/08.

### 1.2. Phạm vi bao gồm (Scope In):
1. **Additive Migration (`db/v3/0018_jira_workspaces.sql`):**
   - Đặt sau `0015_workspaces.sql` của PR #237.
   - Bảng `ati_workspaces`: `id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE`, `slug` unique, `status` (`active`, `archived`), `version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)`, `created_by UUID REFERENCES users(id)`. Tên tổ chức đọc trực tiếp từ `workspaces.name` (không nhân bản tên, tránh lỗi thời).
   - Bảng `ati_workspace_memberships`: PK kép `(workspace_id, user_id)`, `workspace_id REFERENCES ati_workspaces(id) ON DELETE CASCADE`, `user_id REFERENCES users(id) ON DELETE CASCADE`, `role` (`admin`, `member`), `status` (`pending`, `active`, `rejected`, `removed`), CAS `version`, `requested_at`, `decided_at`, `decided_by`.
   - Bảng `ati_workspace_invites`: UUID PK, `workspace_id REFERENCES ati_workspaces(id)`, `token_hash` unique (SHA-256), `inviter_user_id`, `expires_at` (mặc định 7 ngày), `revoked_at`.
   - Bảng `jira_accounts`: UUID PK, `user_id`, `atlassian_account_id`, `display_name`, `status` (`connected`, `disconnected`), `identity_version`.
     - Ràng buộc partial unique kép cho trạng thái `connected`:
       - `CREATE UNIQUE INDEX jira_accounts_user_active_idx ON jira_accounts (user_id) WHERE status = 'connected';`
       - `CREATE UNIQUE INDEX jira_accounts_atlassian_active_idx ON jira_accounts (atlassian_account_id) WHERE status = 'connected';`
       - Bảo đảm: Một người ATI chỉ có tối đa 1 Atlassian identity active, VÀ một Atlassian identity active không thể bị gán cho 2 người ATI khác nhau.
   - Bảng `jira_oauth_grants`: UUID PK, `account_id`, `app_client_id`, `grant_kind`, `encrypted_access_token`, `encrypted_refresh_token`, `scopes`, `token_version`, `expires_at`, `refresh_state`.
   - Bảng `jira_grant_sites`: UUID PK, `grant_id`, `cloud_id`, `site_url`, `site_name`, `product_type`, `last_verified_at`, unique `(grant_id, cloud_id)`.
   - Bảng `ati_workspace_jira_sites`: UUID PK, `workspace_id REFERENCES ati_workspaces(id) ON DELETE CASCADE`, `cloud_id`, `site_name`, `site_url`, `active` (mặc định `false`), `policy_version`, `linked_by`, `verified_admin_by`, `admin_verified_at`, unique `(workspace_id, cloud_id)`, unique bổ sung `(workspace_id, id, cloud_id)`.
   - Bảng `ati_workspace_jira_projects`: UUID PK, `workspace_id`, `site_id`, `cloud_id`, `numeric_project_id`, `project_key`, `project_name`, `selected` (mặc định `false`), `policy_version INTEGER NOT NULL DEFAULT 1 CHECK (policy_version > 0)` riêng biệt.
     - Composite Foreign Key ràng buộc toàn vẹn bộ 3:
       `CONSTRAINT fk_workspace_site_cloud FOREIGN KEY (workspace_id, site_id, cloud_id) REFERENCES ati_workspace_jira_sites (workspace_id, id, cloud_id) ON DELETE CASCADE`.
     - Ràng buộc duy nhất: `CONSTRAINT ati_workspace_jira_projects_ws_cloud_proj_uq UNIQUE (workspace_id, cloud_id, numeric_project_id)`.
   - Bảng `jira_authorization_audit`: UUID PK, `actor_id`, `workspace_id`, `site_id`, `action`, `decision`, `version`, `details` JSONB (chỉ allowlisted metadata).
   - Mở rộng bảng `conversations`:
     - Bổ sung cột: `ADD COLUMN IF NOT EXISTS jira_context BOOLEAN NOT NULL DEFAULT false`.
     - Ràng buộc nhất quán: `CHECK ((jira_context = false) OR (workspace_mode = 'organization' AND workspace_id IS NOT NULL))`.
     - Trigger bảo vệ tính bất biến: ngăn cấm thay đổi `jira_context`, `workspace_id`, và `workspace_mode` sau khi tạo; cấm nâng cấp hội thoại legacy/personal/tổ chức thông thường thành hội thoại Jira.
   - Đảm bảo tính Idempotent: chạy lại script migration `0001` tới `0016` nhiều lần không gây lỗi.

2. **Backend Repository Mô đun hóa (`WorkspaceRepo` Façade):**
   - Tách thành các mô đun chuyên biệt dưới `apps/chat-api/src/db/repositories/workspace/`:
     - `workspace-core-repo.ts`:
       - `createWorkspaceWithBootstrapAdmin`: Tạo đồng thời bản ghi trong `workspaces`, `workspace_members`, `ati_workspaces`, `ati_workspace_memberships` với cùng một UUID trong một transaction nguyên tử duy nhất.
       - `enableJiraForWorkspace`: Bật Jira cho tổ chức hiện hữu; yêu cầu caller là active System Admin và active org admin; bootstrap admin được chỉ định cũng phải là active org admin. Trả về 409 Conflict nếu đã tồn tại.
       - `archiveWorkspace`: Chỉ archive phần Jira (`ati_workspaces.status = 'archived'`), không khóa tổ chức hay các dịch vụ khác.
       - `recoverWorkspaceAdmin`: Chỉ gán cho user đang là active admin của tổ chức.
       - `listWorkspacesForUser`: Trả về danh sách tóm tắt metadata chỉ gồm các workspace mà chính người gọi có tư cách thành viên ở cả 4 trạng thái trong các workspace Jira đang `active`.
     - `workspace-membership-repo.ts`: CAS quyết định thành viên; chống write-skew bằng khóa cấp workspace; chống self-approve, self-role-elevate; bảo vệ active admin cuối cùng; khi hai admin cùng lúc gửi yêu cầu remove lẫn nhau, người thua sau khi chờ khóa thấy actor đã bị remove nhận 404/403 access denied (chính xác 1 winner, >= 1 active admin còn lại); re-validate quyền tổ chức sau lock wait.
     - `workspace-invite-repo.ts`: Token 256-bit ngẫu nhiên bảo mật, chỉ lưu SHA-256 hash, plaintext trả về 1 lần duy nhất; join yêu cầu tài khoản Atlassian server-side VÀ caller phải đang là active member của tổ chức (`workspace_members.status = 'active'`); join lại sau reject/remove chỉ chấp nhận invite sinh SAU thời điểm quyết định (dùng `clock_timestamp()`); duplicate join của active member giữ nguyên DB active và HTTP trả về stable 409 `already_member`; duplicate join của pending member trả về idempotent 200/201 pending.
     - `workspace-site-project-repo.ts`: Quản lý site/project; kiểm tra quyền ADMINISTER bằng `NativeAdminVerifier` được cấu hình ở cấp repo/service; Fail-Closed: không verifier => từ chối link, activate, project config; cho phép deactivation an toàn; capabilities trả về 503 cho tới khi có JIRA-05.
     - `workspace-audit-repo.ts`: Ghi nhận nhật ký kiểm toán với metadata cho phép.
     - `index.ts`: Façade tổng hợp giao diện repository.

3. **Bảo vệ Toàn diện Mọi Đường dẫn Hội thoại (`conversation-access.ts`):**
   - Xây dựng mô đun kiểm soát truy cập tập trung `assertConversationAccess`:
     - Nếu `jira_context === true`: Yêu cầu đồng thời caller là owner (`conversations.user_id = caller.id`), active member của tổ chức (`workspace_members.status = 'active'`), active member của Jira (`ati_workspace_memberships.status = 'active'`), và workspace đang active.
     - Nếu `jira_context === false` và `workspace_mode === 'organization'`: Yêu cầu caller là owner và active member của tổ chức (`workspace_members.status = 'active'`); hoàn toàn không bị ảnh hưởng bởi trạng thái Jira.
     - Nếu `workspace_mode IN ('personal', 'legacy')`: Yêu cầu caller là owner và `workspace_id IS NULL`.
   - Bảo vệ toàn bộ các điểm truy cập hội thoại:
     - `apps/chat-api/src/routes/conversation-routes.ts`: `POST /`, `GET /` (`listConversationPage` lọc an toàn), `GET /:id`, `PATCH /:id`, `GET /:id/plans/active`, `GET /:id/messages/latest`, `POST /:id/messages`.
     - `apps/chat-api/src/routes/stream-routes.ts`: `GET /api/conversations/:id/stream` (SSE stream kiểm tra quyền trước khi flush SSE headers).
     - `apps/chat-api/src/routes/execution-routes.ts`: `GET /api/conversations/:convId/executions/latest`, `POST /api/plans/:id/approve`, `POST /api/plans/:id/reject`.
     - `apps/chat-api/src/routes/schedule-routes.ts`: Các endpoint xác nhận/từ chối đề xuất lịch chạm tới `convId`.
   - Ranh giới sẵn sàng cho tạo hội thoại Jira:
     - Header `X-Workspace-Id` truyền UUID tổ chức. Yêu cầu bật ngữ cảnh Jira qua cờ opt-in `jiraContext: true` trong body.
     - Trong môi trường production mặc định: trả về HTTP 503 `{ code: 'WORKSPACE_CONVERSATIONS_UNAVAILABLE', error: '...' }` khi có yêu cầu `jiraContext: true`.
     - Kiểm thử tích hợp HTTP cho tạo conversation có Jira context sử dụng tùy chọn internal server `enableWorkspaceConversations: true` (chỉ là foundation fixture test option, không bật trong production server).
     - Tạo hội thoại tổ chức thông thường (`jiraContext: false` hoặc không truyền) hoạt động bình thường theo chuẩn PR #237.
     - Mismatched header `X-Workspace-Id` và body `workspaceId` bị từ chối; body không thể ghi đè header.

4. **Phân tách Route API Rõ Ràng:**
   - Giữ nguyên toàn bộ routes `/api/workspaces` của PR #237 (`personal`, `organizations`).
   - Routes chuyên biệt của JIRA-03:
     - `POST /api/admin/jira-workspaces`: Tạo tổ chức chung + Jira policy cùng UUID (System Admin).
     - `POST /api/admin/jira-workspaces/:workspaceId/enable`: Bật Jira cho tổ chức hiện hữu (System Admin + Org Admin).
     - `POST /api/admin/jira-workspaces/:workspaceId/archive`: Archive Jira extension (System Admin).
     - `POST /api/admin/jira-workspaces/:workspaceId/recover-admin`: Khôi phục admin Jira (System Admin).
     - `GET /api/jira-workspaces`: Danh sách workspace Jira mà người gọi có tham gia (active/pending/rejected/removed).
     - `POST /api/jira-workspace-join-requests`: Gửi yêu cầu gia nhập Jira bằng invite token; yêu cầu có connected Atlassian account VÀ đã là thành viên của tổ chức.
     - `GET /api/jira-workspaces/:id/members`: Danh sách thành viên Jira (Jira Admin).
     - `POST /api/jira-workspaces/:id/members/:userId/decision`: CAS quyết định thành viên Jira.
     - `POST /api/jira-workspaces/:id/invites`, `GET /api/jira-workspaces/:id/invites`, `DELETE /api/jira-workspaces/:id/invites/:inviteId`: Quản trị invite Jira (secret-free listing).
     - `GET /api/jira-workspaces/:id/jira-sites`, `POST /api/jira-workspaces/:id/jira-sites`, `PATCH /api/jira-workspaces/:id/jira-sites/:siteId`: Quản trị site Jira (Fail-Closed).
     - `GET /api/jira-workspaces/:id/jira-sites/:siteId/projects`, `PUT /api/jira-workspaces/:id/jira-sites/:siteId/projects`: Quản trị project (numeric IDs).
     - `GET /api/jira-workspaces/:id/jira-capabilities`: Trả về 503 cho tới JIRA-05.

### 1.3. Ngoài phạm vi (Scope Out):
- JIRA-04: Luồng trao đổi OAuth code/token, mã hóa token AES-256-GCM runtime, HTTP exchange với Atlassian OAuth endpoint.
- JIRA-05: Native permission verification HTTP calls (`/mypermissions`), LLM source revalidation, SSE output buffer filtering.
- JIRA-06: Tool Adapters HTTP client (`myjira.*`).
- JIRA-07: AI Planner routing và multi-site grounding prompts.
- JIRA-08: Full Executor guards, execution lease locking trong quá trình chạy plan.
- JIRA-09: Giao diện người dùng Web (React/Zustand UI).
- Không sửa đổi `packages/tool-schemas` (đã đóng ở JIRA-02).
- Không kích hoạt cờ `MYJIRA_ENABLED`, giữ nguyên 33 tools và 8 services mặc định.

---

## 2. Danh mục File phụ trách

| File | Hành động | Mục đích |
|---|---|---|
| `db/v3/0018_jira_workspaces.sql` | Tạo mới | Additive migration: `ati_workspaces` (FK đến `workspaces.id`), 8 bảng Jira liên kết, `conversations.jira_context`, trigger bất biến, composite FKs, partial unique indexes |
| `apps/chat-api/src/db/repositories/workspace/workspace-core-repo.ts` | Tạo mới | Tạo atomic org+Jira, enable Jira cho org hiện hữu, archive, recovery, listing workspace Jira |
| `apps/chat-api/src/db/repositories/workspace/workspace-membership-repo.ts` | Tạo mới | CAS quyết định thành viên, khóa cấp workspace, bảo vệ last admin, chống self-approve, re-validate org membership |
| `apps/chat-api/src/db/repositories/workspace/workspace-invite-repo.ts` | Tạo mới | Sinh invite 256-bit (hash-only), join kiểm tra connected account VÀ org membership, clock_timestamp monotonic rejoin rule |
| `apps/chat-api/src/db/repositories/workspace/workspace-site-project-repo.ts` | Tạo mới | Site/project config, composite verification, fail-closed policy mutations, capabilities 503 |
| `apps/chat-api/src/db/repositories/workspace/workspace-audit-repo.ts` | Tạo mới | Ghi nhận nhật ký kiểm toán với allowlisted metadata |
| `apps/chat-api/src/db/repositories/workspace/index.ts` | Tạo mới | Façade `WorkspaceRepo` đóng gói các mô đun con |
| `apps/chat-api/src/auth/conversation-access.ts` | Tạo mới | Module kiểm soát quyền truy cập hội thoại chung cho API/Stream/Execution/Schedule, hỗ trợ `jira_context` |
| `apps/chat-api/src/db/repositories/conversation-repo.ts` | Cập nhật | Hỗ trợ `jira_context` bất biến trong transaction; lọc `listConversationPage` an toàn |
| `apps/chat-api/src/db/repositories/index.ts` | Cập nhật | Re-export `WorkspaceRepo` và các types liên quan |
| `apps/chat-api/src/routes/workspace-routes.ts` | Tạo mới | Express router: `/api/jira-workspaces`, `/api/admin/jira-workspaces`, `/api/jira-workspace-join-requests` |
| `apps/chat-api/src/routes/conversation-routes.ts` | Cập nhật | Áp dụng guard `conversation-access` và availability boundary 503 cho `jira_context` |
| `apps/chat-api/src/routes/stream-routes.ts` | Cập nhật | Áp dụng guard `conversation-access` cho SSE stream |
| `apps/chat-api/src/routes/execution-routes.ts` | Cập nhật | Áp dụng guard `conversation-access` cho execution reload và plan approval |
| `apps/chat-api/src/routes/schedule-routes.ts` | Cập nhật | Áp dụng guard `conversation-access` cho các thao tác schedule theo convId |
| `apps/chat-api/src/app.ts` | Cập nhật | Wire `workspaceRepo` và đăng ký routes Jira workspace bên cạnh routes PR #237 |
| `apps/chat-api/src/server.ts` | Cập nhật | Khởi tạo `WorkspaceRepo` với PostgreSQL pool và truyền vào `createApp` |
| `apps/chat-api/tests/helpers/jira-test-db.ts` | Tạo mới | Test helper cho JIRA-03: nạp migration 0001–0017, hỗ trợ cổng 56534 hoặc CI loopback 5432 (từ chối 55533) |
| `apps/chat-api/tests/db/jira-workspace-migration.test.ts` | Tạo mới | Kiểm thử PostgreSQL thật: idempotence migration 0001–0017, composite FKs, partial unique indexes, trigger bất biến `jira_context` |
| `apps/chat-api/tests/db/jira-workspace-repo.test.ts` | Tạo mới | Kiểm thử PostgreSQL thật: atomic create, enable existing org, 2 admin CAS có barrier, bảo vệ last admin, join clock_timestamp |
| `apps/chat-api/tests/routes/jira-workspaces.test.ts` | Tạo mới | Kiểm thử API routes: system-admin create, enable route, private listing, invite secret 1 lần, site config fail-closed, 404 hidden |
| `apps/chat-api/tests/routes/jira-workspace-conversations.test.ts` | Tạo mới | Kiểm thử cô lập hội thoại: tạo atomic có cờ Jira, stream, execution, schedule guards, bảo vệ legacy NULL và org bình thường |

---

## 3. Tiêu chí nghiệm thu (Checklist)

- [x] **Single Shared Organization Identity:** `ati_workspaces` có PK đồng thời là FK tham chiếu `workspaces(id)` của PR #237; không sinh UUID hoặc tổ chức thứ hai; tên tổ chức đọc từ `workspaces.name`.
- [x] **Dual-Layer Membership Enforcement:** Truy cập dữ liệu/quản trị thành viên, site và project Jira yêu cầu cả hai lớp membership (`workspace_members` active VÀ `ati_workspace_memberships` active); gỡ user khỏi tổ chức chặn ngay lập tức quyền Jira.
- [x] **Enable Jira on Existing Organization:** Endpoint `POST /api/admin/jira-workspaces/:workspaceId/enable` cho phép System Admin kiêm Org Admin bật Jira; trả về 409 Conflict nếu đã bật; không tự ý reset membership hoặc version.
- [x] **Organization Auto-Join Isolation:** Tổ chức có `require_approval = false` không tự động cấp quyền Jira; gia nhập Jira bắt buộc qua invite token Jira và kiểm tra danh tính Atlassian server-side.
- [x] **Jira Invite Precondition:** Gia nhập Jira qua invite token bắt buộc caller đã là thành viên active của tổ chức; người ngoài tổ chức không thể gia nhập Jira.
- [x] **Migration Idempotence & Schema:** `0018_jira_workspaces.sql` chạy an toàn sau `0015_workspaces.sql`, chạy lặp lại nhiều lần không lỗi; mọi bảng có check constraints, composite FK `(workspace_id, site_id, cloud_id)`, và partial unique indexes.
- [x] **Dual Active Account Protection:** Ràng buộc partial unique trên `jira_accounts` ngăn chặn việc gán cùng 1 Atlassian account active cho 2 người dùng ATI khác nhau.
- [x] **Independent Project Policy Version:** Mỗi project row có `policy_version` dương riêng biệt, quản lý độc lập với site version.
- [x] **Conversation Jira Context Immutability:** Cột `jira_context` trong `conversations` là bất biến sau khi tạo; không thể nâng cấp hội thoại legacy/personal/tổ chức cũ thành hội thoại Jira; ràng buộc check bảo đảm `jira_context = true` chỉ khi ở mode organization.
- [x] **Standard Org Conversations Unaffected:** Hội thoại tổ chức thông thường (`jira_context = false`) chỉ kiểm tra quyền tổ chức, hoàn toàn không bị ảnh hưởng bởi việc bật/tắt Jira.
- [x] **Conversation Creation Availability Boundary:** Tạo hội thoại với `jiraContext: true` trả về HTTP 503 mặc định ở production; chỉ mở khi inject internal server option trong test fixture.
- [x] **Real Concurrency & CAS Integrity:** 2 client PostgreSQL thật cùng gửi request CAS quyết định thành viên: đúng 1 request thành công, request còn lại nhận 409 stale version và abort sạch.
- [x] **Mutual Remove & Last Admin Protection:** Khi 2 admin cùng remove nhau, đúng 1 winner và >= 1 active admin còn lại; người thua nhận 404/403 access denied; test riêng cho sole active admin tự xóa nhận 409 LAST_ACTIVE_ADMIN; cấm self-approve và self-role-elevate.
- [x] **Hidden Resource Privacy (404 Pattern):** Tài nguyên Jira ngoài quyền của caller trả 404; giữ giao thức chọn workspace chung của #237 và các ngoại lệ vòng đời/trạng thái tham gia đã ghi trong bổ sung thiết kế.
- [x] **Fail-Closed Site & Project Configuration:** Mọi mutation cấu hình policy (link site, activate site, configure projects) đều yêu cầu quyền native ADMINISTER; production không có verifier mặc định fail-closed; deactivation cho phép không cần provider; capabilities trả về 503.
- [x] **Clean Separation & Flag-Off Invariant:** Không chứa code runtime Jira OAuth token flow (thuộc JIRA-04) hay Jira HTTP execution (thuộc JIRA-06); giữ nguyên 33 tools và 8 services.

---

## 4. Lệnh kiểm tra dành cho Parent Codex

> **Quy chuẩn môi trường kiểm thử:**
> Toàn bộ kiểm thử chạy trên instance PostgreSQL chuyên dụng cổng `56534` (hoặc CI loopback `5432` trên database `ati_v3`). Không load `.env`. Parent Codex sở hữu Git commits và chạy các lệnh kiểm tra thật.

### 4.1. Chạy test Migration PostgreSQL:
```bash
DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/db/jira-workspace-migration.test.ts
```

### 4.2. Chạy test Repository & CAS Concurrency (2 Clients + Barrier):
```bash
DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/db/jira-workspace-repo.test.ts
```

### 4.3. Chạy test API Routes & Conversation Privacy:
```bash
DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/routes/jira-workspaces.test.ts tests/routes/jira-workspace-conversations.test.ts
```

### 4.4. Kiểm tra Typecheck và Full Check toàn hệ thống:
```bash
npm run typecheck:v3
DATABASE_URL="$TEST_DATABASE_URL" npm run check
```

---

## 5. Kết quả

- **Trạng thái Baseline trước Merge (Pre-237 Checkpoint `322d799`):**
  - Database & Repo tests: 60/60 PASS (19 migration + 41 repo).
  - Conversation tests: 134/134 PASS (9 test files).
  - HTTP routes tests: 37/37 PASS.
  - Scoped reviews: spec PASS, quality PASS.
  *(Lưu ý: Bằng chứng trên chỉ là baseline pre-237, không phải kết quả nghiệm thu cuối cùng sau tích hợp).*
- **Kết quả hiện tại sau tích hợp #237/#238/#239:** cùng `workspaces.id`, chính sách và duyệt Jira độc lập; tên tổ chức đọc từ bảng chung. API Jira dùng tiền tố riêng; API workspace tổ chức của #237 giữ nguyên. Tạo/bật Jira, bootstrap/recovery, invite, CAS, site/project và audit đã triển khai. Hội thoại có dấu `jira_context` bất biến; hội thoại tổ chức thường không yêu cầu quyền Jira. Jira opt-in vẫn trả 503 trong server.
- **Bằng chứng chạy thật:** `node db/v3/migrate.mjs` áp dụng 0001–0018, exit 0; `npm run typecheck:v3`, exit 0; `npm run check`, exit 0: 3.309 test v3 (API 1.164, web 917, schemas 341, adapters 464, planner 381, executor 42), 406 eval, 32 Node probe Jira, 1 launcher và 66 Node/env checks; build/security đạt. Không có test bỏ qua trong lượt check này.
- **Đột biến:** 14/14 bị bắt bằng assertion nghiệp vụ; mỗi ca có control xanh, khôi phục đúng byte/SHA-256 và control sau khôi phục xanh. Gồm định danh tổ chức, trigger bất biến, cờ Jira, danh tính đã kết nối, invite mới sau quyết định, admin hiệu lực cuối, thiếu native verifier, 404 riêng tư, cổng 503, user bị khóa trong lúc chờ, hạn invite sau chờ khóa và membership tổ chức. Ca thiếu verifier là đột biến tổng hợp được ghi rõ, không gọi Jira thật.
- **Review môđun độc lập:** database/core/API, hội thoại và site/project đều spec PASS, quality APPROVED, không có lỗi Critical/Important còn mở. Comment đường dẫn cũ đã sửa; guard schedule ở app luôn được cấp repository/authority, unit test thuần service có thể không cấp các dependency đó.
- **Sửa lỗi tìm thấy khi tích hợp:** scopeArg bị bỏ qua khi tiêu đề undefined; status quyền được kiểm tra sai thứ tự; tên/trạng thái Jira bị lộ sau gỡ quyền tổ chức; conflict bật Jira trước kiểm tra quyền; pool lỗi vẫn được truyền khi chuyển memory fallback; các fixture cũ thiếu membership/header/scope tổ chức. Tất cả có hồi quy thật; không nới guard để làm test xanh.
- **Git/PR:** nhánh `longnguyen005/jira-03-workspaces`; checkpoint nguồn `fe061bb`, `322d799`. Commit tích hợp, kết quả review toàn nhánh và CI/browser trên SHA cuối được ghi ở PR. Chủ dự án tự review và merge; không sửa `CURRENT-STATE.md` hoặc `ROADMAP.md` trong PR này.
- **Giới hạn:** chưa triển khai OAuth token transport JIRA-04, native verifier/policy runtime JIRA-05, planner/executor Jira hoặc UI/live JIRA-06–11. Không có thao tác ghi Jira thật và không bật tính năng. Giữ nguyên 33 tools/8 services.
- **Nhật ký:** [bằng chứng và quyết định tích hợp](../log/2026-11-02-jira-03-shared-workspaces.md).

### Tích hợp tiếp main #238

Main `86b432f` bổ sung Sheets v2 và migration `0016_sheets_automation_and_digest.sql`. Jira chuyển sang `0018_jira_workspaces.sql`; route xác nhận lịch giữ guard quyền trước validation và chuyển tiếp `approvalMode`. Năm hồi quy PostgreSQL/HTTP kiểm tra `auto_digest`, thu hồi quyền Jira/tổ chức và thứ tự lỗi. `npm run check` sau tích hợp đạt 3.309 v3 + 406 eval; migrations 0001–0017 và typecheck đạt; 14/14 đột biến bị bắt, gồm guard xác nhận lịch Sheets/Jira, khôi phục byte/SHA và chạy xanh lại. Review toàn nhánh và CI đúng head cuối xem PR #240.

### Tích hợp tiếp main #239

Main `2d5f625` bổ sung Calendar v2 và migration 0017; Jira dùng `0018_jira_workspaces.sql`. Server giữ các guard Jira cùng cấu hình Calendar mới. Memory repository cũng tôn trọng scopeArg khi tiêu đề undefined: hồi quy RED rồi GREEN, cùng 5 kiểm thử lịch đạt 6/6. Full check mới exit 0: **3.309 v3**, **406 eval**, API 1.159/134 file, web 917, adapters 464, schemas 341, planner 381, executor 42; các kiểm tra Node/launcher/build đạt. Migration 0001–0018 thành công; 13 guard được kiểm chứng lại trên base mới trước push. SHA cuối và CI/browser xem PR #240.

### Bản vá cuối: không cho title trở thành scope

Rà soát bổ sung sau head `5f6325e` phát hiện title object đi vào overload repository và có thể vượt cổng Jira opt-in. Hai hồi quy PostgreSQL/HTTP tái hiện RED (201 thay vì 400). Route nay từ chối title ngoài string/null/omitted và chỉ truyền string hoặc undefined vào repository; 16 kiểm thử nhóm hội thoại GREEN, gồm 3 control title hợp lệ/null/JSON dạng chuỗi. Full check mới **3.309 v3** (API1.164/134 file) +406 eval đạt; hậu kiểm 14 đột biến và review delta/CI lấy theo SHA bản vá cuối tại PR #240. CI xanh trên head5f là baseline trước vá, không thay kết quả trên head mới.
