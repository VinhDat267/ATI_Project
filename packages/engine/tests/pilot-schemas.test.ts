import { expect, it, describe } from 'vitest';
import {
  PilotProfileSchema,
  SourceSnapshotSchema,
  BusinessReservationSchema,
  TrelloReceiptSchema,
  PilotRunRequestSchema,
} from '../src/pilot/schemas.js';

describe('pilot/schemas', () => {
  it('validates a correct pilot profile', () => {
    const valid = {
      id: 'pilot-v2',
      enabled: true,
      principals: ['operator-a', 'operator-b'],
      spreadsheetId: 'sheet-123',
      tabId: 'tab-456',
      boardId: 'board-789',
    };
    expect(PilotProfileSchema.parse(valid)).toEqual(valid);
  });

  it('rejects invalid pilot profile with missing or bad fields', () => {
    expect(() =>
      PilotProfileSchema.parse({
        id: 'other',
        enabled: true,
        principals: [],
      }),
    ).toThrow();
  });

  it('validates source snapshot schema', () => {
    const validSnapshot = {
      runId: '11111111-1111-4111-8111-111111111111',
      sourceKey: 'source-key-123',
      sourceRevision: 'a'.repeat(64),
      rawData: {
        request_id: 'REQ-1',
        client_ref: 'Acme',
        request_type: 'web_change',
        raw_request: 'text',
        deliverable: 'page',
        due_date: '2026-10-01',
        decision_status: 'confirmed',
        source_note: '',
      },
      checklistVersion: 'pilot-checklist-1',
      checklistResult: {
        status: 'pass',
        missingFields: [],
        conflicts: [],
        unconfirmedBusiness: false,
      },
    };
    expect(SourceSnapshotSchema.parse(validSnapshot)).toMatchObject({
      runId: validSnapshot.runId,
      sourceRevision: validSnapshot.sourceRevision,
    });
  });

  it('validates business reservation transitions and statuses', () => {
    const validReservation = {
      intentKey: 'b'.repeat(64),
      sourceKey: 'source-key-123',
      boardId: 'board-789',
      runId: '11111111-1111-4111-8111-111111111111',
      status: 'reserved',
    };
    expect(BusinessReservationSchema.parse(validReservation).status).toBe('reserved');

    const confirmedReservation = {
      ...validReservation,
      status: 'confirmed',
      remoteId: 'card-123',
      remoteUrl: 'https://trello.com/c/card-123',
    };
    expect(BusinessReservationSchema.parse(confirmedReservation).status).toBe('confirmed');

    expect(() =>
      BusinessReservationSchema.parse({
        ...validReservation,
        status: 'invalid_status',
      }),
    ).toThrow();
  });

  it('validates trello receipt schema', () => {
    const validReceipt = {
      cardId: 'c123',
      url: 'https://trello.com/c/c123',
      listId: 'list1',
      boardId: 'board1',
      title: 'Task title',
      intentKey: 'c'.repeat(64),
    };
    expect(TrelloReceiptSchema.parse(validReceipt)).toEqual(validReceipt);
  });

  it('validates pilot run request schema', () => {
    const validRequest = {
      spreadsheetId: 'sheet-1',
      tabId: 'tab-1',
      requestId: 'REQ-1',
      prompt: 'Check requirement and create Trello card if ready',
      principalId: 'operator-a',
    };
    const parsed = PilotRunRequestSchema.parse(validRequest);
    expect(parsed.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(parsed.requestId).toBe('REQ-1');
  });
});
