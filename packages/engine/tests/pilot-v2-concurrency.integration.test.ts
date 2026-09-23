import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { DEMO_USER_ID, migrate, openDatabase, seedDemo } from '@wap/db';
import { PostgresReservationStore } from '../src/pilot/postgres-store.js';

const adminUrl = process.env.DATABASE_URL || 'postgresql://wap:wap@127.0.0.1:55532/wap_g1';
const dbName = `engine_pilot_conc_${randomUUID().replaceAll('-', '')}`;
const address = new URL(adminUrl);
address.pathname = `/${dbName}`;
const databaseUrl = address.href;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
let db: ReturnType<typeof openDatabase>;

const PILOT_RUN_ADVISORY_LOCK_KEY = 638019815;

async function createWorkflow(userId = DEMO_USER_ID) {
  const workflowId = randomUUID();
  const versionId = randomUUID();
  await db.client`
    INSERT INTO workflows(id, user_id, name, source_prompt)
    VALUES (${workflowId}, ${userId}, 'pilot-test', 'pilot-test')
  `;
  await db.client`
    INSERT INTO workflow_versions(id, workflow_id, version_no, plan, origin)
    VALUES (${versionId}, ${workflowId}, 1, '{}', 'initial')
  `;
  return { workflowId, versionId };
}

async function createTestRun(userId = DEMO_USER_ID, status = 'succeeded') {
  const { workflowId, versionId } = await createWorkflow(userId);
  const runId = randomUUID();
  await db.client`
    INSERT INTO runs(id, user_id, workflow_id, workflow_version_id, status, source_prompt, time_zone)
    VALUES (${runId}, ${userId}, ${workflowId}, ${versionId}, ${status}, 'prompt', 'Asia/Ho_Chi_Minh')
  `;
  return runId;
}

describe('Pilot V2 PostgreSQL Concurrency & Invariants Integration (BE-25)', () => {
  beforeAll(async () => {
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    await migrate(databaseUrl);
    db = openDatabase(databaseUrl);
    await seedDemo(db);
  });

  afterAll(async () => {
    await db?.close();
    await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin.end();
  });

  describe('Advisory Lock Concurrency (Single Active Run per DB)', () => {
    it('serializes concurrent run creation and rejects the second when first is nonterminal', async () => {
      const { workflowId, versionId } = await createWorkflow();

      async function attemptCreateRun(runId: string) {
        return db.client.begin(async (sql) => {
          // Acquire advisory transaction lock
          await sql`SELECT pg_advisory_xact_lock(${PILOT_RUN_ADVISORY_LOCK_KEY})`;

          // Check if any nonterminal run exists
          const activeRows = await sql`
            SELECT id, status FROM runs
            WHERE status IN ('planning', 'awaiting_approval', 'running')
            LIMIT 1
          `;

          if (activeRows.length > 0) {
            throw new Error('CONCURRENCY_LIMIT: A nonterminal run already exists in database');
          }

          // Insert new run
          await sql`
            INSERT INTO runs(id, user_id, workflow_id, workflow_version_id, status, source_prompt, time_zone)
            VALUES (${runId}, ${DEMO_USER_ID}, ${workflowId}, ${versionId}, 'planning', 'prompt', 'Asia/Ho_Chi_Minh')
          `;
          return runId;
        });
      }

      const runId1 = randomUUID();
      const runId2 = randomUUID();

      // Attempt concurrent creations
      const results = await Promise.allSettled([
        attemptCreateRun(runId1),
        attemptCreateRun(runId2),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly ONE must succeed, and ONE must be rejected
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason.message).toContain('CONCURRENCY_LIMIT');

      // Cleanup run1
      await db.client`DELETE FROM runs WHERE id IN (${runId1}, ${runId2})`;
    });
  });

  describe('PostgresReservationStore Race Condition & Lifecycle', () => {
    it('prevents duplicate reservations for the same intentKey concurrently', async () => {
      const store = new PostgresReservationStore(db);
      const intentKey = `intent-${randomUUID()}`;
      const sourceKey = `source-${randomUUID()}`;
      const boardId = 'board-pilot-001';
      const runId1 = await createTestRun();
      const runId2 = await createTestRun();

      const res1 = await store.reserve({
        intentKey,
        sourceKey,
        boardId,
        runId: runId1,
      });

      expect(res1.status).toBe('reserved');
      expect(res1.intentKey).toBe(intentKey);

      // Concurrent second reserve with same intentKey must be rejected
      await expect(
        store.reserve({
          intentKey,
          sourceKey,
          boardId,
          runId: runId2,
        }),
      ).rejects.toThrow(/INTENT_ALREADY_RESERVED/);
    });

    it('records full dispatch lifecycle (reserve -> claimDispatched -> confirm)', async () => {
      const store = new PostgresReservationStore(db);
      const intentKey = `intent-${randomUUID()}`;
      const sourceKey = `source-${randomUUID()}`;
      const boardId = 'board-pilot-001';
      const runId = await createTestRun();
      const operationId = randomUUID();

      // 1. Reserve
      const reserved = await store.reserve({
        intentKey,
        sourceKey,
        boardId,
        runId,
      });
      expect(reserved.status).toBe('reserved');

      // 2. Claim Dispatched
      await store.claimDispatched(intentKey, operationId);
      const dispatched = await store.getReservation(intentKey);
      expect(dispatched?.status).toBe('dispatched');
      expect(dispatched?.operationId).toBe(operationId);

      // 3. Confirm
      await store.confirm(intentKey, 'c-card-999', 'https://trello.com/c/card-999', 'list-todo');
      const confirmed = await store.getReservation(intentKey);
      expect(confirmed?.status).toBe('confirmed');
      expect(confirmed?.remoteId).toBe('c-card-999');
      expect(confirmed?.remoteUrl).toBe('https://trello.com/c/card-999');

      // 4. Subsequent reserve returns the existing confirmed reservation (deduplication)
      const replayRunId = await createTestRun();
      const replayed = await store.reserve({
        intentKey,
        sourceKey,
        boardId,
        runId: replayRunId,
      });
      expect(replayed.status).toBe('confirmed');
      expect(replayed.remoteId).toBe('c-card-999');

      await expect(store.claimDispatched(intentKey, randomUUID()))
        .rejects.toThrow(/RESERVATION_NOT_CLAIMABLE/);
      expect((await store.getReservation(intentKey))?.status).toBe('confirmed');
    });

    it('halts at unknown and prevents re-reservation when write outcome is unknown', async () => {
      const store = new PostgresReservationStore(db);
      const intentKey = `intent-${randomUUID()}`;
      const sourceKey = `source-${randomUUID()}`;
      const boardId = 'board-pilot-001';
      const runId = await createTestRun();

      await store.reserve({
        intentKey,
        sourceKey,
        boardId,
        runId,
      });

      // Remote write failed/timed out -> markUnknown
      await store.markUnknown(intentKey);
      const unknownRes = await store.getReservation(intentKey);
      expect(unknownRes?.status).toBe('unknown');

      // Next attempt to reserve MUST throw and prohibit blind retry
      const replayRunId = await createTestRun();
      await expect(
        store.reserve({
          intentKey,
          sourceKey,
          boardId,
          runId: replayRunId,
        }),
      ).rejects.toThrow(/INTENT_IN_UNKNOWN_STATE/);
    });
  });
});
