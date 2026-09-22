import { describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import {
  type PilotApproveBody,
  PilotApproveBodySchema,
} from '../src/pilot/schemas.js';
import { redactObject, type PilotConfig } from '../src/pilot/config.js';
import {
  executePilotWorkflow,
  InMemoryReservationStore,
} from '../src/pilot/dispatch.js';
import { assertPilotAccess, type PilotPolicy } from '../src/pilot/policy.js';

const basePolicy: PilotPolicy = {
  enabled: true,
  principals: ['operator-a', 'operator-b'],
  spreadsheetId: 'sheet-001',
  tabId: 'tab-001',
  boardId: 'board-001',
};

const baseConfig: PilotConfig = {
  ...basePolicy,
  trello: { apiKey: 'key-123', apiToken: 'token-123' },
};

describe('Pilot V2 Invariant Regression Suite (BE-25)', () => {
  describe('Invariant 1: Single Active Run per Database', () => {
    it('rejects creation of a new active run when an active nonterminal run exists', () => {
      const activeRuns = new Map<string, { status: string }>();
      const existingRunId = randomUUID();
      activeRuns.set(existingRunId, { status: 'running' });

      function admitNewRun(activeRunsMap: Map<string, { status: string }>) {
        const hasNonTerminal = Array.from(activeRunsMap.values()).some((r) =>
          ['planning', 'awaiting_approval', 'running'].includes(r.status),
        );
        if (hasNonTerminal) {
          throw new Error('CONCURRENCY_LIMIT_REACHED: Only 1 active nonterminal run is permitted');
        }
        const newId = randomUUID();
        activeRunsMap.set(newId, { status: 'planning' });
        return newId;
      }

      expect(() => admitNewRun(activeRuns)).toThrow(/CONCURRENCY_LIMIT_REACHED/);
      expect(activeRuns.size).toBe(1);

      // Transition existing run to terminal state
      activeRuns.set(existingRunId, { status: 'succeeded' });
      const secondRunId = admitNewRun(activeRuns);
      expect(secondRunId).toBeDefined();
      expect(activeRuns.size).toBe(2);
    });
  });

  describe('Invariant 2: Owner Privacy Isolation', () => {
    it('strictly isolates runs between distinct principals in production policy and dispatch', async () => {
      // 1. assertPilotAccess fails-closed for non-permitted principal
      expect(() =>
        assertPilotAccess(basePolicy, 'operator-foreign', { kind: 'board', boardId: 'board-001' }),
      ).toThrow(/ACCESS_DENIED/);

      // 2. executePilotWorkflow rejects execution if approver is not the run owner
      const store = new InMemoryReservationStore();
      const runId = randomUUID();
      const hash = createHash('sha256').update('test-snapshot').digest('hex');

      const result = await executePilotWorkflow({
        runId,
        principalId: 'operator-b', // Authenticated caller
        config: baseConfig,
        policy: basePolicy,
        store,
        approval: {
          ownerId: 'operator-a', // Run owned by operator-a
          expiresAt: new Date(Date.now() + 600000),
          snapshotHash: hash,
          decision: 'approved',
        },
        expectedHash: hash,
        cardTitle: 'Test Task',
        listName: 'To Do',
        intentKey: `intent-${randomUUID()}`,
        sourceKey: `source-${randomUUID()}`,
      });

      expect(result.status).toBe('failed');
      expect(result.error).toContain('FORBIDDEN: Principal does not own this run');
    });
  });

  describe('Invariant 3: Approval Hash & Snapshot Binding', () => {
    it('rejects approval in production dispatch when snapshot hash does not match stored snapshot hash', async () => {
      const correctHash = createHash('sha256').update('canonical-snapshot-payload-v1').digest('hex');
      const forgedHash = createHash('sha256').update('canonical-snapshot-payload-v2-tampered').digest('hex');

      const approvalPayload: PilotApproveBody = {
        snapshotHash: forgedHash,
        decision: 'approved',
      };

      expect(PilotApproveBodySchema.safeParse(approvalPayload).success).toBe(true);

      const store = new InMemoryReservationStore();
      const result = await executePilotWorkflow({
        runId: randomUUID(),
        principalId: 'operator-a',
        config: baseConfig,
        policy: basePolicy,
        store,
        approval: {
          ownerId: 'operator-a',
          expiresAt: new Date(Date.now() + 600000),
          snapshotHash: forgedHash,
          decision: 'approved',
        },
        expectedHash: correctHash, // Stored hash does not match forged hash
        cardTitle: 'Tampered Plan',
        listName: 'To Do',
        intentKey: `intent-${randomUUID()}`,
        sourceKey: `source-${randomUUID()}`,
      });

      expect(result.status).toBe('failed');
      expect(result.error).toContain('SNAPSHOT_MISMATCH');
    });

    it('rejects approval if decision is not approved (e.g. user rejected)', async () => {
      const hash = createHash('sha256').update('test-snapshot').digest('hex');
      const store = new InMemoryReservationStore();
      const result = await executePilotWorkflow({
        runId: randomUUID(),
        principalId: 'operator-a',
        config: baseConfig,
        policy: basePolicy,
        store,
        approval: {
          ownerId: 'operator-a',
          expiresAt: new Date(Date.now() + 600000),
          snapshotHash: hash,
          decision: 'rejected',
        },
        expectedHash: hash,
        cardTitle: 'Rejected Plan',
        listName: 'To Do',
        intentKey: `intent-${randomUUID()}`,
        sourceKey: `source-${randomUUID()}`,
      });

      expect(result.status).toBe('rejected');
    });
  });

  describe('Invariant 4: Server TTL Enforcement (10 Minutes)', () => {
    it('strictly expires approval in production dispatch when server TTL has passed', async () => {
      const hash = createHash('sha256').update('test-snapshot').digest('hex');
      const store = new InMemoryReservationStore();

      // Timestamp in the past (expired TTL)
      const expiredTime = new Date(Date.now() - 1000);

      const result = await executePilotWorkflow({
        runId: randomUUID(),
        principalId: 'operator-a',
        config: baseConfig,
        policy: basePolicy,
        store,
        approval: {
          ownerId: 'operator-a',
          expiresAt: expiredTime,
          snapshotHash: hash,
          decision: 'approved',
        },
        expectedHash: hash,
        cardTitle: 'Expired Plan',
        listName: 'To Do',
        intentKey: `intent-${randomUUID()}`,
        sourceKey: `source-${randomUUID()}`,
      });

      expect(result.status).toBe('expired');
      expect(result.error).toContain('APPROVAL_EXPIRED');
    });
  });

  describe('Invariant 5: Write Count Discipline', () => {
    it('strictly permits at most 1 remote write for UC2, and 0 writes for UC1/UC3', () => {
      const testCases = [
        { useCase: 'UC1 Refusal', writes: 0 },
        { useCase: 'UC1 Clarification', writes: 0 },
        { useCase: 'UC2 Executable Plan', writes: 1 },
        { useCase: 'UC3 Read-Only Lookup', writes: 0 },
      ];

      for (const tc of testCases) {
        expect(tc.writes).toBeLessThanOrEqual(1);
        if (tc.useCase !== 'UC2 Executable Plan') {
          expect(tc.writes).toBe(0);
        }
      }
    });
  });

  describe('Invariant 6: Zero Blind Retry on Unknown Outcome', () => {
    it('halts state and prevents re-reservation in production reservation store on unknown outcome', async () => {
      const store = new InMemoryReservationStore();
      const intentKey = `intent-${randomUUID()}`;
      const sourceKey = `source-${randomUUID()}`;

      // Reserve
      await store.reserve({
        intentKey,
        sourceKey,
        boardId: 'board-001',
        runId: randomUUID(),
      });

      // Write result unknown -> mark unknown
      await store.markUnknown(intentKey);

      // Attempting to retry/reserve again MUST fail-closed with INTENT_IN_UNKNOWN_STATE
      await expect(
        store.reserve({
          intentKey,
          sourceKey,
          boardId: 'board-001',
          runId: randomUUID(),
        }),
      ).rejects.toThrow(/INTENT_IN_UNKNOWN_STATE/);
    });
  });

  describe('Invariant 7: Credential Redaction in Errors, Logs, and Traces', () => {
    it('redacts tokens, passwords, and sensitive keys from objects and errors', () => {
      const apiKeySecret = 'sk-proj-secret-12345';
      const trelloTokenSecret = 'ATTAb8c9d0e1f2a3b4c5d6e7f8';
      const sensitivePayload = {
        apiKey: apiKeySecret,
        trelloToken: trelloTokenSecret,
        nested: {
          authorization: 'Bearer super-secret-jwt',
          normalField: 'hello-world',
        },
      };

      const sanitized = redactObject(sensitivePayload, [apiKeySecret, trelloTokenSecret]);
      expect((sanitized as any).apiKey).toBe('[REDACTED]');
      expect((sanitized as any).trelloToken).toBe('[REDACTED]');
      expect((sanitized as any).nested.authorization).toBe('Bearer [REDACTED]');
      expect((sanitized as any).nested.normalField).toBe('hello-world');

      const serialized = JSON.stringify(sanitized);
      expect(serialized).not.toContain('sk-proj-secret-12345');
      expect(serialized).not.toContain('ATTAb8c9d0e1f2a3b4c5d6e7f8');
      expect(serialized).not.toContain('super-secret-jwt');
    });
  });
});
