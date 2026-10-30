import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { providerFixture, configFor, site } from './helpers/jira-oauth-probe-fixture.mjs';
import { createProbeClient } from '../scripts/jira-probe/client.mjs';

const identityScopes = ['read:me', 'offline_access'];
const jiraScopes = ['read:me', 'read:jira-work', 'write:jira-work', 'offline_access'];
async function newSession(f, extra = {}) {
  const { createProbeSession } = await import('../scripts/jira-probe/session.mjs');
  return createProbeSession({ client: createProbeClient(configFor(f)), mode: 'fixture', ...extra });
}
async function authorize(session, f, flow = 'identity', options = {}) {
  const start = session.start(flow, 'browser-a');
  const state = new URL(start.authorizationUrl).searchParams.get('state');
  const code = f.issueCode({ scopes: flow === 'jira' ? jiraScopes : identityScopes, ...options });
  await session.callback({ state, code, browserBinding: 'browser-a' });
}

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

test('identity-only probe does not claim the account has no Jira memberships or a passed native gate', async t => {
  const f = await providerFixture(); t.after(() => f.close()); const session = await newSession(f);
  await authorize(session, f);
  const report = session.report('browser-a');
  assert.equal(report.provenance, 'local_fixture');
  assert.equal(report.connected, true);
  assert.equal(report.observations.identity, true);
  assert.equal(report.observations.jiraAuthorization, false);
  assert.equal(report.nativeGate, 'NOT_RUN');
  assert.equal(report.noSiteMembership, 'REQUIRES_OPERATOR_ATTESTATION');
  assert.equal(f.requests.some(r => r.path === '/oauth/token/accessible-resources'), false);
  assert.doesNotMatch(JSON.stringify(report), /SENTINEL|account-one|browser-a|state/i);
});

test('a fixture client cannot be labelled as live evidence by a session', async t => {
  const f = await providerFixture(); t.after(() => f.close());
  await assert.rejects(newSession(f, { mode: 'live' }), /INVALID_CONFIG/);
});

test('mutating a client label cannot promote fixture requests into live evidence', async t => {
  const f = await providerFixture(); t.after(() => f.close());
  const { createProbeSession } = await import('../scripts/jira-probe/session.mjs');
  const client = createProbeClient(configFor(f));
  try { client.mode = 'live'; } catch { /* A read-only mode is the expected boundary. */ }
  assert.throws(() => createProbeSession({ client, mode: 'live' }), /INVALID_CONFIG/);
});

test('wrong browser, expired and superseded state never exchange a code', async t => {
  const f = await providerFixture(); t.after(() => f.close()); let now = 0; const session = await newSession(f, { clock: () => now });
  const first = new URL(session.start('identity', 'browser-a').authorizationUrl).searchParams.get('state');
  await assert.rejects(session.callback({ state: first, code: 'CODE', browserBinding: 'browser-b' }), /BROWSER_MISMATCH/);
  now = 600_000;
  await assert.rejects(session.callback({ state: first, code: 'CODE', browserBinding: 'browser-a' }), /INVALID_STATE/);
  const old = new URL(session.start('identity', 'browser-a').authorizationUrl).searchParams.get('state');
  session.start('jira', 'browser-a');
  await assert.rejects(session.callback({ state: old, code: 'CODE', browserBinding: 'browser-a' }), /INVALID_STATE/);
  assert.equal(f.requests.length, 0);
});

test('concurrent callback and replay cause exactly one actual code exchange', async t => {
  const f = await providerFixture(); t.after(() => f.close()); const session = await newSession(f);
  const state = new URL(session.start('identity', 'browser-a').authorizationUrl).searchParams.get('state');
  const input = { state, code: f.issueCode(), browserBinding: 'browser-a' };
  const outcomes = await Promise.allSettled([session.callback(input), session.callback(input)]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.requests.filter(r => r.path === '/oauth/token').length, 1);
  await assert.rejects(session.callback(input), /INVALID_STATE/);
});

test('Jira flow observes two Jira sites and native permissions without putting site identities in reports', async t => {
  const f = await providerFixture(); t.after(() => f.close()); const session = await newSession(f);
  await authorize(session, f, 'jira', { sites: [site(), site('site-two')], admin: true });
  const report = session.report('browser-a');
  assert.equal(report.siteCount, 2);
  assert.equal(report.adminSiteCount, 2);
  assert.equal(report.observations.jiraAuthorization, true);
  assert.equal(report.observations.permissionsRead, true);
  assert.equal(report.nativeGate, 'NOT_RUN');
  assert.doesNotMatch(JSON.stringify(report), /site-one|site-two|SENTINEL|account-one/);
});

