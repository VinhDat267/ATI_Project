import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { runPreflightCli, parseCliArgs, getCliUsage } from '../src/pilot/live-preflight-cli.js';

describe('BE-26: Live Preflight CLI Runner', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  });

  it('parses flags correctly and handles aliases', () => {
    const parsed1 = parseCliArgs(['-p', 'op-1', '-r', 'REQ-123', '-o', './out.json']);
    expect(parsed1.principal).toBe('op-1');
    expect(parsed1.requestId).toBe('REQ-123');
    expect(parsed1.outputPath).toBe('./out.json');

    const parsed2 = parseCliArgs(['--principal=op-2', '--request-id=REQ-456', '--output=./out2.json']);
    expect(parsed2.principal).toBe('op-2');
    expect(parsed2.requestId).toBe('REQ-456');
    expect(parsed2.outputPath).toBe('./out2.json');

    const parsedHelp = parseCliArgs(['--help']);
    expect(parsedHelp.hasHelp).toBe(true);

    const parsedWrite = parseCliArgs(['-p', 'op-1', '-r', 'REQ-1', '--write']);
    expect(parsedWrite.hasProhibitedWrite).toBe(true);

    const parsedFallback = parseCliArgs(['-p', 'op-1', '-r', 'REQ-1', '--allow-simulated-fallback']);
    expect(parsedFallback.hasProhibitedFallback).toBe(true);
  });

  it('prints usage and exits 0 on --help', async () => {
    let stdout = '';
    const exitCode = await runPreflightCli(['--help'], {
      stdout: (msg) => { stdout += msg; },
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage: live-preflight-cli');
    expect(stdout).toContain('--principal');
    expect(stdout).toContain('--request-id');
  });

  it('fails-closed and exits 1 when prohibited write flag is passed', async () => {
    let stderr = '';
    const exitCode = await runPreflightCli(['-p', 'op-1', '-r', 'REQ-1', '--write'], {
      stderr: (msg) => { stderr += msg; },
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('CLI_ERROR: Preflight CLI is strictly read-only and accepts no write options');
  });

  it('fails-closed and exits 1 when prohibited simulated fallback is passed', async () => {
    let stderr = '';
    const exitCode = await runPreflightCli(['-p', 'op-1', '-r', 'REQ-1', '--allow-simulated-fallback'], {
      stderr: (msg) => { stderr += msg; },
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('CONFIG_ERROR: Simulated fallback is rejected');
  });

  it('fails-closed and exits 1 when --principal is missing', async () => {
    let stderr = '';
    const exitCode = await runPreflightCli(['-r', 'REQ-1'], {
      stderr: (msg) => { stderr += msg; },
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('CLI_ERROR: Missing required flag --principal');
  });

  it('fails-closed and exits 1 when --request-id is missing', async () => {
    let stderr = '';
    const exitCode = await runPreflightCli(['-p', 'op-1'], {
      stderr: (msg) => { stderr += msg; },
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('CLI_ERROR: Missing required flag --request-id');
  });

  it('executes preflight, writes output file, verifies 0 writes, and exits 0 on success', async () => {
    process.env.PILOT_V2_ENABLED = 'true';
    process.env.PILOT_PRINCIPALS = 'operator-alpha,operator-beta';
    process.env.PILOT_SPREADSHEET_ID = 'test-spreadsheet-id';
    process.env.PILOT_TAB_ID = 'IntakeRequests';
    process.env.PILOT_BOARD_ID = 'test-board-id';
    process.env.GOOGLE_SHEETS_API_KEY = 'secret-sheets-api-key-999';
    process.env.TRELLO_API_KEY = 'secret-trello-api-key-888';
    process.env.TRELLO_API_TOKEN = 'secret-trello-token-777';

    const recordedCalls: Array<{ url: string; method: string }> = [];

    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const urlStr = url.toString();
      recordedCalls.push({ url: urlStr, method: init?.method ?? 'GET' });

      if (urlStr.includes('sheets.googleapis.com')) {
        return new Response(
          JSON.stringify({
            values: [
              ['request_id', 'client_ref', 'request_type', 'raw_request', 'deliverable', 'due_date', 'decision_status', 'source_note'],
              ['REQ-TEST-01', 'Acme Corp', 'design_asset', 'Design landing page', 'Figma layout', '2026-10-01', 'confirmed', 'Test row'],
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (urlStr.includes('api.trello.com') && urlStr.includes('/lists')) {
        return new Response(
          JSON.stringify([
            { id: 'list-ready', name: 'Ready to Process', closed: false },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (urlStr.includes('api.trello.com') && urlStr.includes('/members')) {
        return new Response(
          JSON.stringify([
            { id: 'member-lead', fullName: 'Lead Operator', username: 'lead_op' },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('Not Found', { status: 404 });
    });

    let stdout = '';
    let savedFilePath = '';
    let savedContent = '';

    const exitCode = await runPreflightCli(
      ['--principal', 'operator-alpha', '--request-id', 'REQ-TEST-01', '--output', './pilot-preflight-redacted.json'],
      {
        stdout: (msg) => { stdout += msg; },
        writeFileFn: async (path, content) => {
          savedFilePath = path;
          savedContent = content;
        },
      },
    );

    expect(exitCode).toBe(0);

    // Verify 0 writes were attempted and no POST methods called
    expect(recordedCalls.length).toBeGreaterThan(0);
    for (const call of recordedCalls) {
      expect(call.method).toBe('GET');
      expect(call.method).not.toBe('POST');
    }

    // Verify JSON output
    const parsed = JSON.parse(stdout);
    expect(parsed.status).toBe('passed');
    expect(parsed.evidenceLabel).toBe('CONFIRMED');
    expect(parsed.checks.sheetsRead.status).toBe('pass');
    expect(parsed.checks.sheetsRead.sampleResult.requestId).toBe('REQ-TEST-01');
    expect(parsed.checks.trelloRead.status).toBe('pass');
    expect(parsed.checks.writeVerification.writesAttempted).toBe(0);

    // Verify secrets are redacted in stdout and saved file
    expect(stdout).not.toContain('secret-sheets-api-key-999');
    expect(stdout).not.toContain('secret-trello-api-key-888');
    expect(stdout).not.toContain('secret-trello-token-777');

    expect(savedFilePath).toBe('./pilot-preflight-redacted.json');
    expect(savedContent).toBe(stdout);

    // Verify no raw row content was printed
    expect(stdout).not.toContain('Figma layout');
    expect(stdout).not.toContain('Design landing page');
  });

  it('exits 1 when upstream live read fails', async () => {
    process.env.PILOT_V2_ENABLED = 'true';
    process.env.PILOT_PRINCIPALS = 'operator-alpha';
    process.env.PILOT_SPREADSHEET_ID = 'test-spreadsheet-id';
    process.env.PILOT_TAB_ID = 'IntakeRequests';
    process.env.PILOT_BOARD_ID = 'test-board-id';
    process.env.GOOGLE_SHEETS_API_KEY = 'secret-sheets-api-key-999';
    process.env.TRELLO_API_KEY = 'secret-trello-api-key-888';
    process.env.TRELLO_API_TOKEN = 'secret-trello-token-777';

    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('sheets.googleapis.com')) {
        return new Response(JSON.stringify({ values: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Unauthorized', { status: 401 });
    });

    let stdout = '';
    const exitCode = await runPreflightCli(
      ['--principal', 'operator-alpha', '--request-id', 'REQ-NOT-FOUND'],
      {
        stdout: (msg) => { stdout += msg; },
      },
    );

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.status).toBe('failed');
    expect(parsed.checks.writeVerification.writesAttempted).toBe(0);
  });
});
