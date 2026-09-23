import { expect, it, describe, vi, afterEach } from 'vitest';
import {
  InMemoryReservationStore,
  executePilotWorkflow,
  type PilotApprovalContext,
} from '../src/pilot/dispatch.js';
import { evaluateChecklist } from '../src/pilot/checklist.js';
import type { SourceRow } from '../src/pilot/source.js';
import type { PilotPolicy } from '../src/pilot/policy.js';
import type { PilotConfig } from '../src/pilot/config.js';

describe('pilot/fault-suite (10 Fault Injection & Safety Gate Tests)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const policy: PilotPolicy = {
    enabled: true,
    principals: ['operator-a'],
    spreadsheetId: 'sheet-agency-2026',
    tabId: 'ClientRequests',
    boardId: 'board-web-dev',
  };

  const config: PilotConfig = {
    ...policy,
    trello: { apiKey: 'k', apiToken: 't' },
  };

  const validApproval = (overrides?: Partial<PilotApprovalContext>): PilotApprovalContext => ({
    approvalId: 'app-fault-1',
    ownerId: 'operator-a',
    expiresAt: new Date(Date.now() + 600000), // 10 minutes TTL
    snapshotHash: 'hash-expected-123',
    decision: 'approved',
    ...overrides,
  });

  // FAULT 1: Trello network timeout during create_card
  it('Fault 1: Trello timeout marks unknown, retains reservation, never retries write', async () => {
    const store = new InMemoryReservationStore();
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'l1', name: 'To Do', closed: false }]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockImplementationOnce(() => new Promise((_, reject) => {
        const err = new Error('Connection timed out after 30000ms');
        err.name = 'AbortError';
        setTimeout(() => reject(err), 5);
      }));

    const result = await executePilotWorkflow({
      runId: 'run-f1',
      principalId: 'operator-a',
      config,
      policy,
      store,
      approval: validApproval(),
      expectedHash: 'hash-expected-123',
      cardTitle: 'Task',
      listName: 'To Do',
      intentKey: 'intent-f1',
      sourceKey: 'source-f1',
    });

    expect(result.status).toBe('reconciliation_required');
    expect(result.error).toContain('REMOTE_WRITE_UNKNOWN');
    const res = await store.getReservation('intent-f1');
    expect(res?.status).toBe('unknown');
    // Verify exactly 1 POST attempt was made (0 retries on write timeout)
    expect(fetchSpy).toHaveBeenCalledTimes(2); // 1 list_lists, 1 create_card
  });

  // FAULT 2: Trello returns invalid / corrupted JSON
  it('Fault 2: Trello invalid response marks unknown, no blind retry', async () => {
    const store = new InMemoryReservationStore();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'l1', name: 'To Do', closed: false }]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));

    const result = await executePilotWorkflow({
      runId: 'run-f2',
      principalId: 'operator-a',
      config,
      policy,
      store,
      approval: validApproval(),
      expectedHash: 'hash-expected-123',
      cardTitle: 'Task',
      listName: 'To Do',
      intentKey: 'intent-f2',
      sourceKey: 'source-f2',
    });

    expect(result.status).toBe('reconciliation_required');
    const res = await store.getReservation('intent-f2');
    expect(res?.status).toBe('unknown');
  });

  // FAULT 3: Expired approval (> 10 minutes)
  it('Fault 3: Expired approval blocks dispatch with status expired', async () => {
    const store = new InMemoryReservationStore();
    const result = await executePilotWorkflow({
      runId: 'run-f3',
      principalId: 'operator-a',
      config,
      policy,
      store,
      approval: validApproval({ expiresAt: new Date(Date.now() - 5000) }),
      expectedHash: 'hash-expected-123',
      cardTitle: 'Task',
      listName: 'To Do',
      intentKey: 'intent-f3',
      sourceKey: 'source-f3',
    });

    expect(result.status).toBe('expired');
    expect(result.error).toContain('APPROVAL_EXPIRED');
  });

  // FAULT 4: Snapshot hash mismatch (source or payload drifted)
  it('Fault 4: Snapshot hash mismatch blocks dispatch', async () => {
    const store = new InMemoryReservationStore();
    const result = await executePilotWorkflow({
      runId: 'run-f4',
      principalId: 'operator-a',
      config,
      policy,
      store,
      approval: validApproval({ snapshotHash: 'hash-stale-drifted' }),
      expectedHash: 'hash-expected-123',
      cardTitle: 'Task',
      listName: 'To Do',
      intentKey: 'intent-f4',
      sourceKey: 'source-f4',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('SNAPSHOT_MISMATCH');
  });

  // FAULT 5: Owner isolation violation (operator B approves operator A's run)
  it('Fault 5: Cross-principal owner mismatch blocks execution', async () => {
    const store = new InMemoryReservationStore();
    const result = await executePilotWorkflow({
      runId: 'run-f5',
      principalId: 'operator-b', // Unauthorized operator
      config,
      policy,
      store,
      approval: validApproval({ ownerId: 'operator-a' }),
      expectedHash: 'hash-expected-123',
      cardTitle: 'Task',
      listName: 'To Do',
      intentKey: 'intent-f5',
      sourceKey: 'source-f5',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('FORBIDDEN');
  });

  // FAULT 6: Decision rejected by operator
  it('Fault 6: Explicit rejection marks status rejected without remote call', async () => {
    const store = new InMemoryReservationStore();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await executePilotWorkflow({
      runId: 'run-f6',
      principalId: 'operator-a',
      config,
      policy,
      store,
      approval: validApproval({ decision: 'rejected' }),
      expectedHash: 'hash-expected-123',
      cardTitle: 'Task',
      listName: 'To Do',
      intentKey: 'intent-f6',
      sourceKey: 'source-f6',
    });

    expect(result.status).toBe('rejected');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // FAULT 7: Duplicate intent key blocks second card creation
  it('Fault 7: Second run with same intent key is blocked by reservation', async () => {
    const store = new InMemoryReservationStore();
    await store.reserve({
      intentKey: 'intent-duplicate',
      sourceKey: 'source-duplicate',
      boardId: policy.boardId,
      runId: 'run-first',
    });

    const result = await executePilotWorkflow({
      runId: 'run-second',
      principalId: 'operator-a',
      config,
      policy,
      store,
      approval: validApproval(),
      expectedHash: 'hash-expected-123',
      cardTitle: 'Task',
      listName: 'To Do',
      intentKey: 'intent-duplicate',
      sourceKey: 'source-duplicate',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('INTENT_ALREADY_RESERVED');
  });

  // FAULT 8: Target list not found on board
  it('Fault 8: Target list missing after dispatch claim requires reconciliation', async () => {
    const store = new InMemoryReservationStore();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 'l1', name: 'Archive', closed: false }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await executePilotWorkflow({
      runId: 'run-f8',
      principalId: 'operator-a',
      config,
      policy,
      store,
      approval: validApproval(),
      expectedHash: 'hash-expected-123',
      cardTitle: 'Task',
      listName: 'To Do', // Does not exist in board lists
      intentKey: 'intent-f8',
      sourceKey: 'source-f8',
    });

    expect(result.status).toBe('reconciliation_required');
    expect(result.error).toContain('LIST_NOT_FOUND');
    expect((await store.getReservation('intent-f8'))?.status).toBe('unknown');
  });

  // FAULT 9: Policy disabled dynamically before dispatch
  it('Fault 9: Disabled policy blocks execution', async () => {
    const store = new InMemoryReservationStore();
    const disabledPolicy: PilotPolicy = { ...policy, enabled: false };

    const result = await executePilotWorkflow({
      runId: 'run-f9',
      principalId: 'operator-a',
      config: { ...config, enabled: false },
      policy: disabledPolicy,
      store,
      approval: validApproval(),
      expectedHash: 'hash-expected-123',
      cardTitle: 'Task',
      listName: 'To Do',
      intentKey: 'intent-f9',
      sourceKey: 'source-f9',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('ACCESS_DENIED');
  });

  // FAULT 10: Unconfirmed business decision stops before dispatch
  it('Fault 10: Unconfirmed business status stops workflow with needs_input', () => {
    const unconfirmedRow: SourceRow = {
      request_id: 'REQ-UNCONFIRMED',
      client_ref: 'Client A',
      request_type: 'web_change',
      raw_request: 'Change hero image at https://acme.com',
      deliverable: 'Hero update',
      due_date: '2026-10-31',
      decision_status: 'pending review', // Not confirmed
      source_note: '',
    };

    const checklist = evaluateChecklist(unconfirmedRow);
    expect(checklist.status).toBe('needs_input');
    expect(checklist.unconfirmedBusiness).toBe(true);
    expect(checklist.missingFields).toContain('decision_status');
  });
});
