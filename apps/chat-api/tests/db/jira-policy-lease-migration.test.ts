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

interface TestFixtureContext {
  userId: string;
  workspaceId: string;
  accountId: string;
  atlassianAccountId: string;
  grantId: string;
  cloudId: string;
}

interface LeaseRow {
  id: string;
  lease_id: string;
  workspace_id: string;
  cloud_id: string;
  ati_user_id: string;
  jira_account_id: string;
  atlassian_account_id: string;
  grant_id: string;
  membership_version: number;
  identity_version: number;
  workspace_version: number;
  site_policy_version: number;
  project_id: string | null;
  project_policy_version: number | null;
  ttl_ms: number;
  acquired_at: Date;
  expires_at: Date;
  released_at: Date | null;
  status: string;
  created_at: Date;
}

interface InsertLeaseParams {
  leaseId?: string;
  workspaceId?: string;
  cloudId?: string;
  userId?: string;
  accountId?: string;
  atlassianAccountId?: string;
  grantId?: string;
  membershipVersion?: number;
  identityVersion?: number;
  workspaceVersion?: number;
  sitePolicyVersion?: number;
  projectId?: string | null;
  projectPolicyVersion?: number | null;
  ttlMs?: number;
  acquiredAt?: Date | string;
  expiresAt?: Date | string;
  status?: string;
}

