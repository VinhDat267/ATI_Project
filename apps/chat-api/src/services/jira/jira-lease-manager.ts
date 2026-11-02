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
         ORDER BY g.created_at DESC LIMIT 1`,
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
    const result = await this.pool.query<{ status: RevalidateLeaseResult['status']; expired: boolean }>(
      `SELECT status, expires_at <= clock_timestamp() AS expired FROM jira_authorization_leases WHERE lease_id = $1`,
      [leaseId]
    );
    const row = result.rows[0];
    if (!row) return { valid: false };
    if (row.expired && row.status === 'active') return { valid: false, status: 'expired' };
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
