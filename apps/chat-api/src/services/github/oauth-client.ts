import { GITHUB_OAUTH_DEFAULT_SCOPE, type GitHubOAuthConfig } from '../../config/env.js';
import { isValidGitHubRepoFullName } from '../../db/repositories/github-team-repo.js';

export { GITHUB_OAUTH_DEFAULT_SCOPE };

export class GitHubOAuthError extends Error {
  constructor(
    readonly kind: 'invalid_grant' | 'rejected' | 'network' | 'server',
    readonly status?: number
  ) {
    super(`GitHub OAuth request failed: ${kind}${status ? ` (${status})` : ''}`);
    this.name = 'GitHubOAuthError';
  }
}

export interface GitHubTokens {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds?: number;
}

export interface GitHubUser {
  id: string;
  login: string;
}

export interface GitHubRepoSummary {
  id: string;
  name: string;
  fullName: string;
  private: boolean;
}

const MAX_BODY_CHARS = 256_000;
const INVALID_GRANT_ERRORS = new Set([
  'invalid_grant',
  'bad_verification_code',
  'bad_refresh_token',
  'incorrect_client_credentials',
]);

export class GitHubOAuthClient {
  constructor(
    private config: GitHubOAuthConfig,
    private fetchFn: typeof fetch = fetch
  ) {}

  authorizationUrl(input: { state: string; codeChallenge: string }): string {
    const url = new URL(this.config.authorizationUrl);
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('state', input.state);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    const scope = this.config.scope ?? GITHUB_OAUTH_DEFAULT_SCOPE;
    if (scope) {
      url.searchParams.set('scope', scope);
    }
    return url.href;
  }

  async exchangeCode(
    code: string,
    codeVerifier: string,
    signal?: AbortSignal
  ): Promise<GitHubTokens> {
    const body = await this.post(
      this.config.tokenUrl,
      {
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
    signal?: AbortSignal
  ): Promise<GitHubTokens> {
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

  async user(accessToken: string, signal?: AbortSignal): Promise<GitHubUser> {
    const body = await this.send(`${this.config.apiBaseUrl}/user`, {
      method: 'GET',
      headers: this.apiHeaders(accessToken),
      signal,
    });
    const id = body?.id !== undefined && body?.id !== null ? String(body.id).trim() : '';
    const login = typeof body?.login === 'string' ? body.login.trim() : '';
    if (!id || !login) {
      throw new GitHubOAuthError('server');
    }
    return { id, login };
  }

  async repos(accessToken: string, signal?: AbortSignal): Promise<GitHubRepoSummary[]> {
    const body = await this.send(
      `${this.config.apiBaseUrl}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member`,
      {
        method: 'GET',
        headers: this.apiHeaders(accessToken),
        signal,
      }
    );
    if (!Array.isArray(body)) {
      throw new GitHubOAuthError('server');
    }
    const result: GitHubRepoSummary[] = [];
    for (const r of body) {
      const id = r?.id !== undefined && r?.id !== null ? String(r.id).trim() : '';
      const fullName = typeof r?.full_name === 'string' ? r.full_name.trim() : '';
      const name = typeof r?.name === 'string' && r.name.trim() ? r.name.trim() : (fullName.split('/')[1] ?? '');
      if (!id || !fullName || !name || !isValidGitHubRepoFullName(fullName)) continue;
      result.push({
        id,
        name,
        fullName,
        private: Boolean(r?.private),
      });
    }
    return result;
  }

  private apiHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private post(url: string, fields: Record<string, any>, signal?: AbortSignal) {
    return this.send(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fields),
      signal,
    });
  }

  private async send(url: string, init: RequestInit & { signal?: AbortSignal }): Promise<any> {
    if (init.signal?.aborted) {
      throw new GitHubOAuthError('network');
    }

    let response: Response;
    try {
      response = await this.fetchFn(url, { ...init, redirect: 'manual' });
    } catch {
      throw new GitHubOAuthError('network');
    }

    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new GitHubOAuthError('network');
    }

    let body: any = null;
    try {
      body = text && text.length <= MAX_BODY_CHARS ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    const errorCode = typeof body?.error === 'string' ? body.error : undefined;
    if (errorCode && INVALID_GRANT_ERRORS.has(errorCode)) {
      throw new GitHubOAuthError('invalid_grant', response.status);
    }
    if (errorCode) {
      throw new GitHubOAuthError('rejected', response.status);
    }

    if (response.ok) return body ?? {};
    if (response.status === 401) {
      throw new GitHubOAuthError('invalid_grant', 401);
    }
    throw new GitHubOAuthError(
      response.status >= 500 || response.status < 400 ? 'server' : 'rejected',
      response.status
    );
  }

  private parseTokens(body: any): GitHubTokens {
    if (typeof body?.access_token !== 'string' || !body.access_token.trim()) {
      throw new GitHubOAuthError('server');
    }
    const rawExpires = body?.expires_in;
    const expires = rawExpires !== undefined && rawExpires !== null ? Number(rawExpires) : undefined;
    if (expires !== undefined && (!Number.isFinite(expires) || expires <= 0)) {
      throw new GitHubOAuthError('server');
    }
    return {
      accessToken: body.access_token.trim(),
      refreshToken: typeof body?.refresh_token === 'string' && body.refresh_token.trim() ? body.refresh_token.trim() : undefined,
      expiresInSeconds: expires,
    };
  }
}
