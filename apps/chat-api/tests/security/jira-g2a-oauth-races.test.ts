import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';
import { createJiraOAuthTestFixture, type JiraOAuthFixture } from '../helpers/jira-oauth-test-fixture.js';
import { JiraOAuthRepo } from '../../src/db/repositories/jira-oauth-repo.js';
import { JiraOAuthClient } from '../../src/services/jira/jira-oauth-client.js';
import { JiraTokenManager } from '../../src/services/jira/jira-token-manager.js';
import { JiraLeaseManager } from '../../src/services/jira/jira-lease-manager.js';
import { JiraDispatchGuard } from '../../src/services/jira/jira-dispatch-guard.js';

describe('JIRA-G2A Two-Session PostgreSQL 16 OAuth Races, Fencing & Lock-Order Suite', () => {
  let ctx: IsolatedTestContext;
  let poolA: pg.Pool;
  let poolB: pg.Pool;
  let fixture: JiraOAuthFixture;
  let repoA: JiraOAuthRepo;
  let repoB: JiraOAuthRepo;
  let client: JiraOAuthClient;

  const encryptionKey = '01234567890123456789012345678901';

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 10 });
    await ctx.runAllMigrations();
    poolA = ctx.createWorkerPool({ max: 5, applicationName: 'race_pool_a' });
    poolB = ctx.createWorkerPool({ max: 5, applicationName: 'race_pool_b' });
    fixture = await createJiraOAuthTestFixture();

    repoA = new JiraOAuthRepo(poolA, encryptionKey);
    repoB = new JiraOAuthRepo(poolB, encryptionKey);
    client = new JiraOAuthClient({
      clientId: 'g2a-race-client',
      clientSecret: 'g2a-race-secret',
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

  async function seedConnectedSitesUser(prefix: string) {
    const userId = await createSyntheticUser(ctx.pool, `${prefix} User`, prefix);
    const atlassianAccountId = `atl-${prefix}-${randomUUID().slice(0, 8)}`;
    const cloudId = randomUUID();

    const idCode = fixture.issueCode({
      accountId: atlassianAccountId,
      scopes: ['read:me', 'offline_access'],
    });
    const idTokens = await client.exchangeCode(idCode);
    await repoA.saveIdentityGrant(userId, {
      atlassianAccountId,
      accessToken: idTokens.accessToken,
      refreshToken: idTokens.refreshToken!,
      expiresInSeconds: 3600,
      scopes: ['read:me', 'offline_access'],
    });

    const code = fixture.issueCode({
      accountId: atlassianAccountId,
      scopes: ['read:me', 'read:jira-work', 'offline_access'],
      sites: [
        {
          id: cloudId,
          name: 'Race Site',
          url: 'https://race.atlassian.net',
          scopes: ['read:jira-work'],
        },
      ],
    });
    const exchanged = await client.exchangeCode(code);

    const saved = await repoA.saveSitesGrant(userId, {
      atlassianAccountId,
      accessToken: exchanged.accessToken,
      refreshToken: exchanged.refreshToken!,
      expiresInSeconds: 3600,
      scopes: ['read:me', 'read:jira-work', 'offline_access'],
      sites: [
        {
          id: cloudId,
          name: 'Race Site',
          url: 'https://race.atlassian.net',
          scopes: ['read:jira-work'],
        },
      ],
    });

    const accRow = await repoA.getAccountByUserId(userId);
    if (!accRow) throw new Error('Expected connected jira_accounts row');

    const workspaceId = randomUUID();
    await ctx.pool.query(
      `INSERT INTO workspaces (id, name, invite_code, require_approval, created_by)
       VALUES ($1, 'Race WS', $2, true, $3)`,
      [workspaceId, `RC-${randomUUID().slice(0, 6)}`.toUpperCase(), userId]
    );
    await ctx.pool.query(
      `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
       VALUES ($1, $2, 'active', 1, $3)`,
      [workspaceId, `ws-${randomUUID().slice(0, 8)}`, userId]
    );
    await ctx.pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status)
       VALUES ($1, $2, 'admin', 'active')`,
      [workspaceId, userId]
    );
    await ctx.pool.query(
      `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
       VALUES ($1, $2, 'admin', 'active', 1)`,
      [workspaceId, userId]
    );
    const siteRes = await ctx.pool.query<{ id: string }>(
      `INSERT INTO ati_workspace_jira_sites (
        workspace_id, cloud_id, site_name, site_url, active, policy_version, linked_by, verified_admin_by, admin_verified_at
      ) VALUES ($1, $2, 'Race Site', 'https://race.atlassian.net', true, 1, $3, $3, clock_timestamp())
      RETURNING id`,
      [workspaceId, cloudId, userId]
    );
    const siteId = siteRes.rows[0]!.id;
    await ctx.pool.query(
      `INSERT INTO ati_workspace_jira_projects (
        workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name, selected, policy_version
      ) VALUES ($1, $2, $3, '10000', 'RACE', 'Race Project', true, 1)`,
      [workspaceId, siteId, cloudId]
    );

    return {
      userId,
      atlassianAccountId,
      accountId: saved.accountId,
      grantId: saved.grantId,
      identityVersion: accRow.identity_version,
      cloudId,
      workspaceId,
      siteId,
    };
  }

  it('Verifies two independent PostgreSQL 16 backend sessions (distinct pg_backend_pid)', async () => {
    const c1 = await poolA.connect();
    const c2 = await poolB.connect();
    try {
      const r1 = await c1.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const r2 = await c2.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      expect(r1.rows[0]!.pid).not.toBe(r2.rows[0]!.pid);
    } finally {
      c1.release();
      c2.release();
    }
  });

  it('RT-RACE-01: OAuth re-consent creates a NEW grantId, increments identity_version, revokes prior leases, and fences concurrent stale refresh on old grant', async () => {
    const seed = await seedConnectedSitesUser('race01');

    const tokenMgrA = new JiraTokenManager({
      pool: poolA,
      client,
      repo: repoA,
      encryptionKey,
      refreshTimeoutMs: 8_000,
    });
    const leaseMgr = new JiraLeaseManager({ pool: poolA, tokenManager: tokenMgrA });
    const oldLease = await leaseMgr.acquireLease({
      userId: seed.userId,
      workspaceId: seed.workspaceId,
      cloudId: seed.cloudId,
      projectId: '10000',
    });

    // Expire grant 1 so Session A attempts a refresh
    await ctx.pool.query(
      `UPDATE jira_oauth_grants SET expires_at = NOW() - INTERVAL '2 minutes' WHERE id = $1`,
      [seed.grantId]
    );

    // Issue fresh OAuth code for re-consent BEFORE pausing /oauth/token on the refresh call
    const reconsentCode = fixture.issueCode({
      accountId: seed.atlassianAccountId,
      scopes: ['read:me', 'read:jira-work', 'offline_access'],
      sites: [
        {
          id: seed.cloudId,
          name: 'Race Site',
          url: 'https://race.atlassian.net',
          scopes: ['read:jira-work'],
        },
      ],
    });
    const reconsentTokens = await client.exchangeCode(reconsentCode);

    const refreshBarrier = fixture.pauseNext('/oauth/token');
    const staleRefreshPromise = tokenMgrA.getAccessToken(seed.userId, { forceRefresh: true });

    await refreshBarrier.reached;

    // Session B performs re-consent while Session A's old grant refresh is mid-flight at Atlassian
    const reconsentSaved = await repoB.saveSitesGrant(seed.userId, {
      atlassianAccountId: seed.atlassianAccountId,
      accessToken: reconsentTokens.accessToken,
      refreshToken: reconsentTokens.refreshToken!,
      expiresInSeconds: 3600,
      scopes: ['read:me', 'read:jira-work', 'offline_access'],
      sites: [
        {
          id: seed.cloudId,
          name: 'Race Site',
          url: 'https://race.atlassian.net',
          scopes: ['read:jira-work'],
        },
      ],
    });

    refreshBarrier.release();

    // Old grant refresh MUST fail closed (grant revoked/superseded) and MUST NOT overwrite new grant!
    await expect(staleRefreshPromise).rejects.toThrow();

    const accAfter = await repoB.getAccountByUserId(seed.userId);
    expect(reconsentSaved.grantId).not.toBe(seed.grantId);
    expect(accAfter!.identity_version).toBeGreaterThan(seed.identityVersion);

    const oldGrantRow = await ctx.pool.query<{
      status: string;
      encrypted_access_token: string | null;
      encrypted_refresh_token: string | null;
    }>(`SELECT status, encrypted_access_token, encrypted_refresh_token FROM jira_oauth_grants WHERE id = $1`, [
      seed.grantId,
    ]);
    expect(oldGrantRow.rows[0]).toEqual({
      status: 'revoked',
      encrypted_access_token: null,
      encrypted_refresh_token: null,
    });

    const oldLeaseRow = await ctx.pool.query<{ status: string }>(
      `SELECT status FROM jira_authorization_leases WHERE lease_id = $1`,
      [oldLease.leaseId]
    );
    expect(oldLeaseRow.rows[0]?.status).toBe('revoked');

    const tokenMgrB = new JiraTokenManager({
      pool: poolB,
      client,
      repo: repoB,
      encryptionKey,
    });
    const currentAccessToken = await tokenMgrB.getAccessToken(seed.userId);
    expect(currentAccessToken).toBe(reconsentTokens.accessToken);
  });

  it('RT-RACE-02: Concurrent routine token refresh across two worker pools executes 1 rotation and preserves grantId, identity_version, and active lease', async () => {
    const seed = await seedConnectedSitesUser('race02');
    const mgrA = new JiraTokenManager({ pool: poolA, client, repo: repoA, encryptionKey });
    const mgrB = new JiraTokenManager({ pool: poolB, client, repo: repoB, encryptionKey });
    const leaseMgr = new JiraLeaseManager({ pool: poolA, tokenManager: mgrA });

    const activeLease = await leaseMgr.acquireLease({
      userId: seed.userId,
      workspaceId: seed.workspaceId,
      cloudId: seed.cloudId,
      projectId: '10000',
    });

    await ctx.pool.query(
      `UPDATE jira_oauth_grants SET expires_at = NOW() - INTERVAL '2 minutes' WHERE id = $1`,
      [seed.grantId]
    );

    const beforeRefreshCount = fixture.requests.filter(
      (r) => r.path === '/oauth/token' && r.body?.grant_type === 'refresh_token'
    ).length;

    const [tokA, tokB] = await Promise.all([
      mgrA.getAccessToken(seed.userId),
      mgrB.getAccessToken(seed.userId),
    ]);

    const afterRefreshCount = fixture.requests.filter(
      (r) => r.path === '/oauth/token' && r.body?.grant_type === 'refresh_token'
    ).length;

    expect(tokA).toBe(tokB);
    expect(afterRefreshCount - beforeRefreshCount).toBe(1);

    const accAfter = await repoA.getAccountByUserId(seed.userId);
    const grantAfter = await repoA.getActiveGrantByUserId(seed.userId);
    expect(accAfter?.identity_version).toBe(seed.identityVersion);
    expect(grantAfter?.id).toBe(seed.grantId);
    expect(grantAfter?.token_version).toBeGreaterThan(1);

    const reval = await leaseMgr.revalidateLease(activeLease.leaseId);
    expect(reval.valid).toBe(true);
  });

  it('RT-RACE-03: Disconnect during in-flight refresh discards rotated credentials and leaves grant revoked with NULL tokens', async () => {
    const seed = await seedConnectedSitesUser('race03');
    await ctx.pool.query(
      `UPDATE jira_oauth_grants SET expires_at = NOW() - INTERVAL '2 minutes' WHERE id = $1`,
      [seed.grantId]
    );

    const mgrA = new JiraTokenManager({ pool: poolA, client, repo: repoA, encryptionKey });
    const barrier = fixture.pauseNext('/oauth/token');
    const inFlight = mgrA.getAccessToken(seed.userId, { forceRefresh: true });

    await barrier.reached;
    const disc = await repoB.disconnect(seed.userId);
    expect(disc.disconnected).toBe(true);

    barrier.release();
    await expect(inFlight).rejects.toThrow();

    const grantCheck = await ctx.pool.query<{
      status: string;
      encrypted_access_token: string | null;
      encrypted_refresh_token: string | null;
    }>(`SELECT status, encrypted_access_token, encrypted_refresh_token FROM jira_oauth_grants WHERE id = $1`, [
      seed.grantId,
    ]);
    expect(grantCheck.rows[0]).toEqual({
      status: 'revoked',
      encrypted_access_token: null,
      encrypted_refresh_token: null,
    });
  });

  it('RT-RACE-04: Post-rotation DB persistence error marks grant reconnect_required (PERSIST_FAILED_AFTER_ROTATION) instead of leaving stuck refreshing state', async () => {
    const seed = await seedConnectedSitesUser('race04');
    await ctx.pool.query(
      `UPDATE jira_oauth_grants SET expires_at = NOW() - INTERVAL '2 minutes' WHERE id = $1`,
      [seed.grantId]
    );

    let failNextPersistUpdate = true;
    const faultPool = new Proxy(poolA, {
      get(target, prop, receiver) {
        if (prop === 'query') {
          return async (sql: any, params?: any) => {
            const text = typeof sql === 'string' ? sql : sql?.text ?? '';
            if (
              failNextPersistUpdate &&
              text.includes('UPDATE jira_oauth_grants') &&
              text.includes('token_version = token_version + 1')
            ) {
              failNextPersistUpdate = false;
              throw new Error('SIMULATED_POST_ROTATION_DB_WRITE_FAILURE');
            }
            return (target.query as any)(sql, params);
          };
        }
        if (prop === 'connect') return target.connect.bind(target);
        return Reflect.get(target, prop, receiver);
      },
    });

    const mgrFault = new JiraTokenManager({
      pool: faultPool as unknown as pg.Pool,
      client,
      repo: repoA,
      encryptionKey,
    });

    await expect(mgrFault.getAccessToken(seed.userId, { forceRefresh: true })).rejects.toMatchObject({
      code: 'RECONNECT_REQUIRED',
    });

    const grantRow = await ctx.pool.query<{
      status: string;
      status_reason: string | null;
      refresh_state: string;
      encrypted_access_token: string | null;
      encrypted_refresh_token: string | null;
    }>(
      `SELECT status, status_reason, refresh_state, encrypted_access_token, encrypted_refresh_token
       FROM jira_oauth_grants WHERE id = $1`,
      [seed.grantId]
    );
    expect(grantRow.rows[0]).toEqual({
      status: 'reconnect_required',
      status_reason: 'PERSIST_FAILED_AFTER_ROTATION',
      refresh_state: 'idle',
      encrypted_access_token: null,
      encrypted_refresh_token: null,
    });
  });

  it('RT-RACE-05 & RT-RACE-06: Concurrent disconnect vs executeGuardedDispatch/withLockedLease across two PG sessions obeys unified lock hierarchy with ZERO deadlocks (40P01)', async () => {
    const seed = await seedConnectedSitesUser('race05');
    const tokenMgrA = new JiraTokenManager({ pool: poolA, client, repo: repoA, encryptionKey });
    const leaseMgrA = new JiraLeaseManager({ pool: poolA, tokenManager: tokenMgrA });
    const guardA = new JiraDispatchGuard(poolA, leaseMgrA, tokenMgrA);

    const outcomes = await Promise.allSettled([
      guardA.executeGuardedDispatch(
        {
          userId: seed.userId,
          workspaceId: seed.workspaceId,
          cloudId: seed.cloudId,
          siteId: seed.siteId,
          projectId: '10000',
          expectedGrantId: seed.grantId,
          expectedAccountId: seed.accountId,
          expectedAtlassianAccountId: seed.atlassianAccountId,
          expectedIdentityVersion: seed.identityVersion,
        },
        {
          isWrite: false,
          tool: 'myjira.search_issues',
        },
        async () => {
          await new Promise((r) => setTimeout(r, 25));
          return { issues: [] };
        }
      ),
      repoB.disconnect(seed.userId),
    ]);

    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        expect((outcome.reason as any)?.code).not.toBe('40P01');
      }
    }

    // Subsequent dispatch after disconnect MUST fail closed immediately
    await expect(
      guardA.executeGuardedDispatch(
        {
          userId: seed.userId,
          workspaceId: seed.workspaceId,
          cloudId: seed.cloudId,
          siteId: seed.siteId,
          projectId: '10000',
          expectedGrantId: seed.grantId,
        },
        {
          isWrite: false,
          tool: 'myjira.search_issues',
        },
        async () => ({ leaked: true })
      )
    ).rejects.toThrow();
  });
});
