import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { SERVICE_REGISTRY } from '@wap/tool-schemas';
import { SERVICES, isSettled, parseLatencyPrompts, percentile, readServerTiming, serverTimingFromRow, serviceGroup, summarizeLatency, uiKindOf, type LatencyTurn } from './batch.js';

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

describe('latency prompts', () => {
  const prompts = parseLatencyPrompts(read('latency-prompts.json'));
  it('has at least 20 prompts over one, two and three services, and at least four over four or more', () => {
    expect(prompts.length).toBeGreaterThanOrEqual(20);
    const groups = prompts.map((p) => serviceGroup(p.services.length));
    for (const group of ['1', '2', '3']) expect(groups, group).toContain(group);
    expect(groups.filter((group) => group === '≥4').length).toBeGreaterThanOrEqual(4);
  });
  it('names services that exist, one entry each', () => {
    expect(SERVICES).toEqual(SERVICE_REGISTRY.map((service) => service.id));
  });
  it.each([
    ['another version', { version: 2, prompts: [{ id: 'a', services: ['slack'], prompt: 'Tell the channel hello' }] }, /version 1/],
    ['a duplicate id', { version: 1, prompts: [{ id: 'a', services: ['slack'], prompt: 'Tell the channel hello' }, { id: 'a', services: ['slack'], prompt: 'Tell the channel bye' }] }, /unique/],
    ['an unknown service', { version: 1, prompts: [{ id: 'a', services: ['gmail'], prompt: 'Send an email to the team' }] }, /services/],
    ['a short prompt', { version: 1, prompts: [{ id: 'a', services: ['slack'], prompt: 'hi' }] }, /full chat request/],
  ])('rejects %s', (_label, file, message) => {
    expect(() => parseLatencyPrompts(JSON.stringify(file))).toThrow(message);
  });
});

describe('the batch never approves', () => {
  it.each(['batch.ts', 'latency.e2e.ts'])('%s has no approve button or approve request', (name) => {
    const source = read(name);
    expect(source).not.toMatch(/Duyệt kế hoạch|\/approve|approvePlan/);
  });
});

describe('response kinds and timing', () => {
  it.each([['4', null, 'plan'], ['3', null, 'clarification'], ['refusal', null, 'refusal'], ['answer', null, 'answer'], ['1', 'view-server', 'error'], ['2', null, 'timeout']] as const)(
    'moment %s / id %s is %s', (moment, id, kind) => expect(uiKindOf(moment, id)).toBe(kind));
  const t0 = new Date('2026-10-21T03:00:00.000Z');
  const after = (ms: number) => new Date(t0.getTime() + ms);
  it('splits the server time into planner and saving', () => {
    expect(serverTimingFromRow({ user_at: t0, memory_at: after(8000), response_at: after(8100), response_type: 'plan', plans: 1, plan_statuses: ['rejected'], execution_steps: 0 }))
      .toEqual({ kind: 'plan', plannerMs: 8000, saveMs: 100, serverMs: 8100, plans: 1, planStatuses: ['rejected'], executionSteps: 0 });
  });
  it('keeps the server time of a planning error, which saves no working memory', () => {
    expect(serverTimingFromRow({ user_at: t0, memory_at: null, response_at: after(30_500), response_type: 'planning_error', plans: 0, plan_statuses: null, execution_steps: 0 }))
      .toMatchObject({ kind: 'error', plannerMs: null, saveMs: null, serverMs: 30_500, planStatuses: [] });
  });
  it('has no server time while no response is saved', () => {
    expect(serverTimingFromRow({ user_at: t0, memory_at: null, response_at: null, response_type: null, plans: 0, plan_statuses: null, execution_steps: 0 }))
      .toMatchObject({ kind: null, plannerMs: null, serverMs: null });
  });
  it('settles a conversation only when it has a response and no open plan', () => {
    const server = (kind: 'plan' | null, planStatuses: string[]) => ({ kind, plannerMs: null, saveMs: null, serverMs: null, plans: planStatuses.length, planStatuses, executionSteps: 0 });
    expect([isSettled(server('plan', ['rejected'])), isSettled(server('plan', ['superseded', 'pending'])), isSettled(server('plan', ['approved'])),
      isSettled(server(null, [])), isSettled(null)]).toEqual([true, false, false, false, false]);
  });
  it('uses nearest-rank percentiles', () => {
    expect([percentile([5, 1, 3, 2, 4], 0.5), percentile([5, 1, 3, 2, 4], 0.95), percentile([], 0.5)]).toEqual([3, 5, null]);
  });
});