describe('Jira Authorization Leases Migration 0022 (Real PostgreSQL Schema & Constraints)', () => {
  let ctx: IsolatedTestContext;
  let appliedFiles: string[] = [];
  let defaultFixture: TestFixtureContext;

  const setupLeasePrerequisites = async (
    pool: pg.Pool,
    prefix = 'lease_test'
  ): Promise<TestFixtureContext> => {
    const userId = await createSyntheticUser(pool, `User ${prefix}`, prefix);
    const atlassianAccountId = `atlassian-${randomUUID()}`;
    const accountId = await connectSyntheticJiraAccount(pool, userId, atlassianAccountId);

    const grantRes = await pool.query<{ id: string }>(
      `INSERT INTO jira_oauth_grants (
        account_id, app_client_id, grant_kind, refresh_state, status
      ) VALUES ($1, 'atlassian_3lo', '3lo', 'idle', 'active')
      RETURNING id`,
      [accountId]
    );
    const grantId = grantRes.rows[0]?.id;
    if (!grantId) throw new Error('Failed to create synthetic grant');

    const workspaceId = randomUUID();
    const inviteCode = `ATI-${randomUUID().slice(0, 4)}-${randomUUID().slice(0, 4)}`.toUpperCase();
    const slug = `ws-${randomUUID().slice(0, 8)}`;

    await pool.query(
      `INSERT INTO workspaces (id, name, invite_code, require_approval, created_by)
       VALUES ($1, $2, $3, true, $4)`,
      [workspaceId, `Workspace ${prefix}`, inviteCode, userId]
    );

    await pool.query(
      `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
       VALUES ($1, $2, 'active', 1, $3)`,
      [workspaceId, slug, userId]
    );

    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status)
       VALUES ($1, $2, 'admin', 'active')`,
      [workspaceId, userId]
    );

    await pool.query(
      `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
       VALUES ($1, $2, 'admin', 'active', 1)`,
      [workspaceId, userId]
    );

    const cloudId = `cloud-${randomUUID().slice(0, 8)}`;

    return {
      userId,
      workspaceId,
      accountId,
      atlassianAccountId,
      grantId,
      cloudId,
    };
  };

  const insertLease = async (
    pool: pg.Pool,
    fixture: TestFixtureContext,
    overrides: InsertLeaseParams = {}
  ): Promise<LeaseRow> => {
    const leaseId = overrides.leaseId ?? `lease_${randomUUID()}`;
    const workspaceId = overrides.workspaceId ?? fixture.workspaceId;
    const cloudId = overrides.cloudId ?? fixture.cloudId;
    const userId = overrides.userId ?? fixture.userId;
    const accountId = overrides.accountId ?? fixture.accountId;
    const atlassianAccountId = overrides.atlassianAccountId ?? fixture.atlassianAccountId;
    const grantId = overrides.grantId ?? fixture.grantId;
    const membershipVersion = overrides.membershipVersion ?? 1;
    const identityVersion = overrides.identityVersion ?? 1;
    const workspaceVersion = overrides.workspaceVersion ?? 1;
    const sitePolicyVersion = overrides.sitePolicyVersion ?? 1;
    const projectId = overrides.projectId !== undefined ? overrides.projectId : null;
    const projectPolicyVersion =
      overrides.projectPolicyVersion !== undefined
        ? overrides.projectPolicyVersion
        : projectId
          ? 1
          : null;
    const ttlMs = overrides.ttlMs ?? 15000;
    const status = overrides.status ?? 'active';

    if (overrides.expiresAt !== undefined || overrides.acquiredAt !== undefined) {
      const res = await pool.query<LeaseRow>(
        `INSERT INTO jira_authorization_leases (
          lease_id, workspace_id, cloud_id, ati_user_id, jira_account_id,
          atlassian_account_id, grant_id, membership_version, identity_version,
          workspace_version, site_policy_version, project_id, project_policy_version,
          ttl_ms, acquired_at, expires_at, status
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14, COALESCE($15, clock_timestamp()), $16, $17
        )
        RETURNING *`,
        [
          leaseId,
          workspaceId,
          cloudId,
          userId,
          accountId,
          atlassianAccountId,
          grantId,
          membershipVersion,
          identityVersion,
          workspaceVersion,
          sitePolicyVersion,
          projectId,
          projectPolicyVersion,
          ttlMs,
          overrides.acquiredAt ?? null,
          overrides.expiresAt,
          status,
        ]
      );
      const row = res.rows[0];
      if (!row) throw new Error('Expected returned lease row');
      return row;
    }

    const res = await pool.query<LeaseRow>(
      `INSERT INTO jira_authorization_leases (
        lease_id, workspace_id, cloud_id, ati_user_id, jira_account_id,
        atlassian_account_id, grant_id, membership_version, identity_version,
        workspace_version, site_policy_version, project_id, project_policy_version,
        ttl_ms, acquired_at, expires_at, status
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13,
        $14, clock_timestamp(), clock_timestamp() + ($15::int * interval '1 millisecond'), $16
      )
      RETURNING *`,
      [
        leaseId,
        workspaceId,
        cloudId,
        userId,
        accountId,
        atlassianAccountId,
        grantId,
        membershipVersion,
        identityVersion,
        workspaceVersion,
        sitePolicyVersion,
        projectId,
        projectPolicyVersion,
        ttlMs,
        ttlMs,
        status,
      ]
    );
    const row = res.rows[0];
    if (!row) throw new Error('Expected returned lease row');
    return row;
  };

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 4 });
    appliedFiles = await ctx.runAllMigrations();
    defaultFixture = await setupLeasePrerequisites(ctx.pool, 'init_lease');
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  describe('Migration Chain & Table Schema Definition', () => {
    it('includes 0022_jira_authorization_leases.sql in migration files and executes successfully', () => {
      expect(appliedFiles).toContain('0022_jira_authorization_leases.sql');
    });

    it('creates jira_authorization_leases table with exact required columns, types, and nullability', async () => {
      const colRes = await ctx.pool.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'jira_authorization_leases'
           AND table_schema = current_schema()
         ORDER BY ordinal_position ASC`
      );

      const columns = new Map(colRes.rows.map((r) => [r.column_name, r]));

      const expectedColumns: Record<string, { type: string; nullable: 'YES' | 'NO' }> = {
        id: { type: 'uuid', nullable: 'NO' },
        lease_id: { type: 'text', nullable: 'NO' },
        workspace_id: { type: 'uuid', nullable: 'NO' },
        cloud_id: { type: 'text', nullable: 'NO' },
        ati_user_id: { type: 'uuid', nullable: 'NO' },
        jira_account_id: { type: 'uuid', nullable: 'NO' },
        atlassian_account_id: { type: 'text', nullable: 'NO' },
        grant_id: { type: 'uuid', nullable: 'NO' },
        membership_version: { type: 'integer', nullable: 'NO' },
        identity_version: { type: 'integer', nullable: 'NO' },
        workspace_version: { type: 'integer', nullable: 'NO' },
        site_policy_version: { type: 'integer', nullable: 'NO' },
        project_id: { type: 'text', nullable: 'YES' },
        project_policy_version: { type: 'integer', nullable: 'YES' },
        ttl_ms: { type: 'integer', nullable: 'NO' },
        acquired_at: { type: 'timestamp with time zone', nullable: 'NO' },
        expires_at: { type: 'timestamp with time zone', nullable: 'NO' },
        released_at: { type: 'timestamp with time zone', nullable: 'YES' },
        status: { type: 'text', nullable: 'NO' },
        created_at: { type: 'timestamp with time zone', nullable: 'NO' },
      };

      for (const [colName, expected] of Object.entries(expectedColumns)) {
        const col = columns.get(colName);
        expect(col, `Column ${colName} should exist`).toBeDefined();
        if (col) {
          expect(col.data_type).toBe(expected.type);
          expect(col.is_nullable).toBe(expected.nullable);
        }
      }

      expect(columns.size).toBe(Object.keys(expectedColumns).length);
    });

    it('enforces primary key on id and unique constraint on lease_id', async () => {
      const lease1 = await insertLease(ctx.pool, defaultFixture);
      expect(lease1.id).toBeDefined();

      await expect(
        insertLease(ctx.pool, defaultFixture, { leaseId: lease1.lease_id })
      ).rejects.toThrow();

      const pkRes = await ctx.pool.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
         WHERE conrelid = 'jira_authorization_leases'::regclass AND contype = 'p'`
      );
      expect(pkRes.rowCount).toBe(1);

      const uqRes = await ctx.pool.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
         WHERE conrelid = 'jira_authorization_leases'::regclass AND contype = 'u'`
      );
      expect(uqRes.rowCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Foreign Key Constraints and Cascades', () => {
    it('successfully persists active lease with valid foreign keys and default values', async () => {
      const fixture = await setupLeasePrerequisites(ctx.pool, 'fk_valid');
      const lease = await insertLease(ctx.pool, fixture);

      expect(lease.status).toBe('active');
      expect(lease.workspace_id).toBe(fixture.workspaceId);
      expect(lease.ati_user_id).toBe(fixture.userId);
      expect(lease.jira_account_id).toBe(fixture.accountId);
      expect(lease.grant_id).toBe(fixture.grantId);
      expect(lease.cloud_id).toBe(fixture.cloudId);
      expect(lease.released_at).toBeNull();
      expect(lease.acquired_at).toBeInstanceOf(Date);
      expect(lease.expires_at).toBeInstanceOf(Date);
      expect(lease.created_at).toBeInstanceOf(Date);
    });

    it('rejects lease insert referencing non-existent foreign keys', async () => {
      const nonExistentUuid = randomUUID();

      await expect(
        insertLease(ctx.pool, defaultFixture, { workspaceId: nonExistentUuid })
      ).rejects.toThrow();

      await expect(
        insertLease(ctx.pool, defaultFixture, { userId: nonExistentUuid })
      ).rejects.toThrow();

      await expect(
        insertLease(ctx.pool, defaultFixture, { accountId: nonExistentUuid })
      ).rejects.toThrow();

      await expect(
        insertLease(ctx.pool, defaultFixture, { grantId: nonExistentUuid })
      ).rejects.toThrow();
    });

    it('cascades lease deletion when referenced grant is deleted', async () => {
      const fixture = await setupLeasePrerequisites(ctx.pool, 'cascade_grant');
      const lease = await insertLease(ctx.pool, fixture);

      await ctx.pool.query(`DELETE FROM jira_oauth_grants WHERE id = $1`, [fixture.grantId]);

      const check = await ctx.pool.query(
        `SELECT id FROM jira_authorization_leases WHERE id = $1`,
        [lease.id]
      );
      expect(check.rowCount).toBe(0);
    });

    it('cascades lease deletion when referenced workspace is deleted', async () => {
      const fixture = await setupLeasePrerequisites(ctx.pool, 'cascade_ws');
      const lease = await insertLease(ctx.pool, fixture);

      await ctx.pool.query(`DELETE FROM ati_workspaces WHERE id = $1`, [fixture.workspaceId]);

      const check = await ctx.pool.query(
        `SELECT id FROM jira_authorization_leases WHERE id = $1`,
        [lease.id]
      );
      expect(check.rowCount).toBe(0);
    });

    it('cascades lease deletion when referenced user is deleted', async () => {
      const fixture = await setupLeasePrerequisites(ctx.pool, 'cascade_user');
      const lease = await insertLease(ctx.pool, fixture);

      const replacementCreator = await createSyntheticUser(ctx.pool, 'Replacement Creator', 'cascade_creator');
      await ctx.pool.query(`UPDATE workspaces SET created_by = $1 WHERE id = $2`, [replacementCreator, fixture.workspaceId]);
      await ctx.pool.query(`UPDATE ati_workspaces SET created_by = $1 WHERE id = $2`, [replacementCreator, fixture.workspaceId]);
      await ctx.pool.query(`DELETE FROM users WHERE id = $1`, [fixture.userId]);

      const check = await ctx.pool.query(
        `SELECT id FROM jira_authorization_leases WHERE id = $1`,
        [lease.id]
      );
      expect(check.rowCount).toBe(0);
    });

    it('cascades lease deletion when referenced jira account is deleted', async () => {
      const fixture = await setupLeasePrerequisites(ctx.pool, 'cascade_acct');
      const lease = await insertLease(ctx.pool, fixture);

      await ctx.pool.query(`DELETE FROM jira_accounts WHERE id = $1`, [fixture.accountId]);

      const check = await ctx.pool.query(
        `SELECT id FROM jira_authorization_leases WHERE id = $1`,
        [lease.id]
      );
      expect(check.rowCount).toBe(0);
    });
  });

  describe('Check Constraints Enforcement', () => {
    it('enforces chk_jira_leases_expiry: expires_at must be strictly greater than acquired_at', async () => {
      const fixedBaseTime = '2026-11-02T12:00:00.000Z';
      const earlierTime = '2026-11-02T11:59:59.000Z';
      const laterTime = '2026-11-02T12:00:15.000Z';

      await expect(
        insertLease(ctx.pool, defaultFixture, {
          acquiredAt: fixedBaseTime,
          expiresAt: fixedBaseTime,
        })
      ).rejects.toThrow();

      await expect(
        insertLease(ctx.pool, defaultFixture, {
          acquiredAt: fixedBaseTime,
          expiresAt: earlierTime,
        })
      ).rejects.toThrow();

      const validLease = await insertLease(ctx.pool, defaultFixture, {
        acquiredAt: fixedBaseTime,
        expiresAt: laterTime,
      });
      expect(validLease.id).toBeDefined();

      const chkRes = await ctx.pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) as def FROM pg_constraint
         WHERE conrelid = 'jira_authorization_leases'::regclass
           AND conname = 'chk_jira_leases_expiry'`
      );
      expect(chkRes.rowCount).toBe(1);
      const def = chkRes.rows[0]?.def;
      if (!def) throw new Error('Expected chk_jira_leases_expiry definition');
      expect(def).toContain('expires_at > acquired_at');
    });

    it('enforces parameterized ttl_ms check constraint (0 < ttl_ms <= 60000)', async () => {
      const minValid = await insertLease(ctx.pool, defaultFixture, { ttlMs: 1 });
      expect(minValid.ttl_ms).toBe(1);

      const defaultValid = await insertLease(ctx.pool, defaultFixture, { ttlMs: 15000 });
      expect(defaultValid.ttl_ms).toBe(15000);

      const maxValid = await insertLease(ctx.pool, defaultFixture, { ttlMs: 60000 });
      expect(maxValid.ttl_ms).toBe(60000);

      await expect(
        insertLease(ctx.pool, defaultFixture, { ttlMs: 0 })
      ).rejects.toThrow();

      await expect(
        insertLease(ctx.pool, defaultFixture, { ttlMs: -100 })
      ).rejects.toThrow();

      await expect(
        insertLease(ctx.pool, defaultFixture, { ttlMs: 60001 })
      ).rejects.toThrow();

      const paramLease = await insertLease(ctx.pool, defaultFixture, { ttlMs: 30000 });
      const diffMs = paramLease.expires_at.getTime() - paramLease.acquired_at.getTime();
      expect(diffMs).toBeGreaterThanOrEqual(29900);
      expect(diffMs).toBeLessThanOrEqual(30100);
    });

    it('enforces status check constraint (active, released, expired, revoked)', async () => {
      const lease = await insertLease(ctx.pool, defaultFixture, { status: 'active' });

      for (const validStatus of ['released', 'expired', 'revoked'] as const) {
        const updateRes = await ctx.pool.query<{ status: string }>(
          `UPDATE jira_authorization_leases
           SET status = $1, released_at = clock_timestamp()
           WHERE id = $2
           RETURNING status`,
          [validStatus, lease.id]
        );
        expect(updateRes.rows[0]?.status).toBe(validStatus);
      }

      await expect(
        ctx.pool.query(
          `UPDATE jira_authorization_leases SET status = 'pending' WHERE id = $1`,
          [lease.id]
        )
      ).rejects.toThrow();

      await expect(
        ctx.pool.query(
          `UPDATE jira_authorization_leases SET status = 'invalid' WHERE id = $1`,
          [lease.id]
        )
      ).rejects.toThrow();
    });

    it('enforces version check constraints (membership, identity, workspace, site_policy > 0)', async () => {
      await expect(
        insertLease(ctx.pool, defaultFixture, { membershipVersion: 0 })
      ).rejects.toThrow();
      await expect(
        insertLease(ctx.pool, defaultFixture, { membershipVersion: -1 })
      ).rejects.toThrow();

      await expect(
        insertLease(ctx.pool, defaultFixture, { identityVersion: 0 })
      ).rejects.toThrow();
      await expect(
        insertLease(ctx.pool, defaultFixture, { identityVersion: -1 })
      ).rejects.toThrow();

      await expect(
        insertLease(ctx.pool, defaultFixture, { workspaceVersion: 0 })
      ).rejects.toThrow();
      await expect(
        insertLease(ctx.pool, defaultFixture, { workspaceVersion: -1 })
      ).rejects.toThrow();

      await expect(
        insertLease(ctx.pool, defaultFixture, { sitePolicyVersion: 0 })
      ).rejects.toThrow();
      await expect(
        insertLease(ctx.pool, defaultFixture, { sitePolicyVersion: -1 })
      ).rejects.toThrow();
    });

    it('enforces project_id and project_policy_version checks', async () => {
      const siteWideLease = await insertLease(ctx.pool, defaultFixture, {
        projectId: null,
        projectPolicyVersion: null,
      });
      expect(siteWideLease.project_id).toBeNull();
      expect(siteWideLease.project_policy_version).toBeNull();

      const projectLease = await insertLease(ctx.pool, defaultFixture, {
        projectId: '10001',
        projectPolicyVersion: 1,
      });
      expect(projectLease.project_id).toBe('10001');
      expect(projectLease.project_policy_version).toBe(1);

      await expect(
        insertLease(ctx.pool, defaultFixture, { projectId: '0' })
      ).rejects.toThrow();

      await expect(
        insertLease(ctx.pool, defaultFixture, { projectId: 'PROJ-123' })
      ).rejects.toThrow();

      await expect(
        insertLease(ctx.pool, defaultFixture, { projectId: '-5' })
      ).rejects.toThrow();

      await expect(
        insertLease(ctx.pool, defaultFixture, {
          projectId: '10001',
          projectPolicyVersion: 0,
        })
      ).rejects.toThrow();

      await expect(
        insertLease(ctx.pool, defaultFixture, {
          projectId: '10001',
          projectPolicyVersion: -1,
        })
      ).rejects.toThrow();
    });
  });

  describe('Indexes Verification', () => {
    it('verifies compound partial index idx_jira_leases_active on (workspace_id, cloud_id, expires_at) WHERE status = active', async () => {
      const idxRes = await ctx.pool.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE schemaname = current_schema()
           AND tablename = 'jira_authorization_leases'
           AND indexname = 'idx_jira_leases_active'`
      );

      expect(idxRes.rowCount).toBe(1);
      const idxDef = idxRes.rows[0]?.indexdef;
      if (!idxDef) throw new Error('Expected idx_jira_leases_active definition');

      expect(idxDef).toContain('workspace_id');
      expect(idxDef).toContain('cloud_id');
      expect(idxDef).toContain('expires_at');
      expect(idxDef).toContain("status = 'active'");
    });

    it('verifies user status index idx_jira_leases_user on (ati_user_id, status)', async () => {
      const idxRes = await ctx.pool.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE schemaname = current_schema()
           AND tablename = 'jira_authorization_leases'
           AND indexname = 'idx_jira_leases_user'`
      );

      expect(idxRes.rowCount).toBe(1);
      const idxDef = idxRes.rows[0]?.indexdef;
      if (!idxDef) throw new Error('Expected idx_jira_leases_user definition');

      expect(idxDef).toContain('ati_user_id');
      expect(idxDef).toContain('status');
    });
  });

  describe('Idempotence: Full migration chain rerun with representative lease rows', () => {
    it('executes full migration chain a second time in a transaction and preserves rows and schema integrity', async () => {
      const rerunFixture = await setupLeasePrerequisites(ctx.pool, 'rerun_chain');

      const leaseActiveSite = await insertLease(ctx.pool, rerunFixture, {
        projectId: null,
        projectPolicyVersion: null,
        status: 'active',
      });

      const leaseActiveProj = await insertLease(ctx.pool, rerunFixture, {
        projectId: '10023',
        projectPolicyVersion: 2,
        status: 'active',
      });

      const leaseReleased = await insertLease(ctx.pool, rerunFixture, {
        status: 'released',
      });
      await ctx.pool.query(
        `UPDATE jira_authorization_leases SET released_at = clock_timestamp() WHERE id = $1`,
        [leaseReleased.id]
      );

      const leaseRevoked = await insertLease(ctx.pool, rerunFixture, {
        status: 'revoked',
      });
      await ctx.pool.query(
        `UPDATE jira_authorization_leases SET released_at = clock_timestamp() WHERE id = $1`,
        [leaseRevoked.id]
      );

      const leaseExpired = await insertLease(ctx.pool, rerunFixture, {
        status: 'expired',
      });
      await ctx.pool.query(
        `UPDATE jira_authorization_leases SET released_at = clock_timestamp() WHERE id = $1`,
        [leaseExpired.id]
      );

      // Execute full migration sequence in a single transaction (same semantics as db/v3/migrate.mjs)
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

      // Prove representative lease rows are intact
      const checkActiveSite = await ctx.pool.query<LeaseRow>(
        `SELECT * FROM jira_authorization_leases WHERE id = $1`,
        [leaseActiveSite.id]
      );
      expect(checkActiveSite.rowCount).toBe(1);
      expect(checkActiveSite.rows[0]?.status).toBe('active');
      expect(checkActiveSite.rows[0]?.project_id).toBeNull();
      expect(checkActiveSite.rows[0]?.lease_id).toBe(leaseActiveSite.lease_id);

      const checkActiveProj = await ctx.pool.query<LeaseRow>(
        `SELECT * FROM jira_authorization_leases WHERE id = $1`,
        [leaseActiveProj.id]
      );
      expect(checkActiveProj.rowCount).toBe(1);
      expect(checkActiveProj.rows[0]?.status).toBe('active');
      expect(checkActiveProj.rows[0]?.project_id).toBe('10023');
      expect(checkActiveProj.rows[0]?.project_policy_version).toBe(2);

      const checkReleased = await ctx.pool.query<LeaseRow>(
        `SELECT * FROM jira_authorization_leases WHERE id = $1`,
        [leaseReleased.id]
      );
      expect(checkReleased.rowCount).toBe(1);
      expect(checkReleased.rows[0]?.status).toBe('released');
      expect(checkReleased.rows[0]?.released_at).toBeDefined();

      const checkRevoked = await ctx.pool.query<LeaseRow>(
        `SELECT * FROM jira_authorization_leases WHERE id = $1`,
        [leaseRevoked.id]
      );
      expect(checkRevoked.rowCount).toBe(1);
      expect(checkRevoked.rows[0]?.status).toBe('revoked');
      expect(checkRevoked.rows[0]?.released_at).toBeDefined();

      const checkExpired = await ctx.pool.query<LeaseRow>(
        `SELECT * FROM jira_authorization_leases WHERE id = $1`,
        [leaseExpired.id]
      );
      expect(checkExpired.rowCount).toBe(1);
      expect(checkExpired.rows[0]?.status).toBe('expired');
      expect(checkExpired.rows[0]?.released_at).toBeDefined();

      // Prove constraints remain intact after rerun
      const expiryDefRes = await ctx.pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) as def FROM pg_constraint
         WHERE conrelid = 'jira_authorization_leases'::regclass
           AND conname = 'chk_jira_leases_expiry'`
      );
      expect(expiryDefRes.rowCount).toBe(1);
      expect(expiryDefRes.rows[0]?.def).toContain('expires_at > acquired_at');

      const activeIdxRes = await ctx.pool.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes
         WHERE schemaname = current_schema()
           AND tablename = 'jira_authorization_leases'
           AND indexname = 'idx_jira_leases_active'`
      );
      expect(activeIdxRes.rowCount).toBe(1);
      expect(activeIdxRes.rows[0]?.indexdef).toContain("status = 'active'");
    });
  });
});
