import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/app.js';
import { UserRepo, hashPassword } from '../../src/db/repositories/user-repo.js';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';
const directory = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const SMTP_DELAY_MS = 500;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

describe('AUTH-02b: email-sending routes do not wait for SMTP', () => {
  const schema = `auth02b_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool, pool: pg.Pool, app: ReturnType<typeof createApp>;
  let deliveries: Array<{ to: string; subject: string }>;
  const pending = new Set<Promise<void>>();
  // Simulates Gmail SMTP: a message is accepted only after a network round trip.
  const slowSmtp = {
    send: (message: { to: string; subject: string }) => {
      const task = new Promise<void>(resolve => setTimeout(() => { deliveries.push({ to: message.to, subject: message.subject }); resolve(); }, SMTP_DELAY_MS));
      pending.add(task); return task;
    },
  };
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(databaseUrl); url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.href, max: 4 });
    for (const file of (await readdir(directory)).filter(file => /^\d{4}_.*\.sql$/.test(file)).sort()) {
      await pool.query(await readFile(`${directory}/${file}`, 'utf8'));
    }
    app = createApp({ jwtSecret: 'auth02b_timing_fixture_secret_at_least_32_chars', userRepo: new UserRepo(pool),
      signupEnabled: true, appBaseUrl: 'http://localhost:5174', emailSender: slowSmtp } as any);
  });
  beforeEach(() => { deliveries = []; });
  afterAll(async () => {
    await Promise.all([...pending]);
    await pool?.end(); await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin?.end();
  });
  const timed = async (path: string, email: string) => {
    const started = performance.now();
    const response = await request(app).post(`/api/auth/${path}`).send({ email });
    return { ms: performance.now() - started, status: response.status, body: response.body };
  };

  it.each([
    ['forgot-password', 'active', true, 'Đặt lại mật khẩu ATI'],
    ['resend-verification', 'pending', false, 'Xác minh email tài khoản ATI'],
  ])('%s answers known and unknown emails in the same time and still sends one email per known account', async (path, status, verified, subject) => {
    const known: number[] = [], unknown: number[] = [], knownEmails: string[] = [];
    for (let i = 0; i < 5; i++) {
      const email = `${randomUUID()}@example.test`; knownEmails.push(email);
      await pool.query('INSERT INTO users(email,password,name,status,email_verified) VALUES($1,$2,$3,$4,$5)',
        [email, hashPassword('auth02b-fixture-password'), 'Timing', status, verified]);
      const existing = await timed(path, email), absent = await timed(path, `${randomUUID()}@example.test`);
      expect(existing.status).toBe(200); expect(absent.status).toBe(200); expect(absent.body).toEqual(existing.body);
      known.push(existing.ms); unknown.push(absent.ms);
    }
    expect(Math.abs(median(known) - median(unknown))).toBeLessThanOrEqual(100);
    await Promise.all([...pending]);
    expect(deliveries.map(row => row.to).sort()).toEqual([...knownEmails].sort());
    expect(deliveries.every(row => row.subject === subject)).toBe(true);
  });
});