describe('summary', () => {
  const turn = (index: number, serviceCount: number, visibleMs: number | null, uiKind: LatencyTurn['uiKind'] = 'plan'): LatencyTurn => ({
    id: `t${index}`, services: SERVICES.slice(0, serviceCount), serviceCount, startedAt: '2026-10-21T03:00:00.000Z', conversationId: randomUUID(), uiKind, visibleMs, resolved: true,
    frontendMs: visibleMs === null ? null : 500,
    server: { kind: uiKind === 'timeout' ? null : uiKind === 'error' ? 'error' : uiKind, plannerMs: visibleMs === null ? null : visibleMs - 600,
      saveMs: visibleMs === null ? null : 100, serverMs: visibleMs === null ? null : visibleMs - 500,
      plans: uiKind === 'plan' ? 1 : 0, planStatuses: uiKind === 'plan' ? ['rejected'] : [], executionSteps: 0 },
  });
  it('reports the share under 15 s, percentiles by service count and the server share', () => {
    const turns = [
      ...[6000, 7000, 8000, 9000, 10_000].map((ms, i) => turn(i, 1, ms)),
      ...[9000, 12_000, 14_000, 16_000, 20_000].map((ms, i) => turn(10 + i, 2, ms)),
      ...[11_000, 13_000, 15_000, 17_000, 30_000].map((ms, i) => turn(20 + i, 3, ms)),
      turn(30, 4, 18_000), turn(31, 5, 25_000), turn(32, 4, 4000, 'clarification'), turn(33, 4, null, 'timeout'),
    ];
    const summary = summarizeLatency(turns, { timeoutMs: 120_000 });
    expect(summary).toMatchObject({ turns: 19, under15: 11, executionSteps: 0, openPlans: 0, unresolved: [], kinds: { plan: 17, clarification: 1, timeout: 1 } });
    expect(summary.byGroup['1']).toEqual({ turns: 5, p50: 8000, p95: 10_000, max: 10_000 });
    // The timed-out turn is slower than the wait, not left out: it sets p95 and max of its group.
    expect(summary.byGroup['≥4']).toEqual({ turns: 4, p50: 18_000, p95: Infinity, max: Infinity });
    const visible = turns.filter((t) => t.visibleMs !== null);
    expect(summary.serverShare).toBeCloseTo(visible.reduce((s, t) => s + t.visibleMs! - 500, 0) / visible.reduce((s, t) => s + t.visibleMs!, 0), 10);
    expect(summary.markdown).toContain('Dưới 15 s: **11/19 = 57,9%**');
    expect(summary.markdown).toContain('| ≥4 | 4 | 18,0 s | > 120,0 s | > 120,0 s |');
    expect(summary.markdown).toContain('| t33 | trello, slack, github, sheets | timeout | — |');
    expect(summary.markdown).toContain('Có phản hồi: 18/19');
  });
  it('does not report the percentiles of the few turns that answered when most timed out', () => {
    const turns = [turn(0, 1, 5000), ...Array.from({ length: 19 }, (_, i) => turn(i + 1, 1, null, 'timeout'))];
    const summary = summarizeLatency(turns, { timeoutMs: 120_000 });
    expect(summary.byGroup['1']).toEqual({ turns: 20, p50: Infinity, p95: Infinity, max: Infinity });
    expect(summary.markdown).toMatch(/Toàn bộ 20 lượt[^\n]*p50 > 120,0 s, p95 > 120,0 s, max > 120,0 s/);
    expect(summary.markdown).toContain('Dưới 15 s: **1/20 = 5,0%**');
  });
  it('lists turns whose conversation was not settled when the batch ended', () => {
    const settled = turn(1, 1, 5000);
    const late = { ...turn(2, 2, null, 'timeout'), resolved: false };
    const summary = summarizeLatency([settled, late], { timeoutMs: 25 });
    expect(summary.unresolved).toEqual([{ id: 't2', conversationId: late.conversationId }]);
    expect(summary.markdown).toContain(`Lượt chưa xác minh xong: **1** (t2: ${late.conversationId})`);
  });
  it('counts executed steps and plans left open, which must both be zero', () => {
    const leaked = turn(1, 1, 5000);
    leaked.server!.executionSteps = 2; leaked.server!.planStatuses = ['pending'];
    expect(summarizeLatency([leaked])).toMatchObject({ executionSteps: 2, openPlans: 1 });
  });
});

