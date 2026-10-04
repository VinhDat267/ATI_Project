import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import { normalizedEmail } from '../routes/auth/public-helpers.js';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationUrl: string;
  tokenUrl: string;
  jwksUrl: string;
}
export const GOOGLE_ENDPOINTS = {
  authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
};
export interface GoogleProfile { sub: string; email: string; name: string }
export class GoogleOIDCError extends Error {
  constructor() { super('Không thể xác thực Google. Vui lòng thử lại.'); }
}
interface SigningKey extends JsonWebKey { kid?: string; alg?: string; use?: string }
interface GoogleOIDCOptions { fetchFn?: typeof fetch; clock?: () => number; timeoutMs?: number }

/** Google access/refresh tokens are deliberately neither returned nor persisted. */
export class GoogleOIDC {
  private keys: SigningKey[] = [];
  private expiresAt = 0;
  private fetchFn: typeof fetch;
  private clock: () => number;
  private timeoutMs: number;
  constructor(private config: GoogleOAuthConfig, options: GoogleOIDCOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.clock = options.clock ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }
  private async json(url: string, init: RequestInit = {}): Promise<{ body: any; cacheControl: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // Keep the cancellation timer alive through body parsing, not just headers.
      const response = await this.fetchFn(url, { ...init, redirect: 'error', signal: controller.signal });
      if (!response.ok) throw new GoogleOIDCError();
      const body = await response.json();
      if (controller.signal.aborted) throw new GoogleOIDCError();
      return { body, cacheControl: response.headers?.get('cache-control') ?? '' };
    } catch { throw new GoogleOIDCError(); }
    finally { clearTimeout(timer); }
  }
  private async refreshKeys(): Promise<void> {
    const { body, cacheControl } = await this.json(this.config.jwksUrl);
    if (!body || !Array.isArray(body.keys)) throw new GoogleOIDCError();
    this.keys = body.keys.filter((key: SigningKey) => key && key.kty === 'RSA' && typeof key.kid === 'string'
      && (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'));
    const maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d+)"?/i.exec(cacheControl);
    const seconds = /(?:^|,)\s*(?:no-store|no-cache)\b/i.test(cacheControl) ? 0 : Math.min(Number(maxAge?.[1] ?? 0), 86400);
    this.expiresAt = this.clock() + seconds * 1000;
  }
  async exchangeCode(code: string, verifier: string, nonce: string): Promise<GoogleProfile> {
    const { body } = await this.json(this.config.tokenUrl, { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: this.config.clientId, client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri, grant_type: 'authorization_code', code_verifier: verifier }).toString() });
    if (typeof body?.id_token !== 'string') throw new GoogleOIDCError();
    return this.verifyIdToken(body.id_token, nonce);
  }
  async verifyIdToken(token: string, nonce: string): Promise<GoogleProfile> {
    try {
      if (token.length > 16384) throw new GoogleOIDCError();
      const parts = token.split('.');
      if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw new GoogleOIDCError();
      const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'));
      if (header?.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) throw new GoogleOIDCError();
      let refreshed = false;
      if (this.clock() >= this.expiresAt || !this.keys.length) { await this.refreshKeys(); refreshed = true; }
      let matches = this.keys.filter(key => key.kid === header.kid);
      // A missing kid in a still-valid cache gets one refresh. Never retry a
      // missing key from a JWKS response already fetched for this token.
      if (!matches.length && !refreshed) { await this.refreshKeys(); matches = this.keys.filter(key => key.kid === header.kid); }
      if (matches.length !== 1) throw new GoogleOIDCError();
      const key = createPublicKey({ key: matches[0]!, format: 'jwk' });
      if (!verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2]!, 'base64url'))) throw new GoogleOIDCError();
      const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
      const now = Math.floor(this.clock() / 1000);
      const email = normalizedEmail(claims.email);
      if (!['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) || claims.aud !== this.config.clientId
        || (claims.azp !== undefined && claims.azp !== this.config.clientId)
        || !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat)
        || claims.exp <= now - 60 || claims.iat > now + 60 || claims.iat < 0 || claims.exp <= claims.iat
        || claims.nonce !== nonce || claims.email_verified !== true || !email
        || typeof claims.sub !== 'string' || !claims.sub.trim() || claims.sub.length > 255 || /\s/.test(claims.sub)) throw new GoogleOIDCError();
      return { sub: claims.sub, email, name: typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim().slice(0, 100) : email };
    } catch { throw new GoogleOIDCError(); }
  }
}
