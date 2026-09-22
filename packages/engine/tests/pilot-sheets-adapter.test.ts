import { expect, it, describe, vi, afterEach } from 'vitest';
import { readSheetsRequest } from '../src/pilot/adapters/sheets.js';
import { SOURCE_COLUMNS } from '../src/pilot/source.js';
import type { PilotPolicy } from '../src/pilot/policy.js';
import type { PilotConfig } from '../src/pilot/config.js';

describe('pilot/adapters/sheets', () => {
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
    google: {
      apiKey: 'test-google-api-key',
    },
  };

  it('reads and parses request successfully', async () => {
    const mockValues = [
      SOURCE_COLUMNS,
      ['REQ-1', 'Client A', 'web_change', 'Update home page text', 'Home page', '2026-10-15', 'confirmed', ''],
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ values: mockValues }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await readSheetsRequest({
      config: sampleConfig,
      policy: samplePolicy,
      principalId: 'operator-a',
      spreadsheetId: 'sheet-123',
      tabId: 'Requests',
      requestId: 'REQ-1',
    });

    expect(result.row.request_id).toBe('REQ-1');
    expect(result.row.client_ref).toBe('Client A');
    expect(result.checklist.status).toBe('needs_input'); // target_url missing
  });

  it('denies access if principal or spreadsheet is unauthorized', async () => {
    await expect(
      readSheetsRequest({
        config: sampleConfig,
        policy: samplePolicy,
        principalId: 'unauthorized-operator',
        spreadsheetId: 'sheet-123',
        tabId: 'Requests',
        requestId: 'REQ-1',
      }),
    ).rejects.toThrow('ACCESS_DENIED');
  });

  it('throws NOT_FOUND when requestId does not exist in the sheet', async () => {
    const mockValues = [
      SOURCE_COLUMNS,
      ['REQ-1', 'Client A', 'web_change', 'test', 'page', '2026-10-15', 'confirmed', ''],
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ values: mockValues }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      readSheetsRequest({
        config: sampleConfig,
        policy: samplePolicy,
        principalId: 'operator-a',
        spreadsheetId: 'sheet-123',
        tabId: 'Requests',
        requestId: 'NON_EXISTENT',
      }),
    ).rejects.toThrow('NOT_FOUND');
  });
});
