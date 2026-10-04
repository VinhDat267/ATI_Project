import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/app.js';
import { UserRepo, hashPassword } from '../../src/db/repositories/user-repo.js';
import { AdminUserRepo } from '../../src/db/repositories/admin-user-repo.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const databaseUrl = process.env.DATABASE_URL || 'postgresql://wap:wap@127.0.0.1:55532/ati_v3';
const password = 'Auth03Fixture!password';
const storedPassword = hashPassword(password);
const secret = 'auth03_fixture_secret_at_least_32_chars';

describe('AUTH-03 admin users via HTTP and real PostgreSQL transactions', () => {
  const schema = `auth_admin_${randomUUID().replaceAll('-', '')}`;
  const scopedUrl = new URL(databaseUrl);
  scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
  let admin: pg.Pool, pool: pg.Pool, users: UserRepo;
  let app: ReturnType<typeof createApp>;
  let actor: string, target: string, otherAdmin: string;
  const audit = { info: vi.fn() };
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: scopedUrl.href, max: 12 });
    for (const file of ['0001_v3_core.sql', '0002_v3_invariants.sql', '0003_auth_sessions.sql']) {
      await pool.query(await readFile(`${root}/db/v3/${file}`, 'utf8'));
    }
    users = new UserRepo(pool);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE users CASCADE');
    actor = randomUUID(); target = randomUUID(); otherAdmin = randomUUID();
    for (const [id, role, status, name] of [[actor, 'admin', 'active', 'Admin'], [target, 'member', 'pending', 'Candidate'], [otherAdmin, 'admin', 'active', 'Second Admin']]) {
      await pool.query('INSERT INTO users(id,email,password,name,role,status,email_verified) VALUES($1,$2,$3,$4,$5,$6,true)', [id, `${id}@example.test`, storedPassword, name, role, status]);
    }
    audit.info.mockClear();
    app = createApp({ jwtSecret: secret, userRepo: users, adminUserRepo: new AdminUserRepo(pool), adminAuditLogger: audit });
  });
  afterAll(async () => {
    await pool?.end(); await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin?.end();
  });
  const login = async (id: string) => (await request(app).post('/api/auth/login').send({ email: `${id}@example.test`, password })).body;
  const mutate = (token: string, id: string, action: string, body?: object) => request(app).post(`/api/admin/users/${id}/${action}`).set('Authorization', `Bearer ${token}`).send(body);

  it('lists only safe account metadata with filters, search, pagination, and live session count', async () => {
    const tokens = await login(actor);
    await login(actor);
    const response = await request(app).get('/api/admin/users?limit=1&page=1&status=active&search=Admin').set('Authorization', `Bearer ${tokens.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 2, pendingCount: 1, page: 1, limit: 1 });
    expect(response.body.users).toHaveLength(1);
    const all = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${tokens.accessToken}`);
    expect(all.body.users.find((user: any) => user.id === actor)).toMatchObject({ emailVerified: true, hasPassword: true, hasGoogle: false, openSessions: 2 });
    expect(JSON.stringify(all.body)).not.toContain(storedPassword);
    expect(all.body.users.every((user: any) => !('password' in user) && !('google_sub' in user))).toBe(true);
    const literalWildcard = await request(app).get('/api/admin/users?search=%25').set('Authorization', `Bearer ${tokens.accessToken}`);
    expect(literalWildcard.body.total).toBe(0);
  });

  it('denies every admin endpoint to members and a demoted admin with an existing access token', async () => {
    await pool.query("UPDATE users SET status='active' WHERE id=$1", [target]);
    for (const id of [target, actor]) {
      const tokens = await login(id);
      if (id === actor) await pool.query("UPDATE users SET role='member' WHERE id=$1", [actor]);
      expect((await request(app).get('/api/admin/users').set('Authorization', `Bearer ${tokens.accessToken}`)).status).toBe(403);
      for (const action of ['approve', 'disable', 'enable', 'role']) {
        expect((await mutate(tokens.accessToken, otherAdmin, action, { role: 'member' })).status).toBe(403);
      }
    }
  });

  it('approves only a verified pending account once and permits password login after approval', async () => {
    const tokens = await login(actor);
    await pool.query('UPDATE users SET email_verified=false WHERE id=$1', [target]);
    expect((await mutate(tokens.accessToken, target, 'approve')).status).toBe(409);
    await pool.query('UPDATE users SET email_verified=true WHERE id=$1', [target]);
    expect((await mutate(tokens.accessToken, target, 'approve')).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: `${target}@example.test`, password })).status).toBe(200);
    expect((await mutate(tokens.accessToken, target, 'approve')).status).toBe(409);
    expect((await pool.query('SELECT status FROM users WHERE id=$1', [target])).rows[0].status).toBe('active');
  });

  it('disables and revokes every session immediately; enabling requires a fresh login', async () => {
    const tokens = await login(actor);
    await pool.query("UPDATE users SET status='active' WHERE id=$1", [target]);
    const sessions = [await login(target), await login(target)];
    expect((await mutate(tokens.accessToken, target, 'disable')).status).toBe(200);
    for (const session of sessions) {
      expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${session.accessToken}`)).status).toBe(401);
      expect((await request(app).post('/api/auth/refresh').send({ refreshToken: session.refreshToken })).status).toBe(401);
    }
    expect((await mutate(tokens.accessToken, target, 'enable')).status).toBe(200);
    for (const session of sessions) expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${session.accessToken}`)).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: `${target}@example.test`, password })).status).toBe(200);
  });

  it('rejects self-disable, self-demotion, and using enable to bypass pending verification', async () => {
    const tokens = await login(actor);
    expect((await mutate(tokens.accessToken, actor, 'disable')).status).toBe(409);
    expect((await mutate(tokens.accessToken, actor, 'role', { role: 'member' })).status).toBe(409);
    expect((await mutate(tokens.accessToken, target, 'enable')).status).toBe(409);
    expect((await pool.query('SELECT role,status FROM users WHERE id=$1', [actor])).rows[0]).toEqual({ role: 'admin', status: 'active' });
  });

  it('keeps one active admin when two admins demote one another concurrently', async () => {
    const first = await login(actor), second = await login(otherAdmin);
    const responses = await Promise.all([mutate(first.accessToken, otherAdmin, 'role', { role: 'member' }), mutate(second.accessToken, actor, 'role', { role: 'member' })]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 403]);
    expect((await pool.query("SELECT count(*)::int AS n FROM users WHERE role='admin' AND status='active'")).rows[0].n).toBe(1);
  });

  it('rechecks the actor after a real PostgreSQL lock wait rather than trusting earlier middleware authorization', async () => {
    const tokens = await login(actor);
    const blocker = await pool.connect();
    let response: Promise<request.Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT pg_advisory_xact_lock(hashtext(current_schema()), 1096111176)');
      response = mutate(tokens.accessToken, target, 'approve').then(result => result);
      const deadline = Date.now() + 3_000;
      let waiting = false;
      while (Date.now() < deadline) {
        const locks = await pool.query("SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted");
        if (locks.rows[0].n > 0) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await blocker.query("UPDATE users SET role='member' WHERE id=$1", [actor]);
    } finally { await blocker.query('COMMIT'); blocker.release(); }
    expect((await response!).status).toBe(403);
    expect((await pool.query('SELECT status FROM users WHERE id=$1', [target])).rows[0].status).toBe('pending');
    expect(audit.info).not.toHaveBeenCalled();
  });

  it('writes sanitized structured audit events for all successful changes only', async () => {
    const tokens = await login(actor);
    for (const [action, body] of [['approve', undefined], ['role', { role: 'admin' }], ['disable', undefined], ['enable', undefined]] as const) {
      expect((await mutate(tokens.accessToken, target, action, body)).status).toBe(200);
    }
    expect((await mutate(tokens.accessToken, actor, 'disable')).status).toBe(409);
    expect(audit.info).toHaveBeenCalledTimes(4);
    const events = audit.info.mock.calls.map(([message]) => JSON.parse(message));
    expect(events.map(event => event.action)).toEqual(['approve', 'role', 'disable', 'enable']);
    for (const event of events) {
      expect(event).toMatchObject({ event: 'admin_user_changed', actorId: actor, targetId: target });
      expect(Number.isNaN(Date.parse(event.at))).toBe(false);
      expect(Object.keys(event).sort()).toEqual(['action', 'actorId', 'at', 'event', 'targetId']);
    }
    expect(JSON.stringify(events)).not.toContain(storedPassword);
    expect(JSON.stringify(events)).not.toContain('@example.test');
  });


  it('validates IDs, roles, and bounded pagination without database error disclosure', async () => {
    const tokens = await login(actor);
    for (const query of ['limit=0', 'limit=101', 'page=-1', 'status=bogus', 'search[]=x']) {
      expect((await request(app).get(`/api/admin/users?${query}`).set('Authorization', `Bearer ${tokens.accessToken}`)).status).toBe(400);
    }
    expect((await mutate(tokens.accessToken, 'not-uuid', 'disable')).status).toBe(400);
    expect((await mutate(tokens.accessToken, target, 'role', { role: 'root' })).status).toBe(400);
    expect((await mutate(tokens.accessToken, randomUUID(), 'disable')).status).toBe(404);
  });

  it('normalizes valid uppercase UUIDs before matching the target account', async () => {
    const tokens = await login(actor);
    expect((await mutate(tokens.accessToken, target.toUpperCase(), 'approve')).status).toBe(200);
  });
});

it('returns PostgreSQL-required 503 for memory-mode account administration', async () => {
  const app = createApp({ jwtSecret: secret });
  expect((await request(app).get('/api/admin/users')).status).toBe(503);
});
