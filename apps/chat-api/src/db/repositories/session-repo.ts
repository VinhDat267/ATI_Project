import type pg from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthUser } from '../../auth/jwt.js';
import { toAuthUser, type UserRow } from './user-repo.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ROTATION_GRACE_MS = 30_000;
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

export type RefreshResult =
  | { kind: 'rotated'; user: AuthUser; sessionId: string; refreshToken: string }
  | { kind: 'conflict' }
  | { kind: 'invalid' };

export class SessionRepo {
  constructor(private pool: pg.Pool) {}

  async create(userId: string, userAgent: string | undefined, now = Date.now()): Promise<{ sessionId: string; refreshToken: string }> {
    const refreshToken = newToken();
    // Lazy expiry cleanup also cascades the retired hash history.
    await this.pool.query('DELETE FROM auth_sessions WHERE expires_at <= $1', [new Date(now)]);
    const result = await this.pool.query(
      `INSERT INTO auth_sessions(user_id,refresh_token_hash,created_at,last_used_at,expires_at,user_agent)
       SELECT id,$2,$3,$3,$4,$5 FROM users WHERE id=$1 AND status='active' RETURNING id`,
      [userId, tokenHash(refreshToken), new Date(now), new Date(now + SESSION_TTL_MS), userAgent?.slice(0, 1024) ?? null],
    );
    if (!result.rows[0]) throw new Error('Account is not active');
    return { sessionId: result.rows[0].id, refreshToken };
  }

  async findActiveUser(sessionId: string, userId: string, now = Date.now()): Promise<AuthUser | null> {
    const result = await this.pool.query<UserRow>(
      `SELECT u.* FROM auth_sessions s JOIN users u ON u.id=s.user_id
       WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL
         AND s.expires_at>$3 AND u.status='active'`,
      [sessionId, userId, new Date(now)],
    );
    return result.rows[0] ? { ...toAuthUser(result.rows[0]), sid: sessionId } : null;
  }

  async rotate(token: string, now = Date.now()): Promise<RefreshResult> {
    const hash = tokenHash(token);
    const refreshToken = newToken();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // The hash predicate is rechecked after any concurrent row lock releases.
      // Exactly one contender can replace the presented hash.
      const rotated = await client.query<UserRow & { session_id: string }>(
        `UPDATE auth_sessions s SET refresh_token_hash=$2,previous_token_hash=$1,
           rotated_at=$3,last_used_at=$3
         FROM users u WHERE s.refresh_token_hash=$1 AND s.revoked_at IS NULL
           AND s.expires_at>$3 AND u.id=s.user_id AND u.status='active'
         RETURNING u.*,s.id AS session_id`,
        [hash, tokenHash(refreshToken), new Date(now)],
      );
      const row = rotated.rows[0];
      if (row) {
        await client.query('INSERT INTO auth_session_refresh_history(token_hash,session_id,replaced_at) VALUES($1,$2,$3)', [hash, row.session_id, new Date(now)]);
        await client.query('COMMIT');
        return { kind: 'rotated', user: toAuthUser(row), sessionId: row.session_id, refreshToken };
      }
      const retired = await client.query<{ id: string; previous_token_hash: string | null; rotated_at: Date; revoked_at: Date | null; expires_at: Date; status: string }>(
        `SELECT s.id,s.previous_token_hash,s.rotated_at,s.revoked_at,s.expires_at,u.status
         FROM auth_session_refresh_history h JOIN auth_sessions s ON s.id=h.session_id
         JOIN users u ON u.id=s.user_id WHERE h.token_hash=$1 FOR UPDATE OF s`, [hash],
      );
      const session = retired.rows[0];
      let kind: 'conflict' | 'invalid' = 'invalid';
      if (session && !session.revoked_at && session.expires_at.getTime() > now && session.status === 'active') {
        if (session.previous_token_hash === hash && now - session.rotated_at.getTime() <= ROTATION_GRACE_MS) {
          kind = 'conflict';
        } else {
          await client.query('UPDATE auth_sessions SET revoked_at=$2 WHERE id=$1 AND revoked_at IS NULL', [session.id, new Date(now)]);
        }
      }
      await client.query('COMMIT');
      return { kind };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revoke(sessionId: string, userId: string, now = Date.now()): Promise<void> {
    await this.pool.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,$3) WHERE id=$1 AND user_id=$2', [sessionId, userId, new Date(now)]);
  }

  async revokeAll(userId: string, now = Date.now()): Promise<void> {
    await this.pool.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,$2) WHERE user_id=$1', [userId, new Date(now)]);
  }
}
