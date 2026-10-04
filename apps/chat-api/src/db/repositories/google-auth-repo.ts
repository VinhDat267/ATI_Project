import type pg from 'pg';
import { createHash } from 'node:crypto';
import type { GoogleProfile } from '../../auth/google-oidc.js';
import type { UserRow } from './user-repo.js';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export interface OAuthState {
  state_hash: string; browser_binding_hash: string; code_verifier: string; nonce: string;
  mode: 'login' | 'link'; user_id: string | null; session_id: string | null;
}
export class GoogleAccountError extends Error {
  constructor(readonly code: 'GOOGLE_LINK_CONFLICT' | 'SIGNUP_DISABLED' | 'INVALID_SESSION' | 'PASSWORD_REQUIRED') {
    super('Không thể cập nhật liên kết Google.');
  }
}
export class GoogleAuthRepo {
  constructor(private pool: pg.Pool) {}
  async createState(data: OAuthState, now: number): Promise<void> {
    await this.pool.query('DELETE FROM oauth_states WHERE expires_at<=$1', [new Date(now)]);
    await this.pool.query(`INSERT INTO oauth_states(state_hash,browser_binding_hash,code_verifier,nonce,mode,user_id,session_id,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [data.state_hash, data.browser_binding_hash, data.code_verifier, data.nonce, data.mode, data.user_id, data.session_id, new Date(now + 600000)]);
  }
  async findState(state: string, binding: string, now: number): Promise<OAuthState | null> {
    return (await this.pool.query<OAuthState>(`SELECT * FROM oauth_states WHERE state_hash=$1 AND browser_binding_hash=$2
      AND used_at IS NULL AND expires_at>$3`, [hash(state), hash(binding), new Date(now)])).rows[0] ?? null;
  }
  async consumeState(state: string, binding: string, now: number, userId?: string, sessionId?: string): Promise<OAuthState | null> {
    return (await this.pool.query<OAuthState>(`UPDATE oauth_states o SET used_at=$3 WHERE state_hash=$1 AND browser_binding_hash=$2
      AND used_at IS NULL AND expires_at>$3 AND (mode='login' OR (o.user_id=$4 AND o.session_id=$5 AND EXISTS
        (SELECT 1 FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=o.session_id AND s.user_id=o.user_id
         AND s.revoked_at IS NULL AND s.expires_at>$3 AND u.status='active')))
      RETURNING o.*`, [hash(state), hash(binding), new Date(now), userId ?? null, sessionId ?? null])).rows[0] ?? null;
  }
  async resolveAccount(profile: GoogleProfile, state: OAuthState, signupEnabled: boolean, now: number, beforeCreate?: () => void): Promise<{ user: UserRow; linked: boolean; created: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // A transaction-scoped lock serializes Google identity attachment, including
      // absent identity rows. User row locks coordinate with reset and admin actions.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('ati-google-account-attachment'))");
      let user: UserRow | undefined;
      let linked = false, created = false;
      if (state.mode === 'link') {
        user = (await client.query<UserRow>('SELECT * FROM users WHERE id=$1 FOR UPDATE', [state.user_id])).rows[0];
        if (!user || user.status !== 'active' || !await this.lockActiveSession(client, state.session_id!, user.id, now)) throw new GoogleAccountError('INVALID_SESSION');
        const owner = (await client.query<UserRow>('SELECT * FROM users WHERE google_sub=$1', [profile.sub])).rows[0];
        if ((owner && owner.id !== user.id) || (user.google_sub && user.google_sub !== profile.sub)) throw new GoogleAccountError('GOOGLE_LINK_CONFLICT');
        if (!user.google_sub) {
          user = (await client.query<UserRow>('UPDATE users SET google_sub=$2,updated_at=$3 WHERE id=$1 RETURNING *', [user.id, profile.sub, new Date(now)])).rows[0]!;
          linked = true;
        }
      } else {
        user = (await client.query<UserRow>('SELECT * FROM users WHERE google_sub=$1 FOR UPDATE', [profile.sub])).rows[0];
        if (!user) {
          user = (await client.query<UserRow>('SELECT * FROM users WHERE email=$1 FOR UPDATE', [profile.email])).rows[0];
          if (!user) {
            if (!signupEnabled) throw new GoogleAccountError('SIGNUP_DISABLED');
            // Apply creation policy only after both stable sub and email are
            // known absent, under the attachment lock, before any user INSERT.
            beforeCreate?.();
            user = (await client.query<UserRow>(`INSERT INTO users(email,name,password,status,email_verified,google_sub)
              VALUES($1,$2,NULL,'pending',true,$3) ON CONFLICT(email) DO NOTHING RETURNING *`, [profile.email, profile.name, profile.sub])).rows[0];
            created = Boolean(user);
            // Email signup can insert concurrently without the Google lock.
            if (!user) user = (await client.query<UserRow>('SELECT * FROM users WHERE email=$1 FOR UPDATE', [profile.email])).rows[0];
          }
          if (!user) throw new GoogleAccountError('GOOGLE_LINK_CONFLICT');
          if (!created) {
            if (user.google_sub && user.google_sub !== profile.sub) throw new GoogleAccountError('GOOGLE_LINK_CONFLICT');
            if (!user.email_verified) {
              // Pre-registration recovery also invalidates old reset/verification
              // links, otherwise a pre-registrant could reinstall a password.
              await client.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,$2) WHERE user_id=$1', [user.id, new Date(now)]);
              await client.query('UPDATE auth_tokens SET used_at=COALESCE(used_at,$2) WHERE user_id=$1', [user.id, new Date(now)]);
            }
            linked = user.google_sub === null;
            user = (await client.query<UserRow>(`UPDATE users SET google_sub=$2,password=CASE WHEN email_verified THEN password ELSE NULL END,
              email_verified=true,updated_at=$3 WHERE id=$1 RETURNING *`, [user.id, profile.sub, new Date(now)])).rows[0]!;
          }
        }
      }
      // The account page shows the linked Google address; keep it current on every link and sign-in (AUTH-05).
      if (user && user.google_sub === profile.sub && user.google_email !== profile.email) {
        user = (await client.query<UserRow>('UPDATE users SET google_email=$2 WHERE id=$1 RETURNING *', [user.id, profile.email])).rows[0]!;
      }
      await client.query('COMMIT');
      return { user: user!, linked, created };
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') throw new GoogleAccountError('GOOGLE_LINK_CONFLICT');
      throw error;
    } finally { client.release(); }
  }
  private async lockActiveSession(client: pg.PoolClient, sessionId: string, userId: string, now: number): Promise<boolean> {
    const result = await client.query(`SELECT id FROM auth_sessions WHERE id=$1 AND user_id=$2
      AND revoked_at IS NULL AND expires_at>$3 FOR UPDATE`, [sessionId, userId, new Date(now)]);
    return Boolean(result.rows.length);
  }
  async unlink(userId: string, sessionId: string, now: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const user = (await client.query<UserRow>('SELECT * FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
      if (!user || user.status !== 'active' || !await this.lockActiveSession(client, sessionId, userId, now)) throw new GoogleAccountError('INVALID_SESSION');
      if (!user.password) throw new GoogleAccountError('PASSWORD_REQUIRED');
      await client.query('UPDATE users SET google_sub=NULL,google_email=NULL,updated_at=$2 WHERE id=$1', [userId, new Date(now)]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
