# Trello OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay ô dán API key và token của Trello bằng đăng nhập OAuth 2.0 của từng người, trên tối đa 10 bảng do quản trị chọn trong một workspace.

**Architecture:** Giữ dịch vụ `trello` và chín tool `trello.*`. Máy chủ giữ refresh token đã mã hoá theo `user_id`, access token chỉ trong bộ nhớ, và một phạm vi bảng dùng chung. Adapter gọi Trello bằng header Bearer và từ chối mọi `boardId` ngoài phạm vi của người đang thực thi. Planner gắn kết nối vào kế hoạch trước khi băm. Không có cờ tắt.

**Tech Stack:** TypeScript, Express, PostgreSQL, Vitest, Playwright, Trello OAuth 2.0 confidential client (Atlassian 3LO, PKCE S256).

**Spec:** `docs/superpowers/specs/2026-11-01-trello-oauth-design.md`

**Nhánh:** Tách từ `origin/main` lúc bắt đầu làm. Không làm trên checkout đang chậm hơn remote. Số migration là prefix kế tiếp trong `db/v3/` của nhánh đó, không mặc định `0013`.

## Global Constraints

- Không có biến `TRELLO_OAUTH_ENABLED`. Đưa phần này vào bản đang chạy là ô dán token biến mất.
- Scope gửi đi đúng chuỗi `read:board:trello write:board:trello read:member:trello read:organization:trello offline_access`. Không thêm scope khác. Nếu tên `write:board:trello` không có trên trang client của Trello, đổi hằng số sang tên chính thức phủ cùng bốn việc, rồi sửa test theo tên đó.
- Ủy quyền: `https://auth.atlassian.com/authorize` với `client_id`, `scope`, `redirect_uri`, `response_type=code`, `prompt=consent`, `code_challenge`, `code_challenge_method=S256`. Không gửi `audience`. Đổi mã và làm mới: `https://auth.atlassian.com/oauth/token`. API: `https://api.trello.com/1` với `Authorization: Bearer`. Không gửi `key` hay `token` trên query.
- Một workspace, từ 1 đến 10 bảng. Id bảng khớp `/^[0-9a-f]{24}$/i`. Bảng không thuộc workspace đã chọn không lưu được.
- Access token không ghi vào cơ sở dữ liệu, log, kế hoạch, hay câu trả lời. Refresh token dùng một lần. Lưu token mới và bỏ token cũ trong cùng một transaction.
- Lệnh `create_card`, `update_card`, `add_member`, `add_checklist` vẫn dừng ở duyệt `plan_hash`. Không thêm tool. Không webhook. Không luật tự chạy khi thẻ đổi cột, hết hạn, hoặc tới giờ.
- Sandbox và test không gọi `api.trello.com` hay `auth.atlassian.com`.
- Quản trị là vai trò `admin` đã có. Thành viên không chọn bảng.

## Review Focus

- Refresh token đã dùng một lần bị gửi lại ở lần làm mới thứ hai. Kỳ vọng: lần làm mới thành công thứ hai gửi token vừa lưu, không gửi token đầu. Lần xoay thất bại thì không gọi Trello bằng token cũ và kết nối chuyển `reconnect_required`.
- Token của người dùng mở được một bảng quản trị không chọn. Kỳ vọng: tạo thẻ, đọc thẻ, tìm thẻ, tìm cột, tìm thành viên và thêm checklist đều trả 403 và không ghi lên bảng đó.
- Kế hoạch của người A bị thực thi bằng credential của người B. Kỳ vọng: từ chối trước khi gọi Trello.
- Lưu bảng thứ 11, hoặc bảng của workspace khác. Kỳ vọng: từ chối, phạm vi cũ không đổi.
- Thiếu client secret mà người dùng bấm kết nối. Kỳ vọng: HTTP 503, không có URL sang Atlassian.

---

### Task 1: Cấu hình OAuth

**Files:**
- Modify: `apps/chat-api/src/config/env.ts`
- Test: `apps/chat-api/tests/config/trello-env.test.ts`

