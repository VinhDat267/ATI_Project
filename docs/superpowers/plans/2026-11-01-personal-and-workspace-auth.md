# Personal Entry Auth & Multi-Organization Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép người dùng mới sau khi xác thực (Google 1 chạm hoặc bấm link xác minh email) tự động đăng nhập thẳng vào Không gian Cá nhân, đồng thời hỗ trợ tham gia đồng thời nhiều Workspace Tổ chức qua Mã mời (`ATI-XXXX-XXXX`) chờ Admin tổ chức đó duyệt và chuyển đổi qua lại trên thanh điều hướng.

**Architecture:** Tách quyền vào hệ thống (`users.status = 'active'` ngay khi xác thực email/Google) khỏi quyền thành viên tổ chức (`workspaces` và `workspace_members`). Giao diện truyền ngữ cảnh qua header `X-Workspace-Id` (`personal` cho Không gian Cá nhân, `<uuid>` cho Tổ chức, hoặc để trống cho kiểm thử legacy). Hội thoại, lịch chạy, kết nối dịch vụ nhóm và phạm vi bảng Trello được cô lập theo từng không gian.

**Tech Stack:** TypeScript, Express, PostgreSQL 16, React 18, Zustand, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-01-personal-and-workspace-auth-design.md`

## Global Constraints

- Người dùng đăng nhập bằng Google (`email_verified = true`) hoặc vừa bấm link xác minh email (`POST /api/auth/verify-email`) phải có `users.status = 'active'` ngay lập tức và nhận phiên đăng nhập (`accessToken`, `refreshToken`) để vào thẳng `Không gian Cá nhân`.
- Đăng nhập bằng Email + Mật khẩu khi `email_verified = false` trả HTTP `403` với `code: 'EMAIL_NOT_VERIFIED'` và thông báo `'Vui lòng xác minh email trước khi đăng nhập.'` (không trả `ACCOUNT_PENDING` cho người dùng chưa xác minh email).
- Mã mời của tổ chức có định dạng `ATI-XXXX-XXXX` (bảng chữ cái `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, không chứa `0, O, 1, I`), chuẩn hóa `trim().toUpperCase()` khi kiểm tra.
- Khi header `X-Workspace-Id: personal` được gửi:
  - Người dùng là chủ sở hữu của chính Không gian Cá nhân (`canConfigure = true`), được phép tự cấu hình và lưu khoá riêng của mình cho 5 dịch vụ `slack`, `github`, `notion`, `jira`, `telegram` (lưu trong `service_credentials` với `user_id = req.user.id AND workspace_id IS NULL`; tuyệt đối không fallback về các dòng `user_id IS NULL`).
  - 2 dịch vụ Service Account doanh nghiệp (`google-calendar`, `google-sheets`) được ẩn khỏi danh sách trả về của `GET /api/services` ở chế độ `'personal'` (vì người dùng cá nhân đã có `mycalendar` và `mysheets` kết nối bằng OAuth 1 chạm).
  - Dịch vụ `trello` dùng `scopeId = 'personal:' + userId` và cho phép chính người dùng đó chọn tối đa 10 bảng Trello cá nhân.
- Khi header `X-Workspace-Id: <uuid>` được gửi:
  - Người dùng phải có bản ghi trong `workspace_members` với `status = 'active'`. Nếu `status = 'pending'` trả `403 WORKSPACE_PENDING`; nếu `status = 'disabled'` hoặc không có bản ghi trả `403 WORKSPACE_FORBIDDEN`.
  - Chỉ thành viên có `role = 'admin'` trong tổ chức đó mới được cấu hình dịch vụ chung của tổ chức, chọn bảng Trello nhóm (`scopeId = <uuid>`), đổi mã mời, bật/tắt `require_approval` và duyệt thành viên của tổ chức đó (`approve`, `approve-all`, `reject`).
- Khi header `X-Workspace-Id` không được gửi (chế độ tương thích ngược cho hơn 2.500 bài test hiện có): giữ nguyên hành vi đọc `user_id IS NULL AND workspace_id IS NULL` và `trello_team_scope.id = 'default'`.
- Không dùng mock hình thức cho kiểm thử DB/concurrency; các bài kiểm thử migration và repository phải chạy trên PostgreSQL thật.

## Review Focus

