import { describe, expect, it } from 'vitest';
import { validateEnv } from '../../src/config/env.js';

const live = { RUNTIME_MODE: 'live', DATABASE_URL: 'postgresql://fixture', JWT_SECRET: 'private-test-secret-with-at-least-32-bytes', ENCRYPTION_KEY: 'a'.repeat(32), GEMINI_API_KEY: 'fixture' };
const client = { GMAIL_OAUTH_CLIENT_ID: 'gmail-test-client', GMAIL_OAUTH_CLIENT_SECRET: 'gmail-test-secret', GMAIL_OAUTH_REDIRECT_URI: 'http://localhost:5174/connections/gmail/callback' };
const fake = { GMAIL_OAUTH_AUTH_URL: 'http://127.0.0.1:4100/authorize', GMAIL_OAUTH_TOKEN_URL: 'http://127.0.0.1:4100/token', GMAIL_OAUTH_REVOKE_URL: 'http://127.0.0.1:4100/revoke', GMAIL_API_BASE_URL: 'http://127.0.0.1:4100' };

describe('GMAIL-04 rollout defaults', () => {
  for (const mode of ['live', 'sandbox'] as const) {
    for (const flag of [undefined, 'on', 'off']) {
      for (const setup of ['complete', 'partial', 'absent'] as const) {
        it(`${mode}, Gmail ${flag ?? 'unset'}, ${setup} client`, () => {
          const credentials = setup === 'complete' ? client : setup === 'partial' ? { GMAIL_OAUTH_CLIENT_ID: client.GMAIL_OAUTH_CLIENT_ID } : {};
          const env = { ...(mode === 'live' ? live : { RUNTIME_MODE: 'sandbox' }), ...fake, ...credentials, GMAIL_ENABLED: flag };
          if (mode === 'live' && flag === 'on' && setup !== 'complete') {
            expect(() => validateEnv(env)).toThrow(/is required when GMAIL_ENABLED=on/);
            return;
          }
          const config = validateEnv(env);
          expect(config.GMAIL_ENABLED).toBe(flag === 'on' || (flag === undefined && setup === 'complete'));
          expect(Boolean(config.GMAIL_OAUTH)).toBe(flag !== 'off' && setup === 'complete');
        });
      }
    }
  }

  it.each(Object.keys(fake))('keeps automatic sandbox Gmail off without %s', field => {
    const config = validateEnv({ ...client, ...fake, [field]: '' });
    expect(config.GMAIL_ENABLED).toBe(false);
    expect(config.GMAIL_OAUTH).toBeUndefined();
  });

  it('rejects an invalid complete automatic configuration instead of hiding the error', () => {
    expect(() => validateEnv({ ...live, ...client, GMAIL_OAUTH_REDIRECT_URI: 'https://outside.example/wrong' })).toThrow(/GMAIL_OAUTH_REDIRECT_URI/);
  });

  it.each(['live', 'sandbox'])('defaults read answers on in %s independently of Gmail', mode => {
    const env = mode === 'live' ? live : { RUNTIME_MODE: 'sandbox' };
    expect(validateEnv(env).PLANNER_READ_ANSWERS).toBe(true);
    expect(validateEnv({ ...env, PLANNER_READ_ANSWERS: 'off' }).PLANNER_READ_ANSWERS).toBe(false);
    expect(validateEnv({ ...env, GMAIL_ENABLED: 'off' }).PLANNER_READ_ANSWERS).toBe(true);
  });

  it('lets read answers stay off when automatic Gmail is configured', () => {
    const config = validateEnv({ ...live, ...client, PLANNER_READ_ANSWERS: 'off' });
    expect(config.GMAIL_ENABLED).toBe(true);
    expect(config.PLANNER_READ_ANSWERS).toBe(false);
  });

  it('treats a blank Gmail flag as automatic too', () => {
    expect(validateEnv({ ...live, ...client, GMAIL_ENABLED: '' }).GMAIL_ENABLED).toBe(true);
  });
});
