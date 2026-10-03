import type pg from 'pg';
import crypto from 'node:crypto';

export interface UserRow {
  id: string;
  email: string;
  password: string;
  name: string;
  created_at: Date;
  status?: 'pending' | 'active' | 'disabled';
  role?: 'member' | 'admin';
  email_verified?: boolean;
  google_sub?: string | null;
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
  constructor(readonly pool: pg.Pool) {}

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
}
