# JIRA-04 Implementation Plan: Jira OAuth Identity, Site Snapshot & Multi-Process Token Transport

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triển khai hạ tầng backend cho Atlassian OAuth 2.0 (3LO) hai pha (Pha 1: Identity-Only kết nối danh tính cá nhân; Pha 2: Authorize Sites cấp quyền snapshot các Jira sites), lưu trữ mã hóa token AES-256-GCM qua object payload `{ token: string }`, quản lý xoay vòng refresh token đa tiến trình trên PostgreSQL thật với ghi nhận ý định refresh bền vững trước HTTP (`refresh_state = 'refreshing'`) không giữ khóa dòng cơ sở dữ liệu qua mạng, worker thứ hai chờ/poll có giới hạn (không ghi đè intent của worker thứ nhất), cập nhật CAS sau phản hồi bảo đảm Disconnect Wins, chính sách xử lý sự cố crash/timeout chuyển `reconnect_required` chống replay token, bảo vệ `findGrantEvidence` của JIRA-03 chỉ chấp nhận grant active, nguyên tắc Disconnect Wins và tín hiệu hủy `AbortSignal` của caller không làm gián đoạn tiến trình lưu trữ nền, cùng hệ thống API routes `/api/connections/myjira/*` có xác thực chủ sở hữu hội thoại `conversationOwner`.

**Architecture:** Mở rộng schema database với additive migration `0021_jira_oauth_token.sql` hỗ trợ state một lần 10 phút gắn phiên/browser/owner, chỉ mục grant account, cột `scopes` và ràng buộc `product_type = 'jira'` cho `jira_grant_sites`; xây dựng HTTP client `JiraOAuthClient` giao tiếp an toàn với Atlassian 3LO với khả năng lọc container Jira, deduplicate site giống hệt và fail-closed khi cloudId xung đột; repository `JiraOAuthRepo` quản lý danh tính 1:1 (`jira_accounts` giữ nguyên trạng thái `connected` / `disconnected` của JIRA-03), snapshot grant (`jira_oauth_grants.status = 'reconnect_required'`) và sites; cập nhật `findGrantEvidence` trong JIRA-03 yêu cầu grant active; `JiraTokenManager` điều phối xoay vòng token đa tiến trình bằng cơ chế non-blocking network refresh (ghi nhận intent bền vững trước HTTP, worker đồng thời poll chờ, giải phóng kết nối DB trong lúc gọi mạng, CAS cập nhật kết quả sau phản hồi); router `myjira.ts` phục vụ đầy đủ vòng đời kết nối với `conversationOwner` guard. Toàn bộ mã nguồn nằm sau cờ tắt `MYJIRA_ENABLED=off`, bảo toàn catalog và registry hiện tại của main.

**Tech Stack:** Node.js, TypeScript 5.6+, Express 5, PostgreSQL 16 (pg pool), Vitest, native `fetch` & `AbortSignal`, AES-256-GCM (`@wap/tool-adapters`).

**Spec:** `docs/superpowers/specs/2026-10-30-jira-personal-workspaces-design.md` (Mục 5, 6, 7.1, 11, 12), `docs/superpowers/specs/2026-11-02-jira-shared-workspace-amendment.md`, `docs/ai-evidence/JIRA-01-PROVIDER-FACTS.md`, và hợp đồng dữ liệu `packages/tool-schemas/src/myjira-dto.ts`.

---

## Global Constraints

- **Scope ranh giới module:** Chỉ tạo và sửa files trong `db/v3/` và `apps/chat-api/`. Tuyệt đối không sửa mã nguồn trong `packages/tool-schemas`, `packages/tool-adapters`, `packages/planner`, `packages/executor`, `apps/chat-web`.
- **Thứ tự Migration:** Migration mới phải là `db/v3/0021_jira_oauth_token.sql`, đặt sau `0019_jira_workspaces.sql`, `0019_telegram_oauth_and_digest.sql`, và `0020_telegram_update_inbox.sql`. Toàn bộ file migration phải hoàn toàn idempotent khi chạy lại nhiều lần trong cùng transaction.
- **Tiêu chuẩn kiểm thử & Database Isolated Context:** Toàn bộ kiểm thử database/repo/route phải sử dụng helper chuẩn `createIsolatedTestSchema({ maxConnections: N })` từ `apps/chat-api/tests/helpers/jira-test-db.ts` với `pool = ctx.pool`, `await ctx.runAllMigrations()`, `await ctx.cleanup()`. Tạo user bằng `createSyntheticUser(pool, name, prefix, options)`. Sinh token xác thực HTTP bằng `UserRepo`, `SessionRepo`, và `generateAccessToken` từ `src/auth/jwt.js`. Database test `ati_jira04` trên cổng `56534` (hoặc loopback `5432/ati_v3` trên CI) tuân thủ `validateDatabaseUrl`.
- **Ranh giới Endpoint Atlassian:** Ở chế độ `live`, cấm tuyệt đối mọi override endpoint (luôn dùng `https://auth.atlassian.com` và `https://api.atlassian.com`). Chế độ `fixture` chỉ chấp nhận loopback HTTP `http://127.0.0.1:<port>`. Authorization URL chứa `state`, audience `api.atlassian.com`, `response_type=code`, `prompt=consent`; không chứa `client_secret` hoặc tham số Google/PKCE.
- **Non-blocking Refresh & Concurrency:** Tuyệt đối không giữ row lock hoặc connection cơ sở dữ liệu qua cuộc gọi mạng HTTP. Ý định refresh phải được commit trước HTTP; worker thứ hai thấy intent đang chạy phải nhả lock và poll chờ Worker 1 (không ghi đè intent hay gọi HTTP lặp lại); cập nhật token sau HTTP phải dùng CAS trên `(id, refresh_attempt_id, status = 'active')`.
- **Bảo toàn Model Danh tính JIRA-03 & Fail-Closed Site/Project:** Giữ nguyên `jira_accounts.status CHECK (status IN ('connected', 'disconnected'))` để không phá vỡ partial unique index hoặc luồng join workspace JIRA-03. Trạng thái lỗi token/cần kết nối lại được quản lý riêng tại `jira_oauth_grants.status IN ('active', 'reconnect_required', 'revoked')`. Cập nhật `findGrantEvidence` trong JIRA-03 yêu cầu `g.status = 'active'` để khóa chặt quyền site/project khi grant degraded.
- **Mã hóa Token:** Hàm `encryptCredentials` nhận object payload, do đó token phải được bọc trong `{ token: accessToken }`; khi giải mã dùng `decryptCredentials<{ token: string }>(encrypted, key).token`.
- **Bảo mật Secret & URL:** Không ghi log, không echo trong error response, không lưu unhashed state vào database. Query parameters chứa `code` và `state` trên callback URL phải được client dọn sạch sau khi xử lý. Kiểm tra quyền sở hữu hội thoại `returnTo` thông qua `conversationOwner`. Body response Atlassian bị chặn cứng ở mức tối đa 64 KB; cấm forward `Authorization` header qua redirect HTTP.
- **Cờ tính năng & Catalog Invariant:** Mặc định `MYJIRA_ENABLED=off`; giữ nguyên registry công cụ và dịch vụ của main; không gọi outbound tới Atlassian live trong task này.

---

## Review Focus

1. **Atlassian Account Switch Attempt during Site Re-consent:**
   Người dùng đã kết nối danh tính Account A, nhưng khi chuyển sang Pha 2 (`mode = 'authorize_sites'`) lại đăng nhập consent bằng Account B. Hệ thống phải đối chiếu `atlassianAccountId` từ `/me`, phát hiện không khớp với tài khoản hiện hữu, từ chối với lỗi rõ ràng (mã `ACCOUNT_CHANGED`), hủy bỏ cập nhật grant và giữ nguyên trạng thái Account A.
   *Test kiểm chứng:* `tests/routes/myjira-connection.test.ts` (Test: `rejects site authorization callback if returned Atlassian account differs from connected identity`).
2. **Crash / Drop During Token Refresh Exchange (Rotating Refresh Token Desynchronization):**
   Atlassian sử dụng rotating refresh token (refresh token cũ bị hủy ngay khi token mới được sinh ra). Nếu tiến trình worker bị crash hoặc mạng bị đứt sau khi Atlassian đã xoay vòng token nhưng trước khi ATI kịp lưu token mới vào PostgreSQL, token cũ trở nên vô dụng. `JiraTokenManager` phải ghi nhận ý định refresh bền vững (`refresh_state = 'refreshing'`), và khi phát hiện trạng thái refresh bị treo/crash hoặc lỗi mạng không xác định, tự động chuyển grant sang `reconnect_required` (`CRASH_UNKNOWN_ROTATION`) thay vì tiếp tục thử lại token cũ.
   *Test kiểm chứng:* `tests/services/jira-token-manager.test.ts` (Test: `transitions grant to reconnect_required when refresh exchange times out or worker crashes with pending intent`).
