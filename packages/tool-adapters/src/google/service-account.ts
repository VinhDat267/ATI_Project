import { createHash, createPrivateKey, sign } from 'node:crypto';
import { StepError } from '../base-adapter.js';

export interface GoogleServiceAccountCredentials { clientEmail: string; privateKey: string }
const tokenEndpoint = 'https://oauth2.googleapis.com/token';
const caches = new WeakMap<typeof fetch, Map<string, { token: string; expiresAt: number }>>();
const authError = () => new StepError({ message: 'Google service account authentication failed', category: 'AUTH_ERROR', retryable: false });
// Transient token-service failures must not read as bad credentials. Messages never carry a body, key or assertion.
const tokenFailure = (category: 'NETWORK' | 'RATE_LIMIT' | 'SERVER_ERROR', statusCode?: number) => new StepError({
  message: category === 'NETWORK' ? 'Google token request did not complete' : category === 'RATE_LIMIT' ? 'Google token service is rate limiting requests' : 'Google token service returned an unusable response',
  category, statusCode, retryable: true,
});
const sanitized = (error: unknown) => error instanceof StepError && error.cause === undefined ? error : authError();

/** Cache is bound to transport, account, scope and key fingerprint, never raw key text. */
export class GoogleServiceAccount {
  private readonly credentials: GoogleServiceAccountCredentials;
  private readonly fetchFn: typeof fetch;
  constructor(config: { credentials: GoogleServiceAccountCredentials; fetchFn?: typeof fetch }) {
    this.credentials = config.credentials;
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
  }

  async getAccessToken(scope: string, signal?: AbortSignal): Promise<string> {
    try {
      if (signal?.aborted) throw tokenFailure('NETWORK');
      if (!scope.trim() || !this.credentials.clientEmail?.trim() || !this.credentials.privateKey) throw authError();
      const pem = this.credentials.privateKey.replaceAll('\\n', '\n');
      const key = createPrivateKey(pem);
      if (key.asymmetricKeyType !== 'rsa') throw authError();
      const cacheKey = createHash('sha256').update(JSON.stringify([this.credentials.clientEmail, scope, pem])).digest('hex');
      let cache = caches.get(this.fetchFn);
      if (!cache) { cache = new Map(); caches.set(this.fetchFn, cache); }
      const now = Date.now();
      const cached = cache.get(cacheKey);
      if (cached && now < cached.expiresAt - 60_000) return cached.token;
      cache.delete(cacheKey);
      const iat = Math.floor(now / 1000);
      const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const input = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({
        iss: this.credentials.clientEmail, scope, aud: tokenEndpoint, iat, exp: iat + 3600,
      });
      const assertion = input + '.' + sign('RSA-SHA256', Buffer.from(input), key).toString('base64url');
      let response: Response;
      try {
        response = await this.fetchFn(tokenEndpoint, {
          method: 'POST', redirect: 'error', signal,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
        });
      } catch { throw tokenFailure('NETWORK'); }
      if (response.status === 429) throw tokenFailure('RATE_LIMIT', 429);
      if (response.status >= 500) throw tokenFailure('SERVER_ERROR', response.status);
      if (!response.ok) throw authError();
      let body: { access_token?: unknown; token_type?: unknown; expires_in?: unknown };
      try { body = await response.json(); } catch { throw tokenFailure('SERVER_ERROR'); }
      if (typeof body?.access_token !== 'string' || !body.access_token.trim() || body.token_type !== 'Bearer' ||
        typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in) || body.expires_in <= 0) throw tokenFailure('SERVER_ERROR');
      if (signal?.aborted) throw tokenFailure('NETWORK');
      // Bound lifetime to the signed assertion even if the response is malformed.
      cache.set(cacheKey, { token: body.access_token, expiresAt: now + Math.min(3600, body.expires_in) * 1000 });
      return body.access_token;
    } catch (error) {
      // Never retain a response body, crypto error, key or assertion in cause/details:
      // only errors built above pass through; anything else (e.g. crypto) is bad credentials.
      throw sanitized(error);
    }
  }
}