**Interfaces:**
- Consumes: `validateEnv` hiện có.
- Produces: `TrelloOAuthConfig` trên kết quả env, tên `config.TRELLO_OAUTH`, các trường `clientId`, `clientSecret`, `redirectUri`, `authorizationUrl`, `tokenUrl`, `apiBaseUrl`. Thiếu một trong ba biến bắt buộc thì `config.TRELLO_OAUTH` là `undefined` và tiến trình vẫn khởi động. Biến bắt buộc: `TRELLO_OAUTH_CLIENT_ID`, `TRELLO_OAUTH_CLIENT_SECRET`, `TRELLO_OAUTH_REDIRECT_URI`. URL giả cho test: `TRELLO_OAUTH_AUTH_URL`, `TRELLO_OAUTH_TOKEN_URL`, `TRELLO_API_BASE_URL`.

- [x] **Step 1: Write the failing test**

`trello-env.test.ts` khẳng định: đủ ba biến thì `TRELLO_OAUTH.redirectUri` là `http://127.0.0.1:5174/connections/trello/callback` và URL mặc định là ba URL ở Global Constraints. Thiếu từng biến bắt buộc thì `TRELLO_OAUTH` là `undefined`. Redirect có query, fragment, userinfo, scheme lạ, hoặc HTTP không phải loopback thì ném lỗi chứa `TRELLO_OAUTH_REDIRECT_URI`.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/config/trello-env.test.ts`
Expected: FAIL vì `TRELLO_OAUTH` chưa có.

- [x] **Step 3: Implement**

Thêm nhánh đọc biến vào `validateEnv`. Không thêm cờ bật tắt. Mặc định URL lấy từ Global Constraints khi biến giả không đặt.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-api -- tests/config/trello-env.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/chat-api/src/config/env.ts apps/chat-api/tests/config/trello-env.test.ts
git commit -m "feat(trello): read the OAuth client config"
```

### Task 2: Migration và kho phạm vi nhóm

**Files:**
- Create: `db/v3/NNNN_trello_oauth.sql`. `NNNN` lớn hơn prefix cao nhất trong `db/v3/` của nhánh làm việc. Checkout cũ có `0012` không được dùng làm căn cứ nếu nhánh đã có số cao hơn.
- Create: `apps/chat-api/src/db/repositories/trello-team-repo.ts`
- Modify: `apps/chat-api/src/db/repositories/credential-repo.ts`
- Test: `apps/chat-api/tests/db/trello-oauth-migration.test.ts`
- Test: `apps/chat-api/tests/db/trello-team-repo.test.ts`

**Interfaces:**
- Consumes: bảng `oauth_states`, `service_credentials`, `users`.
- Produces:
  - `oauth_states` viết lại cả ba ràng buộc theo kiểu `db/v3/0012_mycalendar_personal_connections.sql`: `mode` thêm `connect_trello`, chủ sở hữu bắt buộc `user_id` và `session_id` cho mode đó, `return_to` chỉ nhận `/c/` cộng uuid khi mode là connect. Không chỉ thêm một giá trị vào ràng buộc cũ.
  - `TrelloTeamRepo.get(): Promise<TrelloTeamScope | null>`
  - `TrelloTeamRepo.replace(input: { chosenBy: string; workspaceId: string; workspaceName: string; boards: { boardId: string; boardName: string }[] }): Promise<TrelloTeamScope>`
  - `CredentialRepo.rotatePersonalSecret(input: { service: 'trello'; userId: string; credentialId: string; previousRefreshToken: string; nextRefreshToken: string }): Promise<'rotated' | 'mismatch' | 'missing'>`
  - `TrelloTeamScope` là `{ workspaceId: string; workspaceName: string; boards: { boardId: string; boardName: string }[] }`

- [x] **Step 1: Write the failing test**

