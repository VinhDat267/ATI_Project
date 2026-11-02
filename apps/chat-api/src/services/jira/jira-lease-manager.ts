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

  async acquireLease(params: AcquireLeaseParams): Promise<JiraAuthorizationLease> {
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

  async reapExpiredLeases(): Promise<number> {
    const result = await this.pool.query(
      `UPDATE jira_authorization_leases SET status = 'expired', released_at = clock_timestamp()
       WHERE status = 'active' AND expires_at <= clock_timestamp()`
    );
    return result.rowCount ?? 0;
  }
}
