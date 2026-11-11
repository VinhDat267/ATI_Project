import type { Pool } from 'pg';
import { isJiraG2AAllowedTool, JIRA_CAPABILITY_DISABLED_IN_G2A } from '@wap/tool-schemas';
import type { JiraLeaseManager } from './jira-lease-manager.js';

export interface DispatchScope {
  userId: string;
  workspaceId: string;
  cloudId: string;
  siteId: string;
  projectId?: string;
  sitePolicyVersion?: number;
  projectPolicyVersion?: number;
  expectedGrantId?: string;
  expectedAccountId?: string;
  expectedAtlassianAccountId?: string;
  expectedMembershipVersion?: number;
  expectedIdentityVersion?: number;
  expectedWorkspaceVersion?: number;
}

export interface GuardedDispatchOptions {
  isWrite: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  verifier?: {
    verifyUserPermissions: (
      evidence: { actorId: string; workspaceId?: string; cloudId: string; projectId?: string },
      options?: { signal?: AbortSignal }
    ) => Promise<{ canBrowse: boolean; canCreateIssue: boolean; canAddComment: boolean; status?: string; reason?: string }>;
  };
  tool: string;
  deferRelease?: boolean;
}

export class JiraDispatchError extends Error {
  readonly code: string;
  readonly category: string;
  readonly details: { requestSent: boolean };
  constructor(message: string, code = 'DISPATCH_DENIED', options?: { cause?: unknown; category?: string }) {
    super(message, options);
    this.name = 'JiraDispatchError';
    this.code = code;
    this.category = options?.category ?? 'AUTH_ERROR';
    this.details = { requestSent: false };
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface JiraDispatchTokenManager {
  getAccessToken(userId: string, options?: { signal?: AbortSignal }): Promise<string>;
}

export class JiraDispatchGuard {
  constructor(
    private readonly pool: Pool,
    public readonly leaseManager: JiraLeaseManager,
    private readonly tokenManager: JiraDispatchTokenManager
  ) {}

  async executeGuardedDispatch<T>(
    scope: DispatchScope,
    options: GuardedDispatchOptions,
    dispatchFn: (token: string, signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (options.isWrite || !isJiraG2AAllowedTool(options.tool)) {
      throw new JiraDispatchError(
        `${JIRA_CAPABILITY_DISABLED_IN_G2A}: Jira writes and non-G2A capabilities are disabled in G2A read-only mode`,
        JIRA_CAPABILITY_DISABLED_IN_G2A
      );
    }

    if (!scope.userId || !scope.workspaceId || !scope.cloudId) {
      throw new JiraDispatchError(
        'Invalid dispatch scope: userId, workspaceId, and cloudId are required',
        'INVALID_SCOPE'
      );
    }

    if (options.signal?.aborted) {
      throw options.signal.reason ?? new JiraDispatchError('Dispatch aborted before start', 'ABORTED');
    }

    // Step 1: Token acquisition outside any DB lock (may perform network I/O or token refresh)
    let token: string;
    try {
      token = await this.tokenManager.getAccessToken(scope.userId, { signal: options.signal });
      if (!token) {
        throw new Error('Empty access token returned');
      }
    } catch (err: any) {
      throw new JiraDispatchError(
        `Failed to obtain Jira access token: ${err?.message ?? String(err)}`,
        'TOKEN_UNAVAILABLE',
        { cause: err }
      );
    }

    if (options.signal?.aborted) {
      throw options.signal.reason ?? new JiraDispatchError('Dispatch aborted after token acquisition', 'ABORTED');
    }

    // Step 2: Acquire authorization lease via JiraLeaseManager
    const leaseTtl = options.timeoutMs
      ? Math.min(Math.max(options.timeoutMs + 5000, 5000), 60000)
      : 15000;

    let lease;
    try {
      lease = await this.leaseManager.acquireLease({
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        cloudId: scope.cloudId,
        projectId: scope.projectId,
        ttlMs: leaseTtl,
        signal: options.signal,
      });
    } catch (err: any) {
      throw new JiraDispatchError(
        `Failed to acquire authorization lease: ${err?.message ?? String(err)}`,
        'LEASE_DENIED',
        { cause: err }
      );
    }

    // Verify lease binding against approved plan binding parameters
    if (scope.expectedGrantId && lease.binding.grantId !== scope.expectedGrantId) {
      throw new JiraDispatchError(
        `Approved grant mismatch: expected ${scope.expectedGrantId}, got ${lease.binding.grantId}`,
        'GRANT_MISMATCH'
      );
    }
    if (scope.expectedAccountId && lease.binding.jiraAccountId !== scope.expectedAccountId) {
      throw new JiraDispatchError(
        `Approved account mismatch: expected ${scope.expectedAccountId}, got ${lease.binding.jiraAccountId}`,
        'ACCOUNT_MISMATCH'
      );
    }
    if (scope.expectedAtlassianAccountId && lease.binding.atlassianAccountId !== scope.expectedAtlassianAccountId) {
      throw new JiraDispatchError(
        `Approved Atlassian account mismatch: expected ${scope.expectedAtlassianAccountId}, got ${lease.binding.atlassianAccountId}`,
        'ATLASSIAN_ACCOUNT_MISMATCH'
      );
    }
    if (scope.expectedMembershipVersion !== undefined && lease.binding.membershipVersion !== scope.expectedMembershipVersion) {
      throw new JiraDispatchError(
        `Approved membership version mismatch: expected ${scope.expectedMembershipVersion}, got ${lease.binding.membershipVersion}`,
        'MEMBERSHIP_VERSION_STALE'
      );
    }
    if (scope.expectedIdentityVersion !== undefined && lease.binding.identityVersion !== scope.expectedIdentityVersion) {
      throw new JiraDispatchError(
        `Approved identity version mismatch: expected ${scope.expectedIdentityVersion}, got ${lease.binding.identityVersion}`,
        'IDENTITY_VERSION_STALE'
      );
    }

    // Check native permissions if verifier is provided
    if (options.verifier) {
      const nativeRes = await options.verifier.verifyUserPermissions(
        {
          actorId: scope.userId,
          workspaceId: scope.workspaceId,
          cloudId: scope.cloudId,
          projectId: scope.projectId,
        },
        { signal: options.signal }
      );
      if (nativeRes.status === 'denied' || !nativeRes.canBrowse) {
        throw new JiraDispatchError(
          `Native Jira permission denied: ${nativeRes.reason || 'User lacks BROWSE_PROJECTS'}`,
          'PERMISSION_DENIED'
        );
      }
      const rawTool: string | undefined = options.tool;
      if (rawTool === 'myjira.create_issue' && !nativeRes.canCreateIssue) {
        throw new JiraDispatchError(
          'Native Jira permission denied: User lacks CREATE_ISSUES permission',
          'PERMISSION_DENIED'
        );
      }
      if (rawTool === 'myjira.add_comment' && !nativeRes.canAddComment) {
        throw new JiraDispatchError(
          'Native Jira permission denied: User lacks ADD_COMMENTS permission',
          'PERMISSION_DENIED'
        );
      }
    }

    // Step 3: Set up timeout and abort controller
    const abortController = new AbortController();
    let timeoutId: NodeJS.Timeout | undefined;
    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        abortController.abort(new JiraDispatchError(`Dispatch timed out after ${options.timeoutMs}ms`, 'TIMEOUT'));
      }, options.timeoutMs);
    }

    const onExternalAbort = () => {
      abortController.abort(
        options.signal?.reason ?? new JiraDispatchError('Dispatch aborted by signal', 'ABORTED')
      );
    };

    if (options.signal) {
      if (options.signal.aborted) {
        abortController.abort(options.signal.reason);
      } else {
        options.signal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    // Step 4: Open dedicated DB connection holding row lock across HTTP dispatch
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');

      // Canonical lock hierarchy to prevent 40P01 deadlocks against disconnect/re-consent:
      // 1. Read immutable lease binding fields without FOR UPDATE first
      const leaseInitRes = await client.query<{
        status: string;
        expired: boolean;
        grant_id: string;
        jira_account_id: string;
        atlassian_account_id: string;
        membership_version: number;
        identity_version: number;
        workspace_version: number;
      }>(
        `SELECT status, expires_at <= clock_timestamp() AS expired,
                grant_id, jira_account_id, atlassian_account_id,
                membership_version, identity_version, workspace_version
         FROM jira_authorization_leases
         WHERE lease_id = $1`,
        [lease.leaseId]
      );

      const leaseInit = leaseInitRes.rows[0];
      if (!leaseInit || leaseInit.status !== 'active' || leaseInit.expired) {
        throw new JiraDispatchError('Lease expired or revoked before dispatch lock', 'LEASE_INVALID');
      }
      if (scope.expectedGrantId && leaseInit.grant_id !== scope.expectedGrantId) {
        throw new JiraDispatchError('Approved grant mismatch on locked lease', 'GRANT_MISMATCH');
      }
      if (scope.expectedAccountId && leaseInit.jira_account_id !== scope.expectedAccountId) {
        throw new JiraDispatchError('Approved account mismatch on locked lease', 'ACCOUNT_MISMATCH');
      }
      if (scope.expectedMembershipVersion !== undefined && leaseInit.membership_version !== scope.expectedMembershipVersion) {
        throw new JiraDispatchError('Approved membership version changed before dispatch', 'MEMBERSHIP_VERSION_STALE');
      }
      if (scope.expectedIdentityVersion !== undefined && leaseInit.identity_version !== scope.expectedIdentityVersion) {
        throw new JiraDispatchError('Approved identity version changed before dispatch', 'IDENTITY_VERSION_STALE');
      }
      if (scope.expectedWorkspaceVersion !== undefined && leaseInit.workspace_version !== scope.expectedWorkspaceVersion) {
        throw new JiraDispatchError('Approved workspace version changed before dispatch', 'WORKSPACE_VERSION_STALE');
      }

      // 2. Lock workspace FOR SHARE
      const wsRes = await client.query<{ status: string; version: number }>(
        `SELECT status, version FROM ati_workspaces WHERE id = $1 FOR SHARE`,
        [scope.workspaceId]
      );
      if (!wsRes.rows[0] || wsRes.rows[0].status !== 'active') {
        throw new JiraDispatchError('Workspace inactive or archived before dispatch', 'WORKSPACE_INACTIVE');
      }
      if (scope.expectedWorkspaceVersion !== undefined && wsRes.rows[0].version !== scope.expectedWorkspaceVersion) {
        throw new JiraDispatchError('Workspace version changed before dispatch', 'WORKSPACE_VERSION_STALE');
      }

      // 3. Lock dual-layer membership FOR SHARE (ati_workspace_memberships + workspace_members + users)
      const memRes = await client.query<{
        jira_member_status: string;
        membership_version: number;
        general_member_status: string;
        user_status: string;
      }>(
        `SELECT m.status AS jira_member_status, m.version AS membership_version,
                wm.status AS general_member_status,
                u.status AS user_status
         FROM ati_workspace_memberships m
         JOIN workspace_members wm ON wm.workspace_id = m.workspace_id AND wm.user_id = m.user_id
         JOIN users u ON u.id = m.user_id
         WHERE m.workspace_id = $1 AND m.user_id = $2
         FOR SHARE`,
        [scope.workspaceId, scope.userId]
      );
      const memRow = memRes.rows[0];
      if (
        !memRow ||
        memRow.jira_member_status !== 'active' ||
        memRow.general_member_status !== 'active' ||
        memRow.user_status !== 'active'
      ) {
        throw new JiraDispatchError('Membership is inactive or removed before dispatch', 'MEMBERSHIP_INACTIVE');
      }
      if (scope.expectedMembershipVersion !== undefined && memRow.membership_version !== scope.expectedMembershipVersion) {
        throw new JiraDispatchError('Approved membership version changed before dispatch', 'MEMBERSHIP_VERSION_STALE');
      }

      // 4. Lock Jira account FOR SHARE
      const targetAccountId = scope.expectedAccountId ?? leaseInit.jira_account_id;
      const accRes = await client.query<{
        id: string;
        atlassian_account_id: string;
        status: string;
        identity_version: number;
      }>(
        `SELECT id, atlassian_account_id, status, identity_version
         FROM jira_accounts
         WHERE id = $1 AND user_id = $2
         FOR SHARE`,
        [targetAccountId, scope.userId]
      );
      const accRow = accRes.rows[0];
      if (!accRow || accRow.status !== 'connected') {
        throw new JiraDispatchError('Jira account disconnected or inactive before dispatch', 'ACCOUNT_DISCONNECTED');
      }
      if (scope.expectedAtlassianAccountId && accRow.atlassian_account_id !== scope.expectedAtlassianAccountId) {
        throw new JiraDispatchError('Atlassian account mismatch before dispatch', 'ACCOUNT_MISMATCH');
      }
      if (scope.expectedIdentityVersion !== undefined && accRow.identity_version !== scope.expectedIdentityVersion) {
        throw new JiraDispatchError('Jira account identity version changed before dispatch', 'IDENTITY_VERSION_STALE');
      }

      // 5. Lock approved grant row FOR SHARE
      const activeGrantId = scope.expectedGrantId ?? leaseInit.grant_id;
      const grantRes = await client.query<{ status: string; account_id: string }>(
        `SELECT status, account_id FROM jira_oauth_grants WHERE id = $1 FOR SHARE`,
        [activeGrantId]
      );
      if (!grantRes.rows[0] || grantRes.rows[0].status !== 'active') {
        throw new JiraDispatchError('Approved grant is revoked or inactive before dispatch', 'GRANT_REVOKED');
      }

      // 6. Lock grant site access FOR SHARE
      const grantSiteRes = await client.query<{ id: string }>(
        `SELECT id FROM jira_grant_sites
         WHERE grant_id = $1 AND cloud_id = $2 AND product_type = 'jira'
         FOR SHARE`,
        [activeGrantId, scope.cloudId]
      );
      if (!grantSiteRes.rows[0]) {
        throw new JiraDispatchError('Site access revoked from grant before dispatch', 'SITE_ACCESS_REVOKED');
      }

      // 7. Lock site policy FOR SHARE
      const siteRes = await client.query<{ id: string; active: boolean; policy_version: number }>(
        `SELECT id, active, policy_version
         FROM ati_workspace_jira_sites
         WHERE workspace_id = $1 AND cloud_id = $2 FOR SHARE`,
        [scope.workspaceId, scope.cloudId]
      );
      const siteRow = siteRes.rows[0];
      if (!siteRow || !siteRow.active) {
        throw new JiraDispatchError('Site inactive or removed before dispatch', 'SITE_INACTIVE');
      }
      if (scope.sitePolicyVersion !== undefined && siteRow.policy_version !== scope.sitePolicyVersion) {
        throw new JiraDispatchError('Site policy version changed before dispatch', 'SITE_POLICY_STALE');
      }

      // 8. Lock project policy FOR SHARE if projectId is provided
      if (scope.projectId) {
        const projRes = await client.query<{ selected: boolean; policy_version: number }>(
          `SELECT selected, policy_version
           FROM ati_workspace_jira_projects
           WHERE workspace_id = $1 AND site_id = $2 AND numeric_project_id = $3 FOR SHARE`,
          [scope.workspaceId, siteRow.id, scope.projectId]
        );
        const projRow = projRes.rows[0];
        if (!projRow || !projRow.selected) {
          throw new JiraDispatchError('Project not selected before dispatch', 'PROJECT_NOT_SELECTED');
        }
        if (scope.projectPolicyVersion !== undefined && projRow.policy_version !== scope.projectPolicyVersion) {
          throw new JiraDispatchError('Project policy version changed before dispatch', 'PROJECT_POLICY_STALE');
        }
      }

      // 9. Lock lease row FOR UPDATE LAST to linearize against concurrent disconnect/markRevoked
      const leaseRes = await client.query<{
        status: string;
        expired: boolean;
      }>(
        `SELECT status, expires_at <= clock_timestamp() AS expired
         FROM jira_authorization_leases
         WHERE lease_id = $1 FOR UPDATE`,
        [lease.leaseId]
      );
      const leaseRow = leaseRes.rows[0];
      if (!leaseRow || leaseRow.status !== 'active' || leaseRow.expired) {
        throw new JiraDispatchError('Lease expired or revoked before dispatch lock', 'LEASE_INVALID');
      }

      // Step 5: Execute dispatch function holding the lock
      let result: T;
      try {
        result = await dispatchFn(token, abortController.signal);
      } catch (dispatchErr: any) {
        // Dispatch failed or timed out. Rollback hold and rethrow.
        await client.query('ROLLBACK').catch(() => {});
        committed = true;
        throw dispatchErr;
      }

      // Step 6: Dispatch succeeded. Commit hold.
      if (!options.deferRelease) {
        await client.query(
          `UPDATE jira_authorization_leases
           SET status = 'released', released_at = clock_timestamp()
           WHERE lease_id = $1`,
          [lease.leaseId]
        );
      }
      await client.query('COMMIT');
      committed = true;

      if (result && typeof result === 'object') {
        Object.defineProperty(result, '_leaseId', {
          value: lease.leaseId,
          enumerable: false,
          writable: true,
          configurable: true,
        });
        Object.defineProperty(result, '_leaseBinding', {
          value: lease.binding,
          enumerable: false,
          writable: true,
          configurable: true,
        });
      }

      return result;
    } catch (err: any) {
      if (!committed) {
        await client.query('ROLLBACK').catch(() => {});
      }
      throw err;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (options.signal) {
        options.signal.removeEventListener('abort', onExternalAbort);
      }
      client.release();
    }
  }
}