Migration, trên PostgreSQL thật theo kiểu `mycalendar-migration.test.ts`: chèn được `oauth_states.mode = 'connect_trello'`; `DELETE` credential `service = 'trello' AND user_id IS NULL` đã nằm trong file SQL; bảng phạm vi không nhận quá 10 bảng và không nhận hai `workspace_id` khác nhau. Repo: `replace` với 11 bảng trả lỗi và không ghi; `replace` workspace mới bỏ hết bảng cũ; `rotatePersonalSecret` hai transaction song song, một `'rotated'`, transaction kia `'mismatch'`, và hàng chỉ còn token mới.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/db/trello-oauth-migration.test.ts tests/db/trello-team-repo.test.ts`
Expected: FAIL vì file SQL và repo chưa có.

- [x] **Step 3: Implement**

Một hàng phạm vi nhóm. Bảng con tối đa 10 dòng, mọi dòng cùng `workspace_id` của hàng đó. Ràng buộc nằm trong SQL, repo kiểm tra lại trước khi ghi. `rotatePersonalSecret` mở transaction, giải mã JSON credential trong transaction đó, so refresh token dạng chữ với `previousRefreshToken`, và chỉ ghi blob mã hoá mới khi khớp. Không so ciphertext. Xoá credential Trello dùng chung trong chính file migration. Không gọi HTTP.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-api -- tests/db/trello-oauth-migration.test.ts tests/db/trello-team-repo.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add db/v3/NNNN_trello_oauth.sql apps/chat-api/src/db/repositories/trello-team-repo.ts apps/chat-api/src/db/repositories/credential-repo.ts apps/chat-api/tests/db/trello-oauth-migration.test.ts apps/chat-api/tests/db/trello-team-repo.test.ts
git commit -m "feat(trello): store the team board scope and rotate refresh tokens"
```

`NNNN` là số đã chọn ở đầu task. Không `git add` cả `db/v3`.

### Task 3: Client OAuth

**Files:**
- Create: `apps/chat-api/src/services/trello/oauth-client.ts`
- Test: `apps/chat-api/tests/services/trello-oauth-client.test.ts`

**Interfaces:**
- Consumes: `TrelloOAuthConfig` từ Task 1.
- Produces:
  - `TRELLO_OAUTH_SCOPE`
  - `class TrelloOAuthError extends Error` với `kind: 'invalid_grant' | 'rejected' | 'network' | 'server'`
  - `class TrelloOAuthClient` với `authorizationUrl({ state, codeChallenge })`, `exchangeCode(code, codeVerifier, signal)`, `refresh(refreshToken, signal)`, `member(accessToken, signal)`, `workspaces(accessToken, signal)`, `boards(accessToken, workspaceId, signal)`
  - `member` trả `{ id: string; username: string }`. `boards` trả `{ id, name, workspaceId, member }[]` và bỏ bảng không có `idOrganization` bằng `workspaceId`.

- [x] **Step 1: Write the failing test**

Dùng `fetch` giả. `authorizationUrl` chứa `client_id`, `redirect_uri`, `response_type=code`, `prompt=consent`, `code_challenge`, `code_challenge_method=S256`, và scope đúng Global Constraints. URL không chứa `audience`. `exchangeCode` gửi `grant_type=authorization_code` và PKCE verifier tới `tokenUrl`. `refresh` gửi `grant_type=refresh_token`. Response lỗi không làm message của `TrelloOAuthError` chứa access token, refresh token, hay authorization code. `boards` loại bảng có `idOrganization` khác workspace được hỏi. `signal` đã abort thì `kind` là `network` và `fetch` không được gọi.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/services/trello-oauth-client.test.ts`
Expected: FAIL vì module chưa có.

- [x] **Step 3: Implement `TrelloOAuthClient`**

Không theo redirect. Mọi request nhận `AbortSignal`. Cắt body quá 64_000 ký tự trước khi đọc, cùng trần với `GmailOAuthClient`.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-api -- tests/services/trello-oauth-client.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/chat-api/src/services/trello/oauth-client.ts apps/chat-api/tests/services/trello-oauth-client.test.ts
git commit -m "feat(trello): add the OAuth client"
```

### Task 4: Token trong bộ nhớ

**Files:**
- Create: `apps/chat-api/src/services/trello/token-manager.ts`
- Test: `apps/chat-api/tests/services/trello-token-manager.test.ts`

**Interfaces:**
- Consumes: `TrelloOAuthClient.refresh`, `CredentialRepo.rotatePersonalSecret`, `CredentialRepo.markReconnectRequired`.
- Produces: `class TrelloTokenManager` với `forConnection(userId, credentialId, refreshToken)` trả `{ getAccessToken(options?: { signal?: AbortSignal; forceRefresh?: boolean }): Promise<string> }` và `clear(userId)`.

- [x] **Step 1: Write the failing test**

