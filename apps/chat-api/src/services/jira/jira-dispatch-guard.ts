import type { Pool } from 'pg';
import type { JiraLeaseManager } from './jira-lease-manager.js';

export interface DispatchScope {
  userId: string;
  workspaceId: string;
  cloudId: string;
  siteId: string;
  projectId?: string;
  sitePolicyVersion?: number;
  projectPolicyVersion?: number;
}

export interface GuardedDispatchOptions {
  isWrite: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
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
    private readonly leaseManager: JiraLeaseManager,
    private readonly tokenManager: JiraDispatchTokenManager
  ) {}

  async executeGuardedDispatch<T>(
    scope: DispatchScope,
    options: GuardedDispatchOptions,
    dispatchFn: (token: string, signal: AbortSignal) => Promise<T>
  ): Promise<T> {
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

      // Lock lease row FOR UPDATE to linearize against concurrent markRevoked
      const leaseRes = await client.query<{ status: string; expired: boolean }>(
        `SELECT status, expires_at <= clock_timestamp() AS expired
         FROM jira_authorization_leases
         WHERE lease_id = $1 FOR UPDATE`,
        [lease.leaseId]
      );

      const leaseRow = leaseRes.rows[0];
      if (!leaseRow || leaseRow.status !== 'active' || leaseRow.expired) {
        throw new JiraDispatchError('Lease expired or revoked before dispatch lock', 'LEASE_INVALID');
      }

      // Check site policy FOR SHARE
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

      // Check project policy FOR SHARE if projectId is provided
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

      // Step 6: Dispatch succeeded. Transition lease to released and commit hold.
      await client.query(
        `UPDATE jira_authorization_leases
         SET status = 'released', released_at = clock_timestamp()
         WHERE lease_id = $1`,
        [lease.leaseId]
      );
      await client.query('COMMIT');
      committed = true;

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
