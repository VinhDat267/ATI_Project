import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { JiraAuthorizationLease } from '@wap/tool-schemas';

export interface JiraLeaseTokenManager {
  getAccessToken(userId: string, options?: { signal?: AbortSignal }): Promise<string>;
}

export interface AcquireLeaseParams {
  userId: string;
  workspaceId: string;
  cloudId: string;
  projectId?: string;
  ttlMs?: number;
  signal?: AbortSignal;
}

export interface MarkRevokedFilter {
  workspaceId: string;
  cloudId?: string;
  userId?: string;
}

export interface ExtendedJiraAuthorizationLease extends JiraAuthorizationLease {
  workspaceVersion: number;
  sitePolicyVersion: number;
  siteId: string;
  projectPolicyVersion?: number | null;
}

export interface RevalidateLeaseResult {
  valid: boolean;
  status?: 'active' | 'released' | 'expired' | 'revoked';
}

type Row = Record<string, unknown>;
const fail = (reason: string): never => { throw new Error(`Jira lease denied: ${reason}`); };

/** Short committed authorization record. Final outbound linearization belongs to JIRA-08. */
export class JiraLeaseManager {
  private readonly pool: Pool;
  private readonly tokenManager: JiraLeaseTokenManager;

  constructor(options: { pool: Pool; tokenManager: JiraLeaseTokenManager }) {
    this.pool = options.pool;
    this.tokenManager = options.tokenManager;
  }

  private async one(client: PoolClient, sql: string, args: unknown[]): Promise<Row> {
    const result = await client.query(sql, args);
    if (result.rowCount !== 1) fail('current authorization evidence is unavailable');
    return result.rows[0] as Row;
  }

  async acquireLease(params: AcquireLeaseParams): Promise<ExtendedJiraAuthorizationLease> {
    const ttlMs = params.ttlMs ?? 15_000;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 60_000) fail('invalid TTL');
    if (!params.userId || !params.workspaceId || !params.cloudId || (params.projectId !== undefined && !/^[1-9][0-9]*$/.test(params.projectId))) fail('invalid scope');
    if (params.signal?.aborted) throw params.signal.reason ?? new Error('Aborted');

    // Token retrieval is deliberately outside the transaction: HTTP may be slow.
    const token = await this.tokenManager.getAccessToken(params.userId, { signal: params.signal });
    if (!token) fail('access token unavailable');
    if (params.signal?.aborted) throw params.signal.reason ?? new Error('Aborted');

    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      // Lock hierarchy is shared with workspace policy mutations.
      await this.one(client, 'SELECT id FROM workspaces WHERE id = $1 FOR SHARE', [params.workspaceId]);
      const generalMember = await this.one(client, 'SELECT status FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 FOR SHARE', [params.workspaceId, params.userId]);
      if (generalMember.status !== 'active') fail('general membership inactive');
      const workspace = await this.one(client, 'SELECT status, version FROM ati_workspaces WHERE id = $1 FOR SHARE', [params.workspaceId]);
      if (workspace.status !== 'active') fail('workspace inactive');
      const membership = await this.one(client, 'SELECT status, version FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR SHARE', [params.workspaceId, params.userId]);
      if (membership.status !== 'active') fail('Jira membership inactive');
      const user = await this.one(client, 'SELECT status FROM users WHERE id = $1 FOR SHARE', [params.userId]);
      if (user.status !== 'active') fail('user inactive');
      const account = await this.one(client, 'SELECT id, atlassian_account_id, identity_version, status FROM jira_accounts WHERE user_id = $1 AND status = $2 FOR SHARE', [params.userId, 'connected']);
      if (account.status !== 'connected') fail('account disconnected');

