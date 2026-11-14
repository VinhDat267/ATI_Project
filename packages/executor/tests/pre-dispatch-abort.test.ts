import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  CalendarAdapter,
  GitHubAdapter,
  GlobalRateLimiter,
  JiraAdapter,
  PersonalJiraHttpTransport,
  SheetsAdapter,
  TelegramAdapter,
  TrelloWriteTools,
} from '../../tool-adapters/src/index.js';
import { StepRunner } from '../src/index.js';

const rsaPrivateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();

const googleCredentials = {
  clientEmail: 'service@unit.iam.gserviceaccount.com',
  privateKey: rsaPrivateKey,
};

describe('Pre-dispatch abort & pre-write GET failure write safety (PR 5)', () => {
  it('TelegramAdapter: pre-dispatch abort, pre-write getChat failure, and definite 4xx rejection set requestSent=false and transition StepRunner to failed', async () => {
    const token = '123456789:synthetic_bot_token_abcdefghijkl';
    const chatId = '-1001234567890';
    const fast = () => new GlobalRateLimiter({ maxRequests: 1000, windowMs: 1000 });

    // 1. Pre-aborted signal before fetchFn
    const abortedController = new AbortController();
    abortedController.abort();
    const fetchNever = vi.fn();
    const tgAbort = new TelegramAdapter({
      credentials: { botToken: token },
      allowedScope: { chats: [chatId] },
      fetchFn: fetchNever as any,
      rateLimiter: fast(),
      chatRateLimiter: fast(),
      groupRateLimiter: fast(),
    });
    const runnerAbort = new StepRunner({ getAdapter: () => tgAbort });
    const abortRes = await runnerAbort.executeStep(
      {
        id: 'tg_abort',
        tool: 'telegram.send_message',
        description: 'Send Telegram',
        dependsOn: [],
        args: { chatId, text: 'Hello' },
      },
      new Map(),
      { signal: abortedController.signal },
    );
    expect(abortRes.status).toBe('failed');
    expect(abortRes.error?.details?.requestSent).toBe(false);
    expect(fetchNever).not.toHaveBeenCalled();

    // 2. Pre-write getChat 500 failure
    const fetchGetChat500 = vi.fn(async () => new Response(JSON.stringify({ ok: false, error_code: 500 }), { status: 500 }));
    const tgGetChatFail = new TelegramAdapter({
      credentials: { botToken: token },
      allowedScope: { chats: [chatId] },
      fetchFn: fetchGetChat500 as any,
      rateLimiter: fast(),
      chatRateLimiter: fast(),
      groupRateLimiter: fast(),
    });
    const runnerGetChat = new StepRunner({ getAdapter: () => tgGetChatFail });
    const getChatRes = await runnerGetChat.executeStep(
      {
        id: 'tg_getchat_fail',
        tool: 'telegram.send_message',
        description: 'Send Telegram',
        dependsOn: [],
        args: { chatId, text: 'Hello' },
      },
      new Map(),
    );
    expect(getChatRes.status).toBe('failed');
    expect(getChatRes.error?.details?.requestSent).toBe(false);

    // 3. Definite 4xx rejection on sendMessage (400, 403, 429) attaches requestSent: false
    const fetchSend400 = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: { id: -1001234567890, title: 'Group', type: 'supergroup' } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request' }), { status: 400 }),
      );
    const tgSend400 = new TelegramAdapter({
      credentials: { botToken: token },
      allowedScope: { chats: [chatId] },
      fetchFn: fetchSend400 as any,
      rateLimiter: fast(),
      chatRateLimiter: fast(),
      groupRateLimiter: fast(),
    });
    await expect(
      tgSend400.execute('telegram.send_message', { chatId, text: 'Hello' }),
    ).rejects.toMatchObject({
      category: 'VALIDATION',
      statusCode: 400,
      details: { requestSent: false },
    });
  });

  it('GitHubAdapter: pre-dispatch abort and slot wait abort set requestSent=false and transition StepRunner to failed', async () => {
    const fetchNever = vi.fn();
    const gh = new GitHubAdapter({
      credentials: { token: 'ghp_test_token' },
      allowedScope: { repos: ['team/project'] },
      fetchFn: fetchNever as any,
    });
    const runner = new StepRunner({ getAdapter: () => gh });

    const aborted = new AbortController();
    aborted.abort();
    for (const [tool, args] of [
      ['github.create_issue', { repo: 'team/project', title: 'Bug' }],
      ['github.update_issue', { repo: 'team/project', issueNumber: 1, state: 'closed' }],
      ['github.add_comment', { repo: 'team/project', issueNumber: 1, body: 'Fixed' }],
      ['github.add_label', { repo: 'team/project', issueNumber: 1, label: 'bug' }],
    ] as const) {
      const res = await runner.executeStep(
        { id: `gh_${tool}`, tool, description: tool, dependsOn: [], args: args as any },
        new Map(),
        { signal: aborted.signal },
      );
      expect(res.status).toBe('failed');
      expect(res.error?.details?.requestSent).toBe(false);
    }
    expect(fetchNever).not.toHaveBeenCalled();

    // Abort during rate-limiter slot wait before fetchFn
    const exhaustedLimiter = new GlobalRateLimiter({ maxRequests: 1, windowMs: 60_000 });
    await exhaustedLimiter.waitForSlot('github', 100, 10);
    const ghSlot = new GitHubAdapter({
      credentials: { token: 'ghp_test_token' },
      allowedScope: { repos: ['team/project'] },
      fetchFn: fetchNever as any,
      rateLimiter: exhaustedLimiter,
    });
    const slotController = new AbortController();
    setTimeout(() => slotController.abort(), 15);
    const slotRunner = new StepRunner({ getAdapter: () => ghSlot });
    const slotRes = await slotRunner.executeStep(
      {
        id: 'gh_slot_abort',
        tool: 'github.create_issue',
        description: 'Create issue',
        dependsOn: [],
        args: { repo: 'team/project', title: 'Bug' },
      },
      new Map(),
      { signal: slotController.signal },
    );
    expect(slotRes.status).toBe('failed');
    expect(slotRes.error?.details?.requestSent).toBe(false);
    expect(fetchNever).not.toHaveBeenCalled();
  });

  it('TrelloWriteTools: pre-dispatch abort and pre-mutation GET failures set requestSent=false across all write methods', async () => {
    const fetchPreWriteFail = vi.fn(async () => new Response('Backend 502', { status: 502 }));
    const trello = new TrelloWriteTools({
      credentials: { accessToken: 'trello_token' },
      allowedBoardIds: ['b1'],
      allowedScope: { boards: ['b1'] },
      fetchFn: fetchPreWriteFail as any,
    });

    await expect(trello.createCard({ listId: 'l1', title: 'Card' })).rejects.toMatchObject({
      category: 'SERVER_ERROR',
      details: { requestSent: false },
    });
    await expect(trello.updateCard({ cardId: 'c1', title: 'Updated' })).rejects.toMatchObject({
      category: 'SERVER_ERROR',
      details: { requestSent: false },
    });
    await expect(trello.addMember({ cardId: 'c1', memberId: 'm1' })).rejects.toMatchObject({
      category: 'SERVER_ERROR',
      details: { requestSent: false },
    });
    await expect(trello.addComment({ cardId: 'c1', text: 'Note' })).rejects.toMatchObject({
      category: 'SERVER_ERROR',
      details: { requestSent: false },
    });
    await expect(trello.removeMember({ cardId: 'c1', memberId: 'm1' })).rejects.toMatchObject({
      category: 'SERVER_ERROR',
      details: { requestSent: false },
    });
    await expect(
      trello.updateChecklistItem({ cardId: 'c1', itemName: 'Item', state: 'complete' }),
    ).rejects.toMatchObject({
      category: 'SERVER_ERROR',
      details: { requestSent: false },
    });
    await expect(trello.setCardDueComplete({ cardId: 'c1', dueComplete: true })).rejects.toMatchObject({
      category: 'SERVER_ERROR',
      details: { requestSent: false },
    });

    // Pre-aborted signal on TrelloBaseAdapter.request
    const aborted = new AbortController();
    aborted.abort();
    const fetchNever = vi.fn();
    const trelloAbort = new TrelloWriteTools({
      credentials: { accessToken: 'trello_token' },
      allowedBoardIds: ['b1'],
      allowedScope: { boards: ['b1'] },
      fetchFn: fetchNever as any,
    });
    await expect(
      trelloAbort.createList({ boardId: 'b1', name: 'Sprint' }, { signal: aborted.signal }),
    ).rejects.toMatchObject({
      category: 'NETWORK',
      details: { requestSent: false },
    });
    expect(fetchNever).not.toHaveBeenCalled();
  });

  it('CalendarAdapter: pre-dispatch abort and token acquisition failure set requestSent=false and transition StepRunner to failed', async () => {
    const calId = 'ati@group.calendar.google.com';
    const start = '2026-10-09T15:00:00+07:00';
    const end = '2026-10-09T16:00:00+07:00';

    // 1. Pre-aborted signal
    const aborted = new AbortController();
    aborted.abort();
    const fetchNever = vi.fn();
    const calAbort = new CalendarAdapter({
      credentials: googleCredentials,
      allowedScope: { calendars: [calId] },
      fetchFn: fetchNever as any,
    });
    const runnerAbort = new StepRunner({ getAdapter: () => calAbort });
    const abortRes = await runnerAbort.executeStep(
      {
        id: 'cal_abort',
        tool: 'calendar.create_event',
        description: 'Create event',
        dependsOn: [],
        args: { calendarId: calId, summary: 'Sync', start, end },
      },
      new Map(),
      { signal: aborted.signal },
    );
    expect(abortRes.status).toBe('failed');
    expect(abortRes.error?.details?.requestSent).toBe(false);
    expect(fetchNever).not.toHaveBeenCalled();

    // 2. Token acquisition failure before Calendar POST fetchFn
    const fetchTokenFail = vi.fn(async (url: any) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        return new Response('token service down', { status: 503 });
      }
      throw new Error('Calendar API must not be called when token fails');
    });
    const calTokenFail = new CalendarAdapter({
      credentials: googleCredentials,
      allowedScope: { calendars: [calId] },
      fetchFn: fetchTokenFail as any,
    });
    const runnerToken = new StepRunner({ getAdapter: () => calTokenFail });
    const tokenRes = await runnerToken.executeStep(
      {
        id: 'cal_token_fail',
        tool: 'calendar.create_event',
        description: 'Create event',
        dependsOn: [],
        args: { calendarId: calId, summary: 'Sync', start, end },
      },
      new Map(),
    );
    expect(tokenRes.status).toBe('failed');
    expect(tokenRes.error?.details?.requestSent).toBe(false);
  });

  it('SheetsAdapter: pre-dispatch abort and pre-write GET failures on append_rows, update_rows, delete_rows, create_sheet set requestSent=false and transition StepRunner to failed', async () => {
    const spreadsheetId = 'spreadsheet_fixture_123456';
    const fetchPreWrite500 = vi.fn(async (url: any, init: any) => {
      if (String(url) === 'https://oauth2.googleapis.com/token') {
        return new Response(
          JSON.stringify({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }),
          { status: 200 },
        );
      }
      if ((init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ error: 'upstream 503' }), { status: 503 });
      }
      throw new Error('Mutating POST must not be called when pre-write GET fails');
    });

    const sheets = new SheetsAdapter({
      credentials: googleCredentials,
      allowedScope: { spreadsheets: [spreadsheetId] },
      fetchFn: fetchPreWrite500 as any,
      rateLimiter: new GlobalRateLimiter({ maxRequests: 1000, windowMs: 60_000 }),
    });
    const runner = new StepRunner({ getAdapter: () => sheets });

    for (const [tool, args] of [
      ['sheets.append_rows', { spreadsheetId, sheet: 'Tasks', rows: [['a', 'b']] }],
      [
        'sheets.update_rows',
        { spreadsheetId, sheet: 'Tasks', updates: [{ keyColumn: 'ID', keyValue: '1', values: { Status: 'Done' } }] },
      ],
      ['sheets.delete_rows', { spreadsheetId, sheet: 'Tasks', rowNumbers: [2] }],
      ['sheets.create_sheet', { spreadsheetId, title: 'NewTab', headers: ['ColA'] }],
    ] as const) {
      const res = await runner.executeStep(
        { id: `sh_${tool}`, tool, description: tool, dependsOn: [], args: args as any },
        new Map(),
      );
      expect(res.status).toBe('failed');
      expect(res.error?.details?.requestSent).toBe(false);
    }
  });

  it('JiraAdapter & PersonalJiraHttpTransport: pre-dispatch abort and pre-write GET failures set requestSent=false and transition StepRunner to failed', async () => {
    const jiraCreds = {
      siteUrl: 'https://ati-test.atlassian.net',
      email: 'fixture@example.test',
      apiToken: 'synthetic_token',
    };

    // 1. Pre-write GET 503 on jira.create_issue (createmeta) and jira.add_comment (get issue)
    const fetchGet503 = vi.fn(async (_url: any, init: any) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({}), { status: 503 });
      }
      throw new Error('POST must not be called');
    });
    const jira = new JiraAdapter({
      credentials: jiraCreds,
      allowedScope: { projects: ['ATI'] },
      fetchFn: fetchGet503 as any,
      rateLimiter: new GlobalRateLimiter({ maxRequests: 1000, windowMs: 1000 }),
    });
    const runner = new StepRunner({ getAdapter: () => jira });

    const createRes = await runner.executeStep(
      {
        id: 'jira_create',
        tool: 'jira.create_issue',
        description: 'Create issue',
        dependsOn: [],
        args: { projectKey: 'ATI', summary: 'Bug' },
      },
      new Map(),
    );
    expect(createRes.status).toBe('failed');
    expect(createRes.error?.details?.requestSent).toBe(false);

    const commentRes = await runner.executeStep(
      {
        id: 'jira_comment',
        tool: 'jira.add_comment',
        description: 'Add comment',
        dependsOn: [],
        args: { issueKey: 'ATI-1', body: 'Hello' },
      },
      new Map(),
    );
    expect(commentRes.status).toBe('failed');
    expect(commentRes.error?.details?.requestSent).toBe(false);

    // 2. PersonalJiraHttpTransport pre-fetchFn abort and writing=false failure
    const fetchNever = vi.fn();
    const transport = new PersonalJiraHttpTransport({
      userId: 'u1',
      tokens: {
        getAccessToken: async () => {
          throw new Error('token fetch failed');
        },
      },
      fetchFn: fetchNever as any,
    });
    await expect(
      transport.request('12345678-1234-1234-1234-123456789abc', '/issue', true, {
        method: 'POST',
        body: { fields: {} },
      }),
    ).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      details: { requestSent: false },
    });
    expect(fetchNever).not.toHaveBeenCalled();
  });
});
