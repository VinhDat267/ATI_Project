import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type pg from 'pg';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  connectSyntheticJiraAccount,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';

describe('Jira OAuth Migration 0021 (Real PostgreSQL Schema & Constraints)', () => {
  let ctx: IsolatedTestContext;
  let testUserId: string;
  let testSessionId: string;

  const hex64 = (): string => randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');

  const createSyntheticSession = async (pool: pg.Pool, userId: string): Promise<string> => {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO auth_sessions (user_id, refresh_token_hash, created_at, last_used_at, expires_at)
       VALUES ($1, $2, now(), now(), now() + interval '7 days')
       RETURNING id`,
      [userId, hex64()]
    );
    const row = res.rows[0];
    if (!row) throw new Error('Failed to create synthetic session');
    return row.id;
  };

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 4 });
    await ctx.runAllMigrations();
    testUserId = await createSyntheticUser(ctx.pool, 'Jira Migration User', 'jira_mig');
    testSessionId = await createSyntheticSession(ctx.pool, testUserId);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  describe('OAuth States: Telegram baseline and Jira modes', () => {
    it('preserves 0020 Telegram baseline mode with user, session, and conversation returnTo', async () => {
      const stateHash = hex64();
      const bindingHash = hex64();
      const conversationId = randomUUID();

      const insertRes = await ctx.pool.query<{ id: string; mode: string; return_to: string | null }>(
        `INSERT INTO oauth_states (
          state_hash, browser_binding_hash, code_verifier, nonce,
          mode, user_id, session_id, expires_at, return_to
        ) VALUES ($1, $2, 'verifier_tg', 'nonce_tg', 'connect_telegram', $3, $4, now() + interval '10 minutes', $5)
        RETURNING id, mode, return_to`,
        [stateHash, bindingHash, testUserId, testSessionId, `/c/${conversationId}`]
      );

      expect(insertRes.rowCount).toBe(1);
      const tgRow = insertRes.rows[0];
      if (!tgRow) throw new Error('Expected telegram state row');
      expect(tgRow.mode).toBe('connect_telegram');
      expect(tgRow.return_to).toBe(`/c/${conversationId}`);
    });

    it('allows connect_jira_identity and connect_jira_sites with valid owner, session, and allowed returnTo', async () => {
      const identityStateHash = hex64();
      const identityBindingHash = hex64();
      const conversationId = randomUUID();

      const identityRes = await ctx.pool.query<{ id: string; mode: string; return_to: string | null }>(
        `INSERT INTO oauth_states (
          state_hash, browser_binding_hash, code_verifier, nonce,
          mode, user_id, session_id, expires_at, return_to
        ) VALUES ($1, $2, 'verifier_jira_id', 'nonce_jira_id', 'connect_jira_identity', $3, $4, now() + interval '10 minutes', $5)
        RETURNING id, mode, return_to`,
        [identityStateHash, identityBindingHash, testUserId, testSessionId, `/c/${conversationId}`]
      );
      expect(identityRes.rowCount).toBe(1);
      const idRow = identityRes.rows[0];
      if (!idRow) throw new Error('Expected identity state row');
      expect(idRow.mode).toBe('connect_jira_identity');
      expect(idRow.return_to).toBe(`/c/${conversationId}`);

      const sitesStateHash = hex64();
      const sitesBindingHash = hex64();

      const sitesRes = await ctx.pool.query<{ id: string; mode: string; return_to: string | null }>(
        `INSERT INTO oauth_states (
          state_hash, browser_binding_hash, code_verifier, nonce,
          mode, user_id, session_id, expires_at, return_to
        ) VALUES ($1, $2, 'verifier_jira_sites', 'nonce_jira_sites', 'connect_jira_sites', $3, $4, now() + interval '10 minutes', NULL)
        RETURNING id, mode, return_to`,
        [sitesStateHash, sitesBindingHash, testUserId, testSessionId]
      );
      expect(sitesRes.rowCount).toBe(1);
      const siteRow = sitesRes.rows[0];
      if (!siteRow) throw new Error('Expected sites state row');
      expect(siteRow.mode).toBe('connect_jira_sites');
      expect(siteRow.return_to).toBeNull();
    });

    it('rejects Jira OAuth states missing user_id or session_id via mode_owner_check', async () => {
      await expect(
        ctx.pool.query(
          `INSERT INTO oauth_states (
            state_hash, browser_binding_hash, code_verifier, nonce,
            mode, user_id, session_id, expires_at
          ) VALUES ($1, $2, 'verifier', 'nonce', 'connect_jira_identity', NULL, $3, now() + interval '10 minutes')`,
          [hex64(), hex64(), testSessionId]
        )
      ).rejects.toThrow();

      await expect(
        ctx.pool.query(
          `INSERT INTO oauth_states (
            state_hash, browser_binding_hash, code_verifier, nonce,
            mode, user_id, session_id, expires_at
          ) VALUES ($1, $2, 'verifier', 'nonce', 'connect_jira_sites', $3, NULL, now() + interval '10 minutes')`,
          [hex64(), hex64(), testUserId]
        )
      ).rejects.toThrow();
    });

    it('rejects Jira OAuth states with invalid returnTo format via return_to_check', async () => {
      await expect(
        ctx.pool.query(
          `INSERT INTO oauth_states (
            state_hash, browser_binding_hash, code_verifier, nonce,
            mode, user_id, session_id, expires_at, return_to
          ) VALUES ($1, $2, 'verifier', 'nonce', 'connect_jira_identity', $3, $4, now() + interval '10 minutes', 'https://malicious.test/callback')`,
          [hex64(), hex64(), testUserId, testSessionId]
        )
      ).rejects.toThrow();

      await expect(
        ctx.pool.query(
          `INSERT INTO oauth_states (
            state_hash, browser_binding_hash, code_verifier, nonce,
            mode, user_id, session_id, expires_at, return_to
          ) VALUES ($1, $2, 'verifier', 'nonce', 'connect_jira_sites', $3, $4, now() + interval '10 minutes', '/c/invalid-uuid-format')`,
          [hex64(), hex64(), testUserId, testSessionId]
        )
      ).rejects.toThrow();
    });

    it('includes connect_jira_identity and connect_jira_sites in constraint definitions', async () => {
      const modeRes = await ctx.pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) as def FROM pg_constraint
         WHERE conrelid = 'oauth_states'::regclass AND conname = 'oauth_states_mode_check'`
      );
      expect(modeRes.rowCount).toBe(1);
      const modeDef = modeRes.rows[0]?.def;
      if (!modeDef) throw new Error('Expected oauth_states_mode_check definition');
      expect(modeDef).toContain('connect_jira_identity');
      expect(modeDef).toContain('connect_jira_sites');

      const ownerRes = await ctx.pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) as def FROM pg_constraint
         WHERE conrelid = 'oauth_states'::regclass AND conname = 'oauth_states_mode_owner_check'`
      );
      expect(ownerRes.rowCount).toBe(1);
      const ownerDef = ownerRes.rows[0]?.def;
      if (!ownerDef) throw new Error('Expected oauth_states_mode_owner_check definition');
      expect(ownerDef).toContain('connect_jira_identity');
      expect(ownerDef).toContain('connect_jira_sites');

      const returnRes = await ctx.pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) as def FROM pg_constraint
         WHERE conrelid = 'oauth_states'::regclass AND conname = 'oauth_states_return_to_check'`
      );
      expect(returnRes.rowCount).toBe(1);
      const returnDef = returnRes.rows[0]?.def;
      if (!returnDef) throw new Error('Expected oauth_states_return_to_check definition');
      expect(returnDef).toContain('connect_jira_identity');
      expect(returnDef).toContain('connect_jira_sites');
    });
  });

  describe('Jira OAuth Grants: status, refresh tracking, and index', () => {
    it('persists grant status with default active and tracks refresh attempt lifecycle', async () => {
      const grantUserId = await createSyntheticUser(ctx.pool, 'Grant Lifecycle User', 'grant_life');
      const accountId = await connectSyntheticJiraAccount(ctx.pool, grantUserId, `atlassian-user-${randomUUID()}`);

      const insertRes = await ctx.pool.query<{
        id: string;
        status: string;
        refresh_state: string;
        refresh_attempt_id: string | null;
        refresh_started_at: Date | null;
      }>(
        `INSERT INTO jira_oauth_grants (
          account_id, app_client_id, grant_kind, refresh_state
        ) VALUES ($1, 'atlassian_3lo', '3lo', 'idle')
        RETURNING id, status, refresh_state, refresh_attempt_id, refresh_started_at`,
        [accountId]
      );

      expect(insertRes.rowCount).toBe(1);
      const grant = insertRes.rows[0];
      if (!grant) throw new Error('Expected inserted grant row');
      const grantId = grant.id;
      expect(grant.status).toBe('active');
      expect(grant.refresh_state).toBe('idle');
      expect(grant.refresh_attempt_id).toBeNull();
      expect(grant.refresh_started_at).toBeNull();

      const attemptId = randomUUID();
      const updateRefreshingRes = await ctx.pool.query<{
        refresh_state: string;
        refresh_attempt_id: string;
        refresh_started_at: Date;
      }>(
        `UPDATE jira_oauth_grants
         SET refresh_state = 'refreshing',
             refresh_attempt_id = $1,
             refresh_started_at = clock_timestamp()
         WHERE id = $2
         RETURNING refresh_state, refresh_attempt_id, refresh_started_at`,
        [attemptId, grantId]
      );
      expect(updateRefreshingRes.rowCount).toBe(1);
      const refreshing = updateRefreshingRes.rows[0];
      if (!refreshing) throw new Error('Expected refreshing grant row');
      expect(refreshing.refresh_state).toBe('refreshing');
      expect(refreshing.refresh_attempt_id).toBe(attemptId);
      expect(refreshing.refresh_started_at).toBeDefined();

      const updateFailedRes = await ctx.pool.query<{
        status: string;
        status_reason: string;
        refresh_state: string;
        refresh_attempt_id: string | null;
      }>(
        `UPDATE jira_oauth_grants
         SET status = 'reconnect_required',
             status_reason = 'CRASH_UNKNOWN_ROTATION',
             refresh_state = 'idle',
             refresh_attempt_id = NULL
         WHERE id = $1
         RETURNING status, status_reason, refresh_state, refresh_attempt_id`,
        [grantId]
      );
      expect(updateFailedRes.rowCount).toBe(1);
      const failed = updateFailedRes.rows[0];
      if (!failed) throw new Error('Expected failed grant row');
      expect(failed.status).toBe('reconnect_required');
      expect(failed.status_reason).toBe('CRASH_UNKNOWN_ROTATION');
      expect(failed.refresh_state).toBe('idle');
      expect(failed.refresh_attempt_id).toBeNull();
    });

    it('enforces status and refresh_state check constraints on jira_oauth_grants', async () => {
      const constraintUserId = await createSyntheticUser(ctx.pool, 'Grant Constraint User', 'grant_const');
      const accountId = await connectSyntheticJiraAccount(ctx.pool, constraintUserId, `atlassian-user-${randomUUID()}`);
      const grantRes = await ctx.pool.query<{ id: string }>(
        `INSERT INTO jira_oauth_grants (account_id) VALUES ($1) RETURNING id`,
        [accountId]
      );
      expect(grantRes.rowCount).toBe(1);
      const grant = grantRes.rows[0];
      if (!grant) throw new Error('Expected grant row');
      const grantId = grant.id;

      await expect(
        ctx.pool.query(`UPDATE jira_oauth_grants SET status = 'pending' WHERE id = $1`, [grantId])
      ).rejects.toThrow();

      await expect(
        ctx.pool.query(`UPDATE jira_oauth_grants SET status = 'unknown_status' WHERE id = $1`, [grantId])
      ).rejects.toThrow();

      await expect(
        ctx.pool.query(`UPDATE jira_oauth_grants SET refresh_state = 'in_flight' WHERE id = $1`, [grantId])
      ).rejects.toThrow();

      const validUpdate = await ctx.pool.query<{ status: string; refresh_state: string }>(
        `UPDATE jira_oauth_grants SET status = 'revoked', refresh_state = 'failed' WHERE id = $1 RETURNING status, refresh_state`,
        [grantId]
      );
      expect(validUpdate.rowCount).toBe(1);
      const validRow = validUpdate.rows[0];
      if (!validRow) throw new Error('Expected valid grant row');
      expect(validRow.status).toBe('revoked');
      expect(validRow.refresh_state).toBe('failed');
    });

    it('has index idx_jira_oauth_grants_account on jira_oauth_grants(account_id)', async () => {
      const idxRes = await ctx.pool.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE tablename = 'jira_oauth_grants' AND indexname = 'idx_jira_oauth_grants_account'`
      );
      expect(idxRes.rowCount).toBe(1);
      const idxRow = idxRes.rows[0];
      if (!idxRow) throw new Error('Expected index row');
      expect(idxRow.indexdef).toContain('account_id');
    });
  });

  describe('Jira Grant Sites: scopes array, product_type check, and multi-site isolation', () => {
    it('persists per-site scopes TEXT[] with default empty array and stores different scope sets for two sites', async () => {
      const siteScopesUserId = await createSyntheticUser(ctx.pool, 'Site Scopes User', 'site_scopes');
      const accountId = await connectSyntheticJiraAccount(ctx.pool, siteScopesUserId, `atlassian-user-${randomUUID()}`);
      const grantRes = await ctx.pool.query<{ id: string }>(
        `INSERT INTO jira_oauth_grants (account_id) VALUES ($1) RETURNING id`,
        [accountId]
      );
      expect(grantRes.rowCount).toBe(1);
      const grant = grantRes.rows[0];
      if (!grant) throw new Error('Expected grant row');
      const grantId = grant.id;

      const siteDefaultRes = await ctx.pool.query<{ id: string; scopes: string[] }>(
        `INSERT INTO jira_grant_sites (
          grant_id, cloud_id, site_url, site_name
        ) VALUES ($1, 'cloud-default', 'https://default.atlassian.net', 'Default Site')
        RETURNING id, scopes`,
        [grantId]
      );
      expect(siteDefaultRes.rowCount).toBe(1);
      const siteDefault = siteDefaultRes.rows[0];
      if (!siteDefault) throw new Error('Expected default site row');
      expect(siteDefault.scopes).toEqual([]);

      const site1Scopes = ['read:me', 'read:jira-work'];
      const site1Res = await ctx.pool.query<{ id: string; cloud_id: string; scopes: string[] }>(
        `INSERT INTO jira_grant_sites (
          grant_id, cloud_id, site_url, site_name, scopes
        ) VALUES ($1, 'cloud-alpha-1', 'https://alpha.atlassian.net', 'Alpha Site', $2)
        RETURNING id, cloud_id, scopes`,
        [grantId, site1Scopes]
      );
      expect(site1Res.rowCount).toBe(1);
      const site1 = site1Res.rows[0];
      if (!site1) throw new Error('Expected site1 row');
      expect(site1.scopes).toEqual(site1Scopes);

      const site2Scopes = ['read:me', 'read:jira-work', 'write:jira-work'];
      const site2Res = await ctx.pool.query<{ id: string; cloud_id: string; scopes: string[] }>(
        `INSERT INTO jira_grant_sites (
          grant_id, cloud_id, site_url, site_name, scopes
        ) VALUES ($1, 'cloud-beta-2', 'https://beta.atlassian.net', 'Beta Site', $2)
        RETURNING id, cloud_id, scopes`,
        [grantId, site2Scopes]
      );
      expect(site2Res.rowCount).toBe(1);
      const site2 = site2Res.rows[0];
      if (!site2) throw new Error('Expected site2 row');
      expect(site2.scopes).toEqual(site2Scopes);

      const fetchSitesRes = await ctx.pool.query<{ cloud_id: string; scopes: string[] }>(
        `SELECT cloud_id, scopes FROM jira_grant_sites
         WHERE grant_id = $1 AND cloud_id IN ('cloud-alpha-1', 'cloud-beta-2')
         ORDER BY cloud_id ASC`,
        [grantId]
      );
      expect(fetchSitesRes.rows).toHaveLength(2);
      const fetchedSite1 = fetchSitesRes.rows[0];
      const fetchedSite2 = fetchSitesRes.rows[1];
      if (!fetchedSite1 || !fetchedSite2) throw new Error('Expected two site rows');
      expect(fetchedSite1.cloud_id).toBe('cloud-alpha-1');
      expect(fetchedSite1.scopes).toEqual(site1Scopes);
      expect(fetchedSite2.cloud_id).toBe('cloud-beta-2');
      expect(fetchedSite2.scopes).toEqual(site2Scopes);
    });

    it('enforces nonnull constraint on scopes and product_type check on jira_grant_sites', async () => {
      const siteConstraintUserId = await createSyntheticUser(ctx.pool, 'Site Constraint User', 'site_const');
      const accountId = await connectSyntheticJiraAccount(ctx.pool, siteConstraintUserId, `atlassian-user-${randomUUID()}`);
      const grantRes = await ctx.pool.query<{ id: string }>(
        `INSERT INTO jira_oauth_grants (account_id) VALUES ($1) RETURNING id`,
        [accountId]
      );
      expect(grantRes.rowCount).toBe(1);
      const grant = grantRes.rows[0];
      if (!grant) throw new Error('Expected grant row');
      const grantId = grant.id;

      await expect(
        ctx.pool.query(
          `INSERT INTO jira_grant_sites (
            grant_id, cloud_id, site_url, site_name, scopes
          ) VALUES ($1, 'cloud-null-scope', 'https://null-scope.atlassian.net', 'Null Site', NULL)`,
          [grantId]
        )
      ).rejects.toThrow();

      await expect(
        ctx.pool.query(
          `INSERT INTO jira_grant_sites (
            grant_id, cloud_id, site_url, site_name, product_type
          ) VALUES ($1, 'cloud-confluence', 'https://confluence.atlassian.net', 'Confluence Site', 'confluence')`,
          [grantId]
        )
      ).rejects.toThrow();
    });
  });

  describe('Preserve JIRA-03 Identity Model: jira_accounts status constraint', () => {
    it('strictly confines jira_accounts status to connected and disconnected', async () => {
      const accountStatusUserId = await createSyntheticUser(ctx.pool, 'Account Status User', 'acct_status');
      const accountId = await connectSyntheticJiraAccount(ctx.pool, accountStatusUserId, `atlassian-user-${randomUUID()}`);

      const disconnectRes = await ctx.pool.query<{ status: string }>(
        `UPDATE jira_accounts SET status = 'disconnected' WHERE id = $1 RETURNING status`,
        [accountId]
      );
      expect(disconnectRes.rowCount).toBe(1);
      const disconnectRow = disconnectRes.rows[0];
      if (!disconnectRow) throw new Error('Expected disconnect row');
      expect(disconnectRow.status).toBe('disconnected');

      const reconnectRes = await ctx.pool.query<{ status: string }>(
        `UPDATE jira_accounts SET status = 'connected' WHERE id = $1 RETURNING status`,
        [accountId]
      );
      expect(reconnectRes.rowCount).toBe(1);
      const reconnectRow = reconnectRes.rows[0];
      if (!reconnectRow) throw new Error('Expected reconnect row');
      expect(reconnectRow.status).toBe('connected');

      await expect(
        ctx.pool.query(`UPDATE jira_accounts SET status = 'reconnect_required' WHERE id = $1`, [accountId])
      ).rejects.toThrow();

      await expect(
        ctx.pool.query(`UPDATE jira_accounts SET status = 'revoked' WHERE id = $1`, [accountId])
      ).rejects.toThrow();

      await expect(
        ctx.pool.query(`UPDATE jira_accounts SET status = 'active' WHERE id = $1`, [accountId])
      ).rejects.toThrow();

      const chkRes = await ctx.pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) as def FROM pg_constraint
         WHERE conrelid = 'jira_accounts'::regclass AND conname = 'jira_accounts_status_check'`
      );
      expect(chkRes.rowCount).toBe(1);
      const chk = chkRes.rows[0]?.def;
      if (!chk) throw new Error('Expected jira_accounts_status_check definition');
      expect(chk).toContain("'connected'");
      expect(chk).toContain("'disconnected'");
      expect(chk).not.toContain('reconnect_required');
    });
  });

  describe('Idempotence: migration 0021 rerun with representative rows', () => {
    it('runs migration 0021 twice without error and preserves representative rows', async () => {
      const rerunUserId = await createSyntheticUser(ctx.pool, 'Rerun User', 'jira_rerun');
      const rerunSessionId = await createSyntheticSession(ctx.pool, rerunUserId);
      const rerunAccountId = await connectSyntheticJiraAccount(
        ctx.pool,
        rerunUserId,
        `atlassian-user-rerun-${randomUUID()}`
      );

      const grantRes = await ctx.pool.query<{ id: string }>(
        `INSERT INTO jira_oauth_grants (
          account_id, app_client_id, status, refresh_state, refresh_attempt_id, refresh_started_at
        ) VALUES ($1, 'atlassian_rerun', 'active', 'refreshing', $2, clock_timestamp())
        RETURNING id`,
        [rerunAccountId, randomUUID()]
      );
      expect(grantRes.rowCount).toBe(1);
      const grant = grantRes.rows[0];
      if (!grant) throw new Error('Expected grant row');
      const grantId = grant.id;

      await ctx.pool.query(
        `INSERT INTO jira_grant_sites (
          grant_id, cloud_id, site_url, site_name, scopes
        ) VALUES ($1, 'cloud-rerun', 'https://rerun.atlassian.net', 'Rerun Site', $2)`,
        [grantId, ['read:me', 'read:jira-work']]
      );

      const rerunStateHash = hex64();
      await ctx.pool.query(
        `INSERT INTO oauth_states (
          state_hash, browser_binding_hash, code_verifier, nonce,
          mode, user_id, session_id, expires_at, return_to
        ) VALUES ($1, $2, 'ver_rerun', 'nonce_rerun', 'connect_jira_identity', $3, $4, now() + interval '10 minutes', $5)`,
        [rerunStateHash, hex64(), rerunUserId, rerunSessionId, `/c/${randomUUID()}`]
      );

      const migrationPath = resolve(ctx.migrationDirectory, '0021_jira_oauth_token.sql');
      const migrationSql = await readFile(migrationPath, 'utf8');
      await expect(ctx.pool.query(migrationSql)).resolves.toBeDefined();

      const accountCheck = await ctx.pool.query<{ id: string; status: string }>(
        `SELECT id, status FROM jira_accounts WHERE id = $1`,
        [rerunAccountId]
      );
      expect(accountCheck.rowCount).toBe(1);
      const accountRow = accountCheck.rows[0];
      if (!accountRow) throw new Error('Expected account row');
      expect(accountRow.id).toBe(rerunAccountId);

      const grantCheck = await ctx.pool.query<{ id: string; status: string; refresh_state: string }>(
        `SELECT id, status, refresh_state FROM jira_oauth_grants WHERE id = $1`,
        [grantId]
      );
      expect(grantCheck.rowCount).toBe(1);
      const grantRow = grantCheck.rows[0];
      if (!grantRow) throw new Error('Expected grant row');
      expect(grantRow.status).toBe('active');
      expect(grantRow.refresh_state).toBe('refreshing');

      const siteCheck = await ctx.pool.query<{ id: string; scopes: string[] }>(
        `SELECT id, scopes FROM jira_grant_sites WHERE grant_id = $1 AND cloud_id = 'cloud-rerun'`,
        [grantId]
      );
      expect(siteCheck.rowCount).toBe(1);
      const siteRow = siteCheck.rows[0];
      if (!siteRow) throw new Error('Expected site row');
      expect(siteRow.scopes).toEqual(['read:me', 'read:jira-work']);

      const stateCheck = await ctx.pool.query<{ id: string; mode: string }>(
        `SELECT id, mode FROM oauth_states WHERE state_hash = $1`,
        [rerunStateHash]
      );
      expect(stateCheck.rowCount).toBe(1);
      const stateRow = stateCheck.rows[0];
      if (!stateRow) throw new Error('Expected state row');
      expect(stateRow.mode).toBe('connect_jira_identity');
    });
  });

  describe('Full migration sequence rerun with representative Jira rows in transaction', () => {
    it('executes the full migration sequence a second time within a transaction and preserves rows and final constraints', async () => {
      const fullUserId = await createSyntheticUser(ctx.pool, 'Full Sequence User', 'jira_full_seq');
      const fullSessionId = await createSyntheticSession(ctx.pool, fullUserId);
      const fullAccountId = await connectSyntheticJiraAccount(
        ctx.pool,
        fullUserId,
        `atlassian-user-full-seq-${randomUUID()}`
      );

      const grantAttemptId = randomUUID();
      const fullGrantRes = await ctx.pool.query<{ id: string }>(
        `INSERT INTO jira_oauth_grants (
          account_id, app_client_id, status, status_reason, refresh_state, refresh_attempt_id, refresh_started_at
        ) VALUES ($1, 'atlassian_full_seq', 'active', 'TEST_REPRESENTATIVE', 'refreshing', $2, clock_timestamp())
        RETURNING id`,
        [fullAccountId, grantAttemptId]
      );
      expect(fullGrantRes.rowCount).toBe(1);
      const fullGrant = fullGrantRes.rows[0];
      if (!fullGrant) throw new Error('Expected full sequence grant row');
      const fullGrantId = fullGrant.id;

      await ctx.pool.query(
        `INSERT INTO jira_grant_sites (
          grant_id, cloud_id, site_url, site_name, scopes
        ) VALUES ($1, 'cloud-full-seq-1', 'https://seq-1.atlassian.net', 'Seq Site 1', $2),
                 ($1, 'cloud-full-seq-2', 'https://seq-2.atlassian.net', 'Seq Site 2', $3)`,
        [fullGrantId, ['read:me', 'read:jira-work'], ['read:me', 'read:jira-work', 'write:jira-work']]
      );

      const identityStateHash = hex64();
      const identityReturnTo = `/c/${randomUUID()}`;
      await ctx.pool.query(
        `INSERT INTO oauth_states (
          state_hash, browser_binding_hash, code_verifier, nonce,
          mode, user_id, session_id, expires_at, return_to
        ) VALUES ($1, $2, 'ver_seq_id', 'nonce_seq_id', 'connect_jira_identity', $3, $4, now() + interval '10 minutes', $5)`,
        [identityStateHash, hex64(), fullUserId, fullSessionId, identityReturnTo]
      );

      const sitesStateHash = hex64();
      const sitesReturnTo = `/c/${randomUUID()}`;
      await ctx.pool.query(
        `INSERT INTO oauth_states (
          state_hash, browser_binding_hash, code_verifier, nonce,
          mode, user_id, session_id, expires_at, return_to
        ) VALUES ($1, $2, 'ver_seq_sites', 'nonce_seq_sites', 'connect_jira_sites', $3, $4, now() + interval '10 minutes', $5)`,
        [sitesStateHash, hex64(), fullUserId, fullSessionId, sitesReturnTo]
      );

      // Execute full migration sequence in a single transaction (same ordering and semantics as db/v3/migrate.mjs)
      const client = await ctx.pool.connect();
      try {
        await client.query('BEGIN');
        const dirFiles = await readdir(ctx.migrationDirectory);
        const sqlFiles = dirFiles.filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
        for (const file of sqlFiles) {
          const filePath = resolve(ctx.migrationDirectory, file);
          const sqlContent = await readFile(filePath, 'utf8');
          await client.query(sqlContent);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      // Prove rows are preserved
      const accountCheck = await ctx.pool.query<{ id: string; status: string }>(
        `SELECT id, status FROM jira_accounts WHERE id = $1`,
        [fullAccountId]
      );
      expect(accountCheck.rowCount).toBe(1);
      const accountRow = accountCheck.rows[0];
      if (!accountRow) throw new Error('Expected account row');
      expect(accountRow.status).toBe('connected');

      const grantCheck = await ctx.pool.query<{ id: string; status: string; refresh_state: string; refresh_attempt_id: string }>(
        `SELECT id, status, refresh_state, refresh_attempt_id FROM jira_oauth_grants WHERE id = $1`,
        [fullGrantId]
      );
      expect(grantCheck.rowCount).toBe(1);
      const grantRow = grantCheck.rows[0];
      if (!grantRow) throw new Error('Expected grant row');
      expect(grantRow.status).toBe('active');
      expect(grantRow.refresh_state).toBe('refreshing');
      expect(grantRow.refresh_attempt_id).toBe(grantAttemptId);

      const sitesCheck = await ctx.pool.query<{ cloud_id: string; scopes: string[] }>(
        `SELECT cloud_id, scopes FROM jira_grant_sites WHERE grant_id = $1 ORDER BY cloud_id ASC`,
        [fullGrantId]
      );
      expect(sitesCheck.rows).toHaveLength(2);
      const site1 = sitesCheck.rows[0];
      const site2 = sitesCheck.rows[1];
      if (!site1 || !site2) throw new Error('Expected two sites');
      expect(site1.scopes).toEqual(['read:me', 'read:jira-work']);
      expect(site2.scopes).toEqual(['read:me', 'read:jira-work', 'write:jira-work']);

      const idStateCheck = await ctx.pool.query<{ mode: string; return_to: string | null }>(
        `SELECT mode, return_to FROM oauth_states WHERE state_hash = $1`,
        [identityStateHash]
      );
      expect(idStateCheck.rowCount).toBe(1);
      const idState = idStateCheck.rows[0];
      if (!idState) throw new Error('Expected identity state');
      expect(idState.mode).toBe('connect_jira_identity');
      expect(idState.return_to).toBe(identityReturnTo);

      const sitesStateCheck = await ctx.pool.query<{ mode: string; return_to: string | null }>(
        `SELECT mode, return_to FROM oauth_states WHERE state_hash = $1`,
        [sitesStateHash]
      );
      expect(sitesStateCheck.rowCount).toBe(1);
      const sitesState = sitesStateCheck.rows[0];
      if (!sitesState) throw new Error('Expected sites state');
      expect(sitesState.mode).toBe('connect_jira_sites');
      expect(sitesState.return_to).toBe(sitesReturnTo);

      // Prove final constraints intact
      const modeDefRes = await ctx.pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) as def FROM pg_constraint
         WHERE conrelid = 'oauth_states'::regclass AND conname = 'oauth_states_mode_check'`
      );
      expect(modeDefRes.rowCount).toBe(1);
      const modeDef = modeDefRes.rows[0]?.def;
      if (!modeDef) throw new Error('Expected oauth_states_mode_check definition');
      expect(modeDef).toContain('connect_jira_identity');
      expect(modeDef).toContain('connect_jira_sites');

      const ownerDefRes = await ctx.pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) as def FROM pg_constraint
         WHERE conrelid = 'oauth_states'::regclass AND conname = 'oauth_states_mode_owner_check'`
      );
      expect(ownerDefRes.rowCount).toBe(1);
      const ownerDef = ownerDefRes.rows[0]?.def;
      if (!ownerDef) throw new Error('Expected oauth_states_mode_owner_check definition');
      expect(ownerDef).toContain('connect_jira_identity');
      expect(ownerDef).toContain('connect_jira_sites');

      const returnDefRes = await ctx.pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) as def FROM pg_constraint
         WHERE conrelid = 'oauth_states'::regclass AND conname = 'oauth_states_return_to_check'`
      );
      expect(returnDefRes.rowCount).toBe(1);
      const returnDef = returnDefRes.rows[0]?.def;
      if (!returnDef) throw new Error('Expected oauth_states_return_to_check definition');
      expect(returnDef).toContain('connect_jira_identity');
      expect(returnDef).toContain('connect_jira_sites');

      const acctDefRes = await ctx.pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) as def FROM pg_constraint
         WHERE conrelid = 'jira_accounts'::regclass AND conname = 'jira_accounts_status_check'`
      );
      expect(acctDefRes.rowCount).toBe(1);
      const acctDef = acctDefRes.rows[0]?.def;
      if (!acctDef) throw new Error('Expected jira_accounts_status_check definition');
      expect(acctDef).toContain("'connected'");
      expect(acctDef).toContain("'disconnected'");
    });
  });
});