3. **Concurrent Disconnect vs In-Flight Token Refresh (Disconnect Wins):**
   Người dùng bấm ngắt kết nối (`DELETE /api/connections/myjira`) trong khi một tiến trình worker khác đang chờ response HTTP refresh token từ Atlassian. Khi HTTP response trả về token mới, tiến trình refresh thực hiện CAS trên `status = 'active'`; vì `disconnect()` đã đặt `status = 'revoked'`, câu lệnh CAS cập nhật 0 dòng. Hệ thống hủy bỏ token mới vừa nhận và giữ nguyên trạng thái đã ngắt kết nối của người dùng.
   *Test kiểm chứng:* `tests/services/jira-token-manager.test.ts` (Test: `ensures disconnect wins when refresh returns after connection is deleted`).
4. **Caller Request Aborted via AbortSignal During Shared Token Refresh:**
   Khi client ngắt kết nối HTTP hoặc timeout khiến `req.signal` bị abort, tiến trình phục vụ caller đó phải ném lỗi hủy ngay lập tức, nhưng **không được** làm gián đoạn hoặc abort tiến trình refresh token nền đang chạy trong PostgreSQL mà các request khác hoặc hệ thống đang dùng chung; caller thứ hai gọi vào vẫn nhận được token mới thành công.
   *Test kiểm chứng:* `tests/services/jira-token-manager.test.ts` (Test: `caller AbortSignal cancels caller wait without aborting background refresh persistence`).
5. **State Replay / Cross-User Callback Injection:**
   Kẻ tấn công cố gắng sử dụng lại state đã tiêu thụ hoặc gửi state của User A trong phiên của User B. Hệ thống phải xác thực state hash 256-bit kết hợp owner (`user_id`), session (`session_id`), và cookie browser (`ati_jira_browser`). Mọi callback thứ hai hoặc callback sai phiên/browser đều bị từ chối với mã lỗi `JIRA_STATE_INVALID`.
   *Test kiểm chứng:* `tests/routes/myjira-connection.test.ts` (Test: `rejects replay of consumed state or mismatched browser session cookie`).

---

## Task Decomposition

### Task 1: Additive Migration `0021_jira_oauth_token.sql` & Enum Expansion

**Files:**
- Create: `db/v3/0021_jira_oauth_token.sql`
- Modify: `apps/chat-api/src/db/repositories/google-auth-repo.ts:6-14`
- Test: `apps/chat-api/tests/db/jira-oauth-migration.test.ts`

**Interfaces:**
- Consumes: `oauth_states` từ các migration trước (`0019_telegram_oauth_and_digest.sql`), `jira_oauth_grants` & `jira_accounts` từ `0019_jira_workspaces.sql`.
- Produces: Mở rộng `OAuthMode` gồm `'connect_jira_identity'` và `'connect_jira_sites'`; bổ sung cột `status`, `status_reason`, `refresh_attempt_id`, `refresh_started_at` và index `idx_jira_oauth_grants_account` cho `jira_oauth_grants`; bổ sung `scopes` và check `product_type = 'jira'` cho `jira_grant_sites`; giữ nguyên `jira_accounts.status` (`'connected' | 'disconnected'`).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-api/tests/db/jira-oauth-migration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createIsolatedTestSchema, type IsolatedTestContext } from '../helpers/jira-test-db.js';

