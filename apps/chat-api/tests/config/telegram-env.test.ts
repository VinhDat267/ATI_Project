import { describe, expect, it } from 'vitest';
import { validateEnv } from '../../src/config/env.js';

const telegram = {
  TELEGRAM_BOT_TOKEN: '123456789:AAH_synthetic_bot_token_1234567890',
  TELEGRAM_BOT_USERNAME: '@ati_workflow_bot',
  TELEGRAM_WEB_CALLBACK_URL: 'http://127.0.0.1:5174/connections/telegram/callback',
};

const fake = {
  TELEGRAM_API_BASE_URL: 'http://127.0.0.1:4100',
  TELEGRAM_DEEPLINK_BASE_URL: 'http://127.0.0.1:4100/tme',
};

const live = {
  RUNTIME_MODE: 'live',
  DATABASE_URL: 'postgresql://local',
  JWT_SECRET: 'private-secret-at-least-32-characters',
  ENCRYPTION_KEY: 'a'.repeat(32),
  GEMINI_API_KEY: 'fake-for-validation',
};

describe('Telegram Bot 1-Click Pairing configuration', () => {
  it('pins the real Telegram endpoints in live mode and strips leading @ from botUsername', () => {
    const config = validateEnv({
      ...live,
      ...telegram,
      TELEGRAM_WEB_CALLBACK_URL: 'https://ati.example/connections/telegram/callback',
    });
    expect(config.TELEGRAM_BOT).toEqual({
      botToken: '123456789:AAH_synthetic_bot_token_1234567890',
      botUsername: 'ati_workflow_bot',
      callbackUrl: 'https://ati.example/connections/telegram/callback',
      apiBaseUrl: 'https://api.telegram.org',
      deepLinkBaseUrl: 'https://t.me',
    });
  });

  it('leaves TELEGRAM_BOT undefined in sandbox mode when TELEGRAM_API_BASE_URL is not explicitly set', () => {
    expect(validateEnv({ ...telegram, RUNTIME_MODE: 'sandbox' }).TELEGRAM_BOT).toBeUndefined();
    const withFakeApi = validateEnv({
      ...telegram,
      TELEGRAM_API_BASE_URL: fake.TELEGRAM_API_BASE_URL,
      RUNTIME_MODE: 'sandbox',
    });
    expect(withFakeApi.TELEGRAM_BOT).toEqual({
      botToken: '123456789:AAH_synthetic_bot_token_1234567890',
      botUsername: 'ati_workflow_bot',
      callbackUrl: 'http://127.0.0.1:5174/connections/telegram/callback',
      apiBaseUrl: 'http://127.0.0.1:4100',
      deepLinkBaseUrl: 'https://t.me',
    });
  });

  it('leaves TELEGRAM_BOT undefined if any required variable is missing, empty, or malformed token/username', () => {
    expect(validateEnv({}).TELEGRAM_BOT).toBeUndefined();
    for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEB_CALLBACK_URL']) {
      expect(validateEnv({ ...telegram, ...fake, [key]: undefined }).TELEGRAM_BOT).toBeUndefined();
      expect(validateEnv({ ...telegram, ...fake, [key]: '' }).TELEGRAM_BOT).toBeUndefined();
      expect(validateEnv({ ...telegram, ...fake, [key]: '   ' }).TELEGRAM_BOT).toBeUndefined();
    }
    expect(validateEnv({ ...telegram, ...fake, TELEGRAM_BOT_TOKEN: 'bad-token' }).TELEGRAM_BOT).toBeUndefined();
    expect(validateEnv({ ...telegram, ...fake, TELEGRAM_BOT_USERNAME: 'ab' }).TELEGRAM_BOT).toBeUndefined();
    expect(validateEnv({ ...telegram, ...fake, TELEGRAM_BOT_USERNAME: '123bot' }).TELEGRAM_BOT).toBeUndefined();
  });

  it('rejects callback URL with query, fragment, userinfo, wrong path, or non-loopback HTTP', () => {
    const invalidCallbacks = [
      'http://127.0.0.1:5174/connections/telegram/callback?state=foo',
      'http://127.0.0.1:5174/connections/telegram/callback#frag',
      'http://user:pass@127.0.0.1:5174/connections/telegram/callback',
      'ftp://127.0.0.1:5174/connections/telegram/callback',
      'http://example.com/connections/telegram/callback',
      'http://127.0.0.1:5174/wrong/path',
      'not-a-valid-url',
    ];
    for (const uri of invalidCallbacks) {
      expect(
        () => validateEnv({ ...telegram, ...fake, TELEGRAM_WEB_CALLBACK_URL: uri }),
        `Should reject: ${uri}`,
      ).toThrow('TELEGRAM_WEB_CALLBACK_URL');
    }
  });

  it('allows overriding apiBaseUrl and deepLinkBaseUrl in non-live mode and ignores overrides in live mode', () => {
    const sandboxConfig = validateEnv({ ...telegram, ...fake });
    expect(sandboxConfig.TELEGRAM_BOT?.apiBaseUrl).toBe('http://127.0.0.1:4100');
    expect(sandboxConfig.TELEGRAM_BOT?.deepLinkBaseUrl).toBe('http://127.0.0.1:4100/tme');

    const liveConfig = validateEnv({
      ...live,
      ...telegram,
      ...fake,
      TELEGRAM_WEB_CALLBACK_URL: 'https://ati.example/connections/telegram/callback',
    });
    expect(liveConfig.TELEGRAM_BOT?.apiBaseUrl).toBe('https://api.telegram.org');
    expect(liveConfig.TELEGRAM_BOT?.deepLinkBaseUrl).toBe('https://t.me');
  });

  it('rejects malformed endpoint overrides in non-live mode', () => {
    expect(() => validateEnv({ ...telegram, TELEGRAM_API_BASE_URL: 'not-a-url' })).toThrow('TELEGRAM_API_BASE_URL');
    expect(() => validateEnv({ ...telegram, ...fake, TELEGRAM_DEEPLINK_BASE_URL: 'http://user:pass@127.0.0.1:4100' })).toThrow(
      'TELEGRAM_DEEPLINK_BASE_URL',
    );
  });
});
