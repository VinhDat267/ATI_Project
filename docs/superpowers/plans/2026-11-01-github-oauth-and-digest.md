# GitHub OAuth cá nhân, AI Đa dịch vụ và Lịch chạy có Chế độ chọn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay PAT GitHub dùng chung bằng đăng nhập GitHub OAuth cá nhân trên tối đa 10 repo do quản trị chọn, mở bộ lọc Issue/PR cho AI đa dịch vụ mà không đổi SHA-256 prompt, và thêm Chế độ chọn (`Chờ duyệt mỗi lượt` / `Tự gửi bản tin`) trên thẻ lịch chạy.

**Architecture:** Giữ nguyên dịch vụ `github` và định nghĩa 5 tool `github.*` trong `ALL_TOOLS` để giữ nguyên từng byte system prompt baseline. Máy chủ lưu credential GitHub cá nhân theo `user_id` và phạm vi 1–10 repo của nhóm trong PostgreSQL; `AdapterFactory` cấp adapter theo token của người đang thao tác và khóa `connections.github` vào `plan_hash`. Trên lịch chạy (`SCHEDULES_ENABLED=on`), đề xuất lịch đủ điều kiện đọc GitHub → báo Slack cho phép người dùng chọn `approvalMode: 'auto_digest'` để tự đọc GitHub + tóm tắt AI + gửi vào kênh Slack đã khóa mà không cần duyệt lại từng lượt.

**Tech Stack:** TypeScript, Express, PostgreSQL 16, React, Vitest, Playwright, GitHub OAuth 2.0 / GitHub App user-to-server OAuth (PKCE S256).

**Spec:** `docs/superpowers/specs/2026-11-01-github-digest-and-oauth-design.md`

**Nhánh:** Tách từ `origin/main` lúc bắt đầu làm. Số migration là prefix kế tiếp trong `db/v3/` của nhánh đó (ví dụ `0015` nếu trên `main` đang dừng ở `0014_trello_oauth.sql`).

## Global Constraints

- `ALL_TOOLS` giữ nguyên 33 tool và schema trong `packages/tool-schemas/src/github.ts` không đổi để giữ nguyên SHA-256 trong `packages/planner/tests/read-answers.test.ts` (`b31234b91e0c22191f5b0c5fb4be73299e673178df36ea3accb2633b42ec64f9`) và `packages/planner/tests/schedules.test.ts`.
- Không rơi về credential GitHub dùng chung (`user_id IS NULL`) ở bất kỳ đường nào (`getConfiguredToolCatalog`, `getToolCatalogFor`, `AdapterFactory`, `mayFallbackToShared`, `ScheduleRunner`).
- Ủy quyền GitHub: `https://github.com/login/oauth/authorize` với `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method=S256` (và `scope=repo,read:user` khi dùng OAuth App hoặc quyền tương ứng của GitHub App). Đổi mã / làm mới: `https://github.com/login/oauth/access_token` với header `Accept: application/json`. API: `https://api.github.com` với `Authorization: Bearer`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `redirect: 'error'`.
- Phạm vi nhóm: từ 1 đến 10 repository (`fullName` khớp `/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/`, không có `.` hay `..`).
- Mọi bước đọc/ghi trong `GitHubAdapter` phải gọi `checkedRepo` **trước khi** phát sinh lệnh HTTP.
- Chế độ `auto_digest` chỉ được phép xác nhận khi lịch chỉ định tuyến tới `github` và `slack`, không có từ khóa ghi lên công cụ công việc, có 1–5 repo hợp lệ và đúng 1 kênh Slack hợp lệ.
- Trong lượt chạy `auto_digest`, mốc `SINCE` chỉ lấy `due_at` của lượt `digest_sent` có `trigger = 'scheduled'` gần nhất (lượt `manual` không đẩy `SINCE` lên). Ngay trước khi gọi `slack.send_message`, phải đọc lại `schedules.version` và `status`; một khi đã gọi Slack thì bắt buộc ghi `digest_sent` hoặc `digest_failed`, không chuyển sang `discarded`.
- Sandbox và test không gọi `github.com` hay `api.github.com` thật.

## Review Focus

- Người dùng bấm **"Chạy lượt này ngay"** (`trigger = 'manual'`) cho bản tin GitHub rồi 2 phút sau tới giờ hẹn tự động (`trigger = 'scheduled'`). Kỳ vọng: lượt tự động vẫn lấy đủ issue mới của 24 giờ qua (hoặc từ lượt `scheduled` trước đó), không bị rỗng vì mốc `due_at` của lượt `manual`.
- Người dùng đổi giờ lịch bản tin (`action = 'update'`) rồi xác nhận. Kỳ vọng: `digest_config_hash` trong bảng `schedules` được tính và lưu lại theo `recurrence` mới; lượt chạy kế tiếp không bị khóa `blocked` vì lệch hash.
- Trong lúc `ScheduleRunner` đang đọc GitHub cho bản tin (mất vài giây), người dùng bấm **Tạm dừng** hoặc **Hủy** lịch. Kỳ vọng: bước kiểm tra lại `schedules.version` / `status` ngay trước `slack.send_message` chặn việc gửi tin và ghi lượt là `discarded`.
- Tiêu đề issue trên GitHub chứa `<!channel> Khẩn cấp <https://evil.example|click> & hơn thế`. Kỳ vọng: tin gửi vào Slack đã được escape thành `&lt;!channel&gt; Khẩn cấp &lt;https://evil.example|click&gt; &amp; hơn thế`, không kích hoạt ping toàn kênh hay chèn link giả.
- Token GitHub của thành viên mở được repo `owner/secret` nhưng quản trị không chọn repo đó trong phạm vi nhóm. Kỳ vọng: `search_repos`, `search_issues`, `get_issue`, `create_issue`, `add_label` đều chặn với `StepError` 403 `AUTH_ERROR` trước khi gọi HTTP tới `/repos/owner/secret`.

---

### Task 1: Cấu hình `GITHUB_OAUTH` trong `env.ts`

**Files:**
- Modify: `apps/chat-api/src/config/env.ts`
- Test: `apps/chat-api/tests/config/github-env.test.ts`

**Interfaces:**
- Consumes: `validateEnv` hiện có trong `apps/chat-api/src/config/env.ts`.
- Produces: `GitHubOAuthConfig` trên kết quả `validateEnv` tại `config.GITHUB_OAUTH` (`{ clientId: string; clientSecret: string; redirectUri: string; authorizationUrl: string; tokenUrl: string; apiBaseUrl: string; scope: string } | undefined`). Biến bắt buộc để bật: `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_OAUTH_REDIRECT_URI`. Biến ghi đè cho test: `GITHUB_OAUTH_AUTH_URL`, `GITHUB_OAUTH_TOKEN_URL`, `GITHUB_API_BASE_URL`, `GITHUB_OAUTH_SCOPE`. Trong `RUNTIME_MODE=sandbox`, chỉ gắn `config.GITHUB_OAUTH` khi cả 3 biến URL ghi đè (`GITHUB_OAUTH_AUTH_URL`, `GITHUB_OAUTH_TOKEN_URL`, `GITHUB_API_BASE_URL`) được đặt (giống bản vá Trello `472ba708`).

