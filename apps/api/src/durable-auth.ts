import { createHash, randomBytes } from "node:crypto";
import type { Database } from "@wap/db";
import {
  AuthError,
  type SessionAuthority,
  type SessionInput,
  type SessionMetadata,
} from "./auth.js";

export interface AuthRepository {
  findOrCreateIdentity(input: {
    issuer: string;
    subject: string;
    email: string;
    displayName: string | null;
  }): Promise<{
    identityId: string;
    userId: string;
    email: string;
    displayName: string | null;
    roles: string[];
  }>;
  createSession(input: {
    sessionHash: string;
    userId: string;
    createdFrom: SessionMetadata["createdFrom"];
    issuer?: string;
    subject?: string;
    expiresAt: Date;
  }): Promise<void>;
  findSession(sessionHash: string): Promise<{
    userId: string;
    expiresAt: Date;
    issuer: string | null;
    subject: string | null;
  } | null>;
  revokeSession(sessionHash: string): Promise<boolean>;
  createOidcTransaction(input: {
    stateHash: string;
    nonceHash: string;
    verifierHash: string;
    issuer: string;
    clientId: string;
    redirectUri: string;
    returnTo: string;
    expiresAt: Date;
  }): Promise<{ id: string; stateHash: string }>;
  consumeOidcTransaction(stateHash: string): Promise<{
    id: string;
    stateHash: string;
    nonceHash: string;
    verifierHash: string;
    issuer: string;
    clientId: string;
    redirectUri: string;
    returnTo: string;
  } | null>;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createAuthRepository(db: Database): AuthRepository {
  return {
    async findOrCreateIdentity(input) {
      return db.client.begin(async (tx) => {
        const existingUser = await tx<{ id: string }[]>`
          SELECT id FROM users WHERE email=${input.email} LIMIT 1`;
        const userId =
          existingUser[0]?.id ??
          (
            await tx<{ id: string }[]>`
              INSERT INTO users (email,password_hash,display_name)
              VALUES (${input.email},'OIDC_MANAGED',${input.displayName})
              RETURNING id`
          )[0]!.id;
        const rows = await tx<
          {
            id: string;
            user_id: string;
            email: string;
            display_name: string | null;
            roles: string[];
          }[]
        >`
          INSERT INTO auth_identities (user_id,issuer,subject,email,display_name)
          VALUES (${userId},${input.issuer},${input.subject},${input.email},${input.displayName})
          ON CONFLICT (issuer,subject) DO UPDATE SET
            email=EXCLUDED.email,
            display_name=EXCLUDED.display_name,
            updated_at=clock_timestamp()
          RETURNING id,user_id,email,display_name`;
        const identity = rows[0]!;
        const roles = await tx<{ roles: string[] }[]>`
          SELECT roles FROM users WHERE id=${identity.user_id}`;
        return {
          identityId: identity.id,
          userId: identity.user_id,
          email: identity.email,
          displayName: identity.display_name,
          roles: roles[0]?.roles ?? ["user"],
        };
      });
    },

    async createSession(input) {
      await db.client`
        INSERT INTO auth_sessions
          (session_hash,user_id,created_from,issuer,subject,expires_at)
        VALUES
          (${input.sessionHash},${input.userId},${input.createdFrom},${input.issuer ?? null},${input.subject ?? null},${input.expiresAt})`;
    },

    async findSession(sessionHash) {
      const rows = await db.client<
        {
          user_id: string;
          expires_at: Date;
          issuer: string | null;
          subject: string | null;
        }[]
      >`
        SELECT user_id,expires_at,issuer,subject
        FROM auth_sessions
        WHERE session_hash=${sessionHash}
          AND revoked_at IS NULL
          AND expires_at > clock_timestamp()`;
      const row = rows[0];
      return row
        ? {
            userId: row.user_id,
            expiresAt: row.expires_at,
            issuer: row.issuer,
            subject: row.subject,
          }
        : null;
    },

    async revokeSession(sessionHash) {
      const rows = await db.client`
        UPDATE auth_sessions
        SET revoked_at=clock_timestamp()
        WHERE session_hash=${sessionHash} AND revoked_at IS NULL
        RETURNING session_hash`;
      return rows.length === 1;
    },

    async createOidcTransaction(input) {
      const rows = await db.client<{ id: string; state_hash: string }[]>`
        INSERT INTO oidc_transactions
          (state_hash,nonce_hash,verifier_hash,issuer,client_id,redirect_uri,return_to,expires_at)
        VALUES
          (${input.stateHash},${input.nonceHash},${input.verifierHash},${input.issuer},${input.clientId},${input.redirectUri},${input.returnTo},${input.expiresAt})
        RETURNING id,state_hash`;
      return { id: rows[0]!.id, stateHash: rows[0]!.state_hash };
    },

    async consumeOidcTransaction(stateHash) {
      const rows = await db.client<
        {
          id: string;
          state_hash: string;
          nonce_hash: string;
          verifier_hash: string;
          issuer: string;
          client_id: string;
          redirect_uri: string;
          return_to: string;
        }[]
      >`
        UPDATE oidc_transactions
        SET consumed_at=clock_timestamp()
        WHERE state_hash=${stateHash}
          AND consumed_at IS NULL
          AND expires_at > clock_timestamp()
        RETURNING id,state_hash,nonce_hash,verifier_hash,issuer,client_id,redirect_uri,return_to`;
      const row = rows[0];
      return row
        ? {
            id: row.id,
            stateHash: row.state_hash,
            nonceHash: row.nonce_hash,
            verifierHash: row.verifier_hash,
            issuer: row.issuer,
            clientId: row.client_id,
            redirectUri: row.redirect_uri,
            returnTo: row.return_to,
          }
        : null;
    },
  };
}

export class DurableSessionAuthority implements SessionAuthority {
  constructor(
    private readonly repository: AuthRepository,
    private readonly options: {
      sessionTtlMs: number;
      cookieName?: string;
      now?: () => number;
    },
  ) {}

