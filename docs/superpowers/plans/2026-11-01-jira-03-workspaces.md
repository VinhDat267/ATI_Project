# JIRA-03 · Workspace DB & API Implementation Plan (Tích hợp Workspace Tổ chức Chung)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Parent Codex runs commands and captures real test output before and after each phase.

**Goal:** Xây dựng hạ tầng cơ sở dữ liệu PostgreSQL (migration `0018_jira_workspaces.sql`) tích hợp trên nền migration `0015_workspaces.sql` của PR #237 (`2c62565f`), repository nghiệp vụ mô đun hóa (`WorkspaceRepo` façade), API routes quản trị workspace ATI, lời mời 256-bit lưu băm SHA-256, gia nhập qua danh tính Atlassian server-side và thành viên tổ chức, kiểm tra đồng thời hai lớp quyền (tổ chức + Jira), SQL CAS duyệt thành viên chống write-skew/race condition, cô lập toàn diện mọi đường dẫn hội thoại theo cờ bền vững `jira_context` và workspace bất biến, và chính sách fail-closed cho liên kết Jira site/project.

**Architecture:** Áp dụng mô hình kiến trúc phân lớp sạch (Clean Architecture) kết hợp thiết kế Workspace tổ chức chung (Quyết định ngày 02/11/2026):
- Tầng lưu trữ PostgreSQL: `ati_workspaces` là **phần mở rộng chính sách (policy extension)** có khóa chính đồng thời là khóa ngoại tham chiếu `workspaces(id)` từ PR #237 (cùng một UUID, không sinh tổ chức thứ hai); `conversations.jira_context` là cờ boolean bền vững phân định hội thoại Jira và hội thoại tổ chức thông thường; trigger SQL bảo vệ tính bất biến; thứ tự khóa deterministic (`JIRA_SQL_LOCK_HIERARCHY`) chống deadlock.
- Tầng Repository mô đun hóa: `WorkspaceRepo` façade kết hợp các sub-repositories: `workspace-core-repo` (tạo atomic org+Jira, enable Jira cho org hiện hữu, archive, recovery, listing), `workspace-membership-repo` (CAS hai lớp quyền, last-admin guard), `workspace-invite-repo` (invite hash-only, monotonic clock rejoin, ràng buộc thành viên tổ chức), `workspace-site-project-repo` (fail-closed verifier), `workspace-audit-repo` (allowlisted audit).
- Tầng kiểm soát truy cập hội thoại tập trung: `conversation-access.ts` bảo vệ toàn diện các routes API, Stream, Execution và Schedule; phân biệt hội thoại Jira (kiểm tra cả hai lớp quyền) và hội thoại tổ chức thông thường (chỉ kiểm tra quyền tổ chức).
- Tầng HTTP API: Các endpoints quản trị Jira được tách biệt tại `/api/jira-workspaces`, `/api/admin/jira-workspaces`, `/api/jira-workspace-join-requests`, bảo lưu hoàn toàn API `/api/workspaces` của PR #237.

**Tech Stack:** Node.js `^22.12.0 || >=24.0.0`, TypeScript 5.6+, Express 5, PostgreSQL (`pg` pool, `clock_timestamp()`, row-level locks), Vitest, Supertest, crypto native.

