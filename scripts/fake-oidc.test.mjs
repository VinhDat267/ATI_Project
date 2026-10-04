import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { test } from 'node:test';
import { startFakeOidc } from './fake-oidc.mjs';

const clientId = 'fixture.apps.googleusercontent.com';
const clientSecret = 'synthetic-secret';
const redirectUri = 'http://127.0.0.1:5174/auth/google/callback';
const verifier = 'a'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');

async function fixture(t) {
  const provider = await startFakeOidc({ port: 0, clientId, clientSecret, redirectUri });
  t.after(() => provider.close());
  return provider;
}
async function authorize(provider, overrides = {}) {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri,
    response_type: 'code', scope: 'openid email profile', state: 'fixture-state', nonce: 'fixture-nonce',
    code_challenge_method: 'S256', code_challenge: challenge, ...overrides });
  return fetch(`${provider.origin}/authorize?${params}`, { redirect: 'manual' });
}
async function exchange(provider, code, overrides = {}) {
  return fetch(`${provider.origin}/token`, { method: 'POST', body: new URLSearchParams({
    grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret,
    redirect_uri: redirectUri, code_verifier: verifier, ...overrides,
  }) });
}

test('fake OIDC proves S256, signed claims, cacheable public JWKS and one-time authorization code', async (t) => {
  const provider = await fixture(t);
  const response = await authorize(provider);
  assert.equal(response.status, 302);
  const callback = new URL(response.headers.get('location'));
  assert.equal(callback.origin + callback.pathname, redirectUri);
  assert.equal(callback.searchParams.get('state'), 'fixture-state');
  const code = callback.searchParams.get('code');
  const jwksResponse = await fetch(`${provider.origin}/jwks`);
  assert.equal(jwksResponse.headers.get('cache-control'), 'public, max-age=3600');
  const { keys } = await jwksResponse.json();
  assert.equal(keys.length, 1);
  assert.equal(keys[0].d, undefined);
  const tokenResponse = await exchange(provider, code);
  assert.equal(tokenResponse.status, 200);
  const { id_token: token } = await tokenResponse.json();
  const [header, claims, signature] = token.split('.');
  assert.equal(verify('RSA-SHA256', Buffer.from(`${header}.${claims}`),
    createPublicKey({ key: keys[0], format: 'jwk' }), Buffer.from(signature, 'base64url')), true);
  const payload = JSON.parse(Buffer.from(claims, 'base64url'));
  assert.equal(payload.iss, 'https://accounts.google.com');
  assert.equal(payload.aud, clientId);
  assert.equal(payload.nonce, 'fixture-nonce');
  assert.equal(payload.email_verified, true);
  assert.equal(payload.sub, 'fixture-google-user');
  assert.equal(payload.email, 'auth04-google@example.test');
  assert.ok(payload.exp > payload.iat);
  assert.equal((await exchange(provider, code)).status, 400);
});

test('fake OIDC rejects wrong verifier, secret and redirect instead of accepting a nominal exchange', async (t) => {
  const provider = await fixture(t);
  const response = await authorize(provider);
  const code = new URL(response.headers.get('location')).searchParams.get('code');
  for (const overrides of [{ code_verifier: 'b'.repeat(43) }, { client_secret: 'wrong' },
    { redirect_uri: 'http://127.0.0.1:5174/elsewhere' }]) {
    assert.equal((await exchange(provider, code, overrides)).status, 400);
  }
  assert.equal((await exchange(provider, code)).status, 200);
});

test('fake OIDC rejects unauthorized redirect/client and missing PKCE or nonce', async (t) => {
  const provider = await fixture(t);
  for (const overrides of [{ redirect_uri: 'https://other.example.test/callback' },
    { client_id: 'other-client' }, { code_challenge_method: 'plain' }, { nonce: '' }]) {
    const response = await authorize(provider, overrides);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('location'), null);
  }
});

test('fake OIDC expires authorization codes using its actual clock', async (t) => {
  let now = Date.now();
  const provider = await startFakeOidc({ port: 0, clientId, clientSecret, redirectUri, now: () => now });
  t.after(() => provider.close());
  const response = await authorize(provider);
  const code = new URL(response.headers.get('location')).searchParams.get('code');
  now += 600_001;
  assert.equal((await exchange(provider, code)).status, 400);
});