- Người dùng bấm link xác minh email hợp lệ nhưng vẫn bị bắt gõ lại mật khẩu hoặc bị chặn bởi `ACCOUNT_PENDING`. Kỳ vọng: `POST /api/auth/verify-email` nâng `status = 'active'`, tạo phiên trong `auth_sessions`, trả về `accessToken` + `refreshToken` + `user`, và `VerifyEmailView` tự động lưu phiên đưa thẳng vào `/`.
- Người dùng mới nhập Mã mời của Tổ chức A (`status = 'pending'` trong `workspace_members`) nhưng cố tình gắn header `X-Workspace-Id: <id Tổ chức A>` để gọi `/api/conversations`, `/api/services` hoặc `/api/schedules`. Kỳ vọng: bị chặn ngay tại middleware với `403 WORKSPACE_PENDING`, không đọc hay ghi được dữ liệu của Tổ chức A.
- Admin của Tổ chức A tắt `require_approval = false` → người dùng mới nhập Mã mời hoặc bấm Link mời `/?invite=ATI-XXXX-XXXX` được vào thẳng với `status = 'active'`. Khi Admin bật lại `require_approval = true` → người nhập mã sau đó vào trạng thái `pending` và Admin có thể bấm `Chấp thuận tất cả` (`POST /api/admin/users/approve-all`).
- Admin của Tổ chức A gọi API quản trị thành viên hoặc đổi mã mời với `X-Workspace-Id` của Tổ chức B mà họ chỉ là `member` (hoặc không thuộc về). Kỳ vọng: trả `403` và không lộ danh sách thành viên hay mã mời của Tổ chức B.
- Admin của Tổ chức A bấm "Đổi mã mới" trong khi đang có 2 yêu cầu tham gia ở trạng thái `pending`. Kỳ vọng: mã mời mới có hiệu lực ngay (mã cũ trả `404 INVALID_INVITE_CODE` cho người nhập sau), nhưng 2 yêu cầu `pending` trước đó vẫn còn nguyên để Admin duyệt.
- Người dùng ở `Không gian Cá nhân` (`X-Workspace-Id: personal`) tự cấu hình `notion` hoặc `github` cá nhân (`user_id = req.user.id, workspace_id IS NULL`) và không bao giờ nhìn thấy credential của Tổ chức A hay dòng legacy `user_id IS NULL`.

---

### Task 1: Xác thực vào thẳng Không gian Cá nhân (Auto-Login sau Verify Email, `EMAIL_NOT_VERIFIED` và Google Auto-Active)

**Files:**
- Modify: `apps/chat-api/src/db/repositories/auth-token-repo.ts`
- Modify: `apps/chat-api/src/db/repositories/google-auth-repo.ts`
- Modify: `apps/chat-api/src/routes/auth/signup.ts`
- Modify: `apps/chat-api/src/routes/auth/session.ts`
- Modify: `apps/chat-api/src/routes/auth/google.ts`
- Modify: `apps/chat-api/tests/auth/auth.test.ts`
- Create: `apps/chat-api/tests/auth/personal-entry-auth.test.ts`

**Interfaces:**
- Consumes: `SessionRepo.create`, `generateAccessToken`, `toAuthUser` hiện có.
- Produces:
  - `AuthTokenRepo.verifyEmail(token: string, now?: number): Promise<UserRow | null>` — trong `consume(..., 'verify_email')`, câu lệnh `UPDATE users` đặt `email_verified = true, status = CASE WHEN status = 'pending' THEN 'active' ELSE status END, updated_at = $3`.
  - `POST /api/auth/verify-email` trả `{ message: string; user?: AuthUser; accessToken?: string; tokenType?: 'Bearer'; expiresIn?: number; refreshToken?: string }` (khi `user.status === 'active'` và có `sessions` repo thì tạo phiên và trả đầy đủ bộ token đăng nhập; không gọi `notifyAdmins`).
  - `POST /api/auth/login`: khi mật khẩu hợp lệ nhưng `user.emailVerified === false`, trả `403 { error: 'Vui lòng xác minh email trước khi đăng nhập.', code: 'EMAIL_NOT_VERIFIED' }`.
  - `GoogleAuthRepo.resolveAccount`: khi `INSERT INTO users` cho tài khoản Google mới, đặt `status = 'active', email_verified = true`; khi liên kết vào tài khoản email có sẵn đang `email_verified = false`, nâng `status = CASE WHEN status = 'pending' THEN 'active' ELSE status END, email_verified = true`. `POST /api/auth/google/callback` không gửi email chờ duyệt cho Admin hệ thống.

- [ ] **Step 1: Write the failing test**

