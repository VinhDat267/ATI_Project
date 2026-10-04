import type pg from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import type { UserRow } from './user-repo.js';

export type AuthTokenPurpose = 'verify_email' | 'reset_password';
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const TTL = { verify_email: 24 * 60 * 60 * 1000, reset_password: 30 * 60 * 1000 };

export class AuthTokenRepo {
  constructor(private pool: pg.Pool) {}

  async issue(userId: string, purpose: AuthTokenPurpose, now = Date.now()): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // All issuers and consumers lock the user before touching tokens. A new
      // issue cannot leave two usable tokens or race a password transaction.
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      await client.query('UPDATE auth_tokens SET used_at=$3 WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL', [userId, purpose, new Date(now)]);
      await client.query('INSERT INTO auth_tokens(user_id,purpose,token_hash,expires_at,created_at) VALUES($1,$2,$3,$4,$5)', [userId, purpose, hash(token), new Date(now + TTL[purpose]), new Date(now)]);
      await client.query('COMMIT');
      return token;
    } catch (error) {
      await client.query('ROLLBACK'); throw error;
    } finally { client.release(); }
  }

  async verifyEmail(token: string, now = Date.now()): Promise<UserRow | null> {
    return this.consume(token, 'verify_email', now);
  }

  async resetPassword(token: string, passwordHash: string, now = Date.now()): Promise<UserRow | null> {
    return this.consume(token, 'reset_password', now, passwordHash);
  }

  private async consume(token: string, purpose: AuthTokenPurpose, now: number, passwordHash?: string): Promise<UserRow | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query<{ user_id: string }>('SELECT user_id FROM auth_tokens WHERE token_hash=$1 AND purpose=$2', [hash(token), purpose]);
      const userId = found.rows[0]?.user_id;
      if (!userId) { await client.query('ROLLBACK'); return null; }
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      // The predicate is rechecked after the competing transaction commits.
      const claimed = await client.query('UPDATE auth_tokens SET used_at=$3 WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND expires_at>$3 RETURNING id', [hash(token), purpose, new Date(now)]);
      if (!claimed.rowCount) { await client.query('ROLLBACK'); return null; }
      const updated = await client.query<UserRow>(passwordHash
        ? 'UPDATE users SET email_verified=true,password=$2,updated_at=$3 WHERE id=$1 RETURNING *'
        : 'UPDATE users SET email_verified=true,updated_at=$2 WHERE id=$1 RETURNING *',
      passwordHash ? [userId, passwordHash, new Date(now)] : [userId, new Date(now)]);
      if (passwordHash) {
        await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,$2) WHERE user_id=$1', [userId, new Date(now)]);
        await client.query('UPDATE auth_tokens SET used_at=$2 WHERE user_id=$1 AND used_at IS NULL', [userId, new Date(now)]);
      }
      await client.query('COMMIT');
      return updated.rows[0] ?? null;
    } catch (error) {
      await client.query('ROLLBACK'); throw error;
    } finally { client.release(); }
  }
}