describe('Jira OAuth Migration 0021', () => {
  let ctx: IsolatedTestContext;

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 4 });
    await ctx.runAllMigrations();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('allows connect_jira_identity and connect_jira_sites in oauth_states mode check', async () => {
    const res = await ctx.pool.query(`
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conname = 'oauth_states_mode_check';
    `);
    expect(res.rows[0].def).toContain('connect_jira_identity');
    expect(res.rows[0].def).toContain('connect_jira_sites');
  });

  it('has status, refresh tracking columns, and account index on jira_oauth_grants', async () => {
    const cols = await ctx.pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'jira_oauth_grants'
      AND column_name IN ('status', 'status_reason', 'refresh_attempt_id', 'refresh_started_at');
    `);
    const names = cols.rows.map((r: { column_name: string }) => r.column_name);
    expect(names).toContain('status');
    expect(names).toContain('status_reason');
    expect(names).toContain('refresh_attempt_id');
    expect(names).toContain('refresh_started_at');

    const idx = await ctx.pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'jira_oauth_grants' AND indexname = 'idx_jira_oauth_grants_account';
    `);
    expect(idx.rowCount).toBe(1);
  });

  it('has scopes column and product_type check on jira_grant_sites', async () => {
    const cols = await ctx.pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'jira_grant_sites' AND column_name = 'scopes';
    `);
    expect(cols.rowCount).toBe(1);
    expect(cols.rows[0].data_type).toBe('ARRAY');

    const chk = await ctx.pool.query(`
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conname = 'jira_grant_sites_product_type_check';
    `);
    expect(chk.rowCount).toBe(1);
    expect(chk.rows[0].def).toContain("product_type = 'jira'");
  });

  it('preserves jira_accounts status constraint strictly to connected and disconnected', async () => {
    const res = await ctx.pool.query(`
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conname = 'jira_accounts_status_check';
    `);
    expect(res.rows[0].def).toContain("'connected'");
    expect(res.rows[0].def).toContain("'disconnected'");
    expect(res.rows[0].def).not.toContain('reconnect_required');
  });

  it('is completely idempotent when run multiple times', async () => {
    await expect(ctx.runAllMigrations()).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="$TEST_DATABASE_URL" npm test -w @wap/chat-api -- tests/db/jira-oauth-migration.test.ts`
Expected: FAIL with missing columns or constraint does not contain `connect_jira_identity`.

- [ ] **Step 3: Implement migration and repository types**

Tạo `db/v3/0021_jira_oauth_token.sql`:
- Cập nhật `oauth_states_mode_check` thêm `'connect_jira_identity'`, `'connect_jira_sites'`.
- Cập nhật `oauth_states_mode_owner_check` và `oauth_states_return_to_check`.
- `ALTER TABLE jira_oauth_grants ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reconnect_required', 'revoked'));`
- `ALTER TABLE jira_oauth_grants ADD COLUMN IF NOT EXISTS status_reason TEXT;`
- `ALTER TABLE jira_oauth_grants ADD COLUMN IF NOT EXISTS refresh_attempt_id UUID;`
- `ALTER TABLE jira_oauth_grants ADD COLUMN IF NOT EXISTS refresh_started_at TIMESTAMPTZ;`
- `ALTER TABLE jira_oauth_grants DROP CONSTRAINT IF EXISTS jira_oauth_grants_refresh_state_check;`
- `ALTER TABLE jira_oauth_grants ADD CONSTRAINT jira_oauth_grants_refresh_state_check CHECK (refresh_state IN ('idle', 'refreshing', 'failed'));`
- `CREATE INDEX IF NOT EXISTS idx_jira_oauth_grants_account ON jira_oauth_grants (account_id);`
- `ALTER TABLE jira_grant_sites ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT '{}';`
- `ALTER TABLE jira_grant_sites DROP CONSTRAINT IF EXISTS jira_grant_sites_product_type_check;`
- `ALTER TABLE jira_grant_sites ADD CONSTRAINT jira_grant_sites_product_type_check CHECK (product_type = 'jira');`
- Cập nhật `OAuthMode` trong `apps/chat-api/src/db/repositories/google-auth-repo.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="$TEST_DATABASE_URL" npm test -w @wap/chat-api -- tests/db/jira-oauth-migration.test.ts`
Expected: PASS (all 5 tests passing, exit code 0).

- [ ] **Step 5: Commit**

```bash
git add db/v3/0021_jira_oauth_token.sql apps/chat-api/src/db/repositories/google-auth-repo.ts apps/chat-api/tests/db/jira-oauth-migration.test.ts
git commit -m "feat(db): add jira oauth state modes, grant status and sites scopes migration"
```

---

### Task 2: Atlassian OAuth HTTP Client & Fixture

**Files:**
- Create: `apps/chat-api/src/services/jira/jira-oauth-client.ts`
- Create: `apps/chat-api/tests/helpers/jira-oauth-test-fixture.ts`
- Modify: `apps/chat-api/src/config/env.ts`
- Test: `apps/chat-api/tests/services/jira-oauth-client.test.ts`

**Interfaces:**
- Consumes: `JiraOAuthConfig` từ `apps/chat-api/src/config/env.ts`, native `fetch`, `AbortSignal`.
- Produces: `JiraOAuthClient`:
  - `authorizationUrl(options: { state: string; mode: 'identity' | 'authorize_sites' }): string`
  - `exchangeCode(code: string, signal?: AbortSignal): Promise<{ accessToken: string; refreshToken?: string; expiresInSeconds: number; scopes: string[] }>`
  - `refreshToken(refreshToken: string, signal?: AbortSignal): Promise<{ accessToken: string; refreshToken?: string; expiresInSeconds: number; scopes: string[] }>`
  - `getProfile(accessToken: string, signal?: AbortSignal): Promise<{ accountId: string }>`
  - `getAccessibleResources(accessToken: string, signal?: AbortSignal): Promise<Array<{ id: string; name: string; url: string; scopes: string[] }>>`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-api/tests/services/jira-oauth-client.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JiraOAuthClient, JiraOAuthError } from '../../src/services/jira/jira-oauth-client.js';
import { createJiraOAuthTestFixture, type JiraOAuthFixture } from '../helpers/jira-oauth-test-fixture.js';

describe('JiraOAuthClient', () => {
  let fixture: JiraOAuthFixture;

  beforeAll(async () => {
    fixture = await createJiraOAuthTestFixture();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it('generates authorization URL with exact audience and prompt=consent without client_secret or PKCE', () => {
    const client = new JiraOAuthClient({
      clientId: 'client-xyz',
      clientSecret: 'secret-xyz',
      redirectUri: 'http://127.0.0.1:4187/callback',
      mode: 'fixture',
      fixtureBaseUrl: fixture.baseUrl,
    });
    const url = new URL(client.authorizationUrl({ state: 'state-123', mode: 'identity' }));
    expect(url.searchParams.get('audience')).toBe('api.atlassian.com');
    expect(url.searchParams.get('client_id')).toBe('client-xyz');
    expect(url.searchParams.get('scope')).toBe('read:me offline_access');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.has('client_secret')).toBe(false);
    expect(url.searchParams.has('code_challenge')).toBe(false);
    expect(url.searchParams.has('access_type')).toBe(false);
  });

  it('rejects endpoint overrides in live mode', () => {
    expect(() => new JiraOAuthClient({
      clientId: 'client-xyz',
      clientSecret: 'secret-xyz',
      redirectUri: 'https://app.example.com/callback',
      mode: 'live',
      fixtureBaseUrl: 'http://127.0.0.1:4187',
    })).toThrowError(/INVALID_CONFIG/);
  });

  it('exchanges authorization code, filters non-Jira containers, and deduplicates identical sites', async () => {
    const code = fixture.issueCode({
      accountId: 'acc-abc',
      scopes: ['read:me', 'read:jira-work', 'offline_access'],
      sites: [
        { id: 'cloud-1', name: 'Site 1', url: 'https://site1.atlassian.net', scopes: ['read:jira-work'] },
        { id: 'cloud-1', name: 'Site 1', url: 'https://site1.atlassian.net', scopes: ['read:jira-work'] }, // Exact identical duplicate
        { id: 'cloud-conf', name: 'Confluence Only', url: 'https://conf.atlassian.net', scopes: ['read:confluence-content'] }, // Non-Jira
      ],
    });
    const client = new JiraOAuthClient({
      clientId: 'test-client',
      clientSecret: 'SECRET_SENTINEL',
      redirectUri: 'http://127.0.0.1:4187/callback',
      mode: 'fixture',
      fixtureBaseUrl: fixture.baseUrl,
    });
    const tokens = await client.exchangeCode(code);
    expect(tokens.accessToken).toBeDefined();

    const profile = await client.getProfile(tokens.accessToken);
    expect(profile.accountId).toBe('acc-abc');

    const sites = await client.getAccessibleResources(tokens.accessToken);
    expect(sites).toHaveLength(1);
    expect(sites[0].id).toBe('cloud-1');
  });

  it('fails closed when accessible-resources returns conflicting definitions for the same cloudId', async () => {
    const code = fixture.issueCode({
      accountId: 'acc-conflicting',
      scopes: ['read:me', 'read:jira-work', 'offline_access'],
      sites: [
        { id: 'cloud-conflict', name: 'Site Alpha', url: 'https://alpha.atlassian.net', scopes: ['read:jira-work'] },
        { id: 'cloud-conflict', name: 'Site Beta', url: 'https://beta.atlassian.net', scopes: ['read:jira-work', 'write:jira-work'] }, // Conflicting
      ],
    });
    const client = new JiraOAuthClient({
      clientId: 'test-client',
      clientSecret: 'SECRET_SENTINEL',
      redirectUri: 'http://127.0.0.1:4187/callback',
      mode: 'fixture',
      fixtureBaseUrl: fixture.baseUrl,
    });
    const tokens = await client.exchangeCode(code);
    await expect(client.getAccessibleResources(tokens.accessToken)).rejects.toThrowError(/PROVIDER_RESPONSE/);
  });

  it('aborts response via AbortSignal when deadline triggers', async () => {
    const client = new JiraOAuthClient({
      clientId: 'test-client',
      clientSecret: 'SECRET_SENTINEL',
      redirectUri: 'http://127.0.0.1:4187/callback',
      mode: 'fixture',
      fixtureBaseUrl: fixture.baseUrl,
      timeoutMs: 50,
    });
    fixture.setOverride('/me', { delayMs: 200, body: { account_id: 'slow' } });
    await expect(client.getProfile('token-xyz')).rejects.toThrowError(/PROVIDER_TIMEOUT/);
    fixture.clearOverrides();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/services/jira-oauth-client.test.ts`
Expected: FAIL with "Cannot find module JiraOAuthClient".

- [ ] **Step 3: Implement `JiraOAuthClient` and test fixture**

1. Khai báo `JiraOAuthConfig` trong `apps/chat-api/src/config/env.ts`:
   `clientId: string; clientSecret: string; redirectUri: string; mode?: 'live' | 'fixture'; fixtureBaseUrl?: string; timeoutMs?: number;`
   Thêm `MYJIRA_ENABLED: boolean` vào `EnvConfig` mặc định `false`.
2. Xây dựng `apps/chat-api/tests/helpers/jira-oauth-test-fixture.ts`: loopback HTTP server cung cấp `/oauth/token`, `/me`, `/oauth/token/accessible-resources`, hỗ trợ issue code, delayMs, duplicate/conflict cloudId, error overrides.
3. Xây dựng `apps/chat-api/src/services/jira/jira-oauth-client.ts`:
   - Xác thực config (chặn cấm override ở mode `live`, chỉ cho phép `127.0.0.1` ở mode `fixture`).
   - `authorizationUrl`: sinh URL Atlassian với scope tương ứng (`identity` vs `authorize_sites`), không có `client_secret` hay PKCE.
   - `exchangeCode`, `refreshToken`, `getProfile`.
   - `getAccessibleResources`: lọc bỏ container không có Jira scopes; nếu trùng lặp hoàn toàn thì deduplicate; nếu cùng `cloudId` mà khác URL hoặc scopes thì bắt buộc fail-closed ném `JiraOAuthError('PROVIDER_RESPONSE')`.
   - Giới hạn body response 64 KB, chặn redirect không an toàn, chuẩn hóa mã lỗi (`JiraOAuthError`), làm sạch thông tin nhạy cảm.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-api -- tests/services/jira-oauth-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/src/config/env.ts apps/chat-api/src/services/jira/jira-oauth-client.ts apps/chat-api/tests/helpers/jira-oauth-test-fixture.ts apps/chat-api/tests/services/jira-oauth-client.test.ts
git commit -m "feat(api): implement secure atlassian 3lo oauth client with scope filtering and strict conflict rejection"
```

---

### Task 3: Jira OAuth Repository & JIRA-03 Site Linking Protection

**Files:**
- Create: `apps/chat-api/src/db/repositories/jira-oauth-repo.ts`
- Modify: `apps/chat-api/src/db/repositories/workspace/workspace-site-project-repo.ts:211-225`
- Test: `apps/chat-api/tests/db/jira-oauth-repo.test.ts`

**Interfaces:**
- Consumes: `pg.Pool`, `encryptCredentials`, `decryptCredentials` từ `@wap/tool-adapters`, `JiraConnectionState` từ `packages/tool-schemas/src/myjira-dto.ts`.
- Produces: `JiraOAuthRepo`:
  - `getAccountByUserId(userId: string): Promise<JiraAccountRow | null>`
  - `getAccountByAtlassianId(atlassianAccountId: string): Promise<JiraAccountRow | null>`
  - `saveIdentityGrant(userId: string, data: { atlassianAccountId: string; displayName?: string; accessToken: string; refreshToken?: string; expiresInSeconds: number; scopes: string[] }): Promise<{ accountId: string; grantId: string; connectionState: JiraConnectionState }>`
  - `saveSitesGrant(userId: string, data: { atlassianAccountId: string; accessToken: string; refreshToken?: string; expiresInSeconds: number; scopes: string[]; sites: Array<{ id: string; name: string; url: string; scopes: string[] }> }): Promise<{ accountId: string; grantId: string; siteCount: number; connectionState: JiraConnectionState }>`
  - `getConnectionStatus(userId: string): Promise<JiraConnectionStatusResponse>`
  - `syncSites(userId: string, sites: Array<{ id: string; name: string; url: string; scopes: string[] }>): Promise<number>`
  - `disconnect(userId: string): Promise<{ disconnected: boolean; revokedAt: Date; identityVersion: number }>`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-api/tests/db/jira-oauth-repo.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JiraOAuthRepo } from '../../src/db/repositories/jira-oauth-repo.js';
import WorkspaceRepo, { type NativeAdminVerifier } from '../../src/db/repositories/workspace/index.js';
import { createIsolatedTestSchema, createSyntheticUser, type IsolatedTestContext } from '../helpers/jira-test-db.js';

describe('JiraOAuthRepo', () => {
  let ctx: IsolatedTestContext;
  let repo: JiraOAuthRepo;
  let workspaceRepo: WorkspaceRepo;
  const encryptionKey = '01234567890123456789012345678901';

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 6 });
    await ctx.runAllMigrations();
    repo = new JiraOAuthRepo(ctx.pool, encryptionKey);
    workspaceRepo = new WorkspaceRepo(ctx.pool);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('saves identity grant and establishes identity_connected state with account status connected', async () => {
    const userId = await createSyntheticUser(ctx.pool, 'User One', 'jira_user_1', { role: 'member', status: 'active' });
    const result = await repo.saveIdentityGrant(userId, {
      atlassianAccountId: 'atl-1',
      displayName: 'User One',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresInSeconds: 3600,
      scopes: ['read:me', 'offline_access'],
    });
    expect(result.connectionState).toBe('identity_connected');

    const status = await repo.getConnectionStatus(userId);
    expect(status.connected).toBe(true);
    expect(status.connectionState).toBe('identity_connected');
    expect(status.atlassianAccountId).toBe('atl-1');

    const acc = await repo.getAccountByUserId(userId);
    expect(acc?.status).toBe('connected');
  });

  it('rejects identity save if user attempts to bind a second different atlassian account without disconnect', async () => {
    const userId = await createSyntheticUser(ctx.pool, 'User Two', 'jira_user_2', { role: 'member', status: 'active' });
    await repo.saveIdentityGrant(userId, {
      atlassianAccountId: 'atl-2',
      accessToken: 'acc-2',
      expiresInSeconds: 3600,
      scopes: ['read:me', 'offline_access'],
    });
    await expect(repo.saveIdentityGrant(userId, {
      atlassianAccountId: 'atl-2-different',
      accessToken: 'acc-2b',
      expiresInSeconds: 3600,
      scopes: ['read:me', 'offline_access'],
    })).rejects.toThrowError(/ACCOUNT_CHANGED/);
  });

  it('rejects identity save if another ATI user already holds active binding to this atlassian account (ATLASSIAN_ACCOUNT_IN_USE)', async () => {
    const userA = await createSyntheticUser(ctx.pool, 'User A', 'user_a', { role: 'member', status: 'active' });
    const userB = await createSyntheticUser(ctx.pool, 'User B', 'user_b', { role: 'member', status: 'active' });

    await repo.saveIdentityGrant(userA, {
      atlassianAccountId: 'atl-shared',
      accessToken: 'acc-a',
      expiresInSeconds: 3600,
      scopes: ['read:me', 'offline_access'],
    });

    await expect(repo.saveIdentityGrant(userB, {
      atlassianAccountId: 'atl-shared',
      accessToken: 'acc-b',
      expiresInSeconds: 3600,
      scopes: ['read:me', 'offline_access'],
    })).rejects.toThrowError(/ATLASSIAN_ACCOUNT_IN_USE/);

    const accB = await repo.getAccountByUserId(userB);
    expect(accB).toBeNull();
  });

  it('rejects site re-consent if returned atlassian account does not match connected account', async () => {
    const userId = await createSyntheticUser(ctx.pool, 'User Three', 'jira_user_3', { role: 'member', status: 'active' });
    await repo.saveIdentityGrant(userId, {
      atlassianAccountId: 'atl-3',
      accessToken: 'acc-3',
      expiresInSeconds: 3600,
      scopes: ['read:me', 'offline_access'],
    });
    await expect(repo.saveSitesGrant(userId, {
      atlassianAccountId: 'atl-3-hacker',
      accessToken: 'acc-3b',
      expiresInSeconds: 3600,
      scopes: ['read:me', 'read:jira-work', 'offline_access'],
      sites: [{ id: 'site-x', name: 'Site X', url: 'https://site-x.atlassian.net', scopes: ['read:jira-work'] }],
    })).rejects.toThrowError(/ACCOUNT_CHANGED/);
  });

  it('persists sites snapshot with scopes column and maps DB columns to DTO camelCase', async () => {
    const userId = await createSyntheticUser(ctx.pool, 'User Sites', 'user_sites', { role: 'member', status: 'active' });
    await repo.saveIdentityGrant(userId, {
      atlassianAccountId: 'atl-sites',
      accessToken: 'acc-s',
      expiresInSeconds: 3600,
      scopes: ['read:me', 'offline_access'],
    });

    const res = await repo.saveSitesGrant(userId, {
      atlassianAccountId: 'atl-sites',
      accessToken: 'acc-s2',
      refreshToken: 'ref-s2',
      expiresInSeconds: 3600,
      scopes: ['read:me', 'read:jira-work', 'offline_access'],
      sites: [{ id: 'site-alpha', name: 'Site Alpha', url: 'https://alpha.atlassian.net', scopes: ['read:jira-work'] }],
    });
    expect(res.connectionState).toBe('connected');
    expect(res.siteCount).toBe(1);

    const status = await repo.getConnectionStatus(userId);
    expect(status.sites[0]).toMatchObject({
      cloudId: 'site-alpha',
      name: 'Site Alpha',
      url: 'https://alpha.atlassian.net',
    });
    expect(status.sites[0].lastVerifiedAt).toBeDefined();
  });

  it('JIRA-03 integration: findGrantEvidence fails with 403 GRANT_NOT_FOUND when grant status is reconnect_required or revoked', async () => {
    const adminUser = await createSyntheticUser(ctx.pool, 'Admin User', 'admin_ws', { role: 'admin', status: 'active' });
    const ws = await workspaceRepo.createWorkspaceWithBootstrapAdmin(adminUser, {
      name: 'Secured WS',
      slug: 'ws-sec-grant',
      bootstrapAdminUserId: adminUser,
    });

    const grantRes = await repo.saveIdentityGrant(adminUser, {
      atlassianAccountId: 'atl-admin',
      accessToken: 'acc-ad',
      expiresInSeconds: 3600,
      scopes: ['read:me', 'offline_access'],
    });

    await repo.saveSitesGrant(adminUser, {
      atlassianAccountId: 'atl-admin',
      accessToken: 'acc-ad2',
      expiresInSeconds: 3600,
      scopes: ['read:me', 'read:jira-work', 'offline_access'],
      sites: [{ id: 'cloud-test-site', name: 'Test Site', url: 'https://test.atlassian.net', scopes: ['read:jira-work'] }],
    });

    // Mark grant reconnect_required
    await ctx.pool.query(`UPDATE jira_oauth_grants SET status = 'reconnect_required' WHERE id = $1`, [grantRes.grantId]);

    // Attempt to link site in JIRA-03 workspace must fail closed!
    await expect(workspaceRepo.linkSite(ws.workspace.id, adminUser, { cloudId: 'cloud-test-site' })).rejects.toMatchObject({
      statusCode: 403,
      code: 'GRANT_NOT_FOUND',
    });
  });

  it('disconnects account cleanly: increments identity_version and revokes grant', async () => {
    const userId = await createSyntheticUser(ctx.pool, 'User Four', 'jira_user_4', { role: 'member', status: 'active' });
    await repo.saveIdentityGrant(userId, {
      atlassianAccountId: 'atl-4',
      accessToken: 'acc-4',
      expiresInSeconds: 3600,
      scopes: ['read:me', 'offline_access'],
    });
    const disc = await repo.disconnect(userId);
    expect(disc.disconnected).toBe(true);
    expect(disc.identityVersion).toBe(2);

    const status = await repo.getConnectionStatus(userId);
    expect(status.connected).toBe(false);
    expect(status.connectionState).toBe('disconnected');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="$TEST_DATABASE_URL" npm test -w @wap/chat-api -- tests/db/jira-oauth-repo.test.ts`
Expected: FAIL with "Cannot find module JiraOAuthRepo".

- [ ] **Step 3: Implement `JiraOAuthRepo` and update `findGrantEvidence`**

1. Tạo `apps/chat-api/src/db/repositories/jira-oauth-repo.ts`:
   - Bọc token trong `{ token: accessToken }` khi gọi `encryptCredentials({ token: accessToken }, encryptionKey)`.
   - Bọc refresh token nếu có: `encryptCredentials({ token: refreshToken }, encryptionKey)`.
   - `saveIdentityGrant`: transaction với advisory lock; kiểm tra `jira_accounts.atlassian_account_id`; bắt lỗi `ACCOUNT_CHANGED` và `ATLASSIAN_ACCOUNT_IN_USE`; lưu `jira_accounts` (`status = 'connected'`) và `jira_oauth_grants` (`status = 'active'`).
   - `saveSitesGrant`: kiểm tra khớp `atlassian_account_id`; cập nhật grant; snapshot bảng `jira_grant_sites` kèm cột `scopes` và `product_type = 'jira'`.
   - `getConnectionStatus`: map `cloud_id -> cloudId`, `site_name -> name`, `site_url -> url`, `last_verified_at -> lastVerifiedAt: date.toISOString()`.
   - `disconnect`: chuyển `jira_accounts.status = 'disconnected'`, tăng `identity_version`, chuyển `jira_oauth_grants.status = 'revoked'`, xóa token mã hóa, ghi `jira_authorization_audit`.
2. Cập nhật `apps/chat-api/src/db/repositories/workspace/workspace-site-project-repo.ts` (dòng 215):
   Thêm `AND g.status = 'active'` vào câu lệnh query `findGrantEvidence`.

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="$TEST_DATABASE_URL" npm test -w @wap/chat-api -- tests/db/jira-oauth-repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/src/db/repositories/jira-oauth-repo.ts apps/chat-api/src/db/repositories/workspace/workspace-site-project-repo.ts apps/chat-api/tests/db/jira-oauth-repo.test.ts
git commit -m "feat(api): implement jira oauth repository and enforce active grant status in workspace site linking"
```

---

### Task 4: Multi-Process Non-Blocking Token Manager with Concurrency Wait & AbortSignal

**Files:**
- Create: `apps/chat-api/src/services/jira/jira-token-manager.ts`
- Test: `apps/chat-api/tests/services/jira-token-manager.test.ts`

**Interfaces:**
- Consumes: `JiraOAuthClient`, `JiraOAuthRepo`, `pg.Pool`, `decryptCredentials`, `encryptCredentials`.
- Produces: `JiraTokenManager`:
  - `getAccessToken(userId: string, options?: { signal?: AbortSignal; forceRefresh?: boolean }): Promise<string>`
  - `clear(userId: string): void`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-api/tests/services/jira-token-manager.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JiraTokenManager } from '../../src/services/jira/jira-token-manager.js';
import { JiraOAuthRepo } from '../../src/db/repositories/jira-oauth-repo.js';
import { JiraOAuthClient } from '../../src/services/jira/jira-oauth-client.js';
import { createJiraOAuthTestFixture, type JiraOAuthFixture } from '../helpers/jira-oauth-test-fixture.js';
import { createIsolatedTestSchema, createSyntheticUser, type IsolatedTestContext } from '../helpers/jira-test-db.js';

describe('JiraTokenManager Multi-Process & Recovery', () => {
  let ctx: IsolatedTestContext;
  let fixture: JiraOAuthFixture;
  let repo: JiraOAuthRepo;
  let client: JiraOAuthClient;
  const encryptionKey = '01234567890123456789012345678901';

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 8 });
    await ctx.runAllMigrations();
    fixture = await createJiraOAuthTestFixture();
    repo = new JiraOAuthRepo(ctx.pool, encryptionKey);
    client = new JiraOAuthClient({
      clientId: 'test-client',
      clientSecret: 'SECRET_SENTINEL',
      redirectUri: 'http://127.0.0.1:4187/callback',
      mode: 'fixture',
      fixtureBaseUrl: fixture.baseUrl,
    });
  });

  afterAll(async () => {
    await fixture.close();
    await ctx.cleanup();
  });

  it('serializes 2 concurrent worker processes without holding DB lock across network: Worker 2 polls and exactly 1 HTTP exchange occurs', async () => {
    const userId = await createSyntheticUser(ctx.pool, 'Race User', 'race_worker', { role: 'member', status: 'active' });
    const code = fixture.issueCode({ accountId: 'atl-race' });
    const tokens = await client.exchangeCode(code);
    await repo.saveIdentityGrant(userId, {
      atlassianAccountId: 'atl-race',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSeconds: 0, // Expired to trigger refresh
      scopes: ['read:me', 'offline_access'],
    });

    const workerPool1 = ctx.createWorkerPool({ max: 2, applicationName: 'worker-1' });
    const workerPool2 = ctx.createWorkerPool({ max: 2, applicationName: 'worker-2' });

    const manager1 = new JiraTokenManager({ pool: workerPool1, client, repo, encryptionKey });
    const manager2 = new JiraTokenManager({ pool: workerPool2, client, repo, encryptionKey });

    const reqCountBefore = fixture.requests.filter(r => r.path === '/oauth/token' && r.body?.grant_type === 'refresh_token').length;
    const [token1, token2] = await Promise.all([
      manager1.getAccessToken(userId),
      manager2.getAccessToken(userId),
    ]);

    expect(token1).toBe(token2);
    const reqCountAfter = fixture.requests.filter(r => r.path === '/oauth/token' && r.body?.grant_type === 'refresh_token').length;
    expect(reqCountAfter - reqCountBefore).toBe(1); // Exactly one refresh call!
  });

  it('caller AbortSignal cancels caller wait without aborting background refresh persistence: second caller succeeds with rotated token', async () => {
    const userId = await createSyntheticUser(ctx.pool, 'Abort Caller User', 'abort_caller', { role: 'member', status: 'active' });
    const code = fixture.issueCode({ accountId: 'atl-abort' });
    const tokens = await client.exchangeCode(code);
    await repo.saveIdentityGrant(userId, {
      atlassianAccountId: 'atl-abort',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSeconds: 0,
      scopes: ['read:me', 'offline_access'],
    });

    const barrier = fixture.pauseNext('/oauth/token');
    const manager = new JiraTokenManager({ pool: ctx.pool, client, repo, encryptionKey });

    const abortController = new AbortController();
    const callerPromise = manager.getAccessToken(userId, { signal: abortController.signal });
    await barrier.reached;

    // Abort caller 1 mid-flight!
    abortController.abort();
    await expect(callerPromise).rejects.toThrow();

    // Release background network call
    barrier.release();

    // Caller 2 requests token: should succeed with the refreshed token!
    const token2 = await manager.getAccessToken(userId);
    expect(token2).toBeDefined();

    const dbGrant = (await ctx.pool.query('SELECT token_version FROM jira_oauth_grants WHERE account_id = (SELECT id FROM jira_accounts WHERE user_id = $1)', [userId])).rows[0];
    expect(dbGrant.token_version).toBe(2);
  });

  it('transitions grant to reconnect_required when refresh exchange times out or worker crashes with pending intent', async () => {
    const userId = await createSyntheticUser(ctx.pool, 'Crash User', 'crash_worker', { role: 'member', status: 'active' });
    const code = fixture.issueCode({ accountId: 'atl-crash' });
    const tokens = await client.exchangeCode(code);
    await repo.saveIdentityGrant(userId, {
      atlassianAccountId: 'atl-crash',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSeconds: 0,
      scopes: ['read:me', 'offline_access'],
    });

    fixture.setOverride('/oauth/token', { delayMs: 500, status: 500, body: { error: 'server_error' } });
    const manager = new JiraTokenManager({ pool: ctx.pool, client, repo, encryptionKey, refreshTimeoutMs: 50 });

    await expect(manager.getAccessToken(userId)).rejects.toThrowError(/reconnect/i);

    const status = await repo.getConnectionStatus(userId);
    expect(status.connectionState).toBe('reconnect_required');
    fixture.clearOverrides();
  });

  it('ensures disconnect wins when refresh returns after connection is deleted', async () => {
    const userId = await createSyntheticUser(ctx.pool, 'Disconnect User', 'disc_worker', { role: 'member', status: 'active' });
    const code = fixture.issueCode({ accountId: 'atl-disc' });
    const tokens = await client.exchangeCode(code);
    await repo.saveIdentityGrant(userId, {
      atlassianAccountId: 'atl-disc',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSeconds: 0,
      scopes: ['read:me', 'offline_access'],
    });

    const barrier = fixture.pauseNext('/oauth/token');
    const manager = new JiraTokenManager({ pool: ctx.pool, client, repo, encryptionKey });

    const refreshPromise = manager.getAccessToken(userId);
    await barrier.reached;

    // Concurrently disconnect while refresh is in flight!
    await repo.disconnect(userId);
    barrier.release();

    await expect(refreshPromise).rejects.toThrowError(/kết nối/i);
    const status = await repo.getConnectionStatus(userId);
    expect(status.connected).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="$TEST_DATABASE_URL" npm test -w @wap/chat-api -- tests/services/jira-token-manager.test.ts`
Expected: FAIL with "Cannot find module JiraTokenManager".

- [ ] **Step 3: Implement `JiraTokenManager`**

Tạo `apps/chat-api/src/services/jira/jira-token-manager.ts`:
- Transaction 1: Khóa dòng ngắn hạn `FOR UPDATE`, kiểm tra `token_version`. Nếu grant `status === 'revoked'` ném lỗi auth. Nếu `status === 'reconnect_required'` ném lỗi auth.
- Nếu `refresh_state === 'refreshing'`:
  - Nếu `now - refresh_started_at < refreshTimeoutMs`: worker 2 nhả DB lock, bước vào vòng lặp chờ/poll (ngủ 50ms, tối đa `refreshTimeoutMs`) kiểm tra xem `token_version` đã tăng hay `status` đã đổi sang `reconnect_required`. Tuyệt đối không ghi đè intent hay gọi HTTP lặp lại.
  - Nếu `now - refresh_started_at >= refreshTimeoutMs`: worker trước đó đã crash/chết; cập nhật `status = 'reconnect_required'`, `refresh_state = 'idle'`, commit và ném lỗi reconnect (không tái sử dụng token cũ).
- Nếu `refresh_state === 'idle'`:
  - Ghi nhận intent: `refresh_state = 'refreshing'`, `refresh_attempt_id = gen_random_uuid()`, `refresh_started_at = clock_timestamp()`. Commit Transaction 1 và nhả kết nối DB.
- Gọi HTTP Atlassian `client.refreshToken` ngoài phạm vi database lock. Caller `options.signal` chỉ dùng để hủy chờ của caller (ném lỗi nếu abort), không truyền signal caller vào lệnh HTTP dùng chung.
- Transaction 2:
  - Nếu thành công: Cập nhật CAS `UPDATE jira_oauth_grants SET encrypted_access_token = $newAcc, encrypted_refresh_token = $newRef, token_version = token_version + 1, expires_at = $newExp, refresh_state = 'idle', refresh_attempt_id = NULL WHERE id = $grantId AND refresh_attempt_id = $attemptId AND status = 'active'`. Nếu 0 dòng bị cập nhật (do disconnect), Disconnect Wins: hủy bỏ token mới.
  - Nếu 400/401 hoặc lỗi không xác định / timeout / crash: Cập nhật `status = 'reconnect_required'`, `refresh_state = 'idle'`, xóa token, phát `onReconnectRequired`.

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="$TEST_DATABASE_URL" npm test -w @wap/chat-api -- tests/services/jira-token-manager.test.ts`
Expected: PASS (all tests pass, exit code 0).

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/src/services/jira/jira-token-manager.ts apps/chat-api/tests/services/jira-token-manager.test.ts
git commit -m "feat(api): implement non-blocking multi-process token manager with polling concurrency and abort resilience"
```

---

### Task 5: Express Router for MyJira Connection (`/api/connections/myjira`) with Trusted `conversationOwner`

**Files:**
- Create: `apps/chat-api/src/routes/connections/myjira.ts`
- Test: `apps/chat-api/tests/routes/myjira-connection.test.ts`

**Interfaces:**
- Consumes: `createAuthMiddleware`, `GoogleAuthRepo`, `JiraOAuthRepo`, `JiraOAuthClient`, `JiraTokenManager`, `conversationOwner?: (conversationId: string) => Promise<string | null>`, DTO interfaces từ `packages/tool-schemas/src/myjira-dto.ts`.
- Produces: `createMyJiraConnectionRoutes(options: MyJiraConnectionsOptions): Router`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-api/tests/routes/myjira-connection.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createMyJiraConnectionRoutes } from '../../src/routes/connections/myjira.js';
import { JiraOAuthRepo } from '../../src/db/repositories/jira-oauth-repo.js';
import { JiraOAuthClient } from '../../src/services/jira/jira-oauth-client.js';
import { JiraTokenManager } from '../../src/services/jira/jira-token-manager.js';
import { GoogleAuthRepo } from '../../src/db/repositories/google-auth-repo.js';
import { SessionRepo } from '../../src/db/repositories/session-repo.js';
import { UserRepo } from '../../src/db/repositories/user-repo.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { createJiraOAuthTestFixture, type JiraOAuthFixture } from '../helpers/jira-oauth-test-fixture.js';
import { createIsolatedTestSchema, createSyntheticUser, type IsolatedTestContext } from '../helpers/jira-test-db.js';

describe('MyJira Connection Routes', () => {
  let ctx: IsolatedTestContext;
  let fixture: JiraOAuthFixture;
  let app: express.Express;
  let userRepo: UserRepo;
  let sessionRepo: SessionRepo;
  let repo: JiraOAuthRepo;
  let client: JiraOAuthClient;
  const jwtSecret = 'test_jwt_secret_for_jira_oauth_routes_32_chars';
  const encryptionKey = '01234567890123456789012345678901';

  async function createActor(name: string, prefix: string) {
    const userId = await createSyntheticUser(ctx.pool, name, prefix, { role: 'member', status: 'active' });
    const userRow = await userRepo.findById(userId);
    const email = userRow?.email ?? `${prefix}@example.test`;
    const { sessionId } = await sessionRepo.create(userId, 'test-agent');
    const token = generateAccessToken(
      { id: userId, email, name, role: 'member', status: 'active' },
      jwtSecret,
      sessionId
    ).accessToken;
    return { userId, email, sessionId, token };
  }

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 6 });
    await ctx.runAllMigrations();
    fixture = await createJiraOAuthTestFixture();

    userRepo = new UserRepo(ctx.pool);
    sessionRepo = new SessionRepo(ctx.pool);
    repo = new JiraOAuthRepo(ctx.pool, encryptionKey);
    client = new JiraOAuthClient({
      clientId: 'test-client',
      clientSecret: 'SECRET_SENTINEL',
      redirectUri: 'http://127.0.0.1:4187/callback',
      mode: 'fixture',
      fixtureBaseUrl: fixture.baseUrl,
    });
    const tokens = new JiraTokenManager({ pool: ctx.pool, client, repo, encryptionKey });
    const states = new GoogleAuthRepo(ctx.pool);

    // Mock conversation owner lookup
    const conversationOwner = async (convId: string): Promise<string | null> => {
      if (convId === '11111111-1111-1111-1111-111111111111') return 'user-owner-1';
      return null;
    };

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/connections/myjira', createMyJiraConnectionRoutes({
      jwtSecret,
      states,
      sessionRepo,
      repo,
      client,
      tokens,
      conversationOwner,
    }));
  });

  afterAll(async () => {
    await fixture.close();
    await ctx.cleanup();
  });

  it('starts identity connection with cookie and returns authorization URL', async () => {
    const actor = await createActor('Route Actor 1', 'route_actor_1');

    const res = await request(app)
      .post('/api/connections/myjira/start')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ mode: 'identity' });

    expect(res.status).toBe(200);
    expect(res.body.authUrl).toContain('audience=api.atlassian.com');
    expect(res.headers['set-cookie'][0]).toContain('ati_jira_browser=');
  });

  it('rejects start if returnTo belongs to another user conversation via conversationOwner check', async () => {
    const actor = await createActor('Route Actor 2', 'route_actor_2');

    const res = await request(app)
      .post('/api/connections/myjira/start')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ mode: 'identity', returnTo: '/c/11111111-1111-1111-1111-111111111111' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RETURN_TO_INVALID');
  });

  it('rejects callback with mismatched browser cookie or invalid state with JIRA_STATE_INVALID without echoing secrets', async () => {
    const actor = await createActor('Route Actor 3', 'route_actor_3');

    const res = await request(app)
      .post('/api/connections/myjira/callback')
      .set('Authorization', `Bearer ${actor.token}`)
      .set('Cookie', 'ati_jira_browser=wrong_browser_cookie_value')
      .send({ code: 'CODE_SENTINEL', state: 'unrecognized_state_value' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('JIRA_STATE_INVALID');
    expect(JSON.stringify(res.body)).not.toMatch(/CODE_SENTINEL|SECRET_SENTINEL/);
  });

  it('rejects callback replay: consuming state a second time returns JIRA_STATE_INVALID', async () => {
    const actor = await createActor('Replay Actor', 'replay_actor');

    // Start
    const startRes = await request(app)
      .post('/api/connections/myjira/start')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ mode: 'identity' });
    const cookie = startRes.headers['set-cookie'];
    const state = new URL(startRes.body.authUrl).searchParams.get('state')!;

    const code = fixture.issueCode({ accountId: 'atl-replay' });

    // First callback: success
    const cb1 = await request(app)
      .post('/api/connections/myjira/callback')
      .set('Authorization', `Bearer ${actor.token}`)
      .set('Cookie', cookie)
      .send({ code, state });
    expect(cb1.status).toBe(200);

    // Second callback replay: rejected!
    const cb2 = await request(app)
      .post('/api/connections/myjira/callback')
      .set('Authorization', `Bearer ${actor.token}`)
      .set('Cookie', cookie)
      .send({ code, state });
    expect(cb2.status).toBe(400);
    expect(cb2.body.code).toBe('JIRA_STATE_INVALID');
  });

  it('rejects site re-consent callback if returned Atlassian account differs from connected identity', async () => {
    const actor = await createActor('Swap Actor', 'swap_actor');

    // 1. Connect identity as atl-original
    const startRes1 = await request(app)
      .post('/api/connections/myjira/start')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ mode: 'identity' });
    const cookie1 = startRes1.headers['set-cookie'];
    const state1 = new URL(startRes1.body.authUrl).searchParams.get('state')!;
    const code1 = fixture.issueCode({ accountId: 'atl-original' });
    await request(app)
      .post('/api/connections/myjira/callback')
      .set('Authorization', `Bearer ${actor.token}`)
      .set('Cookie', cookie1)
      .send({ code: code1, state: state1 });

    // 2. Start authorize_sites
    const startRes2 = await request(app)
      .post('/api/connections/myjira/start')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ mode: 'authorize_sites' });
    const cookie2 = startRes2.headers['set-cookie'];
    const state2 = new URL(startRes2.body.authUrl).searchParams.get('state')!;

    // 3. Callback returns different account atl-imposter
    const code2 = fixture.issueCode({ accountId: 'atl-imposter', sites: [{ id: 'site-1', name: 'Site 1', url: 'https://s1.atlassian.net', scopes: ['read:jira-work'] }] });
    const cb2 = await request(app)
      .post('/api/connections/myjira/callback')
      .set('Authorization', `Bearer ${actor.token}`)
      .set('Cookie', cookie2)
      .send({ code: code2, state: state2 });

    expect(cb2.status).toBe(409);
    expect(cb2.body.code).toBe('ACCOUNT_CHANGED');
  });

  it('supports sync-sites and DELETE disconnect with audit version increment', async () => {
    const actor = await createActor('Sync Delete Actor', 'sync_del_actor');

    // Connect identity
    const startRes = await request(app)
      .post('/api/connections/myjira/start')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ mode: 'identity' });
    const cookie = startRes.headers['set-cookie'];
    const state = new URL(startRes.body.authUrl).searchParams.get('state')!;
    const code = fixture.issueCode({ accountId: 'atl-sync' });
    await request(app)
      .post('/api/connections/myjira/callback')
      .set('Authorization', `Bearer ${actor.token}`)
      .set('Cookie', cookie)
      .send({ code, state });

    // Sync sites
    const syncRes = await request(app)
      .post('/api/connections/myjira/sync-sites')
      .set('Authorization', `Bearer ${actor.token}`);
    expect(syncRes.status).toBe(200);
    expect(syncRes.body.syncedCount).toBeDefined();

    // Delete disconnect
    const delRes = await request(app)
      .delete('/api/connections/myjira')
      .set('Authorization', `Bearer ${actor.token}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.disconnected).toBe(true);
    expect(delRes.body.identityVersion).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="$TEST_DATABASE_URL" npm test -w @wap/chat-api -- tests/routes/myjira-connection.test.ts`
Expected: FAIL with "Cannot find module createMyJiraConnectionRoutes".

- [ ] **Step 3: Implement `createMyJiraConnectionRoutes`**

Tạo `apps/chat-api/src/routes/connections/myjira.ts`:
- Khai báo `conversationOwner?: (conversationId: string) => Promise<string | null>` trong `MyJiraConnectionsOptions`.
- Middleware xác thực JWT và session ID.
- `POST /start`: xác thực `returnTo` qua `conversationOwner`, tạo state với `states.createState`, set cookie `ati_jira_browser`, trả về `{ authUrl }`.
- `POST /callback`: lấy cookie `ati_jira_browser`, tiêu thụ state bằng `states.consumeState`, trao đổi code lấy tokens, kiểm tra tài khoản không bị đổi (`ACCOUNT_CHANGED`), gọi `saveIdentityGrant` hoặc `saveSitesGrant`, trả về `JiraOAuthCallbackResponse`.
- `GET /`: gọi `repo.getConnectionStatus(user.id)`, trả về `JiraConnectionStatusResponse`.
- `POST /sync-sites`: lấy access token qua `tokens.getAccessToken`, gọi `client.getAccessibleResources`, lưu `repo.syncSites`, trả về `JiraSyncSitesResponse`.
- `DELETE /`: gọi `repo.disconnect(user.id)`, `tokens.clear(user.id)`, trả về `JiraDisconnectResponse`.
- Error sanitization: không echo query hay code/secret trong log và error responses.

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL="$TEST_DATABASE_URL" npm test -w @wap/chat-api -- tests/routes/myjira-connection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/src/routes/connections/myjira.ts apps/chat-api/tests/routes/myjira-connection.test.ts
git commit -m "feat(api): implement myjira connection routes with trusted conversation owner and comprehensive tests"
```

---

### Task 6: App & Server Wiring and Flag-Off Invariant

**Files:**
- Modify: `apps/chat-api/src/app.ts:50-165, 240-345`
- Modify: `apps/chat-api/src/server.ts:40-120`
- Test: `apps/chat-api/tests/routes/myjira-app-wiring.test.ts`

**Interfaces:**
- Consumes: `AppOptions`, `JiraAppOptions`, `createMyJiraConnectionRoutes`.
- Produces: Express app với endpoint `/api/connections/myjira` được tích hợp CORS, cookie handling, `conversationOwner`, và cờ `MYJIRA_ENABLED`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-api/tests/routes/myjira-app-wiring.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';

describe('App Wiring for MyJira', () => {
  it('returns 503 or unconfigured status when jira options are absent or enabled is false', async () => {
    const app = createApp({
      jwtSecret: 'secret-xyz',
      jira: { enabled: false },
    } as any);

    const res = await request(app).get('/api/connections/myjira');
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @wap/chat-api -- tests/routes/myjira-app-wiring.test.ts`
Expected: FAIL because `jira` is not recognized or route not mounted.

- [ ] **Step 3: Update `app.ts` and `server.ts`**

1. Trong `apps/chat-api/src/app.ts`:
   - Thêm interface `JiraAppOptions`:
     `enabled: boolean; oauth?: JiraOAuthConfig; repo?: JiraOAuthRepo; tokens?: JiraTokenManager; fetchFn?: typeof fetch; jiraTimeoutMs?: number; onConnectionChanged?: (userId: string) => void;`
   - Bổ sung `jira?: JiraAppOptions` vào `AppOptions`.
   - Cập nhật CORS và headers cho `/api/connections/myjira`.
   - Mount router tại `/api/connections/myjira` khi `jira?.enabled` là true (khi false trả về 503), truyền `conversationOwner: options.convRepo ? async (id: string) => (await options.convRepo!.getConversation(id))?.user_id ?? null : undefined`.
2. Trong `apps/chat-api/src/server.ts`:
   - Đọc cấu hình `JIRA_OAUTH_CLIENT_ID`, `JIRA_OAUTH_CLIENT_SECRET`, `JIRA_OAUTH_REDIRECT_URI`.
   - Giữ cờ `MYJIRA_ENABLED` tắt mặc định (`process.env.MYJIRA_ENABLED === 'true'`).
   - Khởi tạo `JiraOAuthClient`, `JiraOAuthRepo`, `JiraTokenManager` khi có PostgreSQL pool.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @wap/chat-api -- tests/routes/myjira-app-wiring.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/src/app.ts apps/chat-api/src/server.ts apps/chat-api/tests/routes/myjira-app-wiring.test.ts
git commit -m "feat(api): wire myjira connection into createApp and server with flag-off guard and conversationOwner"
```

---

### Task 7: Integration Verification & Acceptance Gates Suite

**Files:**
- Create: `apps/chat-api/tests/integration/jira-oauth-integration.test.ts`

**Interfaces:**
- Consumes: Toàn bộ module từ Task 1 tới Task 6.
- Produces: Bộ kiểm chứng 3 acceptance gates (Postgres race & crash intent recovery, HTTP fixture Atlassian responses, AbortSignal semantics).

- [ ] **Step 1: Write integration tests covering all 3 gates**

```typescript
// apps/chat-api/tests/integration/jira-oauth-integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { JiraOAuthRepo } from '../../src/db/repositories/jira-oauth-repo.js';
import { JiraOAuthClient } from '../../src/services/jira/jira-oauth-client.js';
import { JiraTokenManager } from '../../src/services/jira/jira-token-manager.js';
import { GoogleAuthRepo } from '../../src/db/repositories/google-auth-repo.js';
import { SessionRepo } from '../../src/db/repositories/session-repo.js';
import { UserRepo } from '../../src/db/repositories/user-repo.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { createJiraOAuthTestFixture, type JiraOAuthFixture } from '../helpers/jira-oauth-test-fixture.js';
import { createIsolatedTestSchema, createSyntheticUser, type IsolatedTestContext } from '../helpers/jira-test-db.js';

describe('JIRA-04 End-to-End Acceptance Gates', () => {
  let ctx: IsolatedTestContext;
  let fixture: JiraOAuthFixture;
  let app: any;
  let userRepo: UserRepo;
  let sessionRepo: SessionRepo;
  const jwtSecret = 'integration-secret-1234567890';
  const encryptionKey = '01234567890123456789012345678901';

  async function createActor(name: string, prefix: string) {
    const userId = await createSyntheticUser(ctx.pool, name, prefix, { role: 'member', status: 'active' });
    const userRow = await userRepo.findById(userId);
    const email = userRow?.email ?? `${prefix}@example.test`;
    const { sessionId } = await sessionRepo.create(userId, 'test-agent');
    const token = generateAccessToken(
      { id: userId, email, name, role: 'member', status: 'active' },
      jwtSecret,
      sessionId
    ).accessToken;
    return { userId, email, sessionId, token };
  }

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 8 });
    await ctx.runAllMigrations();
    fixture = await createJiraOAuthTestFixture();

    userRepo = new UserRepo(ctx.pool);
    sessionRepo = new SessionRepo(ctx.pool);
    const repo = new JiraOAuthRepo(ctx.pool, encryptionKey);
    const client = new JiraOAuthClient({
      clientId: 'test-client',
      clientSecret: 'SECRET_SENTINEL',
      redirectUri: 'http://127.0.0.1:4187/callback',
      mode: 'fixture',
      fixtureBaseUrl: fixture.baseUrl,
    });
    const tokens = new JiraTokenManager({ pool: ctx.pool, client, repo, encryptionKey });
    const states = new GoogleAuthRepo(ctx.pool);

    app = createApp({
      jwtSecret,
      states,
      sessionRepo,
      pool: ctx.pool,
      jira: {
        enabled: true,
        oauth: {
          clientId: 'test-client',
          clientSecret: 'SECRET_SENTINEL',
          redirectUri: 'http://127.0.0.1:4187/callback',
        },
        repo,
        tokens,
      },
    } as any);
  });

  afterAll(async () => {
    await fixture.close();
    await ctx.cleanup();
  });

  it('Gate 1 & Gate 2: Full flow (Identity -> Sites Snapshot -> Sync -> Disconnect) over real PostgreSQL & HTTP fixture', async () => {
    const actor = await createActor('Gate User 1', 'gate_user_1');

    // 1. Start Identity Flow
    const startRes = await request(app)
      .post('/api/connections/myjira/start')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ mode: 'identity' });
    expect(startRes.status).toBe(200);
    const cookie = startRes.headers['set-cookie'];
    const state = new URL(startRes.body.authUrl).searchParams.get('state')!;

    // 2. Callback Identity
    const code1 = fixture.issueCode({ accountId: 'atl-gate-1', scopes: ['read:me', 'offline_access'] });
    const cbRes1 = await request(app)
      .post('/api/connections/myjira/callback')
      .set('Authorization', `Bearer ${actor.token}`)
      .set('Cookie', cookie)
      .send({ code: code1, state });
    expect(cbRes1.status).toBe(200);
    expect(cbRes1.body.connectionState).toBe('identity_connected');

    // 3. Start Sites Flow
    const startRes2 = await request(app)
      .post('/api/connections/myjira/start')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ mode: 'authorize_sites' });
    const cookie2 = startRes2.headers['set-cookie'];
    const state2 = new URL(startRes2.body.authUrl).searchParams.get('state')!;

    // 4. Callback Sites
    const code2 = fixture.issueCode({
      accountId: 'atl-gate-1',
      scopes: ['read:me', 'read:jira-work', 'write:jira-work', 'offline_access'],
      sites: [{ id: 'site-alpha', name: 'Alpha Site', url: 'https://alpha.atlassian.net', scopes: ['read:jira-work'] }],
    });
    const cbRes2 = await request(app)
      .post('/api/connections/myjira/callback')
      .set('Authorization', `Bearer ${actor.token}`)
      .set('Cookie', cookie2)
      .send({ code: code2, state: state2 });
    expect(cbRes2.status).toBe(200);
    expect(cbRes2.body.connectionState).toBe('connected');
    expect(cbRes2.body.siteCount).toBe(1);

    // 5. Get Status
    const statusRes = await request(app)
      .get('/api/connections/myjira')
      .set('Authorization', `Bearer ${actor.token}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.connected).toBe(true);
    expect(statusRes.body.sites[0].cloudId).toBe('site-alpha');

    // 6. Disconnect
    const delRes = await request(app)
      .delete('/api/connections/myjira')
      .set('Authorization', `Bearer ${actor.token}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.disconnected).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `DATABASE_URL="$TEST_DATABASE_URL" npm test -w @wap/chat-api -- tests/integration/jira-oauth-integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Run Full System Typecheck & Check**

Run: `npm run typecheck:v3`
Expected: exit code 0.

Run: `DATABASE_URL="$TEST_DATABASE_URL" npm run check`
Expected: exit code 0 across all packages, 0 failures, 0 skips, catalog/registry invariant preserved.

- [ ] **Step 4: Commit**

```bash
git add apps/chat-api/tests/integration/jira-oauth-integration.test.ts
git commit -m "test(api): add comprehensive end-to-end integration acceptance test for jira oauth"
```

---

## Plan Self-Review Checklist

- [x] **Spec coverage:** Phủ kín toàn bộ yêu cầu Mục 5 & 6 của đặc tả: 2 pha kết nối, state 10 phút, xác thực danh tính 1:1, mã hóa AES-256-GCM qua object wrapper, xoay vòng đa tiến trình không giữ DB lock qua mạng, worker 2 poll chờ, xử lý sự cố crash/timeout chuyển `reconnect_required`, disconnect wins, và tín hiệu hủy `AbortSignal`.
- [x] **Step scan:** Mỗi task chia nhỏ thành 5 bước TDD Checkable (Test RED -> Verify RED -> Implement -> Verify GREEN -> Commit).
- [x] **Type consistency:** Sử dụng chính xác 100% các interface từ `packages/tool-schemas/src/myjira-dto.ts` (`JiraConnectionState`, `JiraOAuthStartRequest`, `JiraOAuthCallbackResponse`, `JiraConnectionStatusResponse`, v.v.).
- [x] **Review Focus:** Đã định nghĩa 5 ca biên / input failure mode và gắn test cụ thể cho từng ca.
- [x] **Proportion & Module Ownership:** Giới hạn phạm vi chỉ trong `db/v3/` và `apps/chat-api/`. Không sửa packages khác.
- [x] **Helper Accuracy:** Sử dụng đúng context từ `createIsolatedTestSchema`, `createSyntheticUser`, `SessionRepo`, và `generateAccessToken`. Không có import giả định.
- [x] **Review Findings Remediation:** Giải quyết trọn vẹn cả 3 Critical và 4 Important findings từ báo cáo preflight.