test('re-consent to a different identity invalidates usable connection instead of leaving the old one ready', async t => {
  const f = await providerFixture(); t.after(() => f.close()); const session = await newSession(f);
  await authorize(session, f);
  await assert.rejects(authorize(session, f, 'jira', { accountId: 'account-two' }), /ACCOUNT_CHANGED/);
  assert.equal(session.report('browser-a').connected, false);
});

test('missing requested scopes or refresh token cannot produce a ready connection', async t => {
  const f = await providerFixture(); t.after(() => f.close()); const session = await newSession(f);
  await assert.rejects(authorize(session, f, 'jira', { scopes: ['read:me'] }), /MISSING_SCOPE/);
  f.overrides.set('/oauth/token', { body: { access_token: 'ACCESS_SENTINEL', scope: 'read:me', expires_in: 3600 } });
  await assert.rejects(authorize(session, f), /REFRESH_REQUIRED/);
  assert.equal(session.report('browser-a').connected, false);
});

test('parallel refreshes share one real exchange and the next refresh sends only the newly rotated token', async t => {
  const f = await providerFixture(); t.after(() => f.close()); const session = await newSession(f);
  await authorize(session, f);
  const before = f.requests.length;
  const barrier = f.pauseRefresh();
  const first = session.refresh('browser-a'); await barrier.reached;
  const second = session.refresh('browser-a'); barrier.release();
  await Promise.all([first, second]);
  const refreshes = f.requests.slice(before).filter(r => r.body?.grant_type === 'refresh_token');
  assert.equal(refreshes.length, 1);
  const oldToken = refreshes[0].body.refresh_token;
  await session.refresh('browser-a');
  const last = f.requests.filter(r => r.body?.grant_type === 'refresh_token').at(-1);
  assert.notEqual(last.body.refresh_token, oldToken);
  assert.equal(session.report('browser-a').observations.tokenRotation, true);
  assert.doesNotMatch(JSON.stringify(session.report('browser-a')), /SENTINEL/);
});

test('disconnect wins over an HTTP refresh response that arrives later', async t => {
  const f = await providerFixture(); t.after(() => f.close()); const session = await newSession(f);
  await authorize(session, f);
  const barrier = f.pauseRefresh();
  const pending = session.refresh('browser-a'); await barrier.reached;
  session.disconnect('browser-a'); barrier.release();
  await assert.rejects(pending, /FLOW_SUPERSEDED/);
  assert.equal(session.report('browser-a').connected, false);
  await assert.rejects(session.refresh('browser-a'), /NOT_CONNECTED/);
});

test('invalid_grant on refresh requires reconnect and cancellation consumes state without an exchange', async t => {
  const f = await providerFixture(); t.after(() => f.close()); const session = await newSession(f);
  await authorize(session, f);
  f.overrides.set('/oauth/token', { status: 403, body: { error: 'invalid_grant', error_description: 'REFRESH_SENTINEL' } });
  await assert.rejects(session.refresh('browser-a'), /INVALID_GRANT/);
  assert.equal(session.report('browser-a').connected, false);
  const before = f.requests.length;
  const state = new URL(session.start('identity', 'browser-a').authorizationUrl).searchParams.get('state');
  await assert.rejects(session.callback({ state, error: 'access_denied', browserBinding: 'browser-a' }), /CONSENT_DENIED/);
  await assert.rejects(session.callback({ state, code: 'code', browserBinding: 'browser-a' }), /INVALID_STATE/);
  assert.equal(f.requests.length, before);
});

async function runner(t) {
  const f = await providerFixture(); t.after(() => f.close());
  const { startProbeServer } = await import('../scripts/jira-probe/server.mjs');
  const server = await startProbeServer(configFor(f, { redirectUri: 'http://127.0.0.1:0/oauth/callback' }));
  t.after(() => server.close());
  const first = await fetch(server.url);
  const cookieHeader = first.headers.get('set-cookie');
  return { f, server, first, cookie: cookieHeader.split(';', 1)[0], cookieHeader };
}
const post = (url, cookie, flow = 'identity', origin = new URL(url).origin) => fetch(url, {
  method: 'POST', redirect: 'manual', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ flow }),
});

test('runner binds one browser and protects report and mutations from other browsers/origins', async t => {
  const { f, server, first, cookie, cookieHeader } = await runner(t);
  assert.equal(first.status, 200);
  assert.match(cookieHeader, /HttpOnly/i); assert.match(cookieHeader, /SameSite=Lax/i);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.equal(first.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await fetch(`${server.url}report`)).status, 403);
  assert.equal((await fetch(server.url)).status, 403);
  assert.equal((await post(`${server.url}start`, cookie, 'identity', 'https://evil.example')).status, 403);
  assert.equal((await post(`${server.url}start`, 'probe_owner=other')).status, 403);
  const report = await (await fetch(`${server.url}report`, { headers: { Cookie: cookie } })).json();
  assert.equal(report.provenance, 'local_fixture');
  assert.equal(report.nativeGate, 'NOT_RUN');
  assert.equal(f.requests.length, 0);
});

