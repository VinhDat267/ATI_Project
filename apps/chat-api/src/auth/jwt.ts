import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  sid?: string;
  role?: 'member' | 'admin';
  status?: 'pending' | 'active' | 'disabled';
  emailVerified?: boolean;
  hasPassword?: boolean;
  hasGoogle?: boolean;
  isAdmin?: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface GenerateTokenOptions {
  accessTtlSeconds?: number;
  refreshTtlSeconds?: number;
  sessionId?: string;
}

interface JWTPayload {
  sub: string;
  email: string;
  name: string;
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
  sid?: string;
}

function base64UrlEncode(data: string): string {
  return Buffer.from(data, 'utf-8').toString('base64url');
}

function base64UrlDecode(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8');
}

function createSignature(headerPayload: string, secret: string): string {
  return createHmac('sha256', secret).update(headerPayload).digest('base64url');
}

function signToken(payload: JWTPayload, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const headerPayload = `${encodedHeader}.${encodedPayload}`;
  const signature = createSignature(headerPayload, secret);
  return `${headerPayload}.${signature}`;
}

function verifyToken(token: string, secret: string, expectedType: 'access' | 'refresh'): AuthUser {
  if (!token || typeof token !== 'string') {
    throw new Error('Invalid token');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed JWT token structure');
  }

  const [headerB64, payloadB64, signature] = parts;
  if (!headerB64 || !payloadB64 || !signature) {
    throw new Error('Malformed JWT token segments');
  }

  const headerPayload = `${headerB64}.${payloadB64}`;
  const expectedSig = createSignature(headerPayload, secret);

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);

  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Invalid token signature');
  }

  let payload: JWTPayload;
  try {
    const header = JSON.parse(base64UrlDecode(headerB64));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') throw new Error('Invalid JWT header');
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    throw new Error('Malformed token payload');
  }

  if (payload.type !== expectedType) {
    throw new Error(`Token type mismatch: expected ${expectedType}`);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || nowSeconds >= payload.exp) {
    throw new Error('Token expired');
  }
  if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string' || typeof payload.name !== 'string') {
    throw new Error('Malformed token payload');
  }

  return {
    id: payload.sub,
    email: payload.email,
    name: payload.name,
    sid: payload.sid,
  };
}

export function generateTokens(
  user: AuthUser,
  secret: string,
  options?: GenerateTokenOptions
): TokenPair {
  const now = Math.floor(Date.now() / 1000);
  const accessTtl = options?.accessTtlSeconds ?? 15 * 60; // 15 mins default
  const refreshTtl = options?.refreshTtlSeconds ?? 7 * 24 * 60 * 60; // 7 days default

  const accessPayload: JWTPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    type: 'access',
    iat: now,
    exp: now + accessTtl,
    sid: options?.sessionId,
  };

  const refreshPayload: JWTPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    type: 'refresh',
    iat: now,
    exp: now + refreshTtl,
  };

  return {
    accessToken: signToken(accessPayload, secret),
    refreshToken: signToken(refreshPayload, secret),
    expiresIn: accessTtl,
  };
}

export function verifyAccessToken(token: string, secret: string): AuthUser {
  return verifyToken(token, secret, 'access');
}

export function verifyRefreshToken(token: string, secret: string): AuthUser {
  return verifyToken(token, secret, 'refresh');
}

export interface AuthMiddlewareOptions {
  allowQueryToken?: boolean;
  validateSession?: (sid: string, userId: string) => Promise<AuthUser | null>;
}

export function createAuthMiddleware(secret: string, options?: AuthMiddlewareOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let token: string | undefined;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (options?.allowQueryToken && typeof req.query?.token === 'string') {
      token = req.query.token;
    }

    if (!token) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    try {
      let user = verifyAccessToken(token, secret);
      if (options?.validateSession) {
        if (!user.sid) { res.status(401).json({error:'Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.'}); return; }
        const validated = await options.validateSession(user.sid,user.id);
        if (!validated) { res.status(401).json({error:'Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.'}); return; }
        user = {...validated,sid:user.sid};
      }
      (req as any).user = user;
      next();
    } catch {
      res.status(401).json({ error: 'Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.' });
    }
  };
}
