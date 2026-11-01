# JIRA-03 · Workspace DB & API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Parent Codex runs commands and captures real test output before and after each phase.

**Goal:** Xây dựng hạ tầng cơ sở dữ liệu PostgreSQL (migration 0015), repository nghiệp vụ mô đun hóa (`WorkspaceRepo` façade), API routes quản trị workspace ATI, lời mời 256-bit lưu băm SHA-256, gia nhập qua danh tính Atlassian server-side, SQL CAS duyệt thành viên chống write-skew/race condition, cô lập toàn diện mọi đường dẫn hội thoại theo workspace bất biến, và chính sách fail-closed cho liên kết Jira site/project.

**Architecture:** Áp dụng mô hình kiến trúc phân lớp sạch (Clean Architecture): tầng lưu trữ PostgreSQL với migration gia tăng (additive migration) idempotent, khóa giao dịch cấp workspace và thứ tự khóa deterministic (`JIRA_SQL_LOCK_HIERARCHY`) chống deadlock; tầng Repository mô đun hóa (`WorkspaceRepo` façade kết hợp các sub-repositories: core, membership, invite, site/project, audit); tầng kiểm soát truy cập hội thoại tập trung (`conversation-access.ts`) bảo vệ toàn diện các routes API, Stream, Execution và Schedule; tầng HTTP API (`workspace-routes.ts`) tuân thủ nghiêm ngặt hợp đồng DTOs từ `packages/tool-schemas` và nguyên tắc bảo vệ quyền riêng tư 404 Hidden Pattern.

**Tech Stack:** Node.js `^22.12.0 || >=24.0.0`, TypeScript 5.6+, Express 5, PostgreSQL (`pg` pool, `clock_timestamp()`, row-level locks), Vitest, Supertest, crypto native.

**Spec:** [`docs/superpowers/specs/2026-10-30-jira-personal-workspaces-design.md`](../specs/2026-10-30-jira-personal-workspaces-design.md) (Mục 4–9 và 11).

**Task Card:** [`docs/handoff/tasks/JIRA-03-workspaces.md`](../../handoff/tasks/JIRA-03-workspaces.md).

---

## Global Constraints

1. **Bảo mật Bí mật Lời mời (Zero Secret Leakage):** Invite token sinh ngẫu nhiên cryptographically secure 256-bit (`crypto.randomBytes(32)`). Cơ sở dữ liệu CHỈ lưu SHA-256 hash trong cột `token_hash`. Plaintext token chỉ trả về một lần duy nhất tại response `POST /api/workspaces/:id/invites`. Tuyệt đối không echo token trong list, get, DTOs hay logs.
2. **Xác thực Danh tính Thật Phía Server (No Client Account Trust):** Endpoint gia nhập `POST /api/workspace-join-requests` bắt buộc kiểm tra sự tồn tại của bản ghi `jira_accounts` có trạng thái `connected` thuộc sở hữu của người gọi ở server. Tuyệt đối không tin cậy `accountId` do trình duyệt gửi lên. Duplicate join của active member giữ nguyên DB active và HTTP trả về stable 409 `already_member` (không trả pending giả mạo); duplicate join của pending member trả về idempotent 200/201 pending.
3. **Bảo vệ Danh tính Kép (Dual Active Account Index):** Bảng `jira_accounts` áp dụng hai chỉ số partial unique độc lập khi `status = 'connected'`: trên `user_id` và trên `atlassian_account_id`. Không cho phép cùng 1 Atlassian identity active bị gán cho 2 người ATI khác nhau.
4. **Chính sách Fail-Closed cho Jira Site & Project Mutations:** Mọi thao tác cấu hình policy (link site, activate site, configure projects) bắt buộc có bằng chứng xác minh quyền native ADMINISTER từ Atlassian thông qua `NativeAdminVerifier` được cấu hình ở cấp repo/service. Khi thiếu verifier hoặc verifier từ chối/unavailable, hệ thống BẮT BUỘC từ chối (503 khi verifier unavailable/chưa cấu hình sau khi đã qua kiểm tra hợp lệ ATI/account/grant; 403 khi verifier denied); tuyệt đối không tạo bản ghi inactive site khi thiếu verifier. Chỉ liên kết ĐÃ XÁC MINH (trusted verified link) mới tạo bản ghi site ở trạng thái ban đầu `active = false`. Deactivation an toàn không cần provider (fail-closed safe). Capability directory trả về explicit 503, không trả danh sách rỗng `[]` giả mạo trạng thái sẵn sàng.
5. **Project Policy Version Độc lập & Composite FK:** Mỗi project row có `policy_version > 0` riêng biệt (độc lập với site policy version). Bảng `ati_workspace_jira_projects` áp dụng composite foreign key `(workspace_id, site_id, cloud_id)` tham chiếu `ati_workspace_jira_sites(workspace_id, id, cloud_id)` để đảm bảo tính toàn vẹn bộ ba.
6. **Ranh giới Sẵn sàng cho Tạo Hội thoại & Cô lập Toàn diện:**
   - Public HTTP `POST /api/conversations` kèm `workspaceId` trả về explicit HTTP 503 `WORKSPACE_CONVERSATIONS_UNAVAILABLE` trong môi trường production mặc định (vì việc bảo vệ in-flight model/persist/SSE thuộc về JIRA-05/08).
   - Tầng repository `createConversation` hỗ trợ tạo transactional đầy đủ với `workspace_id` và được kiểm thử; kiểm thử tích hợp HTTP cho tạo conversation có workspace sử dụng tùy chọn internal server `enableWorkspaceConversations: true` (chỉ là foundation fixture test option, không phải cờ môi trường production, không tạo dev bypass).
   - Tạo hội thoại legacy NULL (`POST /api/conversations` không có workspaceId) giữ nguyên hoạt động bình thường.
   - Cột `conversations.workspace_id` là bất biến sau khi tạo. Trigger SQL ngăn chặn `NULL -> workspace`, `workspace -> NULL`, và `workspace A -> workspace B`.
   - Mọi đường dẫn truy cập hội thoại (API routes, SSE stream, execution reload/approval, schedule proposals) đều kiểm tra quyền caller là owner VÀ active member của active workspace. Người dùng ngoài workspace nhận 404 Not Found.
   - Missing authority checker không được phép tự động hạ cấp hàng scoped đã biết về legacy: chỉ bản ghi có lưu trữ `workspace_id IS NULL` thực sự kèm metadata legacy và quyền owner mới được phép đi theo nhánh memory legacy, mọi trường hợp khác trả về 404. Không tuyên bố in-flight SSE/model authorization lease đã hoàn thành trong JIRA-03.
