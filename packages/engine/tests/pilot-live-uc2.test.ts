import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { executeLiveUc2Intake } from '../src/pilot/live-uc2-runner.js';
import { InMemoryReservationStore } from '../src/pilot/dispatch.js';
import type { PilotConfig } from '../src/pilot/config.js';
import type { PilotPolicy } from '../src/pilot/policy.js';
import type { SourceRow } from '../src/pilot/source.js';
import { randomUUID } from 'node:crypto';
import type { LiveUc2Approval, LiveUc2Options } from '../src/pilot/live-uc2-runner.js';

describe('BE-27: Live Manual UC2 + Receipt Execution Runner', () => {
  const originalFetch = globalThis.fetch;

  const validConfig: PilotConfig = {
    enabled: true,
    principals: ['operator-1'],
    spreadsheetId: 'sheet-123',
    tabId: 'Requests',
    boardId: 'board-789',
    google: { apiKey: 'mock-google-key' },
    trello: { apiKey: 'mock-trello-key', apiToken: 'mock-trello-token' },
  };

  const validPolicy: PilotPolicy = {
    enabled: true,
    principals: ['operator-1'],
    spreadsheetId: 'sheet-123',
    tabId: 'Requests',
    boardId: 'board-789',
  };

  const validSourceRow: SourceRow = {
    request_id: 'REQ-002',
    client_ref: 'CLIENT-B',
    request_type: 'web_change',
    raw_request: 'Update landing hero text and CTA',
    deliverable: 'Website update /hero-section',
    due_date: '2026-10-15',
    decision_status: 'confirmed',
    source_note: 'Approved by marketing director',
  };

  async function approvedOptions(
    reservationStore: InMemoryReservationStore,
    approvalOverrides: Partial<LiveUc2Approval> = {},
    optionOverrides: Partial<LiveUc2Options> = {},
  ): Promise<LiveUc2Options> {
    const runId = randomUUID();
    const previewCreatedAt = new Date('2026-09-23T10:00:00.000Z');
    const base: LiveUc2Options = {
      config: validConfig, policy: validPolicy, principalId: 'operator-1',
      sourceRow: validSourceRow, reservationStore, runId,
      now: new Date('2026-09-23T10:05:00.000Z'),
      approvalStore: { getApproval: async () => null },
    };
    const unapproved = await executeLiveUc2Intake(base);
    const approval: LiveUc2Approval = {
      runId, ownerId: 'operator-1', decision: 'approved',
      snapshotHash: unapproved.preview.snapshotHash, previewCreatedAt,
      ...approvalOverrides,
    };
    return {
      ...base, ...optionOverrides,
      approvalStore: { getApproval: async () => approval },
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('completes the full UC2 lifecycle: preview, approval, exactly 1 remote write, confirmed receipt', async () => {
    let writeCallsCount = 0;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const urlStr = url.toString();
      const method = init?.method ?? 'GET';

      // 1. Trello list resolution (Read)
      if (urlStr.includes('/lists') && method === 'GET') {
        return new Response(
          JSON.stringify([{ id: 'list-todo-1', name: 'To Do', closed: false }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // 2. Trello create card (Write - exactly 1 call)
      if (urlStr.includes('api.trello.com/1/cards') && method === 'POST') {
        writeCallsCount++;
        return new Response(
          JSON.stringify({
            id: 'card-live-999',
            url: 'https://trello.com/c/live999',
            idList: 'list-todo-1',
            idBoard: 'board-789',
            name: '[CLIENT-B] Update landing hero text and CTA',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('Not Found', { status: 404 });
    });

    const reservationStore = new InMemoryReservationStore();

    const options = await approvedOptions(reservationStore);
    const result = await executeLiveUc2Intake(options);

    expect(result.status).toBe('succeeded');
    expect(result.writeCount).toBe(1);
    expect(writeCallsCount).toBe(1);
    expect(result.receipt).toBeDefined();
    expect(result.receipt?.cardId).toBe('card-live-999');
    expect(result.receipt?.url).toBe('https://trello.com/c/live999');
    expect(result.reservationStatus).toBe('confirmed');

    // Verify reservation store reflects confirmed status
    const stored = await reservationStore.getReservation(result.intentKey);
    expect(stored?.status).toBe('confirmed');
    expect(stored?.remoteId).toBe('card-live-999');

    const replay = await executeLiveUc2Intake(options);
    expect(replay.status).toBe('succeeded');
    expect(replay.writeCount).toBe(0);
    expect(writeCallsCount).toBe(1);
    await expect(reservationStore.claimDispatched(result.intentKey, randomUUID()))
      .rejects.toThrow(/RESERVATION_NOT_CLAIMABLE/);
  });

  it('handles operator rejection without remote writes (0 writes, status cancelled)', async () => {
    let writeCallsCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      writeCallsCount++;
      return new Response('{}', { status: 200 });
    });

    const reservationStore = new InMemoryReservationStore();

    const result = await executeLiveUc2Intake(
      await approvedOptions(reservationStore, { decision: 'rejected' }),
    );

    expect(result.status).toBe('rejected');
    expect(result.writeCount).toBe(0);
    expect(writeCallsCount).toBe(0);
    expect(result.reservationStatus).toBe('cancelled');
  });

  it('requires a stored approval for the same owner before reserving or writing', async () => {
    const reservationStore = new InMemoryReservationStore();
    const options = await approvedOptions(reservationStore);
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const missing = await executeLiveUc2Intake({
      ...options, approvalStore: { getApproval: async () => null },
    });
    expect(missing.error).toContain('APPROVAL_REQUIRED');

    const wrongOwner = await executeLiveUc2Intake(await approvedOptions(reservationStore, {
      ownerId: 'another-operator',
    }));
    expect(wrongOwner.error).toContain('APPROVAL_REQUIRED');

    const disabled = await executeLiveUc2Intake({
      ...options, config: { ...validConfig, enabled: false },
    });
    expect(disabled.error).toContain('CONFIG_ERROR');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await reservationStore.getReservation(missing.intentKey)).toBeNull();
  });

  it('rejects tampered snapshot hash before dispatch (SNAPSHOT_MISMATCH, 0 writes)', async () => {
    let writeCallsCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      writeCallsCount++;
      return new Response('{}', { status: 200 });
    });

    const reservationStore = new InMemoryReservationStore();

    const result = await executeLiveUc2Intake(await approvedOptions(reservationStore, {
      snapshotHash: '0000000000000000000000000000000000000000000000000000000000000000',
    }));

    expect(result.status).toBe('failed');
    expect(result.error).toContain('SNAPSHOT_MISMATCH');
    expect(result.writeCount).toBe(0);
    expect(writeCallsCount).toBe(0);
  });

  it('rejects expired approvals past 10-minute server TTL (TTL_EXPIRED, 0 writes)', async () => {
    let writeCallsCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      writeCallsCount++;
      return new Response('{}', { status: 200 });
    });

    const reservationStore = new InMemoryReservationStore();
    const creationTime = new Date('2026-09-23T10:00:00.000Z');
    const pastTtlTime = new Date('2026-09-23T10:15:00.000Z'); // 15 mins later

    const result = await executeLiveUc2Intake(await approvedOptions(
      reservationStore, { previewCreatedAt: creationTime }, { now: pastTtlTime },
    ));

    expect(result.status).toBe('failed');
    expect(result.error).toContain('TTL_EXPIRED');
    expect(result.writeCount).toBe(0);
    expect(writeCallsCount).toBe(0);
  });

  it('enforces Zero Blind Retry: post-dispatch timeout transitions to reconciliation_required and unknown reservation', async () => {
    const reservationStore = new InMemoryReservationStore();

    const options = await approvedOptions(reservationStore, {}, { simulatedNetworkFault: 'timeout' });
    const result = await executeLiveUc2Intake(options);

    expect(result.status).toBe('reconciliation_required');
    expect(result.error).toContain('TIMEOUT');
    expect(result.reservationStatus).toBe('unknown');
    expect(result.writeCount).toBe(1);

    // Verify reservation store is in 'unknown' state
    const stored = await reservationStore.getReservation(result.intentKey);
    expect(stored?.status).toBe('unknown');

    // Attempting to run again on the same intentKey must be blocked with INTENT_IN_UNKNOWN_STATE
    await expect(
      executeLiveUc2Intake({ ...options, simulatedNetworkFault: undefined }),
    ).rejects.toThrow(/INTENT_IN_UNKNOWN_STATE/);
  });

  it('quarantines an invalid remote receipt after one POST', async () => {
    let posts = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts++;
        return new Response(JSON.stringify({ id: '', url: '' }), { status: 200 });
      }
      return new Response(JSON.stringify([{ id: 'list-todo-1', name: 'To Do', closed: false }]), { status: 200 });
    });
    const reservationStore = new InMemoryReservationStore();
    const result = await executeLiveUc2Intake(await approvedOptions(reservationStore));
    expect(result.status).toBe('reconciliation_required');
    expect(result.reservationStatus).toBe('unknown');
    expect(posts).toBe(1);
    expect((await reservationStore.getReservation(result.intentKey))?.status).toBe('unknown');
  });

  it('quarantines a successful POST when receipt persistence fails', async () => {
    let posts = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts++;
        return new Response(JSON.stringify({ id: 'card-1', url: 'https://trello.com/c/card-1' }), { status: 200 });
      }
      return new Response(JSON.stringify([{ id: 'list-todo-1', name: 'To Do', closed: false }]), { status: 200 });
    });
    const reservationStore = new InMemoryReservationStore();
    vi.spyOn(reservationStore, 'confirm').mockRejectedValueOnce(new Error('DB_UNAVAILABLE'));
    const result = await executeLiveUc2Intake(await approvedOptions(reservationStore));
    expect(result.status).toBe('reconciliation_required');
    expect(result.error).toContain('DB_UNAVAILABLE');
    expect(result.reservationStatus).toBe('unknown');
    expect(posts).toBe(1);
    expect((await reservationStore.getReservation(result.intentKey))?.status).toBe('unknown');
  });

  it('reports reconciliation even when the unknown-state update fails', async () => {
    const reservationStore = new InMemoryReservationStore();
    vi.spyOn(reservationStore, 'markUnknown').mockRejectedValueOnce(new Error('DB_UNAVAILABLE'));
    const options = await approvedOptions(reservationStore, {}, { simulatedNetworkFault: 'timeout' });
    const result = await executeLiveUc2Intake(options);
    expect(result.status).toBe('reconciliation_required');
    expect(result.reservationStatus).toBe('dispatched');
    expect(result.error).toContain('MARK_UNKNOWN_FAILED');
    await expect(executeLiveUc2Intake(options)).rejects.toThrow(/INTENT_ALREADY_RESERVED/);
  });
});
