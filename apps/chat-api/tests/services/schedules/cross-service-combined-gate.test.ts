import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createPersonalCalendarAdapter,
  createPersonalSheetsAdapter,
  encryptCredentials,
} from '@wap/tool-adapters';
import type {
  CalendarDigestConfig,
  PlanResponse,
  SheetsDigestConfigV2,
  TrelloDigestConfig,
} from '@wap/tool-schemas';
import { ChatService } from '../../../src/services/chat-service.js';
import { createMyCalendarConnectionLookup } from '../../../src/services/gmail/connection-reference.js';
import { PostgresSheetsAppendLeaseStore } from '../../../src/services/adapter-factory.js';
import { computeCalendarDigestHash } from '../../../src/services/schedules/calendar-digest-candidate.js';
import { computeSheetsDigestHash } from '../../../src/services/schedules/sheets-digest-candidate.js';
import { SHEETS_DELIVERY_UNKNOWN } from '../../../src/services/schedules/sheets-digest-runner.js';
import { computeTrelloDigestConfigHash } from '../../../src/services/schedules/trello-digest-candidate.js';
import { TRELLO_DELIVERY_UNKNOWN } from '../../../src/services/schedules/trello-digest-runner.js';
import { certifyScheduleFixture } from '../../../src/services/slack/slack-schedule-origin.js';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';
import {
  buildCombinedRuntimeStack,
  installLoopbackFetchRouter,
} from '../../helpers/cross-service-scheduler-worker.js';

const ENC_KEY = '0123456789abcdef0123456789abcdef';
const TZ = 'Asia/Ho_Chi_Minh';
const DUE_AT_ISO = '2026-11-11T01:00:00.000Z';
const NOW_ISO = '2026-11-11T01:00:30.000Z';
const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../../db/v3/', import.meta.url));
const MIGRATE_SCRIPT = fileURLToPath(new URL('../../../../../db/v3/migrate.mjs', import.meta.url));
const WORKER_SCRIPT = fileURLToPath(
  new URL('../../helpers/cross-service-scheduler-worker.ts', import.meta.url),
);

const EPHEMERAL_RSA_PRIVATE_KEY = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey;

interface RecordedHttpCall {
  method: string;
  pathname: string;
  search: string;
  authHeader: string | null;
  body: any;
  aborted: boolean;
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function waitForPlanSettlement(
  executionService: { getExecutionStatus: (id: string) => { status: string } | null },
  planId: string,
  timeoutMs = 5_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cur = executionService.getExecutionStatus(planId);
    if (
      cur &&
      ['completed', 'failed', 'partial', 'reconciliation_required', 'stopped'].includes(cur.status)
    ) {
      return cur.status;
    }
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`Timed out waiting for plan ${planId} to settle`);
}

function canonicalPlanPayload(planJson: any) {
  const planText = JSON.stringify(planJson);
  const planHash = createHash('sha256').update(planText).digest('hex');
  return { planJson, planText, planHash };
}

