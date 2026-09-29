import { describe, it, expect, vi } from 'vitest';
import {
  generateTokens,
  verifyAccessToken,
  verifyRefreshToken,
  createAuthMiddleware,
} from '../../src/auth/jwt.js';
import { hashPassword, verifyPassword } from '../../src/db/repositories/user-repo.js';
import { createApp } from '../../src/app.js';
import { createAuthRoutes } from '../../src/routes/auth-routes.js';
import express from 'express';
import request from 'supertest';
import crypto from 'node:crypto';

describe('apps/chat-api (Task 15: Auth & JWT Handling)', () => {
  const secret = 'jwt-test-secret-at-least-32-chars-long';

  it('generates access token with short TTL and verifies payload', () => {
    const user = { id: 'u1', email: 'test@example.com', name: 'Test User' };
    const { accessToken, refreshToken, expiresIn } = generateTokens(user, secret);

    expect(accessToken).toBeDefined();
    expect(refreshToken).toBeDefined();
    expect(expiresIn).toBeGreaterThan(0);

    const decoded = verifyAccessToken(accessToken, secret);
    expect(decoded.id).toBe('u1');
    expect(decoded.email).toBe('test@example.com');
    expect(decoded.name).toBe('Test User');
  });

  it('verifies refresh token separately and rejects tokens signed with wrong secret', () => {
    const user = { id: 'u2', email: 'user2@example.com', name: 'User Two' };
    const { accessToken, refreshToken } = generateTokens(user, secret);

    const decodedRefresh = verifyRefreshToken(refreshToken, secret);
    expect(decodedRefresh.id).toBe('u2');

    // Wrong secret throws
    expect(() => verifyAccessToken(accessToken, 'different-wrong-secret-at-least-32-chars')).toThrow(
      /invalid token signature/i
    );

    // Malformed token throws
    expect(() => verifyAccessToken('not.a.valid.jwt.token', secret)).toThrow();
  });

  it('rejects expired tokens', () => {
    const user = { id: 'u3', email: 'user3@example.com', name: 'User Three' };
    // Generate token with negative TTL
    const { accessToken } = generateTokens(user, secret, { accessTtlSeconds: -10 });

    expect(() => verifyAccessToken(accessToken, secret)).toThrow(/token expired/i);
  });

  it('creates authMiddleware that attaches user to req or returns 401 on failure', async () => {
    const user = { id: 'u4', email: 'user4@example.com', name: 'User Four' };
    const { accessToken } = generateTokens(user, secret);
    const middleware = createAuthMiddleware(secret);

    // Valid token
    const reqValid: any = {
      headers: { authorization: `Bearer ${accessToken}` },
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    middleware(reqValid, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(reqValid.user).toBeDefined();
    expect(reqValid.user.id).toBe('u4');

    // Missing token -> 401
    const reqMissing: any = { headers: {} };
    const nextMissing = vi.fn();
    middleware(reqMissing, res, nextMissing);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    expect(nextMissing).not.toHaveBeenCalled();
  });

  it('supports authenticating via query token when allowQueryToken is enabled', async () => {
    const user = { id: 'u5', email: 'sse@example.com', name: 'SSE Client' };
    const { accessToken } = generateTokens(user, secret);
    const middleware = createAuthMiddleware(secret, { allowQueryToken: true });

    const req: any = {
      headers: {},
      query: { token: accessToken },
    };
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe('u5');
  });
});

describe('password storage and login boundary', () => {
  const secret = 'jwt-test-secret-at-least-32-chars-long';

  it('rejects malformed bcrypt-looking hashes and plaintext legacy values', async () => {
    expect(verifyPassword('password123', '$2b$12$not-a-real-bcrypt-hash')).toBe(false);
    expect(verifyPassword('password123', 'password123')).toBe(false);
    const app = createApp({
      jwtSecret: secret,
      userRepo: { findByEmail: async () => ({ id: 'user-1', email: 'a@example.test', name: 'A', password: '$2b$12$not-a-real-bcrypt-hash' }) } as any,
    });
    const response = await request(app).post('/api/auth/login').send({ email: 'a@example.test', password: 'password123' });
    expect(response.status).toBe(401);
  });

  it('uses a distinct random salt for new hashes and verifies existing PBKDF2 hashes', () => {
    const first = hashPassword('strong-password');
    const second = hashPassword('strong-password');
    expect(first).not.toBe(second);
    expect(verifyPassword('strong-password', first)).toBe(true);
    expect(verifyPassword('wrong', first)).toBe(false);
    const legacyHash = crypto.pbkdf2Sync('legacy-password', 'wap_v3_salt', 10_000, 32, 'sha256').toString('hex');
    expect(verifyPassword('legacy-password', legacyHash)).toBe(true);
    expect(verifyPassword('wrong', legacyHash)).toBe(false);
  });

  it('does not expose a default admin login when no user repository is configured', async () => {
    const app = createApp({ jwtSecret: secret });
    const response = await request(app).post('/api/auth/login').send({ email: 'admin@wap.local', password: 'password123' });
    expect(response.status).toBe(401);
  });

  it('does not mint a token from a lookup that has not checked the password', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRoutes({
      jwtSecret: secret,
      findUserByEmail: async () => ({ id: 'u', email: 'a@example.test', name: 'A' }),
    } as any));
    const response = await request(app).post('/api/auth/login').send({ email: 'a@example.test', password: 'wrong' });
    expect(response.status).toBe(401);
  });
});
