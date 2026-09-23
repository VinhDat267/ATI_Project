import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { runPilotLivePreflight } from '../src/pilot/live-preflight.js';

describe('BE-26: SaaS Setup & Live Read Preflight', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fails-closed as BLOCKED_EXTERNAL when credentials are not configured', async () => {
    const result = await runPilotLivePreflight({
      config: { enabled: false },
    });

    expect(result.status).toBe('blocked_external');
    expect(result.evidenceLabel).toBe('BLOCKED_EXTERNAL');
    expect(result.checks.config.enabled).toBe(false);
    expect(result.checks.sheetsRead.status).toBe('skipped');
    expect(result.checks.trelloRead.status).toBe('skipped');
    expect(result.checks.writeVerification.writesAttempted).toBe(0);
  });

  it('fails-closed when target IDs are missing', async () => {
    const result = await runPilotLivePreflight({
      config: {
        enabled: true,
        principals: ['operator'],
        spreadsheetId: '',
        tabId: '',
        boardId: '',
      },
    });

    expect(result.status).toBe('blocked_external');
    expect(result.evidenceLabel).toBe('BLOCKED_EXTERNAL');
    expect(result.checks.config.status).toBe('fail');
  });

  it('successfully completes preflight read checks and verifies 0 writes when valid', async () => {
    // Mock global fetch for both Google Sheets and Trello read endpoints
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('sheets.googleapis.com')) {
        return new Response(
          JSON.stringify({
            values: [
              ['request_id', 'client_ref', 'request_type', 'raw_request', 'deliverable', 'due_date', 'decision_status', 'source_note'],
              ['REQ-001', 'CLIENT-A', 'design_asset', 'Design home banner', 'Hero Banner Figma 1920x1080', '2026-10-01', 'confirmed', 'Priority client'],
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (urlStr.includes('api.trello.com') && urlStr.includes('/lists')) {
        return new Response(
          JSON.stringify([
            { id: 'list-1', name: 'To Do', closed: false },
            { id: 'list-2', name: 'In Progress', closed: false },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (urlStr.includes('api.trello.com') && urlStr.includes('/members')) {
        return new Response(
          JSON.stringify([
            { id: 'member-1', fullName: 'Alice Designer', username: 'alice' },
            { id: 'member-2', fullName: 'Bob Reviewer', username: 'bob' },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not Found', { status: 404 });
    });

    const result = await runPilotLivePreflight({
      config: {
        enabled: true,
        principals: ['operator-1'],
        spreadsheetId: 'sheet-abc-123',
        tabId: 'Requests',
        boardId: 'board-xyz-789',
        google: { apiKey: 'mock-google-key-secret-999' },
        trello: { apiKey: 'mock-trello-key-888', apiToken: 'mock-trello-token-777' },
      },
      testRequestId: 'REQ-001',
    });

    expect(result.status).toBe('passed');
    expect(result.evidenceLabel).toBe('CONFIRMED');
    expect(result.checks.sheetsRead.status).toBe('pass');
    expect(result.checks.sheetsRead.sampleResult?.requestId).toBe('REQ-001');
    expect(result.checks.sheetsRead.sampleResult?.checklistStatus).toBe('pass');

    expect(result.checks.trelloRead.status).toBe('pass');
    expect(result.checks.trelloRead.listsCount).toBe(2);
    expect(result.checks.trelloRead.membersCount).toBe(2);

    expect(result.checks.writeVerification.writesAttempted).toBe(0);
  });

  it('redacts secrets from errors and logs when upstream HTTP fails', async () => {
    const sensitiveApiKey = 'super-secret-trello-key-12345';
    const sensitiveToken = 'super-secret-trello-token-67890';

    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('sheets.googleapis.com')) {
        return new Response(
          JSON.stringify({
            values: [
              ['request_id', 'client_ref', 'request_type', 'raw_request', 'deliverable', 'due_date', 'decision_status', 'source_note'],
              ['REQ-001', 'CLIENT-A', 'design_asset', 'Design home banner', 'Hero Banner Figma 1920x1080', '2026-10-01', 'confirmed', 'Priority client'],
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // Trello returns 401 with sensitive token in error URL
      return new Response(
        `Unauthorized access with key=${sensitiveApiKey}&token=${sensitiveToken}`,
        { status: 401, statusText: 'Unauthorized' },
      );
    });

    const result = await runPilotLivePreflight({
      config: {
        enabled: true,
        principals: ['operator-1'],
        spreadsheetId: 'sheet-abc-123',
        tabId: 'Requests',
        boardId: 'board-xyz-789',
        google: { apiKey: 'mock-google-key-secret-999' },
        trello: { apiKey: sensitiveApiKey, apiToken: sensitiveToken },
      },
      testRequestId: 'REQ-001',
    });

    expect(result.status).toBe('failed');
    expect(result.checks.trelloRead.status).toBe('fail');
    const jsonStr = JSON.stringify(result);
    expect(jsonStr).not.toContain(sensitiveApiKey);
    expect(jsonStr).not.toContain(sensitiveToken);
    expect(result.checks.writeVerification.writesAttempted).toBe(0);
  });
});
