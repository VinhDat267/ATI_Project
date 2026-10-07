import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { startGoogleFixture } from './google-oidc-fixture.mjs';
import { createHash } from 'node:crypto';

test('Google browser fixture uses the explicitly selected isolated web callback', async t => {
  const redirectUri='http://127.0.0.1:5176/auth/google/callback';
  const fixture=await startGoogleFixture({redirectUri});t.after(()=>fixture.stop());
  const params=new URLSearchParams({client_id:'auth04-test.apps.googleusercontent.com',redirect_uri:redirectUri,response_type:'code',scope:'openid email profile',state:'isolated-state',nonce:'isolated-nonce',code_challenge_method:'S256',code_challenge:createHash('sha256').update('a'.repeat(43)).digest('base64url')});
  const response=await fetch(`${fixture.origin}/authorize?${params}`,{redirect:'manual'});
  assert.equal(response.status,302);
  const callback=new URL(response.headers.get('location'));assert.equal(callback.origin+callback.pathname,redirectUri);
  params.set('redirect_uri','http://127.0.0.1:5174/auth/google/callback');
  assert.equal((await fetch(`${fixture.origin}/authorize?${params}`,{redirect:'manual'})).status,400);
});

// CI of PR #69 failed with EADDRINUSE: the fixed port 55534 lies in the Linux ephemeral
// range, so any outgoing socket on the runner may already hold it.
test('starts the Google OIDC fixture even when port 55534 is already taken', async t => {
  const blocker = createServer();
  blocker.listen(55534, '127.0.0.1');
  await once(blocker, 'listening').catch(() => { /* already taken by something else: same situation */ });
  t.after(() => new Promise(resolve => blocker.close(() => resolve())));
  const fixture = await startGoogleFixture();
  t.after(() => fixture.stop());
  assert.notEqual(Number(new URL(fixture.origin).port), 55534);
  assert.equal((await fetch(`${fixture.origin}/jwks`)).status, 200);
});
