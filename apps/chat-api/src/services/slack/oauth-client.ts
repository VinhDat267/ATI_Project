/** Metadata-only until SLACK-03 enforces content/model authorization. */
export const SLACK_USER_SCOPES = ['channels:read', 'groups:read', 'im:read', 'mpim:read', 'channels:history', 'groups:history', 'im:history', 'mpim:history', 'search:read', 'chat:write'];
export interface SlackOAuthConfig {
  clientId: string; clientSecret: string; appId: string; redirectUri: string;
  authorizationUrl: string; apiBaseUrl: string;
}
export interface SlackGrant {
  appId: string; workspaceId: string; workspaceName: string; actorId: string;
  accessToken: string; refreshToken?: string; expiresIn?: number; scopes: string[]; missingScopes: string[];
}
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 8192;
export type SlackProviderAuthCode = 'invalid_auth' | 'token_revoked' | 'token_expired' | 'account_inactive' | 'invalid_grant' | 'identity_mismatch' | 'unknown';
export class SlackProviderError extends Error {
  constructor(readonly authenticationLost: boolean, readonly authCode: SlackProviderAuthCode = 'unknown') { super('SLACK_PROVIDER_FAILED'); }
}
/** Metadata verification does not require OAuth installation credentials. */
export class SlackIdentityClient {
  constructor(private readonly apiBaseUrl: string, private fetchFn: typeof fetch = fetch) {}
  protected async call(method: string, body: URLSearchParams, signal: AbortSignal, token?: string): Promise<any> {
    try {
      const response = await this.fetchFn(`${this.apiBaseUrl}/${method}`, { method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body });
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 131072) throw new Error(); chunks.push(value); }
      } finally { await reader.cancel().catch(() => {}); }
      const raw = Buffer.concat(chunks).toString('utf8');
      const data = JSON.parse(raw);
      if (!response.ok || data.ok !== true) {
        const lost = response.status < 500 && response.status !== 429 &&
          ['invalid_auth', 'token_revoked', 'token_expired', 'account_inactive', 'invalid_grant'].includes(data.error);
        throw new SlackProviderError(lost, lost ? data.error as SlackProviderAuthCode : 'unknown');
      }
      return data;
    } catch (e) { throw e instanceof SlackProviderError ? e : new SlackProviderError(false); }
  }
  async verify(accessToken: string, workspaceId: string, actorId: string, signal: AbortSignal): Promise<void> {
    const data = await this.call('auth.test', new URLSearchParams(), signal, accessToken);
    const identity = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value);
    // Missing/malformed metadata proves nothing about credential validity. In
    // particular, it must never authorize destructive lifecycle processing.
    if (!identity(data.team_id) || !identity(data.user_id) || (data.bot_id !== undefined && !identity(data.bot_id))) {
      throw new SlackProviderError(false);
    }
    if (data.team_id !== workspaceId || data.user_id !== actorId || data.bot_id) throw new SlackProviderError(true, 'identity_mismatch');
  }
}
export class SlackOAuthClient extends SlackIdentityClient {
  constructor(readonly config: SlackOAuthConfig, fetchFn: typeof fetch = fetch) { super(config.apiBaseUrl, fetchFn); }
  authorizationUrl(state: string, team?: string): string {
    const url = new URL(this.config.authorizationUrl);
    const params: Record<string, string> = {
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      state,
      user_scope: SLACK_USER_SCOPES.join(','),
    };
    if (team && typeof team === 'string' && team.trim()) {
      params.team = team.trim();
    }
    url.search = new URLSearchParams(params).toString();
    return url.href;
  }
  async exchange(code: string, signal: AbortSignal): Promise<SlackGrant> {
    const data = await this.call('oauth.v2.access', new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, redirect_uri: this.config.redirectUri, code }), signal);
    const user = data.authed_user;
    if (data.app_id !== this.config.appId || !text(data.team?.id) || !text(user?.id) || user.token_type !== 'user' || !text(user.access_token)) throw new Error('SLACK_IDENTITY_MISMATCH');
    const verified = await this.call('auth.test', new URLSearchParams(), signal, user.access_token);
    if (verified.team_id !== data.team.id || verified.user_id !== user.id || verified.bot_id) throw new Error('SLACK_IDENTITY_MISMATCH');
    const scopes = typeof user.scope === 'string' ? user.scope.split(',').filter(Boolean) : [];
    const rotating = user.expires_in !== undefined || user.refresh_token !== undefined;
    if (rotating && (!text(user.refresh_token) || !Number.isSafeInteger(user.expires_in) || user.expires_in <= 0)) throw new Error('SLACK_ROTATION_INVALID');
    return { appId: data.app_id, workspaceId: data.team.id, workspaceName: text(data.team.name) ? data.team.name : data.team.id,
      actorId: user.id, accessToken: user.access_token, ...(rotating ? { refreshToken: user.refresh_token, expiresIn: user.expires_in } : {}),
      scopes, missingScopes: SLACK_USER_SCOPES.filter(s => !scopes.includes(s)) };
  }
  async refresh(refreshToken: string, signal: AbortSignal): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const data = await this.call('oauth.v2.access', new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }), signal);
    if (data.token_type !== 'user' || !text(data.access_token) || !text(data.refresh_token) || !Number.isSafeInteger(data.expires_in) || data.expires_in <= 0) throw new Error('SLACK_ROTATION_INVALID');
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
  }
  async revoke(accessToken: string, signal: AbortSignal): Promise<void> {
    const data = await this.call('auth.revoke', new URLSearchParams(), signal, accessToken);
    if (data.revoked !== true) throw new Error('SLACK_REVOKE_FAILED');
  }
}
