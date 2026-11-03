import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { SessionRepo } from '../../src/db/repositories/session-repo.js';
import { UserRepo } from '../../src/db/repositories/user-repo.js';
import { WorkspaceRepo } from '../../src/db/repositories/workspace-repo.js';
import type { ChatService } from '../../src/services/chat-service.js';
import { createIsolatedTestSchema, createSyntheticUser, type IsolatedTestContext } from '../helpers/jira-test-db.js';

describe('Jira integration preserves the shared personal and legacy history contract', () => {
  let context: IsolatedTestContext;
  let app: ReturnType<typeof createApp>;
  let token: string;
  let legacyId: string;
  let personalId: string;
  let organizationId: string;

  beforeAll(async () => {
    context = await createIsolatedTestSchema();
    await context.runAllMigrations();
    const userId = await createSyntheticUser(context.pool, 'Personal History', 'history', { role: 'member', status: 'active' });
    const users = new UserRepo(context.pool);
    const user = await users.findById(userId);
    if (!user) throw Error('Synthetic user was not stored');
    const sessions = new SessionRepo(context.pool);
    const { sessionId } = await sessions.create(userId, 'history-test');
    const secret = 'shared_history_test_secret_at_least_32_chars';
    token = generateAccessToken({ id: user.id, email: user.email, name: user.name, role: 'member', status: 'active' }, secret, sessionId).accessToken;
    const conversations = new ConversationRepo(context.pool);
    legacyId = (await conversations.createConversation(userId)).id;
    personalId = (await conversations.createConversation(userId, { workspaceMode: 'personal' })).id;
    const workspaces = new WorkspaceRepo(context.pool);
    organizationId = (await workspaces.create(userId, 'Separate Organization')).id;
    app = createApp({ jwtSecret: secret, userRepo: users, sessionRepo: sessions, convRepo: conversations,
      msgRepo: new MessageRepo(context.pool), workspaceRepo: workspaces,
      chatService: { handleUserMessage: vi.fn() } as unknown as ChatService });
  });

  afterAll(async () => { await context?.cleanup(); });

  it('reads legacy history through the personal workspace selector', async () => {
    const response = await request(app).get(`/api/conversations/${legacyId}`)
      .set('Authorization', `Bearer ${token}`).set('X-Workspace-Id', 'personal');
    expect(response.status).toBe(200);
  });

  it('keeps personal history accessible to an existing client without a workspace header', async () => {
    const response = await request(app).get(`/api/conversations/${personalId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
  });

  it('does not expose either NULL-scoped history in an organization context', async () => {
    for (const id of [legacyId, personalId]) {
      const response = await request(app).get(`/api/conversations/${id}`)
        .set('Authorization', `Bearer ${token}`).set('X-Workspace-Id', organizationId);
      expect(response.status).toBe(404);
    }
  });
});
