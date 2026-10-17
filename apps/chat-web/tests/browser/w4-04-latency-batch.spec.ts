import { test, expect } from '@playwright/test';
import pg from 'pg';
import { loginAtLoginPage, runLatencyBatch, summarizeLatency } from '../../../../evaluations/live-app/batch.js';

const email = process.env.CHAT_ADMIN_EMAIL;
const password = process.env.CHAT_ADMIN_PASSWORD;
const connectionString = process.env.DATABASE_URL;
if (!email || !password || !connectionString) throw new Error('Browser E2E requires provisioned CHAT_ADMIN_* and DATABASE_URL');

async function plansOf(pool: pg.Pool, conversationIds: Array<string | null>) {
  return (await pool.query(`SELECT p.conv_id, p.status, (SELECT count(*) FROM execution_steps s WHERE s.plan_id = p.id)::int AS steps
    FROM plans p WHERE p.conv_id = ANY($1::uuid[]) ORDER BY p.created_at`, [conversationIds])).rows;
}

test('W4-04: batch latency run cancels every plan and executes nothing', async ({ page }) => {
  test.setTimeout(120_000);
  const pool = new pg.Pool({ connectionString });
  try {
    await loginAtLoginPage(page, email!, password!);
    const stamp = Date.now();
    const prompts = [1, 2, 3].map((i) => ({ id: `w404-${i}`, services: ['trello', 'slack'], prompt: `Tạo task Trello và báo Slack W4-04 batch ${i} ${stamp}` }));
    const seen: string[] = [];
    const turns = await runLatencyBatch(page, pool, prompts, { pauseMs: 0, timeoutMs: 20_000, graceMs: 5_000, onTurn: (turn) => seen.push(turn.id) });
    expect(seen).toEqual(['w404-1', 'w404-2', 'w404-3']);
    expect(turns.map((t) => t.uiKind)).toEqual(['plan', 'plan', 'plan']);
    expect(new Set(turns.map((t) => t.conversationId)).size).toBe(3);
    for (const turn of turns) {
      expect(turn.visibleMs).toBeGreaterThan(0);
      expect(turn.server).toMatchObject({ kind: 'plan', plans: 1, planStatuses: ['rejected'], executionSteps: 0 });
      expect(turn.server!.plannerMs).toBeGreaterThanOrEqual(0);
      expect(turn.server!.serverMs).toBeGreaterThanOrEqual(turn.server!.plannerMs!);
      expect(turn.frontendMs).toBe(turn.visibleMs! - turn.server!.serverMs!);
    }
    // Each prompt is in its own conversation, and PostgreSQL holds only cancelled plans with no executed step.
    for (const [index, turn] of turns.entries()) {
      const prompt = (await pool.query("SELECT content FROM messages WHERE conv_id = $1 AND role = 'user'", [turn.conversationId])).rows;
      expect(prompt).toEqual([{ content: prompts[index]!.prompt }]);
    }
    expect((await plansOf(pool, turns.map((t) => t.conversationId))).map(({ status, steps }) => [status, steps])).toEqual([['rejected', 0], ['rejected', 0], ['rejected', 0]]);
    expect(summarizeLatency(turns)).toMatchObject({ turns: 3, executionSteps: 0, openPlans: 0, kinds: { plan: 3 } });
  } finally {
    await pool.end();
  }
});

test('W4-04: a plan that arrives after its turn timed out is still cancelled', async ({ page }) => {
  test.setTimeout(90_000);
  const pool = new pg.Pool({ connectionString });
  try {
    await loginAtLoginPage(page, email!, password!);
    const prompts = [{ id: 'w404-late', services: ['trello', 'slack'], prompt: `Tạo task Trello và báo Slack W4-04 late ${Date.now()}` }];
    // A 1 ms wait gives up on the screen before the sandbox plan arrives.
    const [turn] = await runLatencyBatch(page, pool, prompts, { pauseMs: 0, timeoutMs: 1, graceMs: 20_000 });
    expect(turn).toMatchObject({ uiKind: 'timeout', visibleMs: null, frontendMs: null });
    expect(turn!.server).toMatchObject({ kind: 'plan', planStatuses: ['rejected'], executionSteps: 0 });
    expect((await plansOf(pool, [turn!.conversationId])).map(({ status, steps }) => [status, steps])).toEqual([['rejected', 0]]);
  } finally {
    await pool.end();
  }
});

test('W4-04 clarification turn is recorded with no plan', async ({ page }) => {
  test.skip(process.env.SANDBOX_SCENARIO !== 'clarification', 'requires the explicit clarification sandbox scenario');
  const pool = new pg.Pool({ connectionString });
  try {
    await loginAtLoginPage(page, email!, password!);
    const prompts = [{ id: 'w404-ask', services: ['trello', 'slack'], prompt: `Tạo task trên board Frontend, gán Minh và thông báo Slack W4-04 ambiguous ${Date.now()}` }];
    const [turn] = await runLatencyBatch(page, pool, prompts, { pauseMs: 0, timeoutMs: 20_000, graceMs: 5_000 });
    expect(turn!.uiKind).toBe('clarification');
    expect(turn!.visibleMs).toBeGreaterThan(0);
    expect(turn!.server).toMatchObject({ kind: 'clarification', plans: 0, executionSteps: 0 });
  } finally {
    await pool.end();
  }
});
