import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { GoogleOIDC } from '../../src/auth/google-oidc.js';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'test-kid', alg: 'RS256', use: 'sig' };
const config = { clientId: 'client', clientSecret: 'secret', redirectUri: 'http://localhost:5174/auth/google/callback', authorizationUrl: 'http://local/auth', tokenUrl: 'http://local/token', jwksUrl: 'http://local/jwks' };
const now = Date.now();
function jwt(claims = {}, header = {}, key = keys.privateKey) {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid, ...header })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ sub: 'stable-sub', email: 'owner@example.test', email_verified: true, nonce: 'nonce', name: 'Owner',
    iss: 'https://accounts.google.com', aud: 'client', iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 300, ...claims })).toString('base64url');
  return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url')}`;
}
async function oidc(fetchFn: typeof fetch, extra = {}) {
  return new GoogleOIDC(config, { fetchFn, clock: () => now, ...extra });
}
describe('Google OIDC signatures, claims, JWKS cache and bounded fetch', () => {
  it('validates RSA signature and returns only verified profile claims', async () => {
    const validator = await oidc(async () => Response.json({ keys: [jwk] }));
    expect(await validator.verifyIdToken(jwt(), 'nonce')).toEqual({ sub: 'stable-sub', email: 'owner@example.test', name: 'Owner' });
    expect(await validator.verifyIdToken(jwt({ iss: 'accounts.google.com' }), 'nonce')).toHaveProperty('sub');
  });
  it.each([{ iss: 'evil' }, { aud: 'wrong' }, { aud: ['client', 'other'] }, { exp: Math.floor(now / 1000) - 61 },
    { exp: '100000000000' }, { iat: Math.floor(now / 1000) + 61 }, { iat: null }, { nonce: 'bad' }, { email_verified: false },
    { email_verified: 'true' }, { sub: '' }, { sub: 123 }, { sub: 'x'.repeat(256) }, { email: 'not-email' }, { exp: null }])('rejects invalid claims %j', async claims => {
    const validator = await oidc(async () => Response.json({ keys: [jwk] }));
    await expect(validator.verifyIdToken(jwt(claims), 'nonce')).rejects.toThrow('Google');
  });
  it('rejects wrong signature, non-RS256, none, malformed token and unknown kid', async () => {
    const validator = await oidc(async () => Response.json({ keys: [jwk] }));
    for (const value of [jwt({}, {}, other.privateKey), jwt({}, { alg: 'HS256' }), jwt({}, { alg: 'none' }), jwt({}, { kid: 'unknown' }), 'malformed']) {
      await expect(validator.verifyIdToken(value, 'nonce')).rejects.toThrow('Google');
    }
  });
  it('caches according to Cache-Control and refreshes an unknown kid exactly once', async () => {
    let calls = 0, clock = now;
    const validator = await oidc(async () => { calls++; return Response.json({ keys: [jwk] }, { headers: { 'Cache-Control': 'public, max-age=120' } }); }, { clock: () => clock });
    await validator.verifyIdToken(jwt(), 'nonce'); await validator.verifyIdToken(jwt(), 'nonce'); expect(calls).toBe(1);
    await expect(validator.verifyIdToken(jwt({}, { kid: 'unknown' }), 'nonce')).rejects.toThrow(); expect(calls).toBe(2);
    clock += 121000; await validator.verifyIdToken(jwt(), 'nonce'); expect(calls).toBe(3);
  });
  it('honors no-store and updates keys on rotation', async () => {
    let calls = 0;
    const validator = await oidc(async () => { calls++; return Response.json({ keys: calls === 1 ? [jwk] : [{ ...jwk, kid: 'rotated' }] }, { headers: { 'Cache-Control': 'no-store' } }); });
    await validator.verifyIdToken(jwt(), 'nonce'); await validator.verifyIdToken(jwt({}, { kid: 'rotated' }), 'nonce'); expect(calls).toBe(2);
  });
  it('rejects redirect responses and never exposes error bodies', async () => {
    const validator = await oidc(async (_url, init) => { expect(init?.redirect).toBe('error'); return new Response('private-token-body', { status: 302 }); });
    await expect(validator.exchangeCode('private-code', 'verifier', 'nonce')).rejects.toThrow('Google');
    await expect(validator.verifyIdToken(jwt(), 'nonce')).rejects.not.toThrow('private-token-body');
  });
  it('uses real AbortSignal cancellation for hung fetch and body reading', async () => {
    for (const bodyHang of [false, true]) {
      let aborted = false;
      const validator = await oidc(async (_url, init) => {
        const signal = init!.signal!;
        const hang = () => new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('private-code')); }, { once: true }));
        if (!bodyHang) return hang();
        return { ok: true, json: hang } as unknown as Response;
      }, { timeoutMs: 25 });
      await expect(validator.exchangeCode('private-code', 'verifier', 'nonce')).rejects.toThrow('Google'); expect(aborted).toBe(true);
    }
  });
  it('aborts native HTTP token response body reads and closes the request without exposing its body', async () => {
    let closed!: () => void;
    const disconnected = new Promise<void>(resolve => { closed = resolve; });
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"id_token":"private-body');
      res.on('close', closed);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    try {
      const validator = new GoogleOIDC({ ...config, tokenUrl: `http://127.0.0.1:${address.port}/token` }, { timeoutMs: 100 });
      await expect(validator.exchangeCode('private-code', 'verifier', 'nonce')).rejects.not.toThrow('private-body');
      await disconnected;
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