Trong `apps/chat-api/tests/auth/personal-entry-auth.test.ts`, viết kiểm thử trên PostgreSQL thật:
1. Đăng ký email (`POST /api/auth/signup`) → thử đăng nhập ngay khi chưa xác minh (`POST /api/auth/login`) nhận `403` với `code: 'EMAIL_NOT_VERIFIED'`.
2. Gọi `POST /api/auth/verify-email` với token vừa cấp → nhận `200` kèm `accessToken`, `refreshToken`, `user.status === 'active'`, `user.emailVerified === true`, và dùng ngay `accessToken` đó gọi `GET /api/auth/me` nhận `200`.
3. Đăng nhập Google lần đầu (`POST /api/auth/google/callback`) với email mới → tạo user `status = 'active'` và trả ngay `accessToken`, `refreshToken` (`200`), không trả `403 ACCOUNT_PENDING`.
4. Tài khoản `status = 'disabled'` bấm link xác minh email vẫn giữ `status = 'disabled'` và không được cấp phiên.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/auth/personal-entry-auth.test.ts`
Expected: FAIL vì `/verify-email` chưa trả `accessToken` và Google signup mới vẫn trả `403 ACCOUNT_PENDING`.

- [ ] **Step 3: Implement**

Cập nhật `auth-token-repo.ts`, `google-auth-repo.ts`, `signup.ts`, `session.ts`, `google.ts` theo đúng Interfaces. Đồng thời cập nhật các assertion cũ trong `apps/chat-api/tests/auth/auth.test.ts` vốn đang kỳ vọng Google signup mới hoặc user đã verify email bị chặn ở `ACCOUNT_PENDING`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-api -- tests/auth/personal-entry-auth.test.ts tests/auth/auth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/src/db/repositories/auth-token-repo.ts apps/chat-api/src/db/repositories/google-auth-repo.ts apps/chat-api/src/routes/auth/signup.ts apps/chat-api/src/routes/auth/session.ts apps/chat-api/src/routes/auth/google.ts apps/chat-api/tests/auth/auth.test.ts apps/chat-api/tests/auth/personal-entry-auth.test.ts
git commit -m "feat(auth): auto-activate and sign in users into personal space after verification"
```

---

### Task 2: Migration `0015_workspaces.sql` và Kho lưu trữ Workspace / Thành viên Tổ chức

**Files:**
- Create: `db/v3/0015_workspaces.sql`
- Create: `apps/chat-api/src/db/repositories/workspace-repo.ts`
- Modify: `apps/chat-api/src/db/repositories/admin-user-repo.ts`
- Modify: `apps/chat-api/src/db/repositories/trello-team-repo.ts`
- Create: `apps/chat-api/tests/db/workspaces-migration.test.ts`
- Create: `apps/chat-api/tests/db/workspace-repo.test.ts`

**Interfaces:**
- Consumes: bảng `users`, `conversations`, `schedules`, `service_credentials`, `trello_team_scope`, `trello_team_boards`.
- Produces:
  - `db/v3/0015_workspaces.sql`:
    - Tạo bảng `workspaces (id, name, invite_code, require_approval BOOLEAN NOT NULL DEFAULT true, created_by, created_at, updated_at)` và `workspace_members (workspace_id, user_id, role, status, created_at, updated_at, PRIMARY KEY (workspace_id, user_id))`.
    - Thêm cột `workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE` và `workspace_mode TEXT NOT NULL DEFAULT 'legacy' CHECK (workspace_mode IN ('legacy', 'personal', 'organization'))` (kèm ràng buộc nhất quán giữa `workspace_mode` và `workspace_id`) vào `conversations` và `schedules`.
    - Thêm cột `workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE` vào `service_credentials`.
    - Dùng khối `DO $$ ... pg_constraint ... $$` gỡ bỏ ràng buộc inline `CHECK (id = 'default')` trên `trello_team_scope` và `CHECK (scope_id = 'default')` trên `trello_team_boards`, thay bằng ràng buộc có tên cho phép `'default'`, UUID tổ chức hoặc `'personal:' || <uuid>`.
  - `WorkspaceSummary`: `{ id: string; name: string; role: 'admin' | 'member'; status: 'pending' | 'active' | 'disabled'; inviteCode?: string; requireApproval?: boolean; pendingCount?: number; createdAt: Date }`
  - `WorkspaceRepo`:
    - `create(userId: string, name: string, requireApproval?: boolean, now?: number): Promise<WorkspaceSummary>`
    - `listForUser(userId: string): Promise<WorkspaceSummary[]>`
    - `findMember(workspaceId: string, userId: string): Promise<{ workspaceId: string; workspaceName: string; userId: string; role: 'admin' | 'member'; status: 'pending' | 'active' | 'disabled' } | null>`
    - `joinByInviteCode(userId: string, inviteCode: string, now?: number): Promise<{ workspace: WorkspaceSummary; created: boolean; admins: Array<{ id: string; email: string; name: string }> }>` (khi `workspace.require_approval === false`, tạo thành viên với `status = 'active'` ngay lập tức; khi `require_approval === true`, tạo với `status = 'pending'`)
    - `regenerateInviteCode(actorId: string, workspaceId: string, now?: number): Promise<string>`
    - `updateSettings(actorId: string, workspaceId: string, settings: { requireApproval: boolean }, now?: number): Promise<{ requireApproval: boolean }>`
  - `AdminUserRepo`:
    - `listForWorkspace(actorId: string, workspaceId: string, filter: AdminUserFilter): Promise<AdminUserPage>`
    - `mutateForWorkspace(actorId: string, actorSessionId: string, workspaceId: string, targetId: string, action: AdminAction | 'reject', role?: AccountRole, now?: number): Promise<{ user: AdminUser; at: Date }>`
    - `approveAllForWorkspace(actorId: string, workspaceId: string, now?: number): Promise<{ approvedCount: number }>`
  - `TrelloTeamRepo`:
    - `get(scopeId?: string): Promise<TrelloTeamScope | null>` (mặc định `scopeId = 'default'`)
    - `replace(input: { scopeId?: string; chosenBy: string; workspaceId: string; workspaceName: string; boards: { boardId: string; boardName: string }[] }): Promise<TrelloTeamScope>`

