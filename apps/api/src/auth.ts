import {
  createHash,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";

const PASSWORD_RE = /^scrypt\$16384\$8\$1\$([0-9a-f]{32})\$([0-9a-f]{128})$/;
const MAX_LOGIN_ATTEMPTS = 10;
const MAX_SESSIONS = 100;
const MAX_KDF_IN_FLIGHT = 4;
const WINDOW_MS = 60_000;

export class AuthError extends Error {
  constructor(
    readonly code: "UNAUTHENTICATED" | "RATE_LIMITED",
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface PasswordHashParts {
  salt: Buffer;
  key: Buffer;
}

export function parsePasswordHash(encoded: string): PasswordHashParts {
  const match = PASSWORD_RE.exec(encoded);
  if (!match) throw new Error("Invalid password hash configuration");
  return {
    salt: Buffer.from(match[1]!, "hex"),
    key: Buffer.from(match[2]!, "hex"),
  };
}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      64,
      { N: 16_384, r: 8, p: 1, maxmem: 33_554_432 },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length > 4096) throw new Error("Invalid password");
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$16384$8$1$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const { salt, key } = parsePasswordHash(encoded);
  if (!password || password.length > 4096) {
    await derive("invalid-password", salt);
    return false;
  }
  const candidate = await derive(password, salt);
  return candidate.length === key.length && timingSafeEqual(candidate, key);
}

interface Session {
  userId: string;
  expiresAt: number;
}

export interface SessionStoreOptions {
  userId: string;
  email: string;
  passwordHash: string;
  ttlMs: number;
  principalExists: () => Promise<boolean>;
  now?: () => number;
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly attempts = new Map<string, number[]>();
  private readonly now: () => number;
  private kdfInFlight = 0;

  constructor(private readonly options: SessionStoreOptions) {
    z.uuid().parse(options.userId);
    parsePasswordHash(options.passwordHash);
    if (!Number.isSafeInteger(options.ttlMs) || options.ttlMs <= 0)
      throw new Error("Invalid session TTL");
    this.now = options.now ?? Date.now;
  }

  private prune(now: number) {
    for (const [key, session] of this.sessions)
      if (session.expiresAt <= now) this.sessions.delete(key);
    for (const [key, values] of this.attempts) {
      const fresh = values.filter((time) => time > now - WINDOW_MS);
      if (fresh.length) this.attempts.set(key, fresh);
      else this.attempts.delete(key);
    }
  }

  async login(
    email: string,
    password: string,
    clientKey = "unknown",
  ): Promise<string> {
    const now = this.now();
    this.prune(now);
    const previous = this.attempts.get(clientKey) ?? [];
    if (previous.length >= MAX_LOGIN_ATTEMPTS)
      throw new AuthError("RATE_LIMITED", "Too many login attempts");
    this.attempts.set(clientKey, [...previous, now]);
    if (this.kdfInFlight >= MAX_KDF_IN_FLIGHT)
      throw new AuthError("RATE_LIMITED", "Login temporarily rate limited");
    this.kdfInFlight += 1;
    try {
      const validPassword = await verifyPassword(
        password,
        this.options.passwordHash,
      );
      const validPrincipal = await this.options.principalExists();
      if (email !== this.options.email || !validPassword || !validPrincipal)
        throw new AuthError("UNAUTHENTICATED", "Invalid credentials");
      this.prune(this.now());
      if (this.sessions.size >= MAX_SESSIONS)
        throw new AuthError("RATE_LIMITED", "Too many active sessions");
      const token = randomBytes(32).toString("base64url");
      this.sessions.set(this.digest(token), {
        userId: this.options.userId,
        expiresAt: this.now() + this.options.ttlMs,
      });
      return token;
    } finally {
      this.kdfInFlight -= 1;
    }
  }

  authenticate(header: string | undefined): string {
    this.prune(this.now());
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header ?? "");
    if (!match)
      throw new AuthError("UNAUTHENTICATED", "Authentication required");
    const session = this.sessions.get(this.digest(match[1]!));
    if (!session || session.expiresAt <= this.now())
      throw new AuthError("UNAUTHENTICATED", "Authentication required");
    return session.userId;
  }

  revoke(header: string | undefined): void {
    this.prune(this.now());
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header ?? "");
    if (!match || !this.sessions.delete(this.digest(match[1]!)))
      throw new AuthError("UNAUTHENTICATED", "Authentication required");
  }

  private digest(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
  }
}
