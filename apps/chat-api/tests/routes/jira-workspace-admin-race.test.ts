import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { UserRepo } from '../../src/db/repositories/user-repo.js';
import { SessionRepo } from '../../src/db/repositories/session-repo.js';
import WorkspaceRepo from '../../src/db/repositories/workspace/index.js';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  waitForBlockedQueries,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';

interface TestActor {
  id: string;
  email: string;
  name: string;
  sid: string;
  token: string;
}

function firstRow<T extends pg.QueryResultRow>(result: pg.QueryResult<T>): T {
  const row = result.rows[0];
  if (!row) {
    throw new Error('Expected query to return at least one row, but rows array was empty');
  }
  return row;
}

describe('apps/chat-api — JIRA-03 Workspace Admin Cross-Layer Race Conditions', () => {
  let ctx: IsolatedTestContext;
  let userRepo: UserRepo;
  let sessionRepo: SessionRepo;
  let workerAppName: string;
  let workerPool: pg.Pool;
  let workspaceRepo: WorkspaceRepo;
  let app: ReturnType<typeof createApp>;

  const jwtSecret = 'test_jwt_secret_admin_race_at_least_32_bytes_long';

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 10 });
    await ctx.runAllMigrations();

    userRepo = new UserRepo(ctx.pool);
    sessionRepo = new SessionRepo(ctx.pool);

    workerAppName = `ws_adm_race_${randomUUID().slice(0, 8)}`;
    workerPool = ctx.createWorkerPool({ max: 2, applicationName: workerAppName });
    workspaceRepo = new WorkspaceRepo(workerPool);

    app = createApp({
      jwtSecret,
      userRepo,
      sessionRepo,
      authClock: () => Date.now(),
      runtimeMode: 'sandbox',
      jiraWorkspaceRepo: workspaceRepo,
    });
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  async function createActor(name: string, prefix: string): Promise<TestActor> {
    const userId = await createSyntheticUser(ctx.pool, name, prefix, { role: 'member', status: 'active' });
    const userRow = firstRow(
      await ctx.pool.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId])
    );
    const { sessionId } = await sessionRepo.create(userId, 'test-agent');
    const token = generateAccessToken(
      { id: userId, email: userRow.email, name, role: 'member', status: 'active' },
      jwtSecret,
      sessionId
    ).accessToken;

    return { id: userId, email: userRow.email, name, sid: sessionId, token };
  }

  async function seedWorkspace(name: string, slug: string, createdBy: string): Promise<string> {
    const wsId = randomUUID();
    const inviteCode = `ATI-${randomUUID().slice(0, 4).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
    await ctx.pool.query(
      `INSERT INTO workspaces (id, name, invite_code, created_by)
       VALUES ($1, $2, $3, $4)`,
      [wsId, name, inviteCode, createdBy]
    );
    await ctx.pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status)
       VALUES ($1, $2, 'admin', 'active')`,
      [wsId, createdBy]
    );
    const res = await ctx.pool.query<{ id: string }>(
      `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
       VALUES ($1, $2, 'active', 1, $3)
       RETURNING id`,
      [wsId, slug, createdBy]
    );
    return firstRow(res).id;
  }

  async function seedMembership(
    workspaceId: string,
    userId: string,
    role: 'admin' | 'member',
    status: 'pending' | 'active' | 'rejected' | 'removed',
    version = 1
  ): Promise<void> {
    await ctx.pool.query(
      `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version, requested_at, decided_at)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp(), clock_timestamp())`,
      [workspaceId, userId, role, status, version]
    );
  }

  it('positive control: active admin without disable mutation successfully invokes admin operations', async () => {
    const adminActor = await createActor('Active Admin', 'ctrl_admin');
    const workspaceId = await seedWorkspace('Control WS', `ws-ctrl-${randomUUID().slice(0, 8)}`, adminActor.id);
    await seedMembership(workspaceId, adminActor.id, 'admin', 'active', 1);

    const targetActor = await createActor('Target User', 'ctrl_target');
    await ctx.pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status)
       VALUES ($1, $2, 'member', 'active')`,
      [workspaceId, targetActor.id]
    );
    await seedMembership(workspaceId, targetActor.id, 'member', 'pending', 1);

    // 1. Create invite (POST /api/jira-workspaces/:id/invites)
    const inviteRes = await request(app)
      .post(`/api/jira-workspaces/${workspaceId}/invites`)
      .set('Authorization', `Bearer ${adminActor.token}`)
      .send({ expiresInDays: 7 });
    expect(inviteRes.status).toBe(201);
    expect(inviteRes.body).toHaveProperty('inviteToken');

    // 2. Decide member (POST /api/jira-workspaces/:id/members/:userId/decision)
    const decisionRes = await request(app)
      .post(`/api/jira-workspaces/${workspaceId}/members/${targetActor.id}/decision`)
      .set('Authorization', `Bearer ${adminActor.token}`)
      .send({ expectedVersion: 1, decision: 'approve' });
    expect(decisionRes.status).toBe(200);
    expect(decisionRes.body).toEqual({
      status: 'active',
      version: 2,
    });

    // Verify DB target membership row
    const targetMemInDb = firstRow(
      await ctx.pool.query<{ status: string; version: number }>(
        'SELECT status, version FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, targetActor.id]
      )
    );
    expect(targetMemInDb).toEqual({
      status: 'active',
      version: 2,
    });

    // 3. List members (GET /api/jira-workspaces/:id/members)
    const listRes = await request(app)
      .get(`/api/jira-workspaces/${workspaceId}/members`)
      .set('Authorization', `Bearer ${adminActor.token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.members).toHaveLength(2);
  }, 15_000);

  it('createInvite: actor disabled during workspace lock wait returns 404 WORKSPACE_NOT_FOUND without creating invite or audit', async () => {
    const adminActor = await createActor('Invite Admin', 'race_inv_admin');
    const workspaceId = await seedWorkspace('Invite WS', `ws-inv-${randomUUID().slice(0, 8)}`, adminActor.id);
    await seedMembership(workspaceId, adminActor.id, 'admin', 'active', 1);

    const barrierClient = await ctx.pool.connect();
    let barrierReleased = false;
    let requestPromise: Promise<request.Response> | null = null;
    let allSettledPromise: Promise<[PromiseSettledResult<request.Response>]> | null = null;

    try {
      await barrierClient.query('BEGIN');
      await barrierClient.query('SELECT id FROM ati_workspaces WHERE id = $1 FOR UPDATE', [workspaceId]);

      // Launch actual HTTP request; attach Promise.allSettled immediately so Supertest starts
      requestPromise = request(app)
        .post(`/api/jira-workspaces/${workspaceId}/invites`)
        .set('Authorization', `Bearer ${adminActor.token}`)
        .send({ expiresInDays: 7 });
      allSettledPromise = Promise.allSettled([requestPromise]);

      // Wait pg_locks/pg_stat_activity for the exact WorkspaceRepo tagged connection blocked on workspace lock
      await waitForBlockedQueries(ctx.pool, [workerAppName], 5000);

      // While blocked, independent SQL UPDATE users SET status='disabled' for actor and commit
      await ctx.pool.query("UPDATE users SET status = 'disabled' WHERE id = $1", [adminActor.id]);

      // Release workspace barrier
      await barrierClient.query('COMMIT');
      barrierReleased = true;

      const [settled] = await allSettledPromise;
      if (settled.status === 'rejected') {
        throw settled.reason;
      }
      const res = settled.value;

      // Expect private 404 WORKSPACE_NOT_FOUND
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        code: 'WORKSPACE_NOT_FOUND',
      });

      // Verify no DB mutations occurred
      const inviteCountRes = await ctx.pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM ati_workspace_invites WHERE workspace_id = $1',
        [workspaceId]
      );
      expect(firstRow(inviteCountRes).count).toBe('0');

      const auditCountRes = await ctx.pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM jira_authorization_audit WHERE workspace_id = $1',
        [workspaceId]
      );
      expect(firstRow(auditCountRes).count).toBe('0');

      const wsRes = await ctx.pool.query<{ version: number }>(
        'SELECT version FROM ati_workspaces WHERE id = $1',
        [workspaceId]
      );
      expect(firstRow(wsRes).version).toBe(1);
    } finally {
      if (!barrierReleased) {
        try {
          await barrierClient.query('ROLLBACK');
        } catch {
          // Ignore rollback error in cleanup
        }
      }
      barrierClient.release();
      if (allSettledPromise) {
        try {
          await allSettledPromise;
        } catch {
          // Ignore drain error in cleanup
        }
      }
    }
  }, 15_000);

  it('decideMember: actor disabled during workspace lock wait returns 404 WORKSPACE_NOT_FOUND without mutating membership or audit', async () => {
    const adminActor = await createActor('Decide Admin', 'race_dec_admin');
    const workspaceId = await seedWorkspace('Decide WS', `ws-dec-${randomUUID().slice(0, 8)}`, adminActor.id);
    await seedMembership(workspaceId, adminActor.id, 'admin', 'active', 1);

    const targetActor = await createActor('Pending Member', 'race_target');
    await ctx.pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status)
       VALUES ($1, $2, 'member', 'active')`,
      [workspaceId, targetActor.id]
    );
    await seedMembership(workspaceId, targetActor.id, 'member', 'pending', 1);

    // Read full target membership baseline before race
    const baselineMemRes = await ctx.pool.query<{
      status: string;
      version: number;
      decided_at: Date | null;
      decided_by: string | null;
    }>(
      'SELECT status, version, decided_at, decided_by FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, targetActor.id]
    );
    const baselineMem = firstRow(baselineMemRes);
    expect(baselineMem.status).toBe('pending');
    expect(baselineMem.version).toBe(1);

    const barrierClient = await ctx.pool.connect();
    let barrierReleased = false;
    let requestPromise: Promise<request.Response> | null = null;
    let allSettledPromise: Promise<[PromiseSettledResult<request.Response>]> | null = null;

    try {
      await barrierClient.query('BEGIN');
      await barrierClient.query('SELECT id FROM ati_workspaces WHERE id = $1 FOR UPDATE', [workspaceId]);

      // Launch actual HTTP request; attach Promise.allSettled immediately so Supertest starts
      requestPromise = request(app)
        .post(`/api/jira-workspaces/${workspaceId}/members/${targetActor.id}/decision`)
        .set('Authorization', `Bearer ${adminActor.token}`)
        .send({ expectedVersion: 1, decision: 'approve' });
      allSettledPromise = Promise.allSettled([requestPromise]);

      // Wait pg_locks/pg_stat_activity for the exact WorkspaceRepo tagged connection blocked on workspace lock
      await waitForBlockedQueries(ctx.pool, [workerAppName], 5000);

      // While blocked, independent SQL UPDATE users SET status='disabled' for actor and commit
      await ctx.pool.query("UPDATE users SET status = 'disabled' WHERE id = $1", [adminActor.id]);

      // Release workspace barrier
      await barrierClient.query('COMMIT');
      barrierReleased = true;

      const [settled] = await allSettledPromise;
      if (settled.status === 'rejected') {
        throw settled.reason;
      }
      const res = settled.value;

      // Expect private 404 WORKSPACE_NOT_FOUND
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        code: 'WORKSPACE_NOT_FOUND',
      });

      // Verify target membership remains unchanged from baseline
      const targetMemRes = await ctx.pool.query<{
        status: string;
        version: number;
        decided_at: Date | null;
        decided_by: string | null;
      }>(
        'SELECT status, version, decided_at, decided_by FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, targetActor.id]
      );
      const targetMem = firstRow(targetMemRes);
      expect(targetMem.status).toBe('pending');
      expect(targetMem.version).toBe(1);
      expect(targetMem.decided_at).toEqual(baselineMem.decided_at);
      expect(targetMem.decided_by).toEqual(baselineMem.decided_by);

      const auditCountRes = await ctx.pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM jira_authorization_audit WHERE workspace_id = $1',
        [workspaceId]
      );
      expect(firstRow(auditCountRes).count).toBe('0');

      const wsRes = await ctx.pool.query<{ version: number }>(
        'SELECT version FROM ati_workspaces WHERE id = $1',
        [workspaceId]
      );
      expect(firstRow(wsRes).version).toBe(1);
    } finally {
      if (!barrierReleased) {
        try {
          await barrierClient.query('ROLLBACK');
        } catch {
          // Ignore rollback error in cleanup
        }
      }
      barrierClient.release();
      if (allSettledPromise) {
        try {
          await allSettledPromise;
        } catch {
          // Ignore drain error in cleanup
        }
      }
    }
  }, 15_000);

  it('listMembers: actor disabled during workspace lock wait returns 404 WORKSPACE_NOT_FOUND and discloses no member data', async () => {
    const adminActor = await createActor('List Admin', 'race_lst_admin');
    const workspaceId = await seedWorkspace('List WS', `ws-lst-${randomUUID().slice(0, 8)}`, adminActor.id);
    await seedMembership(workspaceId, adminActor.id, 'admin', 'active', 1);

    const otherMember = await createActor('Existing Member', 'race_lst_other');
    await ctx.pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status)
       VALUES ($1, $2, 'member', 'active')`,
      [workspaceId, otherMember.id]
    );
    await seedMembership(workspaceId, otherMember.id, 'member', 'active', 1);

    const barrierClient = await ctx.pool.connect();
    let barrierReleased = false;
    let requestPromise: Promise<request.Response> | null = null;
    let allSettledPromise: Promise<[PromiseSettledResult<request.Response>]> | null = null;

    try {
      await barrierClient.query('BEGIN');
      await barrierClient.query('SELECT id FROM ati_workspaces WHERE id = $1 FOR UPDATE', [workspaceId]);

      // Launch actual HTTP request; attach Promise.allSettled immediately so Supertest starts
      requestPromise = request(app)
        .get(`/api/jira-workspaces/${workspaceId}/members`)
        .set('Authorization', `Bearer ${adminActor.token}`);
      allSettledPromise = Promise.allSettled([requestPromise]);

      // Wait pg_locks/pg_stat_activity for the exact WorkspaceRepo tagged connection blocked on workspace lock
      await waitForBlockedQueries(ctx.pool, [workerAppName], 5000);

      // While blocked, independent SQL UPDATE users SET status='disabled' for actor and commit
      await ctx.pool.query("UPDATE users SET status = 'disabled' WHERE id = $1", [adminActor.id]);

      // Release workspace barrier
      await barrierClient.query('COMMIT');
      barrierReleased = true;

      const [settled] = await allSettledPromise;
      if (settled.status === 'rejected') {
        throw settled.reason;
      }
      const res = settled.value;

      // Expect private 404 WORKSPACE_NOT_FOUND
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        code: 'WORKSPACE_NOT_FOUND',
      });
      expect(res.body).not.toHaveProperty('members');

      const wsRes = await ctx.pool.query<{ version: number }>(
        'SELECT version FROM ati_workspaces WHERE id = $1',
        [workspaceId]
      );
      expect(firstRow(wsRes).version).toBe(1);
    } finally {
      if (!barrierReleased) {
        try {
          await barrierClient.query('ROLLBACK');
        } catch {
          // Ignore rollback error in cleanup
        }
      }
      barrierClient.release();
      if (allSettledPromise) {
        try {
          await allSettledPromise;
        } catch {
          // Ignore drain error in cleanup
        }
      }
    }
  }, 15_000);
});