7. **Đồng bộ Hóa và Khóa PostgreSQL (Deterministic Lock Protocol):** Thao tác thu hồi (revocation) và quyết định thành viên tuân thủ thứ tự khóa đã thỏa thuận tại JIRA-02:
   `ati_workspaces` → `ati_workspace_memberships` → `jira_accounts` → `ati_workspace_jira_sites` → `ati_workspace_jira_projects`.
   Tránh write-skew quản trị viên cuối cùng bằng transaction-level lock trên workspace (`ati_workspaces FOR UPDATE`). CAS bắt buộc dùng câu lệnh `UPDATE ... WHERE status = ... AND version = ...` thật với kiểm tra thẩm quyền bên trong transaction sau lock wait (admin actor bắt buộc phải duy trì trạng thái active sau khi chờ khóa workspace, pending fix đang được kiểm thử). Khi 2 admin cùng remove nhau, người thua sau khi chờ khóa thấy actor đã bị remove nhận 404/403 access denied (chính xác 1 winner, >= 1 active admin còn lại); test riêng cho sole active admin tự xóa nhận 409 LAST_ACTIVE_ADMIN.
8. **Môi trường Kiểm thử PostgreSQL Độc lập:** Toàn bộ test integration chạy trên instance PostgreSQL chuyên dụng cổng local `56534` hoặc CI loopback `5432` (database `ati_v3`) được cung cấp qua biến môi trường `DATABASE_URL` / `TEST_DATABASE_URL`, TUYỆT ĐỐI KHÔNG dùng database runtime `55533` và không fallback về default DB ngầm định. Không nhúng mật khẩu thực tế vào code. Test helper ném lỗi nếu phát hiện port 55533, thiếu biến môi trường, hoặc remote host. Runtime SQL fixtures nạp ĐẦY ĐỦ các migration hiện hành; các test lịch sử (0004/0006) dùng SQL thô cô lập để không bypass schema.
9. **Bảo vệ Cờ Tắt (Flag-Off Invariant):** Không kích hoạt cờ runtime, giữ nguyên `ALL_TOOLS.length === 33` và `SERVICE_REGISTRY.length === 8`. Không gọi mạng ra Atlassian live hoặc gọi LLM model.
10. **Listing Workspace Metadata-Only:** `GET /api/workspaces` trả về bản tóm tắt metadata chỉ gồm các workspace mà chính người gọi có tư cách thành viên ở cả 4 trạng thái (`active`, `pending`, `rejected`, `removed`) trong các workspace đang `active`; không lộ directory của các workspace không liên quan. Mọi thao tác trên site, project, nội dung và hội thoại đều bắt buộc tư cách thành viên `active`.

---

## Review Focus

1. **Concurrent CAS Race Condition:** Hai quản trị viên cùng lúc gửi quyết định duyệt/từ chối trên cùng một thành viên pending.
   *Assertion cụ thể:* Dùng 2 client PG độc lập và một barrier synchronization. Client A gửi `approve(version: 1)`, Client B gửi `reject(version: 1)`. Kết quả: Đúng 1 Promise resolve với `{ status: 'active' | 'rejected', version: 2 }`; Promise còn lại reject với `WorkspaceRepoError` có `status === 409` và `code === 'STALE_VERSION'`. Query DB xác nhận `version === 2` và chỉ có 1 dòng audit được ghi. *(Kiểm chứng tại Task 2, Step 2.1)*.
2. **Mutual Admin Remove & Sole Admin Protection:**
   *Assertion cụ thể:*
   - Mutual remove race: Admin 1 và Admin 2 cùng gửi request gỡ bỏ lẫn nhau. Cả hai đều xin khóa `ati_workspaces FOR UPDATE`. Giao dịch 1 được cấp khóa trước -> gỡ bỏ Admin 2 thành công. Giao dịch 2 sau khi đợi khóa đọc lại trạng thái actor trong DB -> phát hiện actor đã bị removed -> nhận 404 / 403 access denied. Invariant: đúng 1 winner và còn đúng 1 active admin.
   - Sole admin self-remove: Authorized active admin duy nhất cố tình xóa chính mình -> nhận lỗi `WorkspaceRepoError(409, 'LAST_ACTIVE_ADMIN')`.
   *(Kiểm chứng tại Task 2, Step 2.2)*.
3. **Monotonic Rejoin & Active Duplicate Join Invariant:**
   *Assertion cụ thể:*
   - Replay old invite: Invite I1 sinh lúc T0. Admin reject user U1 lúc T1 (dùng `clock_timestamp()` tươi sau khi nhận khóa). User U1 gọi `joinWorkspaceWithInvite(I1)` -> So sánh timestamp SQL `invite.created_at > membership.decided_at` (độ chính xác microsecond SQL, không dùng JS Date) -> Reject với `WorkspaceRepoError(404, 'INVITE_NOT_FOUND')` hoặc `403`. Admin sinh invite mới I2 lúc T2 > T1 -> User U1 gọi `joinWorkspaceWithInvite(I2)` -> Resolve thành công `{ status: 'pending' }`.
   - Active duplicate join: User đang `active` gửi lại join request bằng invite I2 -> DB giữ nguyên `active` (không hạ cấp), repository trả về outcome `already_active`, HTTP endpoint trả về stable 409 `{ code: 'ALREADY_WORKSPACE_MEMBER' }`, không bao giờ trả về pending giả mạo.
   - Pending duplicate join: User đang `pending` gửi lại join request -> Trả về 200/201 `{ status: 'pending' }` idempotent.
   *(Kiểm chứng tại Task 2, Step 2.3)*.
4. **Conversation Availability Boundary & Guard across Entry Points:**
   *Assertion cụ thể:*
   - Public HTTP `POST /api/conversations` có `workspaceId` (mặc định production) -> Nhận HTTP 503 `{ code: 'WORKSPACE_CONVERSATIONS_UNAVAILABLE' }`.
   - Với test fixture option `enableWorkspaceConversations: true` -> Tạo conversation thành công 201 Created.
   - `POST /api/conversations` không có `workspaceId` (legacy NULL) -> Tạo thành công 201 Created mà không phụ thuộc cờ.
   - Missing authority checker không được phép hạ cấp hàng scoped về legacy; chỉ bản ghi có lưu trữ `workspace_id IS NULL` thực sự kèm metadata legacy và quyền owner mới được phép đi nhánh memory legacy, ngược lại trả về 404. Không tuyên bố hoàn thành in-flight SSE/model lease trong JIRA-03.
   - Caller ngoài workspace hoặc đã bị remove truy cập:
     - `GET /api/conversations`: Caller đã bị remove khỏi W1 gọi listing -> Response không chứa hội thoại của W1 dù không truyền filter `workspaceId`.
     - `GET /api/conversations/:id`: Nhận HTTP 404 `{ error: 'Conversation not found' }`.
     - `GET /api/conversations/:id/stream`: Nhận HTTP 404 trước khi headers SSE được gửi.
     - `GET /api/conversations/:convId/executions/latest`: Nhận HTTP 404.
     - `POST /api/plans/:id/approve`: Nhận HTTP 404.
     - `POST /api/conversations/:convId/schedule-proposals/:messageId/confirm`: Nhận HTTP 404.
   *(Kiểm chứng tại Task 4, Step 4.1)*.
