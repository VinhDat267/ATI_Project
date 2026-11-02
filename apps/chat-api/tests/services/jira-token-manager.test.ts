import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { JiraTokenManager } from '../../src/services/jira/jira-token-manager.js';
import { JiraOAuthRepo } from '../../src/db/repositories/jira-oauth-repo.js';
import { JiraOAuthClient } from '../../src/services/jira/jira-oauth-client.js';
import { createJiraOAuthTestFixture, type JiraOAuthFixture } from '../helpers/jira-oauth-test-fixture.js';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';
import { decryptCredentials } from '@wap/tool-adapters';

describe('JiraTokenManager Multi-Process & Recovery (Task 4)', () => {
  let ctx: IsolatedTestContext;
  let fixture: JiraOAuthFixture;
  let repo: JiraOAuthRepo;
  let client: JiraOAuthClient;
  const encryptionKey = '01234567890123456789012345678901';

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 10 });
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

  beforeEach(() => {
    fixture.clearOverrides();
  });

  async function seedUserWithGrant(options?: {
    name?: string;
    prefix?: string;
    accountId?: string;
    expired?: boolean;
    scopes?: string[];
  }): Promise<{ userId: string; atlassianAccountId: string; accessToken: string; refreshToken?: string }> {
    const prefix = options?.prefix ?? 'jira_token_user';
    const name = options?.name ?? 'Token Manager User';
    const userId = await createSyntheticUser(ctx.pool, name, prefix, { role: 'member', status: 'active' });
    const atlassianAccountId = options?.accountId ?? `atl-${randomUUID().slice(0, 8)}`;
    const code = fixture.issueCode({
      accountId: atlassianAccountId,
      scopes: options?.scopes ?? ['read:me', 'offline_access'],
      expiresInSeconds: 3600,
    });
    const tokens = await client.exchangeCode(code);

    await repo.saveIdentityGrant(userId, {
      atlassianAccountId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresInSeconds: options?.expired ? 0 : 3600,
      scopes: options?.scopes ?? ['read:me', 'offline_access'],
    });

    if (options?.expired) {
      await ctx.pool.query(
        `UPDATE jira_oauth_grants
         SET expires_at = NOW() - INTERVAL '1 minute'
         WHERE account_id = (SELECT id FROM jira_accounts WHERE user_id = $1)`,
        [userId]
      );
    }

    return {
      userId,
      atlassianAccountId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  // --------------------------------------------------------------------------
  it('refreshes a token that expires within the 60-second safety window', async () => {
    const { userId } = await seedUserWithGrant({ prefix: 'expiry_window' });
    await ctx.pool.query(
      "UPDATE jira_oauth_grants SET expires_at = NOW() + INTERVAL '30 seconds' WHERE account_id = (SELECT id FROM jira_accounts WHERE user_id = $1)",
      [userId]
    );
    const before = fixture.requests.filter((r) => r.path === '/oauth/token' && r.body?.grant_type === 'refresh_token').length;
    const manager = new JiraTokenManager({ pool: ctx.pool, client, repo, encryptionKey });
    const token = await manager.getAccessToken(userId);
    const after = fixture.requests.filter((r) => r.path === '/oauth/token' && r.body?.grant_type === 'refresh_token').length;
    expect(token).toBeDefined();
    expect(after - before).toBe(1);
  });
  // 1. Two concurrent workers contend with only 1 HTTP refresh & no DB lock held during network
  // --------------------------------------------------------------------------
  it('serializes 2 concurrent worker processes without holding DB lock across network: Worker 2 polls and exactly 1 HTTP exchange occurs', async () => {
    const { userId } = await seedUserWithGrant({ prefix: 'race_worker', expired: true });

    // Separate worker pools simulating independent Node.js processes
    const workerPool1 = ctx.createWorkerPool({ max: 2, applicationName: 'worker-1' });
    const workerPool2 = ctx.createWorkerPool({ max: 2, applicationName: 'worker-2' });

    const repo1 = new JiraOAuthRepo(workerPool1, encryptionKey);
    const repo2 = new JiraOAuthRepo(workerPool2, encryptionKey);

    const manager1 = new JiraTokenManager({ pool: workerPool1, client, repo: repo1, encryptionKey });
    const manager2 = new JiraTokenManager({ pool: workerPool2, client, repo: repo2, encryptionKey });

    const barrier = fixture.pauseNext('/oauth/token');
    const reqCountBefore = fixture.requests.filter(
      (r) => r.path === '/oauth/token' && r.body?.grant_type === 'refresh_token'
    ).length;

    // Worker 1 initiates refresh
    const p1 = manager1.getAccessToken(userId);
    await barrier.reached;

    // --- PROOF OF NO DB ROW LOCK HELD ACROSS NETWORK ---
    // While Worker 1 is suspended at HTTP network call, prove that NO transaction or row lock
    // is held on jira_oauth_grants. In PostgreSQL, SELECT ... FOR UPDATE NOWAIT on the grant row
    // would immediately throw 55P03 (could_not_obtain_lock) if Worker 1 held an open lock.
    const lockCheckRes = await ctx.pool.query(
      `SELECT id, refresh_state, refresh_attempt_id
       FROM jira_oauth_grants
       WHERE account_id = (SELECT id FROM jira_accounts WHERE user_id = $1)
       FOR UPDATE NOWAIT`,
      [userId]
    );
    expect(lockCheckRes.rowCount).toBe(1);
    expect(lockCheckRes.rows[0].refresh_state).toBe('refreshing');
    expect(lockCheckRes.rows[0].refresh_attempt_id).toBeDefined();

    // Worker 2 calls getAccessToken concurrently while Worker 1 is in-flight
    // Worker 2 must observe refresh_state === 'refreshing' and wait/poll rather than initiating second refresh
    const p2 = manager2.getAccessToken(userId);

    // Release the barrier so Worker 1 receives HTTP response and commits CAS
    barrier.release();

    const [token1, token2] = await Promise.all([p1, p2]);

    // Both workers receive identical refreshed access token
    expect(token1).toBeDefined();
    expect(token1).toBe(token2);

    // Exactly ONE HTTP refresh exchange occurred across both workers
    const reqCountAfter = fixture.requests.filter(
      (r) => r.path === '/oauth/token' && r.body?.grant_type === 'refresh_token'
    ).length;
    expect(reqCountAfter - reqCountBefore).toBe(1);

    // Database state verified: token_version incremented to 2, refresh_state back to idle
    const dbGrant = (
      await ctx.pool.query(
        `SELECT token_version, refresh_state, refresh_attempt_id, encrypted_access_token
         FROM jira_oauth_grants
         WHERE account_id = (SELECT id FROM jira_accounts WHERE user_id = $1)`,
        [userId]
      )
    ).rows[0];
    expect(dbGrant.token_version).toBe(2);
    expect(dbGrant.refresh_state).toBe('idle');
    expect(dbGrant.refresh_attempt_id).toBeNull();

    const decrypted = decryptCredentials<{ token: string }>(
      dbGrant.encrypted_access_token,
      encryptionKey
    );
    expect(decrypted.token).toBe(token1);
  });

  // --------------------------------------------------------------------------
  // 2. Worker 2 bounded wait/poll and crash/timeout handling
  // --------------------------------------------------------------------------
  it('transitions grant to reconnect_required when refresh exchange times out or worker crashes with pending intent', async () => {
    const { userId } = await seedUserWithGrant({ prefix: 'crash_worker', expired: true });

    // Upstream server error causing timeout or failure
    fixture.setOverride('/oauth/token', { delayMs: 500, status: 500, body: { error: 'server_error' } });
    const manager = new JiraTokenManager({
      pool: ctx.pool,
      client,
      repo,
      encryptionKey,
      refreshTimeoutMs: 50,
    });

    await expect(manager.getAccessToken(userId)).rejects.toThrowError(/reconnect/i);

    const status = await repo.getConnectionStatus(userId);
    expect(status.connectionState).toBe('reconnect_required');

    const grantRow = (
      await ctx.pool.query(
        `SELECT status, refresh_state, refresh_attempt_id, encrypted_access_token, encrypted_refresh_token
         FROM jira_oauth_grants
         WHERE account_id = (SELECT id FROM jira_accounts WHERE user_id = $1)`,
        [userId]
      )
    ).rows[0];
    expect(grantRow.status).toBe('reconnect_required');
    expect(grantRow.refresh_state).toBe('idle');
    expect(grantRow.encrypted_access_token).toBeNull();
    expect(grantRow.encrypted_refresh_token).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 3. Stale refresh intent fail-closed & no replay of old token
  // --------------------------------------------------------------------------
  it('detects orphaned stale refresh intent, transitions to reconnect_required, and never replays old token', async () => {
    const { userId, accessToken: oldToken } = await seedUserWithGrant({ prefix: 'stale_worker', expired: true });

    // Simulate orphaned state from an earlier crashed process:
    // refresh_state is 'refreshing' but refresh_started_at is 15 minutes ago
    await ctx.pool.query(
      `UPDATE jira_oauth_grants
       SET refresh_state = 'refreshing',
           refresh_started_at = NOW() - INTERVAL '15 minutes',
           refresh_attempt_id = gen_random_uuid()
       WHERE account_id = (SELECT id FROM jira_accounts WHERE user_id = $1)`,
      [userId]
    );

    const manager = new JiraTokenManager({
      pool: ctx.pool,
      client,
      repo,
      encryptionKey,
      refreshTimeoutMs: 1000,
    });

    const reqCountBefore = fixture.requests.filter(
      (r) => r.path === '/oauth/token' && r.body?.grant_type === 'refresh_token'
    ).length;

    // Calling getAccessToken must reject with reconnect_required without replaying the old token
    await expect(manager.getAccessToken(userId)).rejects.toThrowError(/reconnect/i);

    // Old token must NEVER be replayed or returned; tokens must be wiped
    const grantRow = (
      await ctx.pool.query(
        `SELECT status, status_reason, refresh_state, encrypted_access_token, encrypted_refresh_token
         FROM jira_oauth_grants
         WHERE account_id = (SELECT id FROM jira_accounts WHERE user_id = $1)`,
        [userId]
      )
    ).rows[0];
    expect(grantRow.status).toBe('reconnect_required');
    expect(grantRow.refresh_state).toBe('idle');
    expect(grantRow.encrypted_access_token).toBeNull();
    expect(grantRow.encrypted_refresh_token).toBeNull();
    expect(grantRow.status_reason).toBe('CRASH_UNKNOWN_ROTATION');

    // No HTTP refresh call was made with potentially dead rotating refresh token
    const reqCountAfter = fixture.requests.filter(
      (r) => r.path === '/oauth/token' && r.body?.grant_type === 'refresh_token'
    ).length;
    expect(reqCountAfter - reqCountBefore).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 4. Concurrent disconnect vs in-flight refresh (Disconnect Wins)
  // --------------------------------------------------------------------------
  it('ensures disconnect wins when refresh returns after connection is deleted', async () => {
    const { userId } = await seedUserWithGrant({ prefix: 'disc_worker', expired: true });

    const barrier = fixture.pauseNext('/oauth/token');
    const manager = new JiraTokenManager({ pool: ctx.pool, client, repo, encryptionKey });

    const refreshPromise = manager.getAccessToken(userId);
    await barrier.reached;

    // Concurrently disconnect while HTTP refresh is paused in-flight!
    await repo.disconnect(userId);

    // Release barrier so HTTP returns new tokens
    barrier.release();

    // Manager CAS update fails because grant status was set to 'revoked' by disconnect()
    await expect(refreshPromise).rejects.toThrowError(/(?:disconnect|revoked|not connected|kết nối)/i);

    const status = await repo.getConnectionStatus(userId);
    expect(status.connected).toBe(false);
    expect(status.connectionState).toBe('disconnected');

    const dbRow = (
      await ctx.pool.query(
        `SELECT a.status as account_status, g.status as grant_status
         FROM jira_accounts a
         JOIN jira_oauth_grants g ON g.account_id = a.id
         WHERE a.user_id = $1`,
        [userId]
      )
    ).rows[0];
    expect(dbRow.account_status).toBe('disconnected');
    expect(dbRow.grant_status).toBe('revoked');
  });

  it('ensures disconnect wins when in-flight refresh encounters upstream error or timeout after connection is deleted', async () => {
    const { userId } = await seedUserWithGrant({ prefix: 'disc_err_worker', expired: true });

    const barrier = fixture.pauseNext('/oauth/token');
    // Set upstream 500 error on /oauth/token
    fixture.setOverride('/oauth/token', { status: 500, body: { error: 'upstream_crash' } });
    const manager = new JiraTokenManager({ pool: ctx.pool, client, repo, encryptionKey });

    const refreshPromise = manager.getAccessToken(userId);
    await barrier.reached;

    // Concurrently disconnect while HTTP refresh is paused in-flight!
    await repo.disconnect(userId);

    // Release barrier so HTTP returns 500 error
    barrier.release();

    // Refresh promise rejects
    await expect(refreshPromise).rejects.toThrow();

    // Verify Disconnect Wins: grant status must NOT be overwritten from 'revoked' to 'reconnect_required'
    const status = await repo.getConnectionStatus(userId);
    expect(status.connected).toBe(false);
    expect(status.connectionState).toBe('disconnected');

    const dbRow = (
      await ctx.pool.query(
        `SELECT a.status as account_status, g.status as grant_status
         FROM jira_accounts a
         JOIN jira_oauth_grants g ON g.account_id = a.id
         WHERE a.user_id = $1`,
        [userId]
      )
    ).rows[0];
    expect(dbRow.account_status).toBe('disconnected');
    expect(dbRow.grant_status).toBe('revoked');
  });

  it('ensures disconnect wins when in-flight refresh returns response missing rotating token after connection is deleted', async () => {
    const { userId } = await seedUserWithGrant({ prefix: 'disc_missing_worker', expired: true });

    const barrier = fixture.pauseNext('/oauth/token');
    // Override /oauth/token with response missing refresh_token
    fixture.setOverride('/oauth/token', {
      status: 200,
      body: { access_token: 'new_access_only', token_type: 'Bearer', expires_in: 3600 },
    });
    const manager = new JiraTokenManager({ pool: ctx.pool, client, repo, encryptionKey });

    const refreshPromise = manager.getAccessToken(userId);
    await barrier.reached;

    // Concurrently disconnect while HTTP refresh is paused in-flight!
    await repo.disconnect(userId);

    // Release barrier so HTTP returns response missing rotating token
    barrier.release();

    // Refresh promise rejects
    await expect(refreshPromise).rejects.toThrow();

    // Verify Disconnect Wins: grant status must remain 'revoked'
    const status = await repo.getConnectionStatus(userId);
    expect(status.connected).toBe(false);
    expect(status.connectionState).toBe('disconnected');

    const dbRow = (
      await ctx.pool.query(
        `SELECT a.status as account_status, g.status as grant_status
         FROM jira_accounts a
         JOIN jira_oauth_grants g ON g.account_id = a.id
         WHERE a.user_id = $1`,
        [userId]
      )
    ).rows[0];
    expect(dbRow.account_status).toBe('disconnected');
    expect(dbRow.grant_status).toBe('revoked');
  });

  // --------------------------------------------------------------------------
  // 5. Upstream invalid_grant transitions grant to reconnect_required and erases tokens
  // --------------------------------------------------------------------------
  it('handles invalid_grant error from Atlassian by immediately transitioning grant to reconnect_required and erasing tokens', async () => {
    const { userId } = await seedUserWithGrant({ prefix: 'inv_grant_user', expired: true });

    fixture.setOverride('/oauth/token', {
      status: 400,
      body: { error: 'invalid_grant', error_description: 'Refresh token expired or revoked' },
    });

    const manager = new JiraTokenManager({ pool: ctx.pool, client, repo, encryptionKey });

    await expect(manager.getAccessToken(userId)).rejects.toThrowError(/reconnect/i);

    const status = await repo.getConnectionStatus(userId);
    expect(status.connectionState).toBe('reconnect_required');

    const dbGrant = (
      await ctx.pool.query(
        `SELECT status, refresh_state, encrypted_access_token, encrypted_refresh_token
         FROM jira_oauth_grants
         WHERE account_id = (SELECT id FROM jira_accounts WHERE user_id = $1)`,
        [userId]
      )
    ).rows[0];
    expect(dbGrant.status).toBe('reconnect_required');
    expect(dbGrant.refresh_state).toBe('idle');
    expect(dbGrant.encrypted_access_token).toBeNull();
    expect(dbGrant.encrypted_refresh_token).toBeNull();

    // Subsequent call must fail immediately without making additional HTTP requests
    const reqCountBefore = fixture.requests.length;
    await expect(manager.getAccessToken(userId)).rejects.toThrowError(/reconnect/i);
    expect(fixture.requests.length).toBe(reqCountBefore);
  });

  it('erases encrypted access and refresh tokens when provider returns response missing rotating refresh token', async () => {
    const { userId } = await seedUserWithGrant({ prefix: 'missing_rot_token', expired: true });

    fixture.setOverride('/oauth/token', {
      status: 200,
      body: { access_token: 'no_refresh_token_provided', token_type: 'Bearer', expires_in: 3600 },
    });

    const manager = new JiraTokenManager({ pool: ctx.pool, client, repo, encryptionKey });

    await expect(manager.getAccessToken(userId)).rejects.toThrowError(/reconnect/i);

    const dbGrant = (
      await ctx.pool.query(
        `SELECT status, status_reason, refresh_state, encrypted_access_token, encrypted_refresh_token
         FROM jira_oauth_grants
         WHERE account_id = (SELECT id FROM jira_accounts WHERE user_id = $1)`,
        [userId]
      )
    ).rows[0];
    expect(dbGrant.status).toBe('reconnect_required');
    expect(dbGrant.status_reason).toBe('MISSING_ROTATING_TOKEN');
    expect(dbGrant.refresh_state).toBe('idle');
    expect(dbGrant.encrypted_access_token).toBeNull();
    expect(dbGrant.encrypted_refresh_token).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 6. Caller AbortSignal cancels caller wait without aborting background refresh
  // --------------------------------------------------------------------------
  it('caller AbortSignal cancels caller wait without aborting background refresh persistence: second caller succeeds with rotated token', async () => {
    const { userId } = await seedUserWithGrant({ prefix: 'abort_caller', expired: true });

    const barrier = fixture.pauseNext('/oauth/token');
    const manager = new JiraTokenManager({ pool: ctx.pool, client, repo, encryptionKey });

    const abortController = new AbortController();
    const callerPromise = manager.getAccessToken(userId, { signal: abortController.signal });
    await barrier.reached;

    // Abort caller 1 mid-flight!
    abortController.abort(new Error('Caller cancelled request'));
    await expect(callerPromise).rejects.toThrow();

    // Release background network call
    barrier.release();

    // Caller 2 requests token: should succeed with the refreshed token!
    const token2 = await manager.getAccessToken(userId);
    expect(token2).toBeDefined();

    const dbGrant = (
      await ctx.pool.query(
        `SELECT token_version, refresh_state, encrypted_access_token
         FROM jira_oauth_grants
         WHERE account_id = (SELECT id FROM jira_accounts WHERE user_id = $1)`,
        [userId]
      )
    ).rows[0];
    expect(dbGrant.token_version).toBe(2);
    expect(dbGrant.refresh_state).toBe('idle');

    const decrypted = decryptCredentials<{ token: string }>(
      dbGrant.encrypted_access_token,
      encryptionKey
    );
    expect(decrypted.token).toBe(token2);
  });

  // --------------------------------------------------------------------------
  // 7. Actual AbortSignal cancellation for waiting/polling worker
  // --------------------------------------------------------------------------
  it('aborts waiting worker when its AbortSignal triggers during polling without aborting the refreshing worker', async () => {
    const { userId } = await seedUserWithGrant({ prefix: 'abort_waiting_worker', expired: true });

    const workerPool1 = ctx.createWorkerPool({ max: 2, applicationName: 'worker-poll-1' });
    const workerPool2 = ctx.createWorkerPool({ max: 2, applicationName: 'worker-poll-2' });

    const repo1 = new JiraOAuthRepo(workerPool1, encryptionKey);
    const repo2 = new JiraOAuthRepo(workerPool2, encryptionKey);

    const manager1 = new JiraTokenManager({ pool: workerPool1, client, repo: repo1, encryptionKey });
    const manager2 = new JiraTokenManager({ pool: workerPool2, client, repo: repo2, encryptionKey });

    const barrier = fixture.pauseNext('/oauth/token');

    // Worker 1 starts refresh
    const p1 = manager1.getAccessToken(userId);
    await barrier.reached;

    // Worker 2 calls with abort signal while Worker 1 is in-flight
    const abortController2 = new AbortController();
    const p2 = manager2.getAccessToken(userId, { signal: abortController2.signal });

    // Abort Worker 2 while waiting/polling
    abortController2.abort(new Error('Worker 2 client aborted'));
    await expect(p2).rejects.toThrow();

    // Release barrier so Worker 1 finishes cleanly
    barrier.release();
    const token1 = await p1;
    expect(token1).toBeDefined();

    // Subsequent call from Worker 2 now succeeds with the persisted token
    const token2 = await manager2.getAccessToken(userId);
    expect(token2).toBe(token1);
  });

  // --------------------------------------------------------------------------
  // 8. Active unexpired token returned directly without HTTP call; forceRefresh forces rotation
  // --------------------------------------------------------------------------
  it('returns valid unexpired token directly from storage, but forceRefresh triggers network rotation', async () => {
    const { userId, accessToken: originalToken } = await seedUserWithGrant({
      prefix: 'active_token_user',
      expired: false,
    });

    const manager = new JiraTokenManager({ pool: ctx.pool, client, repo, encryptionKey });

    const reqCountBefore = fixture.requests.filter(
      (r) => r.path === '/oauth/token' && r.body?.grant_type === 'refresh_token'
    ).length;

    // 1. Without forceRefresh: returns unexpired token, 0 refresh requests
    const token = await manager.getAccessToken(userId);
    expect(token).toBe(originalToken);

    const reqCountMid = fixture.requests.filter(
      (r) => r.path === '/oauth/token' && r.body?.grant_type === 'refresh_token'
    ).length;
    expect(reqCountMid - reqCountBefore).toBe(0);

    // 2. With forceRefresh: forces refresh even when unexpired
    const rotatedToken = await manager.getAccessToken(userId, { forceRefresh: true });
    expect(rotatedToken).toBeDefined();
    expect(rotatedToken).not.toBe(originalToken);

    const reqCountAfter = fixture.requests.filter(
      (r) => r.path === '/oauth/token' && r.body?.grant_type === 'refresh_token'
    ).length;
    expect(reqCountAfter - reqCountMid).toBe(1);

    const dbGrant = (
      await ctx.pool.query(
        `SELECT token_version
         FROM jira_oauth_grants
         WHERE account_id = (SELECT id FROM jira_accounts WHERE user_id = $1)`,
        [userId]
      )
    ).rows[0];
    expect(dbGrant.token_version).toBe(2);
  });

  // --------------------------------------------------------------------------
  // 9. Pre-existing revoked/disconnected or reconnect_required grants fail immediately
  // --------------------------------------------------------------------------
  it('rejects immediately without making HTTP calls when grant is revoked or reconnect_required', async () => {
    const { userId } = await seedUserWithGrant({ prefix: 'pre_failed_user', expired: false });
    const manager = new JiraTokenManager({ pool: ctx.pool, client, repo, encryptionKey });

    // Case A: Disconnected / Revoked
    await repo.disconnect(userId);
    const reqCountBefore = fixture.requests.length;
    await expect(manager.getAccessToken(userId)).rejects.toThrowError(
      /(?:disconnect|revoked|not connected|kết nối)/i
    );
    expect(fixture.requests.length).toBe(reqCountBefore);

    // Case B: Grant explicitly reconnect_required
    const userB = (await seedUserWithGrant({ prefix: 'user_reconn', expired: false })).userId;
    await ctx.pool.query(
      `UPDATE jira_oauth_grants
       SET status = 'reconnect_required', status_reason = 'token_revoked'
       WHERE account_id = (SELECT id FROM jira_accounts WHERE user_id = $1)`,
      [userB]
    );

    const reqCountBeforeB = fixture.requests.length;
    await expect(manager.getAccessToken(userB)).rejects.toThrowError(/reconnect/i);
    expect(fixture.requests.length).toBe(reqCountBeforeB);
  });

  // --------------------------------------------------------------------------
  // 10. clear() method cleans up any in-memory state for userId
  // --------------------------------------------------------------------------
  it('provides clear(userId) method to reset cached user state', () => {
    const manager = new JiraTokenManager({ pool: ctx.pool, client, repo, encryptionKey });
    expect(typeof manager.clear).toBe('function');
    expect(() => manager.clear('user-test-clear')).not.toThrow();
  });
});
