import type { SlackOAuthConfig } from '../services/slack/oauth-client.js';
const NATIVE_API_BASE_URL = 'https://slack.com/api';
function fixtureEndpoint(value: string): string {
  let url: URL;
  // Node URL parse errors retain the complete input, including credentials.
  // Bootstrap logs configuration errors, so never propagate that error/cause.
  try { url = new URL(value); }
  catch { throw new Error('Slack sandbox endpoints must be literal HTTP loopback'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('Slack sandbox endpoints must be literal HTTP loopback');
  return url.href.replace(/\/$/, '');
}
/** Lifecycle metadata is independent of the content/OAuth-start flags. */
export function slackLifecycleApiBaseUrl(env: Record<string, string | undefined>, live: boolean): string | undefined {
  if (live) return NATIVE_API_BASE_URL;
  return env.MYSLACK_API_BASE_URL ? fixtureEndpoint(env.MYSLACK_API_BASE_URL) : undefined;
}
export function slackOAuthEnv(env: Record<string, string | undefined>, live: boolean): SlackOAuthConfig | undefined {
  if (env.MYSLACK_ENABLED && !['on', 'off'].includes(env.MYSLACK_ENABLED)) throw new Error('MYSLACK_ENABLED must be on or off');
  if (env.MYSLACK_ENABLED !== 'on') return undefined;
  const required = ['MYSLACK_APP_ID', 'MYSLACK_OAUTH_CLIENT_ID', 'MYSLACK_OAUTH_CLIENT_SECRET', 'MYSLACK_OAUTH_REDIRECT_URI'];
  const missing = required.find(k => !env[k]?.trim());
  if (missing) { if (live) throw new Error(`${missing} is required when MYSLACK_ENABLED=on`); return undefined; }
  const redirect = new URL(env.MYSLACK_OAUTH_REDIRECT_URI!.trim());
  if (redirect.username || redirect.password || redirect.search || redirect.hash || redirect.pathname !== '/connections/myslack/callback'
    || (live ? redirect.protocol !== 'https:' : !['http:', 'https:'].includes(redirect.protocol))) throw new Error('MYSLACK_OAUTH_REDIRECT_URI must be the exact HTTPS /connections/myslack/callback URL');
  let authorizationUrl = 'https://slack.com/oauth/v2/authorize', apiBaseUrl = NATIVE_API_BASE_URL;
  if (!live) {
    if (!env.MYSLACK_OAUTH_AUTH_URL || !env.MYSLACK_API_BASE_URL) return undefined;
    authorizationUrl = fixtureEndpoint(env.MYSLACK_OAUTH_AUTH_URL); apiBaseUrl = fixtureEndpoint(env.MYSLACK_API_BASE_URL);
  }
  return { clientId: env.MYSLACK_OAUTH_CLIENT_ID!.trim(), clientSecret: env.MYSLACK_OAUTH_CLIENT_SECRET!.trim(), appId: env.MYSLACK_APP_ID!.trim(), redirectUri: redirect.href, authorizationUrl, apiBaseUrl };
}
