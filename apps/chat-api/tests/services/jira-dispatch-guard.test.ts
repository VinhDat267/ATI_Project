import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  connectSyntheticJiraAccount,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';
import { JiraLeaseManager } from '../../src/services/jira/jira-lease-manager.js';
import {
  JiraDispatchGuard,
  JiraDispatchError,
  type DispatchScope,
} from '../../src/services/jira/jira-dispatch-guard.js';

interface TestFixtureContext {
  userId: string;
  workspaceId: string;
  accountId: string;
  grantId: string;
  cloudId: string;
  siteId: string;
  projectId: string;
  projectKey: string;
}

describe('Jira Dispatch Guard & Revocation Linearization (JIRA-08 Task 3 Real PostgreSQL Tests)', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;
  let server: http.Server;
  let serverPort: number;
  let serverUrl: string;
  let httpCallCount = 0;
  let httpHoldDelayMs = 0;

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema();
    await ctx.runAllMigrations();
    pool = ctx.pool;

    server = http.createServer((req, res) => {
      httpCallCount++;
      const delay = httpHoldDelayMs;
      if (delay > 0) {
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, callIndex: httpCallCount }));
        }, delay);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, callIndex: httpCallCount }));
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        serverUrl = `http://127.0.0.1:${serverPort}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await ctx.cleanup();
  });

  async function createFixture(prefix = 'disp'): Promise<TestFixtureContext> {
    const userId = await createSyntheticUser(pool, `User ${prefix}`, `user_${prefix}`);
    const atlassianAccountId = `atlassian-${randomUUID()}`;
    const accountId = await connectSyntheticJiraAccount(pool, userId, atlassianAccountId);

    const grantRes = await pool.query<{ id: string }>(
      `INSERT INTO jira_oauth_grants (
        account_id, app_client_id, grant_kind, refresh_state, status, token_version
      ) VALUES ($1, 'atlassian_3lo', '3lo', 'idle', 'active', 1)
      RETURNING id`,
      [accountId]
    );
    const grantId = grantRes.rows[0]!.id;

    const cloudId = `cloud-${randomUUID().slice(0, 8)}`;
    await pool.query(
      `INSERT INTO jira_grant_sites (
        grant_id, cloud_id, site_name, site_url, product_type, scopes, last_verified_at
      ) VALUES ($1, $2, $3, $4, 'jira', $5, clock_timestamp())`,
      [
        grantId,
        cloudId,
        `Site ${prefix}`,
        `https://${prefix}.atlassian.net`,
        ['read:jira-work', 'write:jira-work'],
      ]
    );

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

    const siteRes = await pool.query<{ id: string }>(
      `INSERT INTO ati_workspace_jira_sites (
        workspace_id, cloud_id, site_name, site_url, active, policy_version, linked_by, verified_admin_by, admin_verified_at
      ) VALUES ($1, $2, $3, $4, true, 1, $5, $5, clock_timestamp())
      RETURNING id`,
      [workspaceId, cloudId, `Site ${prefix}`, `https://${prefix}.atlassian.net`, userId]
    );
    const siteId = siteRes.rows[0]!.id;

    const projectId = '10001';
    const projectKey = 'PROJ';
    await pool.query(
      `INSERT INTO ati_workspace_jira_projects (
        workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name, selected, policy_version
      ) VALUES ($1, $2, $3, $4, $5, $6, true, 1)`,
      [workspaceId, siteId, cloudId, projectId, projectKey, 'Test Project']
    );

    return {
      userId,
      workspaceId,
      accountId,
      grantId,
      cloudId,
      siteId,
      projectId,
      projectKey,
    };
  }

  it('read dispatch: revoke wins before dispatch => zero HTTP calls', async () => {
    httpCallCount = 0;
    httpHoldDelayMs = 0;
    const f = await createFixture('read_rev_wins');

    const tokenManager = {
      getAccessToken: async () => 'test-token',
    };
    const leaseManager = new JiraLeaseManager({ pool, tokenManager });
    const guard = new JiraDispatchGuard(pool, leaseManager, tokenManager);

    const scope: DispatchScope = {
      userId: f.userId,
      workspaceId: f.workspaceId,
      cloudId: f.cloudId,
      siteId: f.siteId,
      projectId: f.projectId,
      sitePolicyVersion: 1,
      projectPolicyVersion: 1,
    };

    // Client 2: Revocation commits BEFORE dispatch claim
    const client2Pool = ctx.createWorkerPool({ max: 1, applicationName: 'client2_revoker' });
    try {
      await client2Pool.query(
        `UPDATE ati_workspace_jira_sites SET active = false, policy_version = policy_version + 1 WHERE id = $1`,
        [f.siteId]
      );
    } finally {
      await client2Pool.end();
    }

    // Client 1 attempts dispatch: MUST fail closed with 0 HTTP calls
    await expect(
      guard.executeGuardedDispatch(
        scope,
        { isWrite: false, timeoutMs: 5000 },
        async (token, signal) => {
          const res = await fetch(`${serverUrl}/read`, { signal, headers: { Authorization: `Bearer ${token}` } });
          return res.json();
        }
      )
    ).rejects.toThrow(JiraDispatchError);

    expect(httpCallCount).toBe(0);
  });

  it('write dispatch: revoke wins before dispatch => zero HTTP calls', async () => {
    httpCallCount = 0;
    httpHoldDelayMs = 0;
    const f = await createFixture('write_rev_wins');

    const tokenManager = {
      getAccessToken: async () => 'test-token',
    };
    const leaseManager = new JiraLeaseManager({ pool, tokenManager });
    const guard = new JiraDispatchGuard(pool, leaseManager, tokenManager);

    const scope: DispatchScope = {
      userId: f.userId,
      workspaceId: f.workspaceId,
      cloudId: f.cloudId,
      siteId: f.siteId,
      projectId: f.projectId,
      sitePolicyVersion: 1,
      projectPolicyVersion: 1,
    };

    // Client 2: Revoke grant before write dispatch
    const client2Pool = ctx.createWorkerPool({ max: 1, applicationName: 'client2_revoker' });
    try {
      await client2Pool.query(
        `UPDATE jira_oauth_grants SET status = 'revoked' WHERE id = $1`,
        [f.grantId]
      );
    } finally {
      await client2Pool.end();
    }

    await expect(
      guard.executeGuardedDispatch(
        scope,
        { isWrite: true, timeoutMs: 5000 },
        async (token, signal) => {
          const res = await fetch(`${serverUrl}/write`, {
            method: 'POST',
            signal,
            headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({ summary: 'Write Test' }),
          });
          return res.json();
        }
      )
    ).rejects.toThrow(JiraDispatchError);

    expect(httpCallCount).toBe(0);
  });

  it('read dispatch: dispatch wins => revoke waits/commits after dispatch boundary', async () => {
    httpCallCount = 0;
    httpHoldDelayMs = 150; // Hold HTTP for 150ms
    const f = await createFixture('read_disp_wins');

    const tokenManager = {
      getAccessToken: async () => 'test-token',
    };
    const leaseManager = new JiraLeaseManager({ pool, tokenManager });
    const guard = new JiraDispatchGuard(pool, leaseManager, tokenManager);

    const scope: DispatchScope = {
      userId: f.userId,
      workspaceId: f.workspaceId,
      cloudId: f.cloudId,
      siteId: f.siteId,
      projectId: f.projectId,
      sitePolicyVersion: 1,
      projectPolicyVersion: 1,
    };

    const completionOrder: string[] = [];

    // Client 1: Launch dispatch
    const dispatchPromise = guard
      .executeGuardedDispatch(
        scope,
        { isWrite: false, timeoutMs: 5000 },
        async (token, signal) => {
          const res = await fetch(`${serverUrl}/read`, { signal, headers: { Authorization: `Bearer ${token}` } });
          const json = await res.json();
          completionOrder.push('dispatch_done');
          return json;
        }
      )
      .then((res) => {
        completionOrder.push('dispatch_completed');
        return res;
      });

    // Wait 30ms to guarantee dispatch transaction has claimed the row
    await new Promise((r) => setTimeout(r, 30));

    // Client 2: Revoker worker attempts markRevoked on separate connection
    const client2Pool = ctx.createWorkerPool({ max: 1, applicationName: 'client2_revoker' });
    const revokePromise = (async () => {
      const client2 = await client2Pool.connect();
      try {
        await client2.query('BEGIN');
        await client2.query(
          `UPDATE jira_authorization_leases SET status = 'revoked', released_at = clock_timestamp()
           WHERE workspace_id = $1 AND status = 'active'`,
          [f.workspaceId]
        );
        await client2.query('COMMIT');
        completionOrder.push('revoke_committed');
      } finally {
        client2.release();
        await client2Pool.end();
      }
    })();

    const [dispatchResult] = await Promise.all([dispatchPromise, revokePromise]);
    expect(dispatchResult).toEqual({ ok: true, callIndex: 1 });
    expect(httpCallCount).toBe(1);

    // Verify ordering: dispatch completed before revoke committed
    expect(completionOrder.indexOf('dispatch_done')).toBeLessThan(completionOrder.indexOf('revoke_committed'));
  });

  it('write dispatch: dispatch wins => revoke waits/commits after dispatch boundary', async () => {
    httpCallCount = 0;
    httpHoldDelayMs = 150; // Hold HTTP for 150ms
    const f = await createFixture('write_disp_wins');

    const tokenManager = {
      getAccessToken: async () => 'test-token',
    };
    const leaseManager = new JiraLeaseManager({ pool, tokenManager });
    const guard = new JiraDispatchGuard(pool, leaseManager, tokenManager);

    const scope: DispatchScope = {
      userId: f.userId,
      workspaceId: f.workspaceId,
      cloudId: f.cloudId,
      siteId: f.siteId,
      projectId: f.projectId,
      sitePolicyVersion: 1,
      projectPolicyVersion: 1,
    };

    const completionOrder: string[] = [];

    const dispatchPromise = guard
      .executeGuardedDispatch(
        scope,
        { isWrite: true, timeoutMs: 5000 },
        async (token, signal) => {
          const res = await fetch(`${serverUrl}/write`, {
            method: 'POST',
            signal,
            headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({ issue: 'Create' }),
          });
          const json = await res.json();
          completionOrder.push('write_done');
          return json;
        }
      )
      .then((res) => {
        completionOrder.push('write_completed');
        return res;
      });

    await new Promise((r) => setTimeout(r, 30));

    const client2Pool = ctx.createWorkerPool({ max: 1, applicationName: 'client2_write_revoker' });
    const revokePromise = (async () => {
      const client2 = await client2Pool.connect();
      try {
        await client2.query('BEGIN');
        await client2.query(
          `UPDATE jira_authorization_leases SET status = 'revoked', released_at = clock_timestamp()
           WHERE workspace_id = $1 AND status = 'active'`,
          [f.workspaceId]
        );
        await client2.query('COMMIT');
        completionOrder.push('write_revoke_committed');
      } finally {
        client2.release();
        await client2Pool.end();
      }
    })();

    const [dispatchResult] = await Promise.all([dispatchPromise, revokePromise]);
    expect(dispatchResult).toEqual({ ok: true, callIndex: 1 });
    expect(httpCallCount).toBe(1);

    expect(completionOrder.indexOf('write_done')).toBeLessThan(completionOrder.indexOf('write_revoke_committed'));
  });

  it('stalled HTTP respects deadline and abort signal, releasing lock cleanly', async () => {
    httpCallCount = 0;
    httpHoldDelayMs = 2000; // Server delays for 2 seconds (stalled)
    const f = await createFixture('stalled_http');

    const tokenManager = {
      getAccessToken: async () => 'test-token',
    };
    const leaseManager = new JiraLeaseManager({ pool, tokenManager });
    const guard = new JiraDispatchGuard(pool, leaseManager, tokenManager);

    const scope: DispatchScope = {
      userId: f.userId,
      workspaceId: f.workspaceId,
      cloudId: f.cloudId,
      siteId: f.siteId,
      projectId: f.projectId,
      sitePolicyVersion: 1,
      projectPolicyVersion: 1,
    };

    const start = Date.now();
    // Timeout of 100ms
    await expect(
      guard.executeGuardedDispatch(
        scope,
        { isWrite: false, timeoutMs: 100 },
        async (token, signal) => {
          const res = await fetch(`${serverUrl}/stalled`, { signal, headers: { Authorization: `Bearer ${token}` } });
          return res.json();
        }
      )
    ).rejects.toThrow();

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1500); // Must abort quickly around 100ms, not wait 2s

    // Revocation on Client 2 must complete immediately without blocking
    const client2Pool = ctx.createWorkerPool({ max: 1, applicationName: 'client2_after_stall' });
    try {
      const revokedCount = await leaseManager.markRevoked({ workspaceId: f.workspaceId });
      expect(revokedCount).toBeDefined();
    } finally {
      await client2Pool.end();
    }
  });

  it('grant rotation does not deadlock with concurrent dispatch', async () => {
    httpHoldDelayMs = 50;
    const f = await createFixture('rotation_deadlock');

    const tokenManager = {
      getAccessToken: async () => 'test-token',
    };
    const leaseManager = new JiraLeaseManager({ pool, tokenManager });
    const guard = new JiraDispatchGuard(pool, leaseManager, tokenManager);

    const scope: DispatchScope = {
      userId: f.userId,
      workspaceId: f.workspaceId,
      cloudId: f.cloudId,
      siteId: f.siteId,
      projectId: f.projectId,
      sitePolicyVersion: 1,
      projectPolicyVersion: 1,
    };

    // Client 1 runs dispatch
    const dispatchPromise = guard.executeGuardedDispatch(
      scope,
      { isWrite: false, timeoutMs: 5000 },
      async (token, signal) => {
        const res = await fetch(`${serverUrl}/read`, { signal, headers: { Authorization: `Bearer ${token}` } });
        return res.json();
      }
    );

    // Client 2 runs concurrent grant rotation
    const client2Pool = ctx.createWorkerPool({ max: 1, applicationName: 'client2_rotator' });
    const rotationPromise = (async () => {
      const client2 = await client2Pool.connect();
      try {
        await client2.query('BEGIN');
        await client2.query(
          `UPDATE jira_oauth_grants
           SET token_version = token_version + 1,
               encrypted_access_token = 'new_token',
               updated_at = clock_timestamp()
           WHERE id = $1`,
          [f.grantId]
        );
        await client2.query('COMMIT');
      } finally {
        client2.release();
        await client2Pool.end();
      }
    })();

    await expect(Promise.all([dispatchPromise, rotationPromise])).resolves.toBeDefined();
  });

  it('rejects dispatch if active grant changes from the approved grantId (grant mismatch)', async () => {
    httpHoldDelayMs = 0;
    const f = await createFixture('grant_mismatch');

    const tokenManager = {
      getAccessToken: async () => 'test-token',
    };
    const leaseManager = new JiraLeaseManager({ pool, tokenManager });
    const guard = new JiraDispatchGuard(pool, leaseManager, tokenManager);

    // Simulate grant revocation and creation of a new active grant
    await pool.query(
      `UPDATE jira_oauth_grants SET status = 'revoked' WHERE id = $1`,
      [f.grantId]
    );

    const newGrantRes = await pool.query<{ id: string }>(
      `INSERT INTO jira_oauth_grants (
        account_id, app_client_id, grant_kind, refresh_state, status, token_version
      ) VALUES ($1, 'atlassian_3lo', '3lo', 'idle', 'active', 1)
      RETURNING id`,
      [f.accountId]
    );
    const newGrantId = newGrantRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO jira_grant_sites (
        grant_id, cloud_id, site_name, site_url, product_type, scopes, last_verified_at
      ) VALUES ($1, $2, $3, $4, 'jira', $5, clock_timestamp())`,
      [
        newGrantId,
        f.cloudId,
        'Site grant_mismatch',
        'https://mismatch.atlassian.net',
        ['read:jira-work', 'write:jira-work'],
      ]
    );

    // Dispatch scope expects the OLD approved grantId f.grantId
    const scope: DispatchScope = {
      userId: f.userId,
      workspaceId: f.workspaceId,
      cloudId: f.cloudId,
      siteId: f.siteId,
      projectId: f.projectId,
      sitePolicyVersion: 1,
      projectPolicyVersion: 1,
      expectedGrantId: f.grantId,
      expectedAccountId: f.accountId,
    };

    let dispatchCalled = false;
    await expect(
      guard.executeGuardedDispatch(
        scope,
        { isWrite: false, timeoutMs: 5000 },
        async () => {
          dispatchCalled = true;
          return { ok: true };
        }
      )
    ).rejects.toThrow(/Approved grant|grant mismatch|GRANT_MISMATCH/i);

    expect(dispatchCalled).toBe(false);
  });

  it('revoking membership after acquireLease blocks outbound dispatch at guard boundary', async () => {
    const f = await createFixture('mem_revoked_after_lease');

    const tokenManager = {
      getAccessToken: async () => 'test-token',
    };
    const realLeaseManager = new JiraLeaseManager({ pool, tokenManager });
    const client2Pool = ctx.createWorkerPool({ max: 1, applicationName: 'client2_mem_revoker' });

    // Spy on acquireLease to simulate a pause right after lease is committed,
    // where a second client revokes membership before dispatch lock transaction proceeds.
    const leaseManagerProxy = {
      acquireLease: async (scope: any) => {
        const lease = await realLeaseManager.acquireLease(scope);
        // Client 2 revokes membership immediately after lease is acquired
        await client2Pool.query(
          `UPDATE ati_workspace_memberships SET status = 'removed' WHERE workspace_id = $1 AND user_id = $2`,
          [f.workspaceId, f.userId]
        );
        return lease;
      },
    };

    const guard = new JiraDispatchGuard(pool, leaseManagerProxy as any, tokenManager);

    const scope: DispatchScope = {
      userId: f.userId,
      workspaceId: f.workspaceId,
      cloudId: f.cloudId,
      siteId: f.siteId,
      projectId: f.projectId,
      sitePolicyVersion: 1,
      projectPolicyVersion: 1,
      expectedGrantId: f.grantId,
      expectedAccountId: f.accountId,
    };

    let outboundCalled = false;
    try {
      await expect(
        guard.executeGuardedDispatch(
          scope,
          { isWrite: false, timeoutMs: 5000 },
          async () => {
            outboundCalled = true;
            return { ok: true };
          }
        )
      ).rejects.toThrow(/membership/i);

      expect(outboundCalled).toBe(false);
    } finally {
      await client2Pool.end();
    }
  });

  it('disconnecting account or revoking grant site after acquireLease blocks outbound dispatch', async () => {
    const f = await createFixture('acc_revoked_after_lease');

    const tokenManager = {
      getAccessToken: async () => 'test-token',
    };
    const realLeaseManager = new JiraLeaseManager({ pool, tokenManager });
    const client2Pool = ctx.createWorkerPool({ max: 1, applicationName: 'client2_acc_revoker' });

    const leaseManagerProxy = {
      acquireLease: async (scope: any) => {
        const lease = await realLeaseManager.acquireLease(scope);
        await client2Pool.query(
          `UPDATE jira_accounts SET status = 'disconnected' WHERE id = $1`,
          [f.accountId]
        );
        return lease;
      },
    };

    const guard = new JiraDispatchGuard(pool, leaseManagerProxy as any, tokenManager);

    const scope: DispatchScope = {
      userId: f.userId,
      workspaceId: f.workspaceId,
      cloudId: f.cloudId,
      siteId: f.siteId,
      projectId: f.projectId,
      sitePolicyVersion: 1,
      projectPolicyVersion: 1,
      expectedGrantId: f.grantId,
      expectedAccountId: f.accountId,
    };

    let outboundCalled = false;
    try {
      await expect(
        guard.executeGuardedDispatch(
          scope,
          { isWrite: false, timeoutMs: 5000 },
          async () => {
            outboundCalled = true;
            return { ok: true };
          }
        )
      ).rejects.toThrow(/account disconnected/i);

      expect(outboundCalled).toBe(false);
    } finally {
      await client2Pool.end();
    }
  });
});