- [ ] **Step 1: Write the failing test**

1. `workspaces-migration.test.ts`: kiểm tra tạo bảng `workspaces` (có `require_approval`), `workspace_members`, các cột `workspace_id` + `workspace_mode` trên `conversations`, `schedules`, cột `workspace_id` trên `service_credentials`, và `trello_team_scope` lưu được cả `id = 'default'`, `id = '<workspace-uuid>'` lẫn `id = 'personal:<user-uuid>'` một cách độc lập.
2. `workspace-repo.test.ts`:
   - `create` tạo workspace với `inviteCode` khớp `/^ATI-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/`, `requireApproval = true` mặc định, và thêm người tạo làm `admin` (`active`).
   - `joinByInviteCode` chấp nhận mã viết thường/có khoảng trắng: khi `requireApproval = true` tạo dòng `pending` và trả danh sách Admin `active` của đúng tổ chức đó; khi Admin đổi `updateSettings({ requireApproval: false })` thì người nhập mã mới vào thẳng với `status = 'active'`; gọi lần 2 giữ nguyên idempotent; nếu thành viên đang `disabled` trong tổ chức đó thì ném `WorkspaceError(403, 'WORKSPACE_MEMBER_DISABLED')`.
   - `regenerateInviteCode` đổi mã mới (mã cũ không còn dùng được cho người mới), nhưng không làm mất các bản ghi `pending` đã có trong `workspace_members`.
   - `AdminUserRepo.mutateForWorkspace` và `approveAllForWorkspace` duyệt đơn lẻ (`approve`), duyệt tất cả (`approve-all`), từ chối (`reject` — xoá dòng `pending`), khóa (`disable`) trong phạm vi Tổ chức A mà không làm thay đổi `users.status` toàn cục hay quyền của người đó ở Tổ chức B; chặn Admin của Tổ chức A thao tác trên Tổ chức B; chặn tự hạ quyền/khóa Admin `active` cuối cùng của tổ chức.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/db/workspaces-migration.test.ts tests/db/workspace-repo.test.ts`
Expected: FAIL vì file migration và `workspace-repo.ts` chưa tồn tại.

- [ ] **Step 3: Implement**

Viết `db/v3/0015_workspaces.sql`, `apps/chat-api/src/db/repositories/workspace-repo.ts`, mở rộng `admin-user-repo.ts` và `trello-team-repo.ts` theo đúng Interfaces.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-api -- tests/db/workspaces-migration.test.ts tests/db/workspace-repo.test.ts tests/db/trello-team-repo.test.ts tests/auth/admin-users.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add db/v3/0015_workspaces.sql apps/chat-api/src/db/repositories/workspace-repo.ts apps/chat-api/src/db/repositories/admin-user-repo.ts apps/chat-api/src/db/repositories/trello-team-repo.ts apps/chat-api/tests/db/workspaces-migration.test.ts apps/chat-api/tests/db/workspace-repo.test.ts
git commit -m "feat(db): add multi-organization workspaces schema and repositories"
```

---

### Task 3: Middleware Ngữ cảnh `X-Workspace-Id` và API `/api/workspaces` + `/api/admin/users`

**Files:**
- Create: `apps/chat-api/src/middleware/workspace-context.ts`
- Create: `apps/chat-api/src/routes/workspaces-routes.ts`
- Modify: `apps/chat-api/src/routes/auth/admin-users.ts`
- Modify: `apps/chat-api/src/services/email/index.ts`
- Modify: `apps/chat-api/src/app.ts`
- Modify: `apps/chat-api/src/server.ts`
- Create: `apps/chat-api/tests/routes/workspaces-routes.test.ts`