5. **Fail-Closed Site & Project Mutations & Capabilities:** Quản trị viên workspace gửi yêu cầu link site, PATCH `active: true`, hoặc configure projects khi thiếu verifier hoặc verifier từ chối.
   *Assertion cụ thể:*
   - Gọi `linkSite` khi không có verifier -> Bị từ chối (503 nếu verifier unavailable/chưa cấu hình sau khi qua prechecks hợp lệ; 403 nếu denied); tuyệt đối không tạo bản ghi inactive site.
   - Chỉ khi verifier được cấu hình và trả về `{ status: 'granted', verifiedProjects: [...] }` thì `linkSite` mới tạo site ở trạng thái ban đầu `active === false`.
   - Gọi `updateSite(active: true)` khi verifier trả về `{ status: 'unavailable' }` hoặc `{ status: 'denied' }` -> Reject với `WorkspaceRepoError(503/403)`. Query DB xác nhận `active` vẫn là `false`.
   - Deactivation `updateSite(active: false)` khi không có verifier -> Thành công, `active === false` (thu hồi quyền an toàn không cần provider).
   - Gọi `configureProjects` với `selectedProjectIds` chứa wildcard (`['*']`) hoặc project key (`['PROJ-1']`) -> Reject với `400 'INVALID_PROJECT_ID'`.
   - Gọi `configureProjects` khi verifier trả về thiếu project ID tương ứng -> Reject với `403 'PROJECT_NOT_VERIFIED'`. Nhãn project tin cậy được lấy từ `verifiedProjects: { projectId, key, name }[]`, không tự chế nhãn.
   - Gọi `getCapabilities` -> Nhận explicit HTTP 503 (`CAPABILITIES_UNAVAILABLE`), không trả về mảng rỗng `[]` giả mạo trạng thái sẵn sàng.
   *(Kiểm chứng tại Task 3, Step 3.1)*.

---

## File Structure & Module Boundaries

```
ATI_Project/
├── db/v3/
│   └── 0015_jira_workspaces.sql            # Additive migration: 9 bảng mới + cột conversations.workspace_id
├── apps/chat-api/
│   ├── src/
│   │   ├── auth/
│   │   │   └── conversation-access.ts      # Module kiểm soát quyền hội thoại tập trung cho API/Stream/Exec/Sched
│   │   ├── db/
│   │   │   └── repositories/
│   │   │       ├── workspace/              # Phân tách mô đun hóa WorkspaceRepo
│   │   │       │   ├── workspace-core-repo.ts        # Tạo workspace, bootstrap admin, archive, recovery, listing
│   │   │       │   ├── workspace-membership-repo.ts  # CAS quyết định thành viên, khóa cấp workspace, last-admin guard
│   │   │       │   ├── workspace-invite-repo.ts      # Sinh invite 256-bit (hash-only), join bằng server account, monotonic clock
│   │   │       │   ├── workspace-site-project-repo.ts# Site/project config, composite verifier, fail-closed, 503 caps
│   │   │       │   ├── workspace-audit-repo.ts       # Audit log với allowlisted metadata
│   │   │       │   └── index.ts                      # Façade WorkspaceRepo
│   │   │       ├── conversation-repo.ts     # Cập nhật: workspace_id bất biến & lọc listPage an toàn
│   │   │       └── index.ts                 # Export WorkspaceRepo
│   │   ├── routes/
│   │   │   ├── workspace-routes.ts          # Express router: /api/workspaces, /api/admin/workspaces, etc.
│   │   │   ├── conversation-routes.ts       # Cập nhật: 503 availability boundary & conversation-access guard
│   │   │   ├── stream-routes.ts             # Cập nhật: áp dụng conversation-access guard cho SSE stream
│   │   │   ├── execution-routes.ts          # Cập nhật: áp dụng conversation-access guard cho execution entry
│   │   │   └── schedule-routes.ts           # Cập nhật: áp dụng conversation-access guard cho schedule proposals
│   │   ├── app.ts                           # Wire router và middleware
│   │   └── server.ts                        # Khởi tạo WorkspaceRepo với PG pool
│   └── tests/
│       ├── helpers/
│       │   └── jira-test-db.ts              # Helper DB: cho phép port 56534 hoặc CI loopback 5432 (từ chối 55533)
│       ├── db/
│       │   ├── jira-workspace-migration.test.ts  # Test migration idempotence, triggers, constraints, composite FKs
│       │   └── jira-workspace-repo.test.ts       # Test CAS concurrency (2 clients + barrier), lock hierarchy, joins
│       └── routes/
│           ├── jira-workspaces.test.ts           # Test API endpoints quản trị workspace & invite
│           └── jira-workspace-conversations.test.ts # Test cô lập hội thoại đa đường dẫn (stream, execution, schedule)
```

---

## Tasks Thi công Chi tiết

> **Prerequisite Kiểm thử Môi trường:**  
> Toàn bộ các lệnh kiểm thử sử dụng biến môi trường do hệ thống bên ngoài cung cấp: `TEST_DATABASE_URL` (hoặc `DATABASE_URL`) trỏ tới PostgreSQL test chuyên dụng cổng local `56534` (hoặc CI loopback `5432` trên database `ati_v3`). Không nhúng mật khẩu thực tế vào tài liệu, không phụ thuộc file `.env`, không cho phép default DB fallback ngầm định, và tuyệt đối cấm cổng runtime `55533`.  
> Ví dụ cú pháp thực thi chuẩn: `DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/...`

### Task 1: Additive Migration 0015 & Database Schema Constraints

*(Phase 1 migration TESTS worker đang hoạt động độc lập, Task 1 schema và brief giữ nguyên không đổi).*

