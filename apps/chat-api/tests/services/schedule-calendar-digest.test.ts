import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { encryptCredentials } from '@wap/tool-adapters';
import type { ScheduleProposalMetadata, ScheduleResponse } from '@wap/tool-schemas';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { ScheduleService } from '../../src/services/schedules/schedule-service.js';
import {
  computeCalendarDigestHash,
  evaluateCalendarDigestCandidate,
} from '../../src/services/schedules/calendar-digest-candidate.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const secret = 'schedule_calendar_digest_test_secret_at_least_32_chars';
const key = '0123456789abcdef0123456789abcdef';
const VN = 'Asia/Ho_Chi_Minh';
const NOW = new Date('2026-10-25T02:00:00.000Z');
type Db = Awaited<ReturnType<typeof createMigratedSchema>>;
type Person = Awaited<ReturnType<Db['person']>>;

const makeProposal = (overrides: Partial<ScheduleResponse> = {}): ScheduleResponse => ({
  kind: 'schedule',
  action: 'create',
  name: 'Bản tin Lịch họp buổi sáng',
  request: 'Tóm tắt lịch họp hôm nay và kiểm tra trùng giờ gửi lên Slack #daily-briefing',
  recurrence: { type: 'daily', time: '07:30' },
  summary: 'Mỗi sáng 7:30 gửi bản tin lịch họp lên Slack #daily-briefing.',
  ...overrides,
});

