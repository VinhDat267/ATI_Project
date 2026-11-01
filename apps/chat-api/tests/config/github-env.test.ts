import { describe, expect, it } from 'vitest';
import { validateEnv } from '../../src/config/env.js';

const github = {
  GITHUB_OAUTH_CLIENT_ID: 'github-client-id',
  GITHUB_OAUTH_CLIENT_SECRET: 'github-client-secret',
  GITHUB_OAUTH_REDIRECT_URI: 'http://127.0.0.1:5174/connections/github/callback',
};

const fake = {
  GITHUB_OAUTH_AUTH_URL: 'http://127.0.0.1:4105/login/oauth/authorize',
  GITHUB_OAUTH_TOKEN_URL: 'http://127.0.0.1:4105/login/oauth/access_token',
  GITHUB_API_BASE_URL: 'http://127.0.0.1:4105',
};

const live = {
  RUNTIME_MODE: 'live',
  DATABASE_URL: 'postgresql://local',
  JWT_SECRET: 'private-secret-at-least-32-characters',
  ENCRYPTION_KEY: 'a'.repeat(32),
  GEMINI_API_KEY: 'fake-for-validation',
};

describe('GitHub OAuth configuration', () => {
  it('pins the real GitHub endpoints and default scope in live mode when not overridden', () => {
    const config = validateEnv({
      ...live,
      ...github,
      GITHUB_OAUTH_REDIRECT_URI: 'https://ati.example/connections/github/callback',
    });
    expect(config.GITHUB_OAUTH).toBeDefined();
    expect(config.GITHUB_OAUTH?.clientId).toBe('github-client-id');
    expect(config.GITHUB_OAUTH?.clientSecret).toBe('github-client-secret');
    expect(config.GITHUB_OAUTH?.redirectUri).toBe('https://ati.example/connections/github/callback');
    expect(config.GITHUB_OAUTH?.authorizationUrl).toBe('https://github.com/login/oauth/authorize');
    expect(config.GITHUB_OAUTH?.tokenUrl).toBe('https://github.com/login/oauth/access_token');
    expect(config.GITHUB_OAUTH?.apiBaseUrl).toBe('https://api.github.com');
    expect(config.GITHUB_OAUTH?.scope).toBe('repo read:user');
  });

  it('allows overriding GITHUB_OAUTH_SCOPE', () => {
    const config = validateEnv({
      ...live,
      ...github,
      GITHUB_OAUTH_SCOPE: 'repo,read:user',
    });
    expect(config.GITHUB_OAUTH?.scope).toBe('repo,read:user');
  });

  it('leaves GITHUB_OAUTH undefined in sandbox mode when client credentials are provided without mock overrides', () => {
    const config = validateEnv({ ...github, RUNTIME_MODE: 'sandbox' });
    expect(config.GITHUB_OAUTH).toBeUndefined();

    expect(validateEnv({ ...github, ...fake, GITHUB_OAUTH_AUTH_URL: undefined }).GITHUB_OAUTH).toBeUndefined();
    expect(validateEnv({ ...github, ...fake, GITHUB_OAUTH_TOKEN_URL: undefined }).GITHUB_OAUTH).toBeUndefined();
    expect(validateEnv({ ...github, ...fake, GITHUB_API_BASE_URL: undefined }).GITHUB_OAUTH).toBeUndefined();
  });

  it('leaves GITHUB_OAUTH undefined if any required variable is missing or empty, and process still starts', () => {
    expect(validateEnv({}).GITHUB_OAUTH).toBeUndefined();

    for (const key of ['GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET', 'GITHUB_OAUTH_REDIRECT_URI']) {
      expect(validateEnv({ ...github, [key]: undefined }).GITHUB_OAUTH, `${key} unset`).toBeUndefined();
      expect(validateEnv({ ...github, [key]: '' }).GITHUB_OAUTH, `${key} empty string`).toBeUndefined();
      expect(validateEnv({ ...github, [key]: '   ' }).GITHUB_OAUTH, `${key} whitespace`).toBeUndefined();
    }

    expect(validateEnv(live).GITHUB_OAUTH).toBeUndefined();
    expect(validateEnv({ ...live, ...github, GITHUB_OAUTH_CLIENT_ID: '' }).GITHUB_OAUTH).toBeUndefined();
  });

  it('rejects redirect URI with query, fragment, userinfo, unusual scheme, or non-loopback HTTP with an error containing GITHUB_OAUTH_REDIRECT_URI', () => {
    const invalidRedirects = [
      'http://127.0.0.1:5174/connections/github/callback?code=foo',
      'http://127.0.0.1:5174/connections/github/callback#token',
      'http://user:pass@127.0.0.1:5174/connections/github/callback',
      'ftp://127.0.0.1:5174/connections/github/callback',
      'javascript:alert(1)',
      'http://example.com/connections/github/callback',
      'http://remote.host:5174/connections/github/callback',
      'http://127.0.0.1:5174/wrong/path',
      'not-a-valid-url',
    ];

    for (const uri of invalidRedirects) {
      expect(
        () => validateEnv({ ...github, GITHUB_OAUTH_REDIRECT_URI: uri }),
        `Should reject: ${uri}`,
      ).toThrow('GITHUB_OAUTH_REDIRECT_URI');
    }
  });

  it('accepts loopback HTTP hosts and remote HTTPS redirect URIs', () => {
    const localhost = validateEnv({ ...github, ...fake, GITHUB_OAUTH_REDIRECT_URI: 'http://localhost:5174/connections/github/callback' });
    expect(localhost.GITHUB_OAUTH?.redirectUri).toBe('http://localhost:5174/connections/github/callback');

    const ipv6 = validateEnv({ ...github, ...fake, GITHUB_OAUTH_REDIRECT_URI: 'http://[::1]:5174/connections/github/callback' });
    expect(ipv6.GITHUB_OAUTH?.redirectUri).toBe('http://[::1]:5174/connections/github/callback');

    const https = validateEnv({ ...github, ...fake, GITHUB_OAUTH_REDIRECT_URI: 'https://example.com/connections/github/callback' });
    expect(https.GITHUB_OAUTH?.redirectUri).toBe('https://example.com/connections/github/callback');
  });

  it('allows overriding endpoints with fake URLs for testing in non-live mode', () => {
    const config = validateEnv({ ...github, ...fake });
    expect(config.GITHUB_OAUTH?.authorizationUrl).toBe(fake.GITHUB_OAUTH_AUTH_URL);
    expect(config.GITHUB_OAUTH?.tokenUrl).toBe(fake.GITHUB_OAUTH_TOKEN_URL);
    expect(config.GITHUB_OAUTH?.apiBaseUrl).toBe(fake.GITHUB_API_BASE_URL);
  });

  it('pins the real GitHub endpoints in live mode and ignores test overrides', () => {
    const config = validateEnv({
      ...live,
      ...github,
      ...fake,
      GITHUB_OAUTH_REDIRECT_URI: 'https://ati.example/connections/github/callback',
    });
    expect(config.GITHUB_OAUTH).toEqual({
      clientId: 'github-client-id',
      clientSecret: 'github-client-secret',
      redirectUri: 'https://ati.example/connections/github/callback',
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      apiBaseUrl: 'https://api.github.com',
      scope: 'repo read:user',
    });
  });

  it('rejects malformed endpoint overrides for test in non-live mode', () => {
    expect(() => validateEnv({ ...github, GITHUB_OAUTH_AUTH_URL: 'not-a-url' })).toThrow('GITHUB_OAUTH_AUTH_URL');
    expect(() => validateEnv({ ...github, GITHUB_OAUTH_TOKEN_URL: 'http://user:pass@127.0.0.1:4105/token' })).toThrow('GITHUB_OAUTH_TOKEN_URL');
    expect(() => validateEnv({ ...github, GITHUB_API_BASE_URL: 'http://127.0.0.1:4105/api#frag' })).toThrow('GITHUB_API_BASE_URL');
  });
});
