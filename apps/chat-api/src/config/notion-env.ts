export interface NotionOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationUrl: string;
  apiBaseUrl: string;
}

export const NOTION_ENDPOINTS = {
  authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
  apiBaseUrl: 'https://api.notion.com/v1',
};

export function notionOAuthEnv(
  env: Record<string, string | undefined>,
  isLive: boolean,
): NotionOAuthConfig | undefined {
  if (env.MYNOTION_ENABLED && !['on', 'off'].includes(env.MYNOTION_ENABLED)) {
    throw new Error('MYNOTION_ENABLED must be on or off');
  }
  if (env.MYNOTION_ENABLED === 'off') return undefined;

  const clientId = (env.NOTION_OAUTH_CLIENT_ID ?? env.MYNOTION_OAUTH_CLIENT_ID)?.trim();
  const clientSecret = (env.NOTION_OAUTH_CLIENT_SECRET ?? env.MYNOTION_OAUTH_CLIENT_SECRET)?.trim();
  const rawRedirect = (env.NOTION_OAUTH_REDIRECT_URI ?? env.MYNOTION_OAUTH_REDIRECT_URI)?.trim();
  const explicitOn = env.MYNOTION_ENABLED === 'on';

  if (!clientId || !clientSecret || !rawRedirect) {
    if (explicitOn && isLive) {
      const missing = !clientId
        ? 'NOTION_OAUTH_CLIENT_ID'
        : !clientSecret
          ? 'NOTION_OAUTH_CLIENT_SECRET'
          : 'NOTION_OAUTH_REDIRECT_URI';
      throw new Error(`${missing} is required when MYNOTION_ENABLED=on`);
    }
    return undefined;
  }

  let redirectUri: string;
  try {
    const url = new URL(rawRedirect);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    const validPath =
      url.pathname === '/connections/notion/callback' ||
      url.pathname === '/connections/mynotion/callback';
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      (isLive && url.protocol !== 'https:' && !loopback) ||
      url.username ||
      url.password ||
      !validPath ||
      url.search ||
      url.hash
    ) {
      throw new Error();
    }
    redirectUri = url.href;
  } catch {
    throw new Error(
      'NOTION_OAUTH_REDIRECT_URI must be the web /connections/notion/callback URL without query, fragment or credentials',
    );
  }

  const endpoints = { ...NOTION_ENDPOINTS };
  const rawAuthUrl = (env.NOTION_OAUTH_AUTH_URL ?? env.MYNOTION_OAUTH_AUTH_URL)?.trim();
  const rawApiBaseUrl = (env.NOTION_API_BASE_URL ?? env.MYNOTION_API_BASE_URL)?.trim();

  if (!isLive) {
    if (!rawAuthUrl || !rawApiBaseUrl) return undefined;
    for (const [key, field, value] of [
      ['authorizationUrl', 'NOTION_OAUTH_AUTH_URL', rawAuthUrl],
      ['apiBaseUrl', 'NOTION_API_BASE_URL', rawApiBaseUrl],
    ] as const) {
      try {
        const url = new URL(value);
        const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
        if (url.protocol !== 'http:' || !loopback || url.username || url.password || url.search || url.hash) {
          throw new Error();
        }
        endpoints[key] = url.href.replace(/\/$/, '');
      } catch {
        throw new Error(`${field} must be a literal loopback HTTP endpoint without query, fragment or credentials`);
      }
    }
  } else {
    for (const [key, field, value] of [
      ['authorizationUrl', 'NOTION_OAUTH_AUTH_URL', rawAuthUrl],
      ['apiBaseUrl', 'NOTION_API_BASE_URL', rawApiBaseUrl],
    ] as const) {
      if (!value) continue;
      try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
          throw new Error();
        }
        endpoints[key] = url.href.replace(/\/$/, '');
      } catch {
        throw new Error(`${field} must be an HTTPS endpoint without query, fragment or credentials`);
      }
    }
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    ...endpoints,
  };
}
