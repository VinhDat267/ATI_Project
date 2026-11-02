import { describe, expect, it } from 'vitest';
import { notionOAuthEnv } from '../../src/config/notion-env.js';
import { validateEnv } from '../../src/config/env.js';

describe('notionOAuthEnv & validateEnv Notion OAuth configuration', () => {
  it('returns undefined when Notion OAuth is not configured or disabled', () => {
    expect(notionOAuthEnv({}, false)).toBeUndefined();
    expect(notionOAuthEnv({ MYNOTION_ENABLED: 'off' }, true)).toBeUndefined();
    expect(() => notionOAuthEnv({ MYNOTION_ENABLED: 'invalid' }, false)).toThrow(
      'MYNOTION_ENABLED must be on or off',
    );
  });

  it('parses NOTION_OAUTH_* and MYNOTION_OAUTH_* in live and sandbox modes', () => {
    const liveCfg = notionOAuthEnv(
      {
        NOTION_OAUTH_CLIENT_ID: 'client-1',
        NOTION_OAUTH_CLIENT_SECRET: 'secret-1',
        NOTION_OAUTH_REDIRECT_URI: 'https://app.example.com/connections/notion/callback',
      },
      true,
    );
    expect(liveCfg).toEqual({
      clientId: 'client-1',
      clientSecret: 'secret-1',
      redirectUri: 'https://app.example.com/connections/notion/callback',
      authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
      apiBaseUrl: 'https://api.notion.com/v1',
    });

    const sandboxCfg = notionOAuthEnv(
      {
        MYNOTION_ENABLED: 'on',
        MYNOTION_OAUTH_CLIENT_ID: 'client-2',
        MYNOTION_OAUTH_CLIENT_SECRET: 'secret-2',
        MYNOTION_OAUTH_REDIRECT_URI: 'http://127.0.0.1:5174/connections/mynotion/callback',
        MYNOTION_OAUTH_AUTH_URL: 'http://127.0.0.1:4100/v1/oauth/authorize',
        MYNOTION_API_BASE_URL: 'http://127.0.0.1:4100/v1/',
      },
      false,
    );
    expect(sandboxCfg).toEqual({
      clientId: 'client-2',
      clientSecret: 'secret-2',
      redirectUri: 'http://127.0.0.1:5174/connections/mynotion/callback',
      authorizationUrl: 'http://127.0.0.1:4100/v1/oauth/authorize',
      apiBaseUrl: 'http://127.0.0.1:4100/v1',
    });
  });

  it('rejects insecure redirect URIs and non-loopback sandbox endpoints', () => {
    expect(() =>
      notionOAuthEnv(
        {
          NOTION_OAUTH_CLIENT_ID: 'c',
          NOTION_OAUTH_CLIENT_SECRET: 's',
          NOTION_OAUTH_REDIRECT_URI: 'http://app.example.com/connections/notion/callback',
        },
        true,
      ),
    ).toThrow(/redirect/i);

    expect(() =>
      notionOAuthEnv(
        {
          NOTION_OAUTH_CLIENT_ID: 'c',
          NOTION_OAUTH_CLIENT_SECRET: 's',
          NOTION_OAUTH_REDIRECT_URI: 'http://127.0.0.1:5174/connections/notion/callback',
          NOTION_OAUTH_AUTH_URL: 'https://api.notion.com/v1/oauth/authorize',
          NOTION_API_BASE_URL: 'https://api.notion.com/v1',
        },
        false,
      ),
    ).toThrow(/loopback/i);
  });

  it('wires NOTION_OAUTH into validateEnv and checks web origin consistency', () => {
    const parsed = validateEnv({
      NODE_ENV: 'test',
      APP_BASE_URL: 'http://127.0.0.1:5174',
      NOTION_OAUTH_CLIENT_ID: 'c-id',
      NOTION_OAUTH_CLIENT_SECRET: 'c-sec',
      NOTION_OAUTH_REDIRECT_URI: 'http://127.0.0.1:5174/connections/notion/callback',
      NOTION_OAUTH_AUTH_URL: 'http://127.0.0.1:4100/v1/oauth/authorize',
      NOTION_API_BASE_URL: 'http://127.0.0.1:4100/v1',
    });
    expect(parsed.NOTION_OAUTH?.clientId).toBe('c-id');

    expect(() =>
      validateEnv({
        NODE_ENV: 'test',
        APP_BASE_URL: 'http://127.0.0.1:5174',
        NOTION_OAUTH_CLIENT_ID: 'c-id',
        NOTION_OAUTH_CLIENT_SECRET: 'c-sec',
        NOTION_OAUTH_REDIRECT_URI: 'https://evil.example.com/connections/notion/callback',
        NOTION_OAUTH_AUTH_URL: 'http://127.0.0.1:4100/v1/oauth/authorize',
        NOTION_API_BASE_URL: 'http://127.0.0.1:4100/v1',
      }),
    ).toThrow(/Web origin mismatch/i);
  });
});