**Interfaces:**
- Consumes: `WorkspaceRepo`, `AdminUserRepo`.
- Produces:
  - `WorkspaceContext`:
    - `{ mode: 'legacy'; workspaceId: null; role: 'admin' | 'member' }` (khi không gửi header `X-Workspace-Id`)
    - `{ mode: 'personal'; workspaceId: null; role: 'admin' }` (khi gửi `X-Workspace-Id: personal` — người dùng là chủ sở hữu của chính không gian cá nhân)
    - `{ mode: 'organization'; workspaceId: string; workspaceName: string; role: 'admin' | 'member' }` (khi gửi `X-Workspace-Id: <uuid>`)
  - `createWorkspaceContextMiddleware(workspaceRepo?: WorkspaceRepo)` gắn `req.workspaceContext` và trả `403 WORKSPACE_PENDING` hoặc `403 WORKSPACE_FORBIDDEN` khi user chưa `active` trong tổ chức đó.
  - Route `/api/workspaces`:
    - `GET /api/workspaces` → `{ workspaces: WorkspaceSummary[] }`
    - `POST /api/workspaces` (`{ name, requireApproval?: boolean }`) → `201 { workspace: WorkspaceSummary }`
    - `POST /api/workspaces/join` (`{ inviteCode }`) → `200/201 { workspace: WorkspaceSummary }` (kèm rate limit chống đoán mã mời; nếu `requireApproval === false` vào thẳng `active`; nếu `requireApproval === true` tạo `pending` và gửi email thông báo cho các Admin của tổ chức đó)
    - `POST /api/workspaces/:id/invite-code/regenerate` → `200 { inviteCode: string }`
    - `PATCH /api/workspaces/:id/settings` (`{ requireApproval: boolean }`) → `200 { requireApproval: boolean }`
  - Route `/api/admin/users`: khi `req.workspaceContext.mode === 'organization'`, kiểm tra `req.workspaceContext.role === 'admin'`, lấy thêm `inviteCode` và `requireApproval` của tổ chức trong `GET /api/admin/users`, và hỗ trợ thêm `POST /api/admin/users/approve-all` cùng `POST /api/admin/users/:id/reject` bên cạnh `approve`, `disable`, `enable`, `role` trên phạm vi tổ chức đó.

- [ ] **Step 1: Write the failing test**

