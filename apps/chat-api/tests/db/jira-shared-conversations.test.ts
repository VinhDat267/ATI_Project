import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  ConversationRepo,
  ConversationAccessError,
  type ConversationScope,
} from '../../src/db/repositories/conversation-repo.js';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  waitForBlockedQueries,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';

function firstRow<T extends pg.QueryResultRow>(res: pg.QueryResult<T>): T {
  const row = res.rows[0];
  if (!row) throw new Error('Expected query result to contain at least one row');
  return row;
}

describe('apps/chat-api — JIRA-03 Shared Organization Workspace Conversations Repository & Invariants', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;
  let convRepo: ConversationRepo;

  let aliceId: string;   // Active Org Member + Active Jira Member
  let bobId: string;     // Active Org Member ONLY (No Jira Membership)
  let charlieId: string; // Disabled Org Member + Active Jira Member
  let outsiderId: string;// Unaffiliated outsider

  let orgId: string;
  let org2Id: string;

  async function seedSharedWorkspace(
    name: string,
    slug: string,
    createdBy: string,
    jiraStatus = 'active'
  ): Promise<string> {
    const wsId = randomUUID();
    // 1. Shared organization workspace (workspaces table from PR #237)
    await pool.query(
      `INSERT INTO workspaces (id, name, invite_code, require_approval, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, false, $4, clock_timestamp(), clock_timestamp())`,
      [wsId, name, `INV-${wsId.slice(0, 8)}`.toUpperCase(), createdBy]
    );

    // 2. Jira workspace policy extension with matching UUID (ati_workspaces)
    await pool.query(
      `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
       VALUES ($1, $2, $3, 1, $4)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = clock_timestamp()`,
      [wsId, slug, jiraStatus, createdBy]
    );

    return wsId;
  }

  async function seedOrgMembership(
    workspaceId: string,
    userId: string,
    role: 'admin' | 'member' = 'member',
    status: 'pending' | 'active' | 'disabled' = 'active'
  ): Promise<void> {
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, clock_timestamp(), clock_timestamp())
       ON CONFLICT (workspace_id, user_id)
       DO UPDATE SET status = EXCLUDED.status, role = EXCLUDED.role, updated_at = clock_timestamp()`,
      [workspaceId, userId, role, status]
    );
  }

  async function seedJiraMembership(
    workspaceId: string,
    userId: string,
    role: 'admin' | 'member' = 'member',
    status: 'pending' | 'active' | 'rejected' | 'removed' = 'active'
  ): Promise<void> {
    await pool.query(
      `INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status, version)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (workspace_id, user_id)
       DO UPDATE SET status = EXCLUDED.status, role = EXCLUDED.role, updated_at = clock_timestamp()`,
      [workspaceId, userId, role, status]
    );
  }

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 12 });
    pool = ctx.pool;

    await ctx.runAllMigrations();
    convRepo = new ConversationRepo(pool);

    aliceId = await createSyntheticUser(pool, 'Alice Dual Member', 'alice', { role: 'member', status: 'active' });
    bobId = await createSyntheticUser(pool, 'Bob Org Member Only', 'bob', { role: 'member', status: 'active' });
    charlieId = await createSyntheticUser(pool, 'Charlie Disabled Org Member', 'charlie', { role: 'member', status: 'active' });
    outsiderId = await createSyntheticUser(pool, 'Dave Outsider', 'dave', { role: 'member', status: 'active' });

    orgId = await seedSharedWorkspace('Shared Acme Corp', `acme-${randomUUID().slice(0, 8)}`, aliceId, 'active');
    org2Id = await seedSharedWorkspace('Shared Beta Corp', `beta-${randomUUID().slice(0, 8)}`, aliceId, 'active');

    // Alice: active in Org and active in Jira
    await seedOrgMembership(orgId, aliceId, 'member', 'active');
    await seedJiraMembership(orgId, aliceId, 'member', 'active');

    // Bob: active in Org ONLY (no Jira membership)
    await seedOrgMembership(orgId, bobId, 'member', 'active');

    // Charlie: disabled in Org, active in Jira
    await seedOrgMembership(orgId, charlieId, 'member', 'disabled');
    await seedJiraMembership(orgId, charlieId, 'member', 'active');
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  // ==========================================================================
  // 1. Dual-Layer Creation & Scope Semantics
  // ==========================================================================
  describe('Dual-Layer Creation & Scope Semantics', () => {
    it('creates an ordinary organization conversation without requiring Jira membership', async () => {
      // Bob has active org membership, but no Jira membership
      const scope: ConversationScope & { jiraContext?: boolean } = {
        workspaceMode: 'organization',
        workspaceId: orgId,
        jiraContext: false,
      };

      const conv = await convRepo.createConversation(bobId, 'Regular Org Discussion', scope);

      expect(conv).toBeDefined();
      expect(conv.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(conv.user_id).toBe(bobId);
      expect(conv.workspace_id).toBe(orgId);
      expect(conv.workspace_mode).toBe('organization');
      expect((conv as any).jira_context).toBeFalsy();
    });

    it('creates an organization conversation when title is undefined and scope is passed as 3rd argument', async () => {
      const scope: ConversationScope = {
        workspaceMode: 'organization',
        workspaceId: orgId,
        jiraContext: false,
      };

      const conv = await convRepo.createConversation(bobId, undefined, scope);

      expect(conv).toBeDefined();
      expect(conv.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(conv.user_id).toBe(bobId);
      expect(conv.workspace_id).toBe(orgId);
      expect(conv.workspace_mode).toBe('organization');
      expect(conv.title).toBeNull();
      expect((conv as any).jira_context).toBeFalsy();
    });

    it('creates a Jira organization conversation when both org and Jira memberships are active', async () => {
      // Alice has both active org membership and active Jira membership
      const scope: ConversationScope & { jiraContext?: boolean } = {
        workspaceMode: 'organization',
        workspaceId: orgId,
        jiraContext: true,
      };

      const conv = await convRepo.createConversation(aliceId, 'Jira Sprint Planning', scope);

      expect(conv).toBeDefined();
      expect(conv.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(conv.user_id).toBe(aliceId);
      expect(conv.workspace_id).toBe(orgId);
      expect(conv.workspace_mode).toBe('organization');
      expect((conv as any).jira_context).toBe(true);
    });

    it('fails closed (404) when creating Jira conversation if user lacks Jira membership', async () => {
      // Bob is active in Org, but NOT in Jira
      const scope: ConversationScope & { jiraContext?: boolean } = {
        workspaceMode: 'organization',
        workspaceId: orgId,
        jiraContext: true,
      };

      await expect(
        convRepo.createConversation(bobId, 'Jira Attempt By Org-Only User', scope)
      ).rejects.toThrow();

      try {
        await convRepo.createConversation(bobId, 'Jira Attempt By Org-Only User', scope);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ConversationAccessError);
        expect(err.status).toBe(404);
      }
    });

    it('fails closed (404) when creating Jira conversation if org membership is disabled', async () => {
      // Charlie has active Jira membership, but org membership is disabled
      const scope: ConversationScope & { jiraContext?: boolean } = {
        workspaceMode: 'organization',
        workspaceId: orgId,
        jiraContext: true,
      };

      await expect(
        convRepo.createConversation(charlieId, 'Jira Attempt By Disabled Org User', scope)
      ).rejects.toThrow();

      try {
        await convRepo.createConversation(charlieId, 'Jira Attempt By Disabled Org User', scope);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ConversationAccessError);
        expect(err.status).toBe(404);
      }
    });

    it('fails closed (404) when creating Jira conversation if Jira policy status is archived', async () => {
      const archWsId = await seedSharedWorkspace('Archived Jira Org', `arch-${randomUUID().slice(0, 8)}`, aliceId, 'archived');
      await seedOrgMembership(archWsId, aliceId, 'member', 'active');
      await seedJiraMembership(archWsId, aliceId, 'member', 'active');

      const scope: ConversationScope & { jiraContext?: boolean } = {
        workspaceMode: 'organization',
        workspaceId: archWsId,
        jiraContext: true,
      };

      await expect(
        convRepo.createConversation(aliceId, 'Jira In Archived Org', scope)
      ).rejects.toThrow();

      try {
        await convRepo.createConversation(aliceId, 'Jira In Archived Org', scope);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ConversationAccessError);
        expect(err.status).toBe(404);
      }
    });

    it('rejects jiraContext on personal or legacy workspace modes', async () => {
      const personalScope: ConversationScope & { jiraContext?: boolean } = {
        workspaceMode: 'personal',
        jiraContext: true,
      };
      await expect(convRepo.createConversation(aliceId, personalScope)).rejects.toThrow();

      const legacyScope: ConversationScope & { jiraContext?: boolean } = {
        workspaceMode: 'legacy',
        jiraContext: true,
      };
      await expect(convRepo.createConversation(aliceId, legacyScope)).rejects.toThrow();
    });
  });

  // ==========================================================================
  // 2. Database Immutability & Constraint Triggers
  // ==========================================================================
  describe('Database Immutability & Trigger Enforcements', () => {
    let testJiraConvId: string;
    let testRegConvId: string;

    beforeEach(async () => {
      const jRes = await pool.query<{ id: string }>(
        `INSERT INTO conversations (id, user_id, status, title, workspace_id, workspace_mode, jira_context)
         VALUES ($1, $2, 'chatting', 'Immutable Jira Conv', $3, 'organization', true)
         RETURNING id`,
        [randomUUID(), aliceId, orgId]
      );
      testJiraConvId = firstRow(jRes).id;

      const rRes = await pool.query<{ id: string }>(
        `INSERT INTO conversations (id, user_id, status, title, workspace_id, workspace_mode, jira_context)
         VALUES ($1, $2, 'chatting', 'Immutable Reg Org Conv', $3, 'organization', false)
         RETURNING id`,
        [randomUUID(), bobId, orgId]
      );
      testRegConvId = firstRow(rRes).id;
    });

    it('blocks mutating jira_context from true to false via SQL trigger', async () => {
      await expect(
        pool.query('UPDATE conversations SET jira_context = false WHERE id = $1', [testJiraConvId])
      ).rejects.toThrow();
    });

    it('blocks mutating jira_context from false to true via SQL trigger', async () => {
      await expect(
        pool.query('UPDATE conversations SET jira_context = true WHERE id = $1', [testRegConvId])
      ).rejects.toThrow();
    });

    it('blocks cross-organization workspace reassignment on scoped conversations', async () => {
      await expect(
        pool.query('UPDATE conversations SET workspace_id = $1 WHERE id = $2', [org2Id, testJiraConvId])
      ).rejects.toThrow();
    });

    it('blocks unlinking workspace_id to NULL on scoped conversations', async () => {
      await expect(
        pool.query('UPDATE conversations SET workspace_id = NULL, workspace_mode = $1 WHERE id = $2', ['legacy', testJiraConvId])
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  // 3. Concurrency Barrier: Revocation Observed via pg_locks
  // ==========================================================================
  describe('Concurrency Barrier & Race Protection', () => {
    it('observes blocked SUT on Jira membership lock and fails closed upon revocation commit', async () => {
      const raceUser = await createSyntheticUser(pool, 'Race Jira Candidate', 'race', { role: 'member', status: 'active' });
      await seedOrgMembership(orgId, raceUser, 'member', 'active');
      await seedJiraMembership(orgId, raceUser, 'member', 'active');

      const sutPool = ctx.createWorkerPool({ max: 2, applicationName: 'sut-shared-conv-worker' });
      const barrierPool = ctx.createWorkerPool({ max: 2, applicationName: 'barrier-shared-conv-worker' });
      const sutRepo = new ConversationRepo(sutPool);

      const barrierClient = await barrierPool.connect();
      let allSettledPromise: Promise<unknown[]> | null = null;
      let blockedWaiterPromise: Promise<boolean> | null = null;
      let observedBlock = false;
      let createError: any = null;
      let createResult: any = null;

      try {
        await barrierClient.query('BEGIN');

        // Hold uncommitted FOR UPDATE row lock on Jira membership and revoke status
        await barrierClient.query(
          `SELECT status FROM ati_workspace_memberships
           WHERE workspace_id = $1 AND user_id = $2
           FOR UPDATE`,
          [orgId, raceUser]
        );
        await barrierClient.query(
          `UPDATE ati_workspace_memberships SET status = 'removed', updated_at = clock_timestamp()
           WHERE workspace_id = $1 AND user_id = $2`,
          [orgId, raceUser]
        );

        // SUT attempts to create Jira conversation on its worker pool
        const scope: ConversationScope & { jiraContext?: boolean } = {
          workspaceMode: 'organization',
          workspaceId: orgId,
          jiraContext: true,
        };
        const createPromise = sutRepo
          .createConversation(raceUser, 'Concurrent Jira Race', scope)
          .then((res) => { createResult = res; return false; })
          .catch((err) => { createError = err; return false; });

        // Barrier waiter polls pg_locks for SUT worker blocked on the lock
        const pollBlocked = async (): Promise<boolean> => {
          try {
            const count = await waitForBlockedQueries(ctx.adminPool, ['sut-shared-conv-worker'], 3000);
            return count >= 1;
          } catch {
            return false;
          }
        };
        const blockedPromise = pollBlocked();
        allSettledPromise = Promise.allSettled([createPromise, blockedPromise]);

        observedBlock = await Promise.race([
          blockedPromise,
          createPromise.then(() => false).catch(() => false),
        ]);

        // SUT MUST be genuinely blocked waiting on the lock
        expect(observedBlock).toBe(true);

        // Commit the revocation and release lock
        await barrierClient.query('COMMIT');
        await allSettledPromise;

        // SUT unblocks and fails closed with 404
        expect(createResult).toBeNull();
        expect(createError).toBeInstanceOf(ConversationAccessError);
        expect(createError?.status).toBe(404);
      } finally {
        try { await barrierClient.query('ROLLBACK'); } catch { /* ignore */ }
        barrierClient.release();
        if (allSettledPromise) {
          try { await allSettledPromise; } catch { /* ignore */ }
        }
      }
    });
  });

  // ==========================================================================
  // 4. Listing & Revocation Isolation
  // ==========================================================================
  describe('Listing & Revocation Isolation', () => {
    let userRegConvId: string;
    let userJiraConvId: string;

    beforeEach(async () => {
      // Alice creates one regular org conversation and one Jira org conversation
      const reg = await convRepo.createConversation(aliceId, 'Reg Org Conv 1', {
        workspaceMode: 'organization',
        workspaceId: orgId,
        jiraContext: false,
      });
      userRegConvId = reg.id;

      const jira = await convRepo.createConversation(aliceId, 'Jira Org Conv 1', {
        workspaceMode: 'organization',
        workspaceId: orgId,
        jiraContext: true,
      });
      userJiraConvId = jira.id;
    });

    it('lists both regular and Jira conversations when both memberships are active', async () => {
      const list = await convRepo.listConversations(aliceId, 50, {
        workspaceMode: 'organization',
        workspaceId: orgId,
      });

      const ids = list.map((c) => c.id);
      expect(ids).toContain(userRegConvId);
      expect(ids).toContain(userJiraConvId);
    });

    it('hides Jira conversation while preserving ordinary org conversation when Jira membership is revoked', async () => {
      // Revoke Alice's Jira membership ONLY
      await pool.query(
        `UPDATE ati_workspace_memberships SET status = 'removed', updated_at = clock_timestamp()
         WHERE workspace_id = $1 AND user_id = $2`,
        [orgId, aliceId]
      );

      // Org membership remains ACTIVE in workspace_members
      const list = await convRepo.listConversations(aliceId, 50, {
        workspaceMode: 'organization',
        workspaceId: orgId,
      });

      const ids = list.map((c) => c.id);
      // Ordinary org conversation is preserved
      expect(ids).toContain(userRegConvId);
      // Jira conversation is hidden (404 hidden pattern)
      expect(ids).not.toContain(userJiraConvId);
    });
  });
});
