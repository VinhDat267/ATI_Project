import { expect, it, describe, vi, afterEach } from 'vitest';
import { readSheetsRequest } from '../src/pilot/adapters/sheets.js';
import { SOURCE_COLUMNS } from '../src/pilot/source.js';
import { createIntentKey } from '../src/pilot/identity.js';
import {
  InMemoryReservationStore,
  executePilotWorkflow,
  type PilotApprovalContext,
} from '../src/pilot/dispatch.js';
import { trelloGetCard } from '../src/pilot/adapters/trello-read.js';
import type { PilotPolicy } from '../src/pilot/policy.js';
import type { PilotConfig } from '../src/pilot/config.js';

describe('pilot/vertical-slice (UC2 End-to-End)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const policy: PilotPolicy = {
    enabled: true,
    principals: ['operator-alice'],
    spreadsheetId: 'sheet-agency-2026',
    tabId: 'ClientRequests',
    boardId: 'board-web-dev',
  };

  const config: PilotConfig = {
    ...policy,
    google: { apiKey: 'google-sheets-key' },
    trello: { apiKey: 'trello-key', apiToken: 'trello-token' },
  };

  it('runs complete UC2 pipeline: Sheets read -> checklist pass -> approval -> Trello create -> UC3 lookup', async () => {
    // 1. Mock Google Sheets response
    const mockSheetRow = [
      'REQ-401',
      'Acme Studio',
      'web_change',
      'Update navigation menu links and mobile drawer. Details at https://acme.com/nav',
      'Nav menu update on https://acme.com/nav',
      '2026-10-30',
      'confirmed',
      'Client signed off on staging demo',
    ];

    // Mock Trello responses:
    // a. list_lists -> find 'To Do'
    // b. create_card -> card created
    // c. get_card -> read back for UC3
    const mockLists = [
      { id: 'list-todo-1', name: 'To Do', closed: false },
      { id: 'list-doing-2', name: 'Doing', closed: false },
    ];
    const mockCreatedCard = {
      id: 'card-trello-401',
      url: 'https://trello.com/c/card-trello-401',
      idBoard: 'board-web-dev',
      idList: 'list-todo-1',
      name: 'Update nav menu (REQ-401)',
      desc: 'Nav menu update on https://acme.com/nav',
      due: '2026-10-30',
      idMembers: [],
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      // 1. Sheets read
      .mockResolvedValueOnce(new Response(JSON.stringify({ values: [SOURCE_COLUMNS, mockSheetRow] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      // 2. Trello list_lists
      .mockResolvedValueOnce(new Response(JSON.stringify(mockLists), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      // 3. Trello create_card
      .mockResolvedValueOnce(new Response(JSON.stringify(mockCreatedCard), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      // 4. Trello get_card (UC3 lookup)
      .mockResolvedValueOnce(new Response(JSON.stringify(mockCreatedCard), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    // STEP 1: Intake & Preflight Read
    const preflight = await readSheetsRequest({
      config,
      policy,
      principalId: 'operator-alice',
      spreadsheetId: policy.spreadsheetId,
      tabId: policy.tabId,
      requestId: 'REQ-401',
    });

    expect(preflight.row.request_id).toBe('REQ-401');
    expect(preflight.checklist.status).toBe('pass');
    expect(preflight.checklist.missingFields).toHaveLength(0);

    // STEP 2: Intent Key Construction
    const intentKey = createIntentKey(
      {
        groupId: policy.boardId,
        spreadsheetId: policy.spreadsheetId,
        tabId: policy.tabId,
        requestId: 'REQ-401',
      },
      policy.boardId,
    );
    expect(intentKey).toHaveLength(64);

    // STEP 3: Preview & Approval
    const snapshotHash = 'sha256-snapshot-preview-hash-401';
    const approval: PilotApprovalContext = {
      approvalId: 'app-401',
      ownerId: 'operator-alice',
      expiresAt: new Date(Date.now() + 600000), // 10 minutes TTL
      snapshotHash,
      decision: 'approved',
    };

    // STEP 4: Dispatch with Durable Business Reservation
    const store = new InMemoryReservationStore();
    const result = await executePilotWorkflow({
      runId: 'run-vertical-401',
      principalId: 'operator-alice',
      config,
      policy,
      store,
      approval,
      expectedHash: snapshotHash,
      cardTitle: 'Update nav menu (REQ-401)',
      listName: 'To Do',
      description: preflight.row.deliverable,
      dueDate: preflight.row.due_date,
      intentKey,
      sourceKey: preflight.sourceKey,
    });

    expect(result.status).toBe('succeeded');
    expect(result.receipt?.cardId).toBe('card-trello-401');
    expect(result.receipt?.url).toBe('https://trello.com/c/card-trello-401');

    // Verify reservation state in DB store
    const reservation = await store.getReservation(intentKey);
    expect(reservation?.status).toBe('confirmed');
    expect(reservation?.remoteId).toBe('card-trello-401');

    // STEP 5: UC3 Lookup (Read back by Card ID)
    const lookupCard = await trelloGetCard({
      config,
      policy,
      principalId: 'operator-alice',
      cardId: result.receipt!.cardId,
    });

    expect(lookupCard.id).toBe('card-trello-401');
    expect(lookupCard.name).toBe('Update nav menu (REQ-401)');
    expect(lookupCard.url).toBe('https://trello.com/c/card-trello-401');
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});