**Mục tiêu:** Tạo migration file `db/v3/0015_jira_workspaces.sql` định nghĩa đầy đủ 9 bảng dữ liệu mới, cột `workspace_id` trong `conversations`, trigger bất biến cho `conversations.workspace_id`, các foreign keys cascade, composite FK cho project site, check constraints, policy version riêng cho project, và partial unique indexes cho active accounts.

**Files:**
- Create: `apps/chat-api/tests/helpers/jira-test-db.ts`
- Create: `apps/chat-api/tests/db/jira-workspace-migration.test.ts`
- Create: `db/v3/0015_jira_workspaces.sql`

- [ ] **Step 1.1: Tạo helper `jira-test-db.ts` và viết test failing cho migration**
  Tạo `apps/chat-api/tests/helpers/jira-test-db.ts`: Cho phép `DATABASE_URL` cổng local `56534` hoặc CI loopback `5432` (`ati_v3`), từ chối `55533` và remote host. Tạo schema riêng biệt.
  Tạo `apps/chat-api/tests/db/jira-workspace-migration.test.ts`:
  - Thực thi toàn bộ migration `0001` tới `0015`.
  - Thực thi `runAll()` hai lần liên tiếp -> Kỳ vọng không lỗi (Idempotence).
  - Test real INSERT failure cho `jira_accounts`: Gán cùng 1 `atlassian_account_id` active cho 2 user ATI -> Câu lệnh thứ 2 FAIL do vi phạm `jira_accounts_atlassian_active_idx`.
  - Test composite FK trên `ati_workspace_jira_projects`: Project có `cloud_id` không khớp với `site.cloud_id` -> FAIL do vi phạm `fk_workspace_site_cloud`.
  - Test project policy_version riêng biệt: Project row có `policy_version = 1`, cập nhật độc lập với site.
  - Test trigger bảo vệ `conversations.workspace_id`: Chặn UPDATE `workspace_id` một khi đã có giá trị; chặn gán `workspace_id` vào hội thoại legacy; cho phép UPDATE bình thường nếu cả OLD và NEW đều có `workspace_id IS NULL`.

- [ ] **Step 1.2: Chạy test để Parent Codex ghi nhận RED**
  Command:
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/db/jira-workspace-migration.test.ts
  ```
  Kỳ vọng: FAIL vì chưa có file `db/v3/0015_jira_workspaces.sql`.

- [ ] **Step 1.3: Tạo file migration `db/v3/0015_jira_workspaces.sql`**
  Viết mã SQL idempotent hoàn chỉnh đáp ứng toàn bộ đặc tả ở trên.

- [ ] **Step 1.4: Chạy test để Parent Codex ghi nhận GREEN**
  Command:
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/db/jira-workspace-migration.test.ts
  ```
  Kỳ vọng: PASS toàn bộ các bài kiểm tra idempotence, composite FK, dual active unique index và trigger.

---

### Task 2: Workspace Repository Core, Invites & CAS Membership

**Mục tiêu:** Xây dựng các sub-repositories: `workspace-core-repo.ts`, `workspace-membership-repo.ts`, `workspace-invite-repo.ts`, `workspace-audit-repo.ts` và façade `index.ts`. Xử lý tạo workspace kèm bootstrap admin, invite token 256-bit (hash-only), gia nhập kiểm tra tài khoản Atlassian server-side, và giải quyết tranh chấp duyệt thành viên bằng SQL CAS thực tế với hai client PostgreSQL cạnh tranh có barrier.

**Files:**
- Create: `apps/chat-api/src/db/repositories/workspace/workspace-core-repo.ts`
- Create: `apps/chat-api/src/db/repositories/workspace/workspace-membership-repo.ts`
- Create: `apps/chat-api/src/db/repositories/workspace/workspace-invite-repo.ts`
- Create: `apps/chat-api/src/db/repositories/workspace/workspace-audit-repo.ts`
- Create: `apps/chat-api/src/db/repositories/workspace/index.ts`
- Modify: `apps/chat-api/src/db/repositories/index.ts`
- Create: `apps/chat-api/tests/db/jira-workspace-repo.test.ts`

**Chi tiết thuật toán CAS & Concurrency Locks:**
1. Khóa cấp workspace chung: `SELECT id, status, version FROM ati_workspaces WHERE id = $1 FOR UPDATE`.
2. Re-validate tư cách admin của actor sau khi chờ khóa:
   `SELECT role, status FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`.
   Nếu actor không còn là `admin` hoặc `status !== 'active'` -> Throw `WorkspaceRepoError(403, 'ADMIN_REQUIRED')` (hoặc 404 cho loser trong mutual remove race). Admin actor bắt buộc phải duy trì trạng thái active sau khi chờ khóa workspace (yêu cầu chuẩn tắc đang được kiểm thử).
3. Khóa hàng target: `SELECT * FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`.
4. Guards:
   - Self-approve guard: `actorId === targetUserId && decision === 'approve'` -> Throw `409 'SELF_APPROVE_FORBIDDEN'`.
   - Self-role-elevate guard: actor không thể tự nâng quyền.
   - Last Active Admin guard: Nếu target là admin và decision là `remove`:
     `SELECT count(*)::int AS count FROM ati_workspace_memberships WHERE workspace_id = $1 AND role = 'admin' AND status = 'active' AND user_id != $2`.
     Nếu `count < 1` -> Throw `WorkspaceRepoError(409, 'LAST_ACTIVE_ADMIN')`.
5. CAS UPDATE:
   ```sql
   UPDATE ati_workspace_memberships
   SET status = $1, version = version + 1, decided_at = clock_timestamp(), decided_by = $2, updated_at = clock_timestamp()
   WHERE workspace_id = $3 AND user_id = $4 AND version = $5 AND status = $6
   RETURNING *;
   ```
   Nếu `rows affected === 0`: Throw `WorkspaceRepoError(409, 'STALE_VERSION')`.
6. Audit log: Lưu allowlisted metadata qua `workspace-audit-repo.ts`.
7. Metadata-only listing: `listWorkspacesForUser(userId: string): Promise<WorkspaceSummary[]>`: Trả về danh sách tóm tắt metadata chỉ gồm các workspace mà chính người gọi có tư cách thành viên ở cả 4 trạng thái (`active`, `pending`, `rejected`, `removed`) trong các workspace đang `active`. Không trả về directory các workspace không liên quan. Mọi thao tác trên site, project, nội dung và hội thoại đều bắt buộc tư cách thành viên `active`.

