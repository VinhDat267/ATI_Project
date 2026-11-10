import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encryptCredentials, StepError } from '@wap/tool-adapters';
import { validateEnv } from '../../src/config/env.js';
import { runtimeMySheetsAdapter } from '../../src/config/gmail-tools-runtime.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { ExecutionService } from '../../src/services/execution-service.js';
import { getToolCatalogFor } from '../../src/services/registered-services.js';

const ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL_ID = '22222222-2222-4222-8222-222222222222';
const SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const DOC_ID = 'doc_1234567890abcdef';
const FOLDER_ID = 'folder_1234567890abcdef';

const FOUR_DRIVE_WRITE_TOOLS = [
  'mysheets.create_drive_folder',
  'mysheets.create_doc',
  'mysheets.append_doc_text',
  'mysheets.move_drive_file',
] as const;

const TWO_DRIVE_READ_TOOLS = [
  'mysheets.list_drive_files',
  'mysheets.get_doc',
] as const;

function createCredentialRepo(spreadsheets: string[]) {
  const encrypted = encryptCredentials(
    {
      email: 'alice@example.com',
      refreshToken: 'refresh-token-alice',
      selectedSpreadsheets: spreadsheets.map((id, idx) => ({
        id,
        title: `Bảng tính ${idx + 1}`,
        canEdit: true,
      })),
      allowedScope: { spreadsheets },
    },
    ENCRYPTION_KEY
  );

  return {
    getCredentials: vi.fn(async () => null),
    getPersonalCredentials: vi.fn(async (service: string, userId: string) => {
      if (service === 'mysheets' && userId === USER_ID) {
        return {
          id: CREDENTIAL_ID,
          service: 'mysheets',
          user_id: USER_ID,
          config: encrypted,
          status: 'active' as const,
          created_at: new Date(),
          status_changed_at: null,
        };
      }
      return null;
    }),
  } as any;
}

