import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { generateTokens } from '../../src/auth/jwt.js';
import { DEMO_ADMIN_ID } from '../../src/routes/auth-routes.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const secret = 'memory-snapshot-test-secret-at-least-32-bytes';
const token = generateTokens({ id: DEMO_ADMIN_ID, email: 'fixture@memory.test', name: 'Fixture' }, secret).accessToken;
const children = new Set<ChildProcess>();

async function unusedPort() {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = (socket.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitUntil(check: () => Promise<boolean>) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for sandbox memory workflow');
}

afterEach(async () => {
  await Promise.all([...children].map(async child => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  }));
  children.clear();
});

describe('execution snapshot through the real database-offline sandbox server', () => {
  it.each(['default', 'partial_failure'])('serves durable-shaped snapshot/actions in %s memory fallback', async scenario => {
    const port = await unusedPort();
    const dbPort = await unusedPort();
    const child = spawn(process.execPath, ['--import', 'tsx', 'apps/chat-api/src/server.ts'], {
      cwd: root, env: { ...process.env, DATABASE_URL: `postgresql://fixture:fixture@127.0.0.1:${dbPort}/unavailable`,
        RUNTIME_MODE: 'sandbox', NODE_ENV: 'development', LLM_PROVIDER: 'gemini', JWT_SECRET: secret,
        PORT: String(port), SANDBOX_SCENARIO: scenario }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    let output = ''; child.stdout!.on('data', chunk => { output += chunk; }); child.stderr!.on('data', chunk => { output += chunk; });
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const call = (path: string, body?: unknown) => fetch(`${baseUrl}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    await waitUntil(async () => {
      if (child.exitCode !== null) throw new Error(`Sandbox exited: ${output}`);
      try { return (await call('/health')).ok; } catch { return false; }
    });
    expect(output).toContain('In-Memory');
    const created = await call('/conversations', {});
    expect(created.status).toBe(201);
    const convId = (await created.json()).conversation.id;
    expect((await call(`/conversations/${convId}/messages`, { content: 'Tạo task sửa CSS trên Trello và thông báo Slack' })).status).toBe(202);
    let plan: any;
    await waitUntil(async () => {
      const response = await call(`/conversations/${convId}/plans/active`);
      if (!response.ok) return false;
      plan = await response.json(); return true;
    });
    expect((await call(`/plans/${plan.id}/approve`, {})).status).toBe(200);
    await waitUntil(async () => {
      const response = await call(`/executions/${plan.id}/status`);
      return response.ok && (await response.json()).status === (scenario === 'partial_failure' ? 'partial' : 'completed');
    });
    const endpoint = `/conversations/${convId}/executions/latest`;
    const response = await call(endpoint);
    expect(response.status).toBe(200);
    const snapshot = await response.json();
    expect(snapshot.steps.map((step: any) => step.stepId)).toEqual(plan.steps.map((step: any) => step.id));
    expect(snapshot.steps[0]).toMatchObject({ status: 'succeeded', output: { id: expect.any(String) },
      startedAt: expect.any(String), completedAt: expect.any(String), durationMs: expect.any(Number) });
    expect(snapshot.recoveryActions).toEqual(scenario === 'partial_failure' ? ['retry', 'skip', 'stop'] : []);
    if (scenario === 'partial_failure') {
      const pausedId = snapshot.execution.pausedStepId;
      expect((await call(`/executions/${plan.id}/steps/${pausedId}/skip`, {})).status).toBe(200);
      const after = await (await call(endpoint)).json();
      expect(after.execution.status).toBe('completed');
      expect(after.steps[0]).toEqual(snapshot.steps[0]);
      expect(after.recoveryActions).toEqual([]);
    }
  }, 15_000);
});
