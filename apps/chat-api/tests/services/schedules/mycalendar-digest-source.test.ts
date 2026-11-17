import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encryptCredentials } from '@wap/tool-adapters';
import type { ScheduleResponse, SlackDigestConfig, TelegramDigestConfig } from '@wap/tool-schemas';
import { ConversationRepo } from '../../../src/db/repositories/conversation-repo.js';
import { CredentialRepo } from '../../../src/db/repositories/credential-repo.js';
import { MessageRepo } from '../../../src/db/repositories/message-repo.js';
import { assertDigestScheduleLiveScopeAndAuth } from '../../../src/services/schedules/digest-scope-guard.js';
import { buildMultiDigestSources } from '../../../src/services/schedules/multi-source-digest-candidate.js';
import { executeMultiDigestReadSources } from '../../../src/services/schedules/multi-source-digest-reader.js';
import { loadLiveMyCalendarDigestConnection } from '../../../src/services/schedules/mycalendar-digest-source.js';
import { ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import { computeSlackDigestConfigHash, evaluateSlackDigestCandidate } from '../../../src/services/schedules/slack-digest-candidate.js';
import { computeTelegramDigestConfigHash, evaluateTelegramDigestCandidate } from '../../../src/services/schedules/telegram-digest-candidate.js';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';

const calendars = ['one', 'two', 'three', 'four', 'five', 'six'];
const connection = {
  credentialId: '9f773fca-120e-4aa4-9e27-2b5cbf7bf110',
  email: 'calendar@example.test',
  allowedCalendars: calendars,
};
const key = '0123456789abcdef0123456789abcdef';
const now = new Date('2026-11-18T01:00:00Z');
const timeZone = 'Asia/Ho_Chi_Minh';

function digestHash(config: SlackDigestConfig | TelegramDigestConfig) {
  return 'destination' in config ? computeSlackDigestConfigHash(config) : computeTelegramDigestConfigHash(config);
}

describe.each(['Slack', 'Telegram'] as const)('MyCalendar digest source for %s', (destinationLabel) => {
  it('requires a live connection at preview', () => {
    expect(buildMultiDigestSources({
      sourceServices: ['mycalendar'], destinationLabel, requestText: 'Gửi lịch sáng nay',
    })).toMatchObject({ ok: false });
  });

  it('records the exact capped calendar scope in the preview', () => {
    expect(buildMultiDigestSources({
      sourceServices: ['mycalendar'], destinationLabel, requestText: 'Gửi lịch sáng nay',
      mycalendarLookup: connection,
    })).toMatchObject({
      ok: true,
      sources: [{
        mycalendarBinding: {
          credentialId: connection.credentialId, email: connection.email,
          calendarIds: ['one', 'two', 'three', 'four', 'five'], truncated: true,
        },
      }],
    });
  });
});

describe('MyCalendar schedule approval on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;

  beforeAll(async () => { db = await createMigratedSchema('mycal_digest_source'); });
  afterAll(async () => db?.close());

  async function fixture(destination: 'slack' | 'telegram') {
    const owner = await db.person();
    const conversations = new ConversationRepo(db.pool);
    const messages = new MessageRepo(db.pool);
    const creds = new CredentialRepo(db.pool, key);
    const conv = await conversations.createConversation(owner.id, 'Calendar digest', { workspaceMode: 'personal' });
    const slackChannels = [{ id: 'C_WORK', name: 'work' }];
    const getAdapter = async (service: string) => service === 'slack'
      ? { execute: async () => slackChannels } : null;
    const schedules = new ScheduleService({ pool: db.pool, timeZone, encryptionKey: key, getAdapter });
    const services = ['mycalendar', 'trello', destination];
    const telegramRow = destination === 'telegram'
      ? await creds.saveCredentials('telegram', encryptCredentials({
          telegramUserId: '777', username: 'fixture',
          selectedChats: [{ chatId: '777', title: 'Me', type: 'private' }],
        }, key), owner.id)
      : null;
    if (destination === 'slack') {
      await creds.saveCredentials('slack', encryptCredentials({ botToken: 'fixture', allowedScope: { channels: ['C_WORK'] } }, key), owner.id);
    }
    const replaceCalendar = (email: string, calendarIds: string[]) => creds.saveCredentials('mycalendar', encryptCredentials({
      email, refreshToken: 'fixture', allowedScope: { calendars: calendarIds },
    }, key), owner.id);
    const original = await replaceCalendar(connection.email, calendars);
    const changeScope = (calendarIds: string[]) => db.pool.query(
      'UPDATE service_credentials SET config=$2 WHERE id=$1',
      [original.id, encryptCredentials({ email: connection.email, refreshToken: 'fixture', allowedScope: { calendars: calendarIds } }, key)],
    );
    const evaluate = async (proposal: ScheduleResponse, previous?: SlackDigestConfig | TelegramDigestConfig) => {
      const mycalendarLookup = await loadLiveMyCalendarDigestConnection(db.pool, owner.id, key);
      const input = { proposal, services, timeZone, mycalendarLookup, workspaceMode: 'personal' as const };
      return destination === 'slack'
        ? evaluateSlackDigestCandidate({ ...input, pool: db.pool, userId: owner.id, getAdapter, existingDigest: previous as SlackDigestConfig })
        : evaluateTelegramDigestCandidate({
            ...input,
            existingDigest: previous as TelegramDigestConfig,
            telegramLookup: {
              status: 'connected', selectedChats: [{ chatId: '777', title: 'Me', type: 'private' }],
              connection: { credentialId: telegramRow!.id, telegramUserId: '777', username: 'fixture', chatIds: ['777'] },
            },
          });
    };
    const proposal: ScheduleResponse = {
      kind: 'schedule', action: 'create', name: 'Bản tin',
      request: destination === 'slack' ? 'Gửi bản tin Calendar và Trello lên #work' : 'Gửi bản tin Calendar và Trello lên Telegram',
      recurrence: { type: 'daily', time: '08:00' }, summary: 'Bản tin',
    };
    const createCandidate = await evaluate(proposal);
    expect(createCandidate.canAutoDigest).toBe(true);
    const approve = async (messageId: string, approvalMode?: 'auto_digest') => schedules.confirmProposal({
      userId: owner.id, convId: conv.id, messageId, now, approvalMode,
    });
    const saveProposal = (edited: ScheduleResponse, candidate: Awaited<ReturnType<typeof evaluate>>, schedule?: { id: string; version: number }) =>
      messages.createMessage(conv.id, 'assistant', edited.summary, {
        type: 'schedule_proposal', proposal: edited, services, digestCandidate: candidate,
        ...(schedule ? { scheduleId: schedule.id, baseVersion: schedule.version } : {}),
      });
    const createMessage = await saveProposal(proposal, createCandidate);
    return { owner, creds, schedules, proposal, services, createCandidate, createMessage, changeScope, replaceCalendar, approve, evaluate, saveProposal };
  }

  it.each(['slack', 'telegram'] as const)('keeps the exact approved calendars on %s edits and runtime reads', async (destination) => {
    const f = await fixture(destination);
    const { schedule } = await f.approve(f.createMessage.id, 'auto_digest');
    const prior = f.createCandidate.config!;
    const expectedBinding = prior.sources[0]!.mycalendarBinding!;
    await f.changeScope(['new-unapproved-calendar', ...calendars].reverse());
    const edit: ScheduleResponse = { ...f.proposal, action: 'update', name: 'Bản tin mới', recurrence: { type: 'daily', time: '09:00' } };
    const candidate = await f.evaluate(edit, prior);
    expect(candidate.config?.sources[0]?.mycalendarBinding).toEqual(expectedBinding);
    const message = await f.saveProposal(edit, candidate, schedule);
    const edited = await f.approve(message.id);

    const stored = (await db.pool.query('SELECT digest_config, digest_config_hash FROM schedules WHERE id=$1', [schedule.id])).rows[0];
    expect(stored.digest_config.sources[0].mycalendarBinding).toEqual(expectedBinding);
    const tampered = structuredClone(stored.digest_config);
    tampered.sources[0].mycalendarBinding.calendarIds[0] = 'new-unapproved-calendar';
    expect(digestHash(tampered)).not.toBe(stored.digest_config_hash);
    const newScope = await f.saveProposal(edit, { ...candidate, config: tampered, configHash: digestHash(tampered) }, edited.schedule);
    await expect(f.approve(newScope.id)).rejects.toMatchObject({ code: 'REAUTHORIZATION_REQUIRED' });
    const readCalendars: string[] = [];
    const read = await executeMultiDigestReadSources({
      sources: stored.digest_config.sources,
      userId: f.owner.id, dueAt: now, sinceIso: now.toISOString(), untilIso: now.toISOString(),
      credentialRepo: f.creds, encryptionKey: key, signal: new AbortController().signal,
      adapterFactory: {
        getAdapterForService(service, context) {
          if (service !== 'mycalendar') return { execute: async () => [] };
          expect(context).toMatchObject({
            phase: 'execution',
            connections: { mycalendar: { credentialId: expectedBinding.credentialId, allowedCalendars: calendars.slice(0, 5) } },
          });
          return { execute: async (_tool: string, args: { calendarId: string }) => {
            readCalendars.push(args.calendarId);
            return { events: [] };
          } };
        },
      },
    });
    expect(readCalendars).toEqual(['one', 'two', 'three', 'four', 'five']);
    expect(read).toMatchObject({ kind: 'ok', sourceStatuses: [{ truncated: true }, {}] });

    await f.changeScope(['two', 'three', 'four', 'five', 'six']);
    const guard = await assertDigestScheduleLiveScopeAndAuth({ pool: db.pool, scheduleId: schedule.id, encryptionKey: key });
    expect(guard.code).toBe('DIGEST_MYCALENDAR_BINDING_INVALID');
    const paused = await f.schedules.setStatus({ userId: f.owner.id, scheduleId: schedule.id, action: 'pause', version: edited.schedule.version, now });
    await expect(f.schedules.setStatus({
      userId: f.owner.id, scheduleId: schedule.id, action: 'resume', version: paused.schedule.version, now,
    })).rejects.toMatchObject({ code: 'REAUTHORIZATION_REQUIRED' });
  });

  it.each(['slack', 'telegram'] as const)('rejects replaced grants at %s confirmation and reapproves legacy explicit calendars', async (destination) => {
    const f = await fixture(destination);
    await f.replaceCalendar('new@example.test', calendars);
    await expect(f.approve(f.createMessage.id, 'auto_digest')).rejects.toMatchObject({ code: 'DIGEST_PREVIEW_CHANGED' });
    const candidate = await f.evaluate(f.proposal);
    const message = await f.saveProposal(f.proposal, candidate);
    const { schedule } = await f.approve(message.id, 'auto_digest');

    const legacy = structuredClone(candidate.config!);
    delete legacy.sources[0]!.mycalendarBinding;
    legacy.sources[0]!.args = { calendarId: 'four' };
    await db.pool.query(
      "UPDATE schedules SET digest_config=$2, digest_config_hash=$3, status='paused', next_run_at=NULL WHERE id=$1",
      [schedule.id, JSON.stringify(legacy), digestHash(legacy)],
    );
    await expect(f.schedules.setStatus({
      userId: f.owner.id, scheduleId: schedule.id, action: 'resume', version: schedule.version, now,
    })).rejects.toMatchObject({ code: 'REAUTHORIZATION_REQUIRED' });
    const reauth = await f.schedules.createReauthorizePreview({ userId: f.owner.id, scheduleId: schedule.id, now });
    expect(reauth.candidate.config).toMatchObject({
      sources: [{ args: { calendarId: 'four' }, mycalendarBinding: { email: 'new@example.test', calendarIds: ['four'], truncated: false } }, {}],
    });
    await f.replaceCalendar('another@example.test', calendars);
    await expect(f.approve(reauth.proposalMessageId, 'auto_digest')).rejects.toMatchObject({ code: 'DIGEST_PREVIEW_CHANGED' });
    const latest = await f.schedules.createReauthorizePreview({ userId: f.owner.id, scheduleId: schedule.id, now });
    expect((await f.approve(latest.proposalMessageId, 'auto_digest')).schedule.status).toBe('active');
  });
});