describe('Cross-Service Combined Runtime Gate (Sheets R2 + Trello #313 + Calendar #314)', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let activeServers: Server[] = [];
  let restoreFetchFns: Array<() => void> = [];

  beforeAll(async () => {
    db = await createMigratedSchema('xsvc_combined_gate');
  });

  afterEach(async () => {
    while (restoreFetchFns.length > 0) {
      const fn = restoreFetchFns.pop();
      fn?.();
    }
    while (activeServers.length > 0) {
      const srv = activeServers.pop()!;
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  });

  afterAll(async () => {
    await db?.close();
  });

  async function startLoopbackFixture(
    customHandler?: (
      req: IncomingMessage,
      res: ServerResponse,
      ctx: {
        method: string;
        pathname: string;
        url: URL;
        body: any;
        calls: RecordedHttpCall[];
        record: RecordedHttpCall;
      },
    ) => Promise<boolean> | boolean,
  ) {
    const calls: RecordedHttpCall[] = [];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const record: RecordedHttpCall = {
        method: (req.method ?? 'GET').toUpperCase(),
        pathname: url.pathname,
        search: url.search,
        authHeader: typeof req.headers.authorization === 'string' ? req.headers.authorization : null,
        body: null,
        aborted: false,
      };
      res.on('close', () => {
        if (!res.writableEnded) {
          record.aborted = true;
        }
      });
      record.body = await readJsonBody(req).catch(() => null);
      calls.push(record);

      if (customHandler) {
        const handled = await customHandler(req, res, {
          method: record.method,
          pathname: url.pathname,
          url,
          body: record.body,
          calls,
          record,
        });
        if (handled) return;
      }

      // Default OAuth token endpoints (Google OAuth2 & Trello OAuth2)
      if (record.method === 'POST' && url.pathname === '/google-oauth/token') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: 'loopback-google-access-token',
            token_type: 'Bearer',
            expires_in: 3600,
            scope:
              'openid email https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.modify',
          }),
        );
        return;
      }

      if (record.method === 'POST' && url.pathname === '/trello/oauth/token') {
        const rt =
          typeof record.body?.refresh_token === 'string'
            ? record.body.refresh_token
            : 'rt-rotated';
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: `loopback-trello-at-${rt}`,
            refresh_token: rt,
            expires_in: 3600,
          }),
        );
        return;
      }

      // Default Google Sheets v4 endpoints
      const sheetsMetaMatch = url.pathname.match(/^\/sheets\/v4\/spreadsheets\/([^/:]+)$/);
      if (record.method === 'GET' && sheetsMetaMatch) {
        const spreadsheetId = decodeURIComponent(sheetsMetaMatch[1]!);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            spreadsheetId,
            properties: { title: 'KPI Kinh Doanh Q4', locale: 'vi_VN' },
            sheets: [
              {
                properties: {
                  sheetId: 0,
                  title: 'Tasks',
                  gridProperties: { rowCount: 50, columnCount: 8 },
                },
              },
            ],
          }),
        );
        return;
      }

      if (record.method === 'GET' && url.pathname.includes('/sheets/v4/spreadsheets/') && url.pathname.includes('/values/')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            range: 'Tasks!A1:D4',
            majorDimension: 'ROWS',
            values: [
              ['IssueKey', 'Hạng mục', 'Trạng thái', 'Doanh thu'],
              ['XSVC#101', 'Triển khai cổng tích hợp', 'Đang làm', '1.200'],
              ['XSVC#102', 'Kiểm toán bảo mật', 'Hoàn thành', '2.300'],
            ],
          }),
        );
        return;
      }

      if (record.method === 'POST' && url.pathname.includes('/sheets/v4/spreadsheets/') && url.pathname.endsWith(':append')) {
        const rows = Array.isArray(record.body?.values) ? record.body.values : [];
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            spreadsheetId: '1SpreadsheetAllowedLoopback000001',
            updates: {
              updatedRange: `Tasks!A4:D${3 + rows.length}`,
              updatedRows: rows.length,
            },
          }),
        );
        return;
      }

      // Default Gmail send endpoint
      if (record.method === 'POST' && url.pathname === '/gmail/gmail/v1/users/me/messages/send') {
        const seq = calls.filter((c) => c.pathname === url.pathname).length;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: `gmail-msg-${seq}`, threadId: `gmail-thr-${seq}` }));
        return;
      }

      // Default Trello endpoints
      if (record.method === 'GET' && url.pathname === '/trello/1/members/me/boards') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify([
            {
              id: 'board_alpha',
              name: 'Alpha Sprint',
              idOrganization: 'trello_ws_1',
              prefs: { permissionLevel: 'org' },
              member: true,
            },
          ]),
        );
        return;
      }

      const trelloBoardCardsMatch = url.pathname.match(/^\/trello\/1\/boards\/([^/]+)\/cards$/);
      if (record.method === 'GET' && trelloBoardCardsMatch) {
        const boardId = decodeURIComponent(trelloBoardCardsMatch[1]!);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify([
            {
              id: `card_${boardId}_overdue`,
              name: 'Khắc phục lỗi đồng bộ',
              url: `https://trello.com/c/${boardId}1`,
              idBoard: boardId,
              idList: 'list_todo',
              due: '2026-11-10T05:00:00.000Z',
              dueComplete: false,
              idMembers: [],
            },
          ]),
        );
        return;
      }

      if (record.method === 'GET' && url.pathname.startsWith('/trello/1/boards/') && url.pathname.endsWith('/lists')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([{ id: 'list_todo', name: 'To Do', idBoard: 'board_alpha' }]));
        return;
      }

      // Default Google Calendar v3 metadata & events endpoints
      const calMetaMatch = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)$/);
      if (record.method === 'GET' && calMetaMatch) {
        const calId = decodeURIComponent(calMetaMatch[1]!);
        const tzForCal =
          calId.startsWith('ny.') || calId.startsWith('incomplete.') ? 'America/New_York' : TZ;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: calId,
            summary: 'Lịch điều phối chính',
            timeZone: tzForCal,
          }),
        );
        return;
      }

      const calEventsMatch = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events$/);
      if (record.method === 'GET' && calEventsMatch) {
        const calId = decodeURIComponent(calEventsMatch[1]!);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            summary: 'Lịch điều phối chính',
            timeZone: TZ,
            items: [
              {
                id: 'ev-morning-sync',
                status: 'confirmed',
                summary: 'Họp đồng bộ liên dịch vụ',
                start: { dateTime: '2026-11-11T09:00:00+07:00', timeZone: TZ },
                end: { dateTime: '2026-11-11T10:00:00+07:00', timeZone: TZ },
                organizer: { email: calId },
                htmlLink: 'https://calendar.google.com/calendar/event?eid=ev1',
              },
            ],
          }),
        );
        return;
      }

      // Default Slack conversations.list & chat.postMessage endpoints
      if (record.method === 'GET' && url.pathname === '/slack/api/conversations.list') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            channels: [
              { id: 'C_OPS_MAIN', name: 'ops-triad', is_private: false },
              { id: 'C_S3_A', name: 'ops-triad', is_private: false },
              { id: 'C_S3_B', name: 'ops-triad', is_private: false },
              { id: 'C_S3_C', name: 'ops-triad', is_private: false },
              { id: 'C_S4_KILL', name: 'ops-triad', is_private: false },
              { id: 'C_S6_TRELLO', name: 'ops-triad', is_private: false },
              { id: 'C_S6_SHEETS_TIMEOUT', name: 'ops-triad', is_private: false },
              { id: 'C012345678', name: 'ops-triad', is_private: false },
            ],
          }),
        );
        return;
      }

      if (record.method === 'POST' && url.pathname === '/slack/api/chat.postMessage') {
        const seq = calls.filter((c) => c.pathname === '/slack/api/chat.postMessage').length;
        const channel = String(record.body?.channel ?? 'C_OPS_MAIN');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            channel,
            ts: `1762822800.${String(100000 + seq)}`,
          }),
        );
        return;
      }

      // Default Telegram Bot API endpoints
      if (url.pathname.endsWith('/getChatMember')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: { status: 'member' } }));
        return;
      }

      if (url.pathname.endsWith('/getChat')) {
        const chatId = Number(record.body?.chat_id ?? 777101);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            result: { id: chatId, type: 'private', first_name: 'ATI Tester', username: 'ati_tester' },
          }),
        );
        return;
      }

      if (url.pathname.endsWith('/sendMessage')) {
        const seq = calls.filter((c) => c.pathname.endsWith('/sendMessage')).length;
        const chatId = Number(record.body?.chat_id ?? 777101);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 9000 + seq,
              date: 1762822830,
              chat: { id: chatId, type: 'private' },
              text: String(record.body?.text ?? ''),
            },
          }),
        );
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `Unhandled loopback route ${record.method} ${url.pathname}` }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    activeServers.push(server);
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const restore = installLoopbackFetchRouter(baseUrl);
    restoreFetchFns.push(restore);
    return { server, baseUrl, calls };
  }

  async function seedCrossServiceTriad(
    pool: pg.Pool,
    options?: {
      dueAtIso?: string;
      spreadsheetId?: string;
      slackChannelId?: string;
      telegramChatId?: string;
      calendarId?: string;
    },
  ) {
    const dueAtIso = options?.dueAtIso ?? DUE_AT_ISO;
    const spreadsheetId = options?.spreadsheetId ?? '1SpreadsheetAllowedLoopback000001';
    const slackChannelId = options?.slackChannelId ?? 'C012345678';
    const telegramChatId = options?.telegramChatId ?? '777101';
    const calendarId = options?.calendarId ?? 'owner.cal@example.test';

    const owner = await db.person('TriadOwner');
    const credRepo = buildCombinedRuntimeStack({
      pool,
      encryptionKey: ENC_KEY,
      loopbackBaseUrl: 'http://127.0.0.1:9',
    }).credentialRepo;
    const trelloTeamRepo = buildCombinedRuntimeStack({
      pool,
      encryptionKey: ENC_KEY,
      loopbackBaseUrl: 'http://127.0.0.1:9',
    }).trelloTeamRepo;

    const mysheetsCred = await credRepo.upsertPersonalCredentials({
      service: 'mysheets',
      userId: owner.id,
      config: encryptCredentials(
        {
          email: 'owner.sheets@example.test',
          refreshToken: 'rt-mysheets-triad',
          selectedSpreadsheets: [{ id: spreadsheetId, title: 'KPI Kinh Doanh Q4' }],
          allowedScope: { spreadsheets: [spreadsheetId] },
        },
        ENC_KEY,
      ),
      status: 'active',
    });

    const gmailCred = await credRepo.upsertPersonalCredentials({
      service: 'gmail',
      userId: owner.id,
      config: encryptCredentials(
        {
          email: 'owner.gmail@example.test',
          refreshToken: 'rt-gmail-triad',
        },
        ENC_KEY,
      ),
      status: 'active',
    });

    const trelloCred = await credRepo.upsertPersonalCredentials({
      service: 'trello',
      userId: owner.id,
      config: encryptCredentials(
        {
          refreshToken: 'rt-trello-triad',
          memberId: 'mem_triad_1',
          username: 'triad_trello',
        },
        ENC_KEY,
      ),
      status: 'active',
    });

    await trelloTeamRepo.replace({
      scopeId: `personal:${owner.id}`,
      workspaceId: 'trello_ws_1',
      workspaceName: 'Triad Trello WS',
      boards: [{ boardId: 'board_alpha', boardName: 'Alpha Sprint' }],
      chosenBy: owner.id,
    });

    await credRepo.upsertPersonalCredentials({
      service: 'slack',
      userId: owner.id,
      config: encryptCredentials(
        {
          botToken: 'xoxb-disposable-personal-slack',
          allowedScope: { channels: [slackChannelId] },
        },
        ENC_KEY,
      ),
      status: 'active',
    });

    const mycalendarCred = await credRepo.upsertPersonalCredentials({
      service: 'mycalendar',
      userId: owner.id,
      config: encryptCredentials(
        {
          email: calendarId,
          refreshToken: 'rt-mycal-triad',
          selectedCalendars: [{ id: calendarId, summary: 'Lịch điều phối chính', timeZone: TZ, primary: true }],
          allowedScope: { calendars: [calendarId] },
        },
        ENC_KEY,
      ),
      status: 'active',
    });

    const telegramCred = await credRepo.upsertPersonalCredentials({
      service: 'telegram',
      userId: owner.id,
      config: encryptCredentials(
        {
          telegramUserId: telegramChatId,
          username: 'triad_tg',
          selectedChats: [{ chatId: telegramChatId, title: 'Telegram cá nhân', type: 'private' }],
        },
        ENC_KEY,
      ),
      status: 'active',
    });

    const recurrence = { type: 'daily' as const, time: '08:00' };

    // 1. sheets_digest (mysheets -> gmail)
    const sheetsConv = (
      await pool.query(
        `INSERT INTO conversations (user_id, status, title, workspace_mode, workspace_id)
         VALUES ($1, 'chatting', 'Sheets Digest Conv', 'personal', NULL) RETURNING id`,
        [owner.id],
      )
    ).rows[0]!;
    const sheetsConfig: SheetsDigestConfigV2 = {
      version: 2,
      workspaceMode: 'personal',
      workspaceId: null,
      source: {
        service: 'mysheets',
        credentialId: mysheetsCred.id,
        email: 'owner.sheets@example.test',
        spreadsheetId,
        spreadsheetTitle: 'KPI Kinh Doanh Q4',
        sheetName: 'Tasks',
        tailRows: 20,
      },
      destination: {
        service: 'gmail',
        credentialId: gmailCred.id,
        senderEmail: 'owner.gmail@example.test',
        recipientEmail: 'exec-digest@example.test',
      },
      includeAiSummary: true,
    };
    const sheetsHash = computeSheetsDigestHash({
      userId: owner.id,
      recurrence,
      config: sheetsConfig,
    });
    const sheetsSchedule = (
      await pool.query(
        `INSERT INTO schedules (
           user_id, conv_id, name, request, recurrence, services, status, next_run_at,
           kind, digest_config, digest_config_hash, digest_approved_at, workspace_mode, workspace_id
         )
         VALUES ($1, $2, 'Báo cáo Sheets Q4', 'Mỗi sáng 8h gửi báo cáo KPI qua Gmail', $3, '{mysheets,gmail}', 'active', $4,
                 'sheets_digest', $5::jsonb, $6, now(), 'personal', NULL)
         RETURNING *`,
        [owner.id, sheetsConv.id, JSON.stringify(recurrence), dueAtIso, JSON.stringify(sheetsConfig), sheetsHash],
      )
    ).rows[0]!;
    await certifyScheduleFixture(pool, sheetsSchedule.id);

    // 2. trello_digest (trello -> slack)
    const trelloConv = (
      await pool.query(
        `INSERT INTO conversations (user_id, status, title, workspace_mode, workspace_id)
         VALUES ($1, 'chatting', 'Trello Digest Conv', 'personal', NULL) RETURNING id`,
        [owner.id],
      )
    ).rows[0]!;
    const trelloConfig: TrelloDigestConfig = {
      credentialId: trelloCred.id,
      trelloMemberId: 'mem_triad_1',
      username: 'triad_trello',
      boards: [{ id: 'board_alpha', name: 'Alpha Sprint' }],
      destination: 'slack',
      channelId: slackChannelId,
      channelName: 'ops-triad',
      dueSoonHours: 24,
    };
    const trelloHash = computeTrelloDigestConfigHash({
      config: trelloConfig,
      recurrence,
      userId: owner.id,
    });
    const trelloSchedule = (
      await pool.query(
        `INSERT INTO schedules (
           user_id, conv_id, name, request, recurrence, services, status, next_run_at,
           kind, digest_config, digest_config_hash, digest_approved_at, workspace_mode, workspace_id
         )
         VALUES ($1, $2, 'Bản tin Trello Sprint', 'Mỗi sáng 8h gửi bản tin Trello vào Slack', $3, '{trello,slack}', 'active', $4,
                 'trello_digest', $5::jsonb, $6, now(), 'personal', NULL)
         RETURNING *`,
        [owner.id, trelloConv.id, JSON.stringify(recurrence), dueAtIso, JSON.stringify(trelloConfig), trelloHash],
      )
    ).rows[0]!;
    await certifyScheduleFixture(pool, trelloSchedule.id);

    // 3. calendar_digest (mycalendar -> telegram)
    const calendarConv = (
      await pool.query(
        `INSERT INTO conversations (user_id, status, title, workspace_mode, workspace_id)
         VALUES ($1, 'chatting', 'Calendar Digest Conv', 'personal', NULL) RETURNING id`,
        [owner.id],
      )
    ).rows[0]!;
    const calendarConfig: CalendarDigestConfig = {
      version: 1,
      source: 'mycalendar',
      credentialId: mycalendarCred.id,
      email: calendarId,
      calendars: [{ id: calendarId, summary: 'Lịch điều phối chính', primary: true }],
      destination: {
        service: 'telegram',
        chatId: telegramChatId,
        chatTitle: 'Telegram cá nhân',
      },
      windowHours: 24,
      includeSummary: true,
    };
    const calendarHash = computeCalendarDigestHash(calendarConfig);
    const calendarSchedule = (
      await pool.query(
        `INSERT INTO schedules (
           user_id, conv_id, name, request, recurrence, services, status, next_run_at,
           kind, digest_config, digest_config_hash, digest_approved_at, workspace_mode, workspace_id
         )
         VALUES ($1, $2, 'Lịch họp sáng nay', 'Mỗi sáng 8h gửi lịch họp qua Telegram', $3, '{mycalendar,telegram}', 'active', $4,
                 'calendar_digest', $5::jsonb, $6, now(), 'personal', NULL)
         RETURNING *`,
        [
          owner.id,
          calendarConv.id,
          JSON.stringify(recurrence),
          dueAtIso,
          JSON.stringify(calendarConfig),
          calendarHash,
        ],
      )
    ).rows[0]!;
    await certifyScheduleFixture(pool, calendarSchedule.id);

    return {
      owner,
      spreadsheetId,
      slackChannelId,
      telegramChatId,
      calendarId,
      creds: {
        mysheetsCred,
        gmailCred,
        trelloCred,
        mycalendarCred,
        telegramCred,
      },
      convs: {
        sheetsConvId: sheetsConv.id as string,
        trelloConvId: trelloConv.id as string,
        calendarConvId: calendarConv.id as string,
      },
      schedules: {
        sheetsSchedule,
        trelloSchedule,
        calendarSchedule,
      },
    };
  }

  describe('0. Fresh & Pre-Remediation Migration Gate via Actual migrate.mjs', () => {
    it('0a: applies every SQL migration via node db/v3/migrate.mjs idempotently on a fresh DB', async () => {
      const rawUrl = process.env.DATABASE_URL!;
      const files = (await readdir(MIGRATIONS_DIR))
        .filter((f) => /^\d{4}_.*\.sql$/.test(f))
        .sort();
      const historicalFiles = files.filter((file) => Number(file.slice(0, 4)) <= 35);
      expect(historicalFiles).toHaveLength(47);
      expect(historicalFiles.slice(-3)).toEqual([
        '0033_sheets_digest_v2_remediation.sql',
        '0034_github_workspace_scoped_team_scope.sql',
        '0035_sheets_gas_r2_remediation.sql',
      ]);

      const expectedOutput = files.map((file) => `Applied ${file}`);

      const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
      const freshDbName = `xsvc_fresh_${suffix}`;
      const adminUrl = new URL(rawUrl);
      adminUrl.pathname = '/postgres';
      const adminPool = new pg.Pool({ connectionString: adminUrl.href, max: 2 });

      try {
        await adminPool.query(`CREATE DATABASE "${freshDbName}"`);

        const freshUrl = new URL(rawUrl);
        freshUrl.pathname = `/${freshDbName}`;
        const runMigrate = (targetUrl: string) =>
          spawnSync(process.execPath, [MIGRATE_SCRIPT], {
            env: { ...process.env, DATABASE_URL: targetUrl },
            encoding: 'utf8',
          });

        const freshPass1 = runMigrate(freshUrl.href);
        expect(freshPass1.status, freshPass1.stderr).toBe(0);
        expect(freshPass1.stdout.trim().split(/\r?\n/)).toEqual(expectedOutput);

        const freshPass2 = runMigrate(freshUrl.href);
        expect(freshPass2.status, freshPass2.stderr).toBe(0);
        expect(freshPass2.stdout.trim().split(/\r?\n/)).toEqual(expectedOutput);
      } finally {
        await adminPool.query(`DROP DATABASE IF EXISTS "${freshDbName}" WITH (FORCE)`).catch(() => {});
        await adminPool.end();
      }
    }, 15_000);

    it('0b: preserves seeded rows when upgrading a pre-remediation database via node db/v3/migrate.mjs twice', async () => {
      const rawUrl = process.env.DATABASE_URL!;
      const files = (await readdir(MIGRATIONS_DIR))
        .filter((f) => /^\d{4}_.*\.sql$/.test(f))
        .sort();
      const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
      const upgradeDbName = `xsvc_upg_${suffix}`;
      const adminUrl = new URL(rawUrl);
      adminUrl.pathname = '/postgres';
      const adminPool = new pg.Pool({ connectionString: adminUrl.href, max: 2 });

      try {
        await adminPool.query(`CREATE DATABASE "${upgradeDbName}"`);
        const runMigrate = (targetUrl: string) =>
          spawnSync(process.execPath, [MIGRATE_SCRIPT], {
            env: { ...process.env, DATABASE_URL: targetUrl },
            encoding: 'utf8',
          });

        // Supported pre-remediation upgrade: apply <=0032 (44 files), seed multi-service rows, then run migrate.mjs twice
        const upgradeUrl = new URL(rawUrl);
        upgradeUrl.pathname = `/${upgradeDbName}`;
        const upgPool = new pg.Pool({ connectionString: upgradeUrl.href, max: 4 });
        try {
          const preRemediationFiles = files.filter((f) => Number(f.slice(0, 4)) <= 32);
          expect(preRemediationFiles).toHaveLength(44);
          for (const f of preRemediationFiles) {
            await upgPool.query(await readFile(`${MIGRATIONS_DIR}/${f}`, 'utf8'));
          }

          const seededUser = (
            await upgPool.query(
              `INSERT INTO users (email, name, password, role, status, email_verified)
               VALUES ('upg@example.test', 'Upgrade User', 'pbkdf2_sha256$210000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000', 'admin', 'active', true)
               RETURNING id`,
            )
          ).rows[0]!.id as string;
          const seededWs = (
            await upgPool.query(
              `INSERT INTO workspaces (name, invite_code, require_approval, created_by)
               VALUES ('Upgrade Org', 'ATI-UPGR-0001', true, $1)
               RETURNING id`,
              [seededUser],
            )
          ).rows[0]!.id as string;
          await upgPool.query(
            `INSERT INTO workspace_members (workspace_id, user_id, role, status)
             VALUES ($1, $2, 'admin', 'active')`,
            [seededWs, seededUser],
          );
          await upgPool.query(
            `INSERT INTO github_team_scope (id, chosen_by) VALUES ('default', $1)`,
            [seededUser],
          );
          const seededConv = (
            await upgPool.query(
              `INSERT INTO conversations (user_id, status, title, workspace_mode, workspace_id)
               VALUES ($1, 'chatting', 'Upgrade Conv', 'personal', NULL) RETURNING id`,
              [seededUser],
            )
          ).rows[0]!.id as string;
          const dummyHash = 'a'.repeat(64);
          const seededSched = (
            await upgPool.query(
              `INSERT INTO schedules (
                 user_id, conv_id, name, request, recurrence, services, status, next_run_at,
                 kind, digest_config, digest_config_hash, digest_approved_at, workspace_mode
               )
               VALUES ($1, $2, 'Pre-0033 Digest', 'Daily KPI', '{"type":"daily","time":"08:00"}'::jsonb,
                       '{mysheets,gmail}', 'active', now(), 'sheets_digest',
                       '{"source":{"service":"mysheets","spreadsheetId":"1Abc"}}'::jsonb, $3, now(), 'personal')
               RETURNING id`,
              [seededUser, seededConv, dummyHash],
            )
          ).rows[0]!.id as string;
          await upgPool.query(
            `INSERT INTO schedule_runs (schedule_id, schedule_version, trigger, due_at, status, delivery)
             VALUES ($1, 1, 'scheduled', now(), 'digest_sent', '{"destination":"gmail","spreadsheetId":"1Abc"}'::jsonb)`,
            [seededSched],
          );

          const upgPass1 = runMigrate(upgradeUrl.href);
          expect(upgPass1.status, upgPass1.stderr).toBe(0);
          const upgPass2 = runMigrate(upgradeUrl.href);
          expect(upgPass2.status, upgPass2.stderr).toBe(0);

          // Verify seeded rows preserved, legacy default GitHub scope archived (0034), and 0035 trigger active
          const counts = (
            await upgPool.query(`
              SELECT
                (SELECT count(*)::int FROM users) AS users_n,
                (SELECT count(*)::int FROM workspaces) AS ws_n,
                (SELECT count(*)::int FROM schedules) AS sched_n,
                (SELECT count(*)::int FROM schedule_runs) AS runs_n,
                (SELECT count(*)::int FROM github_team_scope WHERE id = 'default') AS live_default_gh,
                (SELECT count(*)::int FROM github_team_scope_legacy_archive WHERE legacy_id = 'default') AS archived_gh
            `)
          ).rows[0]!;
          expect(counts).toEqual({
            users_n: 1,
            ws_n: 1,
            sched_n: 1,
            runs_n: 1,
            live_default_gh: 0,
            archived_gh: 1,
          });

          const postUpgRun = (
            await upgPool.query(
              `INSERT INTO schedule_runs (schedule_id, schedule_version, trigger, due_at, status)
               VALUES ($1, 1, 'scheduled', now() + interval '1 day', 'planning')
               RETURNING dispatched_config, dispatched_config_hash`,
              [seededSched],
            )
          ).rows[0]!;
          expect(postUpgRun.dispatched_config).toEqual({
            source: { service: 'mysheets', spreadsheetId: '1Abc' },
          });
          expect(postUpgRun.dispatched_config_hash).toBe(dummyHash);
        } finally {
          await upgPool.end();
        }
      } finally {
        await adminPool.query(`DROP DATABASE IF EXISTS "${upgradeDbName}" WITH (FORCE)`).catch(() => {});
        await adminPool.end();
      }
    }, 15_000);
  });

  describe('S1–S6: Combined Scheduler, Multi-Process Concurrency, Pause/Cancel, Real OS Kill, Revocation & Fault Isolation', () => {
    it('S1: executes three simultaneously due Sheets, Trello, and Calendar digests in one scheduling window with isolated routing, credential binding, and receipts', async () => {
      await db.pool.query('TRUNCATE schedule_runs, schedules, conversations CASCADE');
      const { baseUrl, calls } = await startLoopbackFixture();
      const triad = await seedCrossServiceTriad(db.pool);

      const stack = buildCombinedRuntimeStack({
        pool: db.pool,
        encryptionKey: ENC_KEY,
        loopbackBaseUrl: baseUrl,
        now: () => new Date(NOW_ISO),
      });

      await stack.schedules.runner.tick();

      const runsRes = await db.pool.query(
        `SELECT r.*, s.kind
           FROM schedule_runs r
           JOIN schedules s ON s.id = r.schedule_id
          WHERE r.schedule_id = ANY($1::uuid[])`,
        [
          [
            triad.schedules.sheetsSchedule.id,
            triad.schedules.trelloSchedule.id,
            triad.schedules.calendarSchedule.id,
          ],
        ],
      );
      expect(runsRes.rows).toHaveLength(3);
      const runIds = new Set(runsRes.rows.map((r) => r.id));
      expect(runIds.size).toBe(3);

      const sheetsRun = runsRes.rows.find((r) => r.kind === 'sheets_digest')!;
      const trelloRun = runsRes.rows.find((r) => r.kind === 'trello_digest')!;
      const calendarRun = runsRes.rows.find((r) => r.kind === 'calendar_digest')!;

      expect(sheetsRun.status).toBe('digest_sent');
      expect(sheetsRun.delivery.destination).toBe('gmail');
      expect(sheetsRun.delivery.gmailMessageId).toBe('gmail-msg-1');
      expect(sheetsRun.delivery.spreadsheetId).toBe(triad.spreadsheetId);
      expect(sheetsRun.dispatched_config_hash).toBe(triad.schedules.sheetsSchedule.digest_config_hash);

      expect(trelloRun.status).toBe('digest_sent');
      expect(trelloRun.delivery.channelId).toBe(triad.slackChannelId);
      expect(trelloRun.delivery.ts).toMatch(/^1762822800\./);

      expect(calendarRun.status).toBe('digest_sent');
      expect(calendarRun.delivery.destinationService).toBe('telegram');
      expect(calendarRun.delivery.channelId).toBe(triad.telegramChatId);
      expect(calendarRun.delivery.calendarsChecked).toBe(1);
      expect(calendarRun.delivery.totalEvents).toBe(1);

      // Verify distinct per-run conversations and zero cross-conversation message contamination
      expect(new Set([sheetsRun.conv_id, trelloRun.conv_id, calendarRun.conv_id]).size).toBe(3);
      const sheetsMsgs = (
        await db.pool.query('SELECT content, metadata FROM messages WHERE conv_id = $1', [
          sheetsRun.conv_id,
        ])
      ).rows;
      const trelloMsgs = (
        await db.pool.query('SELECT content, metadata FROM messages WHERE conv_id = $1', [
          trelloRun.conv_id,
        ])
      ).rows;
      const calendarMsgs = (
        await db.pool.query('SELECT content, metadata FROM messages WHERE conv_id = $1', [
          calendarRun.conv_id,
        ])
      ).rows;

      expect(sheetsMsgs.some((m) => m.metadata?.type === 'sheets_digest_sent')).toBe(true);
      expect(sheetsMsgs.some((m) => String(m.content).includes('Alpha Sprint'))).toBe(false);
      expect(
        trelloMsgs.some(
          (m) => m.metadata?.type === 'answer' && String(m.content).includes('Alpha Sprint'),
        ),
      ).toBe(true);
      expect(trelloMsgs.some((m) => String(m.content).includes('KPI Kinh Doanh'))).toBe(false);
      expect(calendarMsgs.some((m) => m.metadata?.type === 'calendar_digest_sent')).toBe(true);
      expect(calendarMsgs.some((m) => String(m.content).includes('Alpha Sprint'))).toBe(false);

      // Verify exact bounded outbound deliveries: 1 Gmail send, 1 Slack post, 1 Telegram send
      expect(calls.filter((c) => c.pathname === '/gmail/gmail/v1/users/me/messages/send')).toHaveLength(1);
      expect(calls.filter((c) => c.pathname === '/slack/api/chat.postMessage')).toHaveLength(1);
      expect(calls.filter((c) => c.pathname.endsWith('/sendMessage'))).toHaveLength(1);

      // Also verify trello_digest -> telegram through real AdapterFactory.telegramAdapter execution binding + pin enforcement
      const trelloTgConv = (
        await db.pool.query(
          `INSERT INTO conversations (user_id, status, title, workspace_mode, workspace_id)
           VALUES ($1, 'chatting', 'Trello Telegram Digest Conv', 'personal', NULL) RETURNING id`,
          [triad.owner.id],
        )
      ).rows[0]!;
      const trelloTgConfig: TrelloDigestConfig = {
        credentialId: triad.creds.trelloCred.id,
        trelloMemberId: 'mem_triad_1',
        username: 'triad_trello',
        boards: [{ id: 'board_alpha', name: 'Alpha Sprint' }],
        destination: 'telegram',
        channelId: '',
        channelName: '',
        telegramCredentialId: triad.creds.telegramCred.id,
        telegramChatId: triad.telegramChatId,
        telegramChatTitle: 'Telegram cá nhân',
        dueSoonHours: 24,
      };
      const trelloTgRecurrence = { type: 'daily' as const, time: '08:00' };
      const trelloTgHash = computeTrelloDigestConfigHash({
        config: trelloTgConfig,
        recurrence: trelloTgRecurrence,
        userId: triad.owner.id,
      });
      const trelloTgSched = (
        await db.pool.query(
          `INSERT INTO schedules (
             user_id, conv_id, name, request, recurrence, services, status, next_run_at,
             kind, digest_config, digest_config_hash, digest_approved_at, workspace_mode, workspace_id
           )
           VALUES ($1, $2, 'Bản tin Trello Telegram', 'Gửi bản tin Trello qua Telegram', $3, '{trello,telegram}', 'active', $4,
                   'trello_digest', $5::jsonb, $6, now(), 'personal', NULL)
           RETURNING *`,
          [
            triad.owner.id,
            trelloTgConv.id,
            JSON.stringify(trelloTgRecurrence),
            DUE_AT_ISO,
            JSON.stringify(trelloTgConfig),
            trelloTgHash,
          ],
        )
      ).rows[0]!;
      await certifyScheduleFixture(db.pool, trelloTgSched.id);
      await stack.schedules.runner.tick();
      const trelloTgRun = (
        await db.pool.query('SELECT status, delivery FROM schedule_runs WHERE schedule_id = $1', [
          trelloTgSched.id,
        ])
      ).rows[0]!;
      expect(trelloTgRun.status).toBe('digest_sent');
      expect(trelloTgRun.delivery.telegramChatId).toBe(triad.telegramChatId);
      expect(typeof trelloTgRun.delivery.messageId).toBe('number');
      expect(trelloTgRun.delivery.messageId).toBeGreaterThan(9000);
      expect(calls.filter((c) => c.pathname.endsWith('/sendMessage'))).toHaveLength(2);
    });

    it('S2: races two independent OS scheduler child processes against the same PostgreSQL schema with atomic single winner and at most 1 outbound delivery per schedule', async () => {
      await db.pool.query('TRUNCATE schedule_runs, schedules, conversations CASCADE');
      let readyCount = 0;
      let releaseBarrier!: () => void;
      const bothReady = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });
      const readyPids: number[] = [];

      const { baseUrl, calls } = await startLoopbackFixture(async (_req, res, { pathname, body }) => {
        if (pathname === '/__worker/ready') {
          readyCount++;
          if (typeof body?.pid === 'number') readyPids.push(body.pid);
          if (readyCount >= 2) releaseBarrier();
          await Promise.race([bothReady, new Promise((r) => setTimeout(r, 4_000))]);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ go: true }));
          return true;
        }
        return false;
      });

      const triad = await seedCrossServiceTriad(db.pool);
      const schemaRow = (await db.pool.query('SELECT current_schema() AS s')).rows[0]!;
      const workerDbUrl = new URL(process.env.DATABASE_URL!);
      workerDbUrl.searchParams.set('options', `-c search_path=${schemaRow.s}`);

      const runTickChild = (workerName: string) =>
        new Promise<{ pid: number | undefined; code: number | null; stdout: string; stderr: string }>(
          (resolve, reject) => {
            const child = spawn(
              process.execPath,
              ['--import', 'tsx', WORKER_SCRIPT, '--run-worker'],
              {
                cwd: process.cwd(),
                env: {
                  PATH: process.env.PATH,
                  SystemRoot: process.env.SystemRoot,
                  NODE_ENV: 'test',
                  WORKER_MODE: 'tick',
                  WORKER_NAME: workerName,
                  WORKER_DATABASE_URL: workerDbUrl.href,
                  WORKER_LOOPBACK_URL: baseUrl,
                  WORKER_ENCRYPTION_KEY: ENC_KEY,
                  WORKER_NOW_ISO: NOW_ISO,
                },
                stdio: ['ignore', 'pipe', 'pipe'],
              },
            );
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (c) => {
              stdout += String(c);
            });
            child.stderr.on('data', (c) => {
              stderr += String(c);
            });
            child.on('error', reject);
            child.on('close', (code) =>
              resolve({ pid: child.pid, code, stdout, stderr }),
            );
          },
        );

      const [w1, w2] = await Promise.all([runTickChild('s2-worker-1'), runTickChild('s2-worker-2')]);
      expect(w1.code, w1.stderr).toBe(0);
      expect(w2.code, w2.stderr).toBe(0);
      expect(w1.pid).toBeDefined();
      expect(w2.pid).toBeDefined();
      expect(w1.pid).not.toBe(w2.pid);
      expect(new Set(readyPids).size).toBe(2);
      console.info(
        `[XSVC-PID-EVIDENCE] S2 child workers: w1.pid=${w1.pid} (exit=${w1.code}), w2.pid=${w2.pid} (exit=${w2.code})`,
      );

      // Exactly 1 run row per schedule and exactly 1 outbound delivery per destination across both OS processes
      const runs = (
        await db.pool.query(
          `SELECT schedule_id, status, delivery
             FROM schedule_runs
            WHERE schedule_id = ANY($1::uuid[])`,
          [
            [
              triad.schedules.sheetsSchedule.id,
              triad.schedules.trelloSchedule.id,
              triad.schedules.calendarSchedule.id,
            ],
          ],
        )
      ).rows;
      expect(runs).toHaveLength(3);
      expect(runs.every((r) => r.status === 'digest_sent')).toBe(true);

      expect(calls.filter((c) => c.pathname === '/gmail/gmail/v1/users/me/messages/send')).toHaveLength(1);
      expect(calls.filter((c) => c.pathname === '/slack/api/chat.postMessage')).toHaveLength(1);
      expect(calls.filter((c) => c.pathname.endsWith('/sendMessage'))).toHaveLength(1);
    }, 20_000);

    it('S3: enforces pause/cancel before vs after outbound claim barrier without losing confirmed receipts, erasing unknown states, or claiming external recall', async () => {
      await db.pool.query('TRUNCATE schedule_runs, schedules, conversations CASCADE');
      let phase: 'pre_claim_cancel' | 'post_claim_known_pause' | 'post_claim_unknown_cancel' =
        'pre_claim_cancel';
      let onSourceReadHook: (() => Promise<void>) | null = null;
      let onOutboundSendHook: (() => Promise<'ok' | 'drop'>) | null = null;

      const { baseUrl, calls } = await startLoopbackFixture(async (_req, res, { pathname, body }) => {
        if (
          pathname.startsWith('/trello/1/boards/') &&
          pathname.endsWith('/cards') &&
          onSourceReadHook
        ) {
          await onSourceReadHook();
        }
        if (pathname === '/slack/api/chat.postMessage' && onOutboundSendHook) {
          const directive = await onOutboundSendHook();
          if (directive === 'drop') {
            res.socket?.destroy();
            return true;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              channel: String(body?.channel ?? 'C012345678'),
              ts: '1762822900.000301',
            }),
          );
          return true;
        }
        return false;
      });

      const stack = buildCombinedRuntimeStack({
        pool: db.pool,
        encryptionKey: ENC_KEY,
        loopbackBaseUrl: baseUrl,
        now: () => new Date(NOW_ISO),
      });

      // Case S3a: Cancel BEFORE delivery_started_at barrier (during Trello source read) -> 0 Slack posts, run discarded
      const triadA = await seedCrossServiceTriad(db.pool);
      await db.pool.query("UPDATE schedules SET status = 'paused', next_run_at = NULL WHERE id <> $1", [
        triadA.schedules.trelloSchedule.id,
      ]);
      onSourceReadHook = async () => {
        if (phase === 'pre_claim_cancel') {
          await stack.schedules.service.setStatus({
            userId: triadA.owner.id,
            scheduleId: triadA.schedules.trelloSchedule.id,
            action: 'cancel',
            version: 1,
            now: new Date(NOW_ISO),
          });
        }
      };
      await stack.schedules.runner.tick();
      expect(calls.filter((c) => c.pathname === '/slack/api/chat.postMessage')).toHaveLength(0);
      const runA = (
        await db.pool.query('SELECT status, delivery_started_at FROM schedule_runs WHERE schedule_id = $1', [
          triadA.schedules.trelloSchedule.id,
        ])
      ).rows[0]!;
      expect(runA.status).toBe('discarded');
      expect(runA.delivery_started_at).toBeNull();

      // Case S3b: Pause AFTER delivery_started_at when Slack returns valid receipt -> receipt preserved, no chat.delete recall attempted
      onSourceReadHook = null;
      phase = 'post_claim_known_pause';
      const triadB = await seedCrossServiceTriad(db.pool);
      await db.pool.query(
        "UPDATE schedules SET status = 'paused', next_run_at = NULL WHERE id = ANY($1::uuid[])",
        [[triadB.schedules.sheetsSchedule.id, triadB.schedules.calendarSchedule.id]],
      );
      onOutboundSendHook = async () => {
        await stack.schedules.service.setStatus({
          userId: triadB.owner.id,
          scheduleId: triadB.schedules.trelloSchedule.id,
          action: 'pause',
          version: 1,
          now: new Date(NOW_ISO),
        });
        return 'ok';
      };
      await stack.schedules.runner.tick();
      const runB = (
        await db.pool.query('SELECT status, delivery, delivery_started_at FROM schedule_runs WHERE schedule_id = $1', [
          triadB.schedules.trelloSchedule.id,
        ])
      ).rows[0]!;
      const schedB = (
        await db.pool.query('SELECT status FROM schedules WHERE id = $1', [
          triadB.schedules.trelloSchedule.id,
        ])
      ).rows[0]!;
      expect(runB.status).toBe('digest_sent');
      expect(runB.delivery.ts).toBe('1762822900.000301');
      expect(runB.delivery_started_at).not.toBeNull();
      expect(schedB.status).toBe('paused');
      expect(calls.filter((c) => c.pathname.includes('chat.delete'))).toHaveLength(0);

      // Case S3c: Cancel AFTER delivery_started_at when Slack socket drops -> needs_attention + TRELLO_DELIVERY_UNKNOWN preserved, replan blocked
      phase = 'post_claim_unknown_cancel';
      const triadC = await seedCrossServiceTriad(db.pool);
      await db.pool.query(
        "UPDATE schedules SET status = 'paused', next_run_at = NULL WHERE id = ANY($1::uuid[])",
        [[triadC.schedules.sheetsSchedule.id, triadC.schedules.calendarSchedule.id]],
      );
      onOutboundSendHook = async () => {
        await stack.schedules.service.setStatus({
          userId: triadC.owner.id,
          scheduleId: triadC.schedules.trelloSchedule.id,
          action: 'cancel',
          version: 1,
          now: new Date(NOW_ISO),
        });
        return 'drop';
      };
      await stack.schedules.runner.tick();
      const runC = (
        await db.pool.query('SELECT id, status, error, delivery_started_at FROM schedule_runs WHERE schedule_id = $1', [
          triadC.schedules.trelloSchedule.id,
        ])
      ).rows[0]!;
      expect(runC.status).toBe('needs_attention');
      expect(runC.delivery_started_at).not.toBeNull();
      expect(runC.error).toContain('TRELLO_DELIVERY_UNKNOWN');
      await expect(
        stack.schedules.service.startRun({
          userId: triadC.owner.id,
          runId: runC.id,
          trigger: 'replan',
          now: new Date('2026-11-11T01:05:00.000Z'),
        }),
      ).rejects.toMatchObject({ code: 'RUN_NOT_REPLANNABLE' });
    });

    it('S4: performs deterministic OS child SIGKILL after durable delivery_started_at and after durable sheets_append_leases.status=dispatched, proving restart unknown persistence, zero replay, and stale owner fencing', async () => {
      await db.pool.query('TRUNCATE schedule_runs, schedules, conversations, sheets_append_leases CASCADE');
      let resolveDeliveryInFlight!: () => void;
      const deliveryInFlight = new Promise<void>((resolve) => {
        resolveDeliveryInFlight = resolve;
      });
      let resolveAppendInFlight!: () => void;
      const appendInFlight = new Promise<void>((resolve) => {
        resolveAppendInFlight = resolve;
      });

      const { baseUrl, calls } = await startLoopbackFixture(async (_req, res, { pathname }) => {
        if (pathname === '/gmail/gmail/v1/users/me/messages/send') {
          resolveDeliveryInFlight();
          // Hold HTTP response open until child OS process is SIGKILLed
          await new Promise(() => {});
          res.end();
          return true;
        }
        if (pathname.includes('/sheets/v4/spreadsheets/') && pathname.endsWith(':append')) {
          resolveAppendInFlight();
          // Hold HTTP response open until child OS process is SIGKILLed
          await new Promise(() => {});
          res.end();
          return true;
        }
        return false;
      });

      const triad = await seedCrossServiceTriad(db.pool);
      // Keep only sheets_digest active for S4a deterministic single-flight kill
      await db.pool.query(
        "UPDATE schedules SET status = 'paused', next_run_at = NULL WHERE id = ANY($1::uuid[])",
        [[triad.schedules.trelloSchedule.id, triad.schedules.calendarSchedule.id]],
      );

      const schemaRow = (await db.pool.query('SELECT current_schema() AS s')).rows[0]!;
      const workerDbUrl = new URL(process.env.DATABASE_URL!);
      workerDbUrl.searchParams.set('options', `-c search_path=${schemaRow.s}`);

      // --- Part S4a: Real OS child kill mid-digest-delivery after durable delivery_started_at ---
      const digestChild = spawn(
        process.execPath,
        ['--import', 'tsx', WORKER_SCRIPT, '--run-worker'],
        {
          cwd: process.cwd(),
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            NODE_ENV: 'test',
            WORKER_MODE: 'hold_digest_delivery',
            WORKER_NAME: 's4a-digest-victim',
            WORKER_DATABASE_URL: workerDbUrl.href,
            WORKER_LOOPBACK_URL: baseUrl,
            WORKER_ENCRYPTION_KEY: ENC_KEY,
            WORKER_NOW_ISO: NOW_ISO,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const digestPid = digestChild.pid!;
      expect(digestPid).toBeGreaterThan(0);

      await deliveryInFlight;
      const midFlightRun = (
        await db.pool.query(
          'SELECT id, status, delivery_started_at FROM schedule_runs WHERE schedule_id = $1',
          [triad.schedules.sheetsSchedule.id],
        )
      ).rows[0]!;
      expect(midFlightRun.status).toBe('planning');
      expect(midFlightRun.delivery_started_at).not.toBeNull();

      const digestExitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve) => {
          digestChild.on('exit', (code, signal) => resolve({ code, signal }));
        },
      );
      const killedDigestOk = process.kill(digestPid, 'SIGKILL');
      expect(killedDigestOk).toBe(true);
      const digestExit = await digestExitPromise;
      expect(digestExit.code !== 0 || digestExit.signal === 'SIGKILL').toBe(true);
      console.info(
        `[XSVC-PID-EVIDENCE] S4a digest victim: pid=${digestPid}, kill=process.kill(${digestPid}, 'SIGKILL'), exitCode=${digestExit.code}, signal=${digestExit.signal}`,
      );

      // Restart fresh runtime -> reconcileScheduleRuns + tick() -> persists needs_attention + SHEETS_DELIVERY_UNKNOWN & 0 replay sends
      const freshStack = buildCombinedRuntimeStack({
        pool: db.pool,
        encryptionKey: ENC_KEY,
        loopbackBaseUrl: baseUrl,
        now: () => new Date('2026-11-11T01:01:00.000Z'),
      });
      await freshStack.schedules.reconcile();
      await freshStack.schedules.runner.tick();

      const afterKillRun = (
        await db.pool.query(
          'SELECT id, status, error, delivery_started_at FROM schedule_runs WHERE id = $1',
          [midFlightRun.id],
        )
      ).rows[0]!;
      expect(afterKillRun.status).toBe('needs_attention');
      expect(afterKillRun.error).toContain('SHEETS_DELIVERY_UNKNOWN');
      expect(afterKillRun.delivery_started_at).not.toBeNull();
      // Total Gmail send HTTP requests remains 1 (0 replay after OS process kill + restart!)
      expect(calls.filter((c) => c.pathname === '/gmail/gmail/v1/users/me/messages/send')).toHaveLength(1);

      // --- Part S4b: Real OS child kill mid-Sheets-append after durable sheets_append_leases.status='dispatched' ---
      const appendSpreadsheetId = '1SpreadsheetS4AppendKill0000001';
      const appendChild = spawn(
        process.execPath,
        ['--import', 'tsx', WORKER_SCRIPT, '--run-worker'],
        {
          cwd: process.cwd(),
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            NODE_ENV: 'test',
            WORKER_MODE: 'hold_sheets_append',
            WORKER_NAME: 's4b-append-victim',
            WORKER_DATABASE_URL: workerDbUrl.href,
            WORKER_LOOPBACK_URL: baseUrl,
            WORKER_ENCRYPTION_KEY: ENC_KEY,
            WORKER_SPREADSHEET_ID: appendSpreadsheetId,
            WORKER_SHEET_NAME: 'Tasks',
            WORKER_ISSUE_KEY: 'XSVC#404',
            WORKER_LEASE_TTL_MS: '350',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const appendPid = appendChild.pid!;
      expect(appendPid).toBeGreaterThan(0);

      await appendInFlight;
      const midAppendLease = (
        await db.pool.query(
          'SELECT scope_key, lease_id, fencing_token, status FROM sheets_append_leases WHERE spreadsheet_id = $1',
          [appendSpreadsheetId],
        )
      ).rows[0]!;
      expect(midAppendLease.status).toBe('dispatched');
      expect(Number(midAppendLease.fencing_token)).toBe(1);

      const appendExitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve) => {
          appendChild.on('exit', (code, signal) => resolve({ code, signal }));
        },
      );
      const killedAppendOk = process.kill(appendPid, 'SIGKILL');
      expect(killedAppendOk).toBe(true);
      const appendExit = await appendExitPromise;
      expect(appendExit.code !== 0 || appendExit.signal === 'SIGKILL').toBe(true);
      console.info(
        `[XSVC-PID-EVIDENCE] S4b append victim: pid=${appendPid}, kill=process.kill(${appendPid}, 'SIGKILL'), exitCode=${appendExit.code}, signal=${appendExit.signal}`,
      );

      // Wait real wall-clock 450ms for the 350ms lease TTL to expire naturally (NO SQL backdating!)
      await new Promise((r) => setTimeout(r, 450));

      const freshLeaseStore = new PostgresSheetsAppendLeaseStore(db.pool, {
        defaultTtlMs: 5_000,
        pollIntervalMs: 15,
      });
      const freshSheetsAdapter = createPersonalSheetsAdapter({
        userId: triad.owner.id,
        tokens: { getAccessToken: async () => 'tok-fresh-parent' },
        allowedScope: { spreadsheets: [appendSpreadsheetId] },
        apiBaseUrl: `${baseUrl}/sheets/v4/spreadsheets`,
        appendLeaseStore: freshLeaseStore,
      });

      const promotedState = await freshLeaseStore.getLeaseState(midAppendLease.scope_key);
      expect(promotedState?.status).toBe('unknown_outcome');

      // Automatic retry MUST fail closed with 0 additional :append POSTs
      await expect(
        freshSheetsAdapter.execute('mysheets.append_rows', {
          spreadsheetId: appendSpreadsheetId,
          sheet: 'Tasks',
          deduplicate: true,
          keyColumn: 'IssueKey',
          rows: [['XSVC#404', 'Row held mid-append before SIGKILL']],
        }),
      ).rejects.toMatchObject({
        details: { code: 'SHEETS_APPEND_UNKNOWN_OUTCOME_UNRECONCILED' },
      });
      expect(
        calls.filter((c) => c.pathname.includes(appendSpreadsheetId) && c.pathname.endsWith(':append')),
      ).toHaveLength(1);

      // Manual override flags on PostgresSheetsAppendLeaseStore.reconcileUnknownLease MUST fail closed
      expect(
        await freshLeaseStore.reconcileUnknownLease({
          scopeKey: midAppendLease.scope_key,
          reason: 'manual_operator_override',
          manualOperatorDecision: 'operator_confirm_aborted_allow_retry',
          acknowledgeDuplicateRisk: true,
          verify: async () => true,
        }),
      ).toBe(false);

      // Stale pre-dispatch lease fencing check: stalled worker missing heartbeats past TTL is taken over by owner-2 and fenced before write
      const stalledLeaseStore = new PostgresSheetsAppendLeaseStore(db.pool, {
        defaultTtlMs: 5_000,
        heartbeatIntervalMs: 60_000,
        pollIntervalMs: 15,
      });
      const fenceScopeKey = `sheets:${appendSpreadsheetId}:FenceTab`;
      const staleHandle = await stalledLeaseStore.acquireLease({
        scopeKey: fenceScopeKey,
        spreadsheetId: appendSpreadsheetId,
        sheetTitle: 'FenceTab',
        ownerId: 'owner-stale',
        ttlMs: 100,
      });
      await new Promise((r) => setTimeout(r, 170));
      const newHandle = await freshLeaseStore.acquireLease({
        scopeKey: fenceScopeKey,
        spreadsheetId: appendSpreadsheetId,
        sheetTitle: 'FenceTab',
        ownerId: 'owner-new',
        ttlMs: 5_000,
      });
      expect(newHandle.fencingToken).toBeGreaterThan(staleHandle.fencingToken);
      await expect(staleHandle.beginWriteDispatch!()).rejects.toMatchObject({
        details: { code: 'SHEETS_APPEND_LEASE_LOST' },
      });
      await staleHandle.release();
      await newHandle.release();
    }, 25_000);

    it('S5: revokes credentials across Sheets, Trello, and Calendar immediately before ScheduleRunner.tick() and enforces 0 unauthorized outbound requests', async () => {
      await db.pool.query('TRUNCATE schedule_runs, schedules, conversations CASCADE');
      const { baseUrl, calls } = await startLoopbackFixture();
      const triad = await seedCrossServiceTriad(db.pool);

      // Revoke all three source credentials before dispatch
      await db.pool.query(
        `UPDATE service_credentials
            SET status = 'reconnect_required', status_changed_at = now()
          WHERE id = ANY($1::uuid[])`,
        [
          [
            triad.creds.mysheetsCred.id,
            triad.creds.trelloCred.id,
            triad.creds.mycalendarCred.id,
          ],
        ],
      );

      const stack = buildCombinedRuntimeStack({
        pool: db.pool,
        encryptionKey: ENC_KEY,
        loopbackBaseUrl: baseUrl,
        now: () => new Date(NOW_ISO),
      });
      await stack.schedules.runner.tick();

      // Zero provider reads or outbound deliveries across all three services
      expect(calls).toHaveLength(0);

      const schedulesAfter = (
        await db.pool.query(
          'SELECT id, kind, status, pause_reason FROM schedules WHERE id = ANY($1::uuid[])',
          [
            [
              triad.schedules.sheetsSchedule.id,
              triad.schedules.trelloSchedule.id,
              triad.schedules.calendarSchedule.id,
            ],
          ],
        )
      ).rows;
      expect(schedulesAfter).toHaveLength(3);
      for (const s of schedulesAfter) {
        expect(s.status).toBe('paused');
        expect(String(s.pause_reason ?? '')).not.toBe('');
      }
    });

    it('S6: isolates Sheets AbortSignal timeout, Trello malformed "undefined" receipt, Calendar incomplete paginated read, and a healthy Gmail control in a mixed batch', async () => {
      await db.pool.query('TRUNCATE schedule_runs, schedules, conversations CASCADE');
      let calendarReadAbortedObserved = false;
      let calendarAiCalls = 0;

      const timeoutCalId = 'timeout.cal@example.test';
      const partialCalId = 'partial.cal@example.test';

      const { baseUrl, calls } = await startLoopbackFixture(async (req, res, { pathname, body }) => {
        // 1. Trello -> Slack returns malformed ts: "undefined"
        if (pathname === '/slack/api/chat.postMessage' && body?.channel === 'C_S6_TRELLO') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, channel: 'C_S6_TRELLO', ts: 'undefined' }));
          return true;
        }
        // 2. Sheets -> Slack hangs post-claim until caller AbortSignal / request timeout aborts socket
        if (pathname === '/slack/api/chat.postMessage' && body?.channel === 'C_S6_SHEETS_TIMEOUT') {
          await new Promise<void>((resolve) => {
            res.on('close', () => resolve());
          });
          return true;
        }
        // 3. Calendar partial coverage: returns 20 events (MAX_DIGEST_DISPLAY_EVENTS) + nextPageToken -> coverage.complete === false (reason: next_page_available)
        if (pathname === `/calendar/v3/calendars/${encodeURIComponent(partialCalId)}/events`) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              summary: 'Lịch Phân Trang',
              timeZone: TZ,
              nextPageToken: 'unfetched-page-2',
              items: Array.from({ length: 20 }, (_, idx) => ({
                id: `ev-partial-${idx + 1}`,
                status: 'confirmed',
                summary: `Họp rà soát trang 1 #${idx + 1}`,
                start: {
                  dateTime: `2026-11-11T${String(8 + Math.floor(idx / 2)).padStart(2, '0')}:${idx % 2 === 0 ? '00' : '30'}:00+07:00`,
                  timeZone: TZ,
                },
                end: {
                  dateTime: `2026-11-11T${String(8 + Math.floor(idx / 2)).padStart(2, '0')}:${idx % 2 === 0 ? '25' : '55'}:00+07:00`,
                  timeZone: TZ,
                },
                organizer: { email: partialCalId },
                htmlLink: `https://calendar.google.com/calendar/event?eid=evp${idx + 1}`,
              })),
            }),
          );
          return true;
        }
        // 4. Calendar read timeout control: hangs until readTimeoutMs AbortSignal aborts socket
        if (pathname === `/calendar/v3/calendars/${encodeURIComponent(timeoutCalId)}/events`) {
          await new Promise<void>((resolve) => {
            res.on('close', () => {
              if (!res.writableEnded) {
                calendarReadAbortedObserved = true;
              }
              resolve();
            });
          });
          return true;
        }
        return false;
      });

      // Healthy control (mysheets -> gmail) + Trello malformed receipt + Calendar partial read + Calendar read-AbortSignal timeout
      const triad = await seedCrossServiceTriad(db.pool, {
        slackChannelId: 'C_S6_TRELLO',
        calendarId: partialCalId,
      });

      // Seed 4th schedule in same window: Calendar read-timeout with real AbortSignal (calendarReadTimeoutMs = 150ms)
      const timeoutOwner = await db.person('TimeoutCalOwner');
      const stack = buildCombinedRuntimeStack({
        pool: db.pool,
        encryptionKey: ENC_KEY,
        loopbackBaseUrl: baseUrl,
        now: () => new Date(NOW_ISO),
        calendarReadTimeoutMs: 180,
        summarizeCalendar: async () => {
          calendarAiCalls++;
          return 'Không được gọi khi coverage chưa đầy đủ';
        },
      });

      const timeoutCalCred = await stack.credentialRepo.upsertPersonalCredentials({
        service: 'mycalendar',
        userId: timeoutOwner.id,
        config: encryptCredentials(
          {
            email: timeoutCalId,
            refreshToken: 'rt-timeout-cal',
            selectedCalendars: [{ id: timeoutCalId, summary: 'Lịch Timeout', timeZone: TZ, primary: true }],
            allowedScope: { calendars: [timeoutCalId] },
          },
          ENC_KEY,
        ),
        status: 'active',
      });
      await stack.credentialRepo.upsertPersonalCredentials({
        service: 'telegram',
        userId: timeoutOwner.id,
        config: encryptCredentials(
          {
            telegramUserId: '777199',
            username: 'timeout_tg',
            selectedChats: [{ chatId: '777199', title: 'TG Timeout', type: 'private' }],
          },
          ENC_KEY,
        ),
        status: 'active',
      });
      const timeoutConv = (
        await db.pool.query(
          `INSERT INTO conversations (user_id, status, title, workspace_mode)
           VALUES ($1, 'chatting', 'Timeout Cal Conv', 'personal') RETURNING id`,
          [timeoutOwner.id],
        )
      ).rows[0]!;
      const timeoutCalCfg: CalendarDigestConfig = {
        version: 1,
        source: 'mycalendar',
        credentialId: timeoutCalCred.id,
        email: timeoutCalId,
        calendars: [{ id: timeoutCalId, summary: 'Lịch Timeout', primary: true }],
        destination: { service: 'telegram', chatId: '777199', chatTitle: 'TG Timeout' },
        windowHours: 24,
        includeSummary: true,
      };
      const timeoutCalSched = (
        await db.pool.query(
          `INSERT INTO schedules (
             user_id, conv_id, name, request, recurrence, services, status, next_run_at,
             kind, digest_config, digest_config_hash, digest_approved_at, workspace_mode
           )
           VALUES ($1, $2, 'Lịch Timeout', 'Bản tin lịch', '{"type":"daily","time":"08:00"}'::jsonb,
                   '{mycalendar,telegram}', 'active', $3, 'calendar_digest', $4::jsonb, $5, now(), 'personal')
           RETURNING *`,
          [
            timeoutOwner.id,
            timeoutConv.id,
            DUE_AT_ISO,
            JSON.stringify(timeoutCalCfg),
            computeCalendarDigestHash(timeoutCalCfg),
          ],
        )
      ).rows[0]!;
      await certifyScheduleFixture(db.pool, timeoutCalSched.id);

      // Also verify real AbortSignal propagation on PersonalSheetsAdapter read directly against hanging loopback
      const abortCtrl = new AbortController();
      setTimeout(() => abortCtrl.abort(new Error('SHEETS_TEST_TIMEOUT')), 120);
      const timeoutSheetsAdapter = createPersonalSheetsAdapter({
        userId: triad.owner.id,
        tokens: { getAccessToken: async () => 'tok-sheets-abort' },
        allowedScope: { spreadsheets: [triad.spreadsheetId] },
        apiBaseUrl: `${baseUrl}/sheets/v4/spreadsheets`,
        fetchFn: async (url, init) => {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })),
              { once: true },
            );
            void url;
          });
        },
      });
      let observedAdapterAbortSignal = false;
      abortCtrl.signal.addEventListener('abort', () => {
        observedAdapterAbortSignal = true;
      });
      await expect(
        timeoutSheetsAdapter.execute(
          'mysheets.read_range',
          { spreadsheetId: triad.spreadsheetId, range: 'Tasks!A1:B2' },
          { signal: abortCtrl.signal },
        ),
      ).rejects.toThrow();
      expect(observedAdapterAbortSignal).toBe(true);

      // Execute mixed batch tick
      await stack.schedules.runner.tick();

      expect(calendarReadAbortedObserved).toBe(true);
      expect(calendarAiCalls).toBe(0);

      const batchRuns = (
        await db.pool.query(
          `SELECT schedule_id, status, error, delivery, delivery_started_at
             FROM schedule_runs
            WHERE schedule_id = ANY($1::uuid[])`,
          [
            [
              triad.schedules.sheetsSchedule.id,
              triad.schedules.trelloSchedule.id,
              triad.schedules.calendarSchedule.id,
              timeoutCalSched.id,
            ],
          ],
        )
      ).rows;
      expect(batchRuns).toHaveLength(4);

      const healthySheets = batchRuns.find((r) => r.schedule_id === triad.schedules.sheetsSchedule.id)!;
      const unknownTrello = batchRuns.find((r) => r.schedule_id === triad.schedules.trelloSchedule.id)!;
      const partialCalendar = batchRuns.find((r) => r.schedule_id === triad.schedules.calendarSchedule.id)!;
      const abortedCalendar = batchRuns.find((r) => r.schedule_id === timeoutCalSched.id)!;

      // 1. Healthy Sheets -> Gmail control unaffected by sibling failures
      expect(healthySheets.status).toBe('digest_sent');
      expect(healthySheets.delivery.gmailMessageId).toBe('gmail-msg-1');
      expect(healthySheets.error).toBeNull();

      // 2. Trello -> Slack malformed ts: 'undefined' -> needs_attention + TRELLO_DELIVERY_UNKNOWN
      expect(unknownTrello.status).toBe('needs_attention');
      expect(unknownTrello.delivery_started_at).not.toBeNull();
      expect(unknownTrello.error).toContain('TRELLO_DELIVERY_UNKNOWN');

      // 3. Calendar -> Telegram paginated incomplete read -> truthful warning banner, 0 AI calls, digest_sent
      expect(partialCalendar.status).toBe('digest_sent');
      expect(partialCalendar.delivery.destinationService).toBe('telegram');
      expect(partialCalendar.delivery.channelId).toBe(triad.telegramChatId);
      const tgPayload = calls.find((c) => c.pathname.endsWith('/sendMessage'))?.body;
      expect(String(tgPayload?.text ?? '')).toContain('độ phủ: PARTIAL');

      // 4. Calendar read timeout -> digest_failed before claim, 0 Telegram sends for 777199
      expect(abortedCalendar.status).toBe('digest_failed');
      expect(abortedCalendar.delivery_started_at).toBeNull();
      expect(
        calls.filter((c) => c.pathname.endsWith('/sendMessage') && String(c.body?.chat_id) === '777199'),
      ).toHaveLength(0);
    });
  });

  describe('Negative Authorization Matrix (ExecutionService + AdapterFactory + Real Loopback Adapters)', () => {
    it('N1: blocks blank organization workspaceId in both AdapterFactory (even with warm legacy cache) and ExecutionService with 0 unauthorized outbound requests', async () => {
      const { baseUrl, calls } = await startLoopbackFixture();
      const stack = buildCombinedRuntimeStack({
        pool: db.pool,
        encryptionKey: ENC_KEY,
        loopbackBaseUrl: baseUrl,
      });

      const owner = await db.person('BlankOrgUser');
      // Seed a legacy shared Slack credential and warm the legacy cache entry
      await stack.credentialRepo.upsertCredentials(
        'slack',
        encryptCredentials(
          { botToken: 'xoxb-legacy-warm-token', allowedScope: { channels: ['C012345678'] } },
          ENC_KEY,
        ),
        'active',
        owner.email,
        null,
      );
      const legacyAdapter = await stack.adapterFactory.getAdapterForService('slack');
      expect(legacyAdapter.service).toBe('slack');

      // Calling AdapterFactory in organization mode with blank/null/whitespace workspaceId MUST NOT hit legacy cache!
      for (const badWsId of ['', '   ', null, undefined]) {
        await expect(
          stack.adapterFactory
            .getAdapterForService('slack', {
              userId: owner.id,
              phase: 'execution',
              workspaceMode: 'organization',
              workspaceId: badWsId as any,
            })
            .then((a) => ({ unexpectedlyResolvedAdapter: a.constructor.name })),
        ).rejects.toThrow(/Organization credentials require workspace id/i);
      }

      // Calling ExecutionService.approveAndStart when convRepo returns organization mode with blank workspace_id MUST fail closed with 403 and 0 outbound calls
      const conv = await stack.convRepo.createConversation(owner.id, { workspaceMode: 'personal' });
      const { planJson, planText, planHash } = canonicalPlanPayload({
        kind: 'plan',
        thinking: 't',
        summary: 's',
        warnings: [],
        steps: [
          {
            id: 's1',
            tool: 'slack.send_message',
            description: 'Send Slack',
            args: { channel: 'C012345678', text: 'Should never send' },
            dependsOn: [],
          },
        ],
      });
      const plan = await stack.planRepo.createPlan({
        convId: conv.id,
        planJson,
        planText,
        planHash,
        expiresAt: new Date(Date.now() + 300_000),
      });

      const tamperedExec = new (stack.executionService.constructor as any)({
        planRepo: stack.planRepo,
        stepRepo: stack.stepRepo,
        convRepo: {
          getConversation: async () => ({
            id: conv.id,
            user_id: owner.id,
            workspace_mode: 'organization',
            workspace_id: '',
          }),
        },
        workspaceRepo: stack.workspaceRepo,
        adapterFactory: stack.adapterFactory,
        enforceReportGrounding: false,
      });

      const approveRes = await tamperedExec.approveAndStart(plan.id, owner.id);
      expect(approveRes.success).toBe(false);
      expect(approveRes.status).toBe(403);
      expect(calls).toHaveLength(0);
    });

    it('N2 & N3: blocks workspace membership revocation, workspace context substitution, conversation owner substitution, and personal credentialId substitution between approval and execution with 0 unauthorized outbound requests', async () => {
      const { baseUrl, calls } = await startLoopbackFixture();
      const stack = buildCombinedRuntimeStack({
        pool: db.pool,
        encryptionKey: ENC_KEY,
        loopbackBaseUrl: baseUrl,
      });

      const admin = await db.person('OrgAdmin');
      const member = await db.person('OrgMember');
      const intruder = await db.person('Intruder');
      const org = await stack.workspaceRepo.create(admin.id, 'Gate Org', false);
      await stack.workspaceRepo.joinByInviteCode(member.id, org.inviteCode!);

      await stack.credentialRepo.upsertCredentials(
        'slack',
        encryptCredentials(
          { botToken: 'xoxb-org-token', allowedScope: { channels: ['C012345678'] } },
          ENC_KEY,
        ),
        'active',
        admin.email,
        org.id,
      );

      // N2: Org member approves plan, then membership is disabled BEFORE setImmediate step execution runs
      const orgConv = await stack.convRepo.createConversation(member.id, {
        workspaceMode: 'organization',
        workspaceId: org.id,
      });
      const orgPlanPayload = canonicalPlanPayload({
        kind: 'plan',
        thinking: 't',
        summary: 's',
        warnings: [],
        steps: [
          {
            id: 'step_org_slack',
            tool: 'slack.send_message',
            description: 'Org Slack send',
            args: { channel: 'C012345678', text: 'Post-revocation message' },
            dependsOn: [],
          },
        ],
      });
      const orgPlan = await stack.planRepo.createPlan({
        convId: orgConv.id,
        ...orgPlanPayload,
        expiresAt: new Date(Date.now() + 300_000),
      });

      const approvedOrg = await stack.executionService.approveAndStart(orgPlan.id, member.id);
      expect(approvedOrg.success).toBe(true);
      // Immediately disable member in workspace_members in the same turn before setImmediate dispatches step
      await db.pool.query(
        "UPDATE workspace_members SET status = 'disabled' WHERE workspace_id = $1 AND user_id = $2",
        [org.id, member.id],
      );
      const settledOrg = await waitForPlanSettlement(stack.executionService, orgPlan.id);
      expect(settledOrg).not.toBe('completed');
      expect(calls.filter((c) => c.pathname === '/slack/api/chat.postMessage')).toHaveLength(0);

      // N3a: Conversation user_id substituted between approval and execution -> 0 outbound calls
      const personalConv = await stack.convRepo.createConversation(member.id, {
        workspaceMode: 'personal',
      });
      const mysheetsCred = await stack.credentialRepo.upsertPersonalCredentials({
        service: 'mysheets',
        userId: member.id,
        config: encryptCredentials(
          {
            email: 'member@example.test',
            refreshToken: 'rt-member-sheets',
            selectedSpreadsheets: [{ id: '1SpreadsheetAllowedLoopback000001', title: 'Member Sheet' }],
            allowedScope: { spreadsheets: ['1SpreadsheetAllowedLoopback000001'] },
          },
          ENC_KEY,
        ),
        status: 'active',
      });
      const userSubPayload = canonicalPlanPayload({
        kind: 'plan',
        thinking: 't',
        summary: 's',
        warnings: [],
        connections: {
          mysheets: {
            credentialId: mysheetsCred.id,
            email: 'member@example.test',
            allowedSpreadsheets: ['1SpreadsheetAllowedLoopback000001'],
          },
        },
        steps: [
          {
            id: 'step_read_sheet',
            tool: 'mysheets.read_range',
            description: 'Read sheet',
            args: { spreadsheetId: '1SpreadsheetAllowedLoopback000001', range: 'Tasks!A1:B2' },
            dependsOn: [],
          },
        ],
      });
      const userSubPlan = await stack.planRepo.createPlan({
        convId: personalConv.id,
        ...userSubPayload,
        expiresAt: new Date(Date.now() + 300_000),
      });
      const approvedUserSub = await stack.executionService.approveAndStart(userSubPlan.id, member.id);
      expect(approvedUserSub.success).toBe(true);
      await db.pool.query('UPDATE conversations SET user_id = $2 WHERE id = $1', [
        personalConv.id,
        intruder.id,
      ]);
      const settledUserSub = await waitForPlanSettlement(stack.executionService, userSubPlan.id);
      expect(settledUserSub).not.toBe('completed');
      expect(calls.filter((c) => c.pathname.includes('/sheets/v4/spreadsheets/'))).toHaveLength(0);

      // N3b: Personal credentialId rotated/substituted between approval and execution -> 0 outbound calls
      const credSubConv = await stack.convRepo.createConversation(admin.id, {
        workspaceMode: 'personal',
      });
      const origCred = await stack.credentialRepo.upsertPersonalCredentials({
        service: 'mycalendar',
        userId: admin.id,
        config: encryptCredentials(
          {
            email: 'admin.cal@example.test',
            refreshToken: 'rt-cal-1',
            selectedCalendars: [{ id: 'admin.cal@example.test', summary: 'Admin Cal', timeZone: TZ, primary: true }],
            allowedScope: { calendars: ['admin.cal@example.test'] },
          },
          ENC_KEY,
        ),
        status: 'active',
      });
      const credSubPayload = canonicalPlanPayload({
        kind: 'plan',
        thinking: 't',
        summary: 's',
        warnings: [],
        connections: {
          mycalendar: {
            credentialId: origCred.id,
            email: 'admin.cal@example.test',
            allowedCalendars: ['admin.cal@example.test'],
          },
        },
        steps: [
          {
            id: 'step_list_cal',
            tool: 'mycalendar.list_events',
            description: 'List events',
            args: {
              calendarId: 'admin.cal@example.test',
              timeMin: '2026-11-11T00:00:00+07:00',
              timeMax: '2026-11-11T23:59:59+07:00',
            },
            dependsOn: [],
          },
        ],
      });
      const credSubPlan = await stack.planRepo.createPlan({
        convId: credSubConv.id,
        ...credSubPayload,
        expiresAt: new Date(Date.now() + 300_000),
      });
      const approvedCredSub = await stack.executionService.approveAndStart(credSubPlan.id, admin.id);
      expect(approvedCredSub.success).toBe(true);
      // Upserting generates a new credential UUID before execution runs
      const rotatedCred = await stack.credentialRepo.upsertPersonalCredentials({
        service: 'mycalendar',
        userId: admin.id,
        config: encryptCredentials(
          {
            email: 'admin.cal@example.test',
            refreshToken: 'rt-cal-2',
            selectedCalendars: [{ id: 'admin.cal@example.test', summary: 'Admin Cal', timeZone: TZ, primary: true }],
            allowedScope: { calendars: ['admin.cal@example.test'] },
          },
          ENC_KEY,
        ),
        status: 'active',
      });
      expect(rotatedCred.id).not.toBe(origCred.id);
      const settledCredSub = await waitForPlanSettlement(stack.executionService, credSubPlan.id);
      expect(settledCredSub).not.toBe('completed');
      expect(calls.filter((c) => c.pathname.startsWith('/calendar/v3/'))).toHaveLength(0);
    });

    it('N4: enforces immediate pre-dispatch credential revocation across warm org Sheets/Slack and personal MySheets/Trello/MyCalendar caches with 0 unauthorized outbound requests', async () => {
      const { baseUrl, calls } = await startLoopbackFixture();
      const stack = buildCombinedRuntimeStack({
        pool: db.pool,
        encryptionKey: ENC_KEY,
        loopbackBaseUrl: baseUrl,
      });

      const owner = await db.person('RevokePreDispatchOwner');
      const org = await stack.workspaceRepo.create(owner.id, 'Revoke Org', false);

      // Seed org Sheets + org Slack and warm AdapterFactory cache at phase='planning'
      await stack.credentialRepo.upsertCredentials(
        'sheets',
        encryptCredentials(
          {
            clientEmail: 'sa@disposable-test.iam.gserviceaccount.com',
            privateKey: EPHEMERAL_RSA_PRIVATE_KEY,
            allowedScope: { spreadsheets: ['1SpreadsheetAllowedLoopback000001'] },
          },
          ENC_KEY,
        ),
        'active',
        owner.email,
        org.id,
      );
      await stack.credentialRepo.upsertCredentials(
        'slack',
        encryptCredentials(
          { botToken: 'xoxb-revoke-org', allowedScope: { channels: ['C012345678'] } },
          ENC_KEY,
        ),
        'active',
        owner.email,
        org.id,
      );

      await stack.adapterFactory.getAdapterForService('sheets', {
        userId: owner.id,
        phase: 'planning',
        workspaceMode: 'organization',
        workspaceId: org.id,
      });
      await stack.adapterFactory.getAdapterForService('slack', {
        userId: owner.id,
        phase: 'planning',
        workspaceMode: 'organization',
        workspaceId: org.id,
      });

      // Seed personal MySheets, Trello, MyCalendar and warm personalCache at phase='planning'
      const msCred = await stack.credentialRepo.upsertPersonalCredentials({
        service: 'mysheets',
        userId: owner.id,
        config: encryptCredentials(
          {
            email: 'owner@example.test',
            refreshToken: 'rt-ms-warm',
            selectedSpreadsheets: [{ id: '1SpreadsheetAllowedLoopback000001', title: 'S1' }],
            allowedScope: { spreadsheets: ['1SpreadsheetAllowedLoopback000001'] },
          },
          ENC_KEY,
        ),
        status: 'active',
      });
      const trCred = await stack.credentialRepo.upsertPersonalCredentials({
        service: 'trello',
        userId: owner.id,
        config: encryptCredentials(
          { refreshToken: 'rt-tr-warm', memberId: 'mem_1', username: 'tr_warm' },
          ENC_KEY,
        ),
        status: 'active',
      });
      await stack.trelloTeamRepo.replace({
        scopeId: `personal:${owner.id}`,
        workspaceId: 'trello_ws_1',
        workspaceName: 'Warm WS',
        boards: [{ boardId: 'board_alpha', boardName: 'Alpha Sprint' }],
        chosenBy: owner.id,
      });
      const mcCred = await stack.credentialRepo.upsertPersonalCredentials({
        service: 'mycalendar',
        userId: owner.id,
        config: encryptCredentials(
          {
            email: 'owner.cal@example.test',
            refreshToken: 'rt-mc-warm',
            selectedCalendars: [{ id: 'owner.cal@example.test', summary: 'Cal', timeZone: TZ, primary: true }],
            allowedScope: { calendars: ['owner.cal@example.test'] },
          },
          ENC_KEY,
        ),
        status: 'active',
      });

      await stack.adapterFactory.getAdapterForService('mysheets', {
        userId: owner.id,
        phase: 'planning',
        workspaceMode: 'personal',
      });
      await stack.adapterFactory.getAdapterForService('trello', {
        userId: owner.id,
        phase: 'planning',
        workspaceMode: 'personal',
      });
      await stack.adapterFactory.getAdapterForService('mycalendar', {
        userId: owner.id,
        phase: 'planning',
        workspaceMode: 'personal',
      });

      // Clear planning-time OAuth lookup calls so we measure execution-phase outbound strictly
      calls.length = 0;

      // Revoke ALL 5 credentials directly in PostgreSQL WITHOUT calling adapterFactory.clearCache()!
      await db.pool.query(
        "UPDATE service_credentials SET status = 'reconnect_required', status_changed_at = now() WHERE workspace_id = $1 OR user_id = $2",
        [org.id, owner.id],
      );

      // Every phase='execution' call MUST fail closed with 0 outbound HTTP calls!
      await expect(
        stack.adapterFactory
          .getAdapterForService('sheets', {
            userId: owner.id,
            phase: 'execution',
            workspaceMode: 'organization',
            workspaceId: org.id,
          })
          .then((a) => ({ unexpectedlyResolvedAdapter: a.constructor.name })),
      ).rejects.toThrow();
      await expect(
        stack.adapterFactory
          .getAdapterForService('slack', {
            userId: owner.id,
            phase: 'execution',
            workspaceMode: 'organization',
            workspaceId: org.id,
          })
          .then((a) => ({ unexpectedlyResolvedAdapter: a.constructor.name })),
      ).rejects.toThrow();
      await expect(
        stack.adapterFactory
          .getAdapterForService('mysheets', {
            userId: owner.id,
            phase: 'execution',
            workspaceMode: 'personal',
            connections: {
              mysheets: {
                credentialId: msCred.id,
                email: 'owner@example.test',
                allowedSpreadsheets: ['1SpreadsheetAllowedLoopback000001'],
              },
            },
          })
          .then((a) => ({ unexpectedlyResolvedAdapter: a.constructor.name })),
      ).rejects.toThrow();
      await expect(
        stack.adapterFactory
          .getAdapterForService('trello', {
            userId: owner.id,
            phase: 'execution',
            workspaceMode: 'personal',
            connections: {
              trello: {
                credentialId: trCred.id,
                memberId: 'mem_1',
                username: 'tr_warm',
                boardIds: ['board_alpha'],
              },
            },
          })
          .then((a) => ({ unexpectedlyResolvedAdapter: a.constructor.name })),
      ).rejects.toThrow();
      await expect(
        stack.adapterFactory
          .getAdapterForService('mycalendar', {
            userId: owner.id,
            phase: 'execution',
            workspaceMode: 'personal',
            connections: {
              mycalendar: {
                credentialId: mcCred.id,
                email: 'owner.cal@example.test',
                allowedCalendars: ['owner.cal@example.test'],
              },
            },
          })
          .then((a) => ({ unexpectedlyResolvedAdapter: a.constructor.name })),
      ).rejects.toThrow();

      expect(calls).toHaveLength(0);
    });

    it('N5, N6 & N7: enforces Trello traversal/board/card/list parent scopes and out-of-allowlist Sheets & Calendar targets with 0 unauthorized outbound requests (distinguishing bounded authorized metadata prechecks)', async () => {
      const { baseUrl, calls } = await startLoopbackFixture(async (_req, res, { pathname }) => {
        if (pathname === '/trello/1/lists/list_foreign') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: 'list_foreign', name: 'Foreign', idBoard: 'board_forbidden' }));
          return true;
        }
        if (pathname === '/trello/1/cards/card_foreign') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: 'card_foreign', name: 'Foreign Card', idBoard: 'board_forbidden' }));
          return true;
        }
        if (pathname === '/trello/1/lists/list_allowed') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: 'list_allowed', name: 'Allowed', idBoard: 'board_alpha' }));
          return true;
        }
        if (pathname === '/trello/1/boards/board_alpha/members') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify([{ id: 'mem_allowed_only', username: 'allowed' }]));
          return true;
        }
        return false;
      });

      const stack = buildCombinedRuntimeStack({
        pool: db.pool,
        encryptionKey: ENC_KEY,
        loopbackBaseUrl: baseUrl,
      });
      const owner = await db.person('ScopeGuardOwner');
      const org = await stack.workspaceRepo.create(owner.id, 'Scope Org', false);

      const trCred = await stack.credentialRepo.upsertPersonalCredentials({
        service: 'trello',
        userId: owner.id,
        config: encryptCredentials(
          { refreshToken: 'rt-scope-tr', memberId: 'mem_allowed_only', username: 'scope_tr' },
          ENC_KEY,
        ),
        status: 'active',
      });
      await stack.trelloTeamRepo.replace({
        scopeId: `personal:${owner.id}`,
        workspaceId: 'trello_ws_1',
        workspaceName: 'Scope WS',
        boards: [{ boardId: 'board_alpha', boardName: 'Alpha Sprint' }],
        chosenBy: owner.id,
      });

      const msCred = await stack.credentialRepo.upsertPersonalCredentials({
        service: 'mysheets',
        userId: owner.id,
        config: encryptCredentials(
          {
            email: 'scope@example.test',
            refreshToken: 'rt-scope-ms',
            selectedSpreadsheets: [{ id: '1SpreadsheetAllowedLoopback000001', title: 'Allowed' }],
            allowedScope: { spreadsheets: ['1SpreadsheetAllowedLoopback000001'] },
          },
          ENC_KEY,
        ),
        status: 'active',
      });
      await stack.credentialRepo.upsertCredentials(
        'sheets',
        encryptCredentials(
          {
            clientEmail: 'sa@disposable-test.iam.gserviceaccount.com',
            privateKey: EPHEMERAL_RSA_PRIVATE_KEY,
            allowedScope: { spreadsheets: ['1SpreadsheetAllowedLoopback000001'] },
          },
          ENC_KEY,
        ),
        'active',
        owner.email,
        org.id,
      );
      const mcCred = await stack.credentialRepo.upsertPersonalCredentials({
        service: 'mycalendar',
        userId: owner.id,
        config: encryptCredentials(
          {
            email: 'allowed.cal@example.test',
            refreshToken: 'rt-scope-mc',
            selectedCalendars: [{ id: 'allowed.cal@example.test', summary: 'Allowed Cal', timeZone: TZ, primary: true }],
            allowedScope: { calendars: ['allowed.cal@example.test'] },
          },
          ENC_KEY,
        ),
        status: 'active',
      });

      const trelloExecAdapter = await stack.adapterFactory.getAdapterForService('trello', {
        userId: owner.id,
        phase: 'execution',
        workspaceMode: 'personal',
        connections: {
          trello: {
            credentialId: trCred.id,
            memberId: 'mem_allowed_only',
            username: 'scope_tr',
            boardIds: ['board_alpha'],
          },
        },
      });
      const mysheetsExecAdapter = await stack.adapterFactory.getAdapterForService('mysheets', {
        userId: owner.id,
        phase: 'execution',
        workspaceMode: 'personal',
        connections: {
          mysheets: {
            credentialId: msCred.id,
            email: 'scope@example.test',
            allowedSpreadsheets: ['1SpreadsheetAllowedLoopback000001'],
          },
        },
      });
      const orgSheetsExecAdapter = await stack.adapterFactory.getAdapterForService('sheets', {
        userId: owner.id,
        phase: 'execution',
        workspaceMode: 'organization',
        workspaceId: org.id,
      });
      const mycalExecAdapter = await stack.adapterFactory.getAdapterForService('mycalendar', {
        userId: owner.id,
        phase: 'execution',
        workspaceMode: 'personal',
        connections: {
          mycalendar: {
            credentialId: mcCred.id,
            email: 'allowed.cal@example.test',
            allowedCalendars: ['allowed.cal@example.test'],
          },
        },
      });

      // Reset call log after adapter construction OAuth board-list lookup
      calls.length = 0;

      // N5: Trello path traversal & out-of-scope boardId -> 0 HTTP requests
      for (const badId of ['../admin', '%2e%2e%2fsecret', 'card/../../members']) {
        await expect(
          trelloExecAdapter.execute('trello.update_card', { cardId: badId, title: 'x' }),
        ).rejects.toMatchObject({ category: 'VALIDATION', details: { requestSent: false } });
      }
      await expect(
        trelloExecAdapter.execute('trello.search_lists', { boardId: 'board_forbidden' }),
      ).rejects.toMatchObject({ category: 'AUTH_ERROR', details: { requestSent: false } });
      expect(calls).toHaveLength(0);

      // N6: Trello out-of-scope listId, out-of-scope cardId, and non-member idMembers -> bounded authorized metadata precheck ONLY, 0 write mutations!
      await expect(
        trelloExecAdapter.execute('trello.create_card', { listId: 'list_foreign', title: 'Forbidden' }),
      ).rejects.toMatchObject({ category: 'AUTH_ERROR', details: { requestSent: false } });
      await expect(
        trelloExecAdapter.execute('trello.update_card', { cardId: 'card_foreign', title: 'Forbidden' }),
      ).rejects.toMatchObject({ category: 'AUTH_ERROR', details: { requestSent: false } });
      await expect(
        trelloExecAdapter.execute('trello.create_card', {
          listId: 'list_allowed',
          title: 'Non-member assign',
          idMembers: ['mem_outsider'],
        }),
      ).rejects.toMatchObject({ category: 'AUTH_ERROR', details: { requestSent: false } });

      const precheckPaths = calls.map((c) => `${c.method} ${c.pathname}`);
      expect(precheckPaths).toEqual([
        'GET /trello/1/lists/list_foreign',
        'GET /trello/1/cards/card_foreign',
        'GET /trello/1/lists/list_allowed',
        'GET /trello/1/boards/board_alpha/members',
      ]);
      // Zero unauthorized write/mutation calls
      expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);

      // N7: Out-of-allowlist spreadsheetId (mysheets + org sheets) & calendarId (mycalendar) -> 0 HTTP calls
      calls.length = 0;
      await expect(
        mysheetsExecAdapter.execute('mysheets.read_range', {
          spreadsheetId: '1ForbiddenSpreadsheetId9999999',
          range: 'Tasks!A1:B2',
        }),
      ).rejects.toMatchObject({ category: 'AUTH_ERROR' });
      await expect(
        orgSheetsExecAdapter.execute('sheets.read_range', {
          spreadsheetId: '1ForbiddenSpreadsheetId9999999',
          range: 'Tasks!A1:B2',
        }),
      ).rejects.toMatchObject({ category: 'AUTH_ERROR' });
      await expect(
        mycalExecAdapter.execute('mycalendar.list_events', {
          calendarId: 'forbidden.cal@example.test',
          timeMin: '2026-11-11T00:00:00+07:00',
          timeMax: '2026-11-11T23:59:59+07:00',
        }),
      ).rejects.toMatchObject({ category: 'AUTH_ERROR' });
      expect(calls).toHaveLength(0);
    });
  });

  describe('Recovery, Malformed Receipts, Immutable Snapshots, Compound Partial Writes & Calendar Truthfulness', () => {
    it('marks malformed Slack receipt and Trello add_checklist partial write as unknown / reconciliation_required in ExecutionService and blocks automatic retryStep replay', async () => {
      let checklistPosts = 0;
      let checkItemPosts = 0;
      let slackPosts = 0;

      const { baseUrl } = await startLoopbackFixture(async (_req, res, { pathname, method }) => {
        if (method === 'POST' && pathname === '/slack/api/chat.postMessage') {
          slackPosts++;
          res.writeHead(200, { 'content-type': 'application/json' });
          // Malformed non-string ts object
          res.end(JSON.stringify({ ok: true, channel: 'C012345678', ts: {} }));
          return true;
        }
        if (method === 'GET' && pathname === '/trello/1/cards/card_chk_1') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: 'card_chk_1', name: 'Release Card', idBoard: 'board_alpha' }));
          return true;
        }
        if (method === 'POST' && pathname === '/trello/1/cards/card_chk_1/checklists') {
          checklistPosts++;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: 'chk_created_1', name: 'QA Gate' }));
          return true;
        }
        if (method === 'POST' && pathname === '/trello/1/checklists/chk_created_1/checkItems') {
          checkItemPosts++;
          if (checkItemPosts === 1) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ id: 'item_1', name: 'Item 1', state: 'incomplete' }));
            return true;
          }
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ message: 'Internal failure on item 2' }));
          return true;
        }
        return false;
      });

      const stack = buildCombinedRuntimeStack({
        pool: db.pool,
        encryptionKey: ENC_KEY,
        loopbackBaseUrl: baseUrl,
      });
      const owner = await db.person('RecoveryOwner');
      await stack.credentialRepo.upsertPersonalCredentials({
        service: 'slack',
        userId: owner.id,
        config: encryptCredentials(
          { botToken: 'xoxb-recovery-test', allowedScope: { channels: ['C012345678'] } },
          ENC_KEY,
        ),
        status: 'active',
      });
      const trCred = await stack.credentialRepo.upsertPersonalCredentials({
        service: 'trello',
        userId: owner.id,
        config: encryptCredentials(
          { refreshToken: 'rt-rec-tr', memberId: 'mem_rec', username: 'rec_tr' },
          ENC_KEY,
        ),
        status: 'active',
      });
      await stack.trelloTeamRepo.replace({
        scopeId: `personal:${owner.id}`,
        workspaceId: 'trello_ws_1',
        workspaceName: 'Rec WS',
        boards: [{ boardId: 'board_alpha', boardName: 'Alpha Sprint' }],
        chosenBy: owner.id,
      });

      // 1. Malformed Slack receipt -> step unknown, plan reconciliation_required, retryStep rejected (0 replay)
      const slackConv = await stack.convRepo.createConversation(owner.id, { workspaceMode: 'personal' });
      const slackPayload = canonicalPlanPayload({
        kind: 'plan',
        thinking: 't',
        summary: 's',
        warnings: [],
        steps: [
          {
            id: 's_bad_slack',
            tool: 'slack.send_message',
            description: 'Send Slack',
            args: { channel: 'C012345678', text: 'Check receipt' },
            dependsOn: [],
          },
        ],
      });
      const slackPlan = await stack.planRepo.createPlan({
        convId: slackConv.id,
        ...slackPayload,
        expiresAt: new Date(Date.now() + 300_000),
      });
      await stack.executionService.approveAndStart(slackPlan.id, owner.id);
      expect(['partial', 'reconciliation_required']).toContain(
        await waitForPlanSettlement(stack.executionService, slackPlan.id),
      );
      const [slackStepRow] = await stack.stepRepo.listSteps(slackPlan.id);
      expect(slackStepRow?.status).toBe('unknown');
      expect(slackPosts).toBe(1);
      await expect(
        stack.executionService.retryStep(slackPlan.id, 's_bad_slack', owner.id),
      ).rejects.toMatchObject({ status: 409 });
      expect(slackPosts).toBe(1);

      // 2. Trello add_checklist compound partial write -> step unknown with partialWrite details, retryStep rejected (0 replay)
      const trelloConv = await stack.convRepo.createConversation(owner.id, { workspaceMode: 'personal' });
      const trelloPayload = canonicalPlanPayload({
        kind: 'plan',
        thinking: 't',
        summary: 's',
        warnings: [],
        connections: {
          trello: {
            credentialId: trCred.id,
            memberId: 'mem_rec',
            username: 'rec_tr',
            boardIds: ['board_alpha'],
          },
        },
        steps: [
          {
            id: 's_partial_chk',
            tool: 'trello.add_checklist',
            description: 'Add checklist',
            args: { cardId: 'card_chk_1', title: 'QA Gate', items: ['Item 1', 'Item 2'] },
            dependsOn: [],
          },
        ],
      });
      const trelloPlan = await stack.planRepo.createPlan({
        convId: trelloConv.id,
        ...trelloPayload,
        expiresAt: new Date(Date.now() + 300_000),
      });
      await stack.executionService.approveAndStart(trelloPlan.id, owner.id);
      expect(['partial', 'reconciliation_required']).toContain(
        await waitForPlanSettlement(stack.executionService, trelloPlan.id),
      );
      const [chkStepRow] = await stack.stepRepo.listSteps(trelloPlan.id);
      expect(chkStepRow?.status).toBe('unknown');
      expect(chkStepRow?.error_json?.details?.partialWrite).toBe(true);
      expect(checklistPosts).toBe(1);
      await expect(
        stack.executionService.retryStep(trelloPlan.id, 's_partial_chk', owner.id),
      ).rejects.toMatchObject({ status: 409 });
      expect(checklistPosts).toBe(1);

      // Post-restart durable status & snapshot offer only ['skip', 'stop'] and report reconciliation_required
      const restartStack = buildCombinedRuntimeStack({
        pool: db.pool,
        encryptionKey: ENC_KEY,
        loopbackBaseUrl: baseUrl,
      });
      expect(await restartStack.executionService.getExecutionStatusDurable(slackPlan.id)).toEqual({
        status: 'reconciliation_required',
        pausedStepId: 's_bad_slack',
      });
      expect(await restartStack.executionService.getExecutionStatusDurable(trelloPlan.id)).toEqual({
        status: 'reconciliation_required',
        pausedStepId: 's_partial_chk',
      });
      const restartSnap = await restartStack.executionService.getLatestExecutionSnapshot(
        trelloConv.id,
        owner.id,
      );
      expect(restartSnap.recoveryActions).toEqual(['skip', 'stop']);
    });

    it('enforces ScheduleService.resolveRunDelivery auth, duplicate-risk confirmation, pause/config-change guards, immutable dispatched_config snapshot, and single-use CAS', async () => {
      await db.pool.query('TRUNCATE schedule_runs, schedules, conversations CASCADE');
      const { baseUrl } = await startLoopbackFixture();
      const triad = await seedCrossServiceTriad(db.pool);
      const outsider = await db.person('Outsider');

      const stack = buildCombinedRuntimeStack({
        pool: db.pool,
        encryptionKey: ENC_KEY,
        loopbackBaseUrl: baseUrl,
        now: () => new Date(NOW_ISO),
      });

      // Create an unknown delivery run on sheets_digest (dispatched_config captured automatically by 0035 trigger)
      const unknownSheetsRun = (
        await db.pool.query(
          `INSERT INTO schedule_runs (schedule_id, schedule_version, trigger, due_at, status, delivery_started_at, error)
           VALUES ($1, 1, 'scheduled', $2, 'needs_attention', now(), $3)
           RETURNING *`,
          [triad.schedules.sheetsSchedule.id, DUE_AT_ISO, SHEETS_DELIVERY_UNKNOWN],
        )
      ).rows[0]!;
      expect(unknownSheetsRun.dispatched_config).toBeTruthy();

      // Non-owner rejected with ScheduleNotFound
      await expect(
        stack.schedules.service.resolveRunDelivery({
          userId: outsider.id,
          runId: unknownSheetsRun.id,
          resolution: 'mark_sent',
          now: new Date(NOW_ISO),
        }),
      ).rejects.toThrow();

      // Missing confirmDuplicateRisk rejected
      await expect(
        stack.schedules.service.resolveRunDelivery({
          userId: triad.owner.id,
          runId: unknownSheetsRun.id,
          resolution: 'retry_new_run',
          confirmDuplicateRisk: false,
          now: new Date(NOW_ISO),
        }),
      ).rejects.toMatchObject({ code: 'DUPLICATE_RISK_CONFIRMATION_REQUIRED' });

      // Paused schedule rejects retry_new_run before mutating delivery_resolution
      await db.pool.query("UPDATE schedules SET status = 'paused', next_run_at = NULL WHERE id = $1", [
        triad.schedules.sheetsSchedule.id,
      ]);
      await expect(
        stack.schedules.service.resolveRunDelivery({
          userId: triad.owner.id,
          runId: unknownSheetsRun.id,
          resolution: 'retry_new_run',
          confirmDuplicateRisk: true,
          now: new Date(NOW_ISO),
        }),
      ).rejects.toMatchObject({ code: 'SCHEDULE_PAUSED' });

      // Mutate schedule.digest_config to a different spreadsheet & bump version, then mark_sent MUST preserve immutable run.dispatched_config!
      await db.pool.query(
        `UPDATE schedules
            SET status = 'active',
                next_run_at = $2,
                version = version + 1,
                digest_config = jsonb_set(digest_config, '{source,spreadsheetTitle}', '"Mutated Title"')
          WHERE id = $1`,
        [triad.schedules.sheetsSchedule.id, DUE_AT_ISO],
      );
      const resolved = await stack.schedules.service.resolveRunDelivery({
        userId: triad.owner.id,
        runId: unknownSheetsRun.id,
        resolution: 'mark_sent',
        now: new Date(NOW_ISO),
      });
      expect(resolved.run.state).toBe('digest_sent');
      expect((resolved.run.delivery as any)?.spreadsheetTitle).toBe('KPI Kinh Doanh Q4');
      // Never fabricates provider receipt on manual mark_sent
      expect((resolved.run.delivery as any)?.gmailMessageId).toBeUndefined();

      // Single-use CAS rejects second resolution attempt
      await expect(
        stack.schedules.service.resolveRunDelivery({
          userId: triad.owner.id,
          runId: unknownSheetsRun.id,
          resolution: 'mark_sent',
          now: new Date(NOW_ISO),
        }),
      ).rejects.toMatchObject({ code: 'DELIVERY_ALREADY_RESOLVED' });

      // Trello digest unknown run rejects retry_new_run with CONFIG_CHANGED_SINCE_RUN when schedule version drifted
      const unknownTrelloRun = (
        await db.pool.query(
          `INSERT INTO schedule_runs (schedule_id, schedule_version, trigger, due_at, status, delivery_started_at, error)
           VALUES ($1, 1, 'scheduled', $2, 'needs_attention', now(), $3)
           RETURNING *`,
          [triad.schedules.trelloSchedule.id, DUE_AT_ISO, TRELLO_DELIVERY_UNKNOWN],
        )
      ).rows[0]!;
      await db.pool.query('UPDATE schedules SET version = version + 1 WHERE id = $1', [
        triad.schedules.trelloSchedule.id,
      ]);
      await expect(
        stack.schedules.service.resolveRunDelivery({
          userId: triad.owner.id,
          runId: unknownTrelloRun.id,
          resolution: 'retry_new_run',
          confirmDuplicateRisk: true,
          now: new Date(NOW_ISO),
        }),
      ).rejects.toMatchObject({ code: 'CONFIG_CHANGED_SINCE_RUN' });
    });

    it('preserves Calendar incomplete-coverage precheck truthfulness, half-open [start, end) free-slot boundaries across DST/IANA zones, and explicit event timeZone on create/update', async () => {
      let lastCreatedEventBody: any = null;
      let lastPatchedEventBody: any = null;

      const { baseUrl } = await startLoopbackFixture(async (_req, res, { pathname, method, body }) => {
        // Paginated incomplete event list for ChatService precheck
        if (
          method === 'GET' &&
          pathname === '/calendar/v3/calendars/incomplete.cal%40example.test/events'
        ) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              summary: 'Incomplete Cal',
              timeZone: 'America/New_York',
              nextPageToken: 'more-pages-remain',
              items: [
                {
                  id: 'ev-busy-1',
                  status: 'confirmed',
                  summary: 'Busy 09:00-10:00',
                  start: { dateTime: '2026-03-09T09:00:00-04:00', timeZone: 'America/New_York' },
                  end: { dateTime: '2026-03-09T10:00:00-04:00', timeZone: 'America/New_York' },
                  htmlLink: 'https://calendar.google.com/calendar/event?eid=inc1',
                },
              ],
            }),
          );
          return true;
        }
        // Complete half-open boundary calendar in America/New_York
        if (
          method === 'GET' &&
          pathname === '/calendar/v3/calendars/ny.cal%40example.test/events'
        ) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              summary: 'NY Cal',
              timeZone: 'America/New_York',
              items: [
                {
                  id: 'ev-ny-1',
                  status: 'confirmed',
                  summary: 'Morning Standup',
                  start: { dateTime: '2026-03-09T09:00:00-04:00', timeZone: 'America/New_York' },
                  end: { dateTime: '2026-03-09T10:00:00-04:00', timeZone: 'America/New_York' },
                  htmlLink: 'https://calendar.google.com/calendar/event?eid=ny1',
                },
              ],
            }),
          );
          return true;
        }
        if (
          method === 'POST' &&
          pathname === '/calendar/v3/calendars/ny.cal%40example.test/events'
        ) {
          lastCreatedEventBody = body;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 'ev-created-tz',
              status: 'confirmed',
              summary: body.summary,
              start: body.start,
              end: body.end,
              recurrence: body.recurrence,
              htmlLink: 'https://calendar.google.com/calendar/event?eid=tz1',
            }),
          );
          return true;
        }
        if (
          method === 'GET' &&
          pathname === '/calendar/v3/calendars/ny.cal%40example.test/events/ev-created-tz'
        ) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 'ev-created-tz',
              status: 'confirmed',
              summary: 'Recurring Sync',
              start: { dateTime: '2026-03-09T10:00:00-04:00', timeZone: 'America/New_York' },
              end: { dateTime: '2026-03-09T10:30:00-04:00', timeZone: 'America/New_York' },
              recurrence: ['RRULE:FREQ=WEEKLY'],
              htmlLink: 'https://calendar.google.com/calendar/event?eid=tz1',
            }),
          );
          return true;
        }
        if (
          method === 'PATCH' &&
          pathname === '/calendar/v3/calendars/ny.cal%40example.test/events/ev-created-tz'
        ) {
          lastPatchedEventBody = body;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 'ev-created-tz',
              status: 'confirmed',
              summary: body.summary ?? 'Recurring Sync',
              start: body.start,
              end: body.end,
              recurrence: ['RRULE:FREQ=WEEKLY'],
              htmlLink: 'https://calendar.google.com/calendar/event?eid=tz1',
            }),
          );
          return true;
        }
        return false;
      });

      const stack = buildCombinedRuntimeStack({
        pool: db.pool,
        encryptionKey: ENC_KEY,
        loopbackBaseUrl: baseUrl,
      });
      const owner = await db.person('CalTruthOwner');

      // 1. Half-open [start, end) free-slot calculation + explicit IANA timeZone preservation on create_event & update_event
      const nyAdapter = createPersonalCalendarAdapter({
        userId: owner.id,
        tokens: { getAccessToken: async () => 'tok-ny-cal' },
        allowedScope: { calendars: ['ny.cal@example.test'] },
        apiBaseUrl: `${baseUrl}/calendar/v3/calendars`,
      });

      const freeSlotsRes = await nyAdapter.execute('mycalendar.find_free_slots', {
        calendarId: 'ny.cal@example.test',
        timeMin: '2026-03-09T09:00:00-04:00',
        timeMax: '2026-03-09T11:00:00-04:00',
        durationMinutes: 60,
        timeZone: 'America/New_York',
      });
      // Half-open [09:00, 10:00) busy means 10:00-11:00 is immediately free with touching boundary at 10:00!
      expect(freeSlotsRes.freeSlots).toEqual([
        expect.objectContaining({
          start: '2026-03-09T10:00:00-04:00',
          end: '2026-03-09T11:00:00-04:00',
        }),
      ]);

      await nyAdapter.execute('mycalendar.create_event', {
        calendarId: 'ny.cal@example.test',
        summary: 'Recurring Sync',
        start: '2026-03-09T10:00:00-04:00',
        end: '2026-03-09T10:30:00-04:00',
        timeZone: 'America/New_York',
        recurrence: 'WEEKLY',
      });
      expect(lastCreatedEventBody?.start).toEqual({
        dateTime: '2026-03-09T10:00:00-04:00',
        timeZone: 'America/New_York',
      });
      expect(lastCreatedEventBody?.end).toEqual({
        dateTime: '2026-03-09T10:30:00-04:00',
        timeZone: 'America/New_York',
      });
      expect(lastCreatedEventBody?.recurrence).toEqual(['RRULE:FREQ=WEEKLY']);

      await nyAdapter.execute('mycalendar.update_event', {
        calendarId: 'ny.cal@example.test',
        eventId: 'ev-created-tz',
        start: '2026-03-09T10:30:00-04:00',
        end: '2026-03-09T11:00:00-04:00',
        timeZone: 'America/New_York',
      });
      expect(lastPatchedEventBody?.start?.timeZone).toBe('America/New_York');
      expect(lastPatchedEventBody?.end?.timeZone).toBe('America/New_York');

      // 2. ChatService conflict precheck on incomplete coverage suppresses free-slot recommendations
      const incCred = await stack.credentialRepo.upsertPersonalCredentials({
        service: 'mycalendar',
        userId: owner.id,
        config: encryptCredentials(
          {
            email: 'incomplete.cal@example.test',
            refreshToken: 'rt-inc-cal',
            selectedCalendars: [
              {
                id: 'incomplete.cal@example.test',
                summary: 'Incomplete Cal',
                timeZone: 'America/New_York',
                primary: true,
              },
            ],
            allowedScope: { calendars: ['incomplete.cal@example.test'] },
          },
          ENC_KEY,
        ),
        status: 'active',
      });

      const planned: PlanResponse = {
        kind: 'plan',
        thinking: 'Đặt lịch họp',
        summary: 'Tạo sự kiện mới',
        warnings: [],
        connections: {
          mycalendar: {
            credentialId: incCred.id,
            email: 'incomplete.cal@example.test',
            allowedCalendars: ['incomplete.cal@example.test'],
          },
        },
        steps: [
          {
            id: 's_create_ev',
            tool: 'mycalendar.create_event',
            description: 'Tạo cuộc họp',
            args: {
              calendarId: 'incomplete.cal@example.test',
              summary: 'Họp Q4',
              start: '2026-03-09T09:15:00-04:00',
              end: '2026-03-09T09:45:00-04:00',
              timeZone: 'America/New_York',
            },
            dependsOn: [],
          },
        ],
      };

      const conv = await stack.convRepo.createConversation(owner.id, { workspaceMode: 'personal' });
      const chatSvc = new ChatService({
        msgRepo: stack.msgRepo,
        convRepo: stack.convRepo,
        planRepo: stack.planRepo,
        mycalendarConnection: createMyCalendarConnectionLookup(stack.credentialRepo, ENC_KEY),
        planner: {
          processMessage: async () => planned,
        } as any,
        eventEmitter: { emit: () => {} } as any,
        getAdapter: (svc, ctx) => stack.adapterFactory.getAdapterForService(svc, ctx),
      });

      await chatSvc.handleUserMessage({
        conversationId: conv.id,
        userId: owner.id,
        content: 'Đặt lịch họp 09:15 sáng',
      });
      let savedPlan = null as Awaited<ReturnType<typeof stack.planRepo.getPendingPlan>>;
      const waitDeadline = Date.now() + 3_000;
      while (Date.now() < waitDeadline) {
        savedPlan = await stack.planRepo.getPendingPlan(conv.id);
        if (savedPlan) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(savedPlan).not.toBeNull();
      const warningsText = (savedPlan!.plan_json.warnings ?? []).join('\n');
      expect(warningsText).toMatch(/chưa đầy đủ|không đầy đủ|incomplete|trang/i);
      // Must NOT claim a verified free slot such as 10:00 when pagination is incomplete
      expect(warningsText).not.toMatch(/khung giờ trống gợi ý/i);
    });
  });
});
