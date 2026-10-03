import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  server.close();
  await once(server, 'close');
  return port;
}

async function waitFor(url, child, output) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`v3 launcher exited early: ${output()}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return response;
    } catch {
      // Servers are still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${output()}`);
}

test('v3 launcher starts the sandbox API and web proxy together', { timeout: 35_000 }, async () => {
  const apiPort = await freePort();
  const webPort = await freePort();
  let output = '';
  const child = spawn(process.execPath, ['scripts/start-v3.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      RUNTIME_MODE: 'sandbox',
      DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/unused',
      GEMINI_API_KEY: '',
      PORT: String(apiPort),
      V3_WEB_PORT: String(webPort),
      SANDBOX_USER_EMAIL: 'local@example.test',
      SANDBOX_USER_PASSWORD: 'local-test-password',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  try {
    const api = await waitFor(`http://127.0.0.1:${apiPort}/api/health`, child, () => output);
    assert.equal(api.status, 200);
    await assert.rejects(
      fetch(`http://127.0.0.2:${apiPort}/api/health`, { signal: AbortSignal.timeout(1_000) }),
    );
    const login = await fetch(`http://127.0.0.1:${apiPort}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'local@example.test', password: 'local-test-password' }),
    });
    assert.equal(login.status, 200);
    assert.ok((await login.json()).accessToken);
    const web = await waitFor(`http://127.0.0.1:${webPort}/`, child, () => output);
    assert.match(await web.text(), /<title>Planora · Từ ý tưởng đến hành động<\/title>/);
    const proxiedApi = await waitFor(`http://127.0.0.1:${webPort}/api/health`, child, () => output);
    assert.equal(proxiedApi.status, 200);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'close'), new Promise((resolve) => {
        const timer = setTimeout(resolve, 5_000);
        timer.unref();
      })]);
    }
  }
});
