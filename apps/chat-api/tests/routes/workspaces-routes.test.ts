import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/app.js';
import { UserRepo, hashPassword } from '../../src/db/repositories/user-repo.js';
import { AdminUserRepo } from '../../src/db/repositories/admin-user-repo.js';
import { WorkspaceRepo } from '../../src/db/repositories/workspace-repo.js';
import { OutboxEmailSender } from '../../src/services/email/index.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const databaseUrl = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';
const password = 'Auth03Fixture!password';
const storedPassword = hashPassword(password);
const secret = 'auth03_fixture_secret_at_least_32_chars';

describe('Task 3: Workspaces routes, X-Workspace-Id middleware, and organization member management', () => {
  const schema = `ws_routes_${randomUUID().replaceAll('-', '')}`;
  const scopedUrl = new URL(databaseUrl);
  scopedUrl.searchParams.set('options', `-c search_path=${schema}`);

  let admin: pg.Pool;
  let pool: pg.Pool;
  let userRepo: UserRepo;
  let workspaceRepo: WorkspaceRepo;
  let adminUserRepo: AdminUserRepo;
  let emailSender: OutboxEmailSender;
  let app: ReturnType<typeof createApp>;
  const audit = { info: vi.fn() };

  let aliceId: string;
  let bobId: string;
  let charlieId: string;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: scopedUrl.href, max: 12 });

    const directory = `${root}/db/v3`;
    for (const f of (await readdir(directory)).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()) {
      await pool.query(await readFile(`${directory}/${f}`, 'utf8'));
    }

    userRepo = new UserRepo(pool);
    workspaceRepo = new WorkspaceRepo(pool);
    adminUserRepo = new AdminUserRepo(pool);
    emailSender = new OutboxEmailSender(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE workspaces, users, email_outbox CASCADE');
    audit.info.mockClear();

    aliceId = randomUUID();
    bobId = randomUUID();
    charlieId = randomUUID();

    // Alice is a global member, Bob is a global member, Charlie is a global member
    for (const [id, name] of [
      [aliceId, 'Alice Admin'],
      [bobId, 'Bob Member'],
      [charlieId, 'Charlie Pending'],
    ]) {
      await pool.query(
        'INSERT INTO users(id, email, password, name, role, status, email_verified) VALUES($1, $2, $3, $4, $5, $6, true)',
        [id, `${id}@example.test`, storedPassword, name, 'member', 'active']
      );
    }

    app = createApp({
      jwtSecret: secret,
      userRepo,
      adminUserRepo,
      workspaceRepo,
      adminAuditLogger: audit,
      emailSender,
    });
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  const login = async (id: string) => {
    const res = await request(app).post('/api/auth/login').send({
      email: `${id}@example.test`,
      password,
    });
    return res.body;
  };

  it('GET /api/workspaces returns personal space and list of organizations', async () => {
    const aliceTokens = await login(aliceId);
    const res = await request(app)
      .get('/api/workspaces')
      .set('Authorization', `Bearer ${aliceTokens.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.personal).toEqual({
      id: 'personal',
      name: 'Không gian Cá nhân',
      role: 'admin',
      status: 'active',
    });
    expect(res.body.organizations).toEqual([]);
  });

  it('POST /api/workspaces creates new organization with creator as active admin', async () => {
    const aliceTokens = await login(aliceId);
    const res = await request(app)
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
      .send({ name: 'Acme Corp', requireApproval: true });

    expect(res.status).toBe(201);
    expect(res.body.workspace).toMatchObject({
      name: 'Acme Corp',
      role: 'admin',
      status: 'active',
      requireApproval: true,
      pendingCount: 0,
    });
    expect(res.body.workspace.id).toBeDefined();
    expect(res.body.workspace.inviteCode).toMatch(/^ATI-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    // List workspaces again
    const listRes = await request(app)
      .get('/api/workspaces')
      .set('Authorization', `Bearer ${aliceTokens.accessToken}`);
    expect(listRes.body.organizations).toHaveLength(1);
    expect(listRes.body.organizations[0].name).toBe('Acme Corp');
    expect(listRes.body.organizations[0].role).toBe('admin');
  });

  it('POST /api/workspaces/join with requireApproval: true creates pending membership and blocks workspace access until approved', async () => {
    const aliceTokens = await login(aliceId);
    const createRes = await request(app)
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
      .send({ name: 'Beta Org', requireApproval: true });
    const ws = createRes.body.workspace;

    const bobTokens = await login(bobId);
    // Bob joins using invite code
    const joinRes = await request(app)
      .post('/api/workspaces/join')
      .set('Authorization', `Bearer ${bobTokens.accessToken}`)
      .send({ inviteCode: ws.inviteCode });

    expect(joinRes.status).toBe(200);
    expect(joinRes.body.created).toBe(true);
    expect(joinRes.body.workspace.status).toBe('pending');

    // Email outbox should have notification sent to Alice
    const outbox = await pool.query('SELECT * FROM email_outbox');
    expect(outbox.rows.length).toBeGreaterThan(0);
    expect(outbox.rows[0].to_address).toBe(`${aliceId}@example.test`);

    // Bob tries to access an endpoint with X-Workspace-Id: ws.id -> 403 WORKSPACE_MEMBER_PENDING
    const deniedRes = await request(app)
      .get('/api/services')
      .set('Authorization', `Bearer ${bobTokens.accessToken}`)
      .set('X-Workspace-Id', ws.id);

    expect(deniedRes.status).toBe(403);
    expect(deniedRes.body.error).toBe('WORKSPACE_MEMBER_PENDING');

    // Bob sends request with X-Workspace-Id: personal -> works normally (200)
    const personalRes = await request(app)
      .get('/api/services')
      .set('Authorization', `Bearer ${bobTokens.accessToken}`)
      .set('X-Workspace-Id', 'personal');
    expect(personalRes.status).toBe(200);

    // Bob sends request without X-Workspace-Id -> legacy mode works normally (200)
    const legacyRes = await request(app)
      .get('/api/services')
      .set('Authorization', `Bearer ${bobTokens.accessToken}`);
    expect(legacyRes.status).toBe(200);

    // Bob sends invalid UUID
    const badIdRes = await request(app)
      .get('/api/services')
      .set('Authorization', `Bearer ${bobTokens.accessToken}`)
      .set('X-Workspace-Id', 'not-a-valid-uuid');
    expect(badIdRes.status).toBe(400);
    expect(badIdRes.body.error).toBe('INVALID_WORKSPACE_ID');

    // Bob sends UUID of workspace he does not belong to
    const randomWsId = randomUUID();
    const foreignWsRes = await request(app)
      .get('/api/services')
      .set('Authorization', `Bearer ${bobTokens.accessToken}`)
      .set('X-Workspace-Id', randomWsId);
    expect(foreignWsRes.status).toBe(403);
    expect(foreignWsRes.body.error).toBe('WORKSPACE_ACCESS_DENIED');
  });

  it('Organization admin manages members via GET, PATCH /:id, and POST /approve-all on /api/admin/users', async () => {
    const aliceTokens = await login(aliceId);
    const createRes = await request(app)
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
      .send({ name: 'Delta Org', requireApproval: true });
    const wsId = createRes.body.workspace.id;
    const inviteCode = createRes.body.workspace.inviteCode;

    const bobTokens = await login(bobId);
    await request(app)
      .post('/api/workspaces/join')
      .set('Authorization', `Bearer ${bobTokens.accessToken}`)
      .send({ inviteCode });

    const charlieTokens = await login(charlieId);
    await request(app)
      .post('/api/workspaces/join')
      .set('Authorization', `Bearer ${charlieTokens.accessToken}`)
      .send({ inviteCode });

    // Alice lists members of Delta Org
    const listRes = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
      .set('X-Workspace-Id', wsId);

    expect(listRes.status).toBe(200);
    expect(listRes.body.total).toBe(3);
    expect(listRes.body.pendingCount).toBe(2);
    expect(listRes.body.workspaceName).toBe('Delta Org');

    // Bob (pending) tries to manage -> 403 (middleware blocks pending membership)
    const bobDenied = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${bobTokens.accessToken}`)
      .set('X-Workspace-Id', wsId);
    expect(bobDenied.status).toBe(403);
    expect(bobDenied.body.error).toBe('WORKSPACE_MEMBER_PENDING');

    // Alice approves Bob via PATCH /api/admin/users/:id
    const approveBobRes = await request(app)
      .patch(`/api/admin/users/${bobId}`)
      .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
      .set('X-Workspace-Id', wsId)
      .send({ action: 'approve' });

    expect(approveBobRes.status).toBe(200);
    expect(approveBobRes.body.user.status).toBe('active');

    // Now Bob is active member. Does Bob have admin permission in Delta Org? No.
    const bobAdminCheck = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${bobTokens.accessToken}`)
      .set('X-Workspace-Id', wsId);
    expect(bobAdminCheck.status).toBe(403);
    expect(bobAdminCheck.body.code).toBe('ADMIN_REQUIRED');

    // Alice promotes Bob to admin
    const promoteBobRes = await request(app)
      .patch(`/api/admin/users/${bobId}`)
      .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
      .set('X-Workspace-Id', wsId)
      .send({ action: 'role', role: 'admin' });
    expect(promoteBobRes.status).toBe(200);
    expect(promoteBobRes.body.user.role).toBe('admin');

    // Now Bob is admin in Delta Org -> can list users
    const bobAdminOk = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${bobTokens.accessToken}`)
      .set('X-Workspace-Id', wsId);
    expect(bobAdminOk.status).toBe(200);

    // Alice tests approve-all for remaining pending members (Charlie)
    const approveAllRes = await request(app)
      .post('/api/admin/users/approve-all')
      .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
      .set('X-Workspace-Id', wsId);

    expect(approveAllRes.status).toBe(200);
    expect(approveAllRes.body.approvedCount).toBe(1);
    expect(approveAllRes.body.approvedUsers[0].id).toBe(charlieId);

    // Disable Charlie
    const disableRes = await request(app)
      .patch(`/api/admin/users/${charlieId}`)
      .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
      .set('X-Workspace-Id', wsId)
      .send({ action: 'disable' });
    expect(disableRes.status).toBe(200);
    expect(disableRes.body.user.status).toBe('disabled');

    // Charlie accesses endpoint with X-Workspace-Id -> 403 WORKSPACE_MEMBER_DISABLED
    const charlieDisabledRes = await request(app)
      .get('/api/services')
      .set('Authorization', `Bearer ${charlieTokens.accessToken}`)
      .set('X-Workspace-Id', wsId);
    expect(charlieDisabledRes.status).toBe(403);
    expect(charlieDisabledRes.body.error).toBe('WORKSPACE_MEMBER_DISABLED');

    // Re-enable Charlie
    const enableRes = await request(app)
      .patch(`/api/admin/users/${charlieId}`)
      .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
      .set('X-Workspace-Id', wsId)
      .send({ action: 'enable' });
    expect(enableRes.status).toBe(200);
    expect(enableRes.body.user.status).toBe('active');
  });

  it('reject removes pending member, regenerateInviteCode and updateSettings work for workspace admin only', async () => {
    const aliceTokens = await login(aliceId);
    const createRes = await request(app)
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
      .send({ name: 'Echo Org', requireApproval: true });
    const wsId = createRes.body.workspace.id;
    const oldCode = createRes.body.workspace.inviteCode;

    const bobTokens = await login(bobId);
    await request(app)
      .post('/api/workspaces/join')
      .set('Authorization', `Bearer ${bobTokens.accessToken}`)
      .send({ inviteCode: oldCode });

    // Alice rejects Bob
    const rejectRes = await request(app)
      .patch(`/api/admin/users/${bobId}`)
      .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
      .set('X-Workspace-Id', wsId)
      .send({ action: 'reject' });
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.rejectedId).toBe(bobId);

    // Alice regenerates invite code
    const regenRes = await request(app)
      .post(`/api/workspaces/${wsId}/invite-code/regenerate`)
      .set('Authorization', `Bearer ${aliceTokens.accessToken}`);
    expect(regenRes.status).toBe(200);
    expect(regenRes.body.inviteCode).not.toBe(oldCode);

    // Bob (not a member now) tries to regenerate -> 403
    const bobRegen = await request(app)
      .post(`/api/workspaces/${wsId}/invite-code/regenerate`)
      .set('Authorization', `Bearer ${bobTokens.accessToken}`);
    expect(bobRegen.status).toBe(403);

    // Alice updates settings
    const settingsRes = await request(app)
      .patch(`/api/workspaces/${wsId}/settings`)
      .set('Authorization', `Bearer ${aliceTokens.accessToken}`)
      .send({ requireApproval: false });
    expect(settingsRes.status).toBe(200);
    expect(settingsRes.body.requireApproval).toBe(false);
  });
});
