import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createScheduleRuntime } from '../../src/config/schedules-runtime.js';
import { WorkspaceRepoError } from '../../src/db/repositories/workspace/errors.js';
import { JiraDispatchError, JiraDispatchGuard } from '../../src/services/jira/jira-dispatch-guard.js';
import { JiraLeaseManager } from '../../src/services/jira/jira-lease-manager.js';
import { JiraTokenManagerError } from '../../src/services/jira/jira-token-manager.js';
import { computeJiraDigestConfigHash, type JiraDigestConfig } from '../../src/services/schedules/jira-digest-candidate.js';
import { createJiraDigestExecutor, JIRA_READ_UNAVAILABLE } from '../../src/services/schedules/jira-digest-runner.js';
import * as digestScopeGuard from '../../src/services/schedules/digest-scope-guard.js';
import { certifyScheduleFixture } from '../../src/services/slack/slack-schedule-origin.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

describe('Jira digest runtime policy', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  beforeAll(async () => { db = await createMigratedSchema('jira_digest_runtime'); });
  afterAll(async () => { await db?.close(); });

  it.each([
    { kind: 'myjira_digest', services: ['myjira', 'slack'], config: {} },
    {
      kind: 'telegram_digest',
      services: ['github', 'telegram'],
      config: { sources: [{ service: 'myjira', tool: 'myjira.search_issues' }] },
    },
  ])('blocks a persisted $kind before execution when Jira egress is off', async ({ kind, services, config }) => {
    const owner = await db.person();
    const convId = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.id])).rows[0].id;
    const scheduleId = (
      await db.pool.query(
        "INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at,kind,digest_config,digest_config_hash,digest_approved_at) VALUES($1,$2,'Digest','Send digest',$3,$4,'active','2026-10-25T01:00:00Z',$5,$6,repeat('a', 64),now()) RETURNING id",
        [owner.id, convId, { type: 'daily', time: '08:00' }, services, kind, config],
      )
    ).rows[0].id;
    await certifyScheduleFixture(db.pool, scheduleId);
    const runJiraDigest = vi.fn().mockResolvedValue({ state: 'blocked', error: 'Reached Jira executor' });
    const executeDigestRun = vi.fn().mockResolvedValue({ status: 'blocked', error: 'Reached Telegram executor' });
    const scope = vi.spyOn(digestScopeGuard, 'assertDigestScheduleLiveScopeAndAuth').mockResolvedValue({
      allowed: true,
      trustedWorkspaceId: randomUUID(),
      trustedWorkspaceMode: 'organization',
    });
    const options = {
      enabled: true,
      pool: db.pool,
      timeZone: 'Asia/Ho_Chi_Minh',
      jiraLlmEgressEnabled: false,
      now: () => new Date('2026-10-25T01:00:30.000Z'),
      runJiraDigest,
      executeDigestRun,
    };
    const runtime = createScheduleRuntime(options)!;
    try {
      await runtime.runner.tick();
      const { rows } = await db.pool.query('SELECT status, error FROM schedule_runs WHERE schedule_id=$1', [scheduleId]);
      expect(rows).toEqual([{
        status: 'blocked',
        error: expect.stringContaining('JIRA_LLM_EGRESS_DISABLED_IN_G2A'),
      }]);
      expect(runJiraDigest).not.toHaveBeenCalled();
      expect(executeDigestRun).not.toHaveBeenCalled();
    } finally {
      scope.mockRestore();
      await runtime.runner.stop();
    }
  });
});

describe('Jira digest provider outages', () => {
  const config: JiraDigestConfig = {
    workspaceId: randomUUID(),
    grantId: randomUUID(),
    atlassianAccountId: 'atlassian-fixture',
    projects: [{ siteId: randomUUID(), siteName: 'Jira test', projectKey: 'TEST' }],
    channelId: 'C0123456',
    channelName: 'standup',
  };
  const recurrence = { type: 'daily', time: '08:00' } as const;

  it.each(['initialization', 'database lookup', 'read', 'token lookup', 'lease lookup', 'reconnect required'] as const)(
    'distinguishes temporary outages from lost authority during %s',
    async (stage) => {
      const outage = new WorkspaceRepoError(503, 'NATIVE_VERIFIER_UNAVAILABLE', 'Jira unavailable');
      const databaseOutage = new Error('database connection closed');
      const pool = { connect: vi.fn().mockRejectedValue(databaseOutage) } as unknown as pg.Pool;
      const tokenManager = {
        getAccessToken: async () => {
          if (stage === 'token lookup') throw databaseOutage;
          if (stage === 'reconnect required') {
            throw new JiraTokenManagerError('RECONNECT_REQUIRED', 'Grant needs to reconnect', 403);
          }
          return 'fixture-token';
        },
      };
      const guard = new JiraDispatchGuard(pool, new JiraLeaseManager({ pool, tokenManager }), tokenManager);
      const execute = stage === 'read'
        ? vi.fn().mockRejectedValue(new JiraDispatchError('Jira unavailable', 'NATIVE_VERIFIER_UNAVAILABLE', { category: 'SERVER_ERROR' }))
        : () => guard.executeGuardedDispatch(
            { userId: 'fixture', workspaceId: config.workspaceId, siteId: config.projects[0]!.siteId, cloudId: 'fixture-cloud' },
            { isWrite: false, tool: 'myjira.search_issues', signal: AbortSignal.timeout(3000) },
            vi.fn(),
          );
      const getAdapter = vi.fn().mockImplementation(async (service) => {
        if (service !== 'myjira') return { execute: vi.fn() };
        if (stage === 'initialization') throw outage;
        if (stage === 'database lookup') throw databaseOutage;
        return { execute };
      });
      const run = createJiraDigestExecutor({
        pool: {} as pg.Pool,
        timeZone: 'Asia/Ho_Chi_Minh',
        getAdapter,
      });

      const outcome = await run({
        runId: 'fixture',
        scheduleId: 'fixture',
        scheduleVersion: 1,
        userId: 'fixture',
        name: 'Jira digest',
        request: 'Jira digest',
        dueAt: new Date('2026-10-25T01:00:00Z'),
        trigger: 'scheduled',
        workspaceId: config.workspaceId,
        workspaceMode: 'organization',
        recurrence,
        digestConfig: config,
        digestConfigHash: computeJiraDigestConfigHash({ config, recurrence, userId: 'fixture' }),
      }, 'fixture', AbortSignal.timeout(3000));

      if (stage === 'reconnect required') {
        expect(outcome).toMatchObject({ state: 'blocked' });
      } else {
        expect(outcome).toMatchObject({ state: 'digest_failed', failureCode: JIRA_READ_UNAVAILABLE });
      }
  });
});