Trong `apps/chat-api/tests/routes/workspaces-routes.test.ts`:
1. User A tạo tổ chức `"Công ty Alpha"` qua `POST /api/workspaces` → nhận `inviteCode` và `requireApproval: true`.
2. User B gọi `POST /api/workspaces/join` với `inviteCode` → nhận `status = 'pending'`. Khi User B gửi `X-Workspace-Id: <alphaId>` vào route bảo vệ → nhận `403 WORKSPACE_PENDING`.
3. User A (Admin của Alpha) gọi `GET /api/admin/users` với `X-Workspace-Id: <alphaId>` → thấy User B đang `pending` và `inviteCode` của Alpha; gọi `POST /api/admin/users/approve-all` (hoặc `:bId/approve`) → User B chuyển sang `active`.
4. User A tắt `PATCH /api/workspaces/:alphaId/settings` (`{ requireApproval: false }`) → User C nhập `inviteCode` của Alpha được vào thẳng với `status = 'active'`.
5. User B tạo thêm tổ chức `"Dự án Beta"` (User B là Admin của Beta) nhưng nếu User A gắn `X-Workspace-Id: <betaId>` gọi `/api/admin/users` hoặc đổi mã mời của Beta → bị chặn `403`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/routes/workspaces-routes.test.ts`
Expected: FAIL vì `/api/workspaces` và middleware chưa có.

- [ ] **Step 3: Implement**

Tạo `workspace-context.ts`, `workspaces-routes.ts`, cập nhật `admin-users.ts`, `app.ts` và `server.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-api -- tests/routes/workspaces-routes.test.ts tests/auth/admin-users.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/src/middleware/workspace-context.ts apps/chat-api/src/routes/workspaces-routes.ts apps/chat-api/src/routes/auth/admin-users.ts apps/chat-api/src/services/email/index.ts apps/chat-api/src/app.ts apps/chat-api/src/server.ts apps/chat-api/tests/routes/workspaces-routes.test.ts
git commit -m "feat(api): add workspace context middleware and organization management routes"
```

---

### Task 4: Cô lập Dịch vụ, Bảng Trello, Thực thi Kế hoạch, Hội thoại và Lịch chạy theo `X-Workspace-Id`

**Files:**
- Modify: `apps/chat-api/src/db/repositories/credential-repo.ts`
- Modify: `apps/chat-api/src/db/repositories/conversation-repo.ts`
- Modify: `apps/chat-api/src/db/repositories/memory-conversations.ts`
- Modify: `apps/chat-api/src/db/repositories/schedule-repo.ts`
- Modify: `apps/chat-api/src/routes/services-routes.ts`
- Modify: `apps/chat-api/src/routes/connections/trello.ts`
- Modify: `apps/chat-api/src/routes/chat-routes.ts`
- Modify: `apps/chat-api/src/routes/schedule-routes.ts`
- Modify: `apps/chat-api/src/services/adapter-factory.ts`
- Modify: `apps/chat-api/src/services/execution-service.ts`
- Modify: `apps/chat-api/src/services/schedules/schedule-runner.ts`
- Modify: `apps/chat-api/src/services/chat-service.ts`
- Create: `apps/chat-api/tests/routes/workspace-isolation.test.ts`

**Interfaces:**
- Consumes: `req.workspaceContext`, `CredentialRepo`, `TrelloTeamRepo`, `ConversationRepo`, `ScheduleRepo`, `WorkspaceRepo`.
- Produces:
  - `CredentialRepo`: các phương thức đọc/ghi credential (`getCredentials(service, userId, workspaceId?, strictScope?)`, `saveCredentials(service, config, userId, workspaceId?)`, `updateCredentials(service, transform, userId?, workspaceId?)`, `deleteCredentials(service, userId, workspaceId?)`) khóa `pg_advisory_xact_lock` và lọc chính xác theo cả `user_id IS NOT DISTINCT FROM $userId AND workspace_id IS NOT DISTINCT FROM $workspaceId` để thao tác ở Cá nhân (`user_id = userId, workspace_id = NULL`), Tổ chức A (`user_id = NULL, workspace_id = alphaId`), Tổ chức B và `legacy` (`user_id = NULL, workspace_id = NULL`) không bao giờ xoá hay đọc nhầm của nhau.
  - `AdapterContext`: mở rộng thêm `workspaceMode?: 'legacy' | 'personal' | 'organization'` và `workspaceId?: string | null`.
  - `AdapterFactory`: khóa `adapterCache` theo ngữ cảnh (`personal:${userId}:${serviceName}`, `org:${workspaceId}:${serviceName}`, hoặc `legacy:${serviceName}`); khi `workspaceMode === 'personal'` chỉ đọc credential cá nhân (`user_id = userId AND workspace_id IS NULL`); trong `trelloAdapter`, đọc `trelloTeamRepo.get(scopeId)` theo `scopeId` tương ứng (`'personal:' + userId`, `workspaceId`, hoặc `'default'`).
  - `ExecutionService`: trong `approveAndStart`, `retryStep`, `skipStep`, `continueStep`, đọc `conversation.workspace_mode` và `conversation.workspace_id` để đưa vào `AdapterContext`; nếu `conversation.workspace_mode === 'organization'`, xác minh người dùng vẫn còn `status = 'active'` trong `workspace_members` của tổ chức đó trước khi cho phép duyệt hoặc chạy tiếp.
  - `ScheduleRunner.planOne`: sao chép `s.workspace_id` và `s.workspace_mode` sang cuộc hội thoại mới của lượt chạy lịch; nếu `s.workspace_mode === 'organization'`, kiểm tra thành viên còn `active` trong tổ chức trước khi lập kế hoạch.
  - Khi `req.workspaceContext.mode === 'personal'`:
    - `GET /api/services` trả `canConfigure: true`, lọc ẩn 2 dịch vụ Service Account doanh nghiệp (`google-calendar`, `google-sheets`), và đọc/ghi 5 dịch vụ `slack`, `github`, `notion`, `jira`, `telegram` theo phạm vi cá nhân (`user_id = req.user.id, workspace_id = NULL`, không fallback sang `user_id IS NULL`).
    - `trello` dùng `scopeId = 'personal:' + req.user.id`; cho phép chính người dùng đó gọi `GET /api/connections/trello/workspaces`, `GET /api/connections/trello/boards`, `PUT /api/connections/trello/scope` để chọn tối đa 10 bảng Trello cá nhân.
  - Khi `req.workspaceContext.mode === 'organization'`:
    - `GET /api/services` và `POST /api/services/:service/credentials` đọc/ghi theo `user_id = NULL, workspaceId = req.workspaceContext.workspaceId`; kiểm tra quyền `req.workspaceContext.role === 'admin'`.
    - `trello` dùng `scopeId = req.workspaceContext.workspaceId`; chỉ Admin của tổ chức mới được `PUT /api/connections/trello/scope`.
  - `ConversationRepo` và `ScheduleRepo`: lọc danh sách và tạo mới theo `(workspaceMode, workspaceId)`; chặn gửi tin nhắn mới vào cuộc hội thoại nếu ngữ cảnh `X-Workspace-Id` không khớp với không gian của cuộc hội thoại đó.

- [ ] **Step 1: Write the failing test**

Trong `apps/chat-api/tests/routes/workspace-isolation.test.ts`:
1. Khi gửi `X-Workspace-Id: personal`, `GET /api/services` trả `canConfigure: true`, ẩn `google-calendar` và `google-sheets`, không lộ credential của Tổ chức A hay dòng legacy `user_id IS NULL`, và cho phép user tự lưu credential `notion` cá nhân (`user_id = user.id, workspace_id = NULL`).
2. User (vai trò `member`) ở `X-Workspace-Id: personal` gọi `PUT /api/connections/trello/scope` chọn bảng Trello cá nhân thành công (`200`), và bảng đó không ảnh hưởng tới `trello_team_scope` của Tổ chức A.
3. Cấu hình dịch vụ `notion` ở Tổ chức A không ghi đè hay hiển thị khi chuyển sang Tổ chức B hoặc Không gian Cá nhân (`AdapterFactory` và `CredentialRepo` tách biệt hoàn toàn).
4. Thành viên tạo kế hoạch trong Tổ chức A rồi bị Admin của Tổ chức A khóa (`status = 'disabled'`) → khi bấm `POST /api/executions/:planId/approve` bị từ chối `403`, không thể thực thi lên tài nguyên của Tổ chức A.
5. Hội thoại và lịch chạy tạo ở `X-Workspace-Id: personal` không xuất hiện khi truy vấn với `X-Workspace-Id: <alphaId>` và ngược lại; gửi tin nhắn vào hội thoại của Tổ chức A khi đang gắn `X-Workspace-Id: personal` bị từ chối.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/routes/workspace-isolation.test.ts`
Expected: FAIL vì các route và service chưa phân tách theo `req.workspaceContext` và `workspace_mode`.

