import test from 'node:test';
import assert from 'node:assert/strict';
import { providerFixture, configFor, site } from './helpers/jira-oauth-probe-fixture.mjs';
import { createProbeClient } from '../scripts/jira-probe/client.mjs';

test('authorization uses Atlassian consent parameters without client secret or Google parameters', async t => {
  const f = await providerFixture(); t.after(() => f.close());
  const client = createProbeClient(configFor(f));
  const url = new URL(client.authorizationUrl({ state: 'state-one', scopes: ['read:me', 'offline_access'] }));
  assert.equal(url.pathname, '/authorize');
  assert.equal(url.searchParams.get('audience'), 'api.atlassian.com');
  assert.equal(url.searchParams.get('scope'), 'read:me offline_access');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('state'), 'state-one');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:4187/oauth/callback');
  assert.equal(url.searchParams.has('client_secret'), false);
  assert.equal(url.searchParams.has('access_type'), false);
  assert.equal(url.searchParams.has('code_challenge'), false);
});

test('exchanges JSON code grant and validates identity, sites and contextual ADMINISTER response over HTTP', async t => {
  const f = await providerFixture(); t.after(() => f.close());
  const client = createProbeClient(configFor(f));
  const code = f.issueCode({ sites: [site(), site('confluence-only', ['read:confluence-content.all'])], admin: true });
  const tokens = await client.exchangeCode(code);
  assert.equal(f.requests[0].method, 'POST');
  assert.deepEqual(f.requests[0].body, { grant_type: 'authorization_code', client_id: 'test-client', client_secret: 'SECRET_SENTINEL', code, redirect_uri: 'http://127.0.0.1:4187/oauth/callback' });
  assert.equal((await client.profile(tokens.accessToken)).accountId, 'account-one');
  assert.deepEqual((await client.resources(tokens.accessToken)).map(s => s.id), ['site-one']);
  assert.deepEqual(await client.permissions(tokens.accessToken, 'site-one'), { administer: true });
  const request = f.requests.at(-1);
  assert.equal(request.path, '/ex/jira/site-one/rest/api/3/mypermissions');
  assert.equal(request.query.permissions, 'ADMINISTER');
});

test('live configuration rejects endpoint overrides and fixture configuration rejects remote or credential-bearing URLs', () => {
  assert.throws(() => createProbeClient({ clientId: 'a', clientSecret: 'b', redirectUri: 'http://127.0.0.1:4187/oauth/callback', mode: 'live', fixtureBaseUrl: 'http://127.0.0.1:1234' }), /INVALID_CONFIG/);
  for (const base of ['https://evil.example', 'http://localhost.evil.example', 'http://user:password@127.0.0.1:1234', 'http://127.0.0.1:1234/path']) {
    assert.throws(() => createProbeClient({ ...configFor({ baseUrl: base }) }), /INVALID_CONFIG/);
  }
});

test('provider rejection never includes raw descriptions or credentials in errors', async t => {
  const f = await providerFixture(); t.after(() => f.close());
  const client = createProbeClient(configFor(f));
  await assert.rejects(client.exchangeCode('CODE_SENTINEL_BAD'), error => {
    assert.equal(error.code, 'INVALID_GRANT');
    assert.doesNotMatch(String(error.stack), /SECRET_SENTINEL|CODE_SENTINEL|ACCESS_SENTINEL|REFRESH_SENTINEL/); return true;
  });
});

test('rejects malformed token and resource shapes instead of accepting a connection', async t => {
  const f = await providerFixture(); t.after(() => f.close());
  const client = createProbeClient(configFor(f));
  f.overrides.set('/oauth/token', { body: { access_token: 'ACCESS_SENTINEL', expires_in: -1 } });
  await assert.rejects(client.exchangeCode('code'), /PROVIDER_RESPONSE/);
  f.overrides.delete('/oauth/token');
  const tokens = await client.exchangeCode(f.issueCode());
  f.overrides.set('/oauth/token/accessible-resources', { body: [site('evil', ['read:jira-work']), { ...site(), url: 'https://site-one.atlassian.net.evil.example' }] });
  await assert.rejects(client.resources(tokens.accessToken), /PROVIDER_RESPONSE/);
});

test('does not forward Authorization through a redirect', async t => {
  const f = await providerFixture(); t.after(() => f.close());
  const client = createProbeClient(configFor(f));
  const tokens = await client.exchangeCode(f.issueCode());
  f.overrides.set('/me', { status: 302, body: {}, headers: { Location: `${f.baseUrl}/redirect-target` } });
  await assert.rejects(client.profile(tokens.accessToken), /PROVIDER_NETWORK/);
  assert.equal(f.requests.some(r => r.path === '/redirect-target'), false);
});

test('deadline actually aborts the HTTP response instead of only timing out a promise', async t => {
  const f = await providerFixture(); t.after(() => f.close());
  const client = createProbeClient(configFor(f, { timeoutMs: 30 }));
  const tokens = await client.exchangeCode(f.issueCode());
  f.overrides.set('/me', { delayMs: 180, body: { account_id: 'account-one' } });
  await assert.rejects(client.profile(tokens.accessToken), /PROVIDER_TIMEOUT/);
  for (let n = 0; n < 30 && !f.requests.at(-1).closedEarly; n++) await new Promise(r => setTimeout(r, 5));
  assert.equal(f.requests.at(-1).closedEarly, true);
});

test('caps provider response bodies and rejects unsafe cloud IDs', async t => {
  const f = await providerFixture(); t.after(() => f.close());
  const client = createProbeClient(configFor(f));
  f.overrides.set('/oauth/token', { body: { access_token: 'x'.repeat(70_000), expires_in: 3600 } });
  await assert.rejects(client.exchangeCode('code'), /PROVIDER_RESPONSE/);
  await assert.rejects(client.permissions('token', '../another-host'), /INVALID_INPUT/);
});
