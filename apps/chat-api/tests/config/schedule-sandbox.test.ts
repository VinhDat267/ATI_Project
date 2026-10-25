import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { createSandboxProvider } from '../../src/sandbox/scenarios.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const secret = 'schedule-sandbox-test-secret-at-least-32-bytes';
type Db = Awaited<ReturnType<typeof createMigratedSchema>>;

async function unusedPort() {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = (socket.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitFor<T>(check: () => Promise<T | undefined | false>, what: string): Promise<T> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

describe('the schedule sandbox scenario over HTTP and PostgreSQL', () => {
  let db: Db, child: ChildProcess, output = '';

  beforeAll(async () => { db = await createMigratedSchema('schedule_sandbox'); });
  afterAll(async () => {
    if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
    await db?.close();
  });

  it('proposes, confirms, changes and runs a schedule into a Calendar → Slack plan waiting for approval', async () => {
    const owner = await db.person('Chủ lịch');
    const schema = (await db.pool.query('SELECT current_schema() AS s')).rows[0].s;
    const url = new URL(process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3');
    url.searchParams.set('options', `-c search_path=${schema}`);
    const port = await unusedPort();
    child = spawn(process.execPath, ['--import', 'tsx', 'apps/chat-api/src/server.ts'], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
      // The scenario must pick its own search mode: regex here would stop at looking "#ati-test" up.
      env: { ...process.env, DATABASE_URL: url.href, RUNTIME_MODE: 'sandbox', NODE_ENV: 'development', JWT_SECRET: secret, PORT: String(port),
        SANDBOX_SCENARIO: 'schedule', SCHEDULES_ENABLED: 'on', GMAIL_ENABLED: 'off', PLANNER_READ_ANSWERS: 'off', PLANNER_SEARCH_MODE: 'regex',
        APP_TIME_ZONE: 'Asia/Ho_Chi_Minh' },
    });
    child.stdout!.on('data', chunk => { output += chunk; }); child.stderr!.on('data', chunk => { output += chunk; });
    const headers = { Authorization: `Bearer ${generateAccessToken(owner, secret, owner.sid).accessToken}`, 'Content-Type': 'application/json' };
    const call = async (path: string, body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers,
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
      return { status: response.status, body: await response.json().catch(() => null) };
    };
    await waitFor(async () => {
      if (child.exitCode !== null) throw new Error(`Sandbox exited: ${output}`);
      try { return (await call('/health')).body?.schedulesEnabled === true; } catch { return false; }
    }, 'the server');

    const convId = (await call('/conversations', {})).body.conversation.id as string;
    const proposals = () => db.pool.query("SELECT id, metadata FROM messages WHERE conv_id=$1 AND metadata->>'type'='schedule_proposal' ORDER BY created_at, id", [convId]);
    const nextProposal = async (count: number) => waitFor(async () => {
      const rows = (await proposals()).rows;
      return rows.length === count && rows.at(-1);
    }, `proposal ${count}: ${output.slice(-2000)}`);

    expect((await call(`/conversations/${convId}/messages`, { content: 'Mỗi sáng 8 giờ, gửi lịch họp hôm nay lên Slack #ati-test' })).status).toBe(202);
    const created = await nextProposal(1);
    expect(created.metadata).toMatchObject({ proposal: { action: 'create', name: 'Lịch họp hằng ngày', request: 'Gửi lịch họp hôm nay lên Slack #ati-test',
      recurrence: { type: 'daily', time: '08:00' } }, services: ['slack', 'calendar'], scheduleId: null });
    let confirmed = await call(`/conversations/${convId}/schedule-proposals/${created.id}/confirm`, {});
    expect(confirmed).toMatchObject({ status: 200, body: { schedule: { status: 'active', version: 1, services: ['slack', 'calendar'] } } });
    const scheduleId = confirmed.body.schedule.id as string;

    expect((await call(`/conversations/${convId}/messages`, { content: 'Đổi sang 8 giờ 30, thứ Hai đến thứ Sáu' })).status).toBe(202);
    const changed = await nextProposal(2);
    expect(changed.metadata).toMatchObject({ proposal: { action: 'update', recurrence: { type: 'weekly', time: '08:30', days: [1, 2, 3, 4, 5] } },
      scheduleId, baseVersion: 1, previous: { recurrence: { type: 'daily', time: '08:00' } } });
    confirmed = await call(`/conversations/${convId}/schedule-proposals/${changed.id}/confirm`, {});
    expect(confirmed.body.schedule).toMatchObject({ version: 2, recurrence: { type: 'weekly', time: '08:30', days: [1, 2, 3, 4, 5] } });

    const started = await call(`/schedules/${scheduleId}/run-now`, {});
    expect(started).toMatchObject({ status: 201, body: { run: { trigger: 'manual', state: 'planning' } } });
    const run = await waitFor(async () => {
      const row = (await db.pool.query('SELECT * FROM schedule_runs WHERE id=$1', [started.body.run.id])).rows[0];
      return row.status !== 'planning' && row;
    }, `the run: ${output.slice(-2000)}`);
    expect(run.status).toBe('planned');
    const plan = (await db.pool.query('SELECT conv_id, status, plan_json FROM plans WHERE id=$1', [run.plan_id])).rows[0];
    expect(plan).toMatchObject({ conv_id: run.conv_id, status: 'pending' });
    expect(plan.plan_json.steps.map((step: any) => step.tool)).toEqual(['calendar.create_event', 'slack.send_message']);
    const runs = (await call(`/schedules/${scheduleId}/runs`)).body.runs;
    expect(runs[0]).toMatchObject({ id: run.id, state: 'awaiting_approval', planId: run.plan_id });
  }, 60_000);

  it('answers by the last request of the conversation, not by a shared counter', async () => {
    const provider = createSandboxProvider('schedule');
    const reply = async (...texts: string[]) => JSON.parse(await provider.generatePlan({ conversationHistory: [
      ...texts.slice(0, -1).flatMap((content) => [{ role: 'user', content }, { role: 'assistant', content: '{}' }]), { role: 'user', content: texts.at(-1)! }] } as any));
    expect(await reply('Mỗi sáng 8 giờ, gửi lịch họp hôm nay lên Slack #ati-test')).toMatchObject({ kind: 'schedule', action: 'create' });
    expect(await reply('Mỗi sáng 8 giờ…', 'Tạm dừng lịch này')).toMatchObject({ kind: 'schedule', action: 'pause' });
    expect(await reply('Mỗi sáng 8 giờ…', 'Chạy tiếp lịch này')).toMatchObject({ kind: 'schedule', action: 'resume' });
    expect(await reply('Mỗi sáng 8 giờ…', 'Hủy lịch này')).toMatchObject({ kind: 'schedule', action: 'cancel' });
    expect(await reply('Đổi sang 8 giờ 30, thứ Hai đến thứ Sáu')).toMatchObject({ action: 'update', recurrence: { days: [1, 2, 3, 4, 5] } });
    expect((await reply('Gửi lịch họp hôm nay lên Slack #ati-test\n\n(Lượt chạy theo lịch "Lịch họp hằng ngày" lúc 26/10 08:00.)')).kind).toBe('plan');
  });
});