**Chi tiết Invite Lifecycle & Monotonic Rejoin:**
- `createInvite(workspaceId: string, actorId: string, req?: CreateInviteRequest): Promise<CreateInviteResponse>`: Nhận request object tùy chọn `expiresInDays?`, sinh 32 bytes `crypto.randomBytes(32).toString('hex')`. Lưu SHA-256 hash trong `token_hash`. Plaintext token chỉ trả về một lần duy nhất tại top-level DTO `CreateInviteResponse`.
- `decideMember(workspaceId: string, actorId: string, targetUserId: string, req: MemberDecisionRequest): Promise<MemberDecisionResponse>`: Nhận `expectedVersion` và `decision: 'approve' | 'reject' | 'remove'`. Trả về `MemberDecisionResponse: { status, version }`.
- `joinWorkspaceWithInvite`:
  - Kiểm tra caller có hàng `jira_accounts` với `status = 'connected'` ở DB. Nếu không -> Reject `WorkspaceRepoError(403, 'ACCOUNT_NOT_CONNECTED')`.
  - Khóa cấp workspace và kiểm tra: Workspace phải `active`.
  - Sau khi nhận toàn bộ các khóa (lock waits), kiểm tra tươi hạn sử dụng invite bằng `clock_timestamp()` trong SQL: `revoked_at IS NULL AND expires_at > clock_timestamp()`. Nếu không khớp -> Reject 404 (Hidden).
  - Tra cứu membership hiện tại của user:
    - Nếu đã `active`: Trả về `{ outcome: 'already_active', workspaceId }`, DB giữ nguyên `active` (không hạ cấp). Tầng HTTP map sang 409 `already_member`.
    - Nếu đã `pending`: Trả về `{ outcome: 'pending', workspaceId, requestId }`. Tầng HTTP map sang 200/201 pending idempotent.
    - Nếu `rejected` hoặc `removed`:
      - So sánh timestamp độ chính xác SQL: `invite.created_at > membership.decided_at` (sử dụng toán tử so sánh timestamp SQL, không dùng JS Date).
      - Nếu `invite.created_at <= membership.decided_at`: Reject `WorkspaceRepoError(404, 'INVITE_EXPIRED_OR_SUPERSEDED')`.
      - Nếu hợp lệ: Cập nhật `status = 'pending'`, `requested_at = clock_timestamp()`, `version = version + 1`.

- [ ] **Step 2.1: Viết test failing cho 2 Admin cạnh tranh CAS (Barrier) & Last Admin Protection**
  Trong `apps/chat-api/tests/db/jira-workspace-repo.test.ts`:
  - 2 connection pool PG độc lập cạnh tranh CAS trên thành viên pending -> Đúng 1 thành công, đúng 1 nhận 409 `STALE_VERSION`.
  - Mutual remove race: 2 admin đồng thời gỡ bỏ nhau -> Giao dịch 2 sau khi đợi khóa đọc lại actor trong DB thấy mình đã bị remove -> Nhận 404/403 access denied. Query DB xác nhận còn đúng 1 active admin.
  - Sole admin self-remove: Authorized active admin duy nhất tự remove -> Nhận 409 `LAST_ACTIVE_ADMIN`.
  - Tự approve -> Bị từ chối 409 `SELF_APPROVE_FORBIDDEN`.

- [ ] **Step 2.2: Viết test failing cho Invite Lifecycle, Active Duplicate Join & Replay Rejoin**
  - Hash SHA-256 được lưu, không lưu plaintext.
  - Join không có server Atlassian account -> 403.
  - Replay invite cũ sau khi bị reject -> 404/403.
  - Invite mới sinh sau thời điểm reject -> Join thành công pending.
  - Active duplicate join -> Trả về outcome `already_active`, DB giữ nguyên `active` (không hạ cấp).
  - Pending duplicate join -> Trả về outcome `pending` idempotent.

- [ ] **Step 2.3: Chạy test để Parent Codex ghi nhận RED**
  Command:
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/db/jira-workspace-repo.test.ts
  ```
  Kỳ vọng: FAIL vì chưa có `WorkspaceRepo`.

- [ ] **Step 2.4: Triển khai các sub-repositories và Façade `WorkspaceRepo`**
  Tạo các file trong `apps/chat-api/src/db/repositories/workspace/`.

- [ ] **Step 2.5: Chạy test để Parent Codex ghi nhận GREEN**
  Command:
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/db/jira-workspace-repo.test.ts
  ```
  Kỳ vọng: PASS toàn bộ các bài kiểm tra concurrency, CAS, invite và monotonic rejoin.

---

### Task 3: Sites, Projects, Capabilities & Fail-Closed Policy Mapping

**Mục tiêu:** Xây dựng `workspace-site-project-repo.ts` xử lý liên kết site, cập nhật site, cấu hình project và truy vấn capabilities. Triển khai cơ chế Fail-Closed: mọi thao tác cấu hình policy bắt buộc có bằng chứng từ `NativeAdminVerifier` được cấu hình ở repo service. Capabilities trả về 503 cho tới khi JIRA-05 sẵn sàng.

**Files:**
- Create: `apps/chat-api/src/db/repositories/workspace/workspace-site-project-repo.ts`
- Modify: `apps/chat-api/src/db/repositories/workspace/index.ts`
- Modify: `apps/chat-api/tests/db/jira-workspace-repo.test.ts`

**Interface Specifications:**
```typescript
export interface NativeAdminVerifierEvidence {
  actorId: string;
  localAccountId: string;
  atlassianAccountId: string;
  grantId: string;
  identityVersion: number;
  workspaceId: string;
  cloudId: string;
  operation: 'link_site' | 'activate_site' | 'configure_projects';
}

export type NativeAdminVerifierResult =
  | {
      status: 'granted';
      siteName: string;
      siteUrl: string;
      verifiedProjects: Array<{ projectId: string; key: string; name: string }>;
      verifiedProjectIds: string[];
    }
  | { status: 'denied'; reason?: string }
  | { status: 'unavailable'; reason?: string };

export interface NativeAdminVerifier {
  verifyAdminister(evidence: NativeAdminVerifierEvidence): Promise<NativeAdminVerifierResult>;
}

export interface WorkspaceSiteProjectRepoOptions {
  pool: pg.Pool;
  verifier?: NativeAdminVerifier;
}
```

