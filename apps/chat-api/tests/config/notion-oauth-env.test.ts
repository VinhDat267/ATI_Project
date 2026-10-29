import { describe, expect, it } from 'vitest';
import { notionOAuthEnv } from '../../src/config/notion-env.js';
describe('Notion OAuth config is opt-in and sandbox never points at live Notion', () => {
  const complete = { MYNOTION_ENABLED: 'on', MYNOTION_APP_ID: 'A_APP', MYNOTION_OAUTH_CLIENT_ID: 'CLIENT', MYNOTION_OAUTH_CLIENT_SECRET: 'SECRET', MYNOTION_OAUTH_REDIRECT_URI: 'https://ati.example/connections/mynotion/callback' };
  it('is absent by default/off', () => { expect(notionOAuthEnv({}, true)).toBeUndefined(); expect(notionOAuthEnv({ ...complete, MYNOTION_ENABLED: 'off' }, true)).toBeUndefined(); });
  it('requires complete config and exact HTTPS callback in live', () => {
    expect(() => notionOAuthEnv({ MYNOTION_ENABLED: 'on' }, true)).toThrow();
    expect(() => notionOAuthEnv({ ...complete, MYNOTION_OAUTH_REDIRECT_URI: 'http://127.0.0.1:5174/connections/mynotion/callback' }, true)).toThrow();
    expect(() => notionOAuthEnv({ ...complete, MYNOTION_OAUTH_REDIRECT_URI: 'https://ati.example/connections/mynotion/callback?code=x' }, true)).toThrow();
  });
  it('live endpoints cannot be overridden', () => { expect(notionOAuthEnv({ ...complete, MYNOTION_API_BASE_URL: 'http://127.0.0.1:1' }, true)?.apiBaseUrl).toBe('https://api.notion.com/v1'); });
  it('sandbox requires all loopback endpoints', () => {
    expect(notionOAuthEnv(complete, false)).toBeUndefined();
    expect(() => notionOAuthEnv({ ...complete, MYNOTION_OAUTH_AUTH_URL: 'https://api.notion.com/v1/oauth/authorize', MYNOTION_API_BASE_URL: 'http://127.0.0.1:1' }, false)).toThrow();
    expect(notionOAuthEnv({ ...complete, MYNOTION_OAUTH_AUTH_URL: 'http://127.0.0.1:1/authorize', MYNOTION_API_BASE_URL: 'http://127.0.0.1:1/api' }, false)).toBeDefined();
  });
});