- [ ] **Step 3: Implement**

Cập nhật `credential-repo.ts`, `conversation-repo.ts`, `memory-conversations.ts`, `schedule-repo.ts`, `services-routes.ts`, `trello.ts`, `chat-routes.ts`, `schedule-routes.ts`, `adapter-factory.ts`, `execution-service.ts`, `schedule-runner.ts` và `chat-service.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-api -- tests/routes/workspace-isolation.test.ts tests/routes/trello-scope.test.ts tests/services/trello-planning.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/src/db/repositories/credential-repo.ts apps/chat-api/src/db/repositories/conversation-repo.ts apps/chat-api/src/db/repositories/memory-conversations.ts apps/chat-api/src/db/repositories/schedule-repo.ts apps/chat-api/src/routes/services-routes.ts apps/chat-api/src/routes/connections/trello.ts apps/chat-api/src/routes/chat-routes.ts apps/chat-api/src/routes/schedule-routes.ts apps/chat-api/src/services/adapter-factory.ts apps/chat-api/src/services/execution-service.ts apps/chat-api/src/services/schedules/schedule-runner.ts apps/chat-api/src/services/chat-service.ts apps/chat-api/tests/routes/workspace-isolation.test.ts
git commit -m "feat(api): isolate services, adapters, executions, conversations and schedules by workspace"
```

---

### Task 5: Giao diện Xác thực Vào thẳng Cá nhân, Bộ chuyển đổi Workspace (`MainNav.tsx`), Nhãn Ngữ cảnh và Quản trị Mã mời (`UsersPage.tsx`, `SettingsPage.tsx`)

**Files:**
- Create: `apps/chat-web/src/services/workspace-storage.ts`
- Create: `apps/chat-web/src/components/layout/WorkspaceSwitcher.tsx`
- Modify: `apps/chat-web/src/types.ts`
- Modify: `apps/chat-web/src/services/api-client.ts`
- Modify: `apps/chat-web/src/components/AuthGate.tsx`
- Modify: `apps/chat-web/src/views/VerifyEmailView.tsx`
- Modify: `apps/chat-web/src/pages/AuthAction/AuthActionPage.tsx`
- Modify: `apps/chat-web/src/components/layout/MainNav.tsx`
- Modify: `apps/chat-web/src/components/layout/UserNavMenu.tsx`
- Modify: `apps/chat-web/src/pages/Cockpit/RequestMoments.tsx`
- Modify: `apps/chat-web/src/pages/Users/UsersPage.tsx`
- Modify: `apps/chat-web/src/pages/Settings/SettingsPage.tsx`
- Modify: `apps/chat-web/src/pages/Settings/TrelloConnection.tsx`
- Create: `apps/chat-web/tests/personal-and-workspace-auth.test.tsx`

**Interfaces:**
- Consumes: API `/api/auth/verify-email`, `/api/workspaces`, `/api/admin/users`, header `X-Workspace-Id`.
- Produces:
  - `workspaceStorage`: quản lý `activeWorkspaceId` (`'personal'` hoặc `<workspace-uuid>`) theo `user.id` và `pendingInviteCode` trong `sessionStorage` (hỗ trợ Link mời `/?invite=ATI-XXXX-XXXX` hoặc nhập mã lúc đăng ký).
  - `apiClient`: tự động đính kèm header `X-Workspace-Id` từ `workspaceStorage.getActiveWorkspaceId()` vào các request nghiệp vụ; thêm các hàm `listWorkspaces()`, `createWorkspace(name, requireApproval?)`, `joinWorkspace(inviteCode)`, `regenerateWorkspaceInviteCode(workspaceId)`, `updateWorkspaceSettings(workspaceId, { requireApproval })`, `approveAllUsers()`, `rejectUser(userId)`.
  - `VerifyEmailView.tsx` & `AuthGate.tsx`: khi xác thực thành công (`verifyEmail`, `login`, `googleCallback`), tự động lưu phiên vào `authStorage`, nếu có `pendingInviteCode` thì tự động gọi `joinWorkspace(pendingInviteCode)` và điều hướng thẳng vào `'/'`. Khi đăng nhập trả `code === 'EMAIL_NOT_VERIFIED'`, hiển thị màn hình nhắc xác minh email kèm nút **"Gửi lại email xác minh"** ngay tại chỗ.
  - `WorkspaceSwitcher.tsx`, `MainNav.tsx` & `UserNavMenu.tsx` (Phương án A): hiển thị nút chọn không gian ngay cạnh Logo `ATI` góc trái trên `MainNav.tsx` (`👤 Không gian Cá nhân`, danh sách các `Workspace Tổ chức` kèm nhãn `⏳ Chờ Admin duyệt`, nút **`+ Nhập mã mời`** và **`+ Tạo tổ chức`** mở modal tương ứng). Tab `Người dùng` (`/admin/users`) trên `MainNav.tsx` và `UserNavMenu.tsx` hiển thị khi đang ở một Tổ chức với vai trò `admin` (hoặc legacy global admin). Khi đổi Workspace, tự động reset hội thoại về `'/'` và tải lại danh sách hội thoại + dịch vụ của không gian mới.
  - `RequestMoments.tsx` & `SettingsPage.tsx`: hiển thị **Nhãn ngữ cảnh trực quan (Context Pill)** cho biết đang thao tác tại `👤 Không gian Cá nhân` hay `🏢 <Tên Tổ chức>`, và hiển thị thẻ dẫn đường nhanh (*"Làm việc cùng đội nhóm? Nhập mã mời / Tạo Workspace tổ chức"*) khi người dùng mới ở Không gian Cá nhân chưa tham gia tổ chức nào.
  - `UsersPage.tsx`: hiển thị **Thẻ Mã mời của Tổ chức** (`inviteCode`, nút **Sao chép mã**, nút **Sao chép Link mời**, nút **Đổi mã mới**, công tắc **"Cần Admin duyệt khi nhập mã"**) và nút **Chấp thuận tất cả**, **Chấp thuận** / **Từ chối** trên danh sách yêu cầu chờ duyệt.
  - `TrelloConnection.tsx`: ở Không gian Cá nhân cho phép chính người dùng đó tự chọn tối đa 10 bảng Trello cá nhân của mình.

