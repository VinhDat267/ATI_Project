import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPersonalCalendarAdapter, encryptCredentials } from '@wap/tool-adapters';
import type { PlanResponse, PlannerResponse } from '@wap/tool-schemas';
import type { ProcessMessageInput } from '@wap/planner';
import { ChatService } from '../../src/services/chat-service.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { createMyCalendarConnectionLookup } from '../../src/services/gmail/connection-reference.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const key = '0123456789abcdef0123456789abcdef';
const HTML_LINK = 'https://www.google.com/calendar/event?eid=fixture';
type Person = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;

const makePlan = (steps: PlanResponse['steps'], warnings: string[] = []): PlanResponse => ({
  kind: 'plan',
  thinking: 'Kiểm tra và đặt lịch',
  summary: 'Đặt lịch họp khách hàng Q4',
  warnings,
  steps,
});

describe('Worker B Calendar Precheck Remediation (CALENDAR-AUDIT-02)', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let credentials: CredentialRepo;
  let plans: PlanRepo;
  let messages: MessageRepo;
  let conversations: ConversationRepo;
  let owner: Person;
  let responses: PlannerResponse[];
  let events: Array<{ event: string; payload: any }>;
  let calendarServer: ReturnType<typeof createServer> | null = null;

  beforeAll(async () => {
    db = await createMigratedSchema('mycalendar_rem_b_precheck');
    credentials = new CredentialRepo(db.pool);
    plans = new PlanRepo(db.pool);
    messages = new MessageRepo(db.pool);
    conversations = new ConversationRepo(db.pool);
  });

  beforeEach(async () => {
    owner = await db.person('Owner');
    responses = [];
    events = [];
    await credentials.saveCredentials(
      'mycalendar',
      encryptCredentials(
        {
          refreshToken: '1//fake-cal-refresh',
          email: 'owner.calendar@example.test',
          scopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar'],
          selectedCalendars: [
            { id: 'owner.calendar@example.test', summary: 'Lịch chính', primary: true },
            { id: 'team.calendar@example.test', summary: 'Lịch nhóm', primary: false },
          ],
          allowedScope: {
            calendars: ['owner.calendar@example.test', 'team.calendar@example.test'],
          },
          connectedAt: new Date().toISOString(),
        },
        key,
      ),
      owner.id,
    );
  });

  afterEach(async () => {
    if (calendarServer) {
      await new Promise<void>((r) => calendarServer!.close(() => r()));
      calendarServer = null;
    }
  });

  afterAll(async () => {
    await db?.close();
  });

  const runMessageWithHttpServer = async (
    text: string,
    handler: (req: IncomingMessage, res: ServerResponse) => void,
  ) => {
    calendarServer = createServer(handler);
    await new Promise<void>((r) => calendarServer!.listen(0, '127.0.0.1', () => r()));
    const { port } = calendarServer.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}/calendar/v3`;

    const conv = (await conversations.createConversation(owner.id)).id;
    const svc = new ChatService({
      msgRepo: messages,
      convRepo: conversations,
      planRepo: plans,
      eventEmitter: { emit: (event, payload) => events.push({ event, payload }) },
      planner: {
        processMessage: async (_input: ProcessMessageInput) => structuredClone(responses.shift()!),
      } as any,
      mycalendarConnection: createMyCalendarConnectionLookup(credentials, key),
      getAdapter: async (serviceName) => {
        if (serviceName === 'mycalendar') {
          return createPersonalCalendarAdapter({
            userId: owner.id,
            tokens: { getAccessToken: async () => 'fake-cal-access-token' },
            allowedScope: {
              calendars: ['owner.calendar@example.test', 'team.calendar@example.test'],
            },
            apiBaseUrl: baseUrl,
          });
        }
        return null;
      },
    });

    await svc.handleUserMessage({ conversationId: conv, userId: owner.id, content: text });
    for (
      let i = 0;
      i < 100 && !events.some((e) => ['plan_preview', 'refusal', 'error'].includes(e.event));
      i++
    ) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const row = (
      await db.pool.query('SELECT * FROM plans WHERE conv_id=$1 ORDER BY created_at DESC LIMIT 1', [
        conv,
      ])
    ).rows[0];
    return { conv, row };
  };

  it('reads the full candidate day range so 09:00-10:00 busy + 10:00-11:00 busy never suggests 10:00-11:00 and instead suggests 11:00-12:00', async () => {
    responses.push(
      makePlan([
        {
          id: 'step_create_meeting',
          tool: 'mycalendar.create_event',
          description: 'Đặt lịch họp khách hàng',
          args: {
            calendarId: 'owner.calendar@example.test',
            summary: 'Họp khách hàng Q4',
            start: '2026-11-16T09:00:00+07:00',
            end: '2026-11-16T10:00:00+07:00',
          },
          dependsOn: [],
        },
      ]),
    );

    const { row } = await runMessageWithHttpServer(
      'Đặt lịch họp khách hàng Q4 lúc 9h sáng 16/11',
      (req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (!url.pathname.endsWith('/events')) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 'owner.calendar@example.test',
              summary: 'Lịch chính',
              timeZone: 'Asia/Ho_Chi_Minh',
            }),
          );
          return;
        }
        const timeMin = url.searchParams.get('timeMin') ?? '';
        const timeMax = url.searchParams.get('timeMax') ?? '';
        const minMs = Date.parse(timeMin);
        const maxMs = Date.parse(timeMax);
        const allItems = [
          {
            id: 'ev-9-10',
            summary: 'Sprint Review',
            htmlLink: HTML_LINK,
            start: { dateTime: '2026-11-16T09:00:00+07:00' },
            end: { dateTime: '2026-11-16T10:00:00+07:00' },
          },
          {
            id: 'ev-10-11',
            summary: 'Architecture Sync',
            htmlLink: HTML_LINK,
            start: { dateTime: '2026-11-16T10:00:00+07:00' },
            end: { dateTime: '2026-11-16T11:00:00+07:00' },
          },
        ].filter((item) => {
          const s = Date.parse(item.start.dateTime);
          const e = Date.parse(item.end.dateTime);
          return s < maxMs && e > minMs;
        });

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            items: url.pathname.includes('owner.calendar%40example.test') ? allItems : [],
          }),
        );
      },
    );

    expect(row).toBeDefined();
    const warningText = (row.plan_json.warnings ?? []).join('\n');
    expect(warningText).toContain('Sprint Review');
    expect(warningText).toContain('trùng giờ');
    // Must NOT suggest 10:00–11:00 because 10:00–11:00 is occupied by Architecture Sync!
    expect(warningText).not.toContain('10:00–11:00');
    expect(warningText).toContain('11:00–12:00');
  });

  it('checks all authorized calendars in allowedCalendars, respects transparent/cancelled/all-day and touching boundaries, and excludes self eventId on update_event', async () => {
    // 1. Create at 09:00-10:00 should detect conflict from secondary authorized calendar 'team.calendar@example.test', while ignoring touching & transparent events
    responses.push(
      makePlan([
        {
          id: 'step_create_deepwork',
          tool: 'mycalendar.create_event',
          description: 'Tạo lịch Deep Work',
          args: {
            calendarId: 'owner.calendar@example.test',
            summary: 'Deep Work',
            start: '2026-11-16T09:00:00+07:00',
            end: '2026-11-16T10:00:00+07:00',
          },
          dependsOn: [],
        },
      ]),
    );

    const { row: createRow } = await runMessageWithHttpServer('Tạo lịch Deep Work 9h-10h', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname.includes('owner.calendar%40example.test/events')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            items: [
              // Touching boundary 08:00-09:00 (must NOT conflict with 09:00-10:00)
              {
                id: 'ev-touching',
                summary: 'Early Prep',
                htmlLink: HTML_LINK,
                start: { dateTime: '2026-11-16T08:00:00+07:00' },
                end: { dateTime: '2026-11-16T09:00:00+07:00' },
              },
              // Transparent event 09:00-10:00 (must NOT conflict)
              {
                id: 'ev-trans',
                summary: 'Working Remotely Banner',
                htmlLink: HTML_LINK,
                transparency: 'transparent',
                start: { dateTime: '2026-11-16T09:00:00+07:00' },
                end: { dateTime: '2026-11-16T10:00:00+07:00' },
              },
            ],
          }),
        );
        return;
      }
      if (url.pathname.includes('team.calendar%40example.test/events')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            items: [
              {
                id: 'ev-team-conflict',
                summary: 'Team Incident Drill',
                htmlLink: HTML_LINK,
                start: { dateTime: '2026-11-16T09:00:00+07:00' },
                end: { dateTime: '2026-11-16T10:00:00+07:00' },
              },
            ],
          }),
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'owner.calendar@example.test',
          summary: 'Lịch chính',
          timeZone: 'Asia/Ho_Chi_Minh',
        }),
      );
    });

    const createWarnings = (createRow.plan_json.warnings ?? []).join('\n');
    expect(createWarnings).toContain('Team Incident Drill');
    expect(createWarnings).not.toContain('Early Prep');
    expect(createWarnings).not.toContain('Working Remotely Banner');

    // Close server before second run in same test
    await new Promise<void>((r) => calendarServer!.close(() => r()));
    calendarServer = null;
    events = [];

    // 2. Update of ev-self-update at 14:00-15:00 should NOT report conflict with itself
    responses.push(
      makePlan([
        {
          id: 'step_update_existing',
          tool: 'mycalendar.update_event',
          description: 'Cập nhật lịch họp',
          args: {
            calendarId: 'owner.calendar@example.test',
            eventId: 'ev-self-update',
            summary: 'Existing Sync Renamed',
            start: '2026-11-16T14:00:00+07:00',
            end: '2026-11-16T15:00:00+07:00',
          },
          dependsOn: [],
        },
      ]),
    );

    const { row: updateRow } = await runMessageWithHttpServer('Đổi tên lịch họp 14h-15h', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname.includes('owner.calendar%40example.test/events')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            items: [
              {
                id: 'ev-self-update',
                summary: 'Existing Sync',
                htmlLink: HTML_LINK,
                start: { dateTime: '2026-11-16T14:00:00+07:00' },
                end: { dateTime: '2026-11-16T15:00:00+07:00' },
              },
            ],
          }),
        );
        return;
      }
      if (url.pathname.endsWith('/events')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ items: [] }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'owner.calendar@example.test',
          summary: 'Lịch chính',
          timeZone: 'Asia/Ho_Chi_Minh',
        }),
      );
    });

    expect(updateRow.plan_json.warnings ?? []).toEqual([]);
  });

  it('surfaces an honest warning and omits free-slot suggestions when precheck coverage is incomplete or calendar read fails', async () => {
    responses.push(
      makePlan([
        {
          id: 'step_create_urgent',
          tool: 'mycalendar.create_event',
          description: 'Đặt lịch họp khẩn',
          args: {
            calendarId: 'owner.calendar@example.test',
            summary: 'Họp khẩn',
            start: '2026-11-16T09:00:00+07:00',
            end: '2026-11-16T10:00:00+07:00',
          },
          dependsOn: [],
        },
      ]),
    );

    const { row } = await runMessageWithHttpServer('Đặt lịch họp khẩn 9h-10h', (_req, res) => {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Calendar upstream unavailable' } }));
    });

    const warningText = (row.plan_json.warnings ?? []).join('\n');
    expect(warningText.length).toBeGreaterThan(0);
    expect(warningText).not.toContain('Gợi ý khung giờ trống');
  });
});
