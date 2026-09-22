import { expect, it, describe, vi, afterEach } from 'vitest';
import { getPilotCatalog, dispatchPilotTool } from '../src/pilot/gateway.js';
import type { PilotConfig } from '../src/pilot/config.js';
import type { PilotPolicy } from '../src/pilot/policy.js';

describe('pilot/gateway', () => {
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

  it('provides the reviewed 5-tool catalog with schema and sideEffect definitions', () => {
    const catalog = getPilotCatalog();
    expect(catalog).toHaveLength(5);

    const names = catalog.map((t) => t.name);
    expect(names).toEqual([
      'google_sheets.read_request',
      'trello.list_lists',
      'trello.list_members',
      'trello.get_card',
      'trello.create_card',
    ]);

    const createCard = catalog.find((t) => t.name === 'trello.create_card');
    expect(createCard?.sideEffect).toBe('write');

    const readRequest = catalog.find((t) => t.name === 'google_sheets.read_request');
    expect(readRequest?.sideEffect).toBe('read');
  });

  it('dispatches to trello.list_lists successfully', async () => {
    const mockLists = [{ id: 'l1', name: 'To Do', closed: false }];
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockLists), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const result = await dispatchPilotTool('trello.list_lists', { boardId: 'board-456' }, {
      config: sampleConfig,
      policy: samplePolicy,
      principalId: 'operator-a',
    });

    expect(result).toEqual(mockLists);
  });

  it('rejects unknown tool name with UNKNOWN_TOOL error', async () => {
    await expect(
      dispatchPilotTool('unknown.tool', {}, {
        config: sampleConfig,
        policy: samplePolicy,
        principalId: 'operator-a',
      }),
    ).rejects.toThrow('UNKNOWN_TOOL');
  });
});