**Quy tắc Fail-Closed & Luồng Xác thực:**
1. Verifier chạy NGOÀI transaction để tránh giữ khóa DB khi thực hiện I/O mạng bên ngoài. Sau khi `await verifier.verifyAdminister(evidence)`, mở transaction và BẮT BUỘC re-validate bộ ba tư cách người dùng (`users.status = 'active'`), tư cách thành viên (`ati_workspace_memberships.role = 'admin'` và `status = 'active'`), và tài khoản Atlassian (`jira_accounts.status = 'connected'`) trước khi ghi nhận thay đổi vào DB.
2. Khởi tạo `WorkspaceRepo` không truyền `verifier` hoặc verifier trả về `unavailable` / `denied`:
   - Mọi thao tác cấu hình policy (`linkSite`, `updateSite(active: true)`, `configureProjects`) BẮT BUỘC bị từ chối (503 khi verifier unavailable/chưa cấu hình sau khi đã qua kiểm tra hợp lệ ATI/account/grant; 403 khi verifier denied).
   - TUYỆT ĐỐI KHÔNG tạo bản ghi inactive site khi thiếu verifier. Chỉ khi verifier được cấu hình và trả về `status: 'granted'` với đầy đủ bằng chứng thì `linkSite` mới tạo bản ghi site ở trạng thái ban đầu `active = false`.
3. Deactivation (`updateSite(active: false)`): Được phép thực hiện bởi ATI workspace admin mà không cần verifier (fail-closed safe, thu hồi quyền ngay lập tức).
4. `configureProjects`:
   - Xác thực `selectedProjectIds` chỉ chứa chuỗi số dương (`/^[1-9][0-9]*$/`), không chứa wildcard (`*`) hoặc project key.
   - Kiểm tra các project IDs được chọn bắt buộc phải nằm trong `verifiedProjectIds` do verifier cung cấp; nhãn project tin cậy được lấy từ `verifiedProjects: { projectId, key, name }[]`, tuyệt đối không chế nhãn từ client.
   - CAS update trên `ati_workspace_jira_sites` với `expectedPolicyVersion`.
   - Cập nhật cờ `selected` và tăng `policy_version > 0` riêng biệt trên từng project row được sửa đổi.
5. `getCapabilities`:
   - Trả về lỗi `WorkspaceRepoError(503, 'CAPABILITIES_UNAVAILABLE')` cho tới khi JIRA-05 hoàn thành; không trả về mảng rỗng `[]` giả mạo trạng thái sẵn sàng.

- [ ] **Step 3.1: Viết test failing cho Fail-Closed Site/Project & Capabilities 503**
  Bổ sung vào `apps/chat-api/tests/db/jira-workspace-repo.test.ts`:
  - Cấu hình repo không có verifier -> `linkSite` bị từ chối (503), tuyệt đối không tạo bản ghi inactive site; `updateSite(active: true)` bị reject 503; `configureProjects` bị reject 503.
  - Verifier trả về `denied` -> `linkSite`, `activate`, `configureProjects` bị reject 403.
  - Deactivation `updateSite(active: false)` thành công mà không cần verifier (an toàn thu hồi quyền).
  - Inject test verifier hợp lệ (`status: 'granted'` kèm `verifiedProjects` và `verifiedProjectIds`) -> `linkSite` tạo site `active = false`; sau đó activate và `configureProjects` thành công, `policy_version` của site và project tăng độc lập.
  - Configure project với wildcard hoặc project key -> Reject 400.
  - `getCapabilities` -> Nhận explicit 503 unavailable.

- [ ] **Step 3.2: Chạy test để Parent Codex ghi nhận RED**
  Command:
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/db/jira-workspace-repo.test.ts
  ```
  Kỳ vọng: FAIL tại các assertions mới.

- [ ] **Step 3.3: Triển khai `workspace-site-project-repo.ts` và gắn vào Façade**
  Viết mã nguồn đáp ứng toàn bộ các ràng buộc trên.

- [ ] **Step 3.4: Chạy test để Parent Codex ghi nhận GREEN**
  Command:
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/db/jira-workspace-repo.test.ts
  ```
  Kỳ vọng: PASS toàn bộ các bài kiểm tra site/project fail-closed.

---

### Task 4: Conversation Access Module & Scoped Route Guards

**Mục tiêu:** Xây dựng mô đun `conversation-access.ts` tập trung kiểm soát quyền truy cập hội thoại, cập nhật `ConversationRepo`, và áp dụng guard cho mọi đường dẫn chạm tới conversation trong `conversation-routes.ts`, `stream-routes.ts`, `execution-routes.ts`, và `schedule-routes.ts`. Thiết lập ranh giới sẵn sàng cho HTTP conversation creation: 503 mặc định ở production; chỉ mở qua internal server option trong test fixture.

**Files:**
- Create: `apps/chat-api/src/auth/conversation-access.ts`
- Modify: `apps/chat-api/src/db/repositories/conversation-repo.ts`
- Modify: `apps/chat-api/src/routes/conversation-routes.ts`
- Modify: `apps/chat-api/src/routes/stream-routes.ts`
- Modify: `apps/chat-api/src/routes/execution-routes.ts`
- Modify: `apps/chat-api/src/routes/schedule-routes.ts`
- Create: `apps/chat-api/tests/routes/jira-workspace-conversations.test.ts`

**Specification `conversation-access.ts`:**
```typescript
export interface AccessibleConversation {
  id: string;
  user_id: string;
  workspace_id: string | null;
  status: string;
  title: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function assertConversationAccess(
  pool: pg.Pool,
  conversationId: string,
  userId: string
): Promise<AccessibleConversation>;
```
- Query kết hợp kiểm tra:
  ```sql
  SELECT c.*
  FROM conversations c
  LEFT JOIN ati_workspace_memberships m
    ON m.workspace_id = c.workspace_id AND m.user_id = $2 AND m.status = 'active'
  LEFT JOIN ati_workspaces w
    ON w.id = c.workspace_id AND w.status = 'active'
  WHERE c.id = $1 AND c.user_id = $2
    AND (c.workspace_id IS NULL OR (m.user_id IS NOT NULL AND w.id IS NOT NULL));
  ```
  Nếu không tìm thấy hàng -> Ném `ConversationNotFoundError` (HTTP 404).
- Missing authority checker không được phép tự động hạ cấp hàng scoped đã biết về legacy: chỉ bản ghi có lưu trữ `workspace_id IS NULL` thực sự kèm metadata legacy và quyền owner mới được phép đi theo nhánh memory legacy, mọi trường hợp khác trả về 404. Không tuyên bố in-flight SSE/model authorization lease đã hoàn thành trong JIRA-03.