      const grants = await client.query(
        `SELECT g.id FROM jira_oauth_grants g
         JOIN jira_grant_sites s ON s.grant_id = g.id
         WHERE g.account_id = $1 AND g.status = 'active' AND s.cloud_id = $2 AND s.product_type = 'jira'
         ORDER BY g.created_at DESC LIMIT 1 FOR SHARE OF g, s`,
        [account.id, params.cloudId]
      );
      if (grants.rowCount !== 1) fail('active site grant unavailable');
      const site = await this.one(client, 'SELECT id, active, policy_version FROM ati_workspace_jira_sites WHERE workspace_id = $1 AND cloud_id = $2 FOR SHARE', [params.workspaceId, params.cloudId]);
      if (!site.active) fail('site inactive');
      let projectVersion: number | null = null;
      if (params.projectId) {
        const project = await this.one(client, 'SELECT selected, policy_version FROM ati_workspace_jira_projects WHERE workspace_id = $1 AND site_id = $2 AND numeric_project_id = $3 FOR SHARE', [params.workspaceId, site.id, params.projectId]);
        if (!project.selected) fail('project not selected');
        projectVersion = Number(project.policy_version);
      }
      if (params.signal?.aborted) throw params.signal.reason ?? new Error('Aborted');
      const leaseId = randomUUID();
      const result = await client.query(
        `INSERT INTO jira_authorization_leases
          (lease_id, workspace_id, cloud_id, ati_user_id, jira_account_id, atlassian_account_id, grant_id,
           membership_version, identity_version, workspace_version, site_policy_version,
           project_id, project_policy_version, ttl_ms, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
           clock_timestamp() + ($14::int * interval '1 millisecond'))
         RETURNING acquired_at, expires_at`,
        [leaseId, params.workspaceId, params.cloudId, params.userId, account.id, account.atlassian_account_id,
          grants.rows[0]!.id, membership.version, account.identity_version, workspace.version,
          site.policy_version, params.projectId ?? null, projectVersion, ttlMs]
      );
      if (params.signal?.aborted) throw params.signal.reason ?? new Error('Aborted');
      await client.query('COMMIT');
      committed = true;
      const row = result.rows[0]!;
      return {
        leaseId, workspaceId: params.workspaceId, cloudId: params.cloudId, ttlMs,
        acquiredAt: (row.acquired_at as Date).toISOString(), expiresAt: (row.expires_at as Date).toISOString(),
        binding: {
          atiUserId: params.userId, jiraAccountId: String(account.id), atlassianAccountId: String(account.atlassian_account_id),
          workspaceId: params.workspaceId, membershipVersion: Number(membership.version), grantId: String(grants.rows[0]!.id),
          identityVersion: Number(account.identity_version),
        },
        workspaceVersion: Number(workspace.version),
        sitePolicyVersion: Number(site.policy_version),
        siteId: String(site.id),
        projectPolicyVersion: projectVersion,
      };
    } catch (error) {
      if (!committed) await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async markRevoked(filter: MarkRevokedFilter): Promise<number> {
    if (!filter.workspaceId) fail('workspace required');
    const result = await this.pool.query(
      `UPDATE jira_authorization_leases SET status = 'revoked', released_at = clock_timestamp()
       WHERE workspace_id = $1 AND ($2::text IS NULL OR cloud_id = $2)
         AND ($3::uuid IS NULL OR ati_user_id = $3) AND status = 'active'`,
      [filter.workspaceId, filter.cloudId ?? null, filter.userId ?? null]
    );
    return result.rowCount ?? 0;
  }

  async releaseLease(leaseId: string): Promise<void> {
    await this.pool.query(
      `UPDATE jira_authorization_leases SET status = 'released', released_at = clock_timestamp()
       WHERE lease_id = $1 AND status = 'active'`,
      [leaseId]
    );
  }

  async revalidateLease(leaseId: string): Promise<RevalidateLeaseResult> {
    const result = await this.pool.query<{ status: RevalidateLeaseResult['status']; expired: boolean; authority_valid: boolean | null }>(
      `SELECT l.status, l.expires_at <= clock_timestamp() AS expired,
        (w.status = 'active' AND w.version = l.workspace_version
         AND wm.status = 'active' AND jm.status = 'active' AND jm.version = l.membership_version
         AND u.status = 'active' AND a.status = 'connected' AND a.identity_version = l.identity_version
         AND a.atlassian_account_id = l.atlassian_account_id
         AND g.status = 'active' AND gs.cloud_id IS NOT NULL
         AND s.active = true AND s.policy_version = l.site_policy_version
         AND (l.project_id IS NULL OR (p.selected = true AND p.policy_version = l.project_policy_version))) AS authority_valid
       FROM jira_authorization_leases l
       LEFT JOIN ati_workspaces w ON w.id = l.workspace_id
       LEFT JOIN workspace_members wm ON wm.workspace_id = l.workspace_id AND wm.user_id = l.ati_user_id
       LEFT JOIN ati_workspace_memberships jm ON jm.workspace_id = l.workspace_id AND jm.user_id = l.ati_user_id
       LEFT JOIN users u ON u.id = l.ati_user_id
       LEFT JOIN jira_accounts a ON a.id = l.jira_account_id AND a.user_id = l.ati_user_id
       LEFT JOIN jira_oauth_grants g ON g.id = l.grant_id AND g.account_id = l.jira_account_id
       LEFT JOIN jira_grant_sites gs ON gs.grant_id = l.grant_id AND gs.cloud_id = l.cloud_id AND gs.product_type = 'jira'
       LEFT JOIN ati_workspace_jira_sites s ON s.workspace_id = l.workspace_id AND s.cloud_id = l.cloud_id
       LEFT JOIN ati_workspace_jira_projects p ON p.workspace_id = l.workspace_id AND p.site_id = s.id AND p.numeric_project_id = l.project_id
       WHERE l.lease_id = $1`,
      [leaseId]
    );
    const row = result.rows[0];
    if (!row) return { valid: false };
    if (row.expired && row.status === 'active') return { valid: false, status: 'expired' };
    if (row.status === 'active' && row.authority_valid !== true) {
      await this.pool.query(
        `UPDATE jira_authorization_leases SET status = 'revoked', released_at = clock_timestamp()
         WHERE lease_id = $1 AND status = 'active'`, [leaseId]
      );
      return { valid: false, status: 'revoked' };
    }
    return { valid: row.status === 'active', status: row.status };
  }

  /**
   * Revalidates authorization under a dedicated PostgreSQL transaction holding
   * a row lock (FOR UPDATE OF l) across the provided action (e.g. persisting receipt
   * and emitting SSE delta). If valid, marks the lease as released and commits.
   * Concurrent revocation attempts (markRevoked or direct UPDATE) are blocked
   * until this transaction completes.
   */
  async withLockedLease<T>(
    leaseId: string,
    action: (client: PoolClient, validation: RevalidateLeaseResult) => Promise<T>,
    options?: { signal?: AbortSignal }
  ): Promise<T> {
    if (this.revalidateLease !== JiraLeaseManager.prototype.revalidateLease) {
      const customReval = await this.revalidateLease(leaseId);
      if (!customReval.valid || customReval.status !== 'active') {
        return action(null as any, customReval);
      }
    }

    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      // Step 1: Read immutable lease identifiers without holding a row lock first,
      // so authority tables are ALWAYS locked before jira_authorization_leases (preventing 40P01 deadlocks).
      const leaseInitRes = await client.query<{
        status: RevalidateLeaseResult['status'];
        expired: boolean;
        workspace_id: string;
        ati_user_id: string;
        jira_account_id: string;
        atlassian_account_id: string;
        grant_id: string;
        cloud_id: string;
        project_id: string | null;
        workspace_version: number;
        membership_version: number;
        identity_version: number;
        site_policy_version: number;
        project_policy_version: number | null;
      }>(
        `SELECT status, expires_at <= clock_timestamp() AS expired,
          workspace_id, ati_user_id, jira_account_id, atlassian_account_id,
          grant_id, cloud_id, project_id,
          workspace_version, membership_version, identity_version,
          site_policy_version, project_policy_version
        FROM jira_authorization_leases
        WHERE lease_id = $1`,
        [leaseId]
      );

      const lease = leaseInitRes.rows[0];
      if (!lease) {
        await client.query('ROLLBACK');
        return action(client, { valid: false });
      }

      if (lease.status !== 'active' && !lease.expired) {
        await client.query('ROLLBACK');
        return action(client, { valid: false, status: lease.status });
      }

      // Step 2: Lock and recheck all authority rows FOR SHARE in canonical top-down order
      const authRes = await client.query<{
        workspace_valid: boolean;
        general_member_valid: boolean;
        jira_member_valid: boolean;
        user_valid: boolean;
        account_valid: boolean;
        grant_valid: boolean;
        site_id: string;
        site_valid: boolean;
      }>(
        `SELECT
          (w.status = 'active' AND w.version = $2) AS workspace_valid,
          (wm.status = 'active') AS general_member_valid,
          (jm.status = 'active' AND jm.version = $3) AS jira_member_valid,
          (u.status = 'active') AS user_valid,
          (a.status = 'connected' AND a.identity_version = $4 AND a.atlassian_account_id = $5) AS account_valid,
          (g.status = 'active') AS grant_valid,
          s.id AS site_id,
          (s.active = true AND s.policy_version = $6) AS site_valid
        FROM workspaces ws
        JOIN ati_workspaces w ON w.id = ws.id
        JOIN workspace_members wm ON wm.workspace_id = ws.id AND wm.user_id = $7
        JOIN ati_workspace_memberships jm ON jm.workspace_id = ws.id AND jm.user_id = $7
        JOIN users u ON u.id = $7
        JOIN jira_accounts a ON a.id = $8 AND a.user_id = $7
        JOIN jira_oauth_grants g ON g.id = $9 AND g.account_id = a.id
        JOIN jira_grant_sites gs ON gs.grant_id = g.id AND gs.cloud_id = $10 AND gs.product_type = 'jira'
        JOIN ati_workspace_jira_sites s ON s.workspace_id = ws.id AND s.cloud_id = $10
        WHERE ws.id = $1
        FOR SHARE OF ws, w, wm, jm, u, a, g, gs, s`,
        [
          lease.workspace_id,
          lease.workspace_version,
          lease.membership_version,
          lease.identity_version,
          lease.atlassian_account_id,
          lease.site_policy_version,
          lease.ati_user_id,
          lease.jira_account_id,
          lease.grant_id,
          lease.cloud_id,
        ]
      );

      const authRow = authRes.rows[0];
      let authorityValid = Boolean(
        authRow &&
        authRow.workspace_valid &&
        authRow.general_member_valid &&
        authRow.jira_member_valid &&
        authRow.user_valid &&
        authRow.account_valid &&
        authRow.grant_valid &&
        authRow.site_valid
      );

      if (authorityValid && lease.project_id && authRow) {
        const projRes = await client.query<{ project_valid: boolean }>(
          `SELECT (selected = true AND policy_version = $4) AS project_valid
           FROM ati_workspace_jira_projects
           WHERE workspace_id = $1 AND site_id = $2 AND numeric_project_id = $3
           FOR SHARE`,
          [lease.workspace_id, authRow.site_id, lease.project_id, lease.project_policy_version]
        );
        const projRow = projRes.rows[0];
        if (!projRow || !projRow.project_valid) {
          authorityValid = false;
        }
      }

      // Step 3: Now lock jira_authorization_leases FOR UPDATE (always last in the lock hierarchy)
      const lockedLeaseRes = await client.query<{
        status: RevalidateLeaseResult['status'];
        expired: boolean;
      }>(
        `SELECT status, expires_at <= clock_timestamp() AS expired
         FROM jira_authorization_leases
         WHERE lease_id = $1
         FOR UPDATE`,
        [leaseId]
      );
      const lockedLease = lockedLeaseRes.rows[0];
      if (!lockedLease) {
        await client.query('ROLLBACK');
        return action(client, { valid: false });
      }

      if (lockedLease.expired && lockedLease.status === 'active') {
        await client.query(
          `UPDATE jira_authorization_leases SET status = 'expired', released_at = clock_timestamp() WHERE lease_id = $1`,
          [leaseId]
        );
        await client.query('COMMIT');
        committed = true;
        return action(client, { valid: false, status: 'expired' });
      }

      if (lockedLease.status !== 'active') {
        await client.query('ROLLBACK');
        return action(client, { valid: false, status: lockedLease.status });
      }

      if (!authorityValid) {
        await client.query(
          `UPDATE jira_authorization_leases SET status = 'revoked', released_at = clock_timestamp() WHERE lease_id = $1`,
          [leaseId]
        );
        await client.query('COMMIT');
        committed = true;
        return action(client, { valid: false, status: 'revoked' });
      }

      const validation: RevalidateLeaseResult = { valid: true, status: 'active' };
      if (options?.signal?.aborted) throw options.signal.reason ?? new Error('Aborted');

      const actionResult = await action(client, validation);

      await client.query(
        `UPDATE jira_authorization_leases SET status = 'released', released_at = clock_timestamp() WHERE lease_id = $1 AND status = 'active'`,
        [leaseId]
      );

      await client.query('COMMIT');
      committed = true;
      return actionResult;
    } catch (error) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => {});
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async reapExpiredLeases(): Promise<number> {
    const result = await this.pool.query(
      `UPDATE jira_authorization_leases SET status = 'expired', released_at = clock_timestamp()
       WHERE status = 'active' AND expires_at <= clock_timestamp()`
    );
    return result.rowCount ?? 0;
  }
}