test('runner performs callback exchange once, removes code/state from displayed URL and never returns tokens', async t => {
  const { f, server, cookie } = await runner(t);
  const start = await post(`${server.url}start`, cookie);
  assert.equal(start.status, 303);
  const authUrl = new URL(start.headers.get('location'));
  assert.equal(authUrl.origin, f.baseUrl);
  const state = authUrl.searchParams.get('state'); const code = f.issueCode();
  const url = `${server.url}oauth/callback?state=${state}&code=${code}`;
  const wrong = await fetch(url, { redirect: 'manual' }); assert.equal(wrong.status, 303); assert.equal(wrong.headers.get('location'), '/');
  const result = await fetch(url, { redirect: 'manual', headers: { Cookie: cookie } });
  assert.equal(result.status, 303); assert.equal(result.headers.get('location'), '/');
  assert.doesNotMatch(await result.text(), /SENTINEL|state=/);
  const reportResponse = await fetch(`${server.url}report`, { headers: { Cookie: cookie } });
  const raw = await reportResponse.text(); assert.doesNotMatch(raw, /SENTINEL|account-one/);
  assert.equal(JSON.parse(raw).connected, true);
  const replay = await fetch(url, { redirect: 'manual', headers: { Cookie: cookie } });
  assert.equal(replay.status, 303);
  assert.equal(f.requests.filter(r => r.path === '/oauth/token').length, 1);
  const home = await (await fetch(server.url, { headers: { Cookie: cookie } })).text();
  assert.match(home, /INVALID_STATE/); assert.doesNotMatch(home, /SENTINEL/);
});

test('runner rejects duplicate callback parameters and handles consent denial without raw descriptions', async t => {
  const { f, server, cookie } = await runner(t);
  const start = await post(`${server.url}start`, cookie);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const duplicate = await fetch(`${server.url}oauth/callback?state=${state}&state=other&code=CODE_SENTINEL`, { redirect: 'manual', headers: { Cookie: cookie } });
  assert.equal(duplicate.status, 303); assert.equal(duplicate.headers.get('location'), '/'); assert.doesNotMatch(await duplicate.text(), /CODE_SENTINEL/);
  const denied = await fetch(`${server.url}oauth/callback?state=${state}&error=access_denied&error_description=SECRET_SENTINEL`, { redirect: 'manual', headers: { Cookie: cookie } });
  assert.equal(denied.status, 303); assert.equal(denied.headers.get('location'), '/');
  const page = await (await fetch(server.url, { headers: { Cookie: cookie } })).text();
  assert.match(page, /CONSENT_DENIED/); assert.doesNotMatch(page, /SECRET_SENTINEL/);
  assert.equal(f.requests.length, 0);
});

test('unexpected provider scope text is not reflected in HTML or the redacted report', async t => {
  const { f, server, cookie } = await runner(t);
  const start = await post(`${server.url}start`, cookie);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const code = f.issueCode({ scopes: [...identityScopes, 'ACCESS_SENTINEL_<script>bad</script>'] });
  await fetch(`${server.url}oauth/callback?state=${state}&code=${code}`, { redirect: 'manual', headers: { Cookie: cookie } });
  for (const path of ['', 'report']) {
    const body = await (await fetch(`${server.url}${path}`, { headers: { Cookie: cookie } })).text();
    assert.doesNotMatch(body, /SENTINEL|<script>/);
  }
});

test('runner rejects a remote callback before opening any listener', async () => {
  const { startProbeServer } = await import('../scripts/jira-probe/server.mjs');
  await assert.rejects(startProbeServer({ ...configFor({ baseUrl: 'http://127.0.0.1:1234' }), redirectUri: 'https://evil.example/oauth/callback' }), /INVALID_CONFIG/);
});

