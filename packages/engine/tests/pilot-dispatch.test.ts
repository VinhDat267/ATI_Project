import { expect, it, describe, vi, afterEach } from 'vitest';
import {
  InMemoryReservationStore,
  executePilotWorkflow,
  type PilotApprovalContext,
} from '../src/pilot/dispatch.js';
import type { PilotConfig } from '../src/pilot/config.js';
import type { PilotPolicy } from '../src/pilot/policy.js';

describe('pilot/dispatch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const samplePolicy: PilotPolicy = {
    enabled: true,
    principals: ['operator-a'],
    spreadsheetId: 'sheet-123',
    tabId: 'Requests',
    boardId: 'board-456',
  };

  const sampleConfig: PilotConfig = {
    ...samplePolicy,
    trello: { apiKey: 'k', apiToken: 't' },
  };

  describe('InMemoryReservationStore', () => {
    it('creates reservation and rejects duplicate in-flight or unknown', async () => {
      const store = new InMemoryReservationStore();
      const res = await store.reserve({
        intentKey: 'k1',
        sourceKey: 's1',
        boardId: 'board-456',
        runId: 'run-1',
      });
      expect(res.status).toBe('reserved');

      // Second reserve with same intent while reserved/dispatched throws
      await expect(
        store.reserve({
          intentKey: 'k1',
          sourceKey: 's1',
          boardId: 'board-456',
          runId: 'run-2',
        }),
      ).rejects.toThrow('INTENT_ALREADY_RESERVED');
    });

    it('returns existing reservation if already confirmed', async () => {
      const store = new InMemoryReservationStore();
      await store.reserve({
        intentKey: 'k2',
        sourceKey: 's2',
        boardId: 'board-456',
        runId: 'run-1',
      });
      await store.confirm('k2', 'card-existing', 'https://trello.com/c/card-existing');

      // Next run checks intentKey and gets existing confirmed card without creating new
      const check = await store.reserve({
        intentKey: 'k2',
        sourceKey: 's2',
        boardId: 'board-456',
        runId: 'run-3',
      });
      expect(check.status).toBe('confirmed');
      expect(check.remoteId).toBe('card-existing');
    });
  });

  describe('executePilotWorkflow', () => {
    it('executes read and write steps, confirms reservation and returns receipt', async () => {
      const store = new InMemoryReservationStore();

      // Mock Trello: 1. list_lists, 2. create_card
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify([{ id: 'l1', name: 'To Do', closed: false }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ id: 'card-new-1', url: 'https://trello.com/c/card-new-1' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );

      const approval: PilotApprovalContext = {
        approvalId: 'app-1',
        ownerId: 'operator-a',
        expiresAt: new Date(Date.now() + 600000), // +10m
        snapshotHash: 'hash-abc',
        decision: 'approved',
      };

      const result = await executePilotWorkflow({
        runId: 'run-100',
        principalId: 'operator-a',
        config: sampleConfig,
        policy: samplePolicy,
        store,
        approval,
        expectedHash: 'hash-abc',
        cardTitle: 'Create Banner',
        listName: 'To Do',
        intentKey: 'intent-key-100',
        sourceKey: 'source-key-100',
      });

      expect(result.status).toBe('succeeded');
      expect(result.receipt?.cardId).toBe('card-new-1');
      expect(result.receipt?.url).toBe('https://trello.com/c/card-new-1');

      const res = await store.getReservation('intent-key-100');
      expect(res?.status).toBe('confirmed');
    });

    it('rejects dispatch if approval is expired', async () => {
      const store = new InMemoryReservationStore();
      const approval: PilotApprovalContext = {
        approvalId: 'app-1',
        ownerId: 'operator-a',
        expiresAt: new Date(Date.now() - 1000), // expired
        snapshotHash: 'hash-abc',
        decision: 'approved',
      };

      const result = await executePilotWorkflow({
        runId: 'run-101',
        principalId: 'operator-a',
        config: sampleConfig,
        policy: samplePolicy,
        store,
        approval,
        expectedHash: 'hash-abc',
        cardTitle: 'Task',
        listName: 'To Do',
        intentKey: 'k-exp',
        sourceKey: 's-exp',
      });

      expect(result.status).toBe('expired');
      expect(result.receipt).toBeUndefined();
    });

    it('transitions to reconciliation_required and marks reservation unknown when remote write fails', async () => {
      const store = new InMemoryReservationStore();

      // Mock Trello: 1. list_lists ok, 2. create_card network crash/timeout
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify([{ id: 'l1', name: 'To Do', closed: false }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockRejectedValueOnce(new Error('ETIMEDOUT: Connection lost after sending payload'));

      const approval: PilotApprovalContext = {
        approvalId: 'app-1',
        ownerId: 'operator-a',
        expiresAt: new Date(Date.now() + 600000),
        snapshotHash: 'hash-abc',
        decision: 'approved',
      };

      const result = await executePilotWorkflow({
        runId: 'run-102',
        principalId: 'operator-a',
        config: sampleConfig,
        policy: samplePolicy,
        store,
        approval,
        expectedHash: 'hash-abc',
        cardTitle: 'Task',
        listName: 'To Do',
        intentKey: 'k-timeout',
        sourceKey: 's-timeout',
      });

      expect(result.status).toBe('reconciliation_required');
      const res = await store.getReservation('k-timeout');
      expect(res?.status).toBe('unknown');
    });
  });
});
