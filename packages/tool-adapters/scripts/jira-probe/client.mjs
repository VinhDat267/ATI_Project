const MAX_BYTES = 65_536;
const cloudIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

export class ProbeError extends Error {
  constructor(code) { super(`Jira probe: ${code}`); this.name = 'ProbeError'; this.code = code; }
}

export function createProbeClient(config) {
  let redirect, fixture;
  try {
    redirect = new URL(config.redirectUri);
    if (!nonempty(config.clientId) || !nonempty(config.clientSecret) || !['live', 'fixture'].includes(config.mode) || redirect.username || redirect.password || redirect.search || redirect.hash) throw 0;
    if (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && redirect.hostname === '127.0.0.1')) throw 0;
    if (config.mode === 'fixture') {
      fixture = new URL(config.fixtureBaseUrl);
      if (fixture.protocol !== 'http:' || fixture.hostname !== '127.0.0.1' || fixture.username || fixture.password || fixture.pathname !== '/' || fixture.search || fixture.hash) throw 0;
    } else if (config.fixtureBaseUrl !== undefined) throw 0;
  } catch { throw new ProbeError('INVALID_CONFIG'); }
  const timeoutMs = config.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) throw new ProbeError('INVALID_CONFIG');
  const authBase = fixture?.origin ?? 'https://auth.atlassian.com';
  const apiBase = fixture?.origin ?? 'https://api.atlassian.com';

  async function request(url, { token, body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const chunks = []; let size = 0;
      if (response.body) for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > MAX_BYTES) { controller.abort(); throw new ProbeError('PROVIDER_RESPONSE'); }
        chunks.push(chunk);
      }
      let value;
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ProbeError('PROVIDER_RESPONSE'); }
      if (!response.ok) throw new ProbeError(value?.error === 'invalid_grant' ? 'INVALID_GRANT' : response.status === 401 || response.status === 403 ? 'PROVIDER_AUTH' : 'PROVIDER_REJECTED');
      return value;
    } catch (error) {
      if (error instanceof ProbeError) throw error;
      throw new ProbeError(controller.signal.aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK');
    } finally { clearTimeout(timer); }
  }

  function tokens(value) {
    if (!object(value) || !nonempty(value.access_token) || !Number.isFinite(value.expires_in) || value.expires_in <= 0 ||
      (value.refresh_token !== undefined && !nonempty(value.refresh_token)) || (value.scope !== undefined && typeof value.scope !== 'string')) throw new ProbeError('PROVIDER_RESPONSE');
    return { accessToken: value.access_token, refreshToken: value.refresh_token, expiresInSeconds: value.expires_in, scopes: typeof value.scope === 'string' ? value.scope.split(/\s+/).filter(Boolean) : [] };
  }

  return {
    authorizationUrl({ state, scopes }) {
      if (!nonempty(state) || !Array.isArray(scopes) || !scopes.length || !scopes.every(s => nonempty(s) && !/\s/.test(s))) throw new ProbeError('INVALID_INPUT');
      const url = new URL('/authorize', authBase);
      for (const [key, value] of Object.entries({ audience: 'api.atlassian.com', client_id: config.clientId, redirect_uri: redirect.href, response_type: 'code', scope: scopes.join(' '), state, prompt: 'consent' })) url.searchParams.set(key, value);
      return url.href;
    },
    async exchangeCode(code) {
      if (!nonempty(code)) throw new ProbeError('INVALID_INPUT');
      return tokens(await request(`${authBase}/oauth/token`, { body: { grant_type: 'authorization_code', client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: redirect.href } }));
    },
    async refresh(refreshToken) {
      if (!nonempty(refreshToken)) throw new ProbeError('INVALID_INPUT');
      return tokens(await request(`${authBase}/oauth/token`, { body: { grant_type: 'refresh_token', client_id: config.clientId, client_secret: config.clientSecret, refresh_token: refreshToken } }));
    },
    async profile(accessToken) {
      const value = await request(`${apiBase}/me`, { token: accessToken });
      if (!object(value) || !nonempty(value.account_id)) throw new ProbeError('PROVIDER_RESPONSE');
      return { accountId: value.account_id };
    },
    async resources(accessToken) {
      const value = await request(`${apiBase}/oauth/token/accessible-resources`, { token: accessToken });
      if (!Array.isArray(value)) throw new ProbeError('PROVIDER_RESPONSE');
      const sites = [];
      for (const item of value) {
        if (!object(item) || !Array.isArray(item.scopes) || !item.scopes.every(s => typeof s === 'string')) throw new ProbeError('PROVIDER_RESPONSE');
        if (!item.scopes.some(s => s.endsWith(':jira') || s.startsWith('read:jira-') || s.startsWith('write:jira-') || s.startsWith('manage:jira-'))) continue;
        if (!nonempty(item.id) || !cloudIdPattern.test(item.id) || !nonempty(item.name) || typeof item.url !== 'string' || !/^https:\/\/[a-z0-9-]+\.atlassian\.net\/?$/.test(item.url)) throw new ProbeError('PROVIDER_RESPONSE');
        sites.push({ id: item.id, name: item.name, url: item.url.replace(/\/$/, ''), scopes: [...item.scopes] });
      }
      return sites;
    },
    async permissions(accessToken, cloudId) {
      if (typeof cloudId !== 'string' || !cloudIdPattern.test(cloudId)) throw new ProbeError('INVALID_INPUT');
      const value = await request(`${apiBase}/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3/mypermissions?permissions=ADMINISTER`, { token: accessToken });
      const allowed = value?.permissions?.ADMINISTER?.havePermission;
      if (typeof allowed !== 'boolean') throw new ProbeError('PROVIDER_RESPONSE');
      return { administer: allowed };
    },
  };
}
