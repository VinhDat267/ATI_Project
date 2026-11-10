import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import type pg from 'pg';
import { encryptCredentials } from '@wap/tool-adapters';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { WorkspaceRepo } from '../../src/db/repositories/workspace-repo.js';
import {
  assertDigestScheduleLiveScopeAndAuth,
  buildPinnedTelegramAdapterContext,
} from '../../src/services/schedules/digest-scope-guard.js';

const ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEAM_CHAT = '-1001234567890';
const TG_USER = '99001';

describe('PR-R1-C1: Digest Runner Live Scope, Membership & Telegram Binding Guard', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;
  let credentialRepo: CredentialRepo;
  let workspaceRepo: WorkspaceRepo;

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema();
    await ctx.runAllMigrations();
    pool = ctx.pool;
    credentialRepo = new CredentialRepo(pool, ENCRYPTION_KEY);
    workspaceRepo = new WorkspaceRepo(pool);
    // Test-only, isolated schema: emulate the post-0034 (PR-R1-A1) shape in which github scope rows are
    // keyed by Planora workspace UUID. On main the CHECK pins id = 'default', so no workspace scope can exist.
    await pool.query('ALTER TABLE github_team_repos DROP CONSTRAINT IF EXISTS github_team_repos_scope_id_check');
    await pool.query('ALTER TABLE github_team_scope DROP CONSTRAINT IF EXISTS github_team_scope_id_check');
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function githubCredential(userId: string): Promise<string> {
    const enc = encryptCredentials(
      { accessToken: 'gho_test', login: `gh_${userId.slice(0, 6)}`, githubUserId: '1001', connectedAt: new Date().toISOString() },
      ENCRYPTION_KEY,
    );
    return (await credentialRepo.saveCredentials('github', enc, userId)).id;
  }

  async function telegramCredential(userId: string, opts: { telegramUserId?: string; chats?: string[] } = {}): Promise<string> {
    const enc = encryptCredentials(
      {
        telegramUserId: opts.telegramUserId ?? TG_USER,
        username: 'tgowner',
        selectedChats: (opts.chats ?? [TEAM_CHAT]).map((chatId) => ({ chatId, title: 'Team' })),
        connectedAt: new Date().toISOString(),
      },
      ENCRYPTION_KEY,
    );
    return (await credentialRepo.saveCredentials('telegram', enc, userId)).id;
  }

  async function trelloCredential(userId: string): Promise<string> {
    const enc = encryptCredentials({ token: 't', memberId: 'm', username: 'u' }, ENCRYPTION_KEY);
    return (await credentialRepo.saveCredentials('trello', enc, userId)).id;
  }

  async function setWorkspaceGithubScope(workspaceId: string, chosenBy: string, repos: string[]) {
    await pool.query('DELETE FROM github_team_scope WHERE id = $1', [workspaceId]);
    if (!repos.length) return;
    await pool.query('INSERT INTO github_team_scope (id, chosen_by) VALUES ($1, $2)', [workspaceId, chosenBy]);
    for (const [i, fullName] of repos.entries()) {
      await pool.query(
        'INSERT INTO github_team_repos (scope_id, repo_id, full_name, name, position) VALUES ($1, $2, $3, $4, $5)',
        [workspaceId, String(100 + i), fullName, fullName.split('/')[1], i + 1],
      );
    }
  }

  async function seedDigestSchedule(options: {
    userId: string;
    workspaceId: string | null;
    workspaceMode: 'personal' | 'organization';
    kind: 'github_digest' | 'telegram_digest' | 'calendar_digest' | 'trello_digest';
    digestConfig: Record<string, unknown>;
  }): Promise<string> {
    const convId = randomUUID();
    await pool.query(
      `INSERT INTO conversations (id, user_id, status, workspace_id, workspace_mode) VALUES ($1, $2, 'chatting', $3, $4)`,
      [convId, options.userId, options.workspaceId, options.workspaceMode],
    );
    const scheduleId = randomUUID();
    const cfgJson = JSON.stringify(options.digestConfig);
    await pool.query(
      `INSERT INTO schedules (
         id, conv_id, user_id, workspace_id, workspace_mode,
         name, request, services, recurrence, status, next_run_at,
         kind, digest_config, digest_config_hash, digest_approved_at
       ) VALUES ($1, $2, $3, $4, $5, 'Daily Digest', 'Daily digest', ARRAY['github'], $6::jsonb, 'active',
                 now() + interval '1 day', $7, $8::jsonb, $9, now())`,
      [
        scheduleId, convId, options.userId, options.workspaceId, options.workspaceMode,
        JSON.stringify({ type: 'daily', time: '09:00' }), options.kind, cfgJson,
        createHash('sha256').update(cfgJson).digest('hex'),
      ],
    );
    return scheduleId;
  }

  const guard = (scheduleId: string, claimedWorkspaceId?: string) =>
    assertDigestScheduleLiveScopeAndAuth({ pool, scheduleId, claimedWorkspaceId });
  const tgContext = (scheduleId: string) =>
    buildPinnedTelegramAdapterContext({ pool, scheduleId, encryptionKey: ENCRYPTION_KEY });

  describe('workspace, membership and cross-tenant', () => {
    it('C1-1: reads trusted workspace_mode and workspace_id from the schedules row, not caller input', async () => {
      const ownerId = await createSyntheticUser(pool, 'C1 Owner', 'c1-owner');
      const ws = await workspaceRepo.create(ownerId, 'C1 Alpha');
      await setWorkspaceGithubScope(ws.id, ownerId, ['alpha-org/alpha-repo']);
      const scheduleId = await seedDigestSchedule({
        userId: ownerId, workspaceId: ws.id, workspaceMode: 'organization', kind: 'github_digest',
        digestConfig: { credentialId: await githubCredential(ownerId), repos: ['alpha-org/alpha-repo'] },
      });
      const res = await guard(scheduleId, 'untrusted_caller_ws_override');
      expect(res).toMatchObject({ allowed: true, trustedWorkspaceId: ws.id, trustedWorkspaceMode: 'organization' });
    });

    it('C1-2: rejects when workspace membership is revoked', async () => {
      const ownerId = await createSyntheticUser(pool, 'C1 Org Owner', 'c1-org-owner');
      const memberId = await createSyntheticUser(pool, 'C1 Member', 'c1-member');
      const ws = await workspaceRepo.create(ownerId, 'C1 Org');
      await pool.query(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'disabled')`, [ws.id, memberId]);
      const scheduleId = await seedDigestSchedule({
        userId: memberId, workspaceId: ws.id, workspaceMode: 'organization', kind: 'github_digest',
        digestConfig: { credentialId: await githubCredential(memberId), repos: ['alpha-org/alpha-repo'] },
      });
      expect(await guard(scheduleId)).toMatchObject({ allowed: false, code: 'DIGEST_WORKSPACE_MEMBER_REVOKED' });
    });

    it('C1-6: rejects a schedule whose config references another workspace', async () => {
      const ownerA = await createSyntheticUser(pool, 'C1 Tenant Alpha', 'c1-t-alpha');
      const ownerB = await createSyntheticUser(pool, 'C1 Tenant Beta', 'c1-t-beta');
      const wsA = await workspaceRepo.create(ownerA, 'Tenant Alpha WS');
      const wsB = await workspaceRepo.create(ownerB, 'Tenant Beta WS');
      const scheduleId = await seedDigestSchedule({
        userId: ownerA, workspaceId: wsA.id, workspaceMode: 'organization', kind: 'github_digest',
        digestConfig: { credentialId: await githubCredential(ownerA), repos: ['beta-org/secret'], targetWorkspaceId: wsB.id },
      });
      expect(await guard(scheduleId)).toMatchObject({ allowed: false, code: 'DIGEST_CROSS_TENANT_SCOPE_MISMATCH' });
    });
  });

  describe('C1-01: organization GitHub scope never falls back to the legacy default scope', () => {
    it('C1-3: rejects when the pinned repo was removed from the live workspace scope', async () => {
      const ownerId = await createSyntheticUser(pool, 'C1 Scope Owner', 'c1-scope');
      const ws = await workspaceRepo.create(ownerId, 'C1 Scope Org');
      await setWorkspaceGithubScope(ws.id, ownerId, ['alpha-org/kept-repo']);
      const scheduleId = await seedDigestSchedule({
        userId: ownerId, workspaceId: ws.id, workspaceMode: 'organization', kind: 'github_digest',
        digestConfig: { credentialId: await githubCredential(ownerId), repos: ['alpha-org/revoked-repo'] },
      });
      expect(await guard(scheduleId)).toMatchObject({ allowed: false, code: 'DIGEST_SCOPE_REVOKED' });
    });

    it('C1-7: owner in orgs A and B with legacy default repos: A repos are not authorized scope for B', async () => {
      const ownerId = await createSyntheticUser(pool, 'Two-Org Owner', 'c1-two-org');
      const otherAdmin = await createSyntheticUser(pool, 'Org B Admin', 'c1-orgb-admin');
      const wsA = await workspaceRepo.create(ownerId, 'Org A');
      const wsB = await workspaceRepo.create(otherAdmin, 'Org B');
      await pool.query(`INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'admin', 'active')`, [wsB.id, ownerId]);
      // Legacy global default scope chosen by the same owner, containing org A's repo.
      await pool.query(`INSERT INTO github_team_scope (id, chosen_by) VALUES ('default', $1) ON CONFLICT (id) DO UPDATE SET chosen_by = EXCLUDED.chosen_by`, [ownerId]);
      await pool.query(`DELETE FROM github_team_repos WHERE scope_id = 'default'`);
      await pool.query(`INSERT INTO github_team_repos (scope_id, repo_id, full_name, name, position) VALUES ('default', '1', 'alpha-org/a-repo', 'a-repo', 1)`);
      await setWorkspaceGithubScope(wsA.id, ownerId, ['alpha-org/a-repo']);
      const credentialId = await githubCredential(ownerId);

      const inA = await seedDigestSchedule({
        userId: ownerId, workspaceId: wsA.id, workspaceMode: 'organization', kind: 'github_digest',
        digestConfig: { credentialId, repos: ['alpha-org/a-repo'] },
      });
      expect(await guard(inA)).toMatchObject({ allowed: true, trustedWorkspaceId: wsA.id });

      const inB = await seedDigestSchedule({
        userId: ownerId, workspaceId: wsB.id, workspaceMode: 'organization', kind: 'github_digest',
        digestConfig: { credentialId, repos: ['alpha-org/a-repo'] },
      });
      // B has no scope of its own: the legacy default (and org A) must not authorize it.
      expect(await guard(inB)).toMatchObject({ allowed: false, code: 'DIGEST_SCOPE_NOT_CONFIGURED' });
      // B configures its own scope without A's repo: still rejected.
      await setWorkspaceGithubScope(wsB.id, otherAdmin, ['beta-org/b-repo']);
      expect(await guard(inB)).toMatchObject({ allowed: false, code: 'DIGEST_SCOPE_REVOKED' });
    });

    it('C1-8: legacy default scope alone never authorizes an organization digest (scope not configured)', async () => {
      const ownerId = await createSyntheticUser(pool, 'Legacy Only', 'c1-legacy-only');
      const ws = await workspaceRepo.create(ownerId, 'Legacy Only Org');
      await pool.query(`INSERT INTO github_team_scope (id, chosen_by) VALUES ('default', $1) ON CONFLICT (id) DO UPDATE SET chosen_by = EXCLUDED.chosen_by`, [ownerId]);
      await pool.query(`INSERT INTO github_team_repos (scope_id, repo_id, full_name, name, position) VALUES ('default', '9', 'legacy-org/l-repo', 'l-repo', 2) ON CONFLICT DO NOTHING`);
      const scheduleId = await seedDigestSchedule({
        userId: ownerId, workspaceId: ws.id, workspaceMode: 'organization', kind: 'github_digest',
        digestConfig: { credentialId: await githubCredential(ownerId), repos: ['legacy-org/l-repo'] },
      });
      expect(await guard(scheduleId)).toMatchObject({ allowed: false, code: 'DIGEST_SCOPE_NOT_CONFIGURED' });
    });

    it('C1-9: workspace scope revoked entirely after approval fails closed', async () => {
      const ownerId = await createSyntheticUser(pool, 'Revoked Scope', 'c1-rev-scope');
      const ws = await workspaceRepo.create(ownerId, 'Revoked Scope Org');
      await setWorkspaceGithubScope(ws.id, ownerId, ['alpha-org/x']);
      const scheduleId = await seedDigestSchedule({
        userId: ownerId, workspaceId: ws.id, workspaceMode: 'organization', kind: 'github_digest',
        digestConfig: { credentialId: await githubCredential(ownerId), repos: ['alpha-org/x'] },
      });
      expect((await guard(scheduleId)).allowed).toBe(true);
      await setWorkspaceGithubScope(ws.id, ownerId, []);
      expect(await guard(scheduleId)).toMatchObject({ allowed: false, code: 'DIGEST_SCOPE_NOT_CONFIGURED' });
    });
  });

  describe('C1-02: pinned credential validation fails closed', () => {
    const personalGithub = async (userId: string, credentialId: unknown) =>
      seedDigestSchedule({
        userId, workspaceId: null, workspaceMode: 'personal', kind: 'github_digest',
        digestConfig: { ...(credentialId === undefined ? {} : { credentialId }), repos: ['me/repo'] },
      });

    it('C1-4: rejects a reconnect_required (revoked) credential', async () => {
      const ownerId = await createSyntheticUser(pool, 'C1 Cred Owner', 'c1-cred');
      const credId = await githubCredential(ownerId);
      await credentialRepo.markReconnectRequired('github', ownerId, credId);
      expect(await guard(await personalGithub(ownerId, credId))).toMatchObject({ allowed: false, code: 'DIGEST_CREDENTIAL_INACTIVE' });
    });

    it('C1-10: rejects a missing credentialId', async () => {
      const ownerId = await createSyntheticUser(pool, 'Missing Cred', 'c1-missing');
      expect(await guard(await personalGithub(ownerId, undefined))).toMatchObject({ allowed: false, code: 'DIGEST_CREDENTIAL_INVALID' });
    });

    it('C1-11: rejects a malformed (non-UUID) credentialId', async () => {
      const ownerId = await createSyntheticUser(pool, 'Malformed Cred', 'c1-malformed');
      expect(await guard(await personalGithub(ownerId, 'cred-gh-1'))).toMatchObject({ allowed: false, code: 'DIGEST_CREDENTIAL_INVALID' });
    });

    it('C1-12: rejects a well-formed UUID that does not exist', async () => {
      const ownerId = await createSyntheticUser(pool, 'Nonexistent Cred', 'c1-nonexist');
      expect(await guard(await personalGithub(ownerId, randomUUID()))).toMatchObject({ allowed: false, code: 'DIGEST_CREDENTIAL_INVALID' });
    });

    it('C1-13: rejects a stale pin after the owner reconnected (new credential row)', async () => {
      const ownerId = await createSyntheticUser(pool, 'Stale Pin', 'c1-stale');
      const oldId = await githubCredential(ownerId);
      const newId = await githubCredential(ownerId);
      expect(newId).not.toBe(oldId);
      expect(await guard(await personalGithub(ownerId, oldId))).toMatchObject({ allowed: false, code: 'DIGEST_CREDENTIAL_INVALID' });
      expect((await guard(await personalGithub(ownerId, newId))).allowed).toBe(true);
    });

    it('C1-14: rejects a credential of the wrong service', async () => {
      const ownerId = await createSyntheticUser(pool, 'Wrong Service', 'c1-wrong-svc');
      expect(await guard(await personalGithub(ownerId, await trelloCredential(ownerId)))).toMatchObject({
        allowed: false, code: 'DIGEST_CREDENTIAL_SERVICE_MISMATCH',
      });
    });

    it('C1-15: rejects a credential owned by another tenant', async () => {
      const ownerId = await createSyntheticUser(pool, 'Tenant Owner', 'c1-tenant-own');
      const otherId = await createSyntheticUser(pool, 'Tenant Other', 'c1-tenant-oth');
      expect(await guard(await personalGithub(ownerId, await githubCredential(otherId)))).toMatchObject({
        allowed: false, code: 'DIGEST_CROSS_TENANT_SCOPE_MISMATCH',
      });
    });
  });

  describe('Telegram pinned context matches the live connection', () => {
    const tgSchedule = (userId: string, cfg: Record<string, unknown>) =>
      seedDigestSchedule({ userId, workspaceId: null, workspaceMode: 'personal', kind: 'telegram_digest', digestConfig: cfg });

    it('C1-5: binds credentialId, chatId and telegramUserId from a real active credential', async () => {
      const ownerId = await createSyntheticUser(pool, 'C1 Telegram Owner', 'c1-tg');
      const credentialId = await telegramCredential(ownerId);
      const res = await tgContext(await tgSchedule(ownerId, { credentialId, telegramUserId: TG_USER, chatId: TEAM_CHAT, username: 'tgowner' }));
      expect(res).toMatchObject({ allowed: true, credentialId, chatId: TEAM_CHAT, telegramUserId: TG_USER });
    });

    it('C1-16: rejects a revoked Telegram credential', async () => {
      const ownerId = await createSyntheticUser(pool, 'TG Revoked', 'c1-tg-rev');
      const credentialId = await telegramCredential(ownerId);
      await credentialRepo.markReconnectRequired('telegram', ownerId, credentialId);
      const res = await tgContext(await tgSchedule(ownerId, { credentialId, telegramUserId: TG_USER, chatId: TEAM_CHAT }));
      expect(res).toMatchObject({ allowed: false, code: 'DIGEST_CREDENTIAL_INACTIVE' });
    });

    it('C1-17: rejects a non-Telegram credential pinned as Telegram', async () => {
      const ownerId = await createSyntheticUser(pool, 'TG Wrong Svc', 'c1-tg-svc');
      const res = await tgContext(await tgSchedule(ownerId, { credentialId: await githubCredential(ownerId), telegramUserId: TG_USER, chatId: TEAM_CHAT }));
      expect(res).toMatchObject({ allowed: false, code: 'DIGEST_CREDENTIAL_SERVICE_MISMATCH' });
    });

    it('C1-18: rejects another tenant\'s Telegram credential', async () => {
      const ownerId = await createSyntheticUser(pool, 'TG Owner', 'c1-tg-own');
      const otherId = await createSyntheticUser(pool, 'TG Other', 'c1-tg-oth');
      const res = await tgContext(await tgSchedule(ownerId, { credentialId: await telegramCredential(otherId), telegramUserId: TG_USER, chatId: TEAM_CHAT }));
      expect(res).toMatchObject({ allowed: false, code: 'DIGEST_CROSS_TENANT_SCOPE_MISMATCH' });
    });

    it('C1-19: rejects a chat that is no longer in the live chat allowlist', async () => {
      const ownerId = await createSyntheticUser(pool, 'TG Wrong Chat', 'c1-tg-chat');
      const credentialId = await telegramCredential(ownerId, { chats: ['-1005550000'] });
      const res = await tgContext(await tgSchedule(ownerId, { credentialId, telegramUserId: TG_USER, chatId: TEAM_CHAT }));
      expect(res).toMatchObject({ allowed: false, code: 'DIGEST_TELEGRAM_CHAT_NOT_ALLOWED' });
    });

    it('C1-20: rejects when the pinned Telegram user differs from the live identity', async () => {
      const ownerId = await createSyntheticUser(pool, 'TG Identity', 'c1-tg-id');
      const credentialId = await telegramCredential(ownerId, { telegramUserId: '99002' });
      const res = await tgContext(await tgSchedule(ownerId, { credentialId, telegramUserId: TG_USER, chatId: TEAM_CHAT }));
      expect(res).toMatchObject({ allowed: false, code: 'DIGEST_TELEGRAM_IDENTITY_MISMATCH' });
    });

    it('C1-21: rejects missing and stale Telegram credential pins', async () => {
      const ownerId = await createSyntheticUser(pool, 'TG Stale', 'c1-tg-stale');
      expect(await tgContext(await tgSchedule(ownerId, { telegramUserId: TG_USER, chatId: TEAM_CHAT }))).toMatchObject({
        allowed: false, code: 'DIGEST_CREDENTIAL_INVALID',
      });
      const oldId = await telegramCredential(ownerId);
      await telegramCredential(ownerId);
      expect(await tgContext(await tgSchedule(ownerId, { credentialId: oldId, telegramUserId: TG_USER, chatId: TEAM_CHAT }))).toMatchObject({
        allowed: false, code: 'DIGEST_CREDENTIAL_INVALID',
      });
    });
  });

  describe('independent-review gap coverage', () => {
    it('C1-22: rejects when the schedule owner is no longer active', async () => {
      const ownerId = await createSyntheticUser(pool, 'Disabled Owner', 'c1-disabled');
      const scheduleId = await seedDigestSchedule({
        userId: ownerId, workspaceId: null, workspaceMode: 'personal', kind: 'github_digest',
        digestConfig: { credentialId: await githubCredential(ownerId), repos: ['me/repo'] },
      });
      await pool.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [ownerId]);
      expect(await guard(scheduleId)).toMatchObject({ allowed: false, code: 'DIGEST_USER_INACTIVE' });
    });

    it('C1-23: rejects a same-owner credential that is workspace-owned rather than personal', async () => {
      const ownerId = await createSyntheticUser(pool, 'WS Cred Owner', 'c1-ws-cred');
      const ws = await workspaceRepo.create(ownerId, 'WS Cred Org');
      const credId = (
        await pool.query(
          `INSERT INTO service_credentials (service, user_id, workspace_id, config, status) VALUES ('github', $1, $2, 'fixture', 'active') RETURNING id`,
          [ownerId, ws.id],
        )
      ).rows[0].id;
      const scheduleId = await seedDigestSchedule({
        userId: ownerId, workspaceId: null, workspaceMode: 'personal', kind: 'github_digest',
        digestConfig: { credentialId: credId, repos: ['me/repo'] },
      });
      expect(await guard(scheduleId)).toMatchObject({ allowed: false, code: 'DIGEST_CROSS_TENANT_SCOPE_MISMATCH' });
    });

    it('C1-24: github_digest to Telegram requires a valid, owned, active telegramCredentialId', async () => {
      const ownerId = await createSyntheticUser(pool, 'GH to TG', 'c1-gh-tg');
      const otherId = await createSyntheticUser(pool, 'GH to TG other', 'c1-gh-tg-o');
      const gh = await githubCredential(ownerId);
      const seed = (extra: Record<string, unknown>) =>
        seedDigestSchedule({
          userId: ownerId, workspaceId: null, workspaceMode: 'personal', kind: 'github_digest',
          digestConfig: { credentialId: gh, repos: ['me/repo'], telegramChatId: TEAM_CHAT, telegramUserId: TG_USER, ...extra },
        });
      expect(await guard(await seed({}))).toMatchObject({ allowed: false, code: 'DIGEST_CREDENTIAL_INVALID' });
      expect(await guard(await seed({ telegramCredentialId: await telegramCredential(otherId) }))).toMatchObject({
        allowed: false, code: 'DIGEST_CROSS_TENANT_SCOPE_MISMATCH',
      });
      const tg = await telegramCredential(ownerId);
      expect((await guard(await seed({ telegramCredentialId: tg }))).allowed).toBe(true);
      await credentialRepo.markReconnectRequired('telegram', ownerId, tg);
      expect(await guard(await seed({ telegramCredentialId: tg }))).toMatchObject({ allowed: false, code: 'DIGEST_CREDENTIAL_INACTIVE' });
    });

    it('C1-25: calendar_digest and trello_digest pins are validated against their own service', async () => {
      const ownerId = await createSyntheticUser(pool, 'Cal Trello', 'c1-cal-trello');
      const calId = (
        await credentialRepo.saveCredentials('mycalendar', encryptCredentials({ email: 'a@example.test' }, ENCRYPTION_KEY), ownerId)
      ).id;
      const trelloId = await trelloCredential(ownerId);
      const cal = (credentialId: unknown) =>
        seedDigestSchedule({ userId: ownerId, workspaceId: null, workspaceMode: 'personal', kind: 'calendar_digest', digestConfig: { credentialId } });
      const trello = (credentialId: unknown) =>
        seedDigestSchedule({ userId: ownerId, workspaceId: null, workspaceMode: 'personal', kind: 'trello_digest', digestConfig: { credentialId } });
      expect((await guard(await cal(calId))).allowed).toBe(true);
      expect(await guard(await cal(trelloId))).toMatchObject({ allowed: false, code: 'DIGEST_CREDENTIAL_SERVICE_MISMATCH' });
      expect((await guard(await trello(trelloId))).allowed).toBe(true);
      expect(await guard(await trello('cred-trello-1'))).toMatchObject({ allowed: false, code: 'DIGEST_CREDENTIAL_INVALID' });
    });

    it('C1-26: Telegram context fails closed for a non-telegram kind, missing key, or undecryptable config', async () => {
      const ownerId = await createSyntheticUser(pool, 'TG Ctx Edge', 'c1-tg-edge');
      const gh = await seedDigestSchedule({
        userId: ownerId, workspaceId: null, workspaceMode: 'personal', kind: 'github_digest',
        digestConfig: { credentialId: await githubCredential(ownerId), repos: ['me/repo'] },
      });
      expect(await tgContext(gh)).toMatchObject({ allowed: false, code: 'DIGEST_TELEGRAM_CONTEXT_INVALID' });

      const credentialId = await telegramCredential(ownerId);
      const tg = await seedDigestSchedule({
        userId: ownerId, workspaceId: null, workspaceMode: 'personal', kind: 'telegram_digest',
        digestConfig: { credentialId, telegramUserId: TG_USER, chatId: TEAM_CHAT },
      });
      expect(await buildPinnedTelegramAdapterContext({ pool, scheduleId: tg, encryptionKey: '' })).toMatchObject({
        allowed: false, code: 'DIGEST_TELEGRAM_CONTEXT_INVALID',
      });
      await pool.query(`UPDATE service_credentials SET config = 'not-ciphertext' WHERE id = $1`, [credentialId]);
      expect(await tgContext(tg)).toMatchObject({ allowed: false, code: 'DIGEST_TELEGRAM_CONTEXT_INVALID' });
    });
  });
});