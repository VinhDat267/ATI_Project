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
});
