import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { encryptCredentials } from '@wap/tool-adapters';
import type { CalendarDigestCandidate, ScheduleProposalMetadata, ScheduleResponse } from '@wap/tool-schemas';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { evaluateCalendarDigestCandidate } from '../../src/services/schedules/calendar-digest-candidate.js';
import { ScheduleService } from '../../src/services/schedules/schedule-service.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const key = '0123456789abcdef0123456789abcdef';
const now = new Date('2026-11-02T00:00:00Z');
const calendars = [{ id: 'work@example.test', summary: 'Work' }, { id: 'team@example.test', summary: 'Team' }];

describe('Calendar approval binds the stored preview on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let owner: Awaited<ReturnType<typeof db.person>>;
  let credentials: CredentialRepo;
  let service: ScheduleService;
  let convId: string;
  const source = async (selected = calendars, email = 'owner@example.test', refreshToken = 'fixture') => {
    const encrypted = encryptCredentials({ refreshToken, email, selectedCalendars: selected,
      allowedScope: { calendars: selected.map(c => c.id) } }, key);
    const updated = await db.pool.query("UPDATE service_credentials SET config=$1 WHERE service='mycalendar' AND user_id=$2 RETURNING id", [encrypted, owner.id]);
    if (!updated.rowCount) await credentials.saveCredentials('mycalendar', encrypted, owner.id);
  };
  const destination = async (channel = 'C0123456789') => {
    const encrypted = encryptCredentials({ botToken: 'fixture', allowedScope: { channels: [channel] } }, key);
    const updated = await db.pool.query("UPDATE service_credentials SET config=$1 WHERE service='slack' AND user_id IS NULL RETURNING id", [encrypted]);
    if (!updated.rowCount) await credentials.saveCredentials('slack', encrypted);
  };
  const evaluate = () => evaluateCalendarDigestCandidate({ pool: db.pool, encryptionKey: key,
    userId: owner.id, services: ['mycalendar', 'slack'], request: 'Daily agenda to Slack' });
  const proposal = async (candidate: CalendarDigestCandidate, action: ScheduleResponse['action'] = 'create', version: number | null = null) => {
    const metadata: ScheduleProposalMetadata = { type: 'schedule_proposal',
      proposal: { kind: 'schedule', action, name: 'Agenda', request: 'Daily agenda to Slack',
        recurrence: { type: 'daily', time: '08:00' }, summary: 'Agenda to approved channel' },
      scheduleId: null, baseVersion: version, services: ['mycalendar', 'slack'], nextRuns: [], previous: null, digestCandidate: candidate };
    return new MessageRepo(db.pool).createMessage(convId, 'assistant', metadata.proposal.summary, metadata);
  };
  const confirm = (messageId: string, approvalMode?: 'auto_digest' | 'manual') => service.confirmProposal({
    userId: owner.id, convId, messageId, now, ...(approvalMode ? { approvalMode } : {}) });

  beforeAll(async () => { db = await createMigratedSchema('calendar_approval'); credentials = new CredentialRepo(db.pool, key); });
  beforeEach(async () => {
    await db.pool.query('DELETE FROM schedule_runs; DELETE FROM schedules; DELETE FROM service_credentials');
    owner = await db.person();
    convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])).rows[0].id;
    service = new ScheduleService({ pool: db.pool, encryptionKey: key, timeZone: 'Asia/Ho_Chi_Minh' });
    await source(); await destination();
  });
  afterAll(async () => db?.close());

  it.each(['calendar', 'channel', 'account', 'credential'] as const)('rejects changed %s after preview without creating a schedule', async kind => {
    const message = await proposal((await evaluate()).candidate);
    if (kind === 'calendar') await source([...calendars, { id: 'private@example.test', summary: 'Private' }]);
    if (kind === 'channel') await destination('C0987654321');
    if (kind === 'account') await source(calendars, 'other@example.test');
    if (kind === 'credential') { await db.pool.query("DELETE FROM service_credentials WHERE service='mycalendar'"); await source(); }
    await expect(confirm(message.id, 'auto_digest')).rejects.toMatchObject({ code: 'DIGEST_PREVIEW_CHANGED' });
    expect((await db.pool.query('SELECT count(*)::int n FROM schedules')).rows[0].n).toBe(0);
  });

  it.each(['auto_digest', undefined] as const)('rejects drift on update with mode %s and preserves the old approved snapshot', async mode => {
    const initial = await confirm((await proposal((await evaluate()).candidate)).id, 'auto_digest');
    const before = (await db.pool.query('SELECT * FROM schedules WHERE id=$1', [initial.schedule.id])).rows[0];
    const message = await proposal((await evaluate()).candidate, 'update', 1);
    await destination('C0987654321');
    await expect(confirm(message.id, mode)).rejects.toMatchObject({ code: 'DIGEST_PREVIEW_CHANGED' });
    const after = (await db.pool.query('SELECT * FROM schedules WHERE id=$1', [initial.schedule.id])).rows[0];
    expect(after.version).toBe(before.version);
    expect(after.digest_config).toEqual(before.digest_config);
    expect(after.last_proposal_id).toBe(before.last_proposal_id);
  });

  it('accepts token rotation and calendar reordering while retaining the displayed snapshot', async () => {
    const evaluation = await evaluate();
    const message = await proposal(evaluation.candidate);
    await source([...calendars].reverse(), 'owner@example.test', 'rotated-fixture');
    const approved = await confirm(message.id, 'auto_digest');
    expect(approved.schedule.digestConfig).toEqual(evaluation.config);
  });

  it('requires a fresh proposal when the old preview lacks the bound config', async () => {
    const candidate = (await evaluate()).candidate;
    delete candidate.config;
    const message = await proposal(candidate);
    await expect(confirm(message.id, 'auto_digest')).rejects.toMatchObject({ code: 'DIGEST_PREVIEW_CHANGED' });
    expect((await confirm(message.id, 'manual')).schedule.kind).toBe('plan');
  });

  it('rejects a stored config that differs from the displayed preview', async () => {
    const candidate = (await evaluate()).candidate;
    candidate.configPreview!.destinationId = 'C0987654321';
    await expect(confirm((await proposal(candidate)).id, 'auto_digest')).rejects.toMatchObject({ code: 'DIGEST_PREVIEW_CHANGED' });
  });
});
