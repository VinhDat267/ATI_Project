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

describe('PR-R1-C1: Digest Runner Live Scope, Membership & Telegram Binding Guard (C1-1..C1-6)', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;
  let credentialRepo: CredentialRepo;
  let workspaceRepo: WorkspaceRepo;

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema();
    await ctx.runAllMigrations();
    pool = ctx.pool;
    credentialRepo = new CredentialRepo(pool);
    workspaceRepo = new WorkspaceRepo(pool);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function seedDigestSchedule(options: {
    userId: string;
    workspaceId: string | null;
    workspaceMode: 'personal' | 'organization';
    kind: 'github_digest' | 'telegram_digest';
    digestConfig: Record<string, unknown>;
  }): Promise<string> {
    const convId = randomUUID();
    await pool.query(
      `INSERT INTO conversations (id, user_id, status, workspace_id, workspace_mode)
       VALUES ($1, $2, 'chatting', $3, $4)`,
      [convId, options.userId, options.workspaceId, options.workspaceMode],
    );
    const scheduleId = randomUUID();
    const cfgJson = JSON.stringify(options.digestConfig);
    const cfgHash = createHash('sha256').update(cfgJson).digest('hex');
    const recurrenceJson = JSON.stringify({ type: 'daily', time: '09:00' });
    await pool.query(
      `INSERT INTO schedules (
         id, conv_id, user_id, workspace_id, workspace_mode,
         name, request, services, recurrence, status, next_run_at,
         kind, digest_config, digest_config_hash, digest_approved_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         'Daily Digest', 'Daily digest', ARRAY['github'], $6::jsonb, 'active', now() + interval '1 day',
         $7, $8::jsonb, $9, now()
       )`,
      [
        scheduleId,
        convId,
        options.userId,
        options.workspaceId,
        options.workspaceMode,
        recurrenceJson,
        options.kind,
        cfgJson,
        cfgHash,
      ],
    );
    return scheduleId;
  }

  it('C1-1: reads trusted workspace_mode and workspace_id from schedules DB row instead of caller-supplied claimedWorkspaceId', async () => {
    const ownerId = await createSyntheticUser(pool, 'C1 Owner', 'c1-owner');
    const wsAlpha = await workspaceRepo.create(ownerId, 'C1 Alpha');
    const scheduleId = await seedDigestSchedule({
      userId: ownerId,
      workspaceId: wsAlpha.id,
      workspaceMode: 'organization',
      kind: 'github_digest',
      digestConfig: {},
    });

    const res = await assertDigestScheduleLiveScopeAndAuth({
      pool,
      scheduleId,
      claimedWorkspaceId: 'untrusted_caller_ws_override',
    });
    expect(res.allowed).toBe(true);
    expect(res.trustedWorkspaceId).toBe(wsAlpha.id);
    expect(res.trustedWorkspaceMode).toBe('organization');
  });

  it('C1-2: rejects digest execution when schedule owner is disabled or workspace membership is revoked', async () => {
    const ownerId = await createSyntheticUser(pool, 'C1 Org Owner', 'c1-org-owner');
    const memberId = await createSyntheticUser(pool, 'C1 Member', 'c1-member');
    const ws = await workspaceRepo.create(ownerId, 'C1 Org');
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'disabled')`,
      [ws.id, memberId],
    );
    const scheduleId = await seedDigestSchedule({
      userId: memberId,
      workspaceId: ws.id,
      workspaceMode: 'organization',
      kind: 'github_digest',
      digestConfig: { repo: 'alpha-org/alpha-repo' },
    });

    const res = await assertDigestScheduleLiveScopeAndAuth({ pool, scheduleId });
    expect(res.allowed).toBe(false);
    expect(res.code).toBe('DIGEST_WORKSPACE_MEMBER_REVOKED');
  });

  it('C1-3: rejects digest execution when pinned repository/resource was removed from live workspace scope', async () => {
    const ownerId = await createSyntheticUser(pool, 'C1 Scope Owner', 'c1-scope');
    const ws = await workspaceRepo.create(ownerId, 'C1 Scope Org');
    const scheduleId = await seedDigestSchedule({
      userId: ownerId,
      workspaceId: ws.id,
      workspaceMode: 'organization',
      kind: 'github_digest',
      digestConfig: { repo: 'alpha-org/revoked-repo' },
    });

    const res = await assertDigestScheduleLiveScopeAndAuth({ pool, scheduleId });
    expect(res.allowed).toBe(false);
    expect(res.code).toBe('DIGEST_SCOPE_REVOKED');
  });

  it('C1-4: rejects digest execution when pinned or owner credential is revoked/reconnect_required', async () => {
    const ownerId = await createSyntheticUser(pool, 'C1 Cred Owner', 'c1-cred');
    const enc = encryptCredentials(
      { accessToken: 'gho_revoked', login: 'c1cred', githubUserId: '9001', connectedAt: new Date().toISOString() },
      ENCRYPTION_KEY,
    );
    const cred = await credentialRepo.saveCredentials('github', enc, ownerId);
    await credentialRepo.markReconnectRequired('github', ownerId, cred.id);

    const scheduleId = await seedDigestSchedule({
      userId: ownerId,
      workspaceId: null,
      workspaceMode: 'personal',
      kind: 'github_digest',
      digestConfig: { repo: 'alpha-org/alpha-repo', credentialId: cred.id },
    });

    const res = await assertDigestScheduleLiveScopeAndAuth({ pool, scheduleId });
    expect(res.allowed).toBe(false);
    expect(res.code).toBe('DIGEST_CREDENTIAL_INACTIVE');
  });

  it('C1-5: binds Telegram credentialId, chatId, and telegramUserId from verified schedule + live scope', async () => {
    const ownerId = await createSyntheticUser(pool, 'C1 Telegram Owner', 'c1-tg');
    const scheduleId = await seedDigestSchedule({
      userId: ownerId,
      workspaceId: null,
      workspaceMode: 'personal',
      kind: 'telegram_digest',
      digestConfig: {
        chatId: '-1001234567890',
        credentialId: 'cred_tg_pinned_1',
        telegramUserId: 'tg_user_99',
      },
    });

    const ctxRes = await buildPinnedTelegramAdapterContext({ pool, scheduleId });
    expect(ctxRes.allowed).toBe(true);
    expect(ctxRes.credentialId).toBe('cred_tg_pinned_1');
    expect(ctxRes.chatId).toBe('-1001234567890');
    expect(ctxRes.telegramUserId).toBe('tg_user_99');
  });

  it('C1-6: rejects cross-tenant schedule attempting to read or deliver using another workspace scope or credential', async () => {
    const ownerAlpha = await createSyntheticUser(pool, 'C1 Tenant Alpha', 'c1-t-alpha');
    const ownerBeta = await createSyntheticUser(pool, 'C1 Tenant Beta', 'c1-t-beta');
    const wsAlpha = await workspaceRepo.create(ownerAlpha, 'Tenant Alpha WS');
    const wsBeta = await workspaceRepo.create(ownerBeta, 'Tenant Beta WS');

    const scheduleId = await seedDigestSchedule({
      userId: ownerAlpha,
      workspaceId: wsAlpha.id,
      workspaceMode: 'organization',
      kind: 'github_digest',
      digestConfig: { repo: 'beta-org/beta-secret-repo', targetWorkspaceId: wsBeta.id },
    });

    const res = await assertDigestScheduleLiveScopeAndAuth({ pool, scheduleId });
    expect(res.allowed).toBe(false);
    expect(res.code).toMatch(/DIGEST_CROSS_TENANT_SCOPE_MISMATCH|DIGEST_SCOPE_REVOKED/);
  });
});
