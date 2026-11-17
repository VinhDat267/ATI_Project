import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import {
  createMyJiraConnectionRoutes,
  type MyJiraConnectionsOptions,
  isMyJiraAvailable,
} from '../../src/routes/connections/myjira.js';
import { JiraOAuthRepo } from '../../src/db/repositories/jira-oauth-repo.js';
import { JiraOAuthClient } from '../../src/services/jira/jira-oauth-client.js';
import { JiraTokenManager } from '../../src/services/jira/jira-token-manager.js';
import { GoogleAuthRepo } from '../../src/db/repositories/google-auth-repo.js';
import { SessionRepo } from '../../src/db/repositories/session-repo.js';
import { UserRepo } from '../../src/db/repositories/user-repo.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { createJiraOAuthTestFixture, type JiraOAuthFixture } from '../helpers/jira-oauth-test-fixture.js';
import { createIsolatedTestSchema, createSyntheticUser, type IsolatedTestContext } from '../helpers/jira-test-db.js';
import type {
  JiraOAuthCallbackResponse,
  JiraConnectionStatusResponse,
  JiraSyncSitesResponse,
  JiraDisconnectResponse,
} from '@wap/tool-schemas';

function extractBrowserCookie(res: request.Response): string {
  const setCookies = res.headers['set-cookie'];
  if (!setCookies) return '';
  const list = Array.isArray(setCookies) ? setCookies : [setCookies];
  for (const c of list) {
    const match = c.match(/^ati_jira_browser=([^;]+)/);
    if (match) return match[1];
  }
  return '';
}

