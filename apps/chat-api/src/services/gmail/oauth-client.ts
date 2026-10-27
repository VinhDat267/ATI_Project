import { CALENDAR_ID_PATTERN, type PersonalCalendarItem } from '@wap/tool-schemas';
import type { GmailOAuthConfig } from '../../config/env.js';

/** Failure kinds of a Google request. Messages never contain tokens, codes or verifiers. */
export class GmailOAuthError extends Error {
  constructor(readonly kind: 'invalid_grant' | 'rejected' | 'network' | 'server', readonly status?: number) {
    super(`Gmail OAuth request failed: ${kind}${status ? ` (${status})` : ''}`);
    this.name = 'GmailOAuthError';
  }
}

export interface GmailTokens { accessToken: string; refreshToken?: string; expiresInSeconds: number; scopes: string[] }

const MAX_BODY_CHARS = 64_000;

/** Google OAuth for the Gmail client: never follows redirects, every request carries a signal. */
export class GmailOAuthClient {
  constructor(private config: GmailOAuthConfig, private fetchFn: typeof fetch = fetch) {}

  authorizationUrl(input: { state: string; codeChallenge: string; scope: string }): string {
    const url = new URL(this.config.authorizationUrl);
    for (const [key, value] of Object.entries({ client_id: this.config.clientId, redirect_uri: this.config.redirectUri, response_type: 'code',
      scope: input.scope, state: input.state, access_type: 'offline', prompt: 'consent',
      code_challenge_method: 'S256', code_challenge: input.codeChallenge })) url.searchParams.set(key, value);
    return url.href;
  }

  async exchangeCode(code: string, codeVerifier: string, signal: AbortSignal): Promise<GmailTokens> {
    return this.tokens(await this.post(this.config.tokenUrl, { grant_type: 'authorization_code', code, code_verifier: codeVerifier,
      client_id: this.config.clientId, client_secret: this.config.clientSecret, redirect_uri: this.config.redirectUri }, signal));
  }

  async refresh(refreshToken: string, signal: AbortSignal): Promise<GmailTokens> {
    return this.tokens(await this.post(this.config.tokenUrl, { grant_type: 'refresh_token', refresh_token: refreshToken,
      client_id: this.config.clientId, client_secret: this.config.clientSecret }, signal));
  }

  async revoke(token: string, signal: AbortSignal): Promise<void> {
    await this.post(this.config.revokeUrl, { token }, signal);
  }

  /** The address of the connected mailbox, which may differ from the ATI sign-in email. */
  async profileEmail(accessToken: string, signal: AbortSignal): Promise<string> {
    const body = await this.send(`${this.config.apiBaseUrl}/gmail/v1/users/me/profile`, {
      method: 'GET', headers: { Authorization: `Bearer ${accessToken}` }, signal });
    const email = typeof body?.emailAddress === 'string' ? body.emailAddress.trim().toLowerCase() : '';
    if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email) || email.length > 320) throw new GmailOAuthError('server');
    return email;
  }

  /** Discovers writable Google Calendars and the owner's primary email address (OAUTH-02). */
  async writableCalendars(accessToken: string, signal: AbortSignal): Promise<{ email: string; calendars: PersonalCalendarItem[] }> {
    const body = await this.send(`${this.config.apiBaseUrl}/calendar/v3/users/me/calendarList?minAccessRole=writer&maxResults=250`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    });
    const items = Array.isArray(body?.items) ? body.items : [];
    const writable: PersonalCalendarItem[] = [];
    let primaryEmail = '';

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const role = item.accessRole;
      if (role !== 'owner' && role !== 'writer') continue;
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
      const timeZone = typeof item.timeZone === 'string' ? item.timeZone.trim() : '';
      if (!id || !CALENDAR_ID_PATTERN.test(id) || !summary || !timeZone) continue;
      const isPrimary = item.primary === true;
      if (isPrimary && !primaryEmail) {
        const lower = id.toLowerCase();
        if (/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(lower) && lower.length <= 320) {
          primaryEmail = lower;
        }
      }
      writable.push({
        id,
        summary,
        timeZone,
        ...(isPrimary ? { primary: true } : {}),
      });
    }

    if (!primaryEmail) throw new GmailOAuthError('server');

    writable.sort((a, b) => {
      if (a.primary && !b.primary) return -1;
      if (!a.primary && b.primary) return 1;
      return a.summary.localeCompare(b.summary, 'vi');
    });

    return { email: primaryEmail, calendars: writable };
  }

  private post(url: string, fields: Record<string, string>, signal: AbortSignal) {
    return this.send(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields), signal });
  }

  private async send(url: string, init: RequestInit & { signal: AbortSignal }): Promise<any> {
    let response: Response;
    try {
      response = await this.fetchFn(url, { ...init, redirect: 'manual' });
    } catch {
      throw new GmailOAuthError('network');
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new GmailOAuthError('network');
    }
    let body: any = null;
    try { body = text && text.length <= MAX_BODY_CHARS ? JSON.parse(text) : null; } catch { body = null; }
    if (response.ok) return body ?? {};
    if (response.status === 400 && body?.error === 'invalid_grant') throw new GmailOAuthError('invalid_grant', 400);
    throw new GmailOAuthError(response.status >= 500 || response.status < 400 ? 'server' : 'rejected', response.status);
  }

  private tokens(body: any): GmailTokens {
    const expires = Number(body?.expires_in);
    if (typeof body?.access_token !== 'string' || !body.access_token || !Number.isFinite(expires) || expires <= 0) throw new GmailOAuthError('server');
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : undefined,
      expiresInSeconds: expires,
      scopes: typeof body.scope === 'string' ? body.scope.split(' ').filter(Boolean) : [],
    };
  }
}