describe('PostgreSQL timing', () => {
  const base = process.env.DATABASE_URL || 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';
  const schema = `latency_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: base });
  const url = new URL(base); url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: url.href, max: 2 });
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 21, 3, 0, 0) + ms).toISOString();
  let user = '';
  const conversation = async () => (await pool.query('INSERT INTO conversations (user_id) VALUES ($1) RETURNING id', [user])).rows[0].id as string;
  const message = (conv: string, role: string, type: string | null, ms: number) =>
    pool.query('INSERT INTO messages (conv_id, role, content, metadata, created_at) VALUES ($1, $2, $3, $4, $5)', [conv, role, 'nội dung', type ? { type } : null, at(ms)]);
  const plan = async (conv: string, status: string, ms: number) => (await pool.query(
    "INSERT INTO plans (conv_id, plan_json, plan_hash, status, expires_at, created_at) VALUES ($1, '{}', 'h', $2, now() + interval '30 minutes', $3) RETURNING id", [conv, status, at(ms)])).rows[0].id as string;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const directory = fileURLToPath(new URL('../../db/v3/', import.meta.url));
    for (const file of (await readdir(directory)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) await pool.query(await readFile(`${directory}/${file}`, 'utf8'));
    user = (await pool.query("INSERT INTO users (email, name, password) VALUES ($1, 'Đo latency', NULL) RETURNING id", [`${randomUUID()}@example.test`])).rows[0].id;
  });
  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  });

  it('reads a cancelled plan: planner up to working memory, then saving', async () => {
    const conv = await conversation();
    await message(conv, 'user', null, 0);
    await message(conv, 'system', 'working_memory', 8000);
    await plan(conv, 'rejected', 8050);
    await message(conv, 'assistant', 'plan', 8100);
    expect(await readServerTiming(pool, conv)).toEqual({ kind: 'plan', plannerMs: 8000, saveMs: 100, serverMs: 8100, plans: 1, planStatuses: ['rejected'], executionSteps: 0 });
  });
  it('takes the first response and counts every plan and executed step of the conversation', async () => {
    const conv = await conversation();
    await message(conv, 'user', null, 0);
    await message(conv, 'system', 'working_memory', 3000);
    await message(conv, 'assistant', 'clarification', 3020);
    await message(conv, 'user', null, 9000);
    await message(conv, 'system', 'working_memory', 15_000);
    const id = await plan(conv, 'completed', 15_050);
    await message(conv, 'assistant', 'plan', 15_100);
    await pool.query("INSERT INTO execution_steps (plan_id, step_id, tool, args_json, status, requested_by) VALUES ($1, 'step_1', 'slack.send_message', '{}', 'succeeded', $2)", [id, user]);
    expect(await readServerTiming(pool, conv)).toEqual({ kind: 'clarification', plannerMs: 3000, saveMs: 20, serverMs: 3020, plans: 1, planStatuses: ['completed'], executionSteps: 1 });
  });
  it('has no server time for a conversation still planning', async () => {
    const conv = await conversation();
    await message(conv, 'user', null, 0);
    expect(await readServerTiming(pool, conv)).toEqual({ kind: null, plannerMs: null, saveMs: null, serverMs: null, plans: 0, planStatuses: [], executionSteps: 0 });
  });
});
