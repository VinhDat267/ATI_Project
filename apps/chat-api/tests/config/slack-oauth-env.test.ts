import { describe, expect, it } from 'vitest';
import { slackOAuthEnv } from '../../src/config/slack-env.js';
describe('Slack OAuth config is opt-in and sandbox never points at live Slack', () => {
  const complete = { MYSLACK_ENABLED: 'on', MYSLACK_APP_ID: 'A_APP', MYSLACK_OAUTH_CLIENT_ID: 'CLIENT', MYSLACK_OAUTH_CLIENT_SECRET: 'SECRET', MYSLACK_OAUTH_REDIRECT_URI: 'https://ati.example/connections/myslack/callback' };
  it('is absent by default/off', () => { expect(slackOAuthEnv({}, true)).toBeUndefined(); expect(slackOAuthEnv({ ...complete, MYSLACK_ENABLED: 'off' }, true)).toBeUndefined(); });
  it('requires complete config and exact HTTPS callback in live', () => {
    expect(() => slackOAuthEnv({ MYSLACK_ENABLED: 'on' }, true)).toThrow();
    expect(() => slackOAuthEnv({ ...complete, MYSLACK_OAUTH_REDIRECT_URI: 'http://127.0.0.1:5174/connections/myslack/callback' }, true)).toThrow();
    expect(() => slackOAuthEnv({ ...complete, MYSLACK_OAUTH_REDIRECT_URI: 'https://ati.example/connections/myslack/callback?code=x' }, true)).toThrow();
  });
  it('live endpoints cannot be overridden', () => { expect(slackOAuthEnv({ ...complete, MYSLACK_API_BASE_URL: 'http://127.0.0.1:1' }, true)?.apiBaseUrl).toBe('https://slack.com/api'); });
  it('sandbox requires all loopback endpoints', () => {
    expect(slackOAuthEnv(complete, false)).toBeUndefined();
    expect(() => slackOAuthEnv({ ...complete, MYSLACK_OAUTH_AUTH_URL: 'https://slack.com/oauth/v2/authorize', MYSLACK_API_BASE_URL: 'http://127.0.0.1:1' }, false)).toThrow();
    expect(slackOAuthEnv({ ...complete, MYSLACK_OAUTH_AUTH_URL: 'http://127.0.0.1:1/authorize', MYSLACK_API_BASE_URL: 'http://127.0.0.1:1/api' }, false)).toBeDefined();
  });
});
