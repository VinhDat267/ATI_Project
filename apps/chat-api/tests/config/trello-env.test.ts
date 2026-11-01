import { describe, expect, it } from 'vitest';
import { validateEnv } from '../../src/config/env.js';

const trello = {
  TRELLO_OAUTH_CLIENT_ID: 'trello-client-id',
  TRELLO_OAUTH_CLIENT_SECRET: 'trello-client-secret',
  TRELLO_OAUTH_REDIRECT_URI: 'http://127.0.0.1:5174/connections/trello/callback',
};

const fake = {
  TRELLO_OAUTH_AUTH_URL: 'http://127.0.0.1:4100/authorize',
  TRELLO_OAUTH_TOKEN_URL: 'http://127.0.0.1:4100/token',
  TRELLO_API_BASE_URL: 'http://127.0.0.1:4100/1',
};

const live = {
  RUNTIME_MODE: 'live',
  DATABASE_URL: 'postgresql://local',
  JWT_SECRET: 'private-secret-at-least-32-characters',
  ENCRYPTION_KEY: 'a'.repeat(32),
  GEMINI_API_KEY: 'fake-for-validation',
};

describe('Trello OAuth configuration', () => {
  it('pins the real Atlassian and Trello endpoints in live mode when not overridden', () => {
    const config = validateEnv({
      ...live,
      ...trello,
      TRELLO_OAUTH_REDIRECT_URI: 'https://ati.example/connections/trello/callback',
    });
    expect(config.TRELLO_OAUTH).toBeDefined();
    expect(config.TRELLO_OAUTH?.clientId).toBe('trello-client-id');
    expect(config.TRELLO_OAUTH?.clientSecret).toBe('trello-client-secret');
    expect(config.TRELLO_OAUTH?.redirectUri).toBe('https://ati.example/connections/trello/callback');
    expect(config.TRELLO_OAUTH?.authorizationUrl).toBe('https://auth.atlassian.com/authorize');
    expect(config.TRELLO_OAUTH?.tokenUrl).toBe('https://auth.atlassian.com/oauth/token');
    expect(config.TRELLO_OAUTH?.apiBaseUrl).toBe('https://api.trello.com/1');
  });

  it('leaves TRELLO_OAUTH undefined in sandbox mode when client credentials are provided without mock overrides', () => {
    const config = validateEnv({ ...trello, RUNTIME_MODE: 'sandbox' });
    expect(config.TRELLO_OAUTH).toBeUndefined();

    // Missing any one of the three overrides in sandbox leaves TRELLO_OAUTH undefined
    expect(validateEnv({ ...trello, ...fake, TRELLO_OAUTH_AUTH_URL: undefined }).TRELLO_OAUTH).toBeUndefined();
    expect(validateEnv({ ...trello, ...fake, TRELLO_OAUTH_TOKEN_URL: undefined }).TRELLO_OAUTH).toBeUndefined();
    expect(validateEnv({ ...trello, ...fake, TRELLO_API_BASE_URL: undefined }).TRELLO_OAUTH).toBeUndefined();
  });

  it('leaves TRELLO_OAUTH undefined if any required variable is missing or empty, and process still starts', () => {
    expect(validateEnv({}).TRELLO_OAUTH).toBeUndefined();

    for (const key of ['TRELLO_OAUTH_CLIENT_ID', 'TRELLO_OAUTH_CLIENT_SECRET', 'TRELLO_OAUTH_REDIRECT_URI']) {
      expect(validateEnv({ ...trello, [key]: undefined }).TRELLO_OAUTH, `${key} unset`).toBeUndefined();
      expect(validateEnv({ ...trello, [key]: '' }).TRELLO_OAUTH, `${key} empty string`).toBeUndefined();
      expect(validateEnv({ ...trello, [key]: '   ' }).TRELLO_OAUTH, `${key} whitespace`).toBeUndefined();
    }

    // Even in live mode, missing Trello OAuth config leaves TRELLO_OAUTH undefined without throwing
    expect(validateEnv(live).TRELLO_OAUTH).toBeUndefined();
    expect(validateEnv({ ...live, ...trello, TRELLO_OAUTH_CLIENT_ID: '' }).TRELLO_OAUTH).toBeUndefined();
  });

  it('rejects redirect URI with query, fragment, userinfo, unusual scheme, or non-loopback HTTP with an error containing TRELLO_OAUTH_REDIRECT_URI', () => {
    const invalidRedirects = [
      'http://127.0.0.1:5174/connections/trello/callback?code=foo', // query
      'http://127.0.0.1:5174/connections/trello/callback#token',    // fragment
      'http://user:pass@127.0.0.1:5174/connections/trello/callback',// userinfo
      'ftp://127.0.0.1:5174/connections/trello/callback',          // scheme lạ
      'javascript:alert(1)',                                         // scheme lạ
      'http://example.com/connections/trello/callback',             // HTTP không phải loopback
      'http://remote.host:5174/connections/trello/callback',        // HTTP không phải loopback
      'http://127.0.0.1:5174/wrong/path',                           // path khác
      'not-a-valid-url',                                            // URL không hợp lệ
    ];

    for (const uri of invalidRedirects) {
      expect(
        () => validateEnv({ ...trello, TRELLO_OAUTH_REDIRECT_URI: uri }),
        `Should reject: ${uri}`
      ).toThrow('TRELLO_OAUTH_REDIRECT_URI');
    }
  });

  it('accepts loopback HTTP hosts and remote HTTPS redirect URIs', () => {
    const localhost = validateEnv({ ...trello, ...fake, TRELLO_OAUTH_REDIRECT_URI: 'http://localhost:5174/connections/trello/callback' });
    expect(localhost.TRELLO_OAUTH?.redirectUri).toBe('http://localhost:5174/connections/trello/callback');

    const ipv6 = validateEnv({ ...trello, ...fake, TRELLO_OAUTH_REDIRECT_URI: 'http://[::1]:5174/connections/trello/callback' });
    expect(ipv6.TRELLO_OAUTH?.redirectUri).toBe('http://[::1]:5174/connections/trello/callback');

    const https = validateEnv({ ...trello, ...fake, TRELLO_OAUTH_REDIRECT_URI: 'https://example.com/connections/trello/callback' });
    expect(https.TRELLO_OAUTH?.redirectUri).toBe('https://example.com/connections/trello/callback');
  });

  it('allows overriding endpoints with fake URLs for testing in non-live mode', () => {
    const config = validateEnv({ ...trello, ...fake });
    expect(config.TRELLO_OAUTH?.authorizationUrl).toBe(fake.TRELLO_OAUTH_AUTH_URL);
    expect(config.TRELLO_OAUTH?.tokenUrl).toBe(fake.TRELLO_OAUTH_TOKEN_URL);
    expect(config.TRELLO_OAUTH?.apiBaseUrl).toBe(fake.TRELLO_API_BASE_URL);
  });

  it('pins the real Atlassian and Trello endpoints in live mode and ignores test overrides', () => {
    const config = validateEnv({
      ...live,
      ...trello,
      ...fake,
      TRELLO_OAUTH_REDIRECT_URI: 'https://ati.example/connections/trello/callback',
    });
    expect(config.TRELLO_OAUTH).toEqual({
      clientId: 'trello-client-id',
      clientSecret: 'trello-client-secret',
      redirectUri: 'https://ati.example/connections/trello/callback',
      authorizationUrl: 'https://auth.atlassian.com/authorize',
      tokenUrl: 'https://auth.atlassian.com/oauth/token',
      apiBaseUrl: 'https://api.trello.com/1',
    });
  });

  it('rejects malformed endpoint overrides for test in non-live mode', () => {
    expect(() => validateEnv({ ...trello, TRELLO_OAUTH_AUTH_URL: 'not-a-url' })).toThrow('TRELLO_OAUTH_AUTH_URL');
    expect(() => validateEnv({ ...trello, TRELLO_OAUTH_TOKEN_URL: 'http://user:pass@127.0.0.1:4100/token' })).toThrow('TRELLO_OAUTH_TOKEN_URL');
    expect(() => validateEnv({ ...trello, TRELLO_API_BASE_URL: 'http://127.0.0.1:4100/1#frag' })).toThrow('TRELLO_API_BASE_URL');
  });
});
