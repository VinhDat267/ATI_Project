import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { startGoogleFixture } from './google-oidc-fixture.mjs';

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