- [ ] **Step 1: Write the failing test**

Trong `apps/chat-api/tests/config/github-env.test.ts`, kiểm tra:
- Khi đủ 3 biến `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_OAUTH_REDIRECT_URI='http://127.0.0.1:5174/connections/github/callback'` ở `RUNTIME_MODE=live`, `config.GITHUB_OAUTH` có mặc định `authorizationUrl: 'https://github.com/login/oauth/authorize'`, `tokenUrl: 'https://github.com/login/oauth/access_token'`, `apiBaseUrl: 'https://api.github.com'`.
- Khi thiếu 1 trong 3 biến, `config.GITHUB_OAUTH` là `undefined`.
- Khi `RUNTIME_MODE=sandbox` mà không đặt đủ 3 biến URL ghi đè, `config.GITHUB_OAUTH` là `undefined`.
- Khi `GITHUB_OAUTH_REDIRECT_URI` có query, fragment, userinfo hoặc HTTP không phải loopback, `validateEnv` ném lỗi chứa `GITHUB_OAUTH_REDIRECT_URI`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/config/github-env.test.ts`
Expected: FAIL vì `GITHUB_OAUTH` chưa có trên kết quả `validateEnv`.

- [ ] **Step 3: Implement `GITHUB_OAUTH` parsing in `apps/chat-api/src/config/env.ts`**

Làm theo đúng nhánh `TRELLO_OAUTH` trong `apps/chat-api/src/config/env.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-api -- tests/config/github-env.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/src/config/env.ts apps/chat-api/tests/config/github-env.test.ts
git commit -m "feat(github): read the GitHub OAuth client config"
```

---

### Task 2: Migration PostgreSQL, `GitHubTeamRepo` và xoay token GitHub

**Files:**
- Create: `db/v3/NNNN_github_oauth_and_digest.sql` (`NNNN` là số kế tiếp trong `db/v3/` trên nhánh làm việc)
- Create: `apps/chat-api/src/db/repositories/github-team-repo.ts`
- Modify: `apps/chat-api/src/db/repositories/credential-repo.ts`
- Modify: `apps/chat-api/src/db/repositories/google-auth-repo.ts` (thêm `'connect_github'` vào `OAuthMode`)
- Modify: `apps/chat-api/tests/integration/service-configuration-permission.test.ts` và `apps/chat-api/tests/integration/service-scope-save.test.ts` (đổi fixture kiểm thử credential dùng chung `user_id IS NULL` trên PostgreSQL thật từ `'github'` sang dịch vụ dùng chung `'notion'`/`'slack'` để không vi phạm `service_credentials_github_owner_check`)
- Test: `apps/chat-api/tests/db/github-oauth-migration.test.ts`
- Test: `apps/chat-api/tests/db/github-team-repo.test.ts`

**Interfaces:**
- Consumes: bảng `oauth_states`, `service_credentials`, `users`, `schedules`, `schedule_runs`.
- Produces:
  - Migration idempotent cập nhật:
    1. `oauth_states_mode_check`, `oauth_states_mode_owner_check`, `oauth_states_return_to_check` thêm `'connect_github'` (giữ đủ `'login'`, `'link'`, `'connect_gmail'`, `'connect_mycalendar'`, `'connect_mysheets'`, `'connect_trello'`);
    2. `DELETE FROM service_credentials WHERE service = 'github' AND user_id IS NULL;` và constraint `service_credentials_github_owner_check CHECK (service <> 'github' OR user_id IS NOT NULL)`;
    3. Bảng `github_team_scope` (`id = 'default'`, `chosen_by`, `updated_at`) và `github_team_repos` (`id`, `scope_id`, `repo_id`, `full_name`, `name`, `position`, tối đa 10 dòng qua constraint trigger `trg_check_github_team_repos_constraints`);
    4. Trên `schedules`: cột `kind TEXT NOT NULL DEFAULT 'plan'`, `digest_config JSONB`, `digest_config_hash TEXT`, `digest_approved_at TIMESTAMPTZ`, cùng constraint `schedules_kind_digest_check` hai chiều chặt (`(kind = 'plan' AND digest_config IS NULL AND digest_config_hash IS NULL AND digest_approved_at IS NULL) OR (kind = 'github_digest' AND digest_config IS NOT NULL AND digest_config_hash IS NOT NULL AND digest_approved_at IS NOT NULL)`);
    5. Trên `schedule_runs`: mở rộng `schedule_runs_status_check` thêm `'digest_sent'`, `'digest_failed'`; thêm cột `delivery JSONB` và constraint `schedule_runs_delivery_check CHECK ((status = 'digest_sent') = (delivery IS NOT NULL))`.
  - `OAuthMode` trong `google-auth-repo.ts` có thêm `'connect_github'`.
  - `GitHubTeamScope = { chosenBy: string; updatedAt: string; repos: { repoId: string; fullName: string; name: string }[] }`
  - `class GitHubTeamRepo` với `get(): Promise<GitHubTeamScope | null>` và `replace(input: { chosenBy: string; repos: { repoId: string; fullName: string; name: string }[] }): Promise<GitHubTeamScope>`
  - `CredentialRepo.rotatePersonalSecret` mở rộng kiểu `service: 'trello' | 'github'`.

- [ ] **Step 1: Write the failing test**

- `github-oauth-migration.test.ts` (trên PostgreSQL thật):
  - Chạy toàn bộ file migration từ `0001` tới `NNNN` hai lần liên tiếp không lỗi;
  - Chèn `oauth_states` với `mode = 'connect_github'`, `user_id`, `session_id`, `return_to = '/c/...'` thành công; thiếu `user_id` thì bị chặn `23514`;
  - Chèn `service_credentials` với `service = 'github'` và `user_id IS NULL` bị chặn `23514`;
  - Chèn `schedules` với `kind = 'plan'` và `digest_config = '{}'` (hai cột kia `NULL`) bị chặn `23514`; `kind = 'github_digest'` đủ 3 cột `digest_*` thành công;
  - Chèn `schedule_runs` với `status = 'digest_sent'` mà `delivery IS NULL` bị chặn `23514`; có `delivery` và `plan_id IS NULL` thành công; `status = 'digest_failed'` với `delivery IS NULL` thành công.
- `github-team-repo.test.ts` (trên PostgreSQL thật):
  - `replace` từ 1 đến 10 repo lưu đúng thứ tự, loại trùng `fullName`;
  - `replace` 0 repo hoặc 11 repo hoặc `fullName` sai mẫu `owner/name` ném lỗi và giữ nguyên dữ liệu cũ.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/db/github-oauth-migration.test.ts tests/db/github-team-repo.test.ts`
