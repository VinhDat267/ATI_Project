import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPersonalSheetsAdapter, encryptCredentials, GlobalRateLimiter } from '@wap/tool-adapters';
import type { ScheduleResponse, SlackDigestConfig, TelegramDigestConfig } from '@wap/tool-schemas';
import { ConversationRepo } from '../../../src/db/repositories/conversation-repo.js';
import { CredentialRepo } from '../../../src/db/repositories/credential-repo.js';
import { MessageRepo } from '../../../src/db/repositories/message-repo.js';
import { ChatService } from '../../../src/services/chat-service.js';
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
      requestText: 'Gửi báo cáo tất cả bảng tính Google Sheets sáng nay',
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

  it('pins the named spreadsheet, tab, and range even past the five-spreadsheet cap', () => {
    const mysheetsLookup = {
      ...connection,
      selectedSpreadsheets: spreadsheets.map((id, index) => ({
        id, title: index === 5 ? 'Sprint Review' : `Fixture ${index + 1}`, canEdit: true, sheets: ['Sprint', 'Archive'],
      })),
    };
    const requestText = 'Gửi bản tin từ bảng tính Sprint Review (tab Sprint) vùng B2:C5 và Trello';
    const result = buildMultiDigestSources({ sourceServices: ['mysheets', 'trello'], destinationLabel, requestText, mysheetsLookup });
    expect(result).toMatchObject({
      ok: true,
      sources: [{
        service: 'mysheets',
        tool: 'mysheets.read_range',
        args: { spreadsheetId: 'sheet-six', range: 'Sprint!B2:C5' },
        label: expect.stringContaining('Sprint!B2:C5'),
        mysheetsBinding: { spreadsheetIds: ['sheet-six'], truncated: false },
      }, { service: 'trello' }],
    });
  });

  it.each([
    'Gửi báo cáo từ bảng tính Không tồn tại và Trello',
    'Gửi báo cáo Google Sheets và Trello',
    'Gửi báo cáo tất cả bảng tính Google Sheets vùng A1:B20 và Trello',
  ])('refuses to guess the source for %s', (requestText) => {
    expect(buildMultiDigestSources({
      sourceServices: ['mysheets', 'trello'], destinationLabel, requestText, mysheetsLookup: connection,
    })).toMatchObject({ ok: false });
  });

  it.each([
    'Gửi bản tin từ bảng tính Không tồn tại và Trello vào #planning',
    'Gửi bản tin tất cả bảng tính trừ bảng tính Planning và Trello',
    "Gửi bản tin từ bảng tính Planning (tab Archive) vùng 'Sprint'!B2:C5 và Trello",
    'Gửi bản tin từ bảng tính Planning tab Archive và tab Sprint cùng Trello',
    'Gửi bản tin từ bảng tính Planning (tab Sprint) ô B2 và Trello',
    'Gửi bản tin từ bảng tính Planning vùng Sprint!B2 và Trello',
    'Gửi bản tin từ https://docs.google.com/spreadsheets/d/sheet-six/edit#gid=1234&range=B2 và Trello',
  ])('does not approve an unrelated, excluded, or ambiguous spreadsheet range for %s', (requestText) => {
    const mysheetsLookup = {
      ...connection,
      selectedSpreadsheets: [{ id: spreadsheets[5]!, title: 'Planning', canEdit: true, sheets: ['Sprint', 'Archive'] }],
    };
    expect(buildMultiDigestSources({
      sourceServices: ['mysheets', 'trello'], destinationLabel, requestText, mysheetsLookup,
    })).toMatchObject({ ok: false });
  });

  it('uses the named Vietnamese trang tính even when it is not the first tab', () => {
    expect(buildMultiDigestSources({
      sourceServices: ['mysheets', 'trello'], destinationLabel,
      requestText: 'Gửi bản tin từ bảng tính Planning (trang tính Archive) và Trello',
      mysheetsLookup: {
        ...connection,
        selectedSpreadsheets: [{ id: spreadsheets[5]!, title: 'Planning', canEdit: true, sheets: ['Sprint', 'Archive'] }],
      },
    })).toMatchObject({ ok: true, sources: [{ args: { spreadsheetId: 'sheet-six', sheetName: 'Archive' } }, {}] });
  });

  it('reauthorizes a previously approved multi-spreadsheet binding without silently expanding it', () => {
    const previous = {
      service: 'mysheets', tool: 'mysheets.list_spreadsheets', label: 'Google Sheets',
      mysheetsBinding: { ...connection, spreadsheetIds: ['sheet-two', 'sheet-one'], truncated: false },
    };
    const input = {
      sourceServices: ['mysheets', 'trello'], destinationLabel,
      requestText: 'Gửi bản tin Google Sheets và Trello',
      mysheetsLookup: connection,
      existingMySheetsSources: [previous],
      reauthorizeMySheets: true,
    };
    expect(buildMultiDigestSources(input))
      .toMatchObject({ ok: true, sources: [{ mysheetsBinding: { spreadsheetIds: ['sheet-two', 'sheet-one'] } }, {}] });
    expect(buildMultiDigestSources({ ...input, mysheetsLookup: { ...connection, allowedSpreadsheets: ['sheet-one'] } }))
      .toMatchObject({ ok: false });
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

it.each([
  { range: undefined, requested: 'A1:Z50', scanned: 'Tasks!A1:Z50', count: 49, truncated: true },
  { range: 'Tasks!A1:Z50', requested: 'Tasks!A1:Z50', scanned: 'Tasks!A1:Z50', count: 49, truncated: false },
  { range: 'Tasks!B2:C5', requested: 'Tasks!B2:C5', scanned: 'Tasks!B2:C5', count: 4, truncated: false },
])('reports the scanned window and data count for $requested', async ({ range, requested, scanned, count, truncated }) => {
  const spreadsheetId = 'review_spreadsheet_01';
  const rows = [['Task', 'Status'], ...Array.from({ length: 50 }, (_, index) => [`Task ${index + 1}`, 'Done'])];
  const adapter = createPersonalSheetsAdapter({
    userId: 'fixture',
    tokens: { getAccessToken: async () => 'fixture' },
    allowedScope: { spreadsheets: [spreadsheetId] },
    rateLimiter: new GlobalRateLimiter({ maxRequests: 100, windowMs: 60_000 }),
    fetchFn: async (url) => {
      expect(decodeURIComponent(String(url))).toContain(`/values/${requested}`);
      return Response.json({ range: scanned, values: range === 'Tasks!B2:C5' ? rows.slice(1, 5) : rows.slice(0, 50) });
    },
  });
  const live = encryptCredentials({
    email: connection.email,
    selectedSpreadsheets: [{ id: spreadsheetId, title: 'Tasks', canEdit: true }],
  }, key);
  const result = await executeMultiDigestReadSources({
    sources: [{
      service: 'mysheets', tool: 'mysheets.list_spreadsheets', label: 'Google Sheets',
      ...(range ? { args: { spreadsheetId, range } } : {}),
      mysheetsBinding: { credentialId: connection.credentialId, email: connection.email, spreadsheetIds: [spreadsheetId], truncated: false },
    }],
    userId: 'fixture',
    dueAt: now,
    sinceIso: now.toISOString(),
    untilIso: now.toISOString(),
    credentialRepo: { getPersonalCredentials: async () => ({
      id: connection.credentialId, service: 'mysheets', user_id: 'fixture', workspace_id: null, status: 'active', config: live,
      created_at: now, status_changed_at: null,
    }) },
    encryptionKey: key,
    signal: new AbortController().signal,
    adapterFactory: { getAdapterForService: () => adapter },
  });
  expect(result).toMatchObject({
    kind: 'ok',
    sourceStatuses: [{ itemCount: count, ...(truncated ? { truncated: true } : {}) }],
    sections: [expect.stringContaining(scanned)],
  });
  expect(result.kind === 'ok' && result.sourceStatuses[0]?.truncated === true).toBe(truncated);
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
        ? 'Gửi bản tin tất cả bảng tính Google Sheets và Trello lên #work'
        : 'Gửi bản tin tất cả bảng tính Google Sheets và Trello lên Telegram',
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
    return { owner, conv, conversations, messages, creds, schedules, proposal, services, createCandidate, createMessage, changeScope, replaceSheets, approve, evaluate, saveProposal };
  }

  it.each(['slack', 'telegram'] as const)('verifies an explicit MySheets range with Google before offering %s auto-send', async (destination) => {
    const f = await fixture(destination);
    const spreadsheetId = 'fixture_spreadsheet_01';
    await f.replaceSheets(connection.email, [spreadsheetId]);
    const checkedRanges: string[] = [];
    const adapter = createPersonalSheetsAdapter({
      userId: f.owner.id,
      tokens: { getAccessToken: async () => 'fixture' },
      allowedScope: { spreadsheets: [spreadsheetId] },
      rateLimiter: new GlobalRateLimiter({ maxRequests: 100, windowMs: 60_000 }),
      fetchFn: async (url) => {
        const pathname = decodeURIComponent(new URL(String(url)).pathname);
        expect(pathname).toContain(`/${spreadsheetId}/values/`);
        const range = pathname.split('/values/')[1]!;
        checkedRanges.push(range);
        return range.startsWith('Sheet1!')
          ? Response.json({ error: { status: 'INVALID_ARGUMENT' } }, { status: 400 })
          : Response.json({ range, values: [['fixture']] });
      },
    });
    const telegram = await f.creds.getPersonalCredentials('telegram', f.owner.id);
    const candidates: Array<{ canAutoDigest: boolean; disabledReason?: string }> = [];
    let tab = 'Sheet1';
    const chat = new ChatService({
      convRepo: f.conversations,
      msgRepo: f.messages,
      schedules: { repo: f.schedules.repo, pool: db.pool, credentialRepo: f.creds, encryptionKey: key, timeZone, now: () => now },
      eventEmitter: { emit: (event, value) => {
        if (event === 'schedule_proposal') candidates.push(value.metadata.digestCandidate);
      } },
      getAdapter: async (service, context) => {
        if (service === 'slack') return { execute: async () => [{ id: 'C_WORK', name: 'work' }] };
        expect(context.connections.mysheets.allowedSpreadsheets).toEqual([spreadsheetId]);
        expect(context.phase).toBe('execution');
        return adapter;
      },
      ...(telegram ? { telegramConnection: async () => ({
        status: 'connected' as const,
        selectedChats: [{ chatId: '777', title: 'Me', type: 'private' as const }],
        connection: { credentialId: telegram.id, telegramUserId: '777', username: 'fixture', chatIds: ['777'] },
      }) } : {}),
      planner: {
        routeSchedule: async () => ({ services: f.services, unavailable: [] }),
        processMessage: async () => ({
          ...f.proposal,
          request: `Gửi bản tin từ bảng tính Sheet 1 (tab "${tab}") vùng A1:B5 và Trello lên ${destination === 'slack' ? '#work' : 'Telegram'}`,
        }),
      } as any,
    });
    await chat.handleUserMessage({ conversationId: f.conv.id, userId: f.owner.id, content: 'Tạo lịch bản tin' });
    await expect.poll(() => candidates[0]).toMatchObject({ canAutoDigest: false, disabledReason: expect.stringContaining('Google Sheets không đọc được vùng') });
    tab = 'Trang tính1';
    const next = await f.conversations.createConversation(f.owner.id, 'Corrected tab', { workspaceMode: 'personal' });
    await chat.handleUserMessage({ conversationId: next.id, userId: f.owner.id, content: 'Tạo lịch bản tin' });
    await expect.poll(() => candidates[1] && [candidates[1].canAutoDigest, candidates[1].disabledReason]).toEqual([true, undefined]);
    expect(checkedRanges).toEqual(['Sheet1!A1:B5', "'Trang tính1'!A1:B5"]);
  });

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

  it.each(['slack', 'telegram'] as const)('persists the exact named tab and range after %s approval', async (destination) => {
    const f = await fixture(destination);
    const proposal = {
      ...f.proposal,
      request: f.proposal.request!.replace('tất cả bảng tính Google Sheets', 'bảng tính Sheet 6 (trang tính Archive) vùng B2:C5'),
    };
    const candidate = await f.evaluate(proposal);
    expect(candidate).toMatchObject({ canAutoDigest: true });
    const message = await f.saveProposal(proposal, candidate);
    const { schedule } = await f.approve(message.id, 'auto_digest');
    const saved = (await db.pool.query('SELECT digest_config, digest_config_hash FROM schedules WHERE id=$1', [schedule.id])).rows[0];
    expect(saved.digest_config.sources[0]).toMatchObject({
      tool: 'mysheets.read_range',
      args: { spreadsheetId: 'sheet-six', range: 'Archive!B2:C5' },
      mysheetsBinding: { spreadsheetIds: ['sheet-six'], truncated: false },
    });
    const changed = structuredClone(saved.digest_config);
    changed.sources[0].args.range = 'Archive!A1:Z50';
    expect(digestHash(changed)).not.toBe(saved.digest_config_hash);
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
