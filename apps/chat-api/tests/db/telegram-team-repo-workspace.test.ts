import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { encryptCredentials } from '@wap/tool-adapters';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { TelegramTeamRepo } from '../../src/db/repositories/telegram-team-repo.js';
import { WorkspaceRepo } from '../../src/db/repositories/workspace-repo.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const JWT_SECRET = 'telegram_team_ws_isolation_secret_at_least_32_chars';
const ENC_KEY = '0123456789abcdef0123456789abcdef';

describe('Per-workspace TelegramTeamRepo & routes scope isolation (Task 6)', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let teamRepo: TelegramTeamRepo;
  let workspaceRepo: WorkspaceRepo;
  let credRepo: CredentialRepo;

  beforeAll(async () => {
    db = await createMigratedSchema('tg_team_ws');
    teamRepo = new TelegramTeamRepo(db.pool);
    workspaceRepo = new WorkspaceRepo(db.pool);
    credRepo = new CredentialRepo(db.pool, ENC_KEY);
  }, 30_000);

  afterAll(async () => {
    await db?.close();
  });

  beforeEach(async () => {
    await db.pool.query(
      'TRUNCATE telegram_team_chats, telegram_team_scope, workspace_members, workspaces, service_credentials, oauth_states CASCADE',
    );
  });

  it('stores isolated telegram_team_scope rows per organization workspaceId vs default', async () => {
    const admin = await db.person('TG Admin');
    const wsA = await workspaceRepo.create(admin.id, 'Workspace A');
    const wsB = await workspaceRepo.create(admin.id, 'Workspace B');

    await teamRepo.replace({
      scopeId: 'default',
      chosenBy: admin.id,
      chats: [{ chatId: '-100111', title: 'Legacy Default Group', type: 'supergroup' }],
    });
    await teamRepo.replace({
      scopeId: wsA.id,
      chosenBy: admin.id,
      chats: [{ chatId: '-100222', title: 'Workspace A Group', type: 'supergroup' }],
    });
    await teamRepo.replace({
      scopeId: wsB.id,
      chosenBy: admin.id,
      chats: [{ chatId: '-100333', title: 'Workspace B Group', type: 'group' }],
    });

    expect((await teamRepo.get('default'))?.chats).toEqual([
      { chatId: '-100111', title: 'Legacy Default Group', type: 'supergroup' },
    ]);
    expect((await teamRepo.get(wsA.id))?.chats).toEqual([
      { chatId: '-100222', title: 'Workspace A Group', type: 'supergroup' },
    ]);
    expect((await teamRepo.get(wsB.id))?.chats).toEqual([
      { chatId: '-100333', title: 'Workspace B Group', type: 'group' },
    ]);
  });

  it('serializes replacements of the same workspace scope without merging their chat lists', async () => {
    const admin = await db.person('Concurrent scope admin');
    const workspace = await workspaceRepo.create(admin.id, 'Concurrent scope');
    const replacement = (chatId: string) => ({
      scopeId: workspace.id,
      chosenBy: admin.id,
      chats: [{ chatId, title: chatId, type: 'group' as const }],
    });
    await teamRepo.replace(replacement('-101'));

    const blocker = await db.pool.connect();
    let writes: ReturnType<typeof teamRepo.replace>[] = [];
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT 1 FROM telegram_team_chats WHERE scope_id = $1 FOR UPDATE', [workspace.id]);
      writes = [teamRepo.replace(replacement('-102')), teamRepo.replace(replacement('-103'))];
      await vi.waitFor(async () => {
        const { rows: [{ waiting }] } = await db.pool.query(`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND (query LIKE 'DELETE FROM telegram_team_chats%' OR query LIKE 'INSERT INTO telegram_team_scope%')
        `);
        expect(waiting).toBe(2);
      }, { timeout: 2_000, interval: 20 });
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await Promise.all(writes);
    }

    const scope = await teamRepo.get(workspace.id);
    expect(scope?.chats).toHaveLength(1);
    expect(['-102', '-103']).toContain(scope?.chats[0]?.chatId);
  });

  it('routes/connections/telegram passes req.workspace.workspaceId to TelegramTeamRepo in organization mode', async () => {
    const admin = await db.person('Org Route Admin');
    const wsA = await workspaceRepo.create(admin.id, 'Org A');
    const wsB = await workspaceRepo.create(admin.id, 'Org B');
    const token = `Bearer ${generateAccessToken({ ...admin, role: 'admin' }, JWT_SECRET, admin.sid).accessToken}`;

    await credRepo.saveCredentials(
      'telegram',
      encryptCredentials(
        {
          telegramUserId: '5001',
          username: 'tgadmin',
          displayName: 'TG Admin',
          selectedChats: [{ chatId: '5001', title: 'Private', type: 'private' }],
          knownChats: [
            { chatId: '5001', title: 'Private', type: 'private' },
            { chatId: '-100701', title: 'Group A Only', type: 'supergroup' },
            { chatId: '-100702', title: 'Group B Only', type: 'supergroup' },
          ],
        },
        ENC_KEY,
      ),
      admin.id,
    );

    const botClient = {
      botUsername: 'test_bot',
      callbackUrl: (s: string) => `http://127.0.0.1/cb?state=${s}`,
      deepLinkUrl: (s: string) => `https://t.me/test_bot?start=${s}`,
      groupDeepLinkUrl: (s: string) => `https://t.me/test_bot?startgroup=${s}`,
      discoverGroups: vi.fn(async () => [
        { chatId: '-100701', title: 'Group A Only', type: 'supergroup' as const },
        { chatId: '-100702', title: 'Group B Only', type: 'supergroup' as const },
      ]),
      getChatMember: vi.fn(async () => true),
      getChat: vi.fn(async (id: string) => ({ chatId: id, title: id, type: 'supergroup' as const })),
    } as any;

    const app = createApp({
      jwtSecret: JWT_SECRET,
      encryptionKey: ENC_KEY,
      pool: db.pool,
      userRepo: db.users,
      workspaceRepo,
      credentialRepo: credRepo,
      telegramTeamRepo: teamRepo,
      serviceAdminUserIds: [admin.id],
      telegram: {
        bot: {
          botToken: '123456789:synthetic_token_abcdef',
          botUsername: 'test_bot',
          callbackUrl: 'http://127.0.0.1/connections/telegram/callback',
          apiBaseUrl: 'https://api.telegram.org',
          deepLinkBaseUrl: 'https://t.me',
        },
        botClient,
        teamRepo,
      },
    });

    const putA = await request(app)
      .put('/api/connections/telegram/scope')
      .set('Authorization', token)
      .set('x-workspace-id', wsA.id)
      .send({ chatIds: ['-100701'] });
    expect(putA.status).toBe(200);

    const putB = await request(app)
      .put('/api/connections/telegram/scope')
      .set('Authorization', token)
      .set('x-workspace-id', wsB.id)
      .send({ chatIds: ['-100702'] });
    expect(putB.status).toBe(200);

    expect((await teamRepo.get(wsA.id))?.chats.map((c) => c.chatId)).toEqual(['-100701']);
    expect((await teamRepo.get(wsB.id))?.chats.map((c) => c.chatId)).toEqual(['-100702']);
    expect(await teamRepo.get('default')).toBeNull();
  });

  it('authorizes org teamRepo updates by workspace role, scopes personal mode to personal:<userId>, and derives workspaceRepo from pool', async () => {
    const orgCreator = await db.person('Org Creator');
    const orgAdminGlobalMember = await db.person('Org Admin Global Member');
    const globalAdminOrgMember = await db.person('Global Admin Org Member');
    const outsider = await db.person('Outsider');

    const org = await workspaceRepo.create(orgCreator.id, 'Org Auth Test');
    await db.pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status)
       VALUES ($1, $2, 'admin', 'active'), ($1, $3, 'member', 'active')`,
      [org.id, orgAdminGlobalMember.id, globalAdminOrgMember.id],
    );

    const orgAdminToken = `Bearer ${generateAccessToken({ ...orgAdminGlobalMember, role: 'member' }, JWT_SECRET, orgAdminGlobalMember.sid).accessToken}`;
    const globalAdminToken = `Bearer ${generateAccessToken({ ...globalAdminOrgMember, role: 'admin' }, JWT_SECRET, globalAdminOrgMember.sid).accessToken}`;
    const outsiderToken = `Bearer ${generateAccessToken({ ...outsider, role: 'member' }, JWT_SECRET, outsider.sid).accessToken}`;

    for (const [person, tgId, chatId] of [
      [orgAdminGlobalMember, '6001', '-100801'],
      [globalAdminOrgMember, '6002', '-100802'],
      [outsider, '6003', '-100803'],
    ] as const) {
      await credRepo.saveCredentials(
        'telegram',
        encryptCredentials(
          {
            telegramUserId: tgId,
            username: `u_${tgId}`,
            displayName: person.name,
            selectedChats: [{ chatId: tgId, title: 'Private', type: 'private' }],
            knownChats: [
              { chatId: tgId, title: 'Private', type: 'private' },
              { chatId, title: `Group ${tgId}`, type: 'supergroup' },
            ],
          },
          ENC_KEY,
        ),
        person.id,
      );
    }

    const botClient = {
      botUsername: 'test_bot',
      callbackUrl: (s: string) => `http://127.0.0.1/cb?state=${s}`,
      deepLinkUrl: (s: string) => `https://t.me/test_bot?start=${s}`,
      groupDeepLinkUrl: (s: string) => `https://t.me/test_bot?startgroup=${s}`,
      discoverGroups: vi.fn(async () => [
        { chatId: '-100801', title: 'Group 6001', type: 'supergroup' as const },
        { chatId: '-100802', title: 'Group 6002', type: 'supergroup' as const },
        { chatId: '-100803', title: 'Group 6003', type: 'supergroup' as const },
      ]),
      getChatMember: vi.fn(async () => true),
      getChat: vi.fn(async (id: string) => ({ chatId: id, title: id, type: 'supergroup' as const })),
    } as any;

    // Omit workspaceRepo intentionally to verify telegramRoutes derives WorkspaceRepo from pool
    const appWithoutExplicitWorkspaceRepo = createApp({
      jwtSecret: JWT_SECRET,
      encryptionKey: ENC_KEY,
      userRepo: db.users,
      credentialRepo: credRepo,
      telegramTeamRepo: teamRepo,
      serviceAdminUserIds: [globalAdminOrgMember.id],
      telegram: {
        bot: {
          botToken: '123456789:synthetic_token_abcdef',
          botUsername: 'test_bot',
          callbackUrl: 'http://127.0.0.1/connections/telegram/callback',
          apiBaseUrl: 'https://api.telegram.org',
          deepLinkBaseUrl: 'https://t.me',
        },
        botClient,
        teamRepo,
      },
    });

    // 1. Org admin (even with global role='member') CAN set org teamRepo
    const orgAdminPut = await request(appWithoutExplicitWorkspaceRepo)
      .put('/api/connections/telegram/scope')
      .set('Authorization', orgAdminToken)
      .set('x-workspace-id', org.id)
      .send({ chatIds: ['-100801'] });
    expect(orgAdminPut.status).toBe(200);
    expect((await teamRepo.get(org.id))?.chats.map((c) => c.chatId)).toEqual(['-100801']);

    // 2. Global admin who is only an org 'member' CANNOT overwrite org teamRepo
    const globalAdminPutOrg = await request(appWithoutExplicitWorkspaceRepo)
      .put('/api/connections/telegram/scope')
      .set('Authorization', globalAdminToken)
      .set('x-workspace-id', org.id)
      .send({ chatIds: ['-100802'] });
    expect(globalAdminPutOrg.status).toBe(200);
    expect((await teamRepo.get(org.id))?.chats.map((c) => c.chatId)).toEqual(['-100801']);

    // 3. Personal mode saves into personal:<userId>, never polluting 'default' (even for global admin)
    const personalPut = await request(appWithoutExplicitWorkspaceRepo)
      .put('/api/connections/telegram/scope')
      .set('Authorization', globalAdminToken)
      .set('x-workspace-id', 'personal')
      .send({ chatIds: ['-100802'] });
    expect(personalPut.status).toBe(200);
    expect((await teamRepo.get(`personal:${globalAdminOrgMember.id}`))?.chats.map((c) => c.chatId)).toEqual(['-100802']);
    expect(await teamRepo.get('default')).toBeNull();

    // 4. Non-member sending x-workspace-id=<orgUuid> must receive 403 WORKSPACE_ACCESS_DENIED even without explicit workspaceRepo
    const outsiderRes = await request(appWithoutExplicitWorkspaceRepo)
      .put('/api/connections/telegram/scope')
      .set('Authorization', outsiderToken)
      .set('x-workspace-id', org.id)
      .send({ chatIds: ['-100803'] });
    expect(outsiderRes.status).toBe(403);
    expect(outsiderRes.body.error).toBe('WORKSPACE_ACCESS_DENIED');
  });
});
