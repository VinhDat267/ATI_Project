import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JiraOAuthRepo } from '../../src/db/repositories/jira-oauth-repo.js';
import WorkspaceRepo, { type NativeAdminVerifier } from '../../src/db/repositories/workspace/index.js';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';
import { decryptCredentials } from '@wap/tool-adapters';

describe('JiraOAuthRepo (Real PostgreSQL Isolation & Jira03 Semantics)', () => {
  let ctx: IsolatedTestContext;
  let repo: JiraOAuthRepo;
  let workspaceRepo: WorkspaceRepo;
  const encryptionKey = '01234567890123456789012345678901';

  const dummyVerifier: NativeAdminVerifier = {
    async verifyAdminister() {
      return {
        status: 'granted',
        siteName: 'Verified Test Site',
        siteUrl: 'https://test.atlassian.net',
        verifiedProjectIds: ['10001'],
        verifiedProjects: [{ projectId: '10001', key: 'TEST', name: 'Test Project' }],
      };
    },
  };

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 6 });
    await ctx.runAllMigrations();
    repo = new JiraOAuthRepo(ctx.pool, encryptionKey);
    workspaceRepo = new WorkspaceRepo(ctx.pool, { verifier: dummyVerifier });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  describe('Identity Grant & Account Connection', () => {
    it('saves identity grant and establishes identity_connected state with account status connected', async () => {
      const userId = await createSyntheticUser(ctx.pool, 'User One', 'jira_user_1', {
        role: 'member',
        status: 'active',
      });
      const result = await repo.saveIdentityGrant(userId, {
        atlassianAccountId: 'atl-1',
        displayName: 'User One',
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'offline_access'],
      });
      expect(result.connectionState).toBe('identity_connected');
      expect(result.accountId).toBeDefined();
      expect(result.grantId).toBeDefined();

      const status = await repo.getConnectionStatus(userId);
      expect(status.connected).toBe(true);
      expect(status.connectionState).toBe('identity_connected');
      expect(status.atlassianAccountId).toBe('atl-1');
      expect(status.displayName).toBe('User One');
      expect(status.sites).toEqual([]);

      const acc = await repo.getAccountByUserId(userId);
      expect(acc?.status).toBe('connected');
      expect(acc?.atlassian_account_id).toBe('atl-1');

      const accByAtl = await repo.getAccountByAtlassianId('atl-1');
      expect(accByAtl?.id).toBe(acc?.id);
      expect(accByAtl?.user_id).toBe(userId);
    });

    it('encrypted payload via actual decrypt helper: encrypts tokens with AES-256-GCM and never stores plaintext in DB', async () => {
      const userId = await createSyntheticUser(ctx.pool, 'Crypto User', 'crypto_user', {
        role: 'member',
        status: 'active',
      });
      const rawAccessToken = 'secret-access-token-12345';
      const rawRefreshToken = 'secret-refresh-token-67890';

      const res = await repo.saveIdentityGrant(userId, {
        atlassianAccountId: 'atl-crypto',
        displayName: 'Crypto User',
        accessToken: rawAccessToken,
        refreshToken: rawRefreshToken,
        expiresInSeconds: 3600,
        scopes: ['read:me', 'offline_access'],
      });

      const dbRes = await ctx.pool.query<{
        encrypted_access_token: string;
        encrypted_refresh_token: string;
      }>(
        `SELECT encrypted_access_token, encrypted_refresh_token
         FROM jira_oauth_grants WHERE id = $1`,
        [res.grantId]
      );

      expect(dbRes.rowCount).toBe(1);
      const row = dbRes.rows[0];
      if (!row) throw new Error('Expected grant row to be defined');

      // Plaintext must never be stored directly in database columns
      expect(row.encrypted_access_token).not.toContain(rawAccessToken);
      expect(row.encrypted_refresh_token).not.toContain(rawRefreshToken);
      expect(row.encrypted_access_token.startsWith('v1:')).toBe(true);
      expect(row.encrypted_refresh_token.startsWith('v1:')).toBe(true);

      // Decrypt using actual decryptCredentials helper from @wap/tool-adapters
      const decryptedAccess = decryptCredentials<{ token: string }>(
        row.encrypted_access_token,
        encryptionKey
      );
      expect(decryptedAccess.token).toBe(rawAccessToken);

      const decryptedRefresh = decryptCredentials<{ token: string }>(
        row.encrypted_refresh_token,
        encryptionKey
      );
      expect(decryptedRefresh.token).toBe(rawRefreshToken);
    });
  });

  describe('Identity Uniqueness & Swap Rejection', () => {
    it('rejects identity save if user attempts to bind a second different atlassian account without disconnect (ACCOUNT_CHANGED)', async () => {
      const userId = await createSyntheticUser(ctx.pool, 'User Swap', 'jira_user_swap', {
        role: 'member',
        status: 'active',
      });
      await repo.saveIdentityGrant(userId, {
        atlassianAccountId: 'atl-swap-orig',
        accessToken: 'acc-orig',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'offline_access'],
      });

      await expect(
        repo.saveIdentityGrant(userId, {
          atlassianAccountId: 'atl-swap-different',
          accessToken: 'acc-diff',
          expiresInSeconds: 3600,
          scopes: ['read:me', 'offline_access'],
        })
      ).rejects.toThrowError(/ACCOUNT_CHANGED/);

      const acc = await repo.getAccountByUserId(userId);
      expect(acc?.atlassian_account_id).toBe('atl-swap-orig');
    });

    it('rejects identity save if another ATI user already holds active binding to this atlassian account (ATLASSIAN_ACCOUNT_IN_USE)', async () => {
      const userA = await createSyntheticUser(ctx.pool, 'User A', 'user_a', {
        role: 'member',
        status: 'active',
      });
      const userB = await createSyntheticUser(ctx.pool, 'User B', 'user_b', {
        role: 'member',
        status: 'active',
      });

      await repo.saveIdentityGrant(userA, {
        atlassianAccountId: 'atl-shared',
        accessToken: 'acc-a',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'offline_access'],
      });

      await expect(
        repo.saveIdentityGrant(userB, {
          atlassianAccountId: 'atl-shared',
          accessToken: 'acc-b',
          expiresInSeconds: 3600,
          scopes: ['read:me', 'offline_access'],
        })
      ).rejects.toThrowError(/ATLASSIAN_ACCOUNT_IN_USE/);

      const accB = await repo.getAccountByUserId(userB);
      expect(accB).toBeNull();
    });

    it('handles concurrent identity binding race for the same Atlassian account across two users: exactly one succeeds', async () => {
      const userA = await createSyntheticUser(ctx.pool, 'Race User A', 'race_user_a', {
        role: 'member',
        status: 'active',
      });
      const userB = await createSyntheticUser(ctx.pool, 'Race User B', 'race_user_b', {
        role: 'member',
        status: 'active',
      });
      const sharedAtlassianId = 'atl-concurrent-race-target';

      const results = await Promise.allSettled([
        repo.saveIdentityGrant(userA, {
          atlassianAccountId: sharedAtlassianId,
          accessToken: 'acc-race-a',
          expiresInSeconds: 3600,
          scopes: ['read:me', 'offline_access'],
        }),
        repo.saveIdentityGrant(userB, {
          atlassianAccountId: sharedAtlassianId,
          accessToken: 'acc-race-b',
          expiresInSeconds: 3600,
          scopes: ['read:me', 'offline_access'],
        }),
      ]);

      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled'
      );
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected'
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const firstRejected = rejected[0];
      if (!firstRejected) throw new Error('Expected at least one rejected promise');
      expect(firstRejected.reason?.message || firstRejected.reason?.code).toMatch(
        /ATLASSIAN_ACCOUNT_IN_USE/
      );

      // Verify that database has exactly one active row for this Atlassian account
      const dbRows = await ctx.pool.query(
        `SELECT user_id, atlassian_account_id, status
         FROM jira_accounts
         WHERE atlassian_account_id = $1 AND status = 'connected'`,
        [sharedAtlassianId]
      );
      expect(dbRows.rowCount).toBe(1);
    });

    it('rejects site re-consent if returned atlassian account does not match connected account (ACCOUNT_CHANGED)', async () => {
      const userId = await createSyntheticUser(ctx.pool, 'User Three', 'jira_user_3', {
        role: 'member',
        status: 'active',
      });
      await repo.saveIdentityGrant(userId, {
        atlassianAccountId: 'atl-3',
        accessToken: 'acc-3',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'offline_access'],
      });

      await expect(
        repo.saveSitesGrant(userId, {
          atlassianAccountId: 'atl-3-hacker',
          accessToken: 'acc-3b',
          expiresInSeconds: 3600,
          scopes: ['read:me', 'read:jira-work', 'offline_access'],
          sites: [
            {
              id: 'site-x',
              name: 'Site X',
              url: 'https://site-x.atlassian.net',
              scopes: ['read:jira-work'],
            },
          ],
        })
      ).rejects.toThrowError(/ACCOUNT_CHANGED/);
    });
  });

  describe('Sites Snapshot, Scopes, and Multi-Site Isolation', () => {
    it('persists sites snapshot with scopes column and maps DB columns to DTO camelCase', async () => {
      const userId = await createSyntheticUser(ctx.pool, 'User Sites', 'user_sites', {
        role: 'member',
        status: 'active',
      });
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
        sites: [
          {
            id: 'site-alpha',
            name: 'Site Alpha',
            url: 'https://alpha.atlassian.net',
            scopes: ['read:jira-work'],
          },
          {
            id: 'site-beta',
            name: 'Site Beta',
            url: 'https://beta.atlassian.net',
            scopes: ['read:jira-work', 'write:jira-work'],
          },
        ],
      });
      expect(res.connectionState).toBe('connected');
      expect(res.siteCount).toBe(2);

      // Verify PostgreSQL columns in jira_grant_sites
      const dbSites = await ctx.pool.query<{
        cloud_id: string;
        site_name: string;
        site_url: string;
        scopes: string[];
        product_type: string;
      }>(
        `SELECT cloud_id, site_name, site_url, scopes, product_type
         FROM jira_grant_sites
         WHERE grant_id = $1
         ORDER BY cloud_id ASC`,
        [res.grantId]
      );
      expect(dbSites.rowCount).toBe(2);
      const siteRow0 = dbSites.rows[0];
      const siteRow1 = dbSites.rows[1];
      if (!siteRow0 || !siteRow1) throw new Error('Expected 2 site rows');
      expect(siteRow0).toMatchObject({
        cloud_id: 'site-alpha',
        site_name: 'Site Alpha',
        site_url: 'https://alpha.atlassian.net',
        scopes: ['read:jira-work'],
        product_type: 'jira',
      });
      expect(siteRow1).toMatchObject({
        cloud_id: 'site-beta',
        site_name: 'Site Beta',
        site_url: 'https://beta.atlassian.net',
        scopes: ['read:jira-work', 'write:jira-work'],
        product_type: 'jira',
      });

      // Verify DTO formatting in getConnectionStatus
      const status = await repo.getConnectionStatus(userId);
      expect(status.connected).toBe(true);
      expect(status.connectionState).toBe('connected');
      expect(status.sites).toHaveLength(2);
      const alphaSite = status.sites.find((s) => s.cloudId === 'site-alpha');
      expect(alphaSite).toMatchObject({
        cloudId: 'site-alpha',
        name: 'Site Alpha',
        url: 'https://alpha.atlassian.net',
      });
      expect(alphaSite?.lastVerifiedAt).toBeDefined();
    });

    it('syncSites updates site snapshot for existing grant and handles site metadata updates cleanly', async () => {
      const userId = await createSyntheticUser(ctx.pool, 'Sync User', 'sync_user', {
        role: 'member',
        status: 'active',
      });
      await repo.saveIdentityGrant(userId, {
        atlassianAccountId: 'atl-sync',
        accessToken: 'acc-sync-1',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'offline_access'],
      });

      await repo.saveSitesGrant(userId, {
        atlassianAccountId: 'atl-sync',
        accessToken: 'acc-sync-2',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'read:jira-work', 'offline_access'],
        sites: [
          {
            id: 'site-sync-1',
            name: 'Initial Site 1',
            url: 'https://s1.atlassian.net',
            scopes: ['read:jira-work'],
          },
        ],
      });

      const syncedCount = await repo.syncSites(userId, [
        {
          id: 'site-sync-1',
          name: 'Renamed Site 1',
          url: 'https://s1-updated.atlassian.net',
          scopes: ['read:jira-work', 'write:jira-work'],
        },
        {
          id: 'site-sync-2',
          name: 'New Site 2',
          url: 'https://s2.atlassian.net',
          scopes: ['read:jira-work'],
        },
      ]);
      expect(syncedCount).toBe(2);

      const status = await repo.getConnectionStatus(userId);
      expect(status.sites).toHaveLength(2);
      const s1 = status.sites.find((s) => s.cloudId === 'site-sync-1');
      expect(s1?.name).toBe('Renamed Site 1');
      expect(s1?.url).toBe('https://s1-updated.atlassian.net');
    });

    it('deduplicates identical site entries and rejects conflicting definitions for the same cloudId', async () => {
      const userId = await createSyntheticUser(ctx.pool, 'Dedup User', 'dedup_user', {
        role: 'member',
        status: 'active',
      });
      await repo.saveIdentityGrant(userId, {
        atlassianAccountId: 'atl-dedup',
        accessToken: 'acc-dedup',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'offline_access'],
      });

      // Exact duplicate site entry must be deduplicated cleanly
      const res = await repo.saveSitesGrant(userId, {
        atlassianAccountId: 'atl-dedup',
        accessToken: 'acc-dedup-2',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'read:jira-work', 'offline_access'],
        sites: [
          {
            id: 'site-dup-1',
            name: 'Site One',
            url: 'https://site1.atlassian.net',
            scopes: ['read:jira-work'],
          },
          {
            id: 'site-dup-1',
            name: 'Site One',
            url: 'https://site1.atlassian.net',
            scopes: ['read:jira-work'],
          },
        ],
      });
      expect(res.siteCount).toBe(1);

      // Conflicting definitions for the same cloudId must be rejected
      await expect(
        repo.syncSites(userId, [
          {
            id: 'site-conflict-1',
            name: 'Conflict Alpha',
            url: 'https://alpha.atlassian.net',
            scopes: ['read:jira-work'],
          },
          {
            id: 'site-conflict-1',
            name: 'Conflict Beta',
            url: 'https://beta.atlassian.net',
            scopes: ['read:jira-work', 'write:jira-work'],
          },
        ])
      ).rejects.toThrowError(/SITE_CONFLICT/);
    });

    it('same cloudID conflicts: allows distinct ATI users to have grants referencing the same Jira cloudId without conflict', async () => {
      const userA = await createSyntheticUser(ctx.pool, 'User Alpha', 'usr_alpha', {
        role: 'member',
        status: 'active',
      });
      const userB = await createSyntheticUser(ctx.pool, 'User Beta', 'usr_beta', {
        role: 'member',
        status: 'active',
      });
      const sharedCompanyCloudId = 'cloud-company-shared-site';

      await repo.saveIdentityGrant(userA, {
        atlassianAccountId: 'atl-emp-a',
        accessToken: 'acc-emp-a',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'offline_access'],
      });
      await repo.saveSitesGrant(userA, {
        atlassianAccountId: 'atl-emp-a',
        accessToken: 'acc-emp-a2',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'read:jira-work', 'offline_access'],
        sites: [
          {
            id: sharedCompanyCloudId,
            name: 'Company Site',
            url: 'https://company.atlassian.net',
            scopes: ['read:jira-work'],
          },
        ],
      });

      await repo.saveIdentityGrant(userB, {
        atlassianAccountId: 'atl-emp-b',
        accessToken: 'acc-emp-b',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'offline_access'],
      });
      await repo.saveSitesGrant(userB, {
        atlassianAccountId: 'atl-emp-b',
        accessToken: 'acc-emp-b2',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'read:jira-work', 'offline_access'],
        sites: [
          {
            id: sharedCompanyCloudId,
            name: 'Company Site',
            url: 'https://company.atlassian.net',
            scopes: ['read:jira-work'],
          },
        ],
      });

      const statusA = await repo.getConnectionStatus(userA);
      const statusB = await repo.getConnectionStatus(userB);

      expect(statusA.sites).toHaveLength(1);
      const siteA0 = statusA.sites[0];
      if (!siteA0) throw new Error('Expected statusA site to be defined');
      expect(siteA0.cloudId).toBe(sharedCompanyCloudId);

      expect(statusB.sites).toHaveLength(1);
      const siteB0 = statusB.sites[0];
      if (!siteB0) throw new Error('Expected statusB site to be defined');
      expect(siteB0.cloudId).toBe(sharedCompanyCloudId);
    });

    it('multi-site isolation: ensures sites and grants are strictly isolated between different ATI users', async () => {
      const userA = await createSyntheticUser(ctx.pool, 'User Private A', 'priv_a', {
        role: 'admin',
        status: 'active',
      });
      const userB = await createSyntheticUser(ctx.pool, 'User Private B', 'priv_b', {
        role: 'admin',
        status: 'active',
      });

      await repo.saveIdentityGrant(userA, {
        atlassianAccountId: 'atl-priv-a',
        accessToken: 'acc-pa',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'offline_access'],
      });
      await repo.saveSitesGrant(userA, {
        atlassianAccountId: 'atl-priv-a',
        accessToken: 'acc-pa2',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'read:jira-work', 'offline_access'],
        sites: [
          {
            id: 'site-priv-a',
            name: 'Private A',
            url: 'https://pa.atlassian.net',
            scopes: ['read:jira-work'],
          },
        ],
      });

      await repo.saveIdentityGrant(userB, {
        atlassianAccountId: 'atl-priv-b',
        accessToken: 'acc-pb',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'offline_access'],
      });
      await repo.saveSitesGrant(userB, {
        atlassianAccountId: 'atl-priv-b',
        accessToken: 'acc-pb2',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'read:jira-work', 'offline_access'],
        sites: [
          {
            id: 'site-priv-b',
            name: 'Private B',
            url: 'https://pb.atlassian.net',
            scopes: ['read:jira-work'],
          },
        ],
      });

      const statusA = await repo.getConnectionStatus(userA);
      const statusB = await repo.getConnectionStatus(userB);

      expect(statusA.sites.map((s) => s.cloudId)).toEqual(['site-priv-a']);
      expect(statusB.sites.map((s) => s.cloudId)).toEqual(['site-priv-b']);

      // User B attempts to link User A's private site into User B's workspace -> must fail closed
      const wsB = await workspaceRepo.createWorkspaceWithBootstrapAdmin(userB, {
        name: 'Workspace B Isolation',
        slug: 'ws-b-iso',
        bootstrapAdminUserId: userB,
      });

      await expect(
        workspaceRepo.linkSite(wsB.workspace.id, userB, { cloudId: 'site-priv-a' })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'GRANT_NOT_FOUND',
      });
    });
  });

  describe('Safe Disconnect, Reconnect & Grant Revocation', () => {
    it('disconnects account cleanly: increments identity_version, revokes grant, clears encrypted tokens, and logs audit', async () => {
      const userId = await createSyntheticUser(ctx.pool, 'Disconnect Full User', 'disc_full', {
        role: 'admin',
        status: 'active',
      });
      await workspaceRepo.createWorkspaceWithBootstrapAdmin(userId, {
        name: 'Disconnect Audit WS',
        slug: 'ws-disc-audit',
        bootstrapAdminUserId: userId,
      });
      const initRes = await repo.saveIdentityGrant(userId, {
        atlassianAccountId: 'atl-disc-full',
        accessToken: 'acc-disc-1',
        refreshToken: 'ref-disc-1',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'offline_access'],
      });

      const discRes = await repo.disconnect(userId);
      expect(discRes.disconnected).toBe(true);
      expect(discRes.identityVersion).toBe(2);
      expect(discRes.revokedAt).toBeInstanceOf(Date);

      // Check DB state for jira_accounts
      const acc = await repo.getAccountByUserId(userId);
      expect(acc?.status).toBe('disconnected');
      expect(acc?.identity_version).toBe(2);

      // Check DB state for jira_oauth_grants: status = 'revoked', tokens cleared
      const grantRes = await ctx.pool.query<{
        status: string;
        encrypted_access_token: string | null;
        encrypted_refresh_token: string | null;
      }>(
        `SELECT status, encrypted_access_token, encrypted_refresh_token
         FROM jira_oauth_grants WHERE id = $1`,
        [initRes.grantId]
      );
      expect(grantRes.rowCount).toBe(1);
      const grantRow = grantRes.rows[0];
      if (!grantRow) throw new Error('Expected grantRow to be defined');
      expect(grantRow.status).toBe('revoked');
      expect(grantRow.encrypted_access_token).toBeNull();
      expect(grantRow.encrypted_refresh_token).toBeNull();

      // Check audit record in jira_authorization_audit
      const auditRes = await ctx.pool.query<{
        action: string;
        decision: string;
      }>(
        `SELECT action, decision
         FROM jira_authorization_audit
         WHERE actor_id = $1`,
        [userId]
      );
      expect(auditRes.rowCount).toBeGreaterThanOrEqual(1);
      const discAudit = auditRes.rows.find((r) => r.action === 'disconnect');
      expect(discAudit?.decision).toBe('revoked');

      // Verify getConnectionStatus returns disconnected
      const status = await repo.getConnectionStatus(userId);
      expect(status.connected).toBe(false);
      expect(status.connectionState).toBe('disconnected');

      // Second disconnect call is idempotent
      const secondDisc = await repo.disconnect(userId);
      expect(secondDisc.disconnected).toBe(false);
    });

    it('allows reconnect after disconnect and permits another ATI user to bind the disconnected Atlassian account', async () => {
      const userA = await createSyntheticUser(ctx.pool, 'Transfer User A', 'trans_a', {
        role: 'member',
        status: 'active',
      });
      const userB = await createSyntheticUser(ctx.pool, 'Transfer User B', 'trans_b', {
        role: 'member',
        status: 'active',
      });
      const atlassianId = 'atl-transferable';

      // User A connects first
      await repo.saveIdentityGrant(userA, {
        atlassianAccountId: atlassianId,
        accessToken: 'acc-a',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'offline_access'],
      });

      // User A disconnects
      await repo.disconnect(userA);

      // User B can now bind this Atlassian account because User A is disconnected
      const resB = await repo.saveIdentityGrant(userB, {
        atlassianAccountId: atlassianId,
        accessToken: 'acc-b',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'offline_access'],
      });
      expect(resB.connectionState).toBe('identity_connected');

      const accB = await repo.getAccountByUserId(userB);
      expect(accB?.status).toBe('connected');
      expect(accB?.atlassian_account_id).toBe(atlassianId);
    });
  });

  describe('Existing Jira03 Semantics & Workspace Linking Guard', () => {
    it('preserves existing Jira03 semantics: enforces strict check constraints for account and grant statuses', async () => {
      const userId = await createSyntheticUser(ctx.pool, 'Status Check User', 'status_check', {
        role: 'member',
        status: 'active',
      });

      // jira_accounts status check strictly allows ('connected', 'disconnected')
      await expect(
        ctx.pool.query(
          `INSERT INTO jira_accounts (user_id, atlassian_account_id, status)
           VALUES ($1, 'atl-invalid-status', 'reconnect_required')`,
          [userId]
        )
      ).rejects.toThrowError(/jira_accounts_status_check/);

      // Connect valid account
      const accRes = await ctx.pool.query<{ id: string }>(
        `INSERT INTO jira_accounts (user_id, atlassian_account_id, status)
         VALUES ($1, 'atl-valid-status', 'connected')
         RETURNING id`,
        [userId]
      );
      expect(accRes.rowCount).toBe(1);
      const accRow = accRes.rows[0];
      if (!accRow) throw new Error('Expected accRow to be defined');
      const accountId = accRow.id;

      // jira_oauth_grants status check strictly allows ('active', 'reconnect_required', 'revoked')
      await expect(
        ctx.pool.query(
          `INSERT INTO jira_oauth_grants (account_id, status)
           VALUES ($1, 'connected')`,
          [accountId]
        )
      ).rejects.toThrowError(/jira_oauth_grants_status_check/);

      // Valid grant status 'reconnect_required'
      const grantRes = await ctx.pool.query<{ id: string }>(
        `INSERT INTO jira_oauth_grants (account_id, status)
         VALUES ($1, 'reconnect_required')
         RETURNING id`,
        [accountId]
      );
      expect(grantRes.rowCount).toBe(1);

      // When grant status is reconnect_required, getConnectionStatus returns reconnect_required state
      const status = await repo.getConnectionStatus(userId);
      expect(status.connected).toBe(true);
      expect(status.connectionState).toBe('reconnect_required');
    });

    it('workspace linking guard: active grant with approved admin succeeds; degraded grant or non-admin fails closed', async () => {
      const adminUser = await createSyntheticUser(ctx.pool, 'WS Admin', 'ws_admin', {
        role: 'admin',
        status: 'active',
      });
      const regularMember = await createSyntheticUser(ctx.pool, 'WS Member', 'ws_member', {
        role: 'member',
        status: 'active',
      });
      const outsider = await createSyntheticUser(ctx.pool, 'WS Outsider', 'ws_outsider', {
        role: 'member',
        status: 'active',
      });

      const ws = await workspaceRepo.createWorkspaceWithBootstrapAdmin(adminUser, {
        name: 'Guarded WS',
        slug: 'ws-guarded',
        bootstrapAdminUserId: adminUser,
      });

      // Regular member connects Atlassian identity before joining workspace (JIRA03 requirement)
      await repo.saveIdentityGrant(regularMember, {
        atlassianAccountId: 'atl-ws-member',
        accessToken: 'acc-ws-member',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'offline_access'],
      });

      // Regular member joins generic organization workspace (precondition for Jira workspace invite)
      await ctx.pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status, created_at, updated_at)
         VALUES ($1, $2, 'member', 'active', clock_timestamp(), clock_timestamp())`,
        [ws.workspace.id, regularMember]
      );

      // Add regularMember as active member (not admin)
      const invite = await workspaceRepo.createInvite(ws.workspace.id, adminUser);
      await workspaceRepo.joinWorkspaceWithInvite(regularMember, invite.inviteToken);
      await workspaceRepo.decideMember(ws.workspace.id, adminUser, regularMember, {
        expectedVersion: 1,
        decision: 'approve',
      });

      // Admin connects Jira and authorizes site
      const identityGrant = await repo.saveIdentityGrant(adminUser, {
        atlassianAccountId: 'atl-ws-admin',
        accessToken: 'acc-ws-admin',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'offline_access'],
      });
      const adminGrant = await repo.saveSitesGrant(adminUser, {
        atlassianAccountId: 'atl-ws-admin',
        accessToken: 'acc-ws-admin-2',
        expiresInSeconds: 3600,
        scopes: ['read:me', 'read:jira-work', 'offline_access'],
        sites: [
          {
            id: 'cloud-guarded-site',
            name: 'Guarded Site',
            url: 'https://guarded.atlassian.net',
            scopes: ['read:jira-work'],
          },
        ],
      });
      expect(adminGrant.grantId).not.toBe(identityGrant.grantId);

      // Non-admin member attempts to link site -> rejected with 403 ADMIN_REQUIRED
      await expect(
        workspaceRepo.linkSite(ws.workspace.id, regularMember, { cloudId: 'cloud-guarded-site' })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'ADMIN_REQUIRED',
      });

      // Outsider (not a member) attempts to link site -> rejected with 404 WORKSPACE_NOT_FOUND (fail-closed nondisclosure)
      await expect(
        workspaceRepo.linkSite(ws.workspace.id, outsider, { cloudId: 'cloud-guarded-site' })
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'WORKSPACE_NOT_FOUND',
      });

      // Grant active + approved admin -> linking succeeds!
      const linkResult = await workspaceRepo.linkSite(ws.workspace.id, adminUser, {
        cloudId: 'cloud-guarded-site',
      });
      expect(linkResult.site.cloudId).toBe('cloud-guarded-site');

      // Add a second site to test degraded grant behavior
      await repo.syncSites(adminUser, [
        {
          id: 'cloud-guarded-site',
          name: 'Guarded Site',
          url: 'https://guarded.atlassian.net',
          scopes: ['read:jira-work'],
        },
        {
          id: 'cloud-degraded-site',
          name: 'Degraded Site',
          url: 'https://degraded.atlassian.net',
          scopes: ['read:jira-work'],
        },
      ]);

      // Degrade grant to reconnect_required
      await ctx.pool.query(
        `UPDATE jira_oauth_grants SET status = 'reconnect_required' WHERE id = $1`,
        [adminGrant.grantId]
      );

      // Attempting to link second site with reconnect_required grant must fail closed!
      await expect(
        workspaceRepo.linkSite(ws.workspace.id, adminUser, { cloudId: 'cloud-degraded-site' })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'GRANT_NOT_FOUND',
      });

      // Degrade grant to revoked
      await ctx.pool.query(
        `UPDATE jira_oauth_grants SET status = 'revoked' WHERE id = $1`,
        [adminGrant.grantId]
      );

      // Attempting to link with revoked grant must fail closed!
      await expect(
        workspaceRepo.linkSite(ws.workspace.id, adminUser, { cloudId: 'cloud-degraded-site' })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'GRANT_NOT_FOUND',
      });
    });
  });
});