describe('Calendar auto_digest schedule candidate & confirmation on PostgreSQL 16', () => {
  let db: Db;
  let alice: Person;
  let credentials: CredentialRepo;
  let service: ScheduleService;
  let app: ReturnType<typeof createApp>;

  const bearer = (who: Person) => `Bearer ${generateAccessToken(who, secret, who.sid).accessToken}`;

  const seedMyCalendar = async (
    who: Person,
    selectedCalendars = [
      { id: 'owner.calendar@example.test', summary: 'Lịch chính', primary: true },
      { id: 'sprint@group.calendar.google.com', summary: 'Lịch Sprint' },
    ],
  ) => {
    await credentials.saveCredentials(
      'mycalendar',
      encryptCredentials(
        {
          refreshToken: '1//fake-cal-refresh',
          email: 'owner.calendar@example.test',
          scopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar'],
          selectedCalendars,
          allowedScope: { calendars: selectedCalendars.map((c) => c.id) },
          connectedAt: new Date().toISOString(),
        },
        key,
      ),
      who.id,
    );
  };

  const seedSlack = async (channels = ['C0123456789']) => {
    await credentials.saveCredentials(
      'slack',
      encryptCredentials({ botToken: 'xoxb-fake-slack', allowedScope: { channels } }, key),
      null,
    );
  };

  const seedTelegram = async (chats = ['-100123456789']) => {
    await credentials.saveCredentials(
      'telegram',
      encryptCredentials({ botToken: '123456:ABC-DEF', allowedScope: { chats } }, key),
      null,
    );
  };

  beforeAll(async () => {
    db = await createMigratedSchema('schedule_cal_digest');
    credentials = new CredentialRepo(db.pool);
  });

  beforeEach(async () => {
    await db.pool.query('DELETE FROM schedule_runs; DELETE FROM schedules; DELETE FROM service_credentials;');
    alice = await db.person('Alice');
    service = new ScheduleService({
      pool: db.pool,
      timeZone: VN,
      encryptionKey: key,
    });
    app = createApp({
      jwtSecret: secret,
      userRepo: db.users,
      schedules: {
        service,
        clock: () => NOW,
      },
    } as any);
  });

  afterAll(async () => {
    await db?.close();
  });

  it('evaluates eligible mycalendar + slack and mycalendar + telegram schedules as canAutoDigest: true', async () => {
    await seedMyCalendar(alice);
    await seedSlack(['C0123456789']);

    const slackEval = await evaluateCalendarDigestCandidate({
      pool: db.pool,
      encryptionKey: key,
      userId: alice.id,
      services: ['mycalendar', 'slack'],
      request: 'Tóm tắt lịch họp hôm nay và báo trùng giờ vào Slack #daily-briefing',
    });

    expect(slackEval.candidate.canAutoDigest).toBe(true);
    expect(slackEval.candidate.defaultMode).toBe('manual');
    expect(slackEval.candidate.configPreview).toEqual({
      email: 'owner.calendar@example.test',
      calendars: [
        { id: 'owner.calendar@example.test', summary: 'Lịch chính', primary: true },
        { id: 'sprint@group.calendar.google.com', summary: 'Lịch Sprint' },
      ],
      destinationService: 'slack',
      destinationId: 'C0123456789',
      destinationLabel: '#C0123456789',
    });
    expect(slackEval.config).toBeDefined();
    expect(slackEval.configHash).toBe(computeCalendarDigestHash(slackEval.config!));

    await seedTelegram(['-100987654321']);
    const telegramEval = await evaluateCalendarDigestCandidate({
      pool: db.pool,
      encryptionKey: key,
      userId: alice.id,
      services: ['mycalendar', 'telegram'],
      request: 'Gửi lịch họp sáng nay qua Telegram',
    });
    expect(telegramEval.candidate.canAutoDigest).toBe(true);
    expect(telegramEval.candidate.configPreview?.destinationService).toBe('telegram');
    expect(telegramEval.candidate.configPreview?.destinationId).toBe('-100987654321');
  });

  it('disqualifies requests with write intent or missing/multi-channel scope', async () => {
    await seedMyCalendar(alice);
    await seedSlack(['C0123456789']);

    const writeIntent = await evaluateCalendarDigestCandidate({
      pool: db.pool,
      encryptionKey: key,
      userId: alice.id,
      services: ['mycalendar', 'slack'],
      request: 'Tạo sự kiện họp Sprint mỗi sáng thứ Hai và báo lên Slack',
    });
    expect(writeIntent.candidate.canAutoDigest).toBe(false);
    expect(writeIntent.candidate.disabledReason).toContain('tạo/chỉnh sửa');

    await seedSlack(['C0123456789', 'C9999999999']);
    const multiChannel = await evaluateCalendarDigestCandidate({
      pool: db.pool,
      encryptionKey: key,
      userId: alice.id,
      services: ['mycalendar', 'slack'],
      request: 'Tóm tắt lịch họp hôm nay gửi lên Slack',
    });
    expect(multiChannel.candidate.canAutoDigest).toBe(false);
    expect(multiChannel.candidate.disabledReason).toContain('đúng 1 kênh');
  });

  it('confirms auto_digest schedule, stores digest_config & hash, rejects revoked connection with 409, and downgrades on write update', async () => {
    await seedMyCalendar(alice);
    await seedSlack(['C0123456789']);

    const convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [alice.id])).rows[0].id as string;
    const evaluation = await evaluateCalendarDigestCandidate({
      pool: db.pool,
      encryptionKey: key,
      userId: alice.id,
      services: ['mycalendar', 'slack'],
      request: makeProposal().request!,
    });

    const proposalMeta: ScheduleProposalMetadata = {
      type: 'schedule_proposal',
      proposal: makeProposal(),
      scheduleId: null,
      baseVersion: null,
      services: ['mycalendar', 'slack'],
      nextRuns: [],
      previous: null,
      digestCandidate: evaluation.candidate,
    };

    const msgId = (
      await db.pool.query(
        "INSERT INTO messages(conv_id, role, content, metadata) VALUES($1, 'assistant', $2, $3) RETURNING id",
        [convId, proposalMeta.proposal.summary, JSON.stringify(proposalMeta)],
      )
    ).rows[0].id as string;

    // Invalid approvalMode returns 400
    const badMode = await request(app)
      .post(`/api/conversations/${convId}/schedule-proposals/${msgId}/confirm`)
      .set('Authorization', bearer(alice))
      .send({ approvalMode: 'invalid_mode' });
    expect(badMode.status).toBe(400);

    // Confirm with auto_digest
    const res = await request(app)
      .post(`/api/conversations/${convId}/schedule-proposals/${msgId}/confirm`)
      .set('Authorization', bearer(alice))
      .send({ approvalMode: 'auto_digest' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.schedule).toMatchObject({
      kind: 'calendar_digest',
      approvalMode: 'auto_digest',
      status: 'active',
      version: 1,
    });
    expect(res.body.schedule.digestConfig).toMatchObject({
      source: 'mycalendar',
      email: 'owner.calendar@example.test',
      destination: { service: 'slack', channelId: 'C0123456789' },
    });

    // Update with write intent downgrades kind back to 'plan'
    const updateMeta: ScheduleProposalMetadata = {
      type: 'schedule_proposal',
      proposal: makeProposal({
        action: 'update',
        request: 'Tạo sự kiện họp mỗi sáng và báo lên Slack #daily-briefing',
      }),
      scheduleId: res.body.schedule.id,
      baseVersion: 1,
      services: ['mycalendar', 'slack'],
      nextRuns: [],
      previous: null,
    };
    const updateMsgId = (
      await db.pool.query(
        "INSERT INTO messages(conv_id, role, content, metadata) VALUES($1, 'assistant', $2, $3) RETURNING id",
        [convId, updateMeta.proposal.summary, JSON.stringify(updateMeta)],
      )
    ).rows[0].id as string;

    const updated = await request(app)
      .post(`/api/conversations/${convId}/schedule-proposals/${updateMsgId}/confirm`)
      .set('Authorization', bearer(alice))
      .send({});
    expect(updated.status).toBe(200);
    expect(updated.body.schedule).toMatchObject({
      kind: 'plan',
      approvalMode: 'manual',
      version: 2,
      digestConfig: null,
    });

    // Confirming auto_digest when mycalendar was disconnected before confirm returns 409 AUTO_DIGEST_NOT_ELIGIBLE
    await db.pool.query("DELETE FROM service_credentials WHERE service = 'mycalendar' AND user_id = $1", [alice.id]);
    const conv2 = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [alice.id])).rows[0].id as string;
    const msg2 = (
      await db.pool.query(
        "INSERT INTO messages(conv_id, role, content, metadata) VALUES($1, 'assistant', $2, $3) RETURNING id",
        [conv2, proposalMeta.proposal.summary, JSON.stringify(proposalMeta)],
      )
    ).rows[0].id as string;

    const rejected = await request(app)
      .post(`/api/conversations/${conv2}/schedule-proposals/${msg2}/confirm`)
      .set('Authorization', bearer(alice))
      .send({ approvalMode: 'auto_digest' });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('AUTO_DIGEST_NOT_ELIGIBLE');
  });
});
