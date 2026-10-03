import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import type { UserRow } from "../db/repositories/user-repo.js";
import type { AuthUser } from "./jwt.js";

export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export const isAdmin = (
  user: { id: string; role?: string },
  ids: string[] = [],
) => user.role === "admin" || ids.includes(user.id);
export function publicUser(row: UserRow, ids: string[] = []): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role || "member",
    status: row.status || "active",
    emailVerified: row.email_verified ?? true,
    hasPassword: Boolean(row.password),
    hasGoogle: Boolean(row.google_sub),
    isAdmin: isAdmin(row, ids),
  };
}

export class AccountRepo {
  constructor(readonly pool: pg.Pool) {}
  async createSession(userId: string, userAgent?: string) {
    const refreshToken = newToken();
    const { rows } = await this.pool.query(
      `INSERT INTO auth_sessions(user_id,refresh_token_hash,expires_at,user_agent)
      VALUES($1,$2,NOW()+INTERVAL '7 days',$3) RETURNING id`,
      [userId, hashToken(refreshToken), userAgent?.slice(0, 512) || null],
    );
    return { sid: rows[0].id as string, refreshToken };
  }
  async validateSession(sid: string, userId: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query(
      `SELECT u.* FROM auth_sessions s JOIN users u ON u.id=s.user_id
      WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>NOW()
        AND u.status='active' AND u.email_verified=TRUE`,
      [sid, userId],
    );
    return rows[0] || null;
  }
  async rotate(refreshToken: string) {
    const client = await this.pool.connect();
    const tokenHash = hashToken(refreshToken);
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT s.*,u.status,u.email_verified FROM auth_sessions s JOIN users u ON u.id=s.user_id
        WHERE s.refresh_token_hash=$1 OR s.previous_token_hash=$1 OR s.id IN
        (SELECT session_id FROM auth_refresh_history WHERE token_hash=$1) FOR UPDATE OF s`,
        [tokenHash],
      );
      const session = rows[0];
      if (
        !session ||
        session.revoked_at ||
        +new Date(session.expires_at) <= Date.now() ||
        session.status !== "active" ||
        !session.email_verified
      ) {
        await client.query("ROLLBACK");
        return { code: "INVALID" } as const;
      }
      if (session.refresh_token_hash !== tokenHash) {
        if (
          session.previous_token_hash === tokenHash &&
          Date.now() - +new Date(session.rotated_at) < 30_000
        ) {
          await client.query("ROLLBACK");
          return { code: "REFRESH_ROTATED" } as const;
        }
        await client.query(
          "UPDATE auth_sessions SET revoked_at=NOW() WHERE id=$1",
          [session.id],
        );
        await client.query("COMMIT");
        return { code: "INVALID" } as const;
      }
      const next = newToken();
      await client.query(
        "INSERT INTO auth_refresh_history(token_hash,session_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [tokenHash, session.id],
      );
      const updated = await client.query(
        `UPDATE auth_sessions SET previous_token_hash=refresh_token_hash,refresh_token_hash=$1,
        rotated_at=NOW(),last_used_at=NOW() WHERE id=$2 AND refresh_token_hash=$3 AND revoked_at IS NULL RETURNING id`,
        [hashToken(next), session.id, tokenHash],
      );
      if (!updated.rowCount) {
        await client.query("ROLLBACK");
        return { code: "INVALID" } as const;
      }
      await client.query("COMMIT");
      return {
        code: "OK",
        sid: session.id as string,
        userId: session.user_id as string,
        refreshToken: next,
      } as const;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async revoke(userId: string, sid?: string) {
    await this.pool.query(
      `UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL${sid ? " AND id=$2" : ""}`,
      sid ? [userId, sid] : [userId],
    );
  }
  async issueVerification(userId: string) {
    const token = newToken(),
      client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Lock the account so simultaneous resends leave exactly one usable token.
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        userId,
      ]);
      await client.query(
        "UPDATE auth_tokens SET used_at=NOW() WHERE user_id=$1 AND purpose='verify_email' AND used_at IS NULL",
        [userId],
      );
      await client.query(
        "INSERT INTO auth_tokens(user_id,purpose,token_hash,expires_at) VALUES($1,'verify_email',$2,NOW()+INTERVAL '24 hours')",
        [userId, hashToken(token)],
      );
      await client.query("COMMIT");
      return token;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async verifyEmail(token: string): Promise<UserRow | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE auth_tokens SET used_at=NOW() WHERE token_hash=$1 AND purpose='verify_email'
        AND used_at IS NULL AND expires_at>NOW() RETURNING user_id`,
        [hashToken(token)],
      );
      if (!result.rowCount) {
        await client.query("ROLLBACK");
        return null;
      }
      const { rows } = await client.query(
        "UPDATE users SET email_verified=TRUE,updated_at=NOW() WHERE id=$1 RETURNING *",
        [result.rows[0].user_id],
      );
      await client.query("COMMIT");
      return rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async approve(id: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query(
      "UPDATE users SET status='active',updated_at=NOW() WHERE id=$1 AND status='pending' AND email_verified=TRUE RETURNING *",
      [id],
    );
    return rows[0] || null;
  }
}