**Quy tắc Guarding across All Scoped Routes:**
1. `conversation-routes.ts`:
   - `POST /api/conversations`:
     Nếu có `workspaceId`:
     Kiểm tra `options.enableWorkspaceConversations`. Nếu `false` (mặc định production) -> Trả về HTTP 503 `{ code: 'WORKSPACE_CONVERSATIONS_UNAVAILABLE', error: 'Tính năng hội thoại workspace cần JIRA-05/08 hoàn tất tích hợp.' }`.
     Nếu `true` (chỉ dùng làm foundation fixture test option, không phải cờ môi trường production, không có dev bypass): Mở transaction, khóa `ati_workspaces` và `ati_workspace_memberships` `FOR SHARE`, kiểm tra active membership, rồi INSERT. Nếu không active -> 404.
     Nếu không có `workspaceId`: Tạo conversation legacy NULL bình thường (201).
   - `GET /api/conversations`: `listConversationPage` lọc `WHERE c.user_id = $1 AND (c.workspace_id IS NULL OR EXISTS (SELECT 1 FROM ati_workspace_memberships m JOIN ati_workspaces w ON w.id = m.workspace_id WHERE m.workspace_id = c.workspace_id AND m.user_id = $1 AND m.status = 'active' AND w.status = 'active'))`.
   - `GET /api/conversations/:id`, `PATCH /api/conversations/:id`, `GET /api/conversations/:id/plans/active`, `GET /api/conversations/:id/messages/latest`, `POST /api/conversations/:id/messages`: Dùng `assertConversationAccess`.
2. `stream-routes.ts`:
   - `GET /api/conversations/:id/stream`: Dùng `assertConversationAccess` trước khi gửi headers SSE.
3. `execution-routes.ts`:
   - `GET /api/conversations/:convId/executions/latest`: Dùng `assertConversationAccess`.
   - `POST /api/plans/:id/approve`, `POST /api/plans/:id/reject`: Tra cứu conversation của plan và kiểm tra `assertConversationAccess`.
4. `schedule-routes.ts`:
   - `POST /api/conversations/:convId/schedule-proposals/:messageId/{confirm,reject,dismiss}`: Dùng `assertConversationAccess`.

- [ ] **Step 4.1: Viết test failing cho kiểm soát quyền hội thoại & availability boundary**
  Tạo `apps/chat-api/tests/routes/jira-workspace-conversations.test.ts`:
  - Khởi tạo Express app production mặc định: `POST /api/conversations` với `workspaceId` -> Nhận HTTP 503 `WORKSPACE_CONVERSATIONS_UNAVAILABLE`.
  - Khởi tạo Express app với option `{ enableWorkspaceConversations: true }`: User A tạo conversation thuộc workspace W1 -> Thành công 201.
  - `POST /api/conversations` không có `workspaceId` -> Thành công 201 ở cả 2 chế độ.
  - User B (thuộc W2) cố tạo conversation trong W1 -> 404.
  - User B cố truy cập conversation của User A -> 404.
  - User A bị remove khỏi W1:
    - `GET /api/conversations` của User A -> Không hiện conversation W1.
    - `GET /api/conversations/:id` -> 404.
    - `GET /api/conversations/:id/stream` -> 404.
    - `GET /api/conversations/:id/plans/active` -> 404.
    - `POST /api/plans/:id/approve` -> 404.
    - `POST /api/conversations/:id/messages` -> 404.
  - Hội thoại legacy (`workspace_id IS NULL`): User A và mọi route hoạt động bình thường theo quy tắc cũ.

- [ ] **Step 4.2: Chạy test để Parent Codex ghi nhận RED**
  Command:
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/routes/jira-workspace-conversations.test.ts
  ```
  Kỳ vọng: FAIL vì chưa có `conversation-access.ts` và chưa cập nhật các route.

- [ ] **Step 4.3: Triển khai `conversation-access.ts` và cập nhật các route handlers**
  Viết mã và áp dụng guard.

- [ ] **Step 4.4: Chạy test để Parent Codex ghi nhận GREEN**
  Command:
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/routes/jira-workspace-conversations.test.ts
  ```
  Kỳ vọng: PASS toàn bộ các bài kiểm tra guard hội thoại.

---

### Task 5: HTTP API Routes, System Admin Recovery & Express Wiring

**Mục tiêu:** Xây dựng router `apps/chat-api/src/routes/workspace-routes.ts`, liên kết vào `app.ts` và `server.ts`, cung cấp đầy đủ các endpoint theo đúng hợp đồng DTO từ `packages/tool-schemas` (`myjira-dto.ts`).

**Files:**
- Create: `apps/chat-api/src/routes/workspace-routes.ts`
- Modify: `apps/chat-api/src/app.ts`
- Modify: `apps/chat-api/src/server.ts`
- Create: `apps/chat-api/tests/routes/jira-workspaces.test.ts`

**Endpoints & DTO Mapping:**
- Canonical public facade requests/responses import shared schemas từ `@wap/tool-schemas` (`myjira-dto.ts`):
  - `POST /api/admin/workspaces`: Body `CreateWorkspaceRequest: { name, slug, bootstrapAdminUserId }` (System Admin) -> Response `CreateWorkspaceResponse: { workspace: { id, name, slug, version } }`.
  - `POST /api/workspaces/:id/invites`: Body `CreateInviteRequest: { expiresInDays? }` (optional object) -> Response `CreateInviteResponse: { inviteToken, id, workspaceId, expiresAt, createdAt }` (direct top-level DTO).
  - `POST /api/workspace-join-requests`: Body `WorkspaceJoinRequest: { inviteToken }` -> Khi thành công: `WorkspaceJoinResponse: { requestId, workspaceId, status: 'pending' }`; khi caller đã là active member: HTTP 409 `{ code: 'ALREADY_WORKSPACE_MEMBER', error: 'Bạn đã là thành viên hoạt động của workspace này.' }` (DB active giữ nguyên).
  - `POST /api/workspaces/:id/members/:userId/decision`: Body `MemberDecisionRequest: { expectedVersion, decision }` -> Response `MemberDecisionResponse: { status, version }`.
  - `GET /api/workspaces`: Authenticated user -> Response `GetWorkspacesResponse: { workspaces: WorkspaceSummary[] }` (mỗi `WorkspaceSummary` chứa `id, name, slug, membershipStatus, role, version, createdAt, updatedAt` phản ánh tư cách thành viên của chính người gọi ở cả 4 trạng thái trong workspace active).
  - `GET /api/workspaces/:id/members`: Workspace Admin -> Response `ListWorkspaceMembersResponse`.
  - `GET /api/workspaces/:id/invites`: Workspace Admin -> Response `ListWorkspaceInvitesResponse` (secret-free).
  - `DELETE /api/workspaces/:id/invites/:inviteId`: Workspace Admin -> Response `RevokeInviteResponse`.
  - `GET /api/workspaces/:id/jira-sites`: Active Member -> Response `ListWorkspaceSitesResponse`.
  - `POST /api/workspaces/:id/jira-sites`: Workspace Admin -> Response `LinkWorkspaceSiteResponse`.
  - `PATCH /api/workspaces/:id/jira-sites/:siteId`: Workspace Admin -> Response `UpdateWorkspaceSiteResponse`.
  - `GET /api/workspaces/:id/jira-sites/:siteId/projects`: Active Member -> Response `GetWorkspaceProjectsResponse`.
  - `PUT /api/workspaces/:id/jira-sites/:siteId/projects`: Workspace Admin -> Response `ConfigureWorkspaceProjectsResponse`.
  - `GET /api/workspaces/:id/jira-capabilities`: Active Member -> 503 (`CAPABILITIES_UNAVAILABLE`).
