import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptCredentials, GlobalRateLimiter } from '@wap/tool-adapters';
import type { CalendarDigestConfig } from '@wap/tool-schemas';
import { CredentialRepo } from '../../../src/db/repositories/credential-repo.js';
import { AdapterFactory } from '../../../src/services/adapter-factory.js';
import {
  computeCalendarDigestHash,
  evaluateCalendarDigestCandidate,
} from '../../../src/services/schedules/calendar-digest-candidate.js';
import { createCalendarDigestExecutor } from '../../../src/services/schedules/calendar-digest-runner.js';
import { evaluateGithubDigestCandidate } from '../../../src/services/schedules/github-digest-candidate.js';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';

const KEY = '0123456789abcdef0123456789abcdef';
const TZ = 'Asia/Ho_Chi_Minh';
const NOW = new Date('2026-11-17T01:00:00Z');

describe('Digest Slack credential isolation by workspace', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let owner: Awaited<ReturnType<typeof db.person>>;
  let creds: CredentialRepo;
  let wsA: string;
  let wsB: string;

  beforeAll(async () => {
    db = await createMigratedSchema('cal_slack_ws');
    creds = new CredentialRepo(db.pool, KEY);
  });

  beforeEach(async () => {
    await db.pool.query('DELETE FROM schedule_runs; DELETE FROM schedules; DELETE FROM service_credentials; DELETE FROM workspaces;');
    owner = await db.person('Workspace Owner');
    wsA = (await db.pool.query("INSERT INTO workspaces(name,invite_code,created_by) VALUES('Org A','ORGA-01',$1) RETURNING id", [owner.id])).rows[0].id;
    wsB = (await db.pool.query("INSERT INTO workspaces(name,invite_code,created_by) VALUES('Org B','ORGB-02',$1) RETURNING id", [owner.id])).rows[0].id;
    await creds.saveCredentials('mycalendar', encryptCredentials({
      refreshToken: 'cal-ref', email: 'owner@example.test',
      selectedCalendars: [{ id: 'work@example.test', summary: 'Work', primary: true }],
      allowedScope: { calendars: ['work@example.test'] },
    }, KEY), owner.id);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  afterAll(async () => db?.close());

  it('evaluateCalendarDigestCandidate selects only the caller workspace Slack credential and blocks cross-workspace fallback', async () => {
    await creds.upsertCredentials('slack', encryptCredentials({ botToken: 'xoxb-legacy', allowedScope: { channels: ['C01LEGACY1'] } }, KEY), 'active', owner.email, null);
    await creds.upsertCredentials('slack', encryptCredentials({ botToken: 'xoxb-org-b', allowedScope: { channels: ['C01ORGB002'] } }, KEY), 'active', owner.email, wsB);

    const missingOrgA = await evaluateCalendarDigestCandidate({
      pool: db.pool, encryptionKey: KEY, userId: owner.id, services: ['mycalendar', 'slack'],
      request: 'Gửi lịch họp lên Slack', workspaceMode: 'organization', workspaceId: wsA,
    });
    expect(missingOrgA.candidate.canAutoDigest).toBe(false);

    await creds.upsertCredentials('slack', encryptCredentials({ botToken: 'xoxb-org-a', allowedScope: { channels: ['C01ORGA001'] } }, KEY), 'active', owner.email, wsA);
    const orgA = await evaluateCalendarDigestCandidate({
      pool: db.pool, encryptionKey: KEY, userId: owner.id, services: ['mycalendar', 'slack'],
      request: 'Gửi lịch họp lên Slack', workspaceMode: 'organization', workspaceId: wsA,
    });
    expect(orgA.candidate.canAutoDigest).toBe(true);
    expect(orgA.candidate.configPreview?.destinationId).toBe('C01ORGA001');

    const personal = await evaluateCalendarDigestCandidate({
      pool: db.pool, encryptionKey: KEY, userId: owner.id, services: ['mycalendar', 'slack'],
      request: 'Gửi lịch họp lên Slack', workspaceMode: 'personal', workspaceId: null,
    });
    expect(personal.candidate.canAutoDigest).toBe(true);
    expect(personal.candidate.configPreview?.destinationId).toBe('C01LEGACY1');
  });

  it('createCalendarDigestExecutor verifies Slack against schedule workspace_id and forwards workspace context to getAdapter', async () => {
    const calCred = await creds.getPersonalCredentials('mycalendar', owner.id);
    await creds.upsertCredentials('slack', encryptCredentials({ botToken: 'xoxb-legacy', allowedScope: { channels: ['C01ORGA001'] } }, KEY), 'active', owner.email, null);

    const convId = (await db.pool.query("INSERT INTO conversations(user_id, workspace_id, workspace_mode) VALUES($1, $2, 'organization') RETURNING id", [owner.id, wsA])).rows[0].id;
    const config: CalendarDigestConfig = {
      version: 1, source: 'mycalendar', credentialId: calCred!.id, email: 'owner@example.test',
      calendars: [{ id: 'work@example.test', summary: 'Work' }],
      destination: { service: 'slack', channelId: 'C01ORGA001' }, windowHours: 24, includeSummary: false,
    };
    const sched = (await db.pool.query(
      `INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at,kind,digest_config,digest_config_hash,digest_approved_at,workspace_id,workspace_mode)
       VALUES($1,$2,'Org Agenda','Send',$3,$4,'active',now(),'calendar_digest',$5,$6,now(),$7,'organization') RETURNING *`,
      [owner.id, convId, JSON.stringify({ type: 'daily', time: '08:00' }), ['mycalendar', 'slack'], JSON.stringify(config), computeCalendarDigestHash(config), wsA],
    )).rows[0];
    const run = (await db.pool.query(
      "INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status) VALUES($1,1,'manual',$2,'planning') RETURNING *",
      [sched.id, NOW],
    )).rows[0];

    const adapterCalls: Array<{ service: string; ctx: any }> = [];
    const executor = createCalendarDigestExecutor({
      pool: db.pool, encryptionKey: KEY, timeZone: TZ,
      getAdapter: async (service, ctx) => {
        adapterCalls.push({ service, ctx });
        return { execute: async () => (service === 'mycalendar' ? { events: [] } : { ts: '1.1', channel: 'C01ORGA001' }) };
      },
    });

    const baseRun = {
      runId: run.id, scheduleId: sched.id, scheduleVersion: 1, userId: owner.id, name: 'Org Agenda',
      request: 'Send', dueAt: NOW, trigger: 'manual' as const, services: ['mycalendar', 'slack'],
      kind: 'calendar_digest' as const, digestConfig: config, digestConfigHash: computeCalendarDigestHash(config),
    };

    // Org A has no Slack credential yet: must NOT fall back to legacy Slack!
    const blocked = await executor(baseRun, new AbortController().signal);
    expect(blocked.state).toBe('blocked');
    expect(adapterCalls).toHaveLength(0);

    // Add Org A Slack credential: execution passes workspaceMode + workspaceId for Org A.
    await creds.upsertCredentials('slack', encryptCredentials({ botToken: 'xoxb-org-a', allowedScope: { channels: ['C01ORGA001'] } }, KEY), 'active', owner.email, wsA);
    const sent = await executor(baseRun, new AbortController().signal);
    expect(sent.state).toBe('digest_sent');
    const slackCall = adapterCalls.find((c) => c.service === 'slack');
    expect(slackCall?.ctx).toMatchObject({ workspaceMode: 'organization', workspaceId: wsA });
  });

  it.each([
    { scenario: 'personal Slack credential', hasPersonal: true, replace: null, expectedToken: 'xoxb-personal', state: 'digest_sent' },
    { scenario: 'legacy fallback', hasPersonal: false, replace: null, expectedToken: 'xoxb-legacy', state: 'digest_sent' },
    { scenario: 'changed credential during Calendar read', hasPersonal: true, replace: 'read', expectedToken: null, state: 'digest_failed' },
    { scenario: 'changed credential during throttling', hasPersonal: true, replace: 'throttle', expectedToken: null, state: 'digest_failed' },
  ])('uses the validated Slack bot in a personal Calendar digest with $scenario', async ({ hasPersonal, replace, expectedToken, state }) => {
    const channel = 'C01PERSON01';
    const encrypted = (botToken: string) => encryptCredentials({ botToken, allowedScope: { channels: [channel] } }, KEY);
    await creds.upsertCredentials('slack', encrypted('xoxb-legacy'));
    const personalCredential = hasPersonal ? await creds.saveCredentials('slack', encrypted('xoxb-personal'), owner.id) : null;
    const replaceCredential = () => db.pool.query(
      'UPDATE service_credentials SET config=$1 WHERE id=$2', [encrypted('xoxb-replaced'), personalCredential?.id],
    );

    const services = ['mycalendar', 'slack'];
    const request = 'Gửi lịch họp lên Slack';
    const { config, configHash } = await evaluateCalendarDigestCandidate({
      pool: db.pool, encryptionKey: KEY, userId: owner.id, services, request, workspaceMode: 'personal',
    });
    if (replace === 'throttle') {
      vi.spyOn(GlobalRateLimiter.prototype, 'waitForSlot').mockImplementationOnce(async () => {
        await replaceCredential();
        return true;
      });
    }
    expect(config?.destination).toMatchObject({ service: 'slack', channelId: channel });
    expect(configHash).toBeDefined();

    const convId = (await db.pool.query(
      "INSERT INTO conversations(user_id, workspace_mode) VALUES($1, 'personal') RETURNING id", [owner.id],
    )).rows[0].id;
    const scheduleId = (await db.pool.query(
      `INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at,kind,digest_config,digest_config_hash,digest_approved_at,workspace_mode)
       VALUES($1,$2,'Personal Agenda',$3,$4,$5,'active',now(),'calendar_digest',$6,$7,now(),'personal') RETURNING id`,
      [owner.id, convId, request, JSON.stringify({ type: 'daily', time: '08:00' }), services, JSON.stringify(config), configHash],
    )).rows[0].id;
    const runId = (await db.pool.query(
      "INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status) VALUES($1,1,'manual',$2,'planning') RETURNING id",
      [scheduleId, NOW],
    )).rows[0].id;

    const posts: Array<{ authorization: string | null; channel: string }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (url !== 'https://slack.com/api/chat.postMessage' || init.method !== 'POST') throw new Error('Unexpected HTTP request');
      const body = JSON.parse(String(init.body));
      posts.push({ authorization: new Headers(init.headers).get('Authorization'), channel: body.channel });
      return Response.json({ ok: true, ts: '1.1', channel });
    });
    const factory = new AdapterFactory({ credentialRepo: creds, encryptionKey: KEY });
    const executor = createCalendarDigestExecutor({
      pool: db.pool, encryptionKey: KEY, timeZone: TZ,
      getAdapter: (service, context) => service === 'mycalendar'
        ? {
            execute: async () => {
              if (replace === 'read') await replaceCredential();
              return { events: [] };
            },
          }
        : factory.getAdapterForService(service, context),
    });
    const outcome = await executor({
      runId, scheduleId, scheduleVersion: 1, userId: owner.id, name: 'Personal Agenda',
      request, dueAt: NOW, trigger: 'manual', services, workspaceMode: 'personal',
      digestConfig: config!, digestConfigHash: configHash!,
    }, new AbortController().signal);

    expect(outcome.state).toBe(state);
    expect(posts).toEqual(expectedToken ? [{ authorization: `Bearer ${expectedToken}`, channel }] : []);
  });

  it('evaluateGithubDigestCandidate forwards workspaceMode and workspaceId when resolving Slack adapter', async () => {
    const getAdapter = vi.fn(async () => ({
      execute: async () => [{ id: 'C_ORGA_00001', name: 'eng-alerts' }],
    }));
    const res = await evaluateGithubDigestCandidate({
      userId: owner.id,
      scopeId: wsA,
      workspaceMode: 'organization',
      workspaceId: wsA,
      request: 'Mỗi sáng báo PR tồn đọng của org/repo lên Slack #eng-alerts',
      services: ['github', 'slack'],
      recurrence: { type: 'daily', time: '08:00' },
      githubConnection: async () => ({ status: 'connected', connection: { credentialId: 'gh1', githubUserId: '1', login: 'u', repos: ['org/repo'] } }),
      getAdapter,
    });
    expect(res.canAutoDigest).toBe(true);
    expect(getAdapter).toHaveBeenCalledWith('slack', expect.objectContaining({ workspaceMode: 'organization', workspaceId: wsA, phase: 'planning' }));
  });
});