Access token còn hạn thì không gọi `refresh`. Hai `getAccessToken` cùng lúc chỉ một lần `refresh`. `refresh` trả token mới thì `rotatePersonalSecret` được gọi với token cũ và token mới, và lần `getAccessToken` hết hạn tiếp theo gửi đúng token mới đó cho `refresh`, không gửi token đầu. Kết quả `'mismatch'` hoặc `'missing'` thì lần gọi sau không dùng refresh token cũ và ném `StepError` category `AUTH_ERROR`, message `Trello cần được kết nối lại.` `signal` abort trong lúc chờ lượt refresh chung thì người gọi đó dừng, lượt refresh kia vẫn xong. `clear` làm lần lấy sau phải refresh lại.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/services/trello-token-manager.test.ts`
Expected: FAIL vì class chưa có.

- [x] **Step 3: Implement**

Làm theo cách một lượt refresh của `GmailTokenManager`: cache theo `userId:credentialId`, timeout refresh 10 giây tách khỏi signal của người gọi, lệch hạn 60 giây. Sau refresh thành công phải `rotatePersonalSecret` trước khi đưa access token cho người gọi, rồi giữ refresh token mới trong bộ nhớ của đúng connection đó. `forConnection` không được đóng cứng token lúc tạo cho mọi lần làm mới sau. Rotate thất bại thì xoá cache và `markReconnectRequired`.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-api -- tests/services/trello-token-manager.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/chat-api/src/services/trello/token-manager.ts apps/chat-api/tests/services/trello-token-manager.test.ts
git commit -m "feat(trello): keep access tokens in memory and rotate refresh tokens"
```

### Task 5: Kết nối của từng người

**Files:**
- Create: `apps/chat-api/src/routes/connections/trello.ts`
- Modify: `apps/chat-api/src/app.ts` (gắn router, chỗ gắn router Gmail)
- Test: `apps/chat-api/tests/routes/trello-connections.test.ts`

**Interfaces:**
- Consumes: Task 3 và Task 4, bảng `oauth_states` mode `connect_trello`.
- Produces:
  - `POST /api/connections/trello/start` body `{ returnTo?: string }` → `{ url: string }`
  - `POST /api/connections/trello/callback` body `{ code: string; state: string }` → `{ username: string; returnTo?: string }`
  - `DELETE /api/connections/trello` → `{ success: true }`
  - `GET /api/connections/trello` → `{ status: 'unconfigured' | 'not_connected' | 'reconnect_required' | 'needs_scope' | 'needs_membership' | 'connected'; username?: string; workspaceName?: string; boards: { boardId: string; boardName: string; member: boolean }[] }`
  - `isTrelloConnectAvailable(options): boolean`

- [x] **Step 1: Write the failing test**

Thiếu `TRELLO_OAUTH` thì start trả 503 body `{ error: 'Trello chưa được cấu hình trên máy chủ.' }` và không có trường `url`. Start có cấu hình thì lưu state mode `connect_trello` gắn user và session, URL không chứa client secret. Callback đổi mã, lưu refresh token mã hoá theo user, không lưu access token. State của người khác trả 400. Disconnect chỉ xoá hàng của người gọi. `returnTo` nhận cuộc hội thoại của chính họ, từ chối cuộc của người khác và chuỗi không phải `/c/` cộng id. CORS của callback giống test Gmail: origin ứng dụng được phép, origin lạ không.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/routes/trello-connections.test.ts`
Expected: FAIL với 404.

- [x] **Step 3: Implement**

Sao cấu trúc `createGmailConnectionRoutes`: state một lần, PKCE, binding trình duyệt, `returnTo` đã có ở migration `0011`. Credential personal `service = 'trello'`. Không đọc credential `user_id` rỗng.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-api -- tests/routes/trello-connections.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/chat-api/src/routes/connections/trello.ts apps/chat-api/src/app.ts apps/chat-api/tests/routes/trello-connections.test.ts
git commit -m "feat(trello): connect and disconnect a personal Trello account"
```

### Task 6: Quản trị chọn workspace và bảng

**Files:**
- Modify: `apps/chat-api/src/routes/connections/trello.ts`
- Test: `apps/chat-api/tests/routes/trello-scope.test.ts`