Expected: FAIL vì file migration và `GitHubTeamRepo` chưa tồn tại, đồng thời kiểm tra lại `tests/db/schedule-migration.test.ts` và `tests/db/gmail-migration.test.ts`.

- [ ] **Step 3: Implement migration, `GitHubTeamRepo`, `OAuthMode`, and `rotatePersonalSecret` update**

Viết file SQL idempotent theo đúng cấu trúc `0014_trello_oauth.sql` và `0010_schedules.sql`, cập nhật `google-auth-repo.ts`, và đổi dịch vụ mẫu trong 2 file test tích hợp credential dùng chung từ `'github'` sang `'notion'`/`'slack'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-api -- tests/db/github-oauth-migration.test.ts tests/db/github-team-repo.test.ts tests/db/schedule-migration.test.ts tests/db/gmail-migration.test.ts tests/integration/service-configuration-permission.test.ts tests/integration/service-scope-save.test.ts`
Expected: PASS cả 6 file test trên PostgreSQL thật.

- [ ] **Step 5: Commit**

```bash
git add db/v3/NNNN_github_oauth_and_digest.sql apps/chat-api/src/db/repositories/github-team-repo.ts apps/chat-api/src/db/repositories/credential-repo.ts apps/chat-api/src/db/repositories/google-auth-repo.ts apps/chat-api/tests/db/github-oauth-migration.test.ts apps/chat-api/tests/db/github-team-repo.test.ts apps/chat-api/tests/integration/service-configuration-permission.test.ts apps/chat-api/tests/integration/service-scope-save.test.ts
git commit -m "feat(db): add GitHub OAuth team scope and digest schedule schema"
```

---

### Task 3: `GitHubOAuthClient` và `GitHubTokenManager`

**Files:**
- Create: `apps/chat-api/src/services/github/oauth-client.ts`
- Create: `apps/chat-api/src/services/github/token-manager.ts`
- Test: `apps/chat-api/tests/services/github-oauth-client.test.ts`
- Test: `apps/chat-api/tests/services/github-token-manager.test.ts`

**Interfaces:**
- Consumes: `GitHubOAuthConfig` (Task 1), `CredentialRepo.rotatePersonalSecret` & `markReconnectRequired` (Task 2).
- Produces:
  - `GITHUB_OAUTH_DEFAULT_SCOPE = 'repo read:user'`
  - `class GitHubOAuthError extends Error` với `kind: 'invalid_grant' | 'rejected' | 'network' | 'server'`
  - `class GitHubOAuthClient` với:
    - `authorizationUrl({ state, codeChallenge }): string`
    - `exchangeCode(code: string, codeVerifier: string, signal?: AbortSignal): Promise<{ accessToken: string; refreshToken?: string; expiresInSeconds?: number }>`
    - `refresh(refreshToken: string, signal?: AbortSignal): Promise<{ accessToken: string; refreshToken?: string; expiresInSeconds?: number }>`
    - `user(accessToken: string, signal?: AbortSignal): Promise<{ id: string; login: string }>`
    - `repos(accessToken: string, signal?: AbortSignal): Promise<{ id: string; name: string; fullName: string; private: boolean }[]>`
  - `class GitHubTokenManager` với `forConnection(userId: string, credentialId: string, tokens: { accessToken?: string; refreshToken?: string })` trả `{ getAccessToken(options?: { signal?: AbortSignal; forceRefresh?: boolean }): Promise<string> }` và `clear(userId: string): void`. Hỗ trợ cả 2 chế độ token của GitHub: token có hạn kèm `refreshToken` (GitHub App có bật expiring user tokens — xoay qua `rotatePersonalSecret`) và token không hết hạn (khi GitHub không trả `refresh_token` — dùng `accessToken` đã mã hóa trong `service_credentials`).

- [ ] **Step 1: Write the failing test**

- `github-oauth-client.test.ts`: kiểm tra `authorizationUrl` có PKCE `S256`, `state`, `client_id`, `redirect_uri`; `exchangeCode` gửi `Accept: application/json`, xử lý cả trường hợp GitHub trả HTTP 200 kèm `{ error: 'bad_verification_code' }` thành `GitHubOAuthError` `kind = 'invalid_grant'`, không lộ secret/code/token trong `error.message`; `repos` lọc các repo hợp lệ (`full_name` đúng mẫu `owner/name`); `AbortSignal` đã abort thì không gọi `fetch`.
- `github-token-manager.test.ts`: kiểm tra cả 2 trường hợp (có `refreshToken` xoay một lần qua `rotatePersonalSecret`, và chỉ có `accessToken` không hết hạn); khi `invalid_grant` thì gọi `markReconnectRequired` và ném `StepError` `AUTH_ERROR` `"GitHub cần được kết nối lại."`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/services/github-oauth-client.test.ts tests/services/github-token-manager.test.ts`
Expected: FAIL vì module chưa có.

- [ ] **Step 3: Implement `GitHubOAuthClient` and `GitHubTokenManager`**

Theo cấu trúc `TrelloOAuthClient` và `TrelloTokenManager`, chú ý đặc thù của GitHub `/login/oauth/access_token`: khi mã sai hoặc refresh token hỏng, GitHub thường trả HTTP 200 với JSON `{ error: 'bad_verification_code' | 'bad_refresh_token', error_description: '...' }`. Phải phân loại `bad_verification_code` và `bad_refresh_token` thành `kind: 'invalid_grant'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-api -- tests/services/github-oauth-client.test.ts tests/services/github-token-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/src/services/github/oauth-client.ts apps/chat-api/src/services/github/token-manager.ts apps/chat-api/tests/services/github-oauth-client.test.ts apps/chat-api/tests/services/github-token-manager.test.ts
git commit -m "feat(github): add OAuth client and token manager"
```

---

### Task 4: Route kết nối GitHub cá nhân và chọn phạm vi Repo của nhóm

**Files:**
- Create: `apps/chat-api/src/routes/connections/github.ts`
- Modify: `apps/chat-api/src/app.ts`
- Modify: `apps/chat-api/src/routes/services-routes.ts`
- Modify: `packages/tool-schemas/src/registry/github.ts`
- Modify: `packages/tool-schemas/tests/schemas.test.ts` (cập nhật assertion `github.credentialFields` thành `[]`)
- Modify: `apps/chat-api/tests/routes/services-security.test.ts` (đổi fixture kiểm thử lưu credential/scope dùng chung từ `'github'` sang dịch vụ dùng chung `'notion'`/`'slack'`)
- Test: `apps/chat-api/tests/routes/github-connections.test.ts`
- Test: `apps/chat-api/tests/routes/github-scope.test.ts`
- Test: `apps/chat-api/tests/routes/github-shared-credentials.test.ts`

**Interfaces:**
- Consumes: Task 2 (`GitHubTeamRepo`), Task 3 (`GitHubOAuthClient`, `GitHubTokenManager`).
- Produces:
  - `POST /api/connections/github/start` body `{ returnTo?: string }` → `{ url: string }` (503 khi thiếu `GITHUB_OAUTH`)
  - `POST /api/connections/github/callback` body `{ code: string; state: string }` → `{ login: string; returnTo?: string }`
  - `DELETE /api/connections/github` → `{ success: true }`
  - `GET /api/connections/github` → `{ status: 'unconfigured' | 'not_connected' | 'reconnect_required' | 'needs_scope' | 'needs_membership' | 'connected'; login?: string; repos: { repoId: string; fullName: string; name: string; accessible: boolean }[] }`
  - `GET /api/connections/github/candidate-repos` (chỉ `admin` đã kết nối) → `{ repos: { repoId: string; fullName: string; name: string; private: boolean }[] }`
  - `PUT /api/connections/github/scope` (chỉ `admin` đã kết nối) body `{ repos: string[] }` (1–10 `fullName` thuộc tập `candidate-repos` của admin, tự loại trùng) → `GitHubTeamScope`
  - `GITHUB_SERVICE.credentialFields = []`; `POST /api/services/github/credentials` và `PUT/POST /api/services/github/scope` trả `410 { error: 'GitHub dùng đăng nhập OAuth.' }`; `GET /api/services` đính kèm `personalStatus`, `username` (`login`), `connectedAt` cho `github` khi người gọi có bản ghi cá nhân.

- [ ] **Step 1: Write the failing test**

- `github-connections.test.ts`: kiểm tra `start` (503 khi thiếu cấu hình, 200 lưu `oauth_states` mode `connect_github` khi có cấu hình), `callback` (đổi mã, gọi `/user`, lưu credential mã hóa theo `user_id`, kiểm tra `returnTo` chỉ nhận `/c/<uuid>` của chính người gọi), `DELETE` chỉ xóa của người gọi, khi token hỏng (`invalid_grant`) thì `GET /api/connections/github` trả `status: 'reconnect_required'`.
- `github-scope.test.ts`: thành viên gọi `PUT /scope` bị 403; admin chọn 2 repo nằm trong `candidate-repos` thành công; chọn 0 repo, 11 repo, hoặc repo không nằm trong danh sách GitHub trả về cho admin thì bị 400 và phạm vi cũ không đổi; thành viên chỉ có quyền trên 1 trong 2 repo thấy `accessible: true` ở repo đó và `status: 'connected'`; thành viên không có quyền trên repo nào thấy `status: 'needs_membership'`.
- `github-shared-credentials.test.ts`: `POST /api/services/github/credentials` và `/scope` trả 410.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/routes/github-connections.test.ts tests/routes/github-scope.test.ts tests/routes/github-shared-credentials.test.ts`
Expected: FAIL với 404 / 200 cũ.