describe('MySheets Dual-Layer Drive/Docs Write Kill-Switch (PR-R1-A2a)', () => {
  const originalEnv = process.env.ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS;
    } else {
      process.env.ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS = originalEnv;
    }
  });

  it('validateEnv defaults ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS to false when unset or false, and parses true only when explicitly enabled', () => {
    const defaultCfg = validateEnv({
      RUNTIME_MODE: 'sandbox',
    });
    expect(defaultCfg.ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS).toBe(false);

    const falseCfg = validateEnv({
      RUNTIME_MODE: 'sandbox',
      ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS: 'false',
    });
    expect(falseCfg.ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS).toBe(false);

    const enabledCfg = validateEnv({
      RUNTIME_MODE: 'sandbox',
      ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS: 'true',
    });
    expect(enabledCfg.ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS).toBe(true);
  });

  it('excludes all 4 Drive/Docs write tools from getToolCatalogFor by default when selectedSpreadsheets=[] while keeping list_drive_files and get_doc', async () => {
    delete process.env.ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS;
    const credRepo = createCredentialRepo([]);

    const catalog = await getToolCatalogFor(credRepo, ENCRYPTION_KEY, {
      userId: USER_ID,
      gmailEnabled: false,
      mysheetsEnabled: true,
    });
    const names = catalog.map((t) => t.name).sort();

    expect(names).toEqual([...TWO_DRIVE_READ_TOOLS].sort());
    for (const writeTool of FOUR_DRIVE_WRITE_TOOLS) {
      expect(names).not.toContain(writeTool);
    }
  });

  it('excludes all 4 Drive/Docs write tools from getToolCatalogFor by default when spreadsheets are selected while keeping spreadsheet tools and Drive/Docs read tools', async () => {
    delete process.env.ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS;
    const credRepo = createCredentialRepo([SPREADSHEET_ID]);

    const catalog = await getToolCatalogFor(credRepo, ENCRYPTION_KEY, {
      userId: USER_ID,
      gmailEnabled: false,
      mysheetsEnabled: true,
    });
    const names = catalog.map((t) => t.name);

    for (const readTool of TWO_DRIVE_READ_TOOLS) {
      expect(names).toContain(readTool);
    }
    expect(names).toContain('mysheets.read_range');
    expect(names).toContain('mysheets.search_rows');
    expect(names).toContain('mysheets.append_rows');

    for (const writeTool of FOUR_DRIVE_WRITE_TOOLS) {
      expect(names).not.toContain(writeTool);
    }
  });

  it('blocks all 4 Drive/Docs write tools on AdapterFactory-created adapters with AUTH_ERROR 403 MYSHEETS_DRIVE_WRITE_DISABLED and zero HTTP/token calls', async () => {
    delete process.env.ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS;

    for (const spreadsheets of [[], [SPREADSHEET_ID]]) {
      const credRepo = createCredentialRepo(spreadsheets);
      const getAccessTokenSpy = vi.fn(async () => 'ya29.factory_token');
      const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));

      const factory = new AdapterFactory({
        credentialRepo: credRepo,
        encryptionKey: ENCRYPTION_KEY,
        mysheetsTokens: {
          forConnection: () => ({ getAccessToken: getAccessTokenSpy }),
          clear: () => {},
        } as any,
        createMySheetsAdapter: (input) =>
          runtimeMySheetsAdapter(
            'live',
            { ...input, fetchFn: fetchSpy as unknown as typeof fetch } as any,
            'https://sheets.googleapis.com'
          ),
      });

      const adapter = await factory.getAdapterForService('mysheets', {
        userId: USER_ID,
        phase: 'execution',
        connections: {
          mysheets: {
            credentialId: CREDENTIAL_ID,
            email: 'alice@example.com',
            allowedSpreadsheets: spreadsheets,
          },
        },
      });

      for (const writeTool of FOUR_DRIVE_WRITE_TOOLS) {
        let caught: unknown;
        try {
          await adapter.execute(writeTool, {
            name: 'Folder A',
            title: 'Doc A',
            documentId: DOC_ID,
            text: 'Overwrite attempt',
            fileId: DOC_ID,
            folderId: FOLDER_ID,
            enableDriveWriteTools: true,
          });
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
          tool: writeTool,
          requestSent: false,
        });
      }

      expect(fetchSpy).toHaveBeenCalledTimes(0);
      expect(getAccessTokenSpy).toHaveBeenCalledTimes(0);
    }
  });

  it('blocks persisted/replayed plans via ExecutionService.approveAndStart for all 4 Drive/Docs write tools even when planJson and step.args inject enableDriveWriteTools=true', async () => {
    delete process.env.ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS;
    const credRepo = createCredentialRepo([SPREADSHEET_ID]);
    const getAccessTokenSpy = vi.fn(async () => 'ya29.replay_token');
    const fetchSpy = vi.fn(async () => new Response('Existing Doc Content', { status: 200 }));

    const factory = new AdapterFactory({
      credentialRepo: credRepo,
      encryptionKey: ENCRYPTION_KEY,
      mysheetsTokens: {
        forConnection: () => ({ getAccessToken: getAccessTokenSpy }),
        clear: () => {},
      } as any,
      createMySheetsAdapter: (input) =>
        runtimeMySheetsAdapter(
          'live',
          { ...input, fetchFn: fetchSpy as unknown as typeof fetch } as any,
          'https://sheets.googleapis.com'
        ),
    });

    for (const [idx, writeTool] of FOUR_DRIVE_WRITE_TOOLS.entries()) {
      const planId = `plan_persisted_${idx}`;
      const stepRow: Record<string, any> = {
        id: `step_row_${idx}`,
        plan_id: planId,
        step_id: 's1',
        tool: writeTool,
        args_json: {
          name: 'Injected Folder',
          title: 'Injected Doc',
          documentId: DOC_ID,
          text: 'Injected overwrite',
          fileId: DOC_ID,
          folderId: FOLDER_ID,
          enableDriveWriteTools: true,
          ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS: 'true',
        },
        status: 'pending',
        output_json: null,
        error_json: null,
      };
      const planJson = {
        kind: 'plan',
        summary: `Replay ${writeTool}`,
        enableDriveWriteTools: true,
        ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS: true,
        connections: {
          mysheets: {
            credentialId: CREDENTIAL_ID,
            email: 'alice@example.com',
            allowedSpreadsheets: [SPREADSHEET_ID],
          },
        },
        steps: [
          {
            id: 's1',
            tool: writeTool,
            description: `Persisted ${writeTool}`,
            dependsOn: [],
            args: stepRow.args_json,
          },
        ],
      };
      const planText = JSON.stringify(planJson);
      const planRow: Record<string, any> = {
        id: planId,
        conv_id: 'conv_persisted_1',
        plan_hash: createHash('sha256').update(planText).digest('hex'),
        plan_text: planText,
        status: 'pending',
        expires_at: new Date(Date.now() + 60_000),
        decided_at: null,
        revision: '1',
        plan_json: planJson,
      };

      const execService = new ExecutionService({
        planRepo: {
          getPlan: vi.fn(async () => planRow),
          approvePlan: vi.fn(async () => {
            planRow.status = 'approved';
            planRow.decided_at = new Date();
            return true;
          }),
          updatePlanStatus: vi.fn(async (_id: string, status: string) => {
            planRow.status = status;
          }),
        } as any,
        stepRepo: {
          listSteps: vi.fn(async () => []),
          createStep: vi.fn(async () => stepRow),
          updateStepStatus: vi.fn(async (_id: string, status: string, out?: unknown, err?: unknown) => {
            stepRow.status = status;
            if (out !== undefined) stepRow.output_json = out;
            if (err !== undefined) stepRow.error_json = err;
            return stepRow;
          }),
        } as any,
        convRepo: {
          getConversation: vi.fn(async () => ({
            id: 'conv_persisted_1',
            user_id: USER_ID,
            workspace_mode: 'personal',
            workspace_id: null,
          })),
        } as any,
        adapterFactory: factory,
        sseManager: { emitEvent: vi.fn() } as any,
      });

      const approveRes = await execService.approveAndStart(planId, USER_ID);
      expect(approveRes.success).toBe(true);
      await new Promise((resolve) => setImmediate(resolve));
      const activeRun = (execService as any).activeRuns.get(planId);
      if (activeRun) {
        await activeRun;
      }

      expect(stepRow.status).toBe('failed');
      expect(stepRow.error_json).toMatchObject({
        category: 'AUTH_ERROR',
        details: {
          code: 'MYSHEETS_DRIVE_WRITE_DISABLED',
          tool: writeTool,
          requestSent: false,
        },
      });
    }

    expect(fetchSpy).toHaveBeenCalledTimes(0);
    expect(getAccessTokenSpy).toHaveBeenCalledTimes(0);
  });
});
