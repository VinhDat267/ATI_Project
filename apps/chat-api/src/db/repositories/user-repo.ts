import type pg from 'pg';
import crypto from 'node:crypto';
import { SessionRepo } from './session-repo.js';
import { AuthTokenRepo } from './auth-token-repo.js';
import type { AuthUser } from '../../auth/jwt.js';

export interface UserRow {
  id: string;
  email: string;
  password: string | null;
  name: string;
  created_at: Date;
  updated_at: Date;
  email_verified: boolean;
  status: 'pending' | 'active' | 'disabled';
  role: 'member' | 'admin';
  google_sub: string | null;
}

export function toAuthUser(user: UserRow): AuthUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role,
    status: user.status, emailVerified: user.email_verified,
    hasPassword: user.password !== null, hasGoogle: user.google_sub !== null };
}

const HASH_ITERATIONS = 210_000;
const LEGACY_SALT = 'wap_v3_salt';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, HASH_ITERATIONS, 32, 'sha256').toString('hex');
  return `pbkdf2_sha256$${HASH_ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedHash?: string | null): boolean {
  if (!storedHash) return false;
  const parts = storedHash.split('$');
  if (parts.length === 4 && parts[0] === 'pbkdf2_sha256') {
    const iterations = Number(parts[1]);
    if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > 1_000_000 || !/^[a-f0-9]{32}$/.test(parts[2]!) || !/^[a-f0-9]{64}$/.test(parts[3]!)) return false;
    const expected = Buffer.from(parts[3]!, 'hex');
    const computed = crypto.pbkdf2Sync(password, parts[2]!, iterations, expected.length, 'sha256');
    return crypto.timingSafeEqual(computed, expected);
  }
  // Existing v3 accounts used unversioned PBKDF2 hex with a fixed salt.
  if (!/^[a-f0-9]{64}$/.test(storedHash)) return false;
  const expected = Buffer.from(storedHash, 'hex');
  const computed = crypto.pbkdf2Sync(password, LEGACY_SALT, 10_000, expected.length, 'sha256');
  return crypto.timingSafeEqual(computed, expected);
}

export class UserRepo {
  readonly sessions: SessionRepo;
  readonly authTokens: AuthTokenRepo;
  constructor(private pool: pg.Pool) {
    this.sessions = new SessionRepo(pool);
    this.authTokens = new AuthTokenRepo(pool);
  }

  async createPendingUser(data: { email: string; password: string; name: string }): Promise<UserRow | null> {
    const result = await this.pool.query<UserRow>(
      `INSERT INTO users(email,password,name,status,email_verified,role) VALUES($1,$2,$3,'pending',false,'member')
       ON CONFLICT(email) DO NOTHING RETURNING *`,
      [data.email.trim().toLowerCase(), hashPassword(data.password), data.name],
    );
    return result.rows[0] ?? null;
  }

  async listActiveAdmins(): Promise<UserRow[]> {
    return (await this.pool.query<UserRow>("SELECT * FROM users WHERE role='admin' AND status='active'")).rows;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const res = await this.pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    return res.rows[0] || null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const res = await this.pool.query(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
    return res.rows[0] || null;
  }

  async createUser(data: { email: string; password: string; name: string; id?: string }): Promise<UserRow> {
    const id = data.id || crypto.randomUUID();
    const hashedPassword = hashPassword(data.password);
    const res = await this.pool.query(
      `INSERT INTO users (id, email, password, name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING *`,
      [id, data.email.toLowerCase().trim(), hashedPassword, data.name]
    );
    if (!res.rows[0]) throw new Error('User already exists');
    return res.rows[0];
  }

  async updatePassword(email: string, newPassword: string): Promise<boolean> {
    const hashedPassword = hashPassword(newPassword);
    const res = await this.pool.query(
      'UPDATE users SET password = $1 WHERE email = $2 RETURNING id',
      [hashedPassword, email.toLowerCase().trim()]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async provisionAdmin(data: { email: string; password: string; name: string }): Promise<UserRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<UserRow>(
        `INSERT INTO users(email,password,name,role,status,email_verified)
         VALUES($1,$2,$3,'admin','active',true)
         ON CONFLICT(email) DO UPDATE SET password=EXCLUDED.password,
           role='admin',status='active',email_verified=true,updated_at=now()
         RETURNING *`,
        [data.email.trim().toLowerCase(), hashPassword(data.password), data.name],
      );
      const user = result.rows[0]!;
      await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1', [user.id]);
      await client.query('COMMIT');
      return user;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