**Interfaces:**
- Consumes: `TrelloTeamRepo`, `TrelloOAuthClient.workspaces`, `TrelloOAuthClient.boards`, `TrelloOAuthClient.member`.
- Produces:
  - `GET /api/connections/trello/workspaces` → `{ workspaces: { id: string; name: string }[] }`, chỉ admin đã kết nối.
  - `PUT /api/connections/trello/scope` body `{ workspaceId: string; boardIds: string[] }` → `TrelloTeamScope`. Chỉ admin. Mỗi id phải là bảng `member: true` trong đúng workspace, từ 1 đến 10. Lỗi không ghi đè phạm vi cũ.
  - `GET /api/connections/trello` điền `boards[].member` bằng token của người gọi.

- [x] **Step 1: Write the failing test**

Thành viên gọi PUT thì 403. Admin chọn 2 bảng cùng workspace thì GET của thành viên chỉ đánh `member: true` trên bảng người đó thực sự ở. Bảng thứ 11 và bảng workspace khác trả 400, GET vẫn thấy phạm vi cũ. Đổi workspace làm GET chỉ còn bảng mới. Chưa có phạm vi thì status là `needs_scope` với mọi người, kể cả admin. Đã có phạm vi nhưng người gọi không ở bảng nào thì `needs_membership`.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/routes/trello-scope.test.ts`
Expected: FAIL với 404 trên hai route mới.

- [x] **Step 3: Implement**

Danh sách bảng đưa lên UI chỉ lấy từ `boards()` của client, đã lọc theo workspace. Không tin `boardId` thô từ trình duyệt nếu client không trả bảng đó với `member: true`.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-api -- tests/routes/trello-scope.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/chat-api/src/routes/connections/trello.ts apps/chat-api/tests/routes/trello-scope.test.ts
git commit -m "feat(trello): let an admin pin the workspace boards"
```

### Task 7: Adapter Bearer và chặn bảng lạ

**Files:**
- Modify: `packages/tool-adapters/src/trello/types.ts`
- Modify: `packages/tool-adapters/src/trello/base.ts`
- Modify: `packages/tool-adapters/src/trello/read-tools.ts`
- Modify: `packages/tool-adapters/src/trello/write-tools.ts`
- Modify: `apps/chat-api/src/services/transports/trello.ts`
- Modify: mọi chỗ trong `apps/chat-api`, `packages` và `evaluations` còn dựng `TrelloCredentials` bằng `apiKey` hoặc `token`. Tìm bằng `rg "apiKey|TrelloAdapter" apps packages evaluations`.
- Test: `packages/tool-adapters/tests/trello-oauth-scope.test.ts`
- Sửa `packages/tool-adapters/tests/trello-base.test.ts`, `trello-read.test.ts`, `trello-write.test.ts` trong cùng task.

**Interfaces:**
- Consumes: chín tool hiện có.
- Produces: `TrelloCredentials` chỉ còn `{ accessToken: string }`. `TrelloBaseAdapterConfig` thêm `allowedBoardIds: readonly string[]`. `request` đặt header Bearer và không đặt query `key` hay `token`.

- [x] **Step 1: Write the failing test**

`search_boards` với token mở được hai bảng, `allowedBoardIds` có một bảng, thì kết quả chỉ có bảng được phép và URL đã gọi không chứa `key=` hay `token=`. Từ khóa không khớp tên bảng được phép thì kết quả rỗng. `create_card` với `listId` thuộc bảng không được phép thì `StepError` 403 `AUTH_ERROR` và `fetch` không nhận POST tạo thẻ. `update_card` đổi `idList` sang cột của bảng khác thì cùng 403. `get_card`, `search_cards`, `search_lists` và `search_members` với tài nguyên có `idBoard` ngoài `allowedBoardIds` thì cùng 403 và không trả dữ liệu bảng đó. `add_checklist` với `cardId` thuộc bảng ngoài phạm vi thì cùng 403 và không có POST checklist. `add_member` với `memberId` không nằm trong thành viên của bảng thì cùng 403 và không có POST gán người. `signal` abort thì lỗi mạng, không nuốt thành kết quả rỗng.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/tool-adapters -- tests/trello-oauth-scope.test.ts`
Expected: FAIL vì request vẫn gắn query `key` và `token`.

- [x] **Step 3: Implement**

`assertAllowedScope('boards', boardId)` dùng `allowedBoardIds`. Trước khi tạo, sửa, đọc, tìm, gán người hoặc thêm checklist, đọc thẻ, cột hoặc thành viên cha và gọi `assertParentBoard`. Kết quả tìm kiếm bỏ mọi hàng có `idBoard` ngoài phạm vi trước khi trả về. `search_boards` lọc lại theo id được phép sau khi Trello trả về.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/tool-adapters -- tests/trello-oauth-scope.test.ts tests/trello-base.test.ts tests/trello-read.test.ts tests/trello-write.test.ts`
Rồi: `npm run typecheck:v3`
Expected: PASS. `typecheck:v3` không còn chỗ nào dựng Trello bằng `apiKey`.

