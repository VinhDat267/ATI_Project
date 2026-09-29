import { describe, it, expect } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { UserRepo, verifyPassword } from '../../src/db/repositories/user-repo.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';

const connectionString = process.env.DATABASE_URL || 'postgresql://wap:wap@127.0.0.1:55532/ati_v3';

describe('real PostgreSQL plan invariants', () => {
  it('keeps the previous credential if replacement insertion fails', async () => {
    const pool = new pg.Pool({ connectionString });
    const service = `test-${randomUUID()}`;
    const repo = new CredentialRepo(pool);
    try {
      await repo.saveCredentials(service, 'encrypted-original');
      await expect(repo.saveCredentials(service, null as any)).rejects.toThrow();
      const current = await repo.getCredentials(service);
      expect(current?.config).toBe('encrypted-original');
    } finally {
      await pool.query('DELETE FROM service_credentials WHERE service = $1', [service]);
      await pool.end();
    }
  });

  it('serializes concurrent credential replacement into one stored row', async () => {
    const pool = new pg.Pool({ connectionString, max: 3 });
    const service = `test-${randomUUID()}`;
    try {
      const repo = new CredentialRepo(pool);
      await Promise.all([repo.saveCredentials(service, 'encrypted-a'), repo.saveCredentials(service, 'encrypted-b')]);
      const result = await pool.query('SELECT config FROM service_credentials WHERE service = $1', [service]);
      expect(result.rows).toHaveLength(1);
      expect(['encrypted-a', 'encrypted-b']).toContain(result.rows[0].config);
    } finally {
      await pool.query('DELETE FROM service_credentials WHERE service = $1', [service]);
      await pool.end();
    }
  });

  it('returns the latest 100 messages in chronological order', async () => {
    const pool = new pg.Pool({ connectionString });
    const userId = randomUUID();
    const convId = randomUUID();
    try {
      await pool.query('INSERT INTO users (id, email, password, name) VALUES ($1, $2, $3, $4)', [userId, `${userId}@example.test`, 'test-only', 'Test']);
      await pool.query('INSERT INTO conversations (id, user_id) VALUES ($1, $2)', [convId, userId]);
      await pool.query(`INSERT INTO messages (conv_id, role, content, created_at)
        SELECT $1, 'user', 'm' || i, now() + i * interval '1 millisecond'
        FROM generate_series(1, 102) AS i`, [convId]);
      const messages = await new MessageRepo(pool).listMessages(convId);
      expect(messages).toHaveLength(100);
      expect(messages[0]?.content).toBe('m3');
      expect(messages.at(-1)?.content).toBe('m102');
    } finally {
      await pool.query('DELETE FROM messages WHERE conv_id = $1', [convId]);
      await pool.query('DELETE FROM conversations WHERE id = $1', [convId]);
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      await pool.end();
    }
  });

  it('rejects a second pending plan inserted outside the repository', async () => {
    const pool = new pg.Pool({ connectionString });
    const userId = randomUUID();
    const convId = randomUUID();
    try {
      await pool.query('INSERT INTO users (id, email, password, name) VALUES ($1, $2, $3, $4)', [userId, `${userId}@example.test`, 'test-only', 'Test']);
      await pool.query('INSERT INTO conversations (id, user_id) VALUES ($1, $2)', [convId, userId]);
      const insert = () => pool.query(`INSERT INTO plans (conv_id, plan_json, plan_hash, expires_at)
        VALUES ($1, '{}'::jsonb, 'hash', now() + interval '1 hour')`, [convId]);
      await insert();
      await expect(insert()).rejects.toMatchObject({ code: '23505' });
    } finally {
      await pool.query('DELETE FROM plans WHERE conv_id = $1', [convId]);
      await pool.query('DELETE FROM conversations WHERE id = $1', [convId]);
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      await pool.end();
    }
  });
  it('provisions a user with a salted hash without resetting an existing account', async () => {
    const pool = new pg.Pool({ connectionString });
    const email = `${randomUUID()}@example.test`;
    const repo = new UserRepo(pool);
    let userId: string | undefined;
    try {
      const first = await repo.createUser({ email, password: 'strong-first-password', name: 'First' });
      userId = first.id;
      expect(first.password).toMatch(/^pbkdf2_sha256\$/);
      expect(verifyPassword('strong-first-password', first.password)).toBe(true);
      await expect(repo.createUser({ email, password: 'different-password', name: 'Second' })).rejects.toThrow(/already exists/i);
      const current = await repo.findByEmail(email);
      expect(current?.id).toBe(first.id);
      expect(current?.name).toBe('First');
      expect(verifyPassword('different-password', current?.password)).toBe(false);
    } finally {
      if (userId) await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      await pool.end();
    }
  });

  it('binds approval and rejection to both owner and the reviewed hash', async () => {
    const pool = new pg.Pool({ connectionString });
    const ownerId = randomUUID();
    const intruderId = randomUUID();
    const convId = randomUUID();
    let planId: string | undefined;
    try {
      for (const [id, name] of [[ownerId, 'Owner'], [intruderId, 'Intruder']]) {
        await pool.query('INSERT INTO users (id, email, password, name) VALUES ($1, $2, $3, $4)', [id, `${id}@example.test`, 'test-only', name]);
      }
      await pool.query('INSERT INTO conversations (id, user_id) VALUES ($1, $2)', [convId, ownerId]);
      const repo = new PlanRepo(pool);
      const plan = await repo.createPlan({ convId, planJson: { steps: [] }, planHash: 'reviewed-hash', expiresAt: new Date(Date.now() + 60_000) });
      planId = plan.id;
      expect(await repo.approvePlan(plan.id, 'wrong-hash', ownerId)).toBe(false);
      expect(await repo.approvePlan(plan.id, plan.plan_hash, intruderId)).toBe(false);
      expect(await repo.rejectPlan(plan.id, intruderId)).toBe(false);
      expect((await repo.getPlan(plan.id))?.status).toBe('pending');
      expect(await repo.approvePlan(plan.id, plan.plan_hash, ownerId)).toBe(true);
    } finally {
      if (planId) await pool.query('DELETE FROM plans WHERE id = $1', [planId]);
      await pool.query('DELETE FROM conversations WHERE id = $1', [convId]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[ownerId, intruderId]]);
      await pool.end();
    }
  });

  it('keeps one pending plan when two clients create plans for the same conversation', async () => {
    const pool = new pg.Pool({ connectionString, max: 4 });
    const userId = randomUUID();
    const convId = randomUUID();
    const clientA = await pool.connect();
    const clientB = await pool.connect();
    let releaseBoth!: () => void;
    const bothUpdated = new Promise<void>((resolve) => { releaseBoth = resolve; });
    let updates = 0;
    const wrapper = (client: pg.PoolClient) => ({
      connect: async () => ({ query: client.query.bind(client), release: () => undefined }),
      query: async (sql: string, args?: unknown[]) => {
        const result = await client.query(sql, args);
        if (sql.includes("UPDATE plans SET status = 'superseded'")) {
          updates++;
          if (updates === 2) releaseBoth();
          await bothUpdated;
        }
        return result;
      },
    });
    try {
      await pool.query('INSERT INTO users (id, email, password, name) VALUES ($1, $2, $3, $4)', [userId, `${userId}@example.test`, 'test-only', 'Test']);
      await pool.query('INSERT INTO conversations (id, user_id) VALUES ($1, $2)', [convId, userId]);
      const repoA = new PlanRepo(wrapper(clientA) as any);
      const repoB = new PlanRepo(wrapper(clientB) as any);
      await Promise.all([
        repoA.createPlan({ convId, planJson: { steps: [{ id: 'a' }] }, planHash: 'a', expiresAt: new Date(Date.now() + 60_000) }),
        repoB.createPlan({ convId, planJson: { steps: [{ id: 'b' }] }, planHash: 'b', expiresAt: new Date(Date.now() + 60_000) }),
      ]);
      const count = await pool.query("SELECT count(*)::int AS count FROM plans WHERE conv_id = $1 AND status = 'pending'", [convId]);
      expect(count.rows[0].count).toBe(1);
    } finally {
      clientA.release();
      clientB.release();
      await pool.query('DELETE FROM plans WHERE conv_id = $1', [convId]);
      await pool.query('DELETE FROM conversations WHERE id = $1', [convId]);
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      await pool.end();
    }
  }, 15_000);
});
