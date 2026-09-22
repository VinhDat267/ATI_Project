import { expect, it } from 'vitest';
import { assertPilotAccess, type PilotPolicy } from '../src/pilot/policy.js';

const policy: PilotPolicy = {
  enabled: true,
  principals: ['operator-a'],
  spreadsheetId: 'sheet-id',
  tabId: 'tab-id',
  boardId: 'board-id',
};

it('allows exact source and board only', () => {
  expect(() =>
    assertPilotAccess(policy, 'operator-a', { kind: 'board', boardId: 'board-id' }),
  ).not.toThrow();
  expect(() =>
    assertPilotAccess(policy, 'operator-a', {
      kind: 'source',
      spreadsheetId: 'sheet-id',
      tabId: 'tab-id',
    }),
  ).not.toThrow();
});

it('denies labels, another principal and revoked policy', () => {
  expect(() =>
    assertPilotAccess(policy, 'operator-b', { kind: 'board', boardId: 'board-id' }),
  ).toThrow('ACCESS_DENIED');
  expect(() =>
    assertPilotAccess(policy, 'operator-a', { kind: 'board', boardId: 'Board name' }),
  ).toThrow('ACCESS_DENIED');
  expect(() =>
    assertPilotAccess({ ...policy, enabled: false }, 'operator-a', {
      kind: 'board',
      boardId: 'board-id',
    }),
  ).toThrow('ACCESS_DENIED');
});

it('checks the tab, not just the spreadsheet', () => {
  expect(() =>
    assertPilotAccess(policy, 'operator-a', {
      kind: 'source',
      spreadsheetId: 'sheet-id',
      tabId: 'other',
    }),
  ).toThrow('ACCESS_DENIED');
});
