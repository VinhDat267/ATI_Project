import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PersonalSheetsAdapter,
  createPersonalSheetsAdapter,
  type PersonalSheetsAdapterConfig,
} from '../../src/sheets/personal-sheets-adapter.js';
import { StepError } from '../../src/index.js';
import type { GmailAccessTokenProvider } from '../../src/gmail/token-provider.js';

const USER_ID = 'usr_killswitch_fixture';
const SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const DOC_ID = 'doc_1234567890abcdef';
const FOLDER_ID = 'folder_1234567890abcdef';

const BLOCKED_DRIVE_WRITE_TOOLS: ReadonlyArray<{
  tool: string;
  args: Record<string, unknown>;
}> = [
  {
    tool: 'mysheets.create_drive_folder',
    args: { name: 'Thư mục dự án Q4' },
  },
  {
    tool: 'mysheets.create_doc',
    args: { title: 'Biên bản họp Q4', content: 'Nội dung biên bản', folderId: FOLDER_ID },
  },
  {
    tool: 'mysheets.append_doc_text',
    args: { documentId: DOC_ID, text: 'Action item mới' },
  },
  {
    tool: 'mysheets.move_drive_file',
    args: { fileId: DOC_ID, folderId: FOLDER_ID },
  },
];

function createHarness(overrides?: Partial<PersonalSheetsAdapterConfig>) {
  const fetchSpy = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/export')) {
      return new Response('Nội dung gốc', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
      });
    }
    if (url.pathname === '/drive/v3/files' && (!init?.method || init.method === 'GET')) {
      return new Response(
        JSON.stringify({
          files: [
            {
              id: DOC_ID,
              name: 'Tài liệu đối chiếu',
              mimeType: 'application/vnd.google-apps.document',
              webViewLink: `https://docs.google.com/document/d/${DOC_ID}/edit`,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({
        id: DOC_ID,
        name: 'Tài liệu đối chiếu',
        mimeType: 'application/vnd.google-apps.document',
        webViewLink: `https://docs.google.com/document/d/${DOC_ID}/edit`,
        properties: { title: 'Bảng tính KPI' },
        range: 'Sheet1!A1:B2',
        values: [
          ['Hạng mục', 'Trạng thái'],
          ['Task 1', 'Done'],
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });

  const getAccessTokenSpy = vi.fn(async () => 'ya29.fixture_token');
  const tokens: GmailAccessTokenProvider = {
    getAccessToken: getAccessTokenSpy,
  };

  const adapter = createPersonalSheetsAdapter({
    userId: USER_ID,
    tokens,
    allowedScope: { spreadsheets: [SPREADSHEET_ID] },
    fetchFn: fetchSpy as unknown as typeof fetch,
    ...overrides,
  });

  return { adapter, fetchSpy, getAccessTokenSpy, tokens };
}

describe('PersonalSheetsAdapter Drive/Docs Write Kill-Switch (PR-R1-A2a)', () => {
  const originalEnv = process.env.ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS;
    } else {
      process.env.ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS = originalEnv;
    }
  });

  it.each(BLOCKED_DRIVE_WRITE_TOOLS)(
    'blocks $tool by default (Default OFF) with AUTH_ERROR 403, MYSHEETS_DRIVE_WRITE_DISABLED, requestSent:false, and zero HTTP/token calls',
    async ({ tool, args }) => {
      delete process.env.ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS;
      const { adapter, fetchSpy, getAccessTokenSpy } = createHarness();

      let caught: unknown;
      try {
        await adapter.execute(tool, args);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(StepError);
      const stepErr = caught as StepError;
      expect(stepErr.category).toBe('AUTH_ERROR');
      expect(stepErr.statusCode).toBe(403);
      expect(stepErr.retryable).toBe(false);
      expect(stepErr.details).toEqual({
        code: 'MYSHEETS_DRIVE_WRITE_DISABLED',
        tool,
        requestSent: false,
      });
      expect(fetchSpy).toHaveBeenCalledTimes(0);
      expect(getAccessTokenSpy).toHaveBeenCalledTimes(0);
    }
  );

  it('blocks all 4 Drive/Docs write tools when allowedScope.spreadsheets is empty (selectedSpreadsheets=[]) and when non-empty', async () => {
    delete process.env.ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS;

    for (const spreadsheets of [[], [SPREADSHEET_ID]]) {
      const { adapter, fetchSpy, getAccessTokenSpy } = createHarness({
        allowedScope: { spreadsheets },
      });

      for (const { tool, args } of BLOCKED_DRIVE_WRITE_TOOLS) {
        await expect(adapter.execute(tool, args)).rejects.toMatchObject({
          category: 'AUTH_ERROR',
          statusCode: 403,
          retryable: false,
          details: {
            code: 'MYSHEETS_DRIVE_WRITE_DISABLED',
            tool,
            requestSent: false,
          },
        });
      }

      expect(fetchSpy).toHaveBeenCalledTimes(0);
      expect(getAccessTokenSpy).toHaveBeenCalledTimes(0);
    }
  });

  it('never allows step.args or execution context to bypass the server-owned kill-switch', async () => {
    process.env.ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS = 'false';
    const { adapter, fetchSpy, getAccessTokenSpy } = createHarness({
      enableDriveWriteTools: false,
    });

    for (const { tool, args } of BLOCKED_DRIVE_WRITE_TOOLS) {
      await expect(
        adapter.execute(
          tool,
          {
            ...args,
            enableDriveWriteTools: true,
            ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS: 'true',
          },
          {
            // @ts-expect-error testing untrusted runtime context injection
            enableDriveWriteTools: true,
            ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS: true,
          }
        )
      ).rejects.toMatchObject({
        category: 'AUTH_ERROR',
        statusCode: 403,
        retryable: false,
        details: {
          code: 'MYSHEETS_DRIVE_WRITE_DISABLED',
          tool,
          requestSent: false,
        },
      });
    }

    expect(fetchSpy).toHaveBeenCalledTimes(0);
    expect(getAccessTokenSpy).toHaveBeenCalledTimes(0);
  });

  it('keeps Drive/Docs read tools (list_drive_files, get_doc) and spreadsheet tools working when Drive/Docs writes are disabled', async () => {
    delete process.env.ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS;
    const { adapter, fetchSpy, getAccessTokenSpy } = createHarness({
      allowedScope: { spreadsheets: [SPREADSHEET_ID] },
    });

    const files = await adapter.execute('mysheets.list_drive_files', { query: 'Tài liệu' });
    expect(files).toHaveLength(1);

    const doc = await adapter.execute('mysheets.get_doc', { documentId: DOC_ID });
    expect(doc.id).toBe(DOC_ID);
    expect(doc.content).toBe('Nội dung gốc');

    const sheetRange = await adapter.execute('mysheets.read_range', {
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A1:B2',
    });
    expect(sheetRange.values).toHaveLength(2);
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(getAccessTokenSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('allows all 4 Drive/Docs write tools only when server-owned enableDriveWriteTools is explicitly true', async () => {
    const { adapter, fetchSpy } = createHarness({
      enableDriveWriteTools: true,
    });

    for (const { tool, args } of BLOCKED_DRIVE_WRITE_TOOLS) {
      const res = await adapter.execute(tool, args);
      expect(res).toBeDefined();
      expect(res.id).toBe(DOC_ID);
    }
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});
