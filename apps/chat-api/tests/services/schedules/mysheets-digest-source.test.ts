import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptCredentials } from '@wap/tool-adapters';
import type { ScheduleResponse, SlackDigestConfig, TelegramDigestConfig } from '@wap/tool-schemas';
import { ConversationRepo } from '../../../src/db/repositories/conversation-repo.js';
import { CredentialRepo } from '../../../src/db/repositories/credential-repo.js';
import { MessageRepo } from '../../../src/db/repositories/message-repo.js';
import { assertDigestScheduleLiveScopeAndAuth } from '../../../src/services/schedules/digest-scope-guard.js';
import {
  buildMultiDigestSources,
  getDigestSourceDisabledReason,
} from '../../../src/services/schedules/multi-source-digest-candidate.js';
import { executeMultiDigestReadSources } from '../../../src/services/schedules/multi-source-digest-reader.js';
import { loadLiveMySheetsDigestConnection } from '../../../src/services/schedules/mysheets-digest-source.js';
import { ScheduleRunner } from '../../../src/services/schedules/schedule-runner.js';
import { ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import { TelegramDigestRunner } from '../../../src/services/schedules/telegram-digest-runner.js';
import { computeSlackDigestConfigHash, evaluateSlackDigestCandidate } from '../../../src/services/schedules/slack-digest-candidate.js';
import { computeTelegramDigestConfigHash, evaluateTelegramDigestCandidate } from '../../../src/services/schedules/telegram-digest-candidate.js';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';

const spreadsheets = ['sheet-one', 'sheet-two', 'sheet-three', 'sheet-four', 'sheet-five', 'sheet-six'];
const connection = {
  credentialId: '8f662fcb-120e-4aa4-9e27-2b5cbf7bf220',
  email: 'sheets@example.test',
  allowedSpreadsheets: spreadsheets,
};
const key = '0123456789abcdef0123456789abcdef';
const now = new Date('2026-11-18T01:00:00Z');
const timeZone = 'Asia/Ho_Chi_Minh';

function digestHash(config: SlackDigestConfig | TelegramDigestConfig) {
  return 'destination' in config ? computeSlackDigestConfigHash(config) : computeTelegramDigestConfigHash(config);
}

describe.each(['Slack', 'Telegram'] as const)('MySheets digest source & egress policy for %s', (destinationLabel) => {
  it('requires a live mysheets connection at preview', () => {
    expect(buildMultiDigestSources({
      sourceServices: ['mysheets'],
      destinationLabel,
      requestText: 'Gửi báo cáo Google Sheets sáng nay',
    })).toMatchObject({ ok: false });
  });

  it('records the exact capped 5-spreadsheet scope in preview with truncated: true', () => {
    expect(buildMultiDigestSources({
      sourceServices: ['mysheets'],
      destinationLabel,
      requestText: 'Gửi báo cáo Google Sheets sáng nay',
      mysheetsLookup: connection,
    })).toMatchObject({
      ok: true,
      sources: [{
        mysheetsBinding: {
          credentialId: connection.credentialId,
          email: connection.email,
          spreadsheetIds: ['sheet-one', 'sheet-two', 'sheet-three', 'sheet-four', 'sheet-five'],
          truncated: true,
        },
      }],
    });
  });

  it('blocks org sheets in personal mode and org sheets -> Telegram egress', () => {
    expect(buildMultiDigestSources({
      sourceServices: ['sheets'],
      destinationLabel,
      requestText: 'Gửi báo cáo bảng tính',
      workspaceMode: 'personal',
    })).toMatchObject({ ok: false });

    const orgAttempt = buildMultiDigestSources({
      sourceServices: ['sheets'],
      destinationLabel,
      requestText: 'Gửi báo cáo bảng tính',
      workspaceMode: 'organization',
      workspaceId: '11111111-1111-4111-8111-111111111111',
    });
    expect(orgAttempt.ok).toBe(destinationLabel !== 'Telegram');

    expect(
      getDigestSourceDisabledReason(
        { service: 'sheets', tool: 'sheets.read_range' },
        { workspaceMode: 'organization', destination: 'telegram' },
      ),
    ).toContain('SHEETS_TELEGRAM_ORG_FORBIDDEN');
    expect(
      getDigestSourceDisabledReason(
        { service: 'sheets', tool: 'sheets.read_range' },
        { workspaceMode: 'personal', destination: destinationLabel.toLowerCase() },
      ),
    ).toContain('SHEETS_WORKSPACE_REQUIRED');
  });
});

describe('MySheets multi-source schedule approval & guard on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;

  beforeAll(async () => { db = await createMigratedSchema('mysheets_digest_source'); });
  afterAll(async () => db?.close());

  async function fixture(destination: 'slack' | 'telegram') {
    const owner = await db.person();
    const conversations = new ConversationRepo(db.pool);
    const messages = new MessageRepo(db.pool);
    const creds = new CredentialRepo(db.pool, key);
    const conv = await conversations.createConversation(owner.id, 'MySheets Multi Digest', { workspaceMode: 'personal' });
    const slackChannels = [{ id: 'C_WORK', name: 'work' }];
    const getAdapter = async (service: string) =>
      service === 'slack' ? { execute: async () => slackChannels } : null;
    const schedules = new ScheduleService({ pool: db.pool, timeZone, encryptionKey: key, getAdapter });
    const services = ['mysheets', 'trello', destination];
    const telegramRow = destination === 'telegram'
      ? await creds.saveCredentials('telegram', encryptCredentials({
          telegramUserId: '777', username: 'fixture',
          selectedChats: [{ chatId: '777', title: 'Me', type: 'private' }],
        }, key), owner.id)
      : null;
    if (destination === 'slack') {
      await creds.saveCredentials('slack', encryptCredentials({ botToken: 'fixture', allowedScope: { channels: ['C_WORK'] } }, key), owner.id);
    }
    const replaceSheets = (email: string, ids: string[]) => creds.saveCredentials('mysheets', encryptCredentials({
      email,
      refreshToken: 'fixture',
      selectedSpreadsheets: ids.map((id, idx) => ({ id, title: `Sheet ${idx + 1}`, canEdit: true })),
      allowedScope: { spreadsheets: ids },
    }, key), owner.id);
    const original = await replaceSheets(connection.email, spreadsheets);
    const changeScope = (ids: string[]) => db.pool.query(
      'UPDATE service_credentials SET config=$2 WHERE id=$1',
      [original.id, encryptCredentials({
        email: connection.email,
        refreshToken: 'fixture',
        selectedSpreadsheets: ids.map((id, idx) => ({ id, title: `Updated ${idx + 1}`, canEdit: true })),
        allowedScope: { spreadsheets: ids },
      }, key)],
    );
    const evaluate = async (proposal: ScheduleResponse, previous?: SlackDigestConfig | TelegramDigestConfig) => {
      const mysheetsLookup = await loadLiveMySheetsDigestConnection(db.pool, owner.id, key);
      const input = { proposal, services, timeZone, mysheetsLookup, workspaceMode: 'personal' as const };
      return destination === 'slack'
        ? evaluateSlackDigestCandidate({ ...input, pool: db.pool, userId: owner.id, getAdapter, existingDigest: previous as SlackDigestConfig })
        : evaluateTelegramDigestCandidate({
            ...input,
            existingDigest: previous as TelegramDigestConfig,
            telegramLookup: {
              status: 'connected',
              selectedChats: [{ chatId: '777', title: 'Me', type: 'private' }],
              connection: { credentialId: telegramRow!.id, telegramUserId: '777', username: 'fixture', chatIds: ['777'] },
            },
          });
    };
    const proposal: ScheduleResponse = {
      kind: 'schedule',
      action: 'create',
      name: 'Bản tin Sheets + Trello',
      request: destination === 'slack'
        ? 'Gửi bản tin Google Sheets và Trello lên #work'
        : 'Gửi bản tin Google Sheets và Trello lên Telegram',
      recurrence: { type: 'daily', time: '08:00' },
      summary: 'Bản tin',
    };
    const createCandidate = await evaluate(proposal);
    expect(createCandidate.canAutoDigest).toBe(true);
    const approve = async (messageId: string, approvalMode?: 'auto_digest') =>
      schedules.confirmProposal({ userId: owner.id, convId: conv.id, messageId, now, approvalMode });
    const saveProposal = (
      edited: ScheduleResponse,
      candidate: Awaited<ReturnType<typeof evaluate>>,
      schedule?: { id: string; version: number },
    ) =>
      messages.createMessage(conv.id, 'assistant', edited.summary, {
        type: 'schedule_proposal',
        proposal: edited,
        services,
        digestCandidate: candidate,
        ...(schedule ? { scheduleId: schedule.id, baseVersion: schedule.version } : {}),
      });
    const createMessage = await saveProposal(proposal, createCandidate);
    return { owner, creds, schedules, proposal, services, createCandidate, createMessage, changeScope, replaceSheets, approve, evaluate, saveProposal };
  }

  it.each(['slack', 'telegram'] as const)('keeps exact approved spreadsheets on %s edits, executes bound read_range in phase=execution, and blocks revoked/unpinned scope', async (destination) => {
    const f = await fixture(destination);
    const { schedule } = await f.approve(f.createMessage.id, 'auto_digest');
    const prior = f.createCandidate.config!;
    const expectedBinding = prior.sources[0]!.mysheetsBinding!;
    expect(expectedBinding).toMatchObject({
      email: connection.email,
      spreadsheetIds: ['sheet-one', 'sheet-two', 'sheet-three', 'sheet-four', 'sheet-five'],
      truncated: true,
    });

    await f.changeScope(['new-unapproved-sheet', ...spreadsheets].reverse());
    const edit: ScheduleResponse = { ...f.proposal, action: 'update', name: 'Bản tin mới', recurrence: { type: 'daily', time: '09:00' } };
    const candidate = await f.evaluate(edit, prior);
    expect(candidate.config?.sources[0]?.mysheetsBinding).toEqual(expectedBinding);
    const message = await f.saveProposal(edit, candidate, schedule);
    const edited = await f.approve(message.id);

    const stored = (await db.pool.query('SELECT digest_config, digest_config_hash FROM schedules WHERE id=$1', [schedule.id])).rows[0];
    expect(stored.digest_config.sources[0].mysheetsBinding).toEqual(expectedBinding);

    const tampered = structuredClone(stored.digest_config);
    tampered.sources[0].mysheetsBinding.spreadsheetIds[0] = 'new-unapproved-sheet';
    expect(digestHash(tampered)).not.toBe(stored.digest_config_hash);
    const newScope = await f.saveProposal(edit, { ...candidate, config: tampered, configHash: digestHash(tampered) }, edited.schedule);
    await expect(f.approve(newScope.id)).rejects.toMatchObject({ code: 'REAUTHORIZATION_REQUIRED' });

    const readSheets: string[] = [];
    const read = await executeMultiDigestReadSources({
      sources: stored.digest_config.sources,
      userId: f.owner.id,
      dueAt: now,
      sinceIso: now.toISOString(),
      untilIso: now.toISOString(),
      credentialRepo: f.creds,
      encryptionKey: key,
      signal: new AbortController().signal,
      adapterFactory: {
        getAdapterForService(service, context) {
          if (service !== 'mysheets') return { execute: async () => [] };
          expect(context).toMatchObject({
            phase: 'execution',
            connections: { mysheets: { credentialId: expectedBinding.credentialId, allowedSpreadsheets: spreadsheets.slice(0, 5) } },
          });
          return {
            execute: async (tool: string, args: { spreadsheetId: string }) => {
              expect(tool).toBe('mysheets.read_range');
              readSheets.push(args.spreadsheetId);
              return { headers: ['Việc', 'Trạng thái'], records: [{ 'Việc': 'Task', 'Trạng thái': 'Đang làm' }], values: [] };
            },
          };
        },
      },
    });
    expect(readSheets).toEqual(['sheet-one', 'sheet-two', 'sheet-three', 'sheet-four', 'sheet-five']);
    expect(read).toMatchObject({ kind: 'ok', sourceStatuses: [{ truncated: true }, {}] });

    // Unpinned legacy mysheets source fails closed without calling adapter
    const unpinnedRead = await executeMultiDigestReadSources({
      sources: [{ service: 'mysheets', tool: 'mysheets.list_spreadsheets', label: 'Google Sheets' }],
      userId: f.owner.id,
      dueAt: now,
      sinceIso: now.toISOString(),
      untilIso: now.toISOString(),
      credentialRepo: f.creds,
      encryptionKey: key,
      signal: new AbortController().signal,
      adapterFactory: {
        getAdapterForService: async () => {
          throw new Error('Should not resolve adapter for unpinned mysheets source');
        },
      },
    });
    expect(unpinnedRead).toMatchObject({ kind: 'blocked', pauseSchedule: true });

    // Removing one of the pinned spreadsheets from live grant blocks schedule guard & resume
    await f.changeScope(['sheet-two', 'sheet-three', 'sheet-four', 'sheet-five', 'sheet-six']);
    const guard = await assertDigestScheduleLiveScopeAndAuth({ pool: db.pool, scheduleId: schedule.id, encryptionKey: key });
    expect(guard.code).toBe('DIGEST_MYSHEETS_BINDING_INVALID');
    const paused = await f.schedules.setStatus({ userId: f.owner.id, scheduleId: schedule.id, action: 'pause', version: edited.schedule.version, now });
    await expect(f.schedules.setStatus({
      userId: f.owner.id, scheduleId: schedule.id, action: 'resume', version: paused.schedule.version, now,
    })).rejects.toMatchObject({ code: 'REAUTHORIZATION_REQUIRED' });
  });

  it.each(['slack', 'telegram'] as const)('rejects replaced grants at %s confirmation and supports reauthorization flow', async (destination) => {
    const f = await fixture(destination);
    await f.replaceSheets('new@example.test', spreadsheets);
    await expect(f.approve(f.createMessage.id, 'auto_digest')).rejects.toMatchObject({ code: 'DIGEST_PREVIEW_CHANGED' });
    const candidate = await f.evaluate(f.proposal);
    const message = await f.saveProposal(f.proposal, candidate);
    const { schedule } = await f.approve(message.id, 'auto_digest');

    const legacy = structuredClone(candidate.config!);
    delete legacy.sources[0]!.mysheetsBinding;
    await db.pool.query(
      "UPDATE schedules SET digest_config=$2, digest_config_hash=$3, status='paused', next_run_at=NULL WHERE id=$1",
      [schedule.id, JSON.stringify(legacy), digestHash(legacy)],
    );
    await expect(f.schedules.setStatus({
      userId: f.owner.id, scheduleId: schedule.id, action: 'resume', version: schedule.version, now,
    })).rejects.toMatchObject({ code: 'REAUTHORIZATION_REQUIRED' });

    const reauth = await f.schedules.createReauthorizePreview({ userId: f.owner.id, scheduleId: schedule.id, now });
    expect(reauth.candidate.config).toMatchObject({
      sources: [{ mysheetsBinding: { email: 'new@example.test', spreadsheetIds: spreadsheets.slice(0, 5), truncated: true } }, {}],
    });
    expect((await f.approve(reauth.proposalMessageId, 'auto_digest')).schedule.status).toBe('active');
  });

  it('allows mysheets.read_range in TelegramDigestRunner read allowlist (parity with SlackDigestRunner)', async () => {
    const f = await fixture('telegram');
    const created = await f.approve(f.createMessage.id, 'auto_digest');
    const baseCfg = JSON.parse(JSON.stringify(f.createCandidate.config!)) as TelegramDigestConfig;
    const readRangeCfg: TelegramDigestConfig = {
      ...baseCfg,
      sources: [
        {
          ...baseCfg.sources[0]!,
          tool: 'mysheets.read_range',
        },
      ],
    };
    await db.pool.query(
      'UPDATE schedules SET digest_config=$2, digest_config_hash=$3, next_run_at=$4 WHERE id=$1',
      [created.schedule.id, JSON.stringify(readRangeCfg), digestHash(readRangeCfg), new Date(now.getTime() - 1000)],
    );

    const calledTools: string[] = [];
    const sent: Array<{ chatId: string; text: string }> = [];
    const digestRunner = new TelegramDigestRunner({
      pool: db.pool,
      credentialRepo: f.creds,
      encryptionKey: key,
      timeZone,
      adapterFactory: {
        getAdapterForService: async (svc) =>
          svc === 'mysheets'
            ? {
                execute: async (toolName: string) => {
                  calledTools.push(toolName);
                  return {
                    spreadsheetId: spreadsheets[0],
                    range: 'Sheet1!A1:B2',
                    values: [['Task', 'Status'], ['Fix bug', 'Done']],
                    headers: ['Task', 'Status'],
                    rows: [{ Task: 'Fix bug', Status: 'Done' }],
                  };
                },
              }
            : svc === 'telegram'
              ? {
                  execute: async (_tool: string, args: { chatId: string; text: string }) => {
                    sent.push(args);
                    return { messageId: 901 };
                  },
                }
              : null,
      },
      botClient: { getChatMember: async () => true } as any,
    });

    const tickRunner = new ScheduleRunner({
      pool: db.pool,
      timeZone,
      encryptionKey: key,
      now: () => now,
      planRun: async () => {
        throw new Error('Should not call planRun');
      },
      executeDigestRun: (run, signal) => digestRunner.execute(run, signal),
      recordState: (client, row, at) => f.schedules.recordState(client, row, at),
    });

    await tickRunner.tick();

    const runCheck = await db.pool.query(
      'SELECT status, error FROM schedule_runs WHERE schedule_id=$1 ORDER BY created_at DESC LIMIT 1',
      [created.schedule.id],
    );
    expect(runCheck.rows[0]?.status).toBe('digest_sent');
    expect(calledTools).toContain('mysheets.read_range');
    expect(sent).toHaveLength(1);
  });
});