- [x] **Step 5: Commit**

```bash
git add packages/tool-adapters/src/trello packages/tool-adapters/tests/trello-oauth-scope.test.ts packages/tool-adapters/tests/trello-base.test.ts packages/tool-adapters/tests/trello-read.test.ts packages/tool-adapters/tests/trello-write.test.ts apps/chat-api/src/services/transports/trello.ts
git commit -m "feat(trello): call the API with a bearer token and the selected boards"
```

`git add` thêm từng file khác mà task này đã sửa để `typecheck:v3` xanh. Không `git add` cả thư mục `apps`, `packages` hay `evaluations`. Không thêm `PRODUCT.md` hay `evaluations/golden-independent/member-*.json`.

### Task 8: Planner, duyệt, và lúc chạy

**Files:**
- Modify: `packages/tool-schemas/src/types.ts`
- Modify: `apps/chat-api/src/services/gmail/connection-reference.ts` hoặc file mới `apps/chat-api/src/services/trello/connection-reference.ts`
- Modify: `apps/chat-api/src/services/registered-services.ts` (`getToolCatalogFor`)
- Modify: `apps/chat-api/src/config/gmail-tools-runtime.ts` (`runtimeToolCatalog`)
- Modify: `apps/chat-api/src/services/chat-service.ts`
- Modify: `apps/chat-api/src/services/adapter-factory.ts`
- Modify: `apps/chat-api/src/services/execution-service.ts` ở chỗ lấy credential theo kết nối của kế hoạch
- Modify: `apps/chat-api/src/services/resource-labels.ts`
- Test: `apps/chat-api/tests/services/trello-planning.test.ts`
- Test: `packages/tool-schemas/tests` cho kiểu `PlanConnections['trello']` nếu đã có test khóa các khoá connection.

**Interfaces:**
- Consumes: `GET` trạng thái Task 6, adapter Task 7.
- Produces: `PlanConnections['trello'] = { credentialId: string; memberId: string; username: string; boardIds: string[] }`. `boardIds` đã sắp xếp, là giao của bảng nhóm và bảng người đó đang là thành viên, tại lúc xem trước. Server gắn field này sau khi validator xong và trước khi tính `plan_hash`.

- [x] **Step 1: Write the failing test**

`getToolCatalogFor` và `runtimeToolCatalog` không đưa tool `trello.*` vào catalog của model khi người gọi chưa kết nối, chưa có bảng nhóm, hoặc không là thành viên bảng nào. Người đủ điều kiện thì catalog có đủ chín tool. Chưa kết nối: refusal `reason` chứa `Kết nối Trello` và `unavailableServices` là `[{ id: 'trello', name: 'Trello' }]`. Chưa chọn bảng: reason `Quản trị chưa chọn bảng Trello.` Người chỉ ở một trong hai bảng: kế hoạch tạo thẻ trên bảng kia bị refusal `Bạn cần được thêm vào bảng Bugs trên Trello.` khi tên bảng là `Bugs`. Kế hoạch hợp lệ có `connections.trello` và hash đổi nếu `boardIds` đổi. `resourceLabels` map id bảng và id cột của bước Trello sang tên bảng. Lúc chạy, credential id trong kế hoạch khác credential đang active của người đó thì không gọi adapter. Bảng còn trong hash nhưng đã bị bỏ khỏi phạm vi nhóm thì bước đó lỗi `AUTH_ERROR` trước HTTP. Bảng vẫn còn được chọn nhưng người thực thi không còn là thành viên thì cùng lỗi, trước HTTP.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/services/trello-planning.test.ts`
Expected: FAIL vì `connections.trello` chưa được gắn.

- [x] **Step 3: Implement**

Làm cùng chỗ `ChatService` đang gắn `connections.gmail`. Catalog đưa cho model đi qua `getToolCatalogFor`: Trello không còn nhờ credential dùng chung. `runtimeToolCatalog` ở sandbox cũng bỏ `trello.*` khi người gọi không đủ điều kiện, dù `ALL_TOOLS` hôm nay có sẵn các tool đó. Không đưa refresh token vào object connection. Adapter của bước nhận access token từ `TrelloTokenManager.forConnection` của đúng `userId` trong phiên thực thi, và `allowedBoardIds` là giao của `connections.trello.boardIds` với phạm vi nhóm hiện tại mà người đó vẫn là thành viên. `resourceLabels` lấy tên bảng từ phạm vi nhóm, không từ chữ model bịa.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-api -- tests/services/trello-planning.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/tool-schemas/src/types.ts apps/chat-api/src/services/trello/connection-reference.ts apps/chat-api/src/services/registered-services.ts apps/chat-api/src/config/gmail-tools-runtime.ts apps/chat-api/src/services/chat-service.ts apps/chat-api/src/services/adapter-factory.ts apps/chat-api/src/services/execution-service.ts apps/chat-api/src/services/resource-labels.ts apps/chat-api/tests/services/trello-planning.test.ts
git commit -m "feat(trello): bind the plan to the caller's boards"
```

