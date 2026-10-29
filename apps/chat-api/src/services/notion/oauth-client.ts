import { NOTION_ID_PATTERN, normalizeNotionId } from '@wap/tool-schemas';
export interface NotionOAuthConfig { clientId: string; clientSecret: string; redirectUri: string; authorizationUrl: string; apiBaseUrl: string }
export interface NotionGrant { appId: string; workspaceId: string; workspaceName: string; actorId: string; botId: string; accessToken: string; refreshToken?: string; scopes: string[] }
export class NotionOAuthError extends Error {
  constructor(readonly authenticationLost = false) { super('NOTION_PROVIDER_FAILED'); }
}
const id = (value: unknown): string => { if (typeof value !== 'string' || !NOTION_ID_PATTERN.test(value)) throw new NotionOAuthError(); return normalizeNotionId(value); };
const token = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length < 8192;
export class NotionOAuthClient {
  constructor(readonly config: NotionOAuthConfig, private fetchFn: typeof fetch = fetch) {}
  authorizationUrl(state: string): string {
    const url = new URL(this.config.authorizationUrl);
    url.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.config.redirectUri, response_type: 'code', owner: 'user', state }).toString(); return url.href;
  }
  private async request(path: string, signal: AbortSignal, accessToken?: string, body?: object): Promise<any> {
    try {
      const r = await this.fetchFn(`${this.config.apiBaseUrl}/${path}`, { method: body ? 'POST' : 'GET', signal, redirect: 'error',
        headers: { Authorization: accessToken ? 'Bearer ' + accessToken : 'Basic ' + Buffer.from(this.config.clientId + ':' + this.config.clientSecret).toString('base64'),
          'Notion-Version': '2026-03-11', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const reader = r.body?.getReader(); if (!reader) throw new Error(); const chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 524288) throw new Error(); chunks.push(value); } }
      finally { await reader.cancel().catch(() => {}); }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (!r.ok || data.object === 'error') throw new NotionOAuthError(r.status === 401 || data.code === 'invalid_grant');
      return data;
    } catch (e) { throw e instanceof NotionOAuthError ? e : new NotionOAuthError(); }
  }
  async verify(accessToken: string, botId: string, signal: AbortSignal): Promise<void> {
    const me = await this.request('users/me', signal, accessToken);
    if (me.object !== 'user' || me.type !== 'bot' || id(me.id) !== id(botId)) throw new NotionOAuthError(true);
  }
  private async grant(data: any, signal: AbortSignal): Promise<NotionGrant> {
    if (data.token_type !== 'bearer' || !token(data.access_token) || data.owner?.type !== 'user') throw new NotionOAuthError();
    const workspaceId = id(data.workspace_id), botId = id(data.bot_id), actorId = id(data.owner.user?.id);
    await this.verify(data.access_token, botId, signal);
    return { appId: this.config.clientId, workspaceId, workspaceName: typeof data.workspace_name === 'string' ? data.workspace_name.slice(0, 200) : workspaceId,
      botId, actorId, accessToken: data.access_token, ...(token(data.refresh_token) ? { refreshToken: data.refresh_token } : {}), scopes: [] };
  }
  async exchange(code: string, signal: AbortSignal): Promise<NotionGrant> {
    return this.grant(await this.request('oauth/token', signal, undefined, { grant_type: 'authorization_code', code, redirect_uri: this.config.redirectUri }), signal);
  }
  async refresh(refreshToken: string, signal: AbortSignal): Promise<NotionGrant> {
    return this.grant(await this.request('oauth/token', signal, undefined, { grant_type: 'refresh_token', refresh_token: refreshToken }), signal);
  }
  async revoke(accessToken: string, signal: AbortSignal): Promise<void> { await this.request('oauth/revoke', signal, undefined, { token: accessToken }); }
  async databases(accessToken: string, query: string, signal: AbortSignal): Promise<{ databases: Array<{ id: string; title: string }>; hasMore: boolean }> {
    const data = await this.request('search', signal, accessToken, { query: query.slice(0, 200), filter: { value: 'data_source', property: 'object' }, page_size: 20 });
    if (!Array.isArray(data.results) || typeof data.has_more !== 'boolean') throw new NotionOAuthError();
    const found = new Map<string, string>();
    for (const source of data.results) {
      if (source.object !== 'data_source' || source.in_trash === true || source.archived === true) continue;
      const databaseId = id(source.parent?.database_id);
      found.set(databaseId, this.title(source.title) || databaseId);
    }
    return { databases: [...found].map(([id, title]) => ({ id, title })), hasMore: data.has_more };
  }
  private title(value: unknown): string { return Array.isArray(value) ? value.map(v => typeof v?.plain_text === 'string' ? v.plain_text : v?.text?.content ?? '').join('').slice(0, 200) : ''; }
  async validateDatabases(accessToken: string, ids: string[], signal: AbortSignal): Promise<Array<{ id: string; title: string }>> {
    if (!ids.length || ids.length > 10 || new Set(ids).size !== ids.length) throw new NotionOAuthError();
    const result = [];
    for (const value of ids) {
      const databaseId = id(value), data = await this.request('databases/' + databaseId, signal, accessToken);
      if (data.object !== 'database' || id(data.id) !== databaseId || data.in_trash || data.archived) throw new NotionOAuthError();
      result.push({ id: databaseId, title: this.title(data.title) || databaseId });
    }
    return result;
  }
}
