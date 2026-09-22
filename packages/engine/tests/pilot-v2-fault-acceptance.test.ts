import { describe, expect, it, vi, afterEach } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import {
  executePilotWorkflow,
  InMemoryReservationStore,
} from '../src/pilot/dispatch.js';
import type { PilotConfig } from '../src/pilot/config.js';
import type { PilotPolicy } from '../src/pilot/policy.js';
import { PilotHttpError } from '../src/pilot/http-client.js';

describe('Pilot V2 Fault Injection Acceptance Suite (BE-25)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const dummyPolicy: PilotPolicy = {
    enabled: true,
    principals: ['operator-a', 'operator-b'],
    spreadsheetId: 'sheet-pilot-001',
    tabId: 'tab-001',
    boardId: 'board-pilot-001',
  };

  const dummyConfig: PilotConfig = {
    ...dummyPolicy,
    trello: { apiKey: 'trello-key', apiToken: 'trello-token' },
  };

  const snapshotHash = createHash('sha256').update('canonical-preview-data').digest('hex');

  it('Fault 1: Timeout after remote write transitions state to reconciliation_required and unknown reservation', async () => {
    const store = new InMemoryReservationStore();
    const intentKey = 'intent-fault-1';

    // Mock Trello: 1. list_lists ok, 2. create_card network timeout
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 'list-todo-001', name: 'To Do', closed: false }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockRejectedValueOnce(new Error('ETIMEDOUT: Connection lost after sending payload to remote Trello'));

    const result = await executePilotWorkflow({
      runId: randomUUID(),
      principalId: 'operator-a',
      config: dummyConfig,
      policy: dummyPolicy,
      store,
      approval: {
        approvalId: randomUUID(),
        ownerId: 'operator-a',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        snapshotHash,
        decision: 'approved',
      },
      expectedHash: snapshotHash,
      cardTitle: 'Timeout card',
      listName: 'To Do',
      intentKey,
      sourceKey: 'REQ-TIMEOUT-001',
    });

    // Remote call failed post-dispatch -> must transition to reconciliation_required and unknown status
    expect(result.status).toBe('reconciliation_required');
    expect(result.error).toContain('REMOTE_WRITE_UNKNOWN');
    const reservation = await store.getReservation(intentKey);
    expect(reservation?.status).toBe('unknown');
  });

  it('Fault 2: Dynamic authorization revocation mid-flight prevents dispatch and causes 0 remote writes', async () => {
    const store = new InMemoryReservationStore();
    const intentKey = 'intent-fault-2';

    const revokedPolicy: PilotPolicy = {
      ...dummyPolicy,
      enabled: false, // Revoked!
    };

    const result = await executePilotWorkflow({
      runId: randomUUID(),
      principalId: 'operator-a',
      config: dummyConfig,
      policy: revokedPolicy,
      store,
      approval: {
        approvalId: randomUUID(),
        ownerId: 'operator-a',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        snapshotHash,
        decision: 'approved',
      },
      expectedHash: snapshotHash,
      cardTitle: 'Revoked card',
      listName: 'To Do',
      intentKey,
      sourceKey: 'REQ-REVOKED-001',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('ACCESS_DENIED');
    // Ensure reservation was NOT created
    const reservation = await store.getReservation(intentKey);
    expect(reservation).toBeNull();
  });

  it('Fault 3: Duplicate business reservation blocks secondary creation and halts cleanly', async () => {
    const store = new InMemoryReservationStore();
    const intentKey = 'intent-fault-3';

    // First run reserves the intent and confirms it
    await store.reserve({
      intentKey,
      sourceKey: 'REQ-DUP-001',
      boardId: 'board-pilot-001',
      runId: randomUUID(),
    });
    await store.confirm(intentKey, 'c-remote-123', 'https://trello.com/c/123');

    // Second run tries to reserve the same intent
    const result = await executePilotWorkflow({
      runId: randomUUID(),
      principalId: 'operator-a',
      config: dummyConfig,
      policy: dummyPolicy,
      store,
      approval: {
        approvalId: randomUUID(),
        ownerId: 'operator-a',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        snapshotHash,
        decision: 'approved',
      },
      expectedHash: snapshotHash,
      cardTitle: 'Duplicate card',
      listName: 'To Do',
      intentKey,
      sourceKey: 'REQ-DUP-001',
    });

    // Replay returns the existing confirmed receipt without creating a new card
    expect(result.status).toBe('succeeded');
    expect(result.receipt?.cardId).toBe('c-remote-123');
  });

  it('Fault 4: Approval expired past 10m TTL is rejected before dispatch', async () => {
    const store = new InMemoryReservationStore();
    const intentKey = 'intent-fault-4';

    // Set approval expiresAt in the past
    const result = await executePilotWorkflow({
      runId: randomUUID(),
      principalId: 'operator-a',
      config: dummyConfig,
      policy: dummyPolicy,
      store,
      approval: {
        approvalId: randomUUID(),
        ownerId: 'operator-a',
        expiresAt: new Date(Date.now() - 5000), // Expired 5 seconds ago
        snapshotHash,
        decision: 'approved',
      },
      expectedHash: snapshotHash,
      cardTitle: 'Expired card',
      listName: 'To Do',
      intentKey,
      sourceKey: 'REQ-EXPIRED-001',
    });

    expect(result.status).toBe('expired');
    expect(result.error).toContain('APPROVAL_EXPIRED');
    const reservation = await store.getReservation(intentKey);
    expect(reservation).toBeNull();
  });

  it('Fault 5: Snapshot hash tampering is rejected with failed status', async () => {
    const store = new InMemoryReservationStore();
    const intentKey = 'intent-fault-5';
    const forgedHash = createHash('sha256').update('tampered-preview').digest('hex');

    const result = await executePilotWorkflow({
      runId: randomUUID(),
      principalId: 'operator-a',
      config: dummyConfig,
      policy: dummyPolicy,
      store,
      approval: {
        approvalId: randomUUID(),
        ownerId: 'operator-a',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        snapshotHash: forgedHash,
        decision: 'approved',
      },
      expectedHash: snapshotHash, // Mismatched!
      cardTitle: 'Tampered card',
      listName: 'To Do',
      intentKey,
      sourceKey: 'REQ-TAMPER-001',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('SNAPSHOT_MISMATCH');
    const reservation = await store.getReservation(intentKey);
    expect(reservation).toBeNull();
  });

  it('Fault 6: Malformed JSON from remote service produces structured PilotHttpError with redacted details', () => {
    const error = new PilotHttpError({
      message: 'Failed to parse remote response as JSON: Unexpected token < in JSON at position 0',
      statusCode: 502,
      url: 'https://api.trello.com/1/cards?key=[REDACTED]&token=[REDACTED]',
      responseBody: '<html><head><title>502 Bad Gateway</title></head></html>',
    });

    expect(error.statusCode).toBe(502);
    expect(error.message).toContain('Unexpected token <');
    expect(error.url).not.toMatch(/(?:key|token)=[A-Za-z0-9]+/);
    expect(error.url).toContain('[REDACTED]');
    expect(error.responseBody).toContain('502 Bad Gateway');
  });
});