Nếu connection reference nằm ở file khác, `git add` đúng file đó. Không `git add` cả thư mục `services`.

### Task 9: Bỏ đường dán token

**Files:**
- Modify: `packages/tool-schemas/src/registry/trello.ts`
- Modify: `apps/chat-api/src/routes/services-routes.ts`
- Modify: `apps/chat-api/src/services/registered-services.ts`
- Test: `packages/tool-schemas/tests` file đang khóa `credentialFields` của Trello
- Test: `apps/chat-api/tests/routes/trello-shared-credentials.test.ts`

**Interfaces:**
- Consumes: không.
- Produces: `TRELLO_SERVICE.credentialFields` là `[]`. `POST /api/services/trello/credentials` và `POST /api/services/trello/scope` trả 410 `{ error: 'Trello dùng đăng nhập OAuth.' }`. Catalog tool không đổi tên.

- [x] **Step 1: Write the failing test**

Schema service không còn field `apiKey` hay `token`. POST credential Trello trả 410 và không ghi hàng `user_id` rỗng. Danh sách dịch vụ vẫn có `trello` với `credentialFields` rỗng, không đọc hàng credential dùng chung. Service khác vẫn lưu credential như cũ.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/tool-schemas -- tests` và `npm test -w @wap/chat-api -- tests/routes/trello-shared-credentials.test.ts`
Expected: FAIL vì POST Trello vẫn 200.

- [x] **Step 3: Implement**

Chặn đúng `service === 'trello'` trước nhánh lưu credential chung. `registered-services` không dùng `hasValidCredentials` của token chung để quyết định Trello có trong danh sách dịch vụ. Quyền dùng tool nằm ở Task 8. Đừng đổi chín tool.

- [x] **Step 4: Run test to verify it passes**

Run cùng hai lệnh Step 2.
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/tool-schemas/src/registry/trello.ts apps/chat-api/src/routes/services-routes.ts apps/chat-api/src/services/registered-services.ts apps/chat-api/tests/routes/trello-shared-credentials.test.ts
git commit -m "feat(trello): remove the shared token form"
```

`git add` thêm đúng file test schema nếu task này sửa nó. Không `git add` cả `packages/tool-schemas`.

### Task 10: Màn hình và nút trong hội thoại

**Files:**
- Create: `apps/chat-web/src/pages/Settings/TrelloConnection.tsx`
- Create: `apps/chat-web/src/services/trello-connection.ts`
- Modify: `apps/chat-web/src/pages/Settings/SettingsPage.tsx`
- Modify: `apps/chat-web/src/services/api-client.ts`
- Modify: component lời từ chối đang vẽ nút kết nối Gmail khi `unavailableServices` có `gmail`
- Test: `apps/chat-web/tests/trello-connection.test.tsx`
- Test: `apps/chat-web/tests/browser/trello-oauth.spec.ts`

