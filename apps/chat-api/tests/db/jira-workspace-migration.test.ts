import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  hex,
  validateDatabaseUrl,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';

describe('apps/chat-api — JIRA-03 Workspace Migration & Schema Constraints', () => {
  describe('DATABASE_URL test port and environment validation', () => {
    it('rejects missing or empty DATABASE_URL when environment variable is unset', () => {
      const origDbUrl = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;
      try {
        expect(() => validateDatabaseUrl(undefined)).toThrow(/required/i);
        expect(() => validateDatabaseUrl('')).toThrow(/required/i);
        expect(() => validateDatabaseUrl('   ')).toThrow(/required/i);
      } finally {
        if (origDbUrl !== undefined) {
          process.env.DATABASE_URL = origDbUrl;
        }
      }
    });

    it('falls back to process.env.DATABASE_URL when argument is undefined and env is set', () => {
      if (process.env.DATABASE_URL) {
        expect(validateDatabaseUrl(undefined)).toBe(process.env.DATABASE_URL);
      }
    });

    it('does not leak connection string credentials or userinfo in invalid URL error messages', () => {
      const secretPassword = 'super-secret-password-xyz';
      const badUrl = `http://myuser:${secretPassword}@invalid-url-with-bad-port:notaport`;
      try {
        validateDatabaseUrl(badUrl);
        expect.unreachable('Should have thrown an error for invalid URL');
      } catch (err: any) {
        expect(err.message).not.toContain(secretPassword);
        expect(err.message).not.toContain('myuser');
      }
    });

    it('strictly forbids runtime port 55533', () => {
      expect(() =>
        validateDatabaseUrl('postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3')
      ).toThrow(/55533/i);
    });

    it('rejects non-loopback hosts', () => {
      expect(() =>
        validateDatabaseUrl('postgresql://ati_v3:ati_v3_local_only@remote-host:56534/ati_v3')
      ).toThrow(/loopback/i);
    });

    it('requires dedicated localhost:56534 for local tests when CI is false', () => {
      const origCi = process.env.CI;
      delete process.env.CI;
      try {
        expect(() =>
          validateDatabaseUrl('postgresql://ati_v3:ati_v3_local_only@127.0.0.1:5432/ati_v3')
        ).toThrow(/56534/i);

        expect(
          validateDatabaseUrl('postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56534/ati_v3')
        ).toBe('postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56534/ati_v3');
      } finally {
        if (origCi !== undefined) process.env.CI = origCi;
      }
    });

    it('allows loopback:5432 with database ati_v3 when CI=true', () => {
      const origCi = process.env.CI;
      process.env.CI = 'true';
      try {
        expect(
          validateDatabaseUrl('postgresql://ati_v3:ati_v3_local_only@127.0.0.1:5432/ati_v3')
        ).toBe('postgresql://ati_v3:ati_v3_local_only@127.0.0.1:5432/ati_v3');
      } finally {
        if (origCi !== undefined) {
          process.env.CI = origCi;
        } else {
          delete process.env.CI;
        }
      }
    });
  });

  describe('PostgreSQL Isolated Schema Migration & Constraints Verification', () => {
    let ctx: IsolatedTestContext;
    let pool: pg.Pool;
    let user1Id: string;
    let user2Id: string;
    let user3Id: string;

    beforeAll(async () => {
      ctx = await createIsolatedTestSchema({ maxConnections: 10 });
      pool = ctx.pool;

      // Run existing migrations (0001–0014, and 0015 once added)
      await ctx.runAllMigrations();

      // Seed synthetic users for foreign key references
      user1Id = await createSyntheticUser(pool, 'User Alpha', 'alpha');
      user2Id = await createSyntheticUser(pool, 'User Beta', 'beta');
      user3Id = await createSyntheticUser(pool, 'User Gamma', 'gamma');
    });

    afterAll(async () => {
      await ctx?.cleanup();
    });

    async function seedTestOrg(name = 'Test Org'): Promise<string> {
      const wsId = randomUUID();
      const inviteCode = `ATI-${randomUUID().slice(0, 4).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
      await pool.query(
        `INSERT INTO workspaces (id, name, invite_code, created_by)
         VALUES ($1, $2, $3, $4)`,
        [wsId, name, inviteCode, user1Id]
      );
      return wsId;
    }

    it('verifies strict private schema isolation without public in search_path', async () => {
      const schemaRes = await pool.query('SELECT current_schema() AS cur_schema');
      expect(schemaRes.rows[0].cur_schema).toBe(ctx.schema);

      const searchPathRes = await pool.query('SHOW search_path');
      expect(searchPathRes.rows[0].search_path).toBe(ctx.schema);
    });

    it('executes the full migration set twice without error (idempotence)', async () => {
      await ctx.runAllMigrations();
      await ctx.runAllMigrations();
    });

    it('defines all 9 expected new tables in the isolated schema', async () => {
      const res = await pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
        [ctx.schema]
      );
      const tableNames = res.rows.map((r: { table_name: string }) => r.table_name);
      const expected = [
        'ati_workspaces',
        'ati_workspace_memberships',
        'ati_workspace_invites',
        'jira_accounts',
        'jira_oauth_grants',
        'jira_grant_sites',
        'ati_workspace_jira_sites',
        'ati_workspace_jira_projects',
        'jira_authorization_audit',
      ];

      for (const table of expected) {
        expect(tableNames, `Table ${table} must exist in schema ${ctx.schema}`).toContain(table);
      }
    });

    it('enforces positive integer version constraints (version > 0)', async () => {
      const wsSlug = `ws-ver-${randomUUID().slice(0, 8)}`;
      const parentId1 = await seedTestOrg('Workspace Zero');

      // 1. ati_workspaces.version > 0
      await expect(
        pool.query(
          `INSERT INTO ati_workspaces (id, slug, version, created_by)
           VALUES ($1, $2, 0, $3)`,
          [parentId1, wsSlug, user1Id]
        )
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        pool.query(
          `INSERT INTO ati_workspaces (id, slug, version, created_by)
           VALUES ($1, $2, -1, $3)`,
          [parentId1, wsSlug, user1Id]
        )
      ).rejects.toMatchObject({ code: '23514' });

      const wsOk = await pool.query(
        `INSERT INTO ati_workspaces (id, slug, version, created_by)
         VALUES ($1, $2, 1, $3) RETURNING id`,
        [parentId1, wsSlug, user1Id]
      );
      const wsId = wsOk.rows[0].id;

      // 2. ati_workspace_memberships.version > 0
      await expect(
        pool.query(
          `INSERT INTO ati_workspace_memberships (workspace_id, user_id, version)
           VALUES ($1, $2, 0)`,
          [wsId, user2Id]
        )
      ).rejects.toMatchObject({ code: '23514' });

      // 3. jira_accounts.identity_version > 0
      await expect(
        pool.query(
          `INSERT INTO jira_accounts (user_id, atlassian_account_id, identity_version)
           VALUES ($1, 'atlas-ver-0', 0)`,
          [user1Id]
        )
      ).rejects.toMatchObject({ code: '23514' });

      // 4. jira_oauth_grants.token_version > 0
      const accOk = await pool.query(
        `INSERT INTO jira_accounts (user_id, atlassian_account_id, status)
         VALUES ($1, $2, 'disconnected') RETURNING id`,
        [user1Id, `atlas-grant-ver-${randomUUID().slice(0, 8)}`]
      );
      const accId = accOk.rows[0].id;

      await expect(
        pool.query(
          `INSERT INTO jira_oauth_grants (account_id, token_version)
           VALUES ($1, 0)`,
          [accId]
        )
      ).rejects.toMatchObject({ code: '23514' });

      // 5. ati_workspace_jira_sites.policy_version > 0
      await expect(
        pool.query(
          `INSERT INTO ati_workspace_jira_sites (workspace_id, cloud_id, site_name, site_url, linked_by, policy_version)
           VALUES ($1, 'cloud-ver-0', 'Site', 'https://site.atlassian.net', $2, 0)`,
          [wsId, user1Id]
        )
      ).rejects.toMatchObject({ code: '23514' });

      const siteOk = await pool.query(
        `INSERT INTO ati_workspace_jira_sites (workspace_id, cloud_id, site_name, site_url, linked_by, policy_version)
         VALUES ($1, 'cloud-ver-ok', 'Site', 'https://site.atlassian.net', $2, 1) RETURNING id`,
        [wsId, user1Id]
      );
      const siteId = siteOk.rows[0].id;

      // 6. ati_workspace_jira_projects.policy_version > 0
      await expect(
        pool.query(
          `INSERT INTO ati_workspace_jira_projects (workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name, policy_version)
           VALUES ($1, $2, 'cloud-ver-ok', '10001', 'PROJ', 'Project', 0)`,
          [wsId, siteId]
        )
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('enforces enumeration and status check constraints', async () => {
      const wsSlug = `ws-enum-${randomUUID().slice(0, 8)}`;
      const parentId2 = await seedTestOrg('WS Enum Bad');

      // 1. ati_workspaces.status in ('active', 'archived')
      await expect(
        pool.query(
          `INSERT INTO ati_workspaces (id, slug, status, created_by)
           VALUES ($1, $2, 'disabled', $3)`,
          [parentId2, wsSlug, user1Id]
        )
      ).rejects.toMatchObject({ code: '23514' });

      const wsOk = await pool.query(
        `INSERT INTO ati_workspaces (id, slug, status, created_by)
         VALUES ($1, $2, 'active', $3) RETURNING id`,
        [parentId2, wsSlug, user1Id]
      );
      const wsId = wsOk.rows[0].id;

      // 2. ati_workspace_memberships.role in ('admin', 'member')
      await expect(
        pool.query(
          `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status)
           VALUES ($1, $2, 'owner', 'active')`,
          [wsId, user2Id]
        )
      ).rejects.toMatchObject({ code: '23514' });

      // 3. ati_workspace_memberships.status in ('pending', 'active', 'rejected', 'removed')
      await expect(
        pool.query(
          `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status)
           VALUES ($1, $2, 'member', 'banned')`,
          [wsId, user2Id]
        )
      ).rejects.toMatchObject({ code: '23514' });

      // 4. jira_accounts.status in ('connected', 'disconnected')
      await expect(
        pool.query(
          `INSERT INTO jira_accounts (user_id, atlassian_account_id, status)
           VALUES ($1, 'atlas-status-bad', 'revoked')`,
          [user1Id]
        )
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('enforces canonical numeric_project_id regex constraint (^[1-9][0-9]*$)', async () => {
      const parentId3 = await seedTestOrg('WS Project ID');
      const wsRes = await pool.query(
        `INSERT INTO ati_workspaces (id, slug, created_by)
         VALUES ($1, $2, $3) RETURNING id`,
        [parentId3, `ws-pid-${randomUUID().slice(0, 8)}`, user1Id]
      );
      const wsId = wsRes.rows[0].id;

      const siteRes = await pool.query(
        `INSERT INTO ati_workspace_jira_sites (workspace_id, cloud_id, site_name, site_url, linked_by)
         VALUES ($1, 'cloud-pid', 'Site PID', 'https://pid.atlassian.net', $2) RETURNING id`,
        [wsId, user1Id]
      );
      const siteId = siteRes.rows[0].id;

      const invalidProjectIds = ['0', '012', '-1', 'abc', '10001a', '', '  '];
      for (const badId of invalidProjectIds) {
        await expect(
          pool.query(
            `INSERT INTO ati_workspace_jira_projects (workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name)
             VALUES ($1, $2, 'cloud-pid', $3, 'PROJ', 'Project')`,
            [wsId, siteId, badId]
          ),
          `Rejects invalid numeric_project_id "${badId}"`
        ).rejects.toMatchObject({ code: '23514' });
      }

      // Valid canonical numeric project IDs
      for (const validId of ['1', '10001', '9876543210']) {
        const ok = await pool.query(
          `INSERT INTO ati_workspace_jira_projects (workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name)
           VALUES ($1, $2, 'cloud-pid', $3, $4, 'Project') RETURNING id`,
          [wsId, siteId, validId, `P${validId.slice(0, 4)}`]
        );
        expect(ok.rows[0].id).toBeTruthy();
      }
    });

    it('enforces dual active uniqueness on jira_accounts (active user and active Atlassian account indexes)', async () => {
      const sharedAtlassianId = `atlassian-shared-${randomUUID().slice(0, 8)}`;

      // User 1 connects shared Atlassian account as 'connected'
      const acc1 = await pool.query(
        `INSERT INTO jira_accounts (user_id, atlassian_account_id, status)
         VALUES ($1, $2, 'connected') RETURNING id`,
        [user1Id, sharedAtlassianId]
      );
      expect(acc1.rows[0].id).toBeTruthy();

      // User 2 tries to connect the same atlassian_account_id while User 1 is connected -> FAILS (code 23505)
      await expect(
        pool.query(
          `INSERT INTO jira_accounts (user_id, atlassian_account_id, status)
           VALUES ($1, $2, 'connected')`,
          [user2Id, sharedAtlassianId]
        )
      ).rejects.toMatchObject({ code: '23505' });

      // User 1 tries to connect a SECOND account as 'connected' -> FAILS (code 23505)
      await expect(
        pool.query(
          `INSERT INTO jira_accounts (user_id, atlassian_account_id, status)
           VALUES ($1, $2, 'connected')`,
          [user1Id, `atlassian-second-${randomUUID().slice(0, 8)}`]
        )
      ).rejects.toMatchObject({ code: '23505' });

      // User 1 disconnects their account
      await pool.query(
        `UPDATE jira_accounts SET status = 'disconnected' WHERE id = $1`,
        [acc1.rows[0].id]
      );

      // Now User 2 can connect the shared atlassian_account_id as 'connected' -> SUCCEEDS
      const acc2 = await pool.query(
        `INSERT INTO jira_accounts (user_id, atlassian_account_id, status)
         VALUES ($1, $2, 'connected') RETURNING id`,
        [user2Id, sharedAtlassianId]
      );
      expect(acc2.rows[0].id).toBeTruthy();

      // User 1 cannot re-insert identical (user_id, atlassian_account_id) even when disconnected (pair uniqueness)
      await expect(
        pool.query(
          `INSERT INTO jira_accounts (user_id, atlassian_account_id, status)
           VALUES ($1, $2, 'disconnected')`,
          [user1Id, sharedAtlassianId]
        )
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('enforces grant/site uniqueness, site/cloud uniqueness, and project uniqueness', async () => {
      // 1. jira_grant_sites: UNIQUE (grant_id, cloud_id)
      const acc = await pool.query(
        `INSERT INTO jira_accounts (user_id, atlassian_account_id, status)
         VALUES ($1, $2, 'disconnected') RETURNING id`,
        [user3Id, `atlas-grant-uniq-${randomUUID().slice(0, 8)}`]
      );
      const grant = await pool.query(
        `INSERT INTO jira_oauth_grants (account_id) VALUES ($1) RETURNING id`,
        [acc.rows[0].id]
      );
      const grantId = grant.rows[0].id;

      await pool.query(
        `INSERT INTO jira_grant_sites (grant_id, cloud_id, site_url, site_name)
         VALUES ($1, 'cloud-uq-1', 'https://site1.atlassian.net', 'Site 1')`,
        [grantId]
      );

      await expect(
        pool.query(
          `INSERT INTO jira_grant_sites (grant_id, cloud_id, site_url, site_name)
           VALUES ($1, 'cloud-uq-1', 'https://site1-dup.atlassian.net', 'Site 1 Dup')`,
          [grantId]
        )
      ).rejects.toMatchObject({ code: '23505' });

      // 2. ati_workspace_jira_sites: UNIQUE (workspace_id, cloud_id)
      const parentId4 = await seedTestOrg('WS Site UQ');
      const ws = await pool.query(
        `INSERT INTO ati_workspaces (id, slug, created_by)
         VALUES ($1, $2, $3) RETURNING id`,
        [parentId4, `ws-site-uq-${randomUUID().slice(0, 8)}`, user1Id]
      );
      const wsId = ws.rows[0].id;

      await pool.query(
        `INSERT INTO ati_workspace_jira_sites (workspace_id, cloud_id, site_name, site_url, linked_by)
         VALUES ($1, 'cloud-site-uq', 'Site Alpha', 'https://alpha.atlassian.net', $2)`,
        [wsId, user1Id]
      );

      await expect(
        pool.query(
          `INSERT INTO ati_workspace_jira_sites (workspace_id, cloud_id, site_name, site_url, linked_by)
           VALUES ($1, 'cloud-site-uq', 'Site Beta', 'https://beta.atlassian.net', $2)`,
          [wsId, user1Id]
        )
      ).rejects.toMatchObject({ code: '23505' });

      // 3. ati_workspace_jira_projects: UNIQUE (workspace_id, cloud_id, numeric_project_id)
      const site = (
        await pool.query(
          `SELECT id FROM ati_workspace_jira_sites WHERE workspace_id = $1`,
          [wsId]
        )
      ).rows[0];

      await pool.query(
        `INSERT INTO ati_workspace_jira_projects (workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name)
         VALUES ($1, $2, 'cloud-site-uq', '10501', 'UQ', 'Project UQ')`,
        [wsId, site.id]
      );

      await expect(
        pool.query(
          `INSERT INTO ati_workspace_jira_projects (workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name)
           VALUES ($1, $2, 'cloud-site-uq', '10501', 'UQ2', 'Project UQ 2')`,
          [wsId, site.id]
        )
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('enforces composite foreign key fk_workspace_site_cloud (cross-workspace and cross-cloud rejection)', async () => {
      const parentComp1 = await seedTestOrg('WS Composite 1');
      const ws1 = await pool.query(
        `INSERT INTO ati_workspaces (id, slug, created_by)
         VALUES ($1, $2, $3) RETURNING id`,
        [parentComp1, `ws-comp-1-${randomUUID().slice(0, 8)}`, user1Id]
      );
      const ws1Id = ws1.rows[0].id;

      const parentComp2 = await seedTestOrg('WS Composite 2');
      const ws2 = await pool.query(
        `INSERT INTO ati_workspaces (id, slug, created_by)
         VALUES ($1, $2, $3) RETURNING id`,
        [parentComp2, `ws-comp-2-${randomUUID().slice(0, 8)}`, user1Id]
      );
      const ws2Id = ws2.rows[0].id;

      const site1 = await pool.query(
        `INSERT INTO ati_workspace_jira_sites (workspace_id, cloud_id, site_name, site_url, linked_by, policy_version)
         VALUES ($1, 'cloud-alpha', 'Site 1', 'https://site1.atlassian.net', $2, 1) RETURNING id`,
        [ws1Id, user1Id]
      );
      const site1Id = site1.rows[0].id;

      const site2 = await pool.query(
        `INSERT INTO ati_workspace_jira_sites (workspace_id, cloud_id, site_name, site_url, linked_by, policy_version)
         VALUES ($1, 'cloud-beta', 'Site 2', 'https://site2.atlassian.net', $2, 1) RETURNING id`,
        [ws2Id, user1Id]
      );
      const site2Id = site2.rows[0].id;

      // Cross-cloud mismatch: project in ws1, site1, but cloud_id of site2 -> REJECTED (23503)
      await expect(
        pool.query(
          `INSERT INTO ati_workspace_jira_projects (workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name)
           VALUES ($1, $2, 'cloud-beta', '10601', 'COMP', 'Composite')`,
          [ws1Id, site1Id]
        )
      ).rejects.toMatchObject({ code: '23503' });

      // Cross-workspace mismatch: project in ws2, site1, cloud_id of site1 -> REJECTED (23503)
      await expect(
        pool.query(
          `INSERT INTO ati_workspace_jira_projects (workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name)
           VALUES ($1, $2, 'cloud-alpha', '10601', 'COMP', 'Composite')`,
          [ws2Id, site1Id]
        )
      ).rejects.toMatchObject({ code: '23503' });

      // Matching (ws1, site1, cloud-alpha) -> SUCCEEDS
      const projOk = await pool.query(
        `INSERT INTO ati_workspace_jira_projects (workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name, policy_version)
         VALUES ($1, $2, 'cloud-alpha', '10601', 'COMP', 'Composite', 1) RETURNING id`,
        [ws1Id, site1Id]
      );
      expect(projOk.rows[0].id).toBeTruthy();

      // Independent policy_version: project policy_version updates without affecting site policy_version
      await pool.query(
        `UPDATE ati_workspace_jira_projects SET policy_version = 2 WHERE id = $1`,
        [projOk.rows[0].id]
      );
      const projCheck = await pool.query(
        `SELECT policy_version FROM ati_workspace_jira_projects WHERE id = $1`,
        [projOk.rows[0].id]
      );
      const siteCheck = await pool.query(
        `SELECT policy_version FROM ati_workspace_jira_sites WHERE id = $1`,
        [site1Id]
      );
      expect(projCheck.rows[0].policy_version).toBe(2);
      expect(siteCheck.rows[0].policy_version).toBe(1);
    });

    it('enforces foreign key cascading deletes and set null behaviors', async () => {
      const parentCasc = await seedTestOrg('WS Cascade');
      const ws = await pool.query(
        `INSERT INTO ati_workspaces (id, slug, created_by)
         VALUES ($1, $2, $3) RETURNING id`,
        [parentCasc, `ws-cascade-${randomUUID().slice(0, 8)}`, user1Id]
      );
      const wsId = ws.rows[0].id;

      await pool.query(
        `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status)
         VALUES ($1, $2, 'member', 'active')`,
        [wsId, user2Id]
      );

      await pool.query(
        `INSERT INTO ati_workspace_invites (workspace_id, token_hash, inviter_user_id, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 day')`,
        [wsId, hex(64), user1Id]
      );

      const site = await pool.query(
        `INSERT INTO ati_workspace_jira_sites (workspace_id, cloud_id, site_name, site_url, linked_by)
         VALUES ($1, 'cloud-cascade', 'Site', 'https://site.atlassian.net', $2) RETURNING id`,
        [wsId, user1Id]
      );
      const siteId = site.rows[0].id;

      await pool.query(
        `INSERT INTO ati_workspace_jira_projects (workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name)
         VALUES ($1, $2, 'cloud-cascade', '10701', 'CAS', 'Cascade Project')`,
        [wsId, siteId]
      );

      const audit = await pool.query(
        `INSERT INTO jira_authorization_audit (actor_id, workspace_id, site_id, action, decision, version)
         VALUES ($1, $2, $3, 'test_action', 'allow', 1) RETURNING id`,
        [user1Id, wsId, siteId]
      );
      const auditId = audit.rows[0].id;

      // When site is deleted directly: audit.site_id is SET NULL
      await pool.query(`DELETE FROM ati_workspace_jira_sites WHERE id = $1`, [siteId]);
      const auditAfterSiteDel = await pool.query(
        `SELECT site_id FROM jira_authorization_audit WHERE id = $1`,
        [auditId]
      );
      expect(auditAfterSiteDel.rows[0].site_id).toBeNull();

      // When workspace is deleted: memberships, invites, and audit cascade
      await pool.query(`DELETE FROM ati_workspaces WHERE id = $1`, [wsId]);
      expect(
        (await pool.query(`SELECT count(*) FROM ati_workspace_memberships WHERE workspace_id = $1`, [wsId]))
          .rows[0].count
      ).toBe('0');
      expect(
        (await pool.query(`SELECT count(*) FROM ati_workspace_invites WHERE workspace_id = $1`, [wsId]))
          .rows[0].count
      ).toBe('0');
      expect(
        (await pool.query(`SELECT count(*) FROM jira_authorization_audit WHERE workspace_id = $1`, [wsId]))
          .rows[0].count
      ).toBe('0');
    });

    it('enforces immutable conversations.workspace_id via trigger (NULL->W, W->NULL, W1->W2 rejected; title updates allowed)', async () => {
      const parentConv1 = await seedTestOrg('WS Conv 1');
      const ws1 = await pool.query(
        `INSERT INTO ati_workspaces (id, slug, created_by)
         VALUES ($1, $2, $3) RETURNING id`,
        [parentConv1, `ws-conv-1-${randomUUID().slice(0, 8)}`, user1Id]
      );
      const ws1Id = ws1.rows[0].id;

      const parentConv2 = await seedTestOrg('WS Conv 2');
      const ws2 = await pool.query(
        `INSERT INTO ati_workspaces (id, slug, created_by)
         VALUES ($1, $2, $3) RETURNING id`,
        [parentConv2, `ws-conv-2-${randomUUID().slice(0, 8)}`, user1Id]
      );
      const ws2Id = ws2.rows[0].id;

      // 1. Scoped conversation with workspace_id = ws1Id
      const convScoped = await pool.query(
        `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode)
         VALUES ($1, 'chatting', 'Scoped Conv', $2, 'organization') RETURNING id, workspace_id`,
        [user1Id, ws1Id]
      );
      const scopedId = convScoped.rows[0].id;
      expect(convScoped.rows[0].workspace_id).toBe(ws1Id);

      // Attempt W1 -> W2: REJECTED by trigger (check_violation code 23514)
      await expect(
        pool.query(`UPDATE conversations SET workspace_id = $1 WHERE id = $2`, [ws2Id, scopedId])
      ).rejects.toMatchObject({ code: '23514' });

      // Attempt W1 -> NULL: REJECTED by trigger (check_violation code 23514)
      await expect(
        pool.query(`UPDATE conversations SET workspace_id = NULL WHERE id = $1`, [scopedId])
      ).rejects.toMatchObject({ code: '23514' });

      // Normal update keeping workspace_id unchanged: SUCCEEDS
      await pool.query(
        `UPDATE conversations SET title = 'Renamed Scoped Conv' WHERE id = $1`,
        [scopedId]
      );
      const scopedUpdated = await pool.query(
        `SELECT title, workspace_id FROM conversations WHERE id = $1`,
        [scopedId]
      );
      expect(scopedUpdated.rows[0].title).toBe('Renamed Scoped Conv');
      expect(scopedUpdated.rows[0].workspace_id).toBe(ws1Id);

      // 2. Legacy conversation with workspace_id = NULL
      const convLegacy = await pool.query(
        `INSERT INTO conversations (user_id, status, title, workspace_id)
         VALUES ($1, 'chatting', 'Legacy Conv', NULL) RETURNING id, workspace_id`,
        [user1Id]
      );
      const legacyId = convLegacy.rows[0].id;
      expect(convLegacy.rows[0].workspace_id).toBeNull();

      // Attempt NULL -> W1: REJECTED by trigger (check_violation code 23514)
      await expect(
        pool.query(`UPDATE conversations SET workspace_id = $1 WHERE id = $2`, [ws1Id, legacyId])
      ).rejects.toMatchObject({ code: '23514' });

      // Normal legacy conversation update: SUCCEEDS
      await pool.query(
        `UPDATE conversations SET title = 'New Legacy Title' WHERE id = $1`,
        [legacyId]
      );
      const legacyUpdated = await pool.query(
        `SELECT title, workspace_id FROM conversations WHERE id = $1`,
        [legacyId]
      );
      expect(legacyUpdated.rows[0].title).toBe('New Legacy Title');
      expect(legacyUpdated.rows[0].workspace_id).toBeNull();
    });

    it('enforces ON DELETE CASCADE from workspaces to conversations while deleting Jira policy leaves conversations intact', async () => {
      const parentRest = await seedTestOrg('WS Cascade Conv');
      const ws = await pool.query(
        `INSERT INTO ati_workspaces (id, slug, created_by)
         VALUES ($1, $2, $3) RETURNING id`,
        [parentRest, `ws-casc-conv-${randomUUID().slice(0, 8)}`, user1Id]
      );
      const wsId = ws.rows[0].id;

      const conv = await pool.query(
        `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode)
         VALUES ($1, 'chatting', 'Bound Conversation', $2, 'organization') RETURNING id`,
        [user1Id, wsId]
      );
      const convId = conv.rows[0].id;

      // 1. Deleting Jira policy (ati_workspaces) does NOT delete the conversation
      await pool.query(`DELETE FROM ati_workspaces WHERE id = $1`, [wsId]);
      const convAfterPolicyDel = await pool.query(
        `SELECT id FROM conversations WHERE id = $1`,
        [convId]
      );
      expect(convAfterPolicyDel.rows).toHaveLength(1);

      // 2. Deleting generic workspace (workspaces) cascades to conversations (PR #237)
      const delWsRes = await pool.query(`DELETE FROM workspaces WHERE id = $1`, [wsId]);
      expect(delWsRes.rowCount).toBe(1);

      const convAfterWsDel = await pool.query(
        `SELECT id FROM conversations WHERE id = $1`,
        [convId]
      );
      expect(convAfterWsDel.rows).toHaveLength(0);
    });
  });
});