- Hợp đồng nội bộ Backend cho archive/recovery (chưa có trong shared schemas, ghi nhận tài liệu phục vụ UI tương lai):
  - `POST /api/admin/workspaces/:id/archive`: System Admin only, Body `ArchiveWorkspaceRequest: { expectedVersion: number }` -> Response `ArchiveWorkspaceResponse: { archived: true }`.
  - `POST /api/admin/workspaces/:id/recover-admin`: System Admin only, Body `RecoverWorkspaceAdminRequest: { expectedVersion: number, newAdminUserId: string }` -> Response `RecoverWorkspaceAdminResponse: { recovered: true }`.

- [ ] **Step 5.1: Viết test failing cho toàn bộ HTTP API Routes**
  Tạo `apps/chat-api/tests/routes/jira-workspaces.test.ts`:
  - User thường gọi `POST /api/admin/workspaces` -> 403 Forbidden.
  - System Admin gọi `POST /api/admin/workspaces` -> 201 Created.
  - `GET /api/workspaces`: User chỉ thấy workspace mình tham gia.
  - `POST /api/workspaces/:id/invites`: Admin tạo invite -> Nhận `inviteToken`.
  - `GET /api/workspaces/:id/invites`: Không chứa trường `token_hash` hay `inviteToken`.
  - Người ngoài gọi `GET /api/workspaces/:id/members` -> 404 Not Found (Hidden Privacy Pattern).
  - Join flow: Không có account Atlassian ở server -> 403; Có account join hợp lệ -> 201 pending; Đã active gọi lại join -> 409 `ALREADY_WORKSPACE_MEMBER`.
  - CAS decision qua HTTP: Gửi stale version -> 409 Conflict.
  - Unverified site activation qua HTTP -> 403 Forbidden.

- [ ] **Step 5.2: Chạy test để Parent Codex ghi nhận RED**
  Command:
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/routes/jira-workspaces.test.ts
  ```
  Kỳ vọng: Test FAIL (404 trên các router chưa đăng ký).

- [ ] **Step 5.3: Triển khai router và gắn kết vào Express**
  - Tạo `apps/chat-api/src/routes/workspace-routes.ts`.
  - Cập nhật `apps/chat-api/src/app.ts`: Mount `/api/workspaces`, `/api/admin/workspaces`, `/api/workspace-join-requests`.
  - Cập nhật `apps/chat-api/src/server.ts`: Khởi tạo `WorkspaceRepo` và truyền vào `createApp`.

- [ ] **Step 5.4: Chạy test để Parent Codex ghi nhận GREEN**
  Command:
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/routes/jira-workspaces.test.ts
  ```
  Kỳ vọng: PASS toàn bộ các bài kiểm tra route.

---

### Task 6: System Verification, Full Check & Mutation Guards

**Mục tiêu:** Thực hiện kiểm tra toàn diện: typecheck toàn monorepo, chạy trọn vẹn bộ test suite v3 trên test database cổng 56534 hoặc CI loopback 5432, kiểm thử mutation bắt lỗi, bảo đảm không có hồi quy đối với catalog 33 tools và 8 services.

- [ ] **Step 6.1: Chạy kiểm tra Typecheck monorepo**
  Command:
  ```bash
  npm run typecheck:v3
  ```
  Kỳ vọng: exit code 0.

- [ ] **Step 6.2: Chạy kiểm tra tổng hợp gói `apps/chat-api` trên DB 56534 hoặc CI loopback 5432**
  Command:
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/db/jira-workspace-migration.test.ts tests/db/jira-workspace-repo.test.ts tests/routes/jira-workspaces.test.ts tests/routes/jira-workspace-conversations.test.ts
  ```
  Kỳ vọng: 4 test files, 100% test cases PASS, exit code 0.

- [ ] **Step 6.3: Chạy Mutation Testing độc lập để chứng minh hiệu lực của Guards**
  Runtime SQL fixtures nạp ĐẦY ĐỦ các migration hiện hành; các test lịch sử (0004/0006) dùng SQL thô cô lập để không bypass schema. Parent Codex thử nghiệm 6 đột biến có chủ đích (mỗi lần test xong phục hồi nguyên trạng):
  1. *Mutation 1:* Xóa bỏ kiểm tra `jira_accounts` khi join -> Test phải FAIL.
  2. *Mutation 2:* Đổi `clock_timestamp()` thành `now()` hoặc bỏ kiểm tra `invite.created_at > membership.decided_at` -> Test monotonic rejoin phải FAIL.
  3. *Mutation 3:* Bỏ qua kiểm tra `count < 1` của `LAST_ACTIVE_ADMIN` trong `decideMember` -> Test phải FAIL.
  4. *Mutation 4:* Bỏ qua kiểm tra verifier khi PATCH `active: true` trên Jira site -> Test phải FAIL.
  5. *Mutation 5:* Cho phép UPDATE `conversations.workspace_id` trong trigger PostgreSQL -> Test phải FAIL.
  6. *Mutation 6:* Trả về 403 thay vì 404 khi truy cập workspace hoặc conversation không thuộc quyền -> Test phải FAIL.

- [ ] **Step 6.4: Chạy Full Check toàn bộ hệ thống**
  Command:
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" npm run check
  ```
  Kỳ vọng: Toàn bộ suite test monorepo v3 PASS, catalog giữ nguyên 33 tools và 8 services.

- [ ] **Step 6.5: Cập nhật Task Card kết quả và tạo handoff log**
  - Điền mục "Kết quả" trong `docs/handoff/tasks/JIRA-03-workspaces.md`.
  - Tạo một file log mới duy nhất: `docs/handoff/log/2026-11-01-backend-jira-03-workspaces.md`.
  - Tuyệt đối không chỉnh sửa `docs/handoff/CURRENT-STATE.md` và `docs/handoff/ROADMAP.md`.
