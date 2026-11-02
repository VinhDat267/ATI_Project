import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { ConversationRepo, ConversationAccessError } from '../../src/db/repositories/conversation-repo.js';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  waitForBlockedQueries,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';

describe('apps/chat-api — JIRA-03 Conversation Repository Workspace Scope & Invariants', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;
  let convRepo: ConversationRepo;

  let user1Id: string; // Member of WS1
  let user2Id: string; // Member of WS2 / outsider to WS1
  let user3Id: string; // Unaffiliated user

  let ws1Id: string;
  let ws2Id: string;
  let wsArchivedId: string;

  function firstRow<T extends pg.QueryResultRow>(res: pg.QueryResult<T>): T {
    const row = res.rows[0];
    if (!row) throw new Error('Expected query result to contain at least one row');
    return row;
  }

  async function seedWorkspace(name: string, slug: string, createdBy: string, status = 'active'): Promise<string> {
    const wsId = randomUUID();
    await pool.query(
      `INSERT INTO workspaces (id, name, invite_code, require_approval, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, false, $4, clock_timestamp(), clock_timestamp())`,
      [wsId, name, `INV-${wsId.slice(0, 8)}`.toUpperCase(), createdBy]
    );
    const res = await pool.query<{ id: string }>(
      `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
       VALUES ($1, $2, $3, 1, $4)
       RETURNING id`,
      [wsId, slug, status, createdBy]
    );
    return firstRow(res).id;
  }

  async function seedMembership(
    workspaceId: string,
    userId: string,
    role: 'admin' | 'member' = 'member',
    status: 'pending' | 'active' | 'rejected' | 'removed' = 'active'
  ): Promise<void> {
    const genericStatus = status === 'active' ? 'active' : 'disabled';
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, clock_timestamp(), clock_timestamp())
       ON CONFLICT (workspace_id, user_id)
       DO UPDATE SET status = EXCLUDED.status, role = EXCLUDED.role, updated_at = clock_timestamp()`,
      [workspaceId, userId, role, genericStatus]
    );
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

    // Run migrations 0001–0015
    await ctx.runAllMigrations();

    convRepo = new ConversationRepo(pool);

    user1Id = await createSyntheticUser(pool, 'User One', 'u1');
    user2Id = await createSyntheticUser(pool, 'User Two', 'u2');
    user3Id = await createSyntheticUser(pool, 'User Three', 'u3');

    ws1Id = await seedWorkspace('Workspace 1', `ws1-${randomUUID().slice(0, 8)}`, user1Id);
    ws2Id = await seedWorkspace('Workspace 2', `ws2-${randomUUID().slice(0, 8)}`, user2Id);
    wsArchivedId = await seedWorkspace('Archived Workspace', `ws-arch-${randomUUID().slice(0, 8)}`, user1Id, 'archived');

    // Default memberships
    await seedMembership(ws1Id, user1Id, 'member', 'active');
    await seedMembership(ws2Id, user2Id, 'member', 'active');
    await seedMembership(wsArchivedId, user1Id, 'member', 'active');
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  // ==========================================================================
  // 1. Conversation Creation (createConversation)
  // ==========================================================================
  describe('createConversation(userId, workspaceId?)', () => {
    it('creates legacy NULL conversation when workspaceId is omitted', async () => {
      const conv = await convRepo.createConversation(user1Id);

      expect(conv).toBeDefined();
      expect(conv.user_id).toBe(user1Id);
      expect(conv.workspace_id ?? null).toBeNull();

      // Direct SQL check
      const dbRow = await pool.query<{ workspace_id: string | null }>(
        'SELECT workspace_id FROM conversations WHERE id = $1',
        [conv.id]
      );
      expect(firstRow(dbRow).workspace_id).toBeNull();
    });

    it('creates scoped conversation with workspace_id when user is active member of active workspace', async () => {
      // Natural call to planned optional workspaceId parameter (no casts)
      const conv = await convRepo.createConversation(user1Id, {
        workspaceMode: 'organization',
        workspaceId: ws1Id,
        jiraContext: true,
      });

      expect(conv).toBeDefined();
      expect(conv.user_id).toBe(user1Id);
      expect(conv.workspace_id).toBe(ws1Id);

      // Direct SQL check
      const dbRow = await pool.query<{ workspace_id: string }>(
        'SELECT workspace_id FROM conversations WHERE id = $1',
        [conv.id]
      );
      expect(firstRow(dbRow).workspace_id).toBe(ws1Id);
    });

    it('rejects scoped conversation creation if user is not a member of workspace', async () => {
      // User 3 has no membership in WS1
      await expect(
        convRepo.createConversation(user3Id, {
          workspaceMode: 'organization',
          workspaceId: ws1Id,
          jiraContext: true,
        })
      ).rejects.toThrow();
    });

    it('rejects scoped conversation creation if user membership is pending', async () => {
      const testWsId = await seedWorkspace('Pending WS', `ws-pend-${randomUUID().slice(0, 8)}`, user1Id);
      await seedMembership(testWsId, user3Id, 'member', 'pending');

      await expect(
        convRepo.createConversation(user3Id, {
          workspaceMode: 'organization',
          workspaceId: testWsId,
          jiraContext: true,
        })
      ).rejects.toThrow();
    });

    it('rejects scoped conversation creation if user membership is rejected', async () => {
      const testWsId = await seedWorkspace('Rejected WS', `ws-rej-${randomUUID().slice(0, 8)}`, user1Id);
      await seedMembership(testWsId, user3Id, 'member', 'rejected');

      await expect(
        convRepo.createConversation(user3Id, {
          workspaceMode: 'organization',
          workspaceId: testWsId,
          jiraContext: true,
        })
      ).rejects.toThrow();
    });

    it('rejects scoped conversation creation if user membership is removed', async () => {
      const testWsId = await seedWorkspace('Removed WS', `ws-rem-${randomUUID().slice(0, 8)}`, user1Id);
      await seedMembership(testWsId, user3Id, 'member', 'removed');

      await expect(
        convRepo.createConversation(user3Id, {
          workspaceMode: 'organization',
          workspaceId: testWsId,
          jiraContext: true,
        })
      ).rejects.toThrow();
    });

    it('rejects scoped conversation creation if workspace is archived', async () => {
      await expect(
        convRepo.createConversation(user1Id, {
          workspaceMode: 'organization',
          workspaceId: wsArchivedId,
          jiraContext: true,
        })
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  // 2. Database Immutability Trigger (trg_conversations_workspace_immutable)
  // ==========================================================================
  describe('Database Immutability Constraints', () => {
    it('trigger blocks assigning workspace_id to legacy conversations (NULL -> workspaceId)', async () => {
      const legacyConv = await convRepo.createConversation(user1Id);

      await expect(
        pool.query('UPDATE conversations SET workspace_id = $1 WHERE id = $2', [ws1Id, legacyConv.id])
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('trigger blocks setting workspace_id to NULL on scoped conversation (workspaceId -> NULL)', async () => {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode, jira_context)
         VALUES ($1, 'chatting', 'Direct Scoped', $2, 'organization', true) RETURNING id`,
        [user1Id, ws1Id]
      );
      const scopedId = firstRow(res).id;

      await expect(
        pool.query('UPDATE conversations SET workspace_id = NULL WHERE id = $1', [scopedId])
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('trigger blocks switching workspace_id across workspaces (workspace A -> workspace B)', async () => {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode, jira_context)
         VALUES ($1, 'chatting', 'Direct Scoped A', $2, 'organization', true) RETURNING id`,
        [user1Id, ws1Id]
      );
      const scopedId = firstRow(res).id;

      await expect(
        pool.query('UPDATE conversations SET workspace_id = $1 WHERE id = $2', [ws2Id, scopedId])
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('allows normal updates to other fields while workspace_id remains unchanged', async () => {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode, jira_context)
         VALUES ($1, 'chatting', 'Initial Scoped Title', $2, 'organization', true) RETURNING id`,
        [user1Id, ws1Id]
      );
      const scopedId = firstRow(res).id;

      await pool.query(
        `UPDATE conversations SET title = 'Updated Title', status = 'archived' WHERE id = $1`,
        [scopedId]
      );

      const updated = await pool.query<{ title: string; status: string; workspace_id: string }>(
        'SELECT title, status, workspace_id FROM conversations WHERE id = $1',
        [scopedId]
      );
      const updatedRow = firstRow(updated);
      expect(updatedRow.title).toBe('Updated Title');
      expect(updatedRow.status).toBe('archived');
      expect(updatedRow.workspace_id).toBe(ws1Id);
    });
  });

  // ==========================================================================
  // 3. listConversations Filtering
  // ==========================================================================
  describe('listConversations(userId, limit)', () => {
    let convLegacy: string;
    let convActiveWs: string;
    let convRemovedWs: string;
    let convArchivedWs: string;

    beforeEach(async () => {
      // 1. Legacy conversation for User 1
      const lRes = await pool.query<{ id: string }>(
        `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode, jira_context)
         VALUES ($1, 'chatting', 'Legacy User1 Conv', NULL, 'legacy', false) RETURNING id`,
        [user1Id]
      );
      convLegacy = firstRow(lRes).id;

      // 2. Active scoped conversation in WS1
      const aRes = await pool.query<{ id: string }>(
        `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode, jira_context)
         VALUES ($1, 'chatting', 'Active Scoped WS1 Conv', $2, 'organization', true) RETURNING id`,
        [user1Id, ws1Id]
      );
      convActiveWs = firstRow(aRes).id;

      // 3. Scoped conversation in a workspace where user is removed
      const removedWsId = await seedWorkspace('Removed WS Filter', `ws-rf-${randomUUID().slice(0, 8)}`, user1Id);
      await seedMembership(removedWsId, user1Id, 'member', 'removed');
      const rRes = await pool.query<{ id: string }>(
        `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode, jira_context)
         VALUES ($1, 'chatting', 'Removed Scoped Conv', $2, 'organization', true) RETURNING id`,
        [user1Id, removedWsId]
      );
      convRemovedWs = firstRow(rRes).id;

      // 4. Scoped conversation in archived workspace
      const archRes = await pool.query<{ id: string }>(
        `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode, jira_context)
         VALUES ($1, 'chatting', 'Archived Scoped Conv', $2, 'organization', true) RETURNING id`,
        [user1Id, wsArchivedId]
      );
      convArchivedWs = firstRow(archRes).id;
    });

    it('returns active scoped conversations and legacy conversations while hiding removed and archived rows', async () => {
      const list = await convRepo.listConversations(user1Id, 50);

      const returnedIds = list.map((c) => c.id);

      // Must include legacy and active scoped
      expect(returnedIds).toContain(convLegacy);
      expect(returnedIds).toContain(convActiveWs);

      // Must NOT include removed or archived scoped conversations
      expect(returnedIds).not.toContain(convRemovedWs);
      expect(returnedIds).not.toContain(convArchivedWs);
    });

    it('does not return conversations belonging to other users', async () => {
      const list = await convRepo.listConversations(user2Id, 50);
      const returnedIds = list.map((c) => c.id);

      expect(returnedIds).not.toContain(convLegacy);
      expect(returnedIds).not.toContain(convActiveWs);
    });
  });

  // ==========================================================================
  // 4. listConversationPage Pagination & Filtering
  // ==========================================================================
  describe('listConversationPage(userId, options)', () => {
    it('paginates over visible conversations and excludes unauthorized scoped rows from pages and cursors', async () => {
      const targetUser = await createSyntheticUser(pool, 'Pagination User', 'page');
      const targetWs = await seedWorkspace('Pagination WS', `ws-pg-${randomUUID().slice(0, 8)}`, targetUser);
      await seedMembership(targetWs, targetUser, 'member', 'active');

      const deadWs = await seedWorkspace('Dead WS', `ws-dead-${randomUUID().slice(0, 8)}`, targetUser);
      await seedMembership(deadWs, targetUser, 'member', 'removed');

      // Create 3 valid conversations (2 active scoped, 1 legacy)
      const conv1 = firstRow(await pool.query<{ id: string }>(
        `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode, jira_context, updated_at)
         VALUES ($1, 'chatting', 'Page Conv 1', $2, 'organization', true, now() - interval '3 minutes') RETURNING id`,
        [targetUser, targetWs]
      )).id;

      // Hidden conversation in between timestamps
      const hiddenConv = firstRow(await pool.query<{ id: string }>(
        `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode, jira_context, updated_at)
         VALUES ($1, 'chatting', 'Page Conv Hidden', $2, 'organization', true, now() - interval '2 minutes') RETURNING id`,
        [targetUser, deadWs]
      )).id;

      const conv2 = firstRow(await pool.query<{ id: string }>(
        `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode, jira_context, updated_at)
         VALUES ($1, 'chatting', 'Page Conv 2', $2, 'organization', true, now() - interval '1 minute') RETURNING id`,
        [targetUser, targetWs]
      )).id;

      const conv3 = firstRow(await pool.query<{ id: string }>(
        `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode, jira_context, updated_at)
         VALUES ($1, 'chatting', 'Page Conv 3', NULL, 'legacy', false, now()) RETURNING id`,
        [targetUser]
      )).id;

      // Fetch Page 1 with limit 2
      const page1 = await convRepo.listConversationPage(targetUser, { limit: 2 });
      expect(page1.conversations).toHaveLength(2);
      expect(page1.conversations.map((c) => c.id)).toEqual([conv3, conv2]);
      expect(page1.conversations.map((c) => c.id)).not.toContain(hiddenConv);
      expect(page1.nextCursor).toBeDefined();

      // Fetch Page 2 with cursor
      const page2 = await convRepo.listConversationPage(targetUser, { limit: 2, cursor: page1.nextCursor! });
      expect(page2.conversations).toHaveLength(1);
      const p2First = page2.conversations[0];
      expect(p2First).toBeDefined();
      expect(p2First?.id).toBe(conv1);
      expect(page2.nextCursor).toBeNull();
    });

    it('search filter only matches visible items', async () => {
      const searchUser = await createSyntheticUser(pool, 'Search User', 'srch');
      const searchWs = await seedWorkspace('Search WS', `ws-sr-${randomUUID().slice(0, 8)}`, searchUser);
      await seedMembership(searchWs, searchUser, 'member', 'active');

      const removedSearchWs = await seedWorkspace('Search WS Removed', `ws-srr-${randomUUID().slice(0, 8)}`, searchUser);
      await seedMembership(removedSearchWs, searchUser, 'member', 'removed');

      await pool.query(
        `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode, jira_context)
         VALUES ($1, 'chatting', 'Unique Alpha Matching Keyword', $2, 'organization', true)`,
        [searchUser, searchWs]
      );

      await pool.query(
        `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode, jira_context)
         VALUES ($1, 'chatting', 'Unique Alpha Matching Keyword But Removed', $2, 'organization', true)`,
        [searchUser, removedSearchWs]
      );

      const result = await convRepo.listConversationPage(searchUser, { search: 'Unique Alpha' });
      expect(result.conversations).toHaveLength(1);
      const rFirst = result.conversations[0];
      expect(rFirst).toBeDefined();
      expect(rFirst?.title).toBe('Unique Alpha Matching Keyword');
    });
  });

  // ==========================================================================
  // 5. renameConversation Authorization
  // ==========================================================================
  describe('renameConversation(id, userId, title)', () => {
    it('renames scoped conversation when caller is active member of active workspace', async () => {
      const convRes = await pool.query<{ id: string }>(
        `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode, jira_context)
         VALUES ($1, 'chatting', 'Initial Title', $2, 'organization', true) RETURNING id`,
        [user1Id, ws1Id]
      );
      const convId = firstRow(convRes).id;

      const updated = await convRepo.renameConversation(convId, user1Id, 'Renamed Scoped Title');
      expect(updated).not.toBeNull();
      expect(updated?.title).toBe('Renamed Scoped Title');
    });

    it('returns null and refuses rename if caller is removed from workspace', async () => {
      const removedWs = await seedWorkspace('Rename Removed WS', `ws-rr-${randomUUID().slice(0, 8)}`, user1Id);
      await seedMembership(removedWs, user1Id, 'member', 'active');

      const convRes = await pool.query<{ id: string }>(
        `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode, jira_context)
         VALUES ($1, 'chatting', 'Before Removal Title', $2, 'organization', true) RETURNING id`,
        [user1Id, removedWs]
      );
      const convId = firstRow(convRes).id;

      // Revoke membership
      await seedMembership(removedWs, user1Id, 'member', 'removed');

      const updated = await convRepo.renameConversation(convId, user1Id, 'New Disallowed Title');
      expect(updated).toBeNull();

      // Title in DB must remain unchanged
      const dbRow = await pool.query<{ title: string }>(
        'SELECT title FROM conversations WHERE id = $1',
        [convId]
      );
      expect(firstRow(dbRow).title).toBe('Before Removal Title');
    });

    it('returns null and refuses rename if workspace is archived', async () => {
      const convRes = await pool.query<{ id: string }>(
        `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode, jira_context)
         VALUES ($1, 'chatting', 'Archived WS Conv Title', $2, 'organization', true) RETURNING id`,
        [user1Id, wsArchivedId]
      );
      const convId = firstRow(convRes).id;

      const updated = await convRepo.renameConversation(convId, user1Id, 'Rename Should Fail');
      expect(updated).toBeNull();
    });

    it('returns null when non-owner attempts to rename scoped conversation', async () => {
      const convRes = await pool.query<{ id: string }>(
        `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode, jira_context)
         VALUES ($1, 'chatting', 'Alice Conv', $2, 'organization', true) RETURNING id`,
        [user1Id, ws1Id]
      );
      const convId = firstRow(convRes).id;

      // User 2 (outsider) attempts to rename
      const updated = await convRepo.renameConversation(convId, user2Id, 'Hacked Title');
      expect(updated).toBeNull();
    });

    it('allows owner to rename legacy conversation (workspace_id IS NULL)', async () => {
      const convRes = await pool.query<{ id: string }>(
        `INSERT INTO conversations (user_id, status, title, workspace_id, workspace_mode, jira_context)
         VALUES ($1, 'chatting', 'Initial Legacy Title', NULL, 'legacy', false) RETURNING id`,
        [user1Id]
      );
      const convId = firstRow(convRes).id;

      const updated = await convRepo.renameConversation(convId, user1Id, 'Renamed Legacy Title');
      expect(updated).not.toBeNull();
      expect(updated?.title).toBe('Renamed Legacy Title');
    });
  });

  // ==========================================================================
  // 6. Transactional Revocation Race (Real SUT Participant & Observed Barrier)
  // ==========================================================================
  describe('Transactional Revocation Race (Real SUT Participant & Observed Lock Barrier)', () => {
    it('serializes creation and revocation safely: creation arriving after revocation lock acquisition fails closed', async () => {
      const raceUser = await createSyntheticUser(pool, 'Race User Revoke Wins', 'race_rw');
      const raceWs = await seedWorkspace('Race WS Revoke Wins', `ws-rw-${randomUUID().slice(0, 8)}`, raceUser);
      await seedMembership(raceWs, raceUser, 'member', 'active');

      const sutPool = ctx.createWorkerPool({ max: 2, applicationName: 'sut-conv-repo-worker' });
      const barrierPool = ctx.createWorkerPool({ max: 2, applicationName: 'barrier-revoke-worker' });

      const barrierClient = await barrierPool.connect();
      const sutRepo = new ConversationRepo(sutPool);

      let createResult: any = null;
      let createError: any = null;
      let allSettledPromise: Promise<unknown> | null = null;
      let blockedWaiterPromise: Promise<boolean> | null = null;
      let cancelWaiter = false;

      try {
        // Step 1: Barrier client acquires row lock on the membership row FOR UPDATE
        await barrierClient.query('BEGIN');
        await barrierClient.query(
          `SELECT * FROM ati_workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE`,
          [raceWs, raceUser]
        );
        // Mutate membership status to 'removed' while holding uncommitted exclusive lock
        await barrierClient.query(
          `UPDATE ati_workspace_memberships SET status = 'removed', updated_at = clock_timestamp() WHERE workspace_id = $1 AND user_id = $2`,
          [raceWs, raceUser]
        );

        // Step 2: SUT initiates createConversation on the tagged pool (natural call, no casts)
        const createPromise = (async () => {
          try {
            createResult = await sutRepo.createConversation(raceUser, {
              workspaceMode: 'organization',
              workspaceId: raceWs,
              jiraContext: true,
            });
            return createResult;
          } catch (err) {
            createError = err;
            throw err;
          }
        })();

        // Immediately attach tracking with allSettled outside try/catch boundary
        allSettledPromise = Promise.allSettled([createPromise]);

        // Step 3: Observe SUT connection blocked on pg_locks waiting for the membership lock.
        // Race against createPromise with a bounded, cancellable waiter so leftover waiter is drained.
        const pollBlocked = async (): Promise<boolean> => {
          const start = Date.now();
          while (Date.now() - start < 3000 && !cancelWaiter) {
            try {
              const count = await waitForBlockedQueries(ctx.adminPool, ['sut-conv-repo-worker'], 200);
              if (count >= 1) return true;
            } catch {
              // keep polling until timeout or cancelled
            }
            await new Promise((r) => setTimeout(r, 20));
          }
          return false;
        };
        blockedWaiterPromise = pollBlocked();

        const observedBlock = await Promise.race([
          blockedWaiterPromise,
          createPromise.then(() => false).catch(() => false),
        ]);
        cancelWaiter = true;

        // Concurrency proof: SUT MUST have been observed blocked on the row lock
        expect(observedBlock).toBe(true);

        // Step 4: Commit revocation in barrier client to release lock
        await barrierClient.query('COMMIT');

        // Step 5: Wait for SUT createConversation to settle
        await allSettledPromise;

        // Invariants:
        // SUT createConversation must reject (fail closed) with typed 404 ConversationAccessError
        // because membership was revoked before creation could commit.
        // No conversation must be inserted for raceWs.
        expect(createError).toBeInstanceOf(ConversationAccessError);
        expect((createError as any)?.status).toBe(404);
        expect((createError as any)?.code).toBe('WORKSPACE_MEMBERSHIP_REQUIRED');
        expect(createResult).toBeNull();

        const convCount = await pool.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM conversations WHERE user_id = $1 AND workspace_id = $2',
          [raceUser, raceWs]
        );
        expect(firstRow(convCount).count).toBe('0');
      } finally {
        cancelWaiter = true;
        await barrierClient.query('ROLLBACK').catch(() => undefined);
        barrierClient.release();
        if (allSettledPromise) await allSettledPromise;
        if (blockedWaiterPromise) await blockedWaiterPromise.catch(() => undefined);
        await sutPool.end().catch(() => undefined);
        await barrierPool.end().catch(() => undefined);
      }
    });
  });
});
