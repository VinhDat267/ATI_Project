/**
 * Stores the test services' credentials in a running live server through its
 * own configuration API, then asks the server to verify each connection.
 *
 *   node --env-file=.env --import tsx evaluations/live-app/setup-credentials.ts
 *
 * Tokens and allowlists come from the environment exactly as in
 * live-execution (readLiveConfig); nothing secret is printed.
 */
import { readLiveConfig } from '../live-execution/harness.js';

const base = process.env.LIVE_APP_API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;

async function call(path: string, init: RequestInit & { token?: string } = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({})) as Record<string, any>;
  return { status: response.status, body };
}

async function main() {
  const health = await call('/api/health');
  if (health.status !== 200) throw new Error(`Server at ${base} is not healthy (HTTP ${health.status})`);

  const { CHAT_ADMIN_EMAIL: email, CHAT_ADMIN_PASSWORD: password } = process.env;
  if (!email || !password) throw new Error('CHAT_ADMIN_EMAIL and CHAT_ADMIN_PASSWORD are required');
  const login = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (login.status !== 200) throw new Error(`Login failed (HTTP ${login.status})`);
  const token = String(login.body.accessToken);

  const { services, skipped } = readLiveConfig(process.env);
  for (const [service, reason] of Object.entries(skipped)) console.log(`${service}: OFF - ${reason}`);

  let failed = false;
  for (const [service, config] of Object.entries(services)) {
    const saved = await call(`/api/services/${service}/credentials`, {
      method: 'POST', token,
      body: JSON.stringify({ credentials: config.credentials, allowedScope: config.allowedScope }),
    });
    if (saved.status !== 200) {
      failed = true;
      console.log(`${service}: save failed (HTTP ${saved.status}) ${saved.body.error ?? ''}`);
      continue;
    }
    const tested = await call(`/api/services/${service}/test`, { method: 'POST', token });
    if (tested.status !== 200) failed = true;
    console.log(`${service}: saved, scope ${JSON.stringify(config.allowedScope)}, connection ${tested.body.status ?? `HTTP ${tested.status}`}`);
  }
  if (failed || Object.keys(services).length === 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`Setup failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  process.exitCode = 1;
});