  async login(): Promise<string> {
    throw new AuthError(
      "UNAUTHENTICATED",
      "Password authentication is not enabled for the durable OIDC authority",
    );
  }

  async issue(userId: string, metadata: SessionMetadata): Promise<string> {
    const raw = randomBytes(32).toString("base64url");
    await this.repository.createSession({
      sessionHash: digest(raw),
      userId,
      createdFrom: metadata.createdFrom,
      ...(metadata.issuer ? { issuer: metadata.issuer } : {}),
      ...(metadata.subject ? { subject: metadata.subject } : {}),
      expiresAt: new Date(
        (this.options.now ?? Date.now)() + this.options.sessionTtlMs,
      ),
    });
    return raw;
  }

  async authenticate(input: SessionInput): Promise<string> {
    const raw = readSessionValue(
      input,
      this.options.cookieName ?? "wap_session",
    );
    const row = raw ? await this.repository.findSession(digest(raw)) : null;
    if (!row) throw new AuthError("UNAUTHENTICATED", "Authentication required");
    return row.userId;
  }

  async revoke(input: SessionInput): Promise<void> {
    const raw = readSessionValue(
      input,
      this.options.cookieName ?? "wap_session",
    );
    if (!raw || !(await this.repository.revokeSession(digest(raw))))
      throw new AuthError("UNAUTHENTICATED", "Authentication required");
  }
}

function readSessionValue(
  input: SessionInput,
  cookieName: string,
): string | null {
  const authorization =
    typeof input === "string" ? input : input?.authorization;
  const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? "")?.[1];
  if (bearer) return bearer;
  const cookie = typeof input === "string" ? undefined : input?.cookie;
  const escaped = cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const value = cookie?.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`))?.[1];
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
