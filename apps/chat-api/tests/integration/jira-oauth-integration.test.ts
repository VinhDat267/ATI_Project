import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { JiraOAuthRepo } from '../../src/db/repositories/jira-oauth-repo.js';
import { JiraOAuthClient } from '../../src/services/jira/jira-oauth-client.js';
import { JiraTokenManager } from '../../src/services/jira/jira-token-manager.js';
import { GoogleAuthRepo } from '../../src/db/repositories/google-auth-repo.js';
import { SessionRepo } from '../../src/db/repositories/session-repo.js';
import { UserRepo } from '../../src/db/repositories/user-repo.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { createJiraOAuthTestFixture, type JiraOAuthFixture } from '../helpers/jira-oauth-test-fixture.js';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';
import { decryptCredentials } from '@wap/tool-adapters';
import type {
  JiraOAuthCallbackResponse,
  JiraConnectionStatusResponse,
  JiraSyncSitesResponse,
  JiraDisconnectResponse,
} from '@wap/tool-schemas';

function requireFirstRow<T>(rows: T[], message = 'Expected at least one database row'): T {
  const row = rows[0];
  if (!row) {
    throw new Error(message);
  }
  return row;
}

function requireFirstItem<T>(items: T[], message = 'Expected at least one array item'): T {
  const item = items[0];
  if (!item) {
    throw new Error(message);
  }
  return item;
}

function extractBrowserCookie(res: request.Response): string {
  const setCookies = res.headers['set-cookie'];
  if (!setCookies) return '';
  const list = Array.isArray(setCookies) ? setCookies : [setCookies];
  for (const c of list) {
    const match = /^ati_jira_browser=([^;]+)/.exec(c);
    const value = match?.[1];
    if (value) return value;
  }
  return '';
}

