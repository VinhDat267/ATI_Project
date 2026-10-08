import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const databaseUrl = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';
const schema = `auth02b_live_${randomUUID().replaceAll('-', '')}`;
const scopedUrl = new URL(databaseUrl);
scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
// Never hand real provider or mail credentials from a developer .env to this live process.
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(SMTP_|MAIL_FROM|APP_BASE_URL|AUTH_SIGNUP_ENABLED|TRELLO_|SLACK_|GITHUB_TOKEN|GOOGLE_|NOTION_|TELEGRAM_|JIRA_|LIVE_|LLM_|GEMINI_|SANDBOX_|CHAT_ADMIN_|SERVICE_ADMIN)/.test(key)));

async function unusedPort() {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = (socket.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

describe('AUTH-02b: live API without SMTP on real PostgreSQL', () => {
  let admin: pg.Pool, child: ChildProcess | undefined, output = '', baseUrl = '';
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const pool = new pg.Pool({ connectionString: scopedUrl.href });
    try {
      const directory = `${root}db/v3`;
      for (const file of (await readdir(directory)).filter(file => /^\d{4}_.*\.sql$/.test(file)).sort()) {
        await pool.query(await readFile(`${directory}/${file}`, 'utf8'));
      }
    } finally { await pool.end(); }
    const port = await unusedPort();
    child = spawn(process.execPath, ['--import', 'tsx', 'apps/chat-api/src/server.ts'], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...inherited, RUNTIME_MODE: 'live', NODE_ENV: 'development', DATABASE_URL: scopedUrl.href, PORT: String(port),
        JWT_SECRET: 'auth02b-live-startup-secret-at-least-32-bytes', ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
        LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'http://127.0.0.1:9/v1', LLM_MODEL: 'fixture-model', AUTH_SIGNUP_ENABLED: 'true' },
    });
    child.stdout!.on('data', chunk => { output += chunk; });
    child.stderr!.on('data', chunk => { output += chunk; });
    baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`API exited during startup: ${output}`);
      try { if ((await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(300) })).ok) return; } catch { /* not listening yet */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`API did not become healthy: ${output}`);
  }, 30_000);
  afterAll(async () => {
    if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin?.end();
  });

  it('starts, reports signup closed and answers every email route with 503', async () => {
    expect(output).toContain('Chưa cấu hình SMTP');
    const config = await (await fetch(`${baseUrl}/api/auth/config`)).json();
    expect(config.signupEnabled).toBe(false);
    for (const path of ['signup', 'verify-email', 'resend-verification', 'forgot-password', 'reset-password']) {
      const response = await fetch(`${baseUrl}/api/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'person@example.test', password: 'auth02b-password-123', name: 'Person', token: 'x'.repeat(43) }) });
      expect([path, response.status]).toEqual([path, 503]);
      expect((await response.json()).error).toBe('Chưa cấu hình gửi email.');
    }
  });
});
