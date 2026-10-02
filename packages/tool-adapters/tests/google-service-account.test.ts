import { afterEach, expect, it, vi } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
import * as adapters from '../src/index.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const credentials = { clientEmail: 'fixture@unit.iam.gserviceaccount.com', privateKey: pem };
const auth = (fetchFn: typeof fetch, creds = credentials) => new adapters.GoogleServiceAccount({ credentials: creds, fetchFn });
const tokenResponse = (token = 'synthetic-access-token', expires = 3600) => new Response(JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: expires }));
afterEach(() => vi.useRealTimers());

it('signs an RS256 JWT, verifies with the public key, and exchanges the form at the fixed token endpoint', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T00:00:00Z'));
  const controller = new AbortController();
  const fetchFn = vi.fn(async (url, init) => {
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init).toMatchObject({ method: 'POST', signal: controller.signal, redirect: 'error' });
    const form = new URLSearchParams(String(init?.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const parts = form.get('assertion')!.split('.');
    expect(JSON.parse(Buffer.from(parts[0]!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
    expect(claims).toEqual({ iss: credentials.clientEmail, scope: 'scope-a', aud: url, iat: 1790899200, exp: 1790902800 });
    expect(verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), publicKey, Buffer.from(parts[2]!, 'base64url'))).toBe(true);
    return tokenResponse();
  }) as unknown as typeof fetch;
  expect(await auth(fetchFn, { ...credentials, privateKey: pem.replaceAll('\n', '\\n') }).getAccessToken('scope-a', controller.signal)).toBe('synthetic-access-token');
});

it('shares cache across adapter instances but isolates email, key and scope, refreshing 60 seconds before expiry', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const fetchFn = vi.fn(async () => tokenResponse('token-' + fetchFn.mock.calls.length)) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
  expect(await auth(fetchFn).getAccessToken('scope-a')).toBe('token-1');
  expect(await auth(fetchFn).getAccessToken('scope-a')).toBe('token-1');
  expect(await auth(fetchFn).getAccessToken('scope-b')).toBe('token-2');
  expect(await auth(fetchFn, { ...credentials, clientEmail: 'other@unit.iam.gserviceaccount.com' }).getAccessToken('scope-a')).toBe('token-3');
  const rotated = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  expect(await auth(fetchFn, { ...credentials, privateKey: rotated }).getAccessToken('scope-a')).toBe('token-4');
  vi.setSystemTime(3540_000);
  expect(await auth(fetchFn).getAccessToken('scope-a')).toBe('token-5');
  expect(fetchFn).toHaveBeenCalledTimes(5);
});

it.each(['http', 'network', 'json', 'missing', 'bad-expiry', 'wrong-type'])('sanitizes token exchange failure: %s', async mode => {
  const fetchFn = vi.fn(async () => {
    if (mode === 'network') throw new Error(pem + ' assertion=secret');
    if (mode === 'http') return new Response(pem + ' assertion=secret', { status: 401 });
    if (mode === 'json') return new Response(pem);
    if (mode === 'missing') return new Response('{}');
    if (mode === 'bad-expiry') return tokenResponse('secret', -1);
    return new Response(JSON.stringify({ access_token: 'secret', expires_in: 3600, token_type: 'Other' }));
  }) as unknown as typeof fetch;
  try { await auth(fetchFn).getAccessToken('scope-a'); expect.fail('exchange must fail'); }
  catch (error: any) {
    expect(error.category).toBe('AUTH_ERROR');
    expect(JSON.stringify(error) + error.message).not.toContain('secret');
    expect(JSON.stringify(error) + error.message).not.toContain(pem);
    expect(error.cause).toBeUndefined();
  }
});

it('rejects invalid RSA credentials and honors cancellation without a network call', async () => {
  const fetchFn = vi.fn(async () => tokenResponse()) as unknown as typeof fetch;
  await expect(auth(fetchFn, { ...credentials, privateKey: 'invalid-secret-key' }).getAccessToken('scope-a')).rejects.toMatchObject({ category: 'AUTH_ERROR' });
  const controller = new AbortController(); controller.abort();
  await expect(auth(fetchFn).getAccessToken('scope-a', controller.signal)).rejects.toMatchObject({ category: 'AUTH_ERROR' });
  expect(fetchFn).not.toHaveBeenCalled();
});