**Specs:**
- Bổ sung thiết kế tích hợp: [`docs/superpowers/specs/2026-11-02-jira-shared-workspace-amendment.md`](../specs/2026-11-02-jira-shared-workspace-amendment.md) (Quyết định ngày 02/11/2026 của chủ dự án).
- Thiết kế Jira cá nhân và workspace ATI: [`docs/superpowers/specs/2026-10-30-jira-personal-workspaces-design.md`](../specs/2026-10-30-jira-personal-workspaces-design.md) (Mục 4–9 và 11).
- Thiết kế Đa Workspace Tổ chức (PR #237): [`docs/superpowers/specs/2026-11-01-personal-and-workspace-auth-design.md`](../specs/2026-11-01-personal-and-workspace-auth-design.md).

**Task Card:** [`docs/handoff/tasks/JIRA-03-workspaces.md`](../../handoff/tasks/JIRA-03-workspaces.md).

---

## Kết quả thực thi 02/11/2026

- [x] Tasks 1–5: schema cùng UUID, repository/quyền hai lớp, site/project, hội thoại và API tích hợp trên main #237.
- [x] Task 6 local: migrations 0001–0017, typecheck và npm run check exit 0 (3.309 v3 + 406 eval + các kiểm tra Node/launcher/build).
- [x] 14/14 đột biến: control xanh, assertion bắt mutant, khôi phục byte/SHA và control xanh lại; ba review môđun độc lập PASS/APPROVED.
- [x] Điền kết quả task card và một nhật ký mới: docs/handoff/log/2026-11-02-jira-03-shared-workspaces.md.
- [ ] Review toàn nhánh mới và CI/browser đúng head cuối; ghi kết quả vào PR sau push.
- [ ] Chủ dự án review/merge; không tự merge, không bắt đầu JIRA-04.

Các bước bên dưới giữ kịch bản TDD để đối chiếu; kết quả và giới hạn cuối nằm trong task card/nhật ký. Bằng chứng trước #237 chỉ là baseline lịch sử.

## Global Constraints

1. **Bảo mật Bí mật Lời mời (Zero Secret Leakage):** Invite token sinh ngẫu nhiên cryptographically secure 256-bit (`crypto.randomBytes(32)`). Cơ sở dữ liệu CHỈ lưu SHA-256 hash trong cột `token_hash`. Plaintext token chỉ trả về một lần duy nhất tại response `POST /api/jira-workspaces/:id/invites`. Tuyệt đối không echo token trong list, get, DTOs hay logs.
2. **Xác thực Danh tính Thật & Ràng buộc Thành viên Tổ chức khi Gia nhập Jira:** Endpoint gia nhập `POST /api/jira-workspace-join-requests` bắt buộc kiểm tra:
   - Bản ghi `jira_accounts` có trạng thái `connected` thuộc sở hữu của caller ở server. Tuyệt đối không tin cậy `accountId` do client gửi lên.
   - Caller phải đang là thành viên `active` của tổ chức nền tảng (`workspace_members.status = 'active'`). Người ngoài tổ chức không được phép xin vào lớp Jira của tổ chức đó (trả về 404 Hidden hoặc 403).
   - Duplicate join của active Jira member giữ nguyên DB active và HTTP trả về stable 409 `already_member`; duplicate join của pending member trả về idempotent 200/201 pending.
3. **Bảo vệ Danh tính Kép (Dual Active Account Index):** Bảng `jira_accounts` áp dụng hai chỉ số partial unique độc lập khi `status = 'connected'`: trên `user_id` và trên `atlassian_account_id`. Không cho phép cùng 1 Atlassian identity active bị gán cho 2 người ATI khác nhau.
4. **Chính sách Fail-Closed cho Jira Site & Project Mutations:** Mọi thao tác cấu hình policy (link site, activate site, configure projects) bắt buộc có bằng chứng xác minh quyền native ADMINISTER từ Atlassian thông qua `NativeAdminVerifier` được cấu hình ở cấp repo/service. Khi thiếu verifier hoặc verifier từ chối/unavailable, hệ thống BẮT BUỘC từ chối (503 khi verifier unavailable/chưa cấu hình sau khi đã qua kiểm tra hợp lệ ATI/account/grant; 403 khi verifier denied); tuyệt đối không tạo bản ghi inactive site khi thiếu verifier. Chỉ liên kết ĐÃ XÁC MINH (trusted verified link) mới tạo bản ghi site ở trạng thái ban đầu `active = false`. Deactivation an toàn không cần provider (fail-closed safe). Capability directory trả về explicit 503, không trả danh sách rỗng `[]` giả mạo trạng thái sẵn sàng.
5. **Project Policy Version Độc lập & Composite FK:** Mỗi project row có `policy_version > 0` riêng biệt (độc lập với site policy version). Bảng `ati_workspace_jira_projects` áp dụng composite foreign key `(workspace_id, site_id, cloud_id)` tham chiếu `ati_workspace_jira_sites(workspace_id, id, cloud_id)` để đảm bảo tính toàn vẹn bộ ba.
6. **Định danh Tổ chức Duy nhất & Quyền Hai Lớp (Shared Organization Identity & Dual-Layer Authority):**
   - `workspaces.id` của PR #237 là định danh tổ chức duy nhất. `ati_workspaces` có `id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE`. Không tự sinh UUID hoặc tổ chức thứ hai. Tên tổ chức đọc từ `workspaces.name`.
   - Thành viên tổ chức và quyền Jira là hai điều kiện đồng thời: Mọi thao tác Jira yêu cầu caller active trong `users`, active trong `workspace_members`, và active trong `ati_workspace_memberships`. Quản trị Jira yêu cầu thêm role `admin` trong `ati_workspace_memberships`.
   - Mã mời tổ chức, `require_approval = false` của tổ chức, vai trò admin tổ chức hay admin hệ thống KHÔNG tự động cấp quyền Jira.
   - Gỡ hoặc khóa thành viên trong `workspace_members` lập tức chặn quyền Jira, ngay cả khi `ati_workspace_memberships` vẫn còn active.
7. **Ranh giới Sẵn sàng cho Tạo Hội thoại & Cờ Bền vững `jira_context`:**
   - Cột `conversations.jira_context BOOLEAN NOT NULL DEFAULT false` chỉ hợp lệ khi `workspace_mode = 'organization'` và `workspace_id IS NOT NULL`.
   - Cột `jira_context`, `workspace_id`, và `workspace_mode` là bất biến sau khi tạo (trigger SQL chặn mọi sửa đổi). Không nâng cấp hội thoại legacy/personal/tổ chức cũ thành hội thoại Jira.
   - Header `X-Workspace-Id` truyền UUID tổ chức. Yêu cầu bật ngữ cảnh Jira là opt-in `jiraContext: true` trong request body.
   - Public HTTP `POST /api/conversations` kèm `jiraContext: true` trả về explicit HTTP 503 `WORKSPACE_CONVERSATIONS_UNAVAILABLE` trong môi trường production mặc định (vì việc bảo vệ in-flight model/persist/SSE thuộc về JIRA-05/08).
   - Tầng repository `createConversation` hỗ trợ tạo transactional đầy đủ với cờ `jira_context` và được kiểm thử; kiểm thử tích hợp HTTP cho tạo conversation có Jira context sử dụng tùy chọn internal server `enableWorkspaceConversations: true` (chỉ là foundation fixture test option, không phải cờ production, không tạo dev bypass).
   - Hội thoại tổ chức thông thường (`jiraContext: false` hoặc không truyền) chỉ kiểm tra quyền tổ chức (`workspace_members`), hoàn toàn không bị ảnh hưởng bởi việc bật/tắt Jira.
   - Mọi đường dẫn truy cập hội thoại Jira (API routes, SSE stream, execution reload/approval, schedule proposals) đều kiểm tra quyền caller là owner VÀ active member ở cả hai lớp (tổ chức + Jira). Người dùng không đủ quyền nhận 404 Not Found (Hidden Privacy Pattern).
   - Missing authority checker không được phép tự động hạ cấp hàng scoped đã biết về legacy: chỉ bản ghi có lưu trữ `workspace_id IS NULL` thực sự kèm metadata legacy và quyền owner mới được phép đi theo nhánh memory legacy, mọi trường hợp khác trả về 404.
8. **Đồng bộ Hóa và Khóa PostgreSQL (Deterministic Lock Protocol):** Thao tác thu hồi (revocation) và quyết định thành viên tuân thủ thứ tự khóa deterministic:
   `workspaces` → `ati_workspaces` → `workspace_members` → `ati_workspace_memberships` → `jira_accounts` → `ati_workspace_jira_sites` → `ati_workspace_jira_projects`.
   Tránh write-skew quản trị viên cuối cùng bằng transaction-level lock trên workspace (`workspaces` & `ati_workspaces FOR UPDATE`). CAS bắt buộc dùng câu lệnh `UPDATE ... WHERE status = ... AND version = ...` thật với kiểm tra thẩm quyền bên trong transaction sau lock wait (admin actor bắt buộc phải duy trì trạng thái active ở cả hai lớp sau khi chờ khóa workspace). Khi 2 admin cùng remove nhau, người thua sau khi chờ khóa thấy actor đã bị remove nhận 404/403 access denied (chính xác 1 winner, >= 1 active admin còn lại); test riêng cho sole active admin tự xóa nhận 409 LAST_ACTIVE_ADMIN.
9. **Môi trường Kiểm thử PostgreSQL Độc lập:** Toàn bộ test integration chạy trên instance PostgreSQL chuyên dụng cổng local `56534` hoặc CI loopback `5432` (database `ati_v3`) được cung cấp qua biến môi trường `DATABASE_URL` / `TEST_DATABASE_URL`, TUYỆT ĐỐI KHÔNG dùng database runtime `55533` và không fallback về default DB ngầm định. Không nhúng mật khẩu thực tế vào code. Test helper ném lỗi nếu phát hiện port 55533, thiếu biến môi trường, hoặc remote host. Runtime SQL fixtures nạp ĐẦY ĐỦ các migration hiện hành (`0001` tới `0016`).
10. **Bảo vệ Cờ Tắt (Flag-Off Invariant):** Không kích hoạt cờ runtime, giữ nguyên `ALL_TOOLS.length === 33` và `SERVICE_REGISTRY.length === 8`. Không gọi mạng ra Atlassian live hoặc gọi LLM model.
11. **Phân tách Route API Rõ Ràng:** Giữ nguyên các endpoints `/api/workspaces` của PR #237. Endpoints JIRA-03 được đặt tại `/api/jira-workspaces`, `/api/admin/jira-workspaces`, `/api/jira-workspace-join-requests`. Listing metadata-only chỉ trả về workspace mà caller có tư cách thành viên Jira ở cả 4 trạng thái (`active`, `pending`, `rejected`, `removed`) trong các workspace Jira đang `active`.

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
4. **Shared Workspace & Jira Context Isolation across Entry Points:**
   *Assertion cụ thể:*
   - Single UUID: Workspace tạo mới có `workspaces.id === ati_workspaces.id`. Không tạo duplicate org.
   - Bật Jira cho org hiện hữu: `POST /api/admin/jira-workspaces/:workspaceId/enable` tạo bản ghi `ati_workspaces` với `id = workspaceId`. Gọi lại lần hai -> 409 Conflict.
   - Tổ chức auto-join (`require_approval = false`): Người dùng vào thẳng tổ chức `status = 'active'`, nhưng KHÔNG tự động có quyền Jira (chưa có bản ghi trong `ati_workspace_memberships`).
   - Gỡ thành viên tổ chức: User bị đổi `workspace_members.status = 'disabled'` -> Mọi thao tác Jira lập tức bị 404/403 dù `ati_workspace_memberships` vẫn là `active`.
   - Hội thoại thông thường của tổ chức (`jira_context = false`): Vẫn truy cập bình thường kể cả khi Jira bị archive hoặc user không có quyền Jira.
   - Public HTTP `POST /api/conversations` có `jiraContext: true` (mặc định production) -> Nhận HTTP 503 `{ code: 'WORKSPACE_CONVERSATIONS_UNAVAILABLE' }`.
   - Với test fixture option `enableWorkspaceConversations: true` -> Tạo conversation có `jira_context = true` thành công 201 Created.
   - Cột `jira_context` là bất biến: Câu lệnh UPDATE cố tình đổi `jira_context` bị trigger chặn với SQLSTATE `23514`.
   *(Kiểm chứng tại Task 4, Step 4.1 & Task 1, Step 1.1)*.
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
│   ├── 0015_workspaces.sql                 # PR #237: Bảng workspaces, workspace_members, conversations.workspace_id
│   └── 0018_jira_workspaces.sql            # Additive migration: ati_workspaces (FK workspaces.id), 8 bảng Jira, conversations.jira_context
├── apps/chat-api/
│   ├── src/
│   │   ├── auth/
│   │   │   └── conversation-access.ts      # Kiểm soát quyền hội thoại hai lớp (tổ chức + jira_context)
│   │   ├── db/
│   │   │   └── repositories/
│   │   │       ├── workspace/              # Phân tách mô đun hóa WorkspaceRepo
│   │   │       │   ├── workspace-core-repo.ts        # Atomic create org+Jira, enable existing org, archive, recovery, listing
│   │   │       │   ├── workspace-membership-repo.ts  # CAS quyết định thành viên, khóa hai lớp, last-admin guard
│   │   │       │   ├── workspace-invite-repo.ts      # Sinh invite 256-bit (hash-only), join ràng buộc Atlassian account + org member
│   │   │       │   ├── workspace-site-project-repo.ts# Site/project config, composite verifier, fail-closed, 503 caps
│   │   │       │   ├── workspace-audit-repo.ts       # Audit log với allowlisted metadata
│   │   │       │   └── index.ts                      # Façade WorkspaceRepo
│   │   │       ├── conversation-repo.ts     # Cập nhật: hỗ trợ jira_context bất biến & lọc listPage an toàn
│   │   │       └── index.ts                 # Export WorkspaceRepo
│   │   ├── routes/
│   │   │   ├── workspace-routes.ts          # Express router: /api/jira-workspaces, /api/admin/jira-workspaces, etc.
│   │   │   ├── conversation-routes.ts       # Cập nhật: 503 availability boundary cho jira_context & conversation-access guard
│   │   │   ├── stream-routes.ts             # Cập nhật: áp dụng conversation-access guard cho SSE stream
│   │   │   ├── execution-routes.ts          # Cập nhật: áp dụng conversation-access guard cho execution entry
│   │   │   └── schedule-routes.ts           # Cập nhật: áp dụng conversation-access guard cho schedule proposals
│   │   ├── app.ts                           # Wire router và middleware (gắn cả /api/workspaces và /api/jira-workspaces)
│   │   └── server.ts                        # Khởi tạo WorkspaceRepo với PG pool
│   └── tests/
│       ├── helpers/
│       │   └── jira-test-db.ts              # Helper DB: nạp migration 0001–0017, hỗ trợ port 56534 hoặc CI 5432 (từ chối 55533)
│       ├── db/
│       │   ├── jira-workspace-migration.test.ts  # Test migration idempotence 0001–0017, trigger bất biến jira_context, composite FKs
│       │   └── jira-workspace-repo.test.ts       # Test CAS concurrency (2 clients + barrier), atomic create, enable existing org
│       └── routes/
│           ├── jira-workspaces.test.ts           # Test API endpoints /api/jira-workspaces, enable org, join preconditions
│           └── jira-workspace-conversations.test.ts # Test cô lập hội thoại jira_context vs org thường, stream, execution, schedule
```

---

## Tasks Thi công Chi tiết

> **Ghi chú về Tiến trình & Bằng chứng Lịch sử:**
> - Các bằng chứng kiểm thử trước merge PR #237 (checkpoint `322d799`, 60/60 DB tests, 134/134 conv tests, 37/37 HTTP tests) được ghi nhận là **BASELINE LỊCH SỬ PRE-237**.
> - Sau khi merge PR #237 (`2c62565f`), 7 conflict files đã được hoàn nguyên về bản của main để lập kế hoạch tích hợp; trạng thái test hiện tại là **UNKNOWN** cho tới khi Parent Codex chạy lại bộ test.
> - Toàn bộ các lệnh kiểm thử sử dụng biến môi trường do hệ thống cung cấp: `DATABASE_URL="$TEST_DATABASE_URL"` trỏ tới PostgreSQL test chuyên dụng cổng local `56534` (hoặc CI loopback `5432` trên database `ati_v3`). Không load `.env`, không dùng default DB fallback ngầm định, và cấm tuyệt đối cổng runtime `55533`.
> - Parent Codex sở hữu Git commits và chạy các lệnh kiểm tra thật; worker không tự ý commit hay chạy lệnh.

---

### Task 1: Additive Migration 0016 & Database Schema Constraints

**Mục tiêu:** Tạo migration file `db/v3/0018_jira_workspaces.sql` tích hợp trên nền `0015_workspaces.sql` của PR #237:
- Định nghĩa bảng `ati_workspaces` là policy extension với `id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE`.
- 8 bảng Jira đi kèm (`ati_workspace_memberships`, `ati_workspace_invites`, `jira_accounts`, `jira_oauth_grants`, `jira_grant_sites`, `ati_workspace_jira_sites`, `ati_workspace_jira_projects`, `jira_authorization_audit`).
- Bổ sung `conversations.jira_context BOOLEAN NOT NULL DEFAULT false` kèm ràng buộc check `CHECK ((jira_context = false) OR (workspace_mode = 'organization' AND workspace_id IS NOT NULL))`.
- Trigger SQL bảo vệ tính bất biến của `jira_context`, `workspace_id`, và `workspace_mode`.
- Các composite foreign keys, partial unique indexes trên `jira_accounts`, và policy version độc lập cho projects.

**Files:**
- Create: `apps/chat-api/tests/helpers/jira-test-db.ts`
- Create: `apps/chat-api/tests/db/jira-workspace-migration.test.ts`
- Create: `db/v3/0018_jira_workspaces.sql`

- [ ] **Step 1.1: Tạo helper `jira-test-db.ts` và viết test failing cho migration**
  Tạo `apps/chat-api/tests/helpers/jira-test-db.ts`: Cho phép `DATABASE_URL` cổng local `56534` hoặc CI loopback `5432` (`ati_v3`), từ chối `55533` và remote host. Nạp toàn bộ migration `0001` tới `0016`.
  Tạo `apps/chat-api/tests/db/jira-workspace-migration.test.ts`:
  - Thực thi toàn bộ migration `0001` tới `0016`.
  - Thực thi migration hai lần liên tiếp -> Kỳ vọng không lỗi (Idempotence).
  - Test `ati_workspaces.id` tham chiếu `workspaces.id`: INSERT vào `ati_workspaces` với UUID không tồn tại trong `workspaces` -> FAIL do vi phạm foreign key.
  - Test real INSERT failure cho `jira_accounts`: Gán cùng 1 `atlassian_account_id` active cho 2 user ATI -> Câu lệnh thứ 2 FAIL do vi phạm `jira_accounts_atlassian_active_idx`.
  - Test composite FK trên `ati_workspace_jira_projects`: Project có `cloud_id` không khớp với `site.cloud_id` -> FAIL do vi phạm `fk_workspace_site_cloud`.
  - Test project policy_version riêng biệt: Project row có `policy_version = 1`, cập nhật độc lập với site.
  - Test trigger bảo vệ `conversations.jira_context`: Chặn UPDATE `jira_context` từ `false` sang `true` hoặc ngược lại; chặn thay đổi `workspace_id` và `workspace_mode`.

- [ ] **Step 1.2: Chạy test để Parent Codex ghi nhận RED**
  Command:
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/db/jira-workspace-migration.test.ts
  ```
  Kỳ vọng: FAIL vì chưa có file `db/v3/0018_jira_workspaces.sql` hoặc schema chưa khớp.

- [ ] **Step 1.3: Tạo file migration `db/v3/0018_jira_workspaces.sql`**
  Viết mã SQL idempotent hoàn chỉnh đáp ứng toàn bộ đặc tả ở trên.

- [ ] **Step 1.4: Chạy test để Parent Codex ghi nhận GREEN**
  Command:
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/db/jira-workspace-migration.test.ts
  ```
  Kỳ vọng: PASS toàn bộ các bài kiểm tra idempotence, composite FK, dual active unique index và trigger `jira_context`.

---

### Task 2: Workspace Repository Core, Invites & Dual-Layer Membership

**Mục tiêu:** Xây dựng các sub-repositories: `workspace-core-repo.ts`, `workspace-membership-repo.ts`, `workspace-invite-repo.ts`, `workspace-audit-repo.ts` và façade `index.ts`.
- Xử lý tạo workspace atomic gồm cả tổ chức (`workspaces`, `workspace_members`) và Jira (`ati_workspaces`, `ati_workspace_memberships`) cùng UUID.
- Xử lý kích hoạt Jira cho tổ chức hiện hữu (`enableJiraForWorkspace`).
- Invite token 256-bit (hash-only), gia nhập kiểm tra tài khoản Atlassian server-side VÀ tư cách thành viên tổ chức.
- Giải quyết tranh chấp duyệt thành viên bằng SQL CAS thực tế với hai client PostgreSQL cạnh tranh có barrier; kiểm tra re-validation quyền tổ chức sau lock wait.

**Files:**
- Create: `apps/chat-api/src/db/repositories/workspace/workspace-core-repo.ts`
- Create: `apps/chat-api/src/db/repositories/workspace/workspace-membership-repo.ts`
- Create: `apps/chat-api/src/db/repositories/workspace/workspace-invite-repo.ts`
- Create: `apps/chat-api/src/db/repositories/workspace/workspace-audit-repo.ts`
- Create: `apps/chat-api/src/db/repositories/workspace/index.ts`
- Modify: `apps/chat-api/src/db/repositories/index.ts`
- Create: `apps/chat-api/tests/db/jira-workspace-repo.test.ts`

**Chi tiết Thuật toán & Concurrency Locks:**
1. Khóa deterministic cấp workspace:
   `SELECT id FROM workspaces WHERE id = $1 FOR UPDATE;`
   `SELECT id, status, version FROM ati_workspaces WHERE id = $1 FOR UPDATE;`
2. Re-validate tư cách admin của actor sau khi chờ khóa:
   - Kiểm tra tổ chức: `SELECT role, status FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`. Yêu cầu `status = 'active'`.
   - Kiểm tra Jira: `SELECT role, status FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`. Yêu cầu `role = 'admin'` và `status = 'active'`.
   - Nếu không thỏa mãn -> Throw private `WorkspaceRepoError(404, 'WORKSPACE_NOT_FOUND')` khi không còn quyền tổ chức/Jira; thành viên Jira active có role member nhận `403 ADMIN_REQUIRED`.
3. Khóa hàng target: `SELECT * FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`.
4. Guards:
   - Self-approve guard: `actorId === targetUserId && decision === 'approve'` -> Throw `409 'SELF_APPROVE_FORBIDDEN'`.
   - Self-role-elevate guard: actor không thể tự nâng quyền.
   - Last Active Admin guard: Nếu target là admin và decision là `remove`:
     `SELECT count(*)::int AS count FROM ati_workspace_memberships jm JOIN workspace_members om ON om.workspace_id=jm.workspace_id AND om.user_id=jm.user_id JOIN users u ON u.id=jm.user_id WHERE jm.workspace_id=$1 AND jm.role='admin' AND jm.status='active' AND om.status='active' AND u.status='active' AND jm.user_id!=$2`.
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
7. Metadata-only listing: `listWorkspacesForUser(userId: string): Promise<WorkspaceSummary[]>`: Trả về danh sách tóm tắt metadata chỉ gồm các workspace mà chính người gọi có tư cách thành viên ở cả 4 trạng thái (`active`, `pending`, `rejected`, `removed`) trong các workspace Jira đang `active`. Tên workspace đọc từ `workspaces.name`.

**Chi tiết Invite Lifecycle & Monotonic Rejoin:**
- `createInvite(workspaceId: string, actorId: string, req?: CreateInviteRequest): Promise<CreateInviteResponse>`: Nhận request object tùy chọn `expiresInDays?`, sinh 32 bytes `crypto.randomBytes(32).toString('hex')`. Lưu SHA-256 hash trong `token_hash`. Plaintext token chỉ trả về một lần duy nhất tại top-level DTO `CreateInviteResponse`.
- `decideMember(workspaceId: string, actorId: string, targetUserId: string, req: MemberDecisionRequest): Promise<MemberDecisionResponse>`: Nhận `expectedVersion` và `decision: 'approve' | 'reject' | 'remove'`. Trả về `MemberDecisionResponse: { status, version }`.
- `joinWorkspaceWithInvite`:
  - Kiểm tra caller có hàng `jira_accounts` với `status = 'connected'` ở DB. Nếu không -> Reject `WorkspaceRepoError(403, 'ACCOUNT_NOT_CONNECTED')`.
  - Khóa cấp workspace và kiểm tra: Workspace phải `active`.
  - Kiểm tra caller PHẢI ĐANG LÀ THÀNH VIÊN ACTIVE của tổ chức: `SELECT status FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`. Nếu không phải `status = 'active'` -> Reject 404 (Hidden).
  - Sau khi nhận toàn bộ các khóa (lock waits), kiểm tra tươi hạn sử dụng invite bằng `clock_timestamp()` trong SQL: `revoked_at IS NULL AND expires_at > clock_timestamp()`. Nếu không khớp -> Reject 404 (Hidden).
  - Tra cứu Jira membership hiện tại của user:
    - Nếu đã `active`: Trả về `{ outcome: 'already_active', workspaceId }`, DB giữ nguyên `active` (không hạ cấp). Tầng HTTP map sang 409 `already_member`.
    - Nếu đã `pending`: Trả về `{ outcome: 'pending', workspaceId, requestId }`. Tầng HTTP map sang 200/201 pending idempotent.
    - Nếu `rejected` hoặc `removed`:
      - So sánh timestamp độ chính xác SQL: `invite.created_at > membership.decided_at` (sử dụng toán tử so sánh timestamp SQL, không dùng JS Date).
      - Nếu `invite.created_at <= membership.decided_at`: Reject `WorkspaceRepoError(404, 'INVITE_EXPIRED_OR_SUPERSEDED')`.
      - Nếu hợp lệ: Cập nhật `status = 'pending'`, `requested_at = clock_timestamp()`, `version = version + 1`.

- [ ] **Step 2.1: Viết test failing cho Atomic Create, Enable Existing Org, 2 Admin CAS & Last Admin**
  Trong `apps/chat-api/tests/db/jira-workspace-repo.test.ts`:
  - `createWorkspaceWithBootstrapAdmin`: Tạo cả `workspaces` và `ati_workspaces` cùng UUID, bootstrap admin có cả 2 membership active.
  - `enableJiraForWorkspace`: Bật Jira trên org có sẵn thành công; gọi lại lần hai nhận 409 `JIRA_WORKSPACE_ALREADY_ENABLED`.
  - 2 connection pool PG độc lập cạnh tranh CAS trên thành viên pending -> Đúng 1 thành công, đúng 1 nhận 409 `STALE_VERSION`.
  - Mutual remove race: 2 admin đồng thời gỡ bỏ nhau -> Giao dịch 2 sau khi đợi khóa đọc lại actor trong DB thấy mình đã bị remove -> Nhận 404/403 access denied. Query DB xác nhận còn đúng 1 active admin.
  - Sole admin self-remove: Authorized active admin duy nhất tự remove -> Nhận 409 `LAST_ACTIVE_ADMIN`.
  - Tự approve -> Bị từ chối 409 `SELF_APPROVE_FORBIDDEN`.

- [ ] **Step 2.2: Viết test failing cho Invite Lifecycle, Active Duplicate Join & Org Precondition**
  - Hash SHA-256 được lưu, không lưu plaintext.
  - Join không có server Atlassian account -> 403.
  - Join khi chưa là thành viên tổ chức (`workspace_members`) -> 404/403.
  - Replay invite cũ sau khi bị reject -> 404/403.
  - Invite mới sinh sau thời điểm reject -> Join thành công pending.
  - Active duplicate join -> Trả về outcome `already_active`, DB giữ nguyên `active` (không hạ cấp).
  - Pending duplicate join -> Trả về outcome `pending` idempotent.

- [ ] **Step 2.3: Chạy test để Parent Codex ghi nhận RED**
  Command:
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/db/jira-workspace-repo.test.ts
  ```
  Kỳ vọng: FAIL tại các assertions mới.

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
1. Verifier chạy NGOÀI transaction để tránh giữ khóa DB khi thực hiện I/O mạng bên ngoài. Sau khi `await verifier.verifyAdminister(evidence)`, mở transaction và BẮT BUỘC re-validate bộ ba tư cách người dùng (`users.status = 'active'`), tư cách thành viên hai lớp (`workspace_members.status = 'active'` VÀ `ati_workspace_memberships.role = 'admin'` và `status = 'active'`), và tài khoản Atlassian (`jira_accounts.status = 'connected'`) trước khi ghi nhận thay đổi vào DB.
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

### Task 4: Conversation Access Module, `jira_context` & Scoped Route Guards

**Mục tiêu:** Xây dựng mô đun `conversation-access.ts` tập trung kiểm soát quyền truy cập hội thoại hỗ trợ cờ `jira_context`, cập nhật `ConversationRepo`, và áp dụng guard cho mọi đường dẫn chạm tới conversation trong `conversation-routes.ts`, `stream-routes.ts`, `execution-routes.ts`, và `schedule-routes.ts`. Thiết lập ranh giới sẵn sàng cho HTTP conversation creation: 503 mặc định ở production khi yêu cầu `jiraContext: true`; chỉ mở qua internal server option trong test fixture.

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
  workspace_mode: 'legacy' | 'personal' | 'organization';
  jira_context: boolean;
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
- Logic truy vấn kết hợp:
  ```sql
  SELECT c.*
  FROM conversations c
  LEFT JOIN workspaces w
    ON w.id = c.workspace_id
  LEFT JOIN workspace_members wm
    ON wm.workspace_id = c.workspace_id AND wm.user_id = $2 AND wm.status = 'active'
  LEFT JOIN ati_workspaces aw
    ON aw.id = c.workspace_id AND aw.status = 'active'
  LEFT JOIN ati_workspace_memberships am
    ON am.workspace_id = c.workspace_id AND am.user_id = $2 AND am.status = 'active'
  WHERE c.id = $1 AND c.user_id = $2
    AND (
      -- Nhánh legacy / personal: không có workspace
      (c.workspace_id IS NULL AND c.workspace_mode IN ('legacy', 'personal'))
      OR
      -- Nhánh tổ chức thông thường (jira_context = false): chỉ cần active org member
      (c.workspace_id IS NOT NULL AND c.workspace_mode = 'organization' AND c.jira_context = false AND wm.user_id IS NOT NULL)
      OR
      -- Nhánh hội thoại Jira (jira_context = true): bắt buộc cả hai lớp active
      (c.workspace_id IS NOT NULL AND c.workspace_mode = 'organization' AND c.jira_context = true
       AND wm.user_id IS NOT NULL AND aw.id IS NOT NULL AND am.user_id IS NOT NULL)
    );
  ```
  Nếu không tìm thấy hàng -> Ném `ConversationNotFoundError` (HTTP 404).
- Missing authority checker không được phép tự động hạ cấp hàng scoped đã biết về legacy: chỉ bản ghi có lưu trữ `workspace_id IS NULL` thực sự kèm metadata legacy và quyền owner mới được phép đi theo nhánh memory legacy, mọi trường hợp khác trả về 404. Không tuyên bố in-flight SSE/model authorization lease đã hoàn thành trong JIRA-03.

**Quy tắc Guarding across All Scoped Routes:**
1. `conversation-routes.ts`:
   - `POST /api/conversations`:
     Header `X-Workspace-Id` xác định không gian.
     Nếu có yêu cầu `req.body.jiraContext === true`:
       - Yêu cầu `X-Workspace-Id` phải là UUID tổ chức hợp lệ.
       - Kiểm tra `options.enableWorkspaceConversations`. Nếu `false` (mặc định production) -> Trả về HTTP 503 `{ code: 'WORKSPACE_CONVERSATIONS_UNAVAILABLE', error: 'Tính năng hội thoại Jira cần JIRA-05/08 hoàn tất tích hợp.' }`.
       - Nếu `true` (chỉ dùng làm foundation fixture test option): Mở transaction, khóa hai lớp `FOR SHARE`, kiểm tra caller active ở cả hai lớp, rồi INSERT với `jira_context = true`.
     - Nếu không yêu cầu `jiraContext`: Tạo conversation tổ chức thông thường (`jira_context = false`) hoặc personal/legacy bình thường theo chuẩn PR #237.
   - `GET /api/conversations`: `listConversationPage` lọc an toàn: nếu hội thoại có `jira_context = true`, chỉ trả về nếu caller đang là active Jira member của active Jira workspace; nếu `jira_context = false`, chỉ cần active org member.
   - `GET /api/conversations/:id`, `PATCH /api/conversations/:id`, `GET /api/conversations/:id/plans/active`, `GET /api/conversations/:id/messages/latest`, `POST /api/conversations/:id/messages`: Dùng `assertConversationAccess`.
2. `stream-routes.ts`: `GET /api/conversations/:id/stream` dùng `assertConversationAccess` trước khi gửi headers SSE.
3. `execution-routes.ts`: `GET /api/conversations/:convId/executions/latest`, `POST /api/plans/:id/approve`, `POST /api/plans/:id/reject` dùng `assertConversationAccess`.
4. `schedule-routes.ts`: Các endpoint đề xuất lịch dùng `assertConversationAccess`.

- [ ] **Step 4.1: Viết test failing cho kiểm soát quyền hội thoại hai lớp & availability boundary**
  Tạo `apps/chat-api/tests/routes/jira-workspace-conversations.test.ts`:
  - Khởi tạo Express app production mặc định: `POST /api/conversations` với `X-Workspace-Id` tổ chức và `jiraContext: true` -> Nhận HTTP 503 `WORKSPACE_CONVERSATIONS_UNAVAILABLE`.
  - Khởi tạo Express app với option `{ enableWorkspaceConversations: true }`: User A tạo conversation có `jira_context: true` -> Thành công 201.
  - `POST /api/conversations` không có `jiraContext` -> Tạo conversation tổ chức thông thường thành công 201.
  - User B (chỉ là thành viên tổ chức, chưa được duyệt Jira) truy cập conversation Jira của User A -> 404.
  - User A bị disable trong tổ chức (`workspace_members.status = 'disabled'`):
    - Truy cập conversation Jira -> 404.
    - Truy cập conversation tổ chức thông thường -> 404.
  - User A bị remove khỏi Jira (`ati_workspace_memberships.status = 'removed'`):
    - Truy cập conversation Jira -> 404.
    - Truy cập conversation tổ chức thông thường -> Vẫn thành công 200 (không bị ảnh hưởng).

- [ ] **Step 4.2: Chạy test để Parent Codex ghi nhận RED**
  Command:
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/routes/jira-workspace-conversations.test.ts
  ```
  Kỳ vọng: FAIL vì chưa có `conversation-access.ts` cập nhật và chưa áp dụng guard hai lớp.

- [ ] **Step 4.3: Triển khai `conversation-access.ts` và cập nhật các route handlers**
  Viết mã và áp dụng guard.

- [ ] **Step 4.4: Chạy test để Parent Codex ghi nhận GREEN**
  Command:
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/routes/jira-workspace-conversations.test.ts
  ```
  Kỳ vọng: PASS toàn bộ các bài kiểm tra guard hội thoại hai lớp.

---

### Task 5: HTTP API Routes, System Admin Recovery & Express Wiring

**Mục tiêu:** Xây dựng router `apps/chat-api/src/routes/workspace-routes.ts`, liên kết vào `app.ts` và `server.ts`, cung cấp đầy đủ các endpoint theo đúng hợp đồng DTO từ `packages/tool-schemas` (`myjira-dto.ts`), phân tách rõ ràng với routes `/api/workspaces` của PR #237.

**Files:**
- Create: `apps/chat-api/src/routes/workspace-routes.ts`
- Modify: `apps/chat-api/src/app.ts`
- Modify: `apps/chat-api/src/server.ts`
- Create: `apps/chat-api/tests/routes/jira-workspaces.test.ts`

**Endpoints & DTO Mapping:**
- Canonical public facade requests/responses import shared schemas từ `@wap/tool-schemas` (`myjira-dto.ts`):
  - `POST /api/admin/jira-workspaces`: Tạo tổ chức chung + Jira policy cùng UUID (System Admin). Body `CreateWorkspaceRequest: { name, slug, bootstrapAdminUserId }` -> Response `CreateWorkspaceResponse: { workspace: { id, name, slug, version } }`.
  - `POST /api/admin/jira-workspaces/:workspaceId/enable`: Bật Jira cho tổ chức hiện hữu (System Admin + Org Admin). Body: `{ slug: string, bootstrapAdminUserId: string }` -> Response `CreateWorkspaceResponse: { workspace: { id, name, slug, version } }`.
  - `POST /api/admin/jira-workspaces/:workspaceId/archive`: Archive Jira extension (System Admin). Body `ArchiveWorkspaceRequest: { expectedVersion: number }` -> Response `ArchiveWorkspaceResponse: { archived: true }`.
  - `POST /api/admin/jira-workspaces/:workspaceId/recover-admin`: Khôi phục admin Jira (System Admin). Body `RecoverWorkspaceAdminRequest: { expectedVersion: number, newAdminUserId: string }` -> Response `RecoverWorkspaceAdminResponse: { recovered: true }`.
  - `GET /api/jira-workspaces`: Authenticated user -> Response `GetWorkspacesResponse: { workspaces: WorkspaceSummary[] }` (mỗi `WorkspaceSummary` chứa `id, name, slug, membershipStatus, role, version, createdAt, updatedAt` phản ánh tư cách thành viên của chính người gọi ở cả 4 trạng thái trong workspace Jira đang active; `name` đọc từ `workspaces.name`).
  - `POST /api/jira-workspace-join-requests`: Body `WorkspaceJoinRequest: { inviteToken }` -> Khi thành công: `WorkspaceJoinResponse: { requestId, workspaceId, status: 'pending' }`; khi caller đã là active member: HTTP 409 `{ code: 'ALREADY_WORKSPACE_MEMBER', error: 'Bạn đã là thành viên hoạt động của workspace này.' }` (DB active giữ nguyên). Yêu cầu caller phải là active org member.
  - `GET /api/jira-workspaces/:id/members`: Jira Admin -> Response `ListWorkspaceMembersResponse`.
  - `POST /api/jira-workspaces/:id/members/:userId/decision`: Body `MemberDecisionRequest: { expectedVersion, decision }` -> Response `MemberDecisionResponse: { status, version }`.
  - `POST /api/jira-workspaces/:id/invites`: Body `CreateInviteRequest: { expiresInDays? }` (optional object) -> Response `CreateInviteResponse: { inviteToken, id, workspaceId, expiresAt, createdAt }` (direct top-level DTO).
  - `GET /api/jira-workspaces/:id/invites`: Jira Admin -> Response `ListWorkspaceInvitesResponse` (secret-free).
  - `DELETE /api/jira-workspaces/:id/invites/:inviteId`: Jira Admin -> Response `RevokeInviteResponse`.
  - `GET /api/jira-workspaces/:id/jira-sites`: Active Jira Member -> Response `ListWorkspaceSitesResponse`.
  - `POST /api/jira-workspaces/:id/jira-sites`: Jira Admin -> Response `LinkWorkspaceSiteResponse`.
  - `PATCH /api/jira-workspaces/:id/jira-sites/:siteId`: Jira Admin -> Response `UpdateWorkspaceSiteResponse`.
  - `GET /api/jira-workspaces/:id/jira-sites/:siteId/projects`: Active Jira Member -> Response `GetWorkspaceProjectsResponse`.
  - `PUT /api/jira-workspaces/:id/jira-sites/:siteId/projects`: Jira Admin -> Response `ConfigureWorkspaceProjectsResponse`.
  - `GET /api/jira-workspaces/:id/jira-capabilities`: Active Jira Member -> 503 (`CAPABILITIES_UNAVAILABLE`).

- [ ] **Step 5.1: Viết test failing cho toàn bộ HTTP API Routes**
  Tạo `apps/chat-api/tests/routes/jira-workspaces.test.ts`:
  - System Admin gọi `POST /api/admin/jira-workspaces` -> 201 Created (tạo cả `workspaces` và `ati_workspaces` cùng UUID).
  - Bật Jira cho org hiện hữu `POST /api/admin/jira-workspaces/:workspaceId/enable` -> 201 Created; gọi lại -> 409 Conflict.
  - `GET /api/jira-workspaces`: User chỉ thấy workspace Jira mình tham gia; tên phản ánh đúng `workspaces.name`.
  - Join flow: Caller chưa thuộc tổ chức -> 404/403; Đã thuộc tổ chức nhưng chưa có account Atlassian -> 403; Đủ điều kiện -> 201 pending; Đã active gọi lại join -> 409 `ALREADY_WORKSPACE_MEMBER`.
  - CAS decision qua HTTP: Gửi stale version -> 409 Conflict.
  - Unverified site activation qua HTTP -> 403 Forbidden / 503 Unavailable.

- [ ] **Step 5.2: Chạy test để Parent Codex ghi nhận RED**
  Command:
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/routes/jira-workspaces.test.ts
  ```
  Kỳ vọng: Test FAIL (404 trên các router chưa đăng ký).

- [ ] **Step 5.3: Triển khai router và gắn kết vào Express**
  - Tạo `apps/chat-api/src/routes/workspace-routes.ts`.
  - Cập nhật `apps/chat-api/src/app.ts`: Mount `/api/jira-workspaces`, `/api/admin/jira-workspaces`, `/api/jira-workspace-join-requests` bên cạnh `/api/workspaces`.
  - Cập nhật `apps/chat-api/src/server.ts`: Khởi tạo `WorkspaceRepo` và truyền vào `createApp`.

- [ ] **Step 5.4: Chạy test để Parent Codex ghi nhận GREEN**
  Command:
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/routes/jira-workspaces.test.ts
  ```
  Kỳ vọng: PASS toàn bộ các bài kiểm tra route.

---

### Task 6: System Verification, Full Check & Mutation Guards

**Mục tiêu:** Thực hiện kiểm tra toàn diện sau tích hợp: typecheck toàn monorepo, chạy trọn vẹn bộ test suite v3 trên test database cổng 56534 hoặc CI loopback 5432, kiểm thử mutation bắt lỗi hai lớp quyền và cờ `jira_context`, bảo đảm không có hồi quy đối với catalog 33 tools và 8 services.

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
  Runtime SQL fixtures nạp ĐẦY ĐỦ các migration hiện hành (`0001` tới `0016`). Parent Codex thử nghiệm 7 đột biến có chủ đích (mỗi lần test xong phục hồi nguyên trạng):
  1. *Mutation 1:* Xóa bỏ kiểm tra `workspace_members.status = 'active'` khi join Jira -> Test phải FAIL.
  2. *Mutation 2:* Xóa bỏ kiểm tra `jira_accounts` khi join Jira -> Test phải FAIL.
  3. *Mutation 3:* Đổi `clock_timestamp()` thành `now()` hoặc bỏ kiểm tra `invite.created_at > membership.decided_at` -> Test monotonic rejoin phải FAIL.
  4. *Mutation 4:* Bỏ qua kiểm tra `count < 1` của `LAST_ACTIVE_ADMIN` trong `decideMember` -> Test phải FAIL.
  5. *Mutation 5:* Bỏ qua kiểm tra verifier khi PATCH `active: true` trên Jira site -> Test phải FAIL.
  6. *Mutation 6:* Cho phép UPDATE `conversations.jira_context` trong trigger PostgreSQL -> Test phải FAIL.
  7. *Mutation 7:* Cho phép người bị remove khỏi `workspace_members` tiếp tục truy cập hội thoại Jira -> Test phải FAIL.

- [ ] **Step 6.4: Chạy Full Check toàn bộ hệ thống**
  Command:
  ```bash
  DATABASE_URL="$TEST_DATABASE_URL" npm run check
  ```
  Kỳ vọng: Toàn bộ suite test monorepo v3 PASS, catalog giữ nguyên 33 tools và 8 services.

- [ ] **Step 6.5: Cập nhật Task Card kết quả sau tích hợp**
  - Parent Codex điền mục "Kết quả" trong `docs/handoff/tasks/JIRA-03-workspaces.md`.
  - Không chỉnh sửa `docs/handoff/CURRENT-STATE.md` và `docs/handoff/ROADMAP.md` (chỉ reviewer cập nhật sau khi merge PR).

## Tích hợp main #238 trước PR

Base cuối `86b432f`: giữ logic approvalMode của Sheets cùng guard Jira trước mọi xác nhận lịch; migration Jira đánh số 0017 sau Sheets 0016. Thêm `tests/routes/jira-sheets-schedule-compat.test.ts` (5 ca) và đột biến thứ 13 cho guard xác nhận lịch. Toàn bộ check 3.309 v3/406 eval đạt; kết quả review toàn nhánh và CI head cuối được ghi trong PR #240.

## Base cuối #239

Tích hợp `2d5f625` (Calendar), Jira migration0018 sau Sheets0016/Calendar0017; cùng hợp đồng scope cho PostgreSQL và memory. Full check 3.309 v3 +406 eval đạt; hậu kiểm guard/migration và CI đúng head cuối được ghi tại PR #240.

## Vá ranh giới title/scope

Sau review toàn nhánh trên5f, bộ điều phối tái hiện hai test đỏ cho title object/array đi vào overload scope. Native implementer sửa validation và chuẩn hóa string-only, thêm control string/null/JSON-text. Nhóm16 PASS, fullcheck3.309 v3/406eval PASS. Đột biến thứ14 bỏ cả hai lớp bảo vệ; scoped re-review và CI phải dùng SHA mới, không dùng CI5f thay thế.