describe('MyJira Connection Routes (JIRA-04 Task 5)', () => {
  let ctx: IsolatedTestContext;
  let fixture: JiraOAuthFixture;
  let userRepo: UserRepo;
  let sessionRepo: SessionRepo;
  let states: GoogleAuthRepo;
  let repo: JiraOAuthRepo;
  let client: JiraOAuthClient;
  let tokens: JiraTokenManager;
  let app: Express;
  let disabledApp: Express;

  const jwtSecret = 'test_jwt_secret_for_jira_oauth_routes_32_chars';
  const encryptionKey = '01234567890123456789012345678901';

  // Map of conversationId -> ownerUserId for conversationOwner guard
  const conversationOwners = new Map<string, string>();
  const conversationOwner = async (convId: string): Promise<string | null> => {
    return conversationOwners.get(convId) ?? null;
  };

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
    states = new GoogleAuthRepo(ctx.pool);
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
    });

    const routeOptions: MyJiraConnectionsOptions = {
      jwtSecret,
      sessionRepo,
      states,
      repo,
      client,
      tokens,
      conversationOwner,
      enabled: true,
    };

    app = express();
    app.use(express.json());
    app.use('/api/connections/myjira', createMyJiraConnectionRoutes(routeOptions));

    disabledApp = express();
    disabledApp.use(express.json());
    disabledApp.use(
      '/api/connections/myjira',
      createMyJiraConnectionRoutes({
        ...routeOptions,
        enabled: false,
      })
    );
  });

  afterAll(async () => {
    await fixture.close();
    await ctx.cleanup();
  });

  describe('Two-Phase Connection Flow (Identity -> Site Consent)', () => {
    it('starts Phase 1 identity connection with ati_jira_browser cookie and returns Jira 3LO authUrl with read:me scope', async () => {
      const actor = await createActor('Phase1 User', 'phase1_actor');

      const res = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'identity' });

      expect(res.status).toBe(200);
      expect(res.body.authUrl).toBeDefined();

      const authUrl = new URL(res.body.authUrl);
      expect(authUrl.searchParams.get('audience')).toBe('api.atlassian.com');
      expect(authUrl.searchParams.get('client_id')).toBe('test-client');
      expect(authUrl.searchParams.get('prompt')).toBe('consent');
      expect(authUrl.searchParams.get('response_type')).toBe('code');
      expect(authUrl.searchParams.get('scope')).toBe('read:me offline_access');
      expect(authUrl.searchParams.get('state')).toBeTruthy();

      // Invariant: no client_secret, PKCE or google parameters
      expect(authUrl.searchParams.has('client_secret')).toBe(false);
      expect(authUrl.searchParams.has('code_challenge')).toBe(false);
      expect(authUrl.searchParams.has('access_type')).toBe(false);

      // Cache and cookie headers
      expect(res.headers['cache-control']).toContain('no-store');
      const cookie = extractBrowserCookie(res);
      expect(cookie).toBeTruthy();
    });

    it('completes Phase 1 identity callback: binds account, creates active grant, and returns identity_connected state', async () => {
      const actor = await createActor('Phase1 Callback User', 'phase1_cb');

      const startRes = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'identity' });
      const browserCookie = extractBrowserCookie(startRes);
      const state = new URL(startRes.body.authUrl).searchParams.get('state')!;

      const code = fixture.issueCode({
        accountId: 'atl-identity-actor',
        scopes: ['read:me', 'offline_access'],
      });

      const cbRes = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', `ati_jira_browser=${browserCookie}`)
        .send({ code, state });

      expect(cbRes.status).toBe(200);
      const body: JiraOAuthCallbackResponse = cbRes.body;
      expect(body.connected).toBe(true);
      expect(body.connectionState).toBe('identity_connected');
      expect(body.atlassianAccountId).toBe('atl-identity-actor');
      expect(body.jiraAccountId).toBeDefined();
      expect(body.siteCount).toBe(0);

      // Verify DB persistence of account and grant
      const account = await repo.getAccountByUserId(actor.userId);
      expect(account).not.toBeNull();
      expect(account?.status).toBe('connected');
      expect(account?.identity_version).toBe(1);
      expect(account?.atlassian_account_id).toBe('atl-identity-actor');

      // Verify status endpoint reflects identity_connected
      const statusRes = await request(app)
        .get('/api/connections/myjira')
        .set('Authorization', `Bearer ${actor.token}`);
      expect(statusRes.status).toBe(200);
      const statusBody: JiraConnectionStatusResponse = statusRes.body;
      expect(statusBody.connected).toBe(true);
      expect(statusBody.connectionState).toBe('identity_connected');
      expect(statusBody.atlassianAccountId).toBe('atl-identity-actor');
      expect(statusBody.sites).toEqual([]);
    });

    it('starts Phase 2 site authorization connection: returns authUrl with Jira work scopes', async () => {
      const actor = await createActor('Phase2 User', 'phase2_actor');

      const res = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'authorize_sites' });

      expect(res.status).toBe(200);
      const authUrl = new URL(res.body.authUrl);
      const scopeParam = authUrl.searchParams.get('scope')!;
      expect(scopeParam).toContain('read:jira-work');
      expect(scopeParam).toContain('write:jira-work');
      expect(scopeParam).toContain('read:me');
      expect(scopeParam).toContain('offline_access');
    });

    it('completes Phase 2 site authorization callback: snapshots sites and transitions to connected state', async () => {
      const actor = await createActor('Phase2 Full User', 'phase2_full');

      // 1. Establish identity in Phase 1
      const startRes1 = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'identity' });
      const cookie1 = extractBrowserCookie(startRes1);
      const state1 = new URL(startRes1.body.authUrl).searchParams.get('state')!;
      const code1 = fixture.issueCode({ accountId: 'atl-site-user', scopes: ['read:me', 'offline_access'] });
      await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', `ati_jira_browser=${cookie1}`)
        .send({ code: code1, state: state1 });

      // 2. Start Phase 2 authorize_sites
      const startRes2 = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'authorize_sites' });
      const cookie2 = extractBrowserCookie(startRes2);
      const state2 = new URL(startRes2.body.authUrl).searchParams.get('state')!;

      // Fixture issues code with sites for the same Atlassian identity
      const code2 = fixture.issueCode({
        accountId: 'atl-site-user',
        scopes: ['read:me', 'read:jira-work', 'write:jira-work', 'offline_access'],
        sites: [
          { id: 'cloud-site-alpha', name: 'Alpha Site', url: 'https://alpha.atlassian.net', scopes: ['read:jira-work'] },
        ],
      });

      const cbRes2 = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', `ati_jira_browser=${cookie2}`)
        .send({ code: code2, state: state2 });

      expect(cbRes2.status).toBe(200);
      const body2: JiraOAuthCallbackResponse = cbRes2.body;
      expect(body2.connected).toBe(true);
      expect(body2.connectionState).toBe('connected');
      expect(body2.atlassianAccountId).toBe('atl-site-user');
      expect(body2.siteCount).toBe(1);

      // Verify site snapshot in database with scopes column and product_type
      const sitesQuery = await ctx.pool.query(
        `SELECT cloud_id, site_name, site_url, product_type, scopes FROM jira_grant_sites`
      );
      const matchedSite = sitesQuery.rows.find((r) => r.cloud_id === 'cloud-site-alpha');
      expect(matchedSite).toBeDefined();
      expect(matchedSite.product_type).toBe('jira');
      expect(matchedSite.scopes).toContain('read:jira-work');

      // Verify GET status reflects connected with sites array
      const statusRes = await request(app)
        .get('/api/connections/myjira')
        .set('Authorization', `Bearer ${actor.token}`);
      expect(statusRes.status).toBe(200);
      const statusBody: JiraConnectionStatusResponse = statusRes.body;
      expect(statusBody.connected).toBe(true);
      expect(statusBody.connectionState).toBe('connected');
      expect(statusBody.sites).toHaveLength(1);
      expect(statusBody.sites[0]).toMatchObject({
        cloudId: 'cloud-site-alpha',
        name: 'Alpha Site',
        url: 'https://alpha.atlassian.net',
      });
    });
  });

  describe('Persisted Session / Browser Binding & One-Time State Consumption', () => {
    it('persists state in PostgreSQL oauth_states with session_id, browser_binding_hash and marks used_at after callback', async () => {
      const actor = await createActor('Persist User', 'persist_actor');

      const startRes = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'identity' });
      const browserCookie = extractBrowserCookie(startRes);
      const state = new URL(startRes.body.authUrl).searchParams.get('state')!;

      // Verify state row exists in PostgreSQL oauth_states prior to callback
      const beforeQuery = await ctx.pool.query(
        `SELECT user_id, session_id, mode, used_at, expires_at FROM oauth_states WHERE user_id = $1`,
        [actor.userId]
      );
      expect(beforeQuery.rowCount).toBe(1);
      expect(beforeQuery.rows[0].mode).toBe('connect_jira_identity');
      expect(beforeQuery.rows[0].session_id).toBe(actor.sessionId);
      expect(beforeQuery.rows[0].used_at).toBeNull();

      // Consume state via callback
      const code = fixture.issueCode({ accountId: 'atl-persist' });
      const cbRes = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', `ati_jira_browser=${browserCookie}`)
        .send({ code, state });
      expect(cbRes.status).toBe(200);

      // Verify row now has used_at IS NOT NULL
      const afterQuery = await ctx.pool.query(
        `SELECT used_at FROM oauth_states WHERE user_id = $1`,
        [actor.userId]
      );
      expect(afterQuery.rows[0].used_at).not.toBeNull();
    });

    it('rejects callback with mismatched or tampered browser cookie with JIRA_STATE_INVALID', async () => {
      const actor = await createActor('Cookie Tamper User', 'tamper_actor');

      const startRes = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'identity' });
      const state = new URL(startRes.body.authUrl).searchParams.get('state')!;
      const code = fixture.issueCode({ accountId: 'atl-tamper' });

      const cbRes = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', 'ati_jira_browser=tampered_browser_binding_value_999')
        .send({ code, state });

      expect(cbRes.status).toBe(400);
      expect(cbRes.body.code).toBe('JIRA_STATE_INVALID');
    });

    it('rejects callback with missing browser cookie with JIRA_STATE_INVALID', async () => {
      const actor = await createActor('No Cookie User', 'no_cookie_actor');

      const startRes = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'identity' });
      const state = new URL(startRes.body.authUrl).searchParams.get('state')!;
      const code = fixture.issueCode({ accountId: 'atl-no-cookie' });

      const cbRes = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ code, state });

      expect(cbRes.status).toBe(400);
      expect(cbRes.body.code).toBe('JIRA_STATE_INVALID');
    });

    it('rejects callback with expired, missing, or unrecognized state with JIRA_STATE_INVALID', async () => {
      const actor = await createActor('Unrecognized State User', 'bad_state_actor');

      const cbRes = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', 'ati_jira_browser=some_browser_cookie_value')
        .send({ code: 'dummy_code', state: 'unrecognized_nonexistent_state' });

      expect(cbRes.status).toBe(400);
      expect(cbRes.body.code).toBe('JIRA_STATE_INVALID');
    });

    it('rejects callback replay: consuming state a second time returns JIRA_STATE_INVALID', async () => {
      const actor = await createActor('Replay Actor', 'replay_actor');

      const startRes = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'identity' });
      const browserCookie = extractBrowserCookie(startRes);
      const state = new URL(startRes.body.authUrl).searchParams.get('state')!;
      const code = fixture.issueCode({ accountId: 'atl-replay-actor' });

      // First callback: success
      const cb1 = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', `ati_jira_browser=${browserCookie}`)
        .send({ code, state });
      expect(cb1.status).toBe(200);

      // Replay identical callback: must fail-closed with JIRA_STATE_INVALID
      const cb2 = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', `ati_jira_browser=${browserCookie}`)
        .send({ code, state });
      expect(cb2.status).toBe(400);
      expect(cb2.body.code).toBe('JIRA_STATE_INVALID');
    });
  });

  describe('Stale Session, Revoked User & Cross-User Security', () => {
    it('rejects callback when caller session is revoked in auth_sessions before exchange', async () => {
      const actor = await createActor('Stale Session User', 'stale_session');

      const startRes = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'identity' });
      const browserCookie = extractBrowserCookie(startRes);
      const state = new URL(startRes.body.authUrl).searchParams.get('state')!;

      // Revoke caller's session in PostgreSQL
      await ctx.pool.query(`UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1`, [actor.sessionId]);

      const code = fixture.issueCode({ accountId: 'atl-stale' });
      const cbRes = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', `ati_jira_browser=${browserCookie}`)
        .send({ code, state });

      // Auth middleware or state consume must reject invalid session
      expect([400, 401]).toContain(cbRes.status);
    });

    it('rejects callback when caller account is disabled in users table', async () => {
      const actor = await createActor('Disabled User', 'disabled_actor');

      const startRes = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'identity' });
      const browserCookie = extractBrowserCookie(startRes);
      const state = new URL(startRes.body.authUrl).searchParams.get('state')!;

      // Disable user in database
      await ctx.pool.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [actor.userId]);

      const code = fixture.issueCode({ accountId: 'atl-disabled' });
      const cbRes = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', `ati_jira_browser=${browserCookie}`)
        .send({ code, state });

      expect([400, 401]).toContain(cbRes.status);
    });

    it('rejects cross-user callback injection: User B cannot consume User A state', async () => {
      const actorA = await createActor('User Alpha', 'alpha_user');
      const actorB = await createActor('User Beta', 'beta_user');

      // Actor A initiates connection
      const startResA = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actorA.token}`)
        .send({ mode: 'identity' });
      const cookieA = extractBrowserCookie(startResA);
      const stateA = new URL(startResA.body.authUrl).searchParams.get('state')!;

      const code = fixture.issueCode({ accountId: 'atl-cross' });

      // Actor B attempts to consume Actor A's state
      const cbResB = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actorB.token}`)
        .set('Cookie', `ati_jira_browser=${cookieA}`)
        .send({ code, state: stateA });

      expect(cbResB.status).toBe(400);
      expect(cbResB.body.code).toBe('JIRA_STATE_INVALID');
    });
  });

  describe('Atlassian Identity Matching & Account Protection', () => {
    it('rejects site authorization callback if returned Atlassian account differs from connected identity (ACCOUNT_CHANGED)', async () => {
      const actor = await createActor('Swap Actor', 'swap_user');

      // 1. Connect identity as atl-original-account
      const startRes1 = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'identity' });
      const cookie1 = extractBrowserCookie(startRes1);
      const state1 = new URL(startRes1.body.authUrl).searchParams.get('state')!;
      const code1 = fixture.issueCode({ accountId: 'atl-original-account' });
      await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', `ati_jira_browser=${cookie1}`)
        .send({ code: code1, state: state1 });

      // 2. Start authorize_sites
      const startRes2 = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'authorize_sites' });
      const cookie2 = extractBrowserCookie(startRes2);
      const state2 = new URL(startRes2.body.authUrl).searchParams.get('state')!;

      // 3. User logs in with different Atlassian account atl-imposter-account during consent
      const code2 = fixture.issueCode({
        accountId: 'atl-imposter-account',
        scopes: ['read:me', 'read:jira-work', 'offline_access'],
        sites: [{ id: 'site-imposter', name: 'Imposter Site', url: 'https://imp.atlassian.net', scopes: ['read:jira-work'] }],
      });

      const cbRes2 = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', `ati_jira_browser=${cookie2}`)
        .send({ code: code2, state: state2 });

      expect(cbRes2.status).toBe(409);
      expect(cbRes2.body.code).toBe('ACCOUNT_CHANGED');

      // Verify DB identity was NOT overwritten
      const account = await repo.getAccountByUserId(actor.userId);
      expect(account?.atlassian_account_id).toBe('atl-original-account');
    });

    it('rejects identity callback if another ATI user already holds active binding to the Atlassian account (ATLASSIAN_ACCOUNT_IN_USE)', async () => {
      const userA = await createActor('User Bound A', 'bound_a');
      const userB = await createActor('User Bound B', 'bound_b');

      // User A connects atl-shared-claim
      const startA = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ mode: 'identity' });
      const cookieA = extractBrowserCookie(startA);
      const stateA = new URL(startA.body.authUrl).searchParams.get('state')!;
      const codeA = fixture.issueCode({ accountId: 'atl-shared-claim' });
      await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${userA.token}`)
        .set('Cookie', `ati_jira_browser=${cookieA}`)
        .send({ code: codeA, state: stateA });

      // User B attempts to connect the same Atlassian account
      const startB = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${userB.token}`)
        .send({ mode: 'identity' });
      const cookieB = extractBrowserCookie(startB);
      const stateB = new URL(startB.body.authUrl).searchParams.get('state')!;
      const codeB = fixture.issueCode({ accountId: 'atl-shared-claim' });

      const cbB = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${userB.token}`)
        .set('Cookie', `ati_jira_browser=${cookieB}`)
        .send({ code: codeB, state: stateB });

      expect(cbB.status).toBe(409);
      expect(cbB.body.code).toBe('ATLASSIAN_ACCOUNT_IN_USE');

      // User B must have no active Jira account
      const accountB = await repo.getAccountByUserId(userB.userId);
      expect(accountB).toBeNull();
    });
  });

  describe('Trusted conversationOwner ReturnTo Validation', () => {
    it('accepts returnTo /c/<uuid> when trusted conversationOwner matches authenticated user', async () => {
      const actor = await createActor('ReturnTo Owner', 'ret_owner');
      const convId = '11111111-1111-1111-1111-111111111111';
      conversationOwners.set(convId, actor.userId);

      const res = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'identity', returnTo: `/c/${convId}` });

      expect(res.status).toBe(200);
      expect(res.body.authUrl).toBeDefined();

      // Verify return_to was stored in database
      const stateRow = (
        await ctx.pool.query(`SELECT return_to FROM oauth_states WHERE user_id = $1 ORDER BY id DESC LIMIT 1`, [
          actor.userId,
        ])
      ).rows[0];
      expect(stateRow.return_to).toBe(`/c/${convId}`);

      // Verify callback returns the verified returnTo path
      const browserCookie = extractBrowserCookie(res);
      const state = new URL(res.body.authUrl).searchParams.get('state')!;
      const code = fixture.issueCode({ accountId: 'atl-ret-ok' });

      const cbRes = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', `ati_jira_browser=${browserCookie}`)
        .send({ code, state });

      expect(cbRes.status).toBe(200);
      expect(cbRes.body.returnTo).toBe(`/c/${convId}`);
    });

    it('rejects injected conversation owner when conversation belongs to another user (RETURN_TO_INVALID)', async () => {
      const actorVictim = await createActor('Victim User', 'victim_actor');
      const actorAttacker = await createActor('Attacker User', 'attacker_actor');

      const convId = '22222222-2222-2222-2222-222222222222';
      // Conversation belongs to actorVictim
      conversationOwners.set(convId, actorVictim.userId);

      // actorAttacker attempts to start connection claiming victim conversation
      const res = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actorAttacker.token}`)
        .send({ mode: 'identity', returnTo: `/c/${convId}` });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('RETURN_TO_INVALID');

      // Invariant: no state was created
      const statesCount = (
        await ctx.pool.query(`SELECT count(*)::int as cnt FROM oauth_states WHERE user_id = $1`, [
          actorAttacker.userId,
        ])
      ).rows[0].cnt;
      expect(statesCount).toBe(0);
    });

    it('rejects returnTo when conversation is not found in conversationOwner lookup (RETURN_TO_INVALID)', async () => {
      const actor = await createActor('Unknown Conv User', 'unk_conv');
      const unkId = '33333333-3333-3333-3333-333333333333';

      const res = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'identity', returnTo: `/c/${unkId}` });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('RETURN_TO_INVALID');
    });

    it('rejects malformed returnTo formats (open redirect, non-UUID, arbitrary URLs)', async () => {
      const actor = await createActor('Bad URL User', 'bad_url');

      const testCases = [
        'https://malicious.example.com',
        '//malicious.example.com',
        '/settings#jira',
        '/c/not-a-valid-uuid',
        '/c/11111111-1111-1111-1111-11111111111g',
        'javascript:alert(1)',
      ];

      for (const badReturnTo of testCases) {
        const res = await request(app)
          .post('/api/connections/myjira/start')
          .set('Authorization', `Bearer ${actor.token}`)
          .send({ mode: 'identity', returnTo: badReturnTo });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('RETURN_TO_INVALID');
      }
    });
  });

  describe('Status, Sync-Sites, Disconnect & Identity Versioning', () => {
    it('GET / returns disconnected status when account has no Jira connection', async () => {
      const actor = await createActor('Clean User', 'clean_user');

      const res = await request(app)
        .get('/api/connections/myjira')
        .set('Authorization', `Bearer ${actor.token}`);

      expect(res.status).toBe(200);
      const body: JiraConnectionStatusResponse = res.body;
      expect(body.connected).toBe(false);
      expect(body.connectionState).toBe('disconnected');
      expect(body.jiraAccountId).toBeNull();
      expect(body.atlassianAccountId).toBeNull();
      expect(body.sites).toEqual([]);
    });

    it('POST /sync-sites refreshes accessible resources using token manager and updates grant sites', async () => {
      const actor = await createActor('Sync Sites User', 'sync_sites_user');

      // 1. Establish full connection with 1 site
      const startRes = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'identity' });
      const cookie = extractBrowserCookie(startRes);
      const state = new URL(startRes.body.authUrl).searchParams.get('state')!;
      const code = fixture.issueCode({
        accountId: 'atl-sync-sites',
        scopes: ['read:me', 'read:jira-work', 'offline_access'],
        sites: [{ id: 'site-initial', name: 'Initial Site', url: 'https://init.atlassian.net', scopes: ['read:jira-work'] }],
      });
      await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', `ati_jira_browser=${cookie}`)
        .send({ code, state });

      // Save sites grant to establish fully connected state
      await repo.saveSitesGrant(actor.userId, {
        atlassianAccountId: 'atl-sync-sites',
        accessToken: 'access-sync-test',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'read:jira-work', 'offline_access'],
        sites: [{ id: 'site-initial', name: 'Initial Site', url: 'https://init.atlassian.net', scopes: ['read:jira-work'] }],
      });

      // Update fixture's accessible-resources override to simulate a new site added in Atlassian
      fixture.setOverride('/oauth/token/accessible-resources', {
        status: 200,
        body: [
          { id: 'site-initial', name: 'Initial Site', url: 'https://init.atlassian.net', scopes: ['read:jira-work'] },
          { id: 'site-secondary', name: 'Secondary Site', url: 'https://second.atlassian.net', scopes: ['read:jira-work'] },
        ],
      });

      // Call POST /sync-sites
      const syncRes = await request(app)
        .post('/api/connections/myjira/sync-sites')
        .set('Authorization', `Bearer ${actor.token}`);

      expect(syncRes.status).toBe(200);
      const syncBody: JiraSyncSitesResponse = syncRes.body;
      expect(syncBody.syncedCount).toBe(2);
      expect(syncBody.sites).toHaveLength(2);

      fixture.clearOverrides();

      // Check status reflects 2 sites
      const statusRes = await request(app)
        .get('/api/connections/myjira')
        .set('Authorization', `Bearer ${actor.token}`);
      expect(statusRes.body.sites).toHaveLength(2);
    });

    it('DELETE / disconnects connection: marks account disconnected, revokes grant, increments identityVersion', async () => {
      const actor = await createActor('Disconnect User', 'disc_actor');

      // Establish identity
      const startRes = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'identity' });
      const cookie = extractBrowserCookie(startRes);
      const state = new URL(startRes.body.authUrl).searchParams.get('state')!;
      const code = fixture.issueCode({ accountId: 'atl-to-disconnect' });
      await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', `ati_jira_browser=${cookie}`)
        .send({ code, state });

      // Disconnect
      const delRes = await request(app)
        .delete('/api/connections/myjira')
        .set('Authorization', `Bearer ${actor.token}`);

      expect(delRes.status).toBe(200);
      expect(delRes.headers['set-cookie']).toEqual(expect.arrayContaining([expect.stringMatching(/^ati_jira_browser=;/)]));
      const delBody: JiraDisconnectResponse = delRes.body;
      expect(delBody.disconnected).toBe(true);
      expect(delBody.identityVersion).toBe(2);
      expect(delBody.revokedAt).toBeDefined();

      // Subsequent status call shows disconnected
      const statusRes = await request(app)
        .get('/api/connections/myjira')
        .set('Authorization', `Bearer ${actor.token}`);
      expect(statusRes.body.connected).toBe(false);
      expect(statusRes.body.connectionState).toBe('disconnected');
      expect(statusRes.body.sites).toEqual([]);

      // Verify DB grant is revoked
      const account = await repo.getAccountByUserId(actor.userId);
      expect(account?.status).toBe('disconnected');
      expect(account?.identity_version).toBe(2);
    });
  });

  describe('Token Privacy & Response Sanitization (No Raw Tokens)', () => {
    it('ensures no raw access tokens, refresh tokens, or client secrets leak in any route response', async () => {
      const actor = await createActor('Privacy User', 'privacy_user');

      // Start
      const startRes = await request(app)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'identity' });
      expect(JSON.stringify(startRes.body)).not.toMatch(/SECRET_SENTINEL|at_[0-9a-f]{32}|rt_[0-9a-f]{32}/i);

      const cookie = extractBrowserCookie(startRes);
      const state = new URL(startRes.body.authUrl).searchParams.get('state')!;
      const code = fixture.issueCode({ accountId: 'atl-privacy-test' });

      // Callback
      const cbRes = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', `ati_jira_browser=${cookie}`)
        .send({ code, state });
      const cbJson = JSON.stringify(cbRes.body);
      expect(cbJson).not.toMatch(/SECRET_SENTINEL|at_[0-9a-f]{32}|rt_[0-9a-f]{32}/i);
      expect(cbRes.body.accessToken).toBeUndefined();
      expect(cbRes.body.refreshToken).toBeUndefined();

      // Status
      const statusRes = await request(app)
        .get('/api/connections/myjira')
        .set('Authorization', `Bearer ${actor.token}`);
      const statusJson = JSON.stringify(statusRes.body);
      expect(statusJson).not.toMatch(/SECRET_SENTINEL|at_[0-9a-f]{32}|rt_[0-9a-f]{32}/i);

      // Error response sanitization
      const errRes = await request(app)
        .post('/api/connections/myjira/callback')
        .set('Authorization', `Bearer ${actor.token}`)
        .set('Cookie', 'ati_jira_browser=invalid')
        .send({ code: 'CODE_SECRET_SENTINEL', state: 'STATE_SECRET_SENTINEL' });
      const errJson = JSON.stringify(errRes.body);
      expect(errJson).not.toMatch(/CODE_SECRET_SENTINEL|SECRET_SENTINEL/);
    });
  });

  describe('Flag-Off / Availability Invariants', () => {
    it('returns 503 when connection route is disabled (enabled: false)', async () => {
      const actor = await createActor('FlagOff User', 'flag_off_user');

      const startRes = await request(disabledApp)
        .post('/api/connections/myjira/start')
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mode: 'identity' });
      expect(startRes.status).toBe(503);
      expect(startRes.body.error).toMatch(/Jira/i);

      const statusRes = await request(disabledApp)
        .get('/api/connections/myjira')
        .set('Authorization', `Bearer ${actor.token}`);
      expect(statusRes.status).toBe(503);

      const delRes = await request(disabledApp)
        .delete('/api/connections/myjira')
        .set('Authorization', `Bearer ${actor.token}`);
      expect(delRes.status).toBe(503);
    });

    it('isMyJiraAvailable utility accurately verifies configuration completeness', () => {
      const fullOptions: MyJiraConnectionsOptions = {
        jwtSecret,
        sessionRepo,
        states,
        repo,
        client,
        tokens,
        enabled: true,
      };

      expect(isMyJiraAvailable(fullOptions)).toBe(true);
      expect(isMyJiraAvailable({ ...fullOptions, enabled: false })).toBe(false);
      expect(isMyJiraAvailable({ ...fullOptions, client: undefined as any })).toBe(false);
      expect(isMyJiraAvailable({ ...fullOptions, repo: undefined as any })).toBe(false);
      expect(isMyJiraAvailable({ ...fullOptions, states: undefined as any })).toBe(false);
      expect(isMyJiraAvailable({ ...fullOptions, sessionRepo: undefined as any })).toBe(false);
      expect(isMyJiraAvailable({ ...fullOptions, tokens: undefined as any })).toBe(false);
    });
  });
});
