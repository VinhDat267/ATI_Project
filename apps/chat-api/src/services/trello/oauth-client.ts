import type { TrelloOAuthConfig } from '../../config/env.js';

export const TRELLO_OAUTH_SCOPE = 'read:board:trello write:board:trello read:member:trello read:organization:trello offline_access';

export class TrelloOAuthError extends Error {
  constructor(
    readonly kind: 'invalid_grant' | 'rejected' | 'network' | 'server',
    readonly status?: number
  ) {
    super(`Trello OAuth request failed: ${kind}${status ? ` (${status})` : ''}`);
    this.name = 'TrelloOAuthError';
  }
}

export interface TrelloTokens {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
}

export interface TrelloMember {
  id: string;
  username: string;
}

export interface TrelloWorkspace {
  id: string;
  name: string;
}

export interface TrelloBoardSummary {
  id: string;
  name: string;
  workspaceId: string;
  member: boolean;
}

const MAX_BODY_CHARS = 64_000;

export class TrelloOAuthClient {
  constructor(
    private config: TrelloOAuthConfig,
    private fetchFn: typeof fetch = fetch
  ) {}

  authorizationUrl(input: { state: string; codeChallenge: string }): string {
    const url = new URL(this.config.authorizationUrl);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('scope', TRELLO_OAUTH_SCOPE);
    url.searchParams.set('state', input.state);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.href;
  }

  async exchangeCode(
    code: string,
    codeVerifier: string,
    signal: AbortSignal
  ): Promise<TrelloTokens> {
    const body = await this.post(
      this.config.tokenUrl,
      {
        grant_type: 'authorization_code',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri,
        code_verifier: codeVerifier,
      },
      signal
    );
    return this.parseTokens(body);
  }

  async refresh(
    refreshToken: string,
    signal: AbortSignal
  ): Promise<TrelloTokens> {
    const body = await this.post(
      this.config.tokenUrl,
      {
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: refreshToken,
      },
      signal
    );
    return this.parseTokens(body);
  }

  async member(accessToken: string, signal: AbortSignal): Promise<TrelloMember> {
    const body = await this.send(`${this.config.apiBaseUrl}/members/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    });
    if (typeof body?.id !== 'string' || !body.id || typeof body?.username !== 'string' || !body.username) {
      throw new TrelloOAuthError('server');
    }
    return { id: body.id, username: body.username };
  }

  async workspaces(accessToken: string, signal: AbortSignal): Promise<TrelloWorkspace[]> {
    const body = await this.send(`${this.config.apiBaseUrl}/members/me/organizations`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    });
    const items = Array.isArray(body) ? body : [];
    return items.map((org: any) => ({
      id: String(org.id),
      name: String(org.displayName || org.name || ''),
    }));
  }

  async boards(
    accessToken: string,
    workspaceId: string,
    signal: AbortSignal
  ): Promise<TrelloBoardSummary[]> {
    const body = await this.send(`${this.config.apiBaseUrl}/members/me/boards`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    });
    const items = Array.isArray(body) ? body : [];
    return items
      .filter((b: any) => b && b.idOrganization === workspaceId)
      .map((b: any) => ({
        id: String(b.id),
        name: String(b.name || ''),
        workspaceId: String(b.idOrganization),
        member: b.member !== undefined ? Boolean(b.member) : true,
      }));
  }

  private post(url: string, fields: Record<string, any>, signal: AbortSignal) {
    return this.send(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
      signal,
    });
  }

  private async send(url: string, init: RequestInit & { signal: AbortSignal }): Promise<any> {
    if (init.signal?.aborted) {
      throw new TrelloOAuthError('network');
    }

    let response: Response;
    try {
      response = await this.fetchFn(url, { ...init, redirect: 'manual' });
    } catch {
      throw new TrelloOAuthError('network');
    }

    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new TrelloOAuthError('network');
    }

    let body: any = null;
    try {
      body = text && text.length <= MAX_BODY_CHARS ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (response.ok) return body ?? {};
    if (response.status === 400 && body?.error === 'invalid_grant') {
      throw new TrelloOAuthError('invalid_grant', 400);
    }
    throw new TrelloOAuthError(
      response.status >= 500 || response.status < 400 ? 'server' : 'rejected',
      response.status
    );
  }

  private parseTokens(body: any): TrelloTokens {
    const expires = Number(body?.expires_in);
    if (typeof body?.access_token !== 'string' || !body.access_token || !Number.isFinite(expires) || expires <= 0) {
      throw new TrelloOAuthError('server');
    }
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : undefined,
      expiresInSeconds: expires,
    };
  }
}