describe('JIRA-04 End-to-End Acceptance Gates Suite (Task 7)', () => {
  let ctx: IsolatedTestContext;
  let fixture: JiraOAuthFixture;
  let app: Express;
  let userRepo: UserRepo;
  let sessionRepo: SessionRepo;
  let states: GoogleAuthRepo;
  let convRepo: ConversationRepo;
  let repo: JiraOAuthRepo;
  let client: JiraOAuthClient;
  let tokens: JiraTokenManager;

  const jwtSecret = 'integration_jwt_secret_32_chars_long!';
  const encryptionKey = '01234567890123456789012345678901';

  async function createActor(name: string, prefix: string) {
    const userId = await createSyntheticUser(ctx.pool, name, prefix, { role: 'member', status: 'active' });
    const userRow = await userRepo.findById(userId);
    const email = userRow?.email ?? `${prefix}_${randomUUID().slice(0, 8)}@example.test`;
    const { sessionId } = await sessionRepo.create(userId, 'test-agent');
    const token = generateAccessToken(
      { id: userId, email, name, role: 'member', status: 'active' },
      jwtSecret,
      sessionId
    ).accessToken;
    return { userId, email, sessionId, token };
  }

  async function seedUserWithExpiredGrant(prefix: string, name: string): Promise<{
    userId: string;
    atlassianAccountId: string;
    accessToken: string;
    refreshToken: string;
  }> {
    const userId = await createSyntheticUser(ctx.pool, name, prefix, { role: 'member', status: 'active' });
    const atlassianAccountId = `atl-${randomUUID().slice(0, 8)}`;
    const code = fixture.issueCode({
      accountId: atlassianAccountId,
      scopes: ['read:me', 'offline_access'],
      expiresInSeconds: 3600,
    });
    const tokensResult = await client.exchangeCode(code);

    if (!tokensResult.refreshToken) {
      throw new Error('Fixture did not return a refresh token');
    }

    await repo.saveIdentityGrant(userId, {
      atlassianAccountId,
      accessToken: tokensResult.accessToken,
      refreshToken: tokensResult.refreshToken,
      expiresInSeconds: 0,
      scopes: ['read:me', 'offline_access'],
    });

    await ctx.pool.query(
      `UPDATE jira_oauth_grants
       SET expires_at = NOW() - INTERVAL '1 minute'
       WHERE account_id = (SELECT id FROM jira_accounts WHERE user_id = $1)`,
      [userId]
    );

    return {
      userId,
      atlassianAccountId,
      accessToken: tokensResult.accessToken,
      refreshToken: tokensResult.refreshToken,
    };
  }

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 10 });
    await ctx.runAllMigrations();
    fixture = await createJiraOAuthTestFixture();

    userRepo = new UserRepo(ctx.pool);
    sessionRepo = new SessionRepo(ctx.pool);
    states = new GoogleAuthRepo(ctx.pool);
    convRepo = new ConversationRepo(ctx.pool);
    repo = new JiraOAuthRepo(ctx.pool, encryptionKey);
    client = new JiraOAuthClient({
      clientId: 'test-client',
      clientSecret: 'SECRET_SENTINEL',
      redirectUri: 'http://127.0.0.1:4187/callback',
      mode: 'fixture',
      fixtureBaseUrl: fixture.baseUrl,
    });
    tokens = new JiraTokenManager({
      pool: ctx.pool,
      client,
      repo,
      encryptionKey,
      refreshTimeoutMs: 10_000,
    });

    app = createApp({
      jwtSecret,
      states,
      sessionRepo,
      userRepo,
      convRepo,
      pool: ctx.pool,
      jira: {
        enabled: true,
        oauth: {
          clientId: 'test-client',
          clientSecret: 'SECRET_SENTINEL',
          redirectUri: 'http://127.0.0.1:4187/callback',
          mode: 'fixture',
          fixtureBaseUrl: fixture.baseUrl,
        },
        client,
        repo,
        tokens,
      },
    });
  });

  afterAll(async () => {
    await fixture.close();
    await ctx.cleanup();
  });

  beforeEach(() => {
    fixture.clearOverrides();
  });

  // ==========================================================================
  // Gate 1: Full Two-Phase Lifecycle End-to-End Acceptance Gate
  // Identity Consent -> Site Consent/Snapshot -> Status -> Disconnect
  // ==========================================================================
  describe('Gate 1: End-to-End Two-Phase Connection Lifecycle & Snapshot', () => {
    it('completes full two-phase connection lifecycle (identity -> sites snapshot -> sync -> disconnect) across createApp route, isolated PostgreSQL and Atlassian loopback fixture', async () => {
      const actor = await createActor('Gate1 Lifecycle User', 'gate1_user');

      // --- Phase 1: Identity Connection Start ---
      const startRes1 = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'identity' });

      expect(startRes1.status).toBe(200);
      expect(startRes1.body.authUrl).toBeDefined();

      const authUrl1 = new URL(startRes1.body.authUrl);
      expect(authUrl1.searchParams.get('audience')).toBe('api.atlassian.com');
      expect(authUrl1.searchParams.get('client_id')).toBe('test-client');
      expect(authUrl1.searchParams.get('prompt')).toBe('consent');
      expect(authUrl1.searchParams.get('response_type')).toBe('code');
      expect(authUrl1.searchParams.get('scope')).toBe('read:me offline_access');
      expect(authUrl1.searchParams.has('client_secret')).toBe(false);

      const cookie1 = extractBrowserCookie(startRes1);
      expect(cookie1).toBeTruthy();
      const state1 = authUrl1.searchParams.get('state');
      if (!state1) {
        throw new Error('Expected state parameter in authUrl1');
      }

      // --- Phase 1: Identity Callback Exchange ---
      const code1 = fixture.issueCode({
        accountId: 'atl-gate1-account',
        scopes: ['read:me', 'offline_access'],
      });

      const cbRes1 = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', `ati_jira_browser=${cookie1}`)
        .send({ code: code1, state: state1 });

      expect(cbRes1.status).toBe(200);
      const cbBody1: JiraOAuthCallbackResponse = cbRes1.body;
      expect(cbBody1.connected).toBe(true);
      expect(cbBody1.connectionState).toBe('identity_connected');
      expect(cbBody1.atlassianAccountId).toBe('atl-gate1-account');
      expect(cbBody1.siteCount).toBe(0);

      // Verify DB identity establishment
      const accountDb1 = await repo.getAccountByUserId(actor.userId);
      if (!accountDb1) {
        throw new Error('Expected accountDb1 to exist in database');
      }
      expect(accountDb1.status).toBe('connected');
      expect(accountDb1.identity_version).toBe(1);
      expect(accountDb1.atlassian_account_id).toBe('atl-gate1-account');

      // Verify Status returns identity_connected
      const statusRes1 = await request(app)
        .get('/api/connections/myjira')
        .set('Authorization', `Bearer ${actor.token}`);
      expect(statusRes1.status).toBe(200);
      const statusBody1: JiraConnectionStatusResponse = statusRes1.body;
      expect(statusBody1.connected).toBe(true);
      expect(statusBody1.connectionState).toBe('identity_connected');
      expect(statusBody1.sites).toEqual([]);

      // --- Phase 2: Authorize Sites Start ---
      const startRes2 = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'authorize_sites' });

      expect(startRes2.status).toBe(200);
      const authUrl2 = new URL(startRes2.body.authUrl);
      const scopesParam = authUrl2.searchParams.get('scope') ?? '';
      expect(scopesParam).toContain('read:jira-work');
      expect(scopesParam).toContain('write:jira-work');
      expect(scopesParam).toContain('read:me');

      const cookie2 = extractBrowserCookie(startRes2);
      const state2 = authUrl2.searchParams.get('state');
      if (!state2) {
        throw new Error('Expected state parameter in authUrl2');
      }

      // --- Phase 2: Authorize Sites Callback Exchange ---
      const code2 = fixture.issueCode({
        accountId: 'atl-gate1-account',
        scopes: ['read:me', 'read:jira-work', 'write:jira-work', 'offline_access'],
        sites: [
          {
            id: 'cloud-gate1-alpha',
            name: 'Gate1 Alpha Site',
            url: 'https://gate1-alpha.atlassian.net',
            scopes: ['read:jira-work', 'write:jira-work'],
          },
        ],
      });

      const cbRes2 = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', `ati_jira_browser=${cookie2}`)
        .send({ code: code2, state: state2 });

      expect(cbRes2.status).toBe(200);
      const cbBody2: JiraOAuthCallbackResponse = cbRes2.body;
      expect(cbBody2.connected).toBe(true);
      expect(cbBody2.connectionState).toBe('connected');
      expect(cbBody2.siteCount).toBe(1);

      // Verify PostgreSQL site snapshot with scopes array and product_type
      const siteRows = await ctx.pool.query<{
        cloud_id: string;
        site_name: string;
        site_url: string;
        product_type: string;
        scopes: string[];
      }>(
        `SELECT s.cloud_id, s.site_name, s.site_url, s.product_type, s.scopes
         FROM jira_grant_sites s
         JOIN jira_oauth_grants g ON g.id = s.grant_id
         JOIN jira_accounts a ON a.id = g.account_id
         WHERE a.user_id = $1`,
        [actor.userId]
      );
      expect(siteRows.rowCount).toBe(1);
      const siteRow = requireFirstRow(siteRows.rows, 'Expected at least one site row in jira_grant_sites');
      expect(siteRow.cloud_id).toBe('cloud-gate1-alpha');
      expect(siteRow.product_type).toBe('jira');
      expect(siteRow.scopes).toContain('read:jira-work');

      // --- Status Check: Fully Connected ---
      const statusRes2 = await request(app)
        .get('/api/connections/myjira')
        .set('Authorization', `Bearer ${actor.token}`);
      expect(statusRes2.status).toBe(200);
      const statusBody2: JiraConnectionStatusResponse = statusRes2.body;
      expect(statusBody2.connected).toBe(true);
      expect(statusBody2.connectionState).toBe('connected');
      expect(statusBody2.sites).toHaveLength(1);
      const firstStatusSite = requireFirstItem(statusBody2.sites, 'Expected at least one site in status response');
      expect(firstStatusSite.cloudId).toBe('cloud-gate1-alpha');
      expect(firstStatusSite.name).toBe('Gate1 Alpha Site');

      // --- Sync Sites Endpoint ---
      const syncRes = await request(app)
        .post('/api/connections/myjira/sync-sites')
        .set('Authorization', `Bearer ${actor.token}`);
      expect(syncRes.status).toBe(200);
      const syncBody: JiraSyncSitesResponse = syncRes.body;
      expect(syncBody.syncedCount).toBe(1);
      const firstSyncSite = requireFirstItem(syncBody.sites, 'Expected at least one site in sync response');
      expect(firstSyncSite.cloudId).toBe('cloud-gate1-alpha');

      // --- Disconnect Flow ---
      const delRes = await request(app)
        .delete('/api/connections/myjira')
        .set('Authorization', `Bearer ${actor.token}`);
      expect(delRes.status).toBe(200);
      const delBody: JiraDisconnectResponse = delRes.body;
      expect(delBody.disconnected).toBe(true);
      expect(delBody.identityVersion).toBe(2);
      expect(delBody.revokedAt).toBeDefined();

      // Verify DB revoked state
      const accountDbAfter = await repo.getAccountByUserId(actor.userId);
      if (!accountDbAfter) {
        throw new Error('Expected accountDbAfter to exist in database');
      }
      expect(accountDbAfter.status).toBe('disconnected');
      expect(accountDbAfter.identity_version).toBe(2);

      const grantDbQuery = await ctx.pool.query<{ status: string; encrypted_access_token: string | null }>(
        `SELECT status, encrypted_access_token FROM jira_oauth_grants WHERE account_id = $1`,
        [accountDbAfter.id]
      );
      const grantDbAfter = requireFirstRow(grantDbQuery.rows, 'Expected grant row in jira_oauth_grants');
      expect(grantDbAfter.status).toBe('revoked');
      expect(grantDbAfter.encrypted_access_token).toBeNull();

      // Subsequent status call returns disconnected
      const statusRes3 = await request(app)
        .get('/api/connections/myjira')
        .set('Authorization', `Bearer ${actor.token}`);
      expect(statusRes3.status).toBe(200);
      const statusBody3: JiraConnectionStatusResponse = statusRes3.body;
      expect(statusBody3.connected).toBe(false);
      expect(statusBody3.connectionState).toBe('disconnected');
      expect(statusBody3.sites).toEqual([]);
    });
  });

  // ==========================================================================
  // Gate 2: Multi-Process Token Refresh Race, Stale Intent Recovery & Disconnect Wins
  // ==========================================================================
  describe('Gate 2: Multi-Process Token Refresh Race & Recovery Invariants', () => {
    it('serializes concurrent token refresh between two worker processes with exactly one network exchange, zero DB locks held across network, and CAS completion', async () => {
      const seeded = await seedUserWithExpiredGrant('race_gate2', 'Race Gate2 User');

      const workerPool1 = ctx.createWorkerPool({ max: 2, applicationName: 'gate2-worker-1' });
      const workerPool2 = ctx.createWorkerPool({ max: 2, applicationName: 'gate2-worker-2' });

      const repo1 = new JiraOAuthRepo(workerPool1, encryptionKey);
      const repo2 = new JiraOAuthRepo(workerPool2, encryptionKey);

      const manager1 = new JiraTokenManager({ pool: workerPool1, client, repo: repo1, encryptionKey });
      const manager2 = new JiraTokenManager({ pool: workerPool2, client, repo: repo2, encryptionKey });

      const barrier = fixture.pauseNext('/oauth/token');
      const reqCountBefore = fixture.requests.filter(
        (r) => r.path === '/oauth/token' && r.body?.grant_type === 'refresh_token'
      ).length;

      // Worker 1 initiates refresh
      const p1 = manager1.getAccessToken(seeded.userId);
      await barrier.reached;

      // Invariant: verify NO database row lock is held during outbound network call!
      // In PostgreSQL, SELECT FOR UPDATE NOWAIT succeeds only if Worker 1 released its transaction
      const lockRes = await ctx.pool.query<{ refresh_state: string; refresh_attempt_id: string | null }>(
        `SELECT refresh_state, refresh_attempt_id
         FROM jira_oauth_grants
         WHERE account_id = (SELECT id FROM jira_accounts WHERE user_id = $1)
         FOR UPDATE NOWAIT`,
        [seeded.userId]
      );
      expect(lockRes.rowCount).toBe(1);
      const lockRow = requireFirstRow(lockRes.rows, 'Expected locked row in jira_oauth_grants');
      expect(lockRow.refresh_state).toBe('refreshing');
      expect(lockRow.refresh_attempt_id).toBeTruthy();

      // Worker 2 calls concurrently while Worker 1 is suspended at HTTP network call
      // Worker 2 must observe 'refreshing', release DB lock and enter bounded polling
      const p2 = manager2.getAccessToken(seeded.userId);

      // Release network barrier: Worker 1 receives new tokens and executes CAS commit
      barrier.release();

      const [token1, token2] = await Promise.all([p1, p2]);

      expect(token1).toBeTruthy();
      expect(token1).toBe(token2);

      // Exactly ONE HTTP refresh request occurred across both worker processes!
      const reqCountAfter = fixture.requests.filter(
        (r) => r.path === '/oauth/token' && r.body?.grant_type === 'refresh_token'
      ).length;
      expect(reqCountAfter - reqCountBefore).toBe(1);

      // Database verification: token_version incremented, refresh_state back to idle
      const dbGrantRes = await ctx.pool.query<{
        token_version: number;
        refresh_state: string;
        refresh_attempt_id: string | null;
        encrypted_access_token: string;
      }>(
        `SELECT token_version, refresh_state, refresh_attempt_id, encrypted_access_token
         FROM jira_oauth_grants
         WHERE account_id = (SELECT id FROM jira_accounts WHERE user_id = $1)`,
        [seeded.userId]
      );
      const dbGrant = requireFirstRow(dbGrantRes.rows, 'Expected dbGrant row in jira_oauth_grants');
      expect(dbGrant.token_version).toBe(2);
      expect(dbGrant.refresh_state).toBe('idle');
      expect(dbGrant.refresh_attempt_id).toBeNull();

      const decrypted = decryptCredentials<{ token: string }>(dbGrant.encrypted_access_token, encryptionKey);
      expect(decrypted.token).toBe(token1);
    });

    it('recovers safely from stale refresh intent of crashed worker, transitions to reconnect_required without replaying old dead tokens', async () => {
      const seeded = await seedUserWithExpiredGrant('crash_gate2', 'Crash Gate2 User');

      // Simulate a crashed worker process: intent left in 'refreshing' 15 minutes ago
      await ctx.pool.query(
        `UPDATE jira_oauth_grants
         SET refresh_state = 'refreshing',
             refresh_started_at = NOW() - INTERVAL '15 minutes',
             refresh_attempt_id = gen_random_uuid()
         WHERE account_id = (SELECT id FROM jira_accounts WHERE user_id = $1)`,
        [seeded.userId]
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

      // Attempting to get access token must detect stale intent and fail closed
      await expect(manager.getAccessToken(seeded.userId)).rejects.toThrowError(/reconnect/i);

      // Old dead token was NEVER replayed; no network requests sent
      const reqCountAfter = fixture.requests.filter(
        (r) => r.path === '/oauth/token' && r.body?.grant_type === 'refresh_token'
      ).length;
      expect(reqCountAfter - reqCountBefore).toBe(0);

      // PostgreSQL grant transitioned to reconnect_required and wiped
      const grantRowRes = await ctx.pool.query<{
        status: string;
        status_reason: string;
        refresh_state: string;
        encrypted_access_token: string | null;
        encrypted_refresh_token: string | null;
      }>(
        `SELECT status, status_reason, refresh_state, encrypted_access_token, encrypted_refresh_token
         FROM jira_oauth_grants
         WHERE account_id = (SELECT id FROM jira_accounts WHERE user_id = $1)`,
        [seeded.userId]
      );
      const grantRow = requireFirstRow(grantRowRes.rows, 'Expected grantRow in jira_oauth_grants');
      expect(grantRow.status).toBe('reconnect_required');
      expect(grantRow.status_reason).toBe('CRASH_UNKNOWN_ROTATION');
      expect(grantRow.refresh_state).toBe('idle');
      expect(grantRow.encrypted_access_token).toBeNull();
      expect(grantRow.encrypted_refresh_token).toBeNull();

      // Status reflects reconnect_required
      const status = await repo.getConnectionStatus(seeded.userId);
      expect(status.connectionState).toBe('reconnect_required');
    });

    it('enforces disconnect wins: deletes connection mid-refresh, discarding incoming token and keeping grant revoked', async () => {
      const actor = await createActor('DiscWins Actor', 'disc_wins');
      const seeded = await seedUserWithExpiredGrant('disc_wins_seed', 'DiscWins Seed');
      // Link seeded account to actor
      await ctx.pool.query(`UPDATE jira_accounts SET user_id = $1 WHERE user_id = $2`, [
        actor.userId,
        seeded.userId,
      ]);

      const barrier = fixture.pauseNext('/oauth/token');
      const manager = new JiraTokenManager({ pool: ctx.pool, client, repo, encryptionKey });

      // Worker initiates refresh
      const refreshPromise = manager.getAccessToken(actor.userId);
      await barrier.reached;

      // Caller concurrently disconnects via route
      const delRes = await request(app)
        .delete('/api/connections/myjira')
        .set('Authorization', `Bearer ${actor.token}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body.disconnected).toBe(true);

      // Release network response
      barrier.release();

      // Refresh must fail because CAS found status != 'active'
      await expect(refreshPromise).rejects.toThrowError(/(?:disconnect|revoked|not connected|kết nối)/i);

      // Status must remain revoked / disconnected
      const status = await repo.getConnectionStatus(actor.userId);
      expect(status.connected).toBe(false);
      expect(status.connectionState).toBe('disconnected');

      const dbRowRes = await ctx.pool.query<{ account_status: string; grant_status: string }>(
        `SELECT a.status as account_status, g.status as grant_status
         FROM jira_accounts a
         JOIN jira_oauth_grants g ON g.account_id = a.id
         WHERE a.user_id = $1`,
        [actor.userId]
      );
      const dbRow = requireFirstRow(dbRowRes.rows, 'Expected account and grant row');
      expect(dbRow.account_status).toBe('disconnected');
      expect(dbRow.grant_status).toBe('revoked');
    });
  });

  // ==========================================================================
  // Gate 3: Actual AbortSignal Cancellation with No False Reconnect
  // ==========================================================================
  describe('Gate 3: AbortSignal Semantics & Cancellation Isolation', () => {
    it('caller AbortSignal aborts caller wait without corrupting or aborting background refresh persistence, allowing subsequent callers to succeed', async () => {
      const seeded = await seedUserWithExpiredGrant('abort_gate3', 'Abort Gate3 User');

      const barrier = fixture.pauseNext('/oauth/token');
      const manager = new JiraTokenManager({ pool: ctx.pool, client, repo, encryptionKey });

      const abortController = new AbortController();
      const callerPromise = manager.getAccessToken(seeded.userId, { signal: abortController.signal });
      await barrier.reached;

      // Abort caller 1 mid-flight!
      abortController.abort(new Error('Caller timeout abort'));
      await expect(callerPromise).rejects.toThrow();

      // Release background network call to complete
      barrier.release();

      // Caller 2 requests token: should succeed with the persisted refreshed token!
      const token2 = await manager.getAccessToken(seeded.userId);
      expect(token2).toBeDefined();

      // Grant status must remain active (NO false reconnect!)
      const dbGrantRes = await ctx.pool.query<{ status: string; token_version: number; refresh_state: string }>(
        `SELECT status, token_version, refresh_state
         FROM jira_oauth_grants
         WHERE account_id = (SELECT id FROM jira_accounts WHERE user_id = $1)`,
        [seeded.userId]
      );
      const dbGrant = requireFirstRow(dbGrantRes.rows, 'Expected active grant row');
      expect(dbGrant.status).toBe('active');
      expect(dbGrant.token_version).toBe(2);
      expect(dbGrant.refresh_state).toBe('idle');
    });

    it('polling worker AbortSignal aborts waiting worker without triggering false reconnect or interrupting active refresh worker', async () => {
      const seeded = await seedUserWithExpiredGrant('abort_poll_gate3', 'Abort Poll Gate3 User');

      const workerPool1 = ctx.createWorkerPool({ max: 2, applicationName: 'poll-worker-1' });
      const workerPool2 = ctx.createWorkerPool({ max: 2, applicationName: 'poll-worker-2' });

      const repo1 = new JiraOAuthRepo(workerPool1, encryptionKey);
      const repo2 = new JiraOAuthRepo(workerPool2, encryptionKey);

      const manager1 = new JiraTokenManager({ pool: workerPool1, client, repo: repo1, encryptionKey });
      const manager2 = new JiraTokenManager({ pool: workerPool2, client, repo: repo2, encryptionKey });

      const barrier = fixture.pauseNext('/oauth/token');

      // Worker 1 initiates refresh
      const p1 = manager1.getAccessToken(seeded.userId);
      await barrier.reached;

      // Worker 2 calls with its own AbortSignal while Worker 1 is in-flight
      const abortController2 = new AbortController();
      const p2 = manager2.getAccessToken(seeded.userId, { signal: abortController2.signal });

      // Abort Worker 2 while waiting in polling loop
      abortController2.abort(new Error('Worker 2 caller cancelled'));
      await expect(p2).rejects.toThrow();

      // Release barrier so Worker 1 completes cleanly
      barrier.release();
      const token1 = await p1;
      expect(token1).toBeDefined();

      // Grant remains active; Worker 2 retry succeeds immediately with persisted token
      const token2 = await manager2.getAccessToken(seeded.userId);
      expect(token2).toBe(token1);

      const status = await repo.getConnectionStatus(seeded.userId);
      expect(status.connected).toBe(true);
      expect(status.connectionState).toBe('identity_connected');
    });
  });

  // ==========================================================================
  // Gate 4: Browser Binding, Session Integrity, State Replay & Trusted conversationOwner
  // ==========================================================================
  describe('Gate 4: Security Verification (State Replay, Browser Binding & conversationOwner)', () => {
    it('rejects state replay with JIRA_STATE_INVALID on second callback attempt', async () => {
      const actor = await createActor('Replay Gate4 Actor', 'replay_gate4');

      const startRes = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'identity' });
      const cookie = extractBrowserCookie(startRes);
      const state = new URL(startRes.body.authUrl).searchParams.get('state');
      if (!state) {
        throw new Error('Expected state in authUrl');
      }
      const code = fixture.issueCode({ accountId: 'atl-replay-gate4' });

      // First callback: success
      const cb1 = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', `ati_jira_browser=${cookie}`)
        .send({ code, state });
      expect(cb1.status).toBe(200);

      // Second callback replay: fails closed with JIRA_STATE_INVALID
      const cb2 = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', `ati_jira_browser=${cookie}`)
        .send({ code, state });
      expect(cb2.status).toBe(400);
      expect(cb2.body.code).toBe('JIRA_STATE_INVALID');
    });

    it('rejects callback when browser binding cookie is missing or tampered', async () => {
      const actor = await createActor('Tamper Gate4 Actor', 'tamper_gate4');

      const startRes = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'identity' });
      const state = new URL(startRes.body.authUrl).searchParams.get('state');
      if (!state) {
        throw new Error('Expected state in authUrl');
      }
      const code = fixture.issueCode({ accountId: 'atl-tamper-gate4' });

      // Missing cookie
      const cbNoCookie = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ code, state });
      expect(cbNoCookie.status).toBe(400);
      expect(cbNoCookie.body.code).toBe('JIRA_STATE_INVALID');

      // Tampered cookie
      const cbTampered = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', 'ati_jira_browser=completely_invalid_tampered_cookie_string')
        .send({ code, state });
      expect(cbTampered.status).toBe(400);
      expect(cbTampered.body.code).toBe('JIRA_STATE_INVALID');
    });

    it('rejects cross-user callback injection when User B attempts to consume User A state', async () => {
      const actorA = await createActor('User A Gate4', 'user_a_gate4');
      const actorB = await createActor('User B Gate4', 'user_b_gate4');

      const startResA = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actorA.token}`)
        .send({ mode: 'identity' });
      const cookieA = extractBrowserCookie(startResA);
      const stateA = new URL(startResA.body.authUrl).searchParams.get('state');
      if (!stateA) {
        throw new Error('Expected stateA in authUrl');
      }
      const code = fixture.issueCode({ accountId: 'atl-cross-user' });

      // User B attempts to consume User A's state in User B's authenticated session
      const cbResB = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actorB.token}`)
        .set('Cookie', `ati_jira_browser=${cookieA}`)
        .send({ code, state: stateA });

      expect(cbResB.status).toBe(400);
      expect(cbResB.body.code).toBe('JIRA_STATE_INVALID');

      // Invariant: User B's account has no Jira connection established
      const accB = await repo.getAccountByUserId(actorB.userId);
      expect(accB).toBeNull();
    });

    it('enforces trusted conversationOwner on returnTo: accepts owned conversation, rejects conversation owned by another user, and rejects invalid formats', async () => {
      const actorA = await createActor('Conv Owner A', 'conv_owner_a');
      const actorB = await createActor('Conv Owner B', 'conv_owner_b');

      // Create genuine conversations in PostgreSQL
      const convA = await convRepo.createConversation(actorA.userId);
      const convB = await convRepo.createConversation(actorB.userId);

      // Case 1: Actor A starts flow with Actor A's owned conversation -> Accepted
      const startResA = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actorA.token}`)
        .send({ mode: 'identity', returnTo: `/c/${convA.id}` });

      expect(startResA.status).toBe(200);
      expect(startResA.body.authUrl).toBeDefined();

      const cookieA = extractBrowserCookie(startResA);
      const stateA = new URL(startResA.body.authUrl).searchParams.get('state');
      if (!stateA) {
        throw new Error('Expected stateA in authUrl');
      }
      const codeA = fixture.issueCode({ accountId: 'atl-conv-ok' });

      const cbResA = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actorA.token}`)
        .set('Cookie', `ati_jira_browser=${cookieA}`)
        .send({ code: codeA, state: stateA });

      expect(cbResA.status).toBe(200);
      expect(cbResA.body.returnTo).toBe(`/c/${convA.id}`);

      // Case 2: Actor A attempts to start flow claiming Actor B's conversation -> Rejected
      const startResAttack = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actorA.token}`)
        .send({ mode: 'identity', returnTo: `/c/${convB.id}` });

      expect(startResAttack.status).toBe(400);
      expect(startResAttack.body.code).toBe('RETURN_TO_INVALID');

      // Case 3: Malformed returnTo inputs (open redirect, arbitrary paths, non-UUID)
      const badInputs = [
        'https://malicious.example.com/oauth/steal',
        '//malicious.example.com',
        '/c/not-a-uuid',
        '/c/11111111-1111-1111-1111-11111111111z',
        'javascript:alert(1)',
      ];

      for (const badReturnTo of badInputs) {
        const res = await request(app)
          .post('/api/connections/myjira/start')
          .set('Authorization', `Bearer ${actorA.token}`)
          .send({ mode: 'identity', returnTo: badReturnTo });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('RETURN_TO_INVALID');
      }
    });
  });
});