- [ ] **Step 1: Write the failing test**

Trong `apps/chat-web/tests/personal-and-workspace-auth.test.tsx`:
1. Mở `/verify-email?token=valid-token` (kèm `?invite=ATI-ALPHA-8F2K`) → sau khi API trả `accessToken` + `user`, ứng dụng tự động lưu phiên, tự động gửi yêu cầu tham gia mã mời và điều hướng thẳng vào Không gian làm việc (`/`).
2. Đăng nhập gặp lỗi `403 { code: 'EMAIL_NOT_VERIFIED' }` → hiện màn nhắc xác minh email và bấm gửi lại email xác minh thành công.
3. Trên `MainNav`, Bộ chuyển đổi Workspace cạnh Logo hiển thị `Không gian Cá nhân` (kèm Context Pill trên Cockpit), bấm mở menu chọn **`+ Nhập mã mời`** → gửi mã `ATI-ALPHA-8F2K` → hiện tổ chức ở trạng thái `Chờ Admin duyệt` trong khi vẫn dùng Không gian Cá nhân bình thường.
4. Khi chọn **`+ Tạo tổ chức`** → tạo `"Công ty Alpha"`, tự động chuyển sang `"Công ty Alpha"` với vai trò Admin, hiện tab `Người dùng` (`/admin/users`), và trên `UsersPage` hiển thị Mã mời `ATI-ALPHA-8F2K` kèm nút **Sao chép mã**, **Sao chép Link mời**, **Đổi mã mới**, công tắc **Cần Admin duyệt**, **Chấp thuận tất cả**, **Chấp thuận** và **Từ chối**.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-web -- tests/personal-and-workspace-auth.test.tsx`
Expected: FAIL vì `WorkspaceSwitcher` trên `MainNav` và luồng auto-login trên `VerifyEmailView` chưa có.

- [ ] **Step 3: Implement**

Xây dựng `workspace-storage.ts`, `WorkspaceSwitcher.tsx`, cập nhật `api-client.ts`, `VerifyEmailView.tsx`, `AuthGate.tsx`, `AuthActionPage.tsx`, `MainNav.tsx`, `UserNavMenu.tsx`, `RequestMoments.tsx`, `UsersPage.tsx`, `SettingsPage.tsx`, và `TrelloConnection.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-web -- tests/personal-and-workspace-auth.test.tsx tests/fe-08-landing-auth.test.tsx tests/fe-09-pages.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-web/src/services/workspace-storage.ts apps/chat-web/src/components/layout/WorkspaceSwitcher.tsx apps/chat-web/src/types.ts apps/chat-web/src/services/api-client.ts apps/chat-web/src/components/AuthGate.tsx apps/chat-web/src/views/VerifyEmailView.tsx apps/chat-web/src/pages/AuthAction/AuthActionPage.tsx apps/chat-web/src/components/layout/MainNav.tsx apps/chat-web/src/components/layout/UserNavMenu.tsx apps/chat-web/src/pages/Cockpit/RequestMoments.tsx apps/chat-web/src/pages/Users/UsersPage.tsx apps/chat-web/src/pages/Settings/SettingsPage.tsx apps/chat-web/src/pages/Settings/TrelloConnection.tsx apps/chat-web/tests/personal-and-workspace-auth.test.tsx
git commit -m "feat(web): add personal auto-login, workspace switcher on MainNav and invite code management UI"
```
