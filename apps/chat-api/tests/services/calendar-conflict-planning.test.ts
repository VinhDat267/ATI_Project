import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { encryptCredentials } from '@wap/tool-adapters';
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
type Person = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;

const createMeetingStep: PlanResponse['steps'][number] = {
  id: 'step_create_meeting',
  tool: 'mycalendar.create_event',
  description: 'Đặt lịch họp khách hàng',
  args: {
    calendarId: 'owner.calendar@example.test',
    summary: 'Họp khách hàng Q4',
    start: '2026-10-09T09:00:00+07:00',
    end: '2026-10-09T10:00:00+07:00',
  },
  dependsOn: [],
};

const makePlan = (steps: PlanResponse['steps'], warnings: string[] = []): PlanResponse => ({
  kind: 'plan',
  thinking: 'Kiểm tra và đặt lịch',
  summary: 'Đặt lịch họp khách hàng Q4',
  warnings,
  steps,
});

describe('ChatService planning-time conflict warnings for mycalendar.create_event', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let credentials: CredentialRepo;
  let plans: PlanRepo;
  let messages: MessageRepo;
  let conversations: ConversationRepo;
  let owner: Person;
  let responses: PlannerResponse[];
  let events: Array<{ event: string; payload: any }>;

  beforeAll(async () => {
    db = await createMigratedSchema('mycalendar_conflict_plan');
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
          selectedCalendars: [{ id: 'owner.calendar@example.test', summary: 'Lịch chính', primary: true }],
          allowedScope: { calendars: ['owner.calendar@example.test'] },
          connectedAt: new Date().toISOString(),
        },
        key,
      ),
      owner.id,
    );
  });

  afterAll(async () => {
    await db?.close();
  });

  const runMessage = async (
    text: string,
    getAdapter?: (serviceName: string, context?: any) => Promise<any> | any,
  ) => {
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
      getAdapter,
    });
    await svc.handleUserMessage({ conversationId: conv, userId: owner.id, content: text });
    for (let i = 0; i < 100 && !events.some((e) => ['plan_preview', 'refusal', 'error'].includes(e.event)); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const row = (await db.pool.query('SELECT * FROM plans WHERE conv_id=$1 ORDER BY created_at DESC LIMIT 1', [conv])).rows[0];
    return { conv, row };
  };

  it('appends a Vietnamese conflict warning to plan.warnings when an existing event overlaps the new meeting slot', async () => {
    responses.push(makePlan([createMeetingStep]));

    const { row } = await runMessage('Đặt lịch họp khách hàng Q4 lúc 9h sáng', async (serviceName) => {
      if (serviceName === 'mycalendar') {
        return {
          execute: async (tool: string) => {
            if (tool === 'mycalendar.list_events') {
              return {
                events: [
                  {
                    id: 'evt_existing_1',
                    title: 'Sprint Planning',
                    start: '2026-10-09T09:30:00+07:00',
                    end: '2026-10-09T10:30:00+07:00',
                    url: 'https://calendar.google.com/event?eid=1',
                  },
                ],
              };
            }
            return { events: [] };
          },
        };
      }
      return null;
    });

    expect(row).toBeDefined();
    expect(row.plan_json.warnings).toHaveLength(1);
    expect(row.plan_json.warnings[0]).toContain('Cảnh báo trùng lịch');
    expect(row.plan_json.warnings[0]).toContain('Họp khách hàng Q4');
    expect(row.plan_json.warnings[0]).toContain('Sprint Planning');
    // Ensure plan.connections.mycalendar only contains the 3 canonical fields
    expect(Object.keys(row.plan_json.connections.mycalendar).sort()).toEqual([
      'allowedCalendars',
      'credentialId',
      'email',
    ]);
  });

  it('does not add a conflict warning when existing events do not overlap', async () => {
    responses.push(makePlan([createMeetingStep]));

    const { row } = await runMessage('Đặt lịch họp khách hàng Q4 lúc 9h sáng', async (serviceName) => {
      if (serviceName === 'mycalendar') {
        return {
          execute: async () => ({
            events: [
              {
                id: 'evt_touching',
                title: 'Morning Standup',
                start: '2026-10-09T08:30:00+07:00',
                end: '2026-10-09T09:00:00+07:00',
                url: 'https://calendar.google.com/event?eid=2',
              },
            ],
          }),
        };
      }
      return null;
    });

    expect(row).toBeDefined();
    expect(row.plan_json.warnings).toEqual([]);
  });
});
