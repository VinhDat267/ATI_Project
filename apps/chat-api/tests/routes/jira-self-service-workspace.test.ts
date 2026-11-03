import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type pg from 'pg';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';
import { createApp } from '../../src/app.js';
import { UserRepo } from '../../src/db/repositories/user-repo.js';
import { SessionRepo } from '../../src/db/repositories/session-repo.js';
import { WorkspaceRepo } from '../../src/db/repositories/workspace/index.js';
import { generateAccessToken } from '../../src/auth/jwt.js';

const jwtSecret = '01234567890123456789012345678901_jwt_secret';
process.env.JWT_SECRET = jwtSecret;
process.env.ENCRYPTION_KEY = 'a'.repeat(32);

describe('Self-Service Jira Workspace Creation (POST /api/jira-workspaces)', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;
  let userId: string;
  let token: string;

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema();
    await ctx.runAllMigrations();
    pool = ctx.pool;
    userId = await createSyntheticUser(pool, 'Self Service Creator', 'creator_user');
    const sessionRepo = new SessionRepo(pool);
    const { sessionId } = await sessionRepo.create(userId, 'self-service-agent');
    const issued = generateAccessToken(
      { id: userId, email: 'creator_user@test.local', name: 'Self Service Creator', role: 'member', status: 'active' },
      jwtSecret,
      sessionId,
    );
    token = issued.accessToken;
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  it('creates an active Jira workspace and enrolls the creator as admin in 1 click', async () => {
    const app = createApp({
      pool,
      userRepo: new UserRepo(pool),
      sessionRepo: new SessionRepo(pool),
      jiraWorkspaceRepo: new WorkspaceRepo(pool),
      jwtSecret,
    });

    const createRes = await request(app)
      .post('/api/jira-workspaces')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Đội Kỹ Thuật Sản Phẩm' });

    expect(createRes.status).toBe(201);
    expect(createRes.body.workspace).toMatchObject({
      name: 'Đội Kỹ Thuật Sản Phẩm',
      version: 1,
    });
    expect(createRes.body.workspace.slug).toMatch(/^doi-ky-thuat-san-pham-[a-f0-9]{6}$/);

    const listRes = await request(app)
      .get('/api/jira-workspaces')
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.workspaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: createRes.body.workspace.id,
          role: 'admin',
          membershipStatus: 'active',
        }),
      ]),
    );
  });

  it('validates workspace name length', async () => {
    const app = createApp({
      pool,
      userRepo: new UserRepo(pool),
      sessionRepo: new SessionRepo(pool),
      jiraWorkspaceRepo: new WorkspaceRepo(pool),
      jwtSecret,
    });

    const badRes = await request(app)
      .post('/api/jira-workspaces')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '   ' });

    expect(badRes.status).toBe(400);
    expect(badRes.body.code).toBe('INVALID_NAME');
  });
});
