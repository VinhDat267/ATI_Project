import { describe, expect, it } from 'vitest';
import { validateEnv } from '../../src/config/env.js';

const gmail = { GMAIL_ENABLED: 'on', GMAIL_OAUTH_CLIENT_ID: 'gmail-client', GMAIL_OAUTH_CLIENT_SECRET: 'gmail-secret', GMAIL_OAUTH_REDIRECT_URI: 'http://localhost:5174/connections/gmail/callback' };
const fake = { GMAIL_OAUTH_AUTH_URL: 'http://127.0.0.1:4100/o/oauth2/v2/auth', GMAIL_OAUTH_TOKEN_URL: 'http://127.0.0.1:4100/token', GMAIL_OAUTH_REVOKE_URL: 'http://127.0.0.1:4100/revoke', GMAIL_API_BASE_URL: 'http://127.0.0.1:4100' };
const live = { RUNTIME_MODE: 'live', DATABASE_URL: 'postgresql://local', JWT_SECRET: 'private-secret-at-least-32-characters', ENCRYPTION_KEY: 'a'.repeat(32), GEMINI_API_KEY: 'fake-for-validation' };

describe('GMAIL_ENABLED policy', () => {
  it('is off by default and keeps Gmail unconfigured even when every variable is present', () => {
    const config = validateEnv({ ...gmail, ...fake, GMAIL_ENABLED: undefined });
    expect(config.GMAIL_ENABLED).toBe(false);
    expect(config.GMAIL_OAUTH).toBeUndefined();
    expect(validateEnv({ ...live, ...gmail, GMAIL_ENABLED: 'off' }).GMAIL_OAUTH).toBeUndefined();
  });

  it.each(['true', 'ON', '1', 'yes'])('rejects the flag value %j', (value) => {
    expect(() => validateEnv({ GMAIL_ENABLED: value })).toThrow('GMAIL_ENABLED must be on or off');
  });

  it('treats an empty flag like an unset one', () => {
    expect(validateEnv({ GMAIL_ENABLED: '' }).GMAIL_ENABLED).toBe(false);
  });

  it('pins the real Google endpoints in live and ignores the test overrides', () => {
    const config = validateEnv({ ...live, ...gmail, ...fake, GMAIL_OAUTH_REDIRECT_URI: 'https://ati.example/connections/gmail/callback' });
    expect(config.GMAIL_ENABLED).toBe(true);
    expect(config.GMAIL_OAUTH).toEqual({
      clientId: 'gmail-client', clientSecret: 'gmail-secret', redirectUri: 'https://ati.example/connections/gmail/callback',
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
      revokeUrl: 'https://oauth2.googleapis.com/revoke', apiBaseUrl: 'https://gmail.googleapis.com',
    });
  });

  it('refuses to start live when the flag is on but a variable is missing', () => {
    for (const key of ['GMAIL_OAUTH_CLIENT_ID', 'GMAIL_OAUTH_CLIENT_SECRET', 'GMAIL_OAUTH_REDIRECT_URI']) {
      expect(() => validateEnv({ ...live, ...gmail, [key]: ' ' }), key).toThrow(`${key} is required when GMAIL_ENABLED=on in live mode`);
    }
  });

  it('uses only the fake endpoints in sandbox and disables Gmail without them or without a credential', () => {
    expect(validateEnv({ ...gmail, ...fake }).GMAIL_OAUTH).toMatchObject({
      tokenUrl: fake.GMAIL_OAUTH_TOKEN_URL, revokeUrl: fake.GMAIL_OAUTH_REVOKE_URL, apiBaseUrl: fake.GMAIL_API_BASE_URL,
    });
    for (const key of [...Object.keys(fake), 'GMAIL_OAUTH_CLIENT_ID', 'GMAIL_OAUTH_CLIENT_SECRET', 'GMAIL_OAUTH_REDIRECT_URI']) {
      const config = validateEnv({ ...gmail, ...fake, [key]: '' });
      expect(config.GMAIL_ENABLED, key).toBe(true);
      expect(config.GMAIL_OAUTH, key).toBeUndefined();
    }
  });

  it('requires the web /connections/gmail/callback URL without query, fragment or credentials, HTTPS in live except loopback', () => {
    for (const redirect of ['http://localhost:5174/auth/google/callback', 'http://localhost:5174/connections/gmail/callback?x=1',
      'http://localhost:5174/connections/gmail/callback#code', 'http://u:p@localhost:5174/connections/gmail/callback', 'ftp://localhost/connections/gmail/callback']) {
      expect(() => validateEnv({ ...gmail, ...fake, GMAIL_OAUTH_REDIRECT_URI: redirect }), redirect).toThrow('GMAIL_OAUTH_REDIRECT_URI');
    }
    expect(() => validateEnv({ ...live, ...gmail, GMAIL_OAUTH_REDIRECT_URI: 'http://remote.test/connections/gmail/callback' })).toThrow('GMAIL_OAUTH_REDIRECT_URI');
    expect(validateEnv({ ...live, ...gmail }).GMAIL_OAUTH?.redirectUri).toBe(gmail.GMAIL_OAUTH_REDIRECT_URI);
  });

  it('rejects a malformed sandbox endpoint override', () => {
    expect(() => validateEnv({ ...gmail, ...fake, GMAIL_OAUTH_TOKEN_URL: 'not a url' })).toThrow('GMAIL_OAUTH_TOKEN_URL');
    expect(() => validateEnv({ ...gmail, ...fake, GMAIL_API_BASE_URL: 'http://u:p@127.0.0.1:4100' })).toThrow('GMAIL_API_BASE_URL');
  });
});