- [ ] **Step 3: Implement routes and update `GITHUB_SERVICE.credentialFields`**

Làm theo đúng cấu trúc `apps/chat-api/src/routes/connections/trello.ts` và `apps/chat-api/src/routes/services-routes.ts` (đã qua audit `#228`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-api -- tests/routes/github-connections.test.ts tests/routes/github-scope.test.ts tests/routes/github-shared-credentials.test.ts tests/routes/services-security.test.ts` và `npm test -w @wap/tool-schemas -- tests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tool-schemas/src/registry/github.ts packages/tool-schemas/tests/schemas.test.ts apps/chat-api/src/routes/connections/github.ts apps/chat-api/src/routes/services-routes.ts apps/chat-api/src/app.ts apps/chat-api/tests/routes/github-connections.test.ts apps/chat-api/tests/routes/github-scope.test.ts apps/chat-api/tests/routes/github-shared-credentials.test.ts apps/chat-api/tests/routes/services-security.test.ts
git commit -m "feat(github): add personal OAuth connection and team repo scope routes"
```

---

### Task 5: Nâng cấp `GitHubAdapter` (`baseUrl`, chặn repo ngoài phạm vi trước HTTP & mở bộ lọc Issue/PR cho AI)

**Files:**
- Modify: `packages/tool-adapters/src/github/github-adapter.ts`
- Test: `packages/tool-adapters/tests/github-adapter.test.ts`

**Interfaces:**
- Consumes: 5 tool `github.*` hiện có (không sửa `packages/tool-schemas/src/github.ts`).
- Produces:
  - `GitHubAdapterConfig` thêm `baseUrl?: string` (mặc định `'https://api.github.com'`, bỏ dấu `/` cuối); `request` và `searchIssues` (`expectedUrl = `${this.apiBase}/repos/${repo}``) dùng `this.apiBase` để `AdapterFactory` và test E2E trỏ được sang fake server cục bộ mà không gọi `https://api.github.com`.
  - `buildIssueSearchQuery(repo: string, rawQuery: string): { q: string; allowPullRequests: boolean }` được xuất từ `github-adapter.ts`:
    - Luôn đặt `repo:${repo}` ở đầu;
    - Cho phép các qualifier hợp lệ: `is:open`, `is:closed`, `is:issue`, `is:pr`, `no:assignee`, `review:none`, `review:required`, `draft:false`, `label:[A-Za-z0-9_.-]+`, `created:(?:>=|<=|>|<)\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?`, `updated:(?:>=|<=|>|<)\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?`;
    - Quy đổi từ khóa ngắn: `*` hoặc `open` → `is:issue is:open`; `unassigned` → `is:issue is:open no:assignee`; `pr` hoặc `pull request` → `is:pr is:open`;
    - Khi có `is:pr` thì `allowPullRequests = true` và `searchIssues` trả cả các mục PR (có `pull_request`); khi không có `is:pr`, giữ nguyên việc đặt `is:issue` và lọc bỏ `pull_request`.
  - Mọi hàm `searchIssues`, `getIssue`, `createIssue`, `addLabel` kiểm tra `this.checkedRepo(args.repo)` và `options?.repo` (nếu truyền từ runner) **trước khi** gọi `this.request(...)`.

- [ ] **Step 1: Write the failing test**

Trong `packages/tool-adapters/tests/github-adapter.test.ts`, thêm các test:
- `search_issues` với `query: 'is:open no:assignee'` gửi `q=repo:octo/app is:issue is:open no:assignee` (không bọc `is:open` trong ngoặc kép);
- `search_issues` với `query: 'is:pr is:open draft:false review:none created:<=2026-10-30T00:00:00Z'` trả về danh sách PR có `pull_request: {}` mà không bị lỗi `GitHub returned a pull request where an issue was required`;
- `search_issues` với `query: '*'` gửi `q=repo:octo/app is:issue is:open`;
- `search_issues` với `query: 'login crash'` (từ khóa thường) vẫn gửi `q=repo:octo/app is:issue "login crash"` và lọc bỏ phần tử có `pull_request` như cũ;
- Khởi tạo `GitHubAdapter` với `baseUrl: 'http://127.0.0.1:9999'` gửi request tới đúng `http://127.0.0.1:9999` và khớp `repository_url: 'http://127.0.0.1:9999/repos/octo/app'`;
- Gọi `get_issue`, `create_issue`, `add_label`, `search_issues` với `repo: 'octo/forbidden'` ngoài `allowedScope.repos` ném `StepError` 403 `AUTH_ERROR` và `fetchFn` có `0` lời gọi.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/tool-adapters -- tests/github-adapter.test.ts`
Expected: FAIL vì `searchIssues` hiện bọc toàn bộ `query` trong `"..."`, chặn `pull_request`, và chưa nhận `baseUrl`.

- [ ] **Step 3: Implement `baseUrl`, `buildIssueSearchQuery` and update `searchIssues` in `github-adapter.ts`**

Giữ nguyên toàn bộ hành vi cũ cho từ khóa thường để mọi test có sẵn trong `github-adapter.test.ts` tiếp tục xanh.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/tool-adapters -- tests/github-adapter.test.ts` và `npm test -w @wap/planner -- tests/read-answers.test.ts tests/schedules.test.ts`
Expected: PASS (xác nhận SHA-256 prompt không đổi).

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/src/github/github-adapter.ts packages/tool-adapters/tests/github-adapter.test.ts
git commit -m "feat(adapters): support baseUrl and issue/PR filter qualifiers in GitHubAdapter"
```

---

### Task 6: Gắn `connections.github` vào `plan_hash`, `AdapterFactory` và `ChatService`

**Files:**
- Modify: `packages/tool-schemas/src/types.ts`
- Create: `apps/chat-api/src/services/github/connection-reference.ts`
- Modify: `apps/chat-api/src/services/registered-services.ts`
- Modify: `apps/chat-api/src/config/gmail-tools-runtime.ts`
- Modify: `apps/chat-api/src/services/chat-service.ts`
- Modify: `apps/chat-api/src/services/adapter-factory.ts`
- Modify: `apps/chat-api/src/services/resource-labels.ts`
- Modify: `apps/chat-api/src/server.ts`
- Modify: `apps/chat-api/tests/services/adapter-factory.test.ts`, `apps/chat-api/tests/integration/gmail-tools.test.ts`, `apps/chat-api/tests/routes/mycalendar-services.test.ts` (đổi dịch vụ mẫu kiểm thử cache dùng chung trong `adapter-factory.test.ts` sang `'notion'`/`'slack'` và bổ sung assertion `mayFallbackToShared` trả `false` cho câu `github`)
- Test: `apps/chat-api/tests/services/github-planning.test.ts`

**Interfaces:**
- Consumes: Task 3 (`GitHubOAuthClient`, `GitHubTokenManager`), Task 4 (`GET` trạng thái), Task 5 (`GitHubAdapter`).
- Produces:
  - `PlanConnections['github'] = { credentialId: string; githubUserId: string; login: string; repos: string[] }`
  - `createGitHubConnectionLookup` trong `apps/chat-api/src/services/github/connection-reference.ts`
  - `getConfiguredToolCatalog` bỏ qua `definition.id === 'github'` (như `'trello'`); `getToolCatalogFor` và `runtimeToolCatalog` chỉ đưa `GITHUB_TOOLS` vào catalog khi người gọi có kết nối GitHub cá nhân `active`, nhóm đã chọn repo, và người gọi truy cập được ít nhất 1 repo trong danh sách nhóm; `mayFallbackToShared` trả `false` khi câu chat định tuyến tới `github`.
  - `AdapterFactory.githubAdapter(context)` kiểm tra `credentialId`, phạm vi repo nhóm, và quyền repo của người gọi ở cả `planning` lẫn `execution` (truyền `baseUrl: this.options.githubApiBaseUrl`).

- [ ] **Step 1: Write the failing test**

Trong `apps/chat-api/tests/services/github-planning.test.ts`, kiểm tra:
- Chưa kết nối GitHub → refusal với `unavailableServices: [{ id: 'github', name: 'GitHub' }]` và gợi ý kết nối GitHub;
- Quản trị chưa chọn repo → refusal `"Quản trị chưa chọn repository GitHub."`;
- Thành viên có quyền trên `nhom/ati` nhưng kế hoạch nhắm vào `nhom/secret` (thuộc phạm vi nhóm nhưng thành viên không có quyền) → refusal `"Bạn cần được cấp quyền vào repository nhom/secret trên GitHub."`;
- Kế hoạch hợp lệ (kể cả khi `repo` là `$ref` tới bước `github.search_repos`) được gắn `connections.github` trước khi tính `plan_hash`; đổi `repos` thì `plan_hash` đổi;
- Lúc thực thi (`phase: 'execution'`), nếu `credentialId` đổi hoặc toàn bộ repo trong kế hoạch bị quản trị gỡ khỏi nhóm hoặc người dùng mất quyền trên repo → `AdapterFactory` ném `StepError` `AUTH_ERROR` trước khi gọi HTTP.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/services/github-planning.test.ts`
Expected: FAIL vì `connections.github` và `githubAdapter` chưa có.

- [ ] **Step 3: Implement GitHub connection binding and `AdapterFactory.githubAdapter`**

Làm theo đúng mẫu `trello` trong `apps/chat-api/src/services/trello/connection-reference.ts`, `chat-service.ts`, `adapter-factory.ts`, `registered-services.ts`, `gmail-tools-runtime.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-api -- tests/services/github-planning.test.ts tests/services/adapter-factory.test.ts tests/services/resource-labels.test.ts tests/integration/gmail-tools.test.ts tests/routes/mycalendar-services.test.ts`
Expected: PASS cả 5 file.

- [ ] **Step 5: Commit**

```bash
git add packages/tool-schemas/src/types.ts apps/chat-api/src/services/github/connection-reference.ts apps/chat-api/src/services/registered-services.ts apps/chat-api/src/config/gmail-tools-runtime.ts apps/chat-api/src/services/chat-service.ts apps/chat-api/src/services/adapter-factory.ts apps/chat-api/src/services/resource-labels.ts apps/chat-api/src/server.ts apps/chat-api/tests/services/github-planning.test.ts apps/chat-api/tests/services/adapter-factory.test.ts apps/chat-api/tests/integration/gmail-tools.test.ts apps/chat-api/tests/routes/mycalendar-services.test.ts
git commit -m "feat(github): bind plans to the caller's personal GitHub connection and repos"
```

---

### Task 7: Hợp đồng "Chế độ chọn" (`manual` vs `auto_digest`) và xác nhận lịch bản tin

**Files:**
- Modify: `packages/tool-schemas/src/types.ts`
- Create: `apps/chat-api/src/services/schedules/github-digest-candidate.ts`
- Modify: `apps/chat-api/src/services/chat-service.ts` (`prepareProposal`)
- Modify: `apps/chat-api/src/services/schedules/schedule-service.ts` (`confirmProposal`, `transition`, `saveFields`)
- Modify: `apps/chat-api/src/db/repositories/schedule-repo.ts` (`view`)
- Modify: `apps/chat-api/src/routes/schedule-routes.ts`
- Test: `apps/chat-api/tests/services/schedules/github-digest-proposal.test.ts`

**Interfaces:**
- Consumes: `PlanConnections['github']` (Task 6), cột `kind` / `digest_*` trên `schedules` (Task 2).
- Produces:
  - `ScheduleApprovalMode = 'manual' | 'auto_digest'`, `GithubDigestConfig`, `GithubDigestDelivery` trong `packages/tool-schemas/src/types.ts`.
  - `ScheduleProposalMetadata.digestCandidate?: { canAutoDigest: boolean; disabledReason?: string; config?: GithubDigestConfig; configHash?: string }`.
  - `ScheduleView` thêm `kind?: 'plan' | 'github_digest'` và `digest?: { config: GithubDigestConfig; approvedAt: string } | null` (chỉ gắn vào object trả về khi `row.kind === 'github_digest'`, để mọi lịch `kind = 'plan'` giữ nguyên từng trường như trước).
  - `computeDigestConfigHash(input: { config: GithubDigestConfig; recurrence: ScheduleRecurrence; userId: string }): string`.
  - `POST /api/conversations/:convId/schedule-proposals/:messageId/confirm` nhận `{ approvalMode?: 'manual' | 'auto_digest' }` (mặc định `'manual'`). Nếu `approvalMode === 'auto_digest'` nhưng `!metadata.digestCandidate?.canAutoDigest` → trả `409` `{ code: 'AUTO_DIGEST_NOT_ALLOWED', message: metadata.digestCandidate?.disabledReason ?? 'Lịch này cần duyệt từng lượt.' }`.
  - Khi xác nhận `update` trên một lịch đang có `kind = 'github_digest'`, `saveFields` tính lại `digest_config_hash` theo `recurrence` và `config` mới, lưu `digest_approved_at = now`.

- [ ] **Step 1: Write the failing test**

Trong `apps/chat-api/tests/services/schedules/github-digest-proposal.test.ts` (trên PostgreSQL thật):
- Câu *"Mỗi sáng 8 giờ, gửi bản tin GitHub repo nhom/ati lên Slack #team"* tạo `schedule_proposal` có `digestCandidate.canAutoDigest === true`, `config.repos = ['nhom/ati']`, `config.channelId = 'C0123456789'`;
- Xác nhận với `{ approvalMode: 'auto_digest' }` lưu `schedules.kind = 'github_digest'` và `digest_config_hash`; xác nhận với `{ approvalMode: 'manual' }` (hoặc không truyền body) lưu `schedules.kind = 'plan'`;
- Câu *"Mỗi sáng 8 giờ, tìm issue mới trên repo nhom/ati, tạo thẻ Trello và báo Slack #team"* tạo `schedule_proposal` có `digestCandidate.canAutoDigest === false` và `disabledReason` giải thích rõ vì có dịch vụ ghi công việc (`trello`); nếu cố gọi `confirm` với `{ approvalMode: 'auto_digest' }` thì nhận 409 `AUTO_DIGEST_NOT_ALLOWED`;
- Sửa giờ (`action: 'update'`, `"Đổi sang 8 giờ 30"`) trên lịch `kind = 'github_digest'` rồi xác nhận: `schedules.version` tăng lên 2 và `digest_config_hash` khớp với `recurrence` `08:30` mới.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/services/schedules/github-digest-proposal.test.ts`
Expected: FAIL vì `digestCandidate` và `approvalMode` chưa có.

- [ ] **Step 3: Implement `github-digest-candidate.ts`, `prepareProposal`, and `confirmProposal`**

Đảm bảo khi `action = 'create' | 'update'` mà không truyền `approvalMode: 'auto_digest'` (trừ khi lịch hiện tại đã là `kind = 'github_digest'` và người dùng không đổi sang `'manual'`), mọi hành vi của lịch `kind = 'plan'` giữ nguyên 100%.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-api -- tests/services/schedules/github-digest-proposal.test.ts tests/services/chat-service-schedules.test.ts tests/routes/schedule-routes.test.ts`
Expected: PASS cả 3 file.

- [ ] **Step 5: Commit**

```bash
git add packages/tool-schemas/src/types.ts apps/chat-api/src/services/schedules/github-digest-candidate.ts apps/chat-api/src/services/chat-service.ts apps/chat-api/src/services/schedules/schedule-service.ts apps/chat-api/src/db/repositories/schedule-repo.ts apps/chat-api/src/routes/schedule-routes.ts apps/chat-api/tests/services/schedules/github-digest-proposal.test.ts
git commit -m "feat(schedules): add approval mode choice and GitHub digest confirmation"
```

---

### Task 8: Thực thi lượt chạy `auto_digest` trong `ScheduleRunner`

**Files:**
- Create: `apps/chat-api/src/services/schedules/github-digest-runner.ts`
- Modify: `apps/chat-api/src/services/schedules/schedule-runner.ts`
- Modify: `apps/chat-api/src/services/schedules/run-state.ts`
- Modify: `apps/chat-api/src/services/schedules/schedule-service.ts` (`REPLANNABLE` thêm `'digest_failed'`)
- Modify: `apps/chat-api/src/config/schedules-runtime.ts`
- Modify: `apps/chat-api/src/server.ts`
- Test: `apps/chat-api/tests/services/schedules/github-digest-runner.test.ts`

**Interfaces:**
- Consumes: `computeDigestConfigHash` (Task 7), `GitHubAdapter` (Task 5), `SlackAdapter`.
- Produces:
  - `escapeSlackMrkdwn(text: string): string` (escape `&`, `<`, `>`, `@channel`, `@here`, `<!...>`).
  - `runGithubDigest(run, convId, signal)` trả `PreparedRun` mở rộng hỗ trợ các kết thúc:
    - `{ state: 'digest_sent'; delivery: GithubDigestDelivery }` (trong `persist(client)` ghi tin nhắn `assistant` `type: 'answer'` chứa nội dung bản tin đã gửi kèm `replyToMessageId: started.messageId` vào `started.convId`, và trong `afterCommit()` phát SSE `answer` + `agent_state: idle` để trang `/c/:convId` hiển thị ngay kết quả khi bấm "Chạy lượt này ngay")
    - `{ state: 'digest_failed'; error: string }`
    - `{ state: 'blocked'; error: string; pauseReason: string }`
    - `{ state: 'discarded' }` (khi phiên bản hoặc trạng thái lịch thay đổi trước bước gọi Slack)
  - Trong `run-state.ts`: `ScheduleRunView` chỉ đính kèm `delivery` khi `row.delivery != null` để không làm đổi các phép so sánh `toEqual` của lịch `kind = 'plan'`.
  - Trong `ScheduleRunner.tick()`: lịch `kind = 'github_digest'` không chạy kiểm tra `lastThreeExpired`.
  - Trong `ScheduleRunner.planOne()`:
    - Kiểm tra `configHash` và quyền GitHub/Slack trước khi đọc;
    - Tính `SINCE` từ `due_at` của lượt `digest_sent` có `trigger = 'scheduled'` gần nhất (lùi 24h cho `daily`/`once`, 7 ngày cho `weekly` nếu chưa có);
    - Đọc 3 mục từ GitHub (`new_issues`, `stale_prs`, `unassigned_issues`), gọi tóm tắt AI tùy chọn với timeout 10s qua `AbortSignal`;
    - Đọc lại `schedules.version` và `status` **ngay trước khi** gọi `slack.send_message`: nếu `version !== started.toPlan.scheduleVersion || status === 'cancelled'` thì trả `discarded` và không gọi Slack;
    - Một khi đã gọi `slack.send_message`, kết quả bắt buộc ghi `digest_sent` (kèm `delivery`) hoặc `digest_failed` (không chuyển sang `discarded`);
    - Trong transaction kết thúc của `planOne()`, khóa `conversations` (`s.conv_id`) cùng lúc với `schedules` (`SELECT s.* FROM schedules s JOIN conversations c ON c.id = s.conv_id WHERE s.id = $1 FOR UPDATE OF c, s`) để khi cần tự tạm dừng lịch (`blocked` hoặc `3 lượt liền gửi thất bại`) và gọi `recordState(client, pausedRow, now)`, thứ tự khóa dòng (`schedule's conversation → schedule → runs → run's conversation`) luôn đồng nhất, không bao giờ deadlock với `confirmProposal`.

- [ ] **Step 1: Write the failing test**

Trong `apps/chat-api/tests/services/schedules/github-digest-runner.test.ts` (trên PostgreSQL thật):
- Lượt `scheduled` đầu tiên đọc GitHub với `SINCE = dueAt - 24h`, escape tiêu đề có `<!channel> & <https://evil.example>`, gửi 1 tin vào đúng `config.channelId`, ghi `status = 'digest_sent'`, `delivery` (có `ts`, `counts`), tin nhắn `answer` trong `conv_id` của lượt chạy, và `pendingCount` của người dùng vẫn bằng `0`;
- Chạy một lượt `manual` ("Chạy lượt này ngay") lúc 08:05 rồi chạy lượt `scheduled` lúc 08:07: lượt `scheduled` lúc 08:07 vẫn dùng `SINCE = 08:07 - 24h`, không dùng `08:05`;
- Sửa trực tiếp `digest_config` trong DB làm lệch `digest_config_hash` → lượt chạy chuyển `blocked`, lịch chuyển `paused` với lý do `"Cấu hình bản tin đã thay đổi, cần xác nhận lại."`, không gọi Slack;
- Trong lúc đang đọc GitHub, người dùng gọi `setStatus(pause)` làm tăng `version` → lượt chạy kết thúc với `discarded` và `slack.send_message` có `0` lời gọi;
- Model tóm tắt AI treo quá timeout → bị hủy bằng `AbortSignal`, bản tin vẫn được gửi lên Slack đầy đủ 3 mục;
- 3 lượt liên tiếp `slack.send_message` trả lỗi → lịch tự chuyển sang `paused` với `pause_reason = '3 lượt liền gửi thất bại'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/services/schedules/github-digest-runner.test.ts`
Expected: FAIL vì `github-digest-runner.ts` chưa có.

- [ ] **Step 3: Implement `github-digest-runner.ts` and integrate with `schedule-runner.ts`**

Tuân thủ chặt thứ tự khóa dòng (`schedule's conversation → schedule → owner → runs → run's conversation`) của `ScheduleRunner` và `ScheduleRepo`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-api -- tests/services/schedules/github-digest-runner.test.ts tests/services/schedules/schedule-runner.test.ts tests/services/schedules/schedule-locks.test.ts`
Expected: PASS cả 3 file.

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/src/services/schedules/github-digest-runner.ts apps/chat-api/src/services/schedules/schedule-runner.ts apps/chat-api/src/services/schedules/run-state.ts apps/chat-api/src/services/schedules/schedule-service.ts apps/chat-api/src/config/schedules-runtime.ts apps/chat-api/src/server.ts apps/chat-api/tests/services/schedules/github-digest-runner.test.ts
git commit -m "feat(schedules): execute auto-digest GitHub runs with pre-send version check"
```

---

### Task 9: Giao diện Kết nối GitHub OAuth và Chế độ chọn trên Thẻ lịch (`apps/chat-web`)

**Files:**
- Create: `apps/chat-web/src/pages/Settings/GitHubConnection.tsx`
- Create: `apps/chat-web/src/services/github-connection.ts`
- Create: `apps/chat-web/src/views/GitHubCallbackView.tsx`
- Modify: `apps/chat-web/src/App.tsx`, `apps/chat-web/src/routes.ts`, `apps/chat-web/src/types.ts`
- Modify: `apps/chat-web/src/pages/Settings/SettingsPage.tsx` và `apps/chat-web/src/pages/Settings/useSettings.ts` (lọc `s.id !== 'trello' && s.id !== 'github'` khỏi danh sách dịch vụ dùng chung)
- Modify: `apps/chat-web/src/pages/Responses/ResponseMoment.tsx`
- Modify: `apps/chat-web/src/pages/Cockpit/PlanMoment.tsx`, `ReceiptMoment.tsx`, `ScheduleMoment.tsx`, `ScheduleRunRecovery.tsx`
- Modify: `apps/chat-web/src/pages/History/ScheduleSection.tsx`
- Modify: `apps/chat-web/src/services/schedule-text.ts` và `api-client.ts`
- Modify: `apps/chat-web/tests/fe-07-settings.test.tsx` và `apps/chat-web/tests/components/settings.test.tsx` (đổi dịch vụ mẫu kiểm thử ngăn kéo khoá dùng chung từ `github` sang dịch vụ dùng chung `slack`/`telegram`)
- Test: `apps/chat-web/tests/github-connection.test.tsx`
- Test: `apps/chat-web/tests/schedule-digest-mode.test.tsx`

**Interfaces:**
- Consumes: các route `/api/connections/github*` (Task 4) và `digestCandidate` / `approvalMode` (Task 7 & 8).
- Produces:
  - Nút `#github-connect` (`Kết nối GitHub`), `#github-disconnect`, vùng chọn repo `#github-scope` cho Admin (tối đa 10 repo); nút `#github-connect` ngay trên thẻ từ chối trong chat (`ResponseMoment.tsx`).
  - Trên `ScheduleMoment.tsx`: khi có đề xuất `create`/`update`, hiển thị 2 lựa chọn radio/segmented cho **Chế độ khi tới giờ**:
    - `#schedule-mode-manual` (`Chờ tôi duyệt mỗi lượt`, mặc định)
    - `#schedule-mode-auto-digest` (`Tự gửi bản tin, không cần duyệt lại` — bật khi `digestCandidate?.canAutoDigest === true`, disabled kèm `disabledReason` khi `false`). Khi chọn `auto_digest`, nút xác nhận hiện `Xác nhận và bật tự gửi` và gửi `{ approvalMode: 'auto_digest' }`.
  - Trên `ScheduleSection.tsx` (trang Nhật ký) và `ScheduleRunRecovery.tsx`: hiển thị nhãn `Tự gửi` cho lịch `kind === 'github_digest'`, trạng thái lượt chạy `digest_sent` (`Đã gửi · N mục`) / `digest_failed` (`Gửi thất bại`), và cho phép bấm chạy lại lượt `digest_failed`.

- [ ] **Step 1: Write the failing test**

- `github-connection.test.tsx`: kiểm tra render chưa kết nối (`#github-connect`, không có ô dán PAT), admin chọn repo (`#github-scope`, chặn lưu 0 repo hoặc > 10 repo), thành viên `needs_membership`, và nút `#github-connect` trên `ResponseMoment` khi `unavailableServices` có `github`.
- `schedule-digest-mode.test.tsx`: kiểm tra `ScheduleMoment` mặc định chọn `#schedule-mode-manual`; khi `digestCandidate.canAutoDigest = true` thì chọn được `#schedule-mode-auto-digest` và bấm xác nhận truyền `approvalMode: 'auto_digest'`; khi `canAutoDigest = false` thì `#schedule-mode-auto-digest` bị `disabled` và hiện `disabledReason`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-web -- tests/github-connection.test.tsx tests/schedule-digest-mode.test.tsx`
Expected: FAIL vì các component mới chưa có.

- [ ] **Step 3: Implement UI components**

Làm theo đúng cấu trúc `TrelloConnection.tsx`, `TrelloCallbackView.tsx`, `ScheduleMoment.tsx` và `ScheduleSection.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-web -- tests/github-connection.test.tsx tests/schedule-digest-mode.test.tsx tests/fe-07-settings.test.tsx tests/components/settings.test.tsx`
Expected: PASS cả 4 file.

- [ ] **Step 5: Commit**

```bash
git add apps/chat-web/src/pages/Settings/GitHubConnection.tsx apps/chat-web/src/services/github-connection.ts apps/chat-web/src/views/GitHubCallbackView.tsx apps/chat-web/src/App.tsx apps/chat-web/src/routes.ts apps/chat-web/src/types.ts apps/chat-web/src/pages/Settings/SettingsPage.tsx apps/chat-web/src/pages/Settings/useSettings.ts apps/chat-web/src/pages/Responses/ResponseMoment.tsx apps/chat-web/src/pages/Cockpit/PlanMoment.tsx apps/chat-web/src/pages/Cockpit/ReceiptMoment.tsx apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx apps/chat-web/src/pages/Cockpit/ScheduleRunRecovery.tsx apps/chat-web/src/pages/History/ScheduleSection.tsx apps/chat-web/src/services/schedule-text.ts apps/chat-web/src/services/api-client.ts apps/chat-web/tests/github-connection.test.tsx apps/chat-web/tests/schedule-digest-mode.test.tsx apps/chat-web/tests/fe-07-settings.test.tsx apps/chat-web/tests/components/settings.test.tsx
git commit -m "feat(web): add GitHub OAuth connection UI and schedule mode selector"
```

---

### Task 10: Sandbox, Browser E2E và Nhật ký bàn giao (`docs/handoff/log/`)

**Files:**
- Modify: `apps/chat-api/src/sandbox/fake-results/github.ts`
- Modify: `apps/chat-api/src/sandbox/scenarios.ts`
- Modify: các file test/eval còn giả định GitHub dùng PAT chung (`git grep -n "service.*github|GITHUB_SERVICE" packages apps evaluations`, ví dụ `apps/chat-api/tests/integration/service-extension.test.ts`, `evaluations/live-execution/live-services.ts`).
- Modify: `scripts/test-v3-browser.mjs`
- Create: `apps/chat-api/tests/sandbox/github-sandbox.test.ts`
- Create: `apps/chat-web/tests/browser/github-oauth-and-digest.spec.ts`
- Create: `docs/handoff/log/2026-11-01-github-oauth-and-digest.md` (theo Mục 4 `AGENTS.md`; không sửa `CURRENT-STATE.md` hay `ROADMAP.md`)

**Interfaces:**
- Consumes: toàn bộ Tasks 1–9.
- Produces:
  - Sandbox kiểm tra `ctx.repo ?? args.repo` thuộc `connections.github.repos` và hỗ trợ kịch bản OAuth giả + lịch chạy bản tin GitHub mà không mở kết nối ra `github.com` hay `api.github.com`.
  - Kịch bản Playwright `github-oauth-and-digest.spec.ts` kiểm chứng trọn vẹn hành trình người dùng trên trình duyệt thật + PostgreSQL thật:
    1. Quản trị kết nối GitHub OAuth, tick chọn repo cho nhóm;
    2. Thành viên kết nối GitHub từ thẻ từ chối trong chat, quay về đúng hội thoại;
    3. Đặt lịch bản tin bằng câu chat → chọn chế độ **"Tự gửi bản tin, không cần duyệt lại"** → xác nhận → bấm **"Chạy lượt này ngay"** → Nhật ký hiển thị **"Đã gửi"**.

- [ ] **Step 1: Write the failing test**

Viết `apps/chat-api/tests/sandbox/github-sandbox.test.ts` và `apps/chat-web/tests/browser/github-oauth-and-digest.spec.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/sandbox/github-sandbox.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement sandbox updates and migrate remaining shared-PAT test fixtures**

Tương tự Task 11 của Trello OAuth (`8c3e6399`), cập nhật `sandbox/fake-results/github.ts` và các fixture còn sót từng chèn `service_credentials` `github` với `user_id IS NULL`. Không nới bất kỳ assertion bảo mật hay `plan_hash` nào.

- [ ] **Step 4: Run full verification suite**

Run:
1. `npm test -w @wap/chat-api -- tests/sandbox/github-sandbox.test.ts`
2. `npm run check`
3. `npm run test:browser:v3 -- tests/browser/github-oauth-and-digest.spec.ts`
Expected: Tất cả PASS (exit code 0).

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/src/sandbox/fake-results/github.ts apps/chat-api/src/sandbox/scenarios.ts apps/chat-api/tests/sandbox/github-sandbox.test.ts apps/chat-web/tests/browser/github-oauth-and-digest.spec.ts scripts/test-v3-browser.mjs docs/handoff/log/2026-11-01-github-oauth-and-digest.md
git commit -m "test(github): add sandbox and browser E2E verification for GitHub OAuth and digest"
```
*(Cùng các file test fixture đã cập nhật từ PAT chung sang OAuth cá nhân — `git add` tường minh từng file).*
