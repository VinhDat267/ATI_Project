import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { encryptCredentials } from '@wap/tool-adapters';
import { CredentialRepo } from '../../../src/db/repositories/credential-repo.js';
import { AdapterFactory, type AdapterContext } from '../../../src/services/adapter-factory.js';
import { JiraDispatchGuard } from '../../../src/services/jira/jira-dispatch-guard.js';
import { JiraLeaseManager } from '../../../src/services/jira/jira-lease-manager.js';
import { JiraOAuthClient } from '../../../src/services/jira/jira-oauth-client.js';
import { JiraTokenManager } from '../../../src/services/jira/jira-token-manager.js';
import { evaluateTelegramDigestCandidate, computeTelegramDigestConfigHash } from '../../../src/services/schedules/telegram-digest-candidate.js';
import { TelegramDigestRunner } from '../../../src/services/schedules/telegram-digest-runner.js';
import { ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import { certifyScheduleFixture } from '../../../src/services/slack/slack-schedule-origin.js';
import {
  connectSyntheticJiraAccount,
  createIsolatedTestSchema,
  createSyntheticUser,
  type IsolatedTestContext,
} from '../../helpers/jira-test-db.js';

const ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const NOW = new Date('2026-11-17T02:00:00Z');
const CHAT_ID = '777888999';

describe('Jira approval binding for mixed Telegram digests', () => {
  let db: IsolatedTestContext;

  beforeAll(async () => {
    db = await createIsolatedTestSchema();
    await db.runAllMigrations();
  }, 30_000);
  afterAll(async () => db?.cleanup());

  async function fixture() {
    const { pool } = db;
    const userId = await createSyntheticUser(pool);
    const workspaceId = randomUUID();
    const siteId = randomUUID();
    const cloudId = randomUUID();
    const atlassianAccountId = 'atlas-' + userId;
    const accountId = await connectSyntheticJiraAccount(pool, userId, atlassianAccountId);
    async function addGrant() {
      const { rows: [grant] } = await pool.query<{ id: string }>(
        "INSERT INTO jira_oauth_grants (account_id, scopes, encrypted_access_token, encrypted_refresh_token, expires_at) VALUES ($1, $2, $3, $4, now() + interval '1 hour') RETURNING id",
        [
          accountId, ['read:jira-work'],
          encryptCredentials({ token: 'jira-loopback-fixture' }, ENCRYPTION_KEY),
          encryptCredentials({ token: 'jira-loopback-refresh' }, ENCRYPTION_KEY),
        ],
      );
      await pool.query(
        "INSERT INTO jira_grant_sites (grant_id, cloud_id, site_name, site_url) VALUES ($1, $2, 'Planora Jira', 'https://planora.atlassian.net')",
        [grant!.id, cloudId],
      );
      return grant!.id;
    }
    const grantId = await addGrant();
    await pool.query("INSERT INTO workspaces (id, name, invite_code, created_by) VALUES ($1, 'Planora', $2, $3)", [workspaceId, workspaceId.slice(0, 8), userId]);
    await pool.query("INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'admin', 'active')", [workspaceId, userId]);
    await pool.query("INSERT INTO ati_workspaces (id, slug, created_by) VALUES ($1, $2, $3)", [workspaceId, 'ws-' + workspaceId, userId]);
    await pool.query("INSERT INTO ati_workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'admin', 'active')", [workspaceId, userId]);
    await pool.query(
      "INSERT INTO ati_workspace_jira_sites (id, workspace_id, cloud_id, site_name, site_url, active, linked_by) VALUES ($1, $2, $3, 'Planora Jira', 'https://planora.atlassian.net', true, $4)",
      [siteId, workspaceId, cloudId, userId],
    );
    await pool.query(
      "INSERT INTO ati_workspace_jira_projects (workspace_id, site_id, cloud_id, numeric_project_id, project_key, project_name, selected) VALUES ($1, $2, $3, '10001', 'ATI', 'ATI Platform', true)",
      [workspaceId, siteId, cloudId],
    );
    const { rows: [conversation] } = await pool.query<{ id: string }>(
      "INSERT INTO conversations (user_id, workspace_id, workspace_mode, jira_context) VALUES ($1, $2, 'organization', true) RETURNING id",
      [userId, workspaceId],
    );

    const credentialRepo = new CredentialRepo(pool, ENCRYPTION_KEY);
    const selectedChats = [{ chatId: CHAT_ID, type: 'private' as const, title: 'Standup' }];
    const telegram = await credentialRepo.saveCredentials(
      'telegram',
      encryptCredentials({ telegramUserId: CHAT_ID, username: 'review_bot', selectedChats }, ENCRYPTION_KEY),
      userId,
    );
    const candidateInput = {
      proposal: {
        kind: 'schedule' as const, action: 'create' as const,
        name: 'Planora standup', request: 'Tổng hợp Jira ATI và Lịch nhóm gửi Telegram cho tôi',
        recurrence: { type: 'daily' as const, time: '09:00' }, summary: 'Standup',
      },
      services: ['myjira', 'calendar', 'telegram'],
      timeZone: 'Asia/Ho_Chi_Minh',
      workspaceMode: 'organization' as const,
      workspaceId,
      telegramLookup: {
        status: 'connected' as const,
        selectedChats,
        connection: { credentialId: telegram.id, telegramUserId: CHAT_ID, username: 'review_bot', chatIds: [CHAT_ID] },
      },
      jiraLookup: {
        status: 'connected' as const, workspaceId, grantId, atlassianAccountId,
        projects: [{ siteId, siteName: 'Planora Jira', projectKey: 'ATI' }],
      },
    };
    return { pool, candidateInput, accountId, workspaceId, siteId, cloudId, userId, conversation, credentialRepo, addGrant };
  }

  it('includes Jira grant and Atlassian account in the approved config hash', async () => {
    const { candidateInput } = await fixture();
    const approved = evaluateTelegramDigestCandidate(candidateInput);
    expect(approved.canAutoDigest).toBe(true);
    expect(approved.config?.sources[0]).toMatchObject({
      service: 'myjira',
      jiraBinding: {
        grantId: candidateInput.jiraLookup.grantId,
        atlassianAccountId: candidateInput.jiraLookup.atlassianAccountId,
      },
    });
    for (const replacement of [{ grantId: randomUUID() }, { atlassianAccountId: 'new-atlas-account' }]) {
      const changed = evaluateTelegramDigestCandidate({
        ...candidateInput, jiraLookup: { ...candidateInput.jiraLookup, ...replacement },
      });
      expect(changed.canAutoDigest).toBe(true);
      expect(changed.configHash).not.toBe(approved.configHash);
    }
    expect(evaluateTelegramDigestCandidate({
      ...candidateInput, jiraLookup: { ...candidateInput.jiraLookup, workspaceId: randomUUID() },
    }).canAutoDigest).toBe(false);
  });

  it.each([
    'approved', 'approved-401-retry', 'grant-before-401-retry', 'legacy-unbound',
    'grant-before-read', 'account-before-read', 'grant-at-read-dispatch',
    'grant-after-read', 'grant-after-ai', 'project-after-read', 'workspace-after-read',
  ] as const)('enforces the approved Jira authority through each digest stage (%s)', async (change) => {
    const { pool, candidateInput, accountId, workspaceId, siteId, cloudId, userId, conversation, credentialRepo, addGrant } = await fixture();
    const candidate = evaluateTelegramDigestCandidate(candidateInput);
    expect(candidate.canAutoDigest).toBe(true);
    const config = candidate.config!;
    if (change === 'legacy-unbound') {
      delete config.sources[0]!.jiraBinding;
    }
    const hash = computeTelegramDigestConfigHash(config);
    const { rows: [schedule] } = await pool.query<{ id: string; version: number }>(
      "INSERT INTO schedules (user_id, conv_id, workspace_id, workspace_mode, name, request, recurrence, services, status, next_run_at, kind, digest_config, digest_config_hash, digest_approved_at) VALUES ($1, $2, $3, 'organization', 'Planora standup', 'Jira and Calendar', $4, '{myjira,calendar,telegram}', 'active', $5, 'telegram_digest', $6, $7, now()) RETURNING id, version",
      [userId, conversation!.id, workspaceId, config.recurrence, NOW, config, hash],
    );
    const { rows: [run] } = await pool.query<{ id: string }>(
      "INSERT INTO schedule_runs (schedule_id, schedule_version, trigger, due_at, status) VALUES ($1, $2, 'scheduled', $3, 'planning') RETURNING id",
      [schedule!.id, schedule!.version, NOW],
    );
    async function replaceGrant(): Promise<string> {
      await pool.query("UPDATE jira_oauth_grants SET status = 'revoked' WHERE id = $1", [candidateInput.jiraLookup.grantId]);
      return addGrant();
    }
    if (change === 'grant-before-read') await replaceGrant();
    if (change === 'account-before-read') {
      await pool.query('UPDATE jira_accounts SET atlassian_account_id = $1 WHERE id = $2', ['new-atlas-account', accountId]);
    }

    const jiraRead = vi.fn(async () => {
      if (change === 'grant-after-read') await replaceGrant();
      if (change === 'project-after-read') {
        await pool.query('UPDATE ati_workspace_jira_projects SET selected = false WHERE site_id = $1', [siteId]);
      }
      if (change === 'workspace-after-read') {
        await pool.query("UPDATE ati_workspaces SET status = 'archived' WHERE id = $1", [workspaceId]);
      }
      return { issues: [{ key: 'ATI-123', title: 'Approved test issue' }] };
    });
    const summarizeWithAi = vi.fn(async () => {
      if (change === 'grant-after-ai') await replaceGrant();
      return 'Standup summary';
    });
    const telegramSend = vi.fn(async () => ({ messageId: 123 }));
    const expect401 = change === 'approved-401-retry' || change === 'grant-before-401-retry';
    const jiraHttp = vi.fn(async (_url: string | URL | Request, _request?: RequestInit) => {
      if (expect401 && jiraHttp.mock.calls.length === 1) return new Response(null, { status: 401 });
      return Response.json({ issues: [], isLast: true });
    });
    const jiraRefresh = vi.fn(async () => {
      await pool.query('SELECT id FROM jira_oauth_grants WHERE id = $1 FOR UPDATE NOWAIT', [candidateInput.jiraLookup.grantId]);
      return Response.json({
        access_token: 'jira-loopback-fresh-token', refresh_token: 'jira-loopback-fresh-refresh',
        expires_in: 3600, scope: 'read:jira-work',
      });
    });
    const getAdapterForService = vi.fn(async (service: string, context?: AdapterContext) => {
      if ((change === 'approved' || expect401 || change === 'grant-at-read-dispatch') && service === 'myjira') {
        if (change === 'grant-at-read-dispatch') {
          // Rotate after the runner validates the stored schedule, before Jira dispatch.
          await replaceGrant();
        }
        const tokenManager = new JiraTokenManager({
          pool, encryptionKey: ENCRYPTION_KEY,
          client: new JiraOAuthClient({
            clientId: 'fixture-client', clientSecret: 'fixture-secret', redirectUri: 'http://127.0.0.1/callback',
            mode: 'fixture', fixtureBaseUrl: 'http://127.0.0.1', fetchFn: jiraRefresh,
          }),
        });
        const leases = new JiraLeaseManager({ pool, tokenManager });
        const guard = new JiraDispatchGuard(pool, leases, tokenManager);
        if (change === 'grant-before-401-retry') {
          const dispatch = guard.executeGuardedDispatch.bind(guard);
          let dispatches = 0;
          vi.spyOn(guard, 'executeGuardedDispatch').mockImplementation(async (...args) => {
            if (++dispatches === 2) await replaceGrant();
            return dispatch(...args);
          });
        }
        const factory = new AdapterFactory({
          credentialRepo,
          encryptionKey: ENCRYPTION_KEY,
          jiraTokens: { getAccessToken: async () => 'unpinned-fixture-token' },
          jiraDispatchGuard: guard,
          jiraWorkspaceRepo: { getCapabilities: async () => ({
            workspaceId, sites: [{ siteId, cloudId, projects: [{ id: '10001', key: 'ATI' }] }],
          }) },
          serviceFetchFn: jiraHttp,
        });
        return factory.getAdapterForService(service, context);
      }
      return { execute: service === 'myjira' ? jiraRead : service === 'telegram' ? telegramSend : async () => [] };
    });
    const runner = new TelegramDigestRunner({
      pool, credentialRepo, encryptionKey: ENCRYPTION_KEY, timeZone: config.timeZone,
      adapterFactory: { getAdapterForService }, summarizeWithAi,
    });
    const result = await runner.execute({
      runId: run!.id, scheduleId: schedule!.id, scheduleVersion: schedule!.version,
      userId, name: 'Planora standup', request: 'Jira and Calendar', dueAt: NOW, trigger: 'scheduled',
      digestConfig: config, digestConfigHash: hash, workspaceMode: 'organization', workspaceId,
    }, AbortSignal.timeout(5000));

    if (change === 'legacy-unbound') {
      const replacementGrantId = await replaceGrant();
      await certifyScheduleFixture(pool, schedule!.id);
      await pool.query("UPDATE schedules SET status = 'paused', next_run_at = NULL WHERE id = $1", [schedule!.id]);
      const service = new ScheduleService({
        pool, encryptionKey: ENCRYPTION_KEY, timeZone: config.timeZone,
        jiraConnection: async () => ({ ...candidateInput.jiraLookup, grantId: replacementGrantId }),
      });
      const preview = await service.createReauthorizePreview({
        userId, scheduleId: schedule!.id, now: NOW,
        scope: { workspaceMode: 'organization', workspaceId },
      });
      expect(preview.candidate.config).toMatchObject({ sources: expect.arrayContaining([
        expect.objectContaining({
          service: 'myjira',
          jiraBinding: { grantId: replacementGrantId, atlassianAccountId: candidateInput.jiraLookup.atlassianAccountId },
        }),
      ]) });
      const confirmed = await service.confirmProposal({
        userId, convId: conversation!.id, messageId: preview.proposalMessageId,
        approvalMode: 'auto_digest', now: NOW, scope: { workspaceMode: 'organization', workspaceId },
      });
      expect(confirmed.schedule).toMatchObject({
        kind: 'telegram_digest',
        status: 'active',
        digestConfig: preview.candidate.config,
      });
    }
    if (change === 'approved' || change === 'approved-401-retry') {
      expect(result).toMatchObject({ status: 'digest_sent' });
      expect(getAdapterForService).toHaveBeenCalledWith('myjira', expect.objectContaining({
        phase: 'execution',
        workspaceId,
        jiraDigestBinding: {
          grantId: candidateInput.jiraLookup.grantId,
          atlassianAccountId: candidateInput.jiraLookup.atlassianAccountId,
        },
      }));
      const actualTokens = jiraHttp.mock.calls.map(([, request]) => new Headers(request?.headers).get('authorization'));
      expect(actualTokens).toEqual(change === 'approved-401-retry'
        ? ['Bearer jira-loopback-fixture', 'Bearer jira-loopback-fresh-token']
        : ['Bearer jira-loopback-fixture']);
      expect(jiraRefresh).toHaveBeenCalledTimes(change === 'approved-401-retry' ? 1 : 0);
      expect(summarizeWithAi).toHaveBeenCalledOnce();
      expect(telegramSend).toHaveBeenCalledOnce();
    } else {
      expect(result).toMatchObject({ status: 'blocked', pauseSchedule: true });
      expect(telegramSend).not.toHaveBeenCalled();
      if (change === 'grant-at-read-dispatch') {
        expect(getAdapterForService).toHaveBeenCalledWith('myjira', expect.anything());
        expect(jiraHttp).not.toHaveBeenCalled();
      }
      if (change === 'grant-before-401-retry') {
        expect(jiraHttp).toHaveBeenCalledOnce();
        expect(jiraRefresh).not.toHaveBeenCalled();
      }
      if (change === 'legacy-unbound' || change.endsWith('before-read')) {
        expect(getAdapterForService).not.toHaveBeenCalled();
      }
      if (change !== 'grant-after-ai') {
        expect(summarizeWithAi).not.toHaveBeenCalled();
      }
      const { rows: [receipt] } = await pool.query('SELECT delivery_started_at FROM schedule_runs WHERE id = $1', [run!.id]);
      expect(receipt?.delivery_started_at).toBeNull();
    }
  });
});