**Interfaces:**
- Consumes: bốn route Task 5 và hai route Task 6.
- Produces: nút `#trello-connect` nhãn `Kết nối Trello`, nút ngắt `#trello-disconnect`, vùng chọn `#trello-scope` chỉ khi `role === 'admin'`. Callback đọc `code` và `state` rồi POST, sau đó về `returnTo` nếu có.

- [x] **Step 1: Write the failing test**

Render chưa kết nối thì có nút `Kết nối Trello` và không có input API key hay token. Admin `needs_scope` thấy danh sách workspace và không lưu được khi chọn 0 bảng. Thành viên `needs_membership` thấy tên bảng và câu `Bạn cần được thêm vào bảng`. Refusal `unavailableServices: [{ id: 'trello', name: 'Trello' }]` có nút cùng nhãn và gọi start với `returnTo` của cuộc hội thoại. Màn duyệt (`PlanMoment` hoặc `PlanPreview`) và biên nhận (`ExecutionProgress`) của một bước Trello hiện tên bảng từ `resourceLabels` và username từ `connections.trello.username`. Browser: admin chọn một workspace và hai bảng, thành viên kết nối bằng OAuth giả thì câu tạo thẻ trên bảng họ là thành viên tới màn duyệt có đúng tên bảng và username, không tới Trello thật.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-web -- tests/trello-connection.test.tsx`
Expected: FAIL vì component chưa có.

- [x] **Step 3: Implement**

Theo `PersonalGmail.tsx` cho nút kết nối và ngắt. Phần chọn bảng chỉ là checkbox trong workspace admin đã chọn, tối đa 10. Không thêm luật tự chạy trên UI.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-web -- tests/trello-connection.test.tsx`
Rồi: `npm run test:browser:v3 -- tests/browser/trello-oauth.spec.ts`
Expected: PASS. Browser không có request tới `auth.atlassian.com` hay `api.trello.com`.

- [x] **Step 5: Commit**

```bash
git add apps/chat-web/src/pages/Settings/TrelloConnection.tsx apps/chat-web/src/services/trello-connection.ts apps/chat-web/src/pages/Settings/SettingsPage.tsx apps/chat-web/src/services/api-client.ts apps/chat-web/tests/trello-connection.test.tsx apps/chat-web/tests/browser/trello-oauth.spec.ts
git commit -m "feat(trello): connect from settings and from a chat refusal"
```

`git add` thêm đúng file lời từ chối, `PlanMoment` hoặc `PlanPreview`, và `ExecutionProgress` nếu task này sửa chúng. Không `git add` cả `apps/chat-web`.

### Task 11: Sandbox và các test đang giả định token chung

**Files:**
- Modify: `apps/chat-api/src/sandbox/fake-results/trello.ts`
- Modify: test planner, eval, và route còn dựng Trello bằng `apiKey` và `token` dùng chung. Tìm bằng `rg "apiKey" packages apps evaluations`.
- Test: `apps/chat-api/tests/sandbox/trello-sandbox.test.ts`

**Interfaces:**
- Consumes: `PlanConnections['trello']` và adapter Task 7.
- Produces: sandbox trả kết quả giả cho chín tool khi đã có connection, và không mở socket ra ngoài.

- [x] **Step 1: Write the failing test**

Sandbox mode, một bước `trello.create_card` với connection hợp lệ trả kết quả giả và `fetch` giả lập ghi nhận không bị gọi với host `api.trello.com`. Không có connection thì refusal như Task 8, không rơi về token chung.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/sandbox/trello-sandbox.test.ts`
Expected: FAIL

- [x] **Step 3: Implement**

Sửa fixture cũ cho khớp credential personal và `allowedBoardIds`. Không nới test cho đỡ đỏ bằng cách bỏ assertion duyệt `plan_hash`.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-api -- tests/sandbox/trello-sandbox.test.ts`
Rồi: `npm run typecheck:v3`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/chat-api/src/sandbox/fake-results/trello.ts apps/chat-api/tests/sandbox/trello-sandbox.test.ts
git commit -m "test(trello): stop assuming a shared pasted token"
```

Thêm vào lệnh `git add` từng file test hoặc eval còn sửa trong task này. Không `git add` cả thư mục `packages` hay `evaluations`. Không thêm `PRODUCT.md` hay `evaluations/golden-independent/member-*.json` nếu những file đó không thuộc task.
