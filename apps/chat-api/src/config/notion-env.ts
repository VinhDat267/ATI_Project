import type { NotionOAuthConfig } from '../services/notion/oauth-client.js';
export function notionOAuthEnv(env: Record<string, string | undefined>, live: boolean): NotionOAuthConfig | undefined {
  if (env.MYNOTION_ENABLED && !['on', 'off'].includes(env.MYNOTION_ENABLED)) throw new Error('MYNOTION_ENABLED must be on or off');
  if (env.MYNOTION_ENABLED !== 'on') return undefined;
  const required = ['MYNOTION_OAUTH_CLIENT_ID', 'MYNOTION_OAUTH_CLIENT_SECRET', 'MYNOTION_OAUTH_REDIRECT_URI'];
  const missing = required.find(k => !env[k]?.trim());
  if (missing) { if (live) throw new Error(`${missing} is required when MYNOTION_ENABLED=on`); return undefined; }
  const redirect = new URL(env.MYNOTION_OAUTH_REDIRECT_URI!.trim());
  if (redirect.username || redirect.password || redirect.search || redirect.hash || redirect.pathname !== '/connections/mynotion/callback'
    || (live ? redirect.protocol !== 'https:' : !['http:', 'https:'].includes(redirect.protocol))) throw new Error('MYNOTION_OAUTH_REDIRECT_URI must be the exact HTTPS /connections/mynotion/callback URL');
  let authorizationUrl = 'https://api.notion.com/v1/oauth/authorize', apiBaseUrl = 'https://api.notion.com/v1';
  if (!live) {
    if (!env.MYNOTION_OAUTH_AUTH_URL || !env.MYNOTION_API_BASE_URL) return undefined;
    const fixture = (value: string) => {
      const url = new URL(value);
      if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('Notion sandbox endpoints must be literal HTTP loopback');
      return url.href.replace(/\/$/, '');
    };
    authorizationUrl = fixture(env.MYNOTION_OAUTH_AUTH_URL); apiBaseUrl = fixture(env.MYNOTION_API_BASE_URL);
  }
  return { clientId: env.MYNOTION_OAUTH_CLIENT_ID!.trim(), clientSecret: env.MYNOTION_OAUTH_CLIENT_SECRET!.trim(), redirectUri: redirect.href, authorizationUrl, apiBaseUrl };
}
