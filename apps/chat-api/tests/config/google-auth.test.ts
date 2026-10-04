import { describe, it, expect } from 'vitest';
import { validateEnv } from '../../src/config/env.js';
const google = { GOOGLE_OAUTH_CLIENT_ID: 'client', GOOGLE_OAUTH_CLIENT_SECRET: 'secret', GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:5174/auth/google/callback' };
const live = { RUNTIME_MODE: 'live', DATABASE_URL: 'postgresql://local', JWT_SECRET: 'private-secret-at-least-32-characters', ENCRYPTION_KEY: 'a'.repeat(32), GEMINI_API_KEY: 'fake-for-validation' };
describe('AUTH-04 Google environment policy', () => {
  it('returns complete OAuth configuration with fixed Google endpoints and sandbox endpoint overrides', () => {
    const config = validateEnv({ ...google }) as any; expect(config.GOOGLE_OAUTH).toMatchObject({ clientId: 'client', clientSecret: 'secret', redirectUri: google.GOOGLE_OAUTH_REDIRECT_URI,
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs' });
    expect((validateEnv({ ...google, GOOGLE_OAUTH_AUTH_URL: 'http://127.0.0.1:1234/authorize', GOOGLE_OAUTH_TOKEN_URL: 'http://127.0.0.1:1234/token', GOOGLE_OAUTH_JWKS_URL: 'http://127.0.0.1:1234/jwks' }) as any).GOOGLE_OAUTH.tokenUrl).toBe('http://127.0.0.1:1234/token');
  });
  it('always pins live Google URLs even when override env is malformed', () => {
    const config = validateEnv({ ...live, ...google, GOOGLE_OAUTH_AUTH_URL: 'evil', GOOGLE_OAUTH_TOKEN_URL: 'http://127.0.0.1/token', GOOGLE_OAUTH_JWKS_URL: 'https://evil.test' }) as any;
    expect(config.GOOGLE_OAUTH.tokenUrl).toBe('https://oauth2.googleapis.com/token'); expect(config.GOOGLE_OAUTH.jwksUrl).toBe('https://www.googleapis.com/oauth2/v3/certs');
  });
  it('disables Google for each missing OAuth credential while server can still start', () => {
    for (const key of Object.keys(google)) expect((validateEnv({ ...google, [key]: '' }) as any).GOOGLE_OAUTH).toBeUndefined();
  });
  it('Google signup follows the raw signup policy even in live without SMTP', () => {
    const config = validateEnv({ ...live, ...google }) as any; expect(config.EMAIL_ENABLED).toBe(false); expect(config.AUTH_SIGNUP_ENABLED).toBe(false); expect(config.GOOGLE_SIGNUP_ENABLED).toBe(true);
    expect((validateEnv({ ...live, ...google, AUTH_SIGNUP_ENABLED: 'false' }) as any).GOOGLE_SIGNUP_ENABLED).toBe(false);
  });
  it('requires the callback web pathname, forbids query/fragment/credentials and rejects insecure remote live redirects', () => {
    for (const redirect of ['http://localhost:5174/wrong', 'http://localhost:5174/auth/google/callback?view=google', 'http://localhost:5174/auth/google/callback#code', 'http://u:p@localhost:5174/auth/google/callback']) {
      expect(() => validateEnv({ ...google, GOOGLE_OAUTH_REDIRECT_URI: redirect })).toThrow('GOOGLE_OAUTH_REDIRECT_URI');
    }
    expect(() => validateEnv({ ...live, ...google, GOOGLE_OAUTH_REDIRECT_URI: 'http://remote.test/auth/google/callback' })).toThrow();
  });
});