test('CLI help and config errors have safe exit codes and never print supplied secrets', () => {
  const cli = fileURLToPath(new URL('../scripts/jira-probe/cli.mjs', import.meta.url));
  const env = { ...process.env, JIRA_PROBE_CLIENT_ID: '', JIRA_PROBE_CLIENT_SECRET: '', JIRA_PROBE_REDIRECT_URI: '' };
  const run = (args, extra = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...env, ...extra }, timeout: 5000 });
  const help = run(['--help']); assert.equal(help.status, 0); assert.match(help.stdout, /--live/);
  const missing = run(['--check-config']); assert.equal(missing.status, 2); assert.match(missing.stderr, /JIRA_PROBE_CLIENT_ID/);
  const implicit = run([]); assert.equal(implicit.status, 2); assert.match(implicit.stderr, /--live/);
  const bad = run(['--check-config'], { JIRA_PROBE_CLIENT_ID: 'client', JIRA_PROBE_CLIENT_SECRET: 'SECRET_SENTINEL', JIRA_PROBE_REDIRECT_URI: 'https://evil.example/oauth/callback' });
  assert.equal(bad.status, 2); assert.doesNotMatch(bad.stdout + bad.stderr, /SECRET_SENTINEL|evil\.example/);
});

test('review regression: observations reset on disconnect and cannot carry from Jira account one into identity-only account two', async t => {
  const f = await providerFixture(); t.after(() => f.close()); const session = await newSession(f);
  await authorize(session, f, 'jira', { sites: [site()], admin: true });
  await session.refresh('browser-a');
  assert.equal(session.report('browser-a').observations.tokenRotation, true);
  session.disconnect('browser-a');
  assert.deepEqual(session.report('browser-a').observations, { identity: false, jiraAuthorization: false, tokenRotation: false, permissionsRead: false });
  await authorize(session, f, 'identity', { accountId: 'account-two' });
  assert.deepEqual(session.report('browser-a').observations, { identity: true, jiraAuthorization: false, tokenRotation: false, permissionsRead: false });
  session.start('jira', 'browser-a');
  assert.deepEqual(session.report('browser-a').observations, { identity: false, jiraAuthorization: false, tokenRotation: false, permissionsRead: false });
});

test('review regression: duplicate resource rows cannot become evidence of two distinct Jira sites', async t => {
  const f = await providerFixture(); t.after(() => f.close()); const session = await newSession(f);
  await authorize(session, f, 'jira', { sites: [site(), site()] });
  assert.equal(session.report('browser-a').siteCount, 1);
  assert.equal(f.requests.filter(r => r.path.endsWith('/mypermissions')).length, 1);
});

test('review regression: duplicate cloudId with conflicting site URL or scopes fails closed', async t => {
  const f = await providerFixture(); t.after(() => f.close()); const client = createProbeClient(configFor(f));
  for (const conflicting of [{ ...site(), url: 'https://other-site.atlassian.net' }, site('site-one', ['read:jira-work'])]) {
    const tokens = await client.exchangeCode(f.issueCode({ scopes: jiraScopes, sites: [site(), conflicting] }));
    await assert.rejects(client.resources(tokens.accessToken), /PROVIDER_RESPONSE/);
  }
});

test('an old callback delayed at profile cannot overwrite a newer account and its usable grant', async t => {
  const f = await providerFixture(); t.after(() => f.close()); const session = await newSession(f);
  const barrier = f.pauseNext('/me');
  const old = authorize(session, f); await barrier.reached;
  await authorize(session, f, 'identity', { accountId: 'account-two' });
  barrier.release();
  await assert.rejects(old, /FLOW_SUPERSEDED/);
  await session.refresh('browser-a');
  assert.equal(session.report('browser-a').connected, true);
});

test('re-consent while a refresh is delayed preserves the new grant after the old result is rejected', async t => {
  const f = await providerFixture(); t.after(() => f.close()); const session = await newSession(f);
  await authorize(session, f);
  const barrier = f.pauseRefresh(); const old = session.refresh('browser-a'); await barrier.reached;
  await authorize(session, f);
  assert.equal(session.report('browser-a').observations.tokenRotation, false);
  barrier.release(); await assert.rejects(old, /FLOW_SUPERSEDED/);
  await session.refresh('browser-a');
  assert.equal(session.report('browser-a').connected, true);
});

test('upstream token errors are rendered as safe codes and the local server closes its listener', async t => {
  const { f, server, cookie } = await runner(t);
  f.overrides.set('/oauth/token', { status: 400, body: { error: 'invalid_request', error_description: 'SECRET_SENTINEL', access_token: 'ACCESS_SENTINEL' } });
  const start = await post(`${server.url}start`, cookie);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const response = await fetch(`${server.url}oauth/callback?state=${state}&code=CODE_SENTINEL`, { redirect: 'manual', headers: { Cookie: cookie } });
  assert.equal(response.headers.get('location'), '/');
  const page = await (await fetch(server.url, { headers: { Cookie: cookie } })).text();
  assert.match(page, /PROVIDER_REJECTED/); assert.doesNotMatch(page, /SENTINEL/);
  await server.close();
  await assert.rejects(fetch(server.url));
});
