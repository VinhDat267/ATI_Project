import { test, expect } from '@playwright/test';
import pg from 'pg';
import { cancelThroughUi, loginAtLoginPage, readServerTiming, runLatencyBatch, summarizeLatency, type LatencyTurn } from '../../../../evaluations/live-app/batch.js';

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
    // Each turn cancels its own plan before the next prompt; the final pass is only a safety net.
    const seen: LatencyTurn[] = [];
    const turns = await runLatencyBatch(page, pool, prompts, { pauseMs: 0, timeoutMs: 20_000, graceMs: 5_000, finalWaitMs: 5_000, onTurn: (turn) => seen.push(turn) });
    expect(seen.map((t) => [t.id, t.server?.planStatuses])).toEqual([['w404-1', ['rejected']], ['w404-2', ['rejected']], ['w404-3', ['rejected']]]);
    expect(turns.map((t) => [t.uiKind, t.resolved])).toEqual([['plan', true], ['plan', true], ['plan', true]]);
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
    const seen: LatencyTurn[] = [];
    const [turn] = await runLatencyBatch(page, pool, prompts, { pauseMs: 0, timeoutMs: 1, graceMs: 20_000, finalWaitMs: 5_000, onTurn: (t) => seen.push(t) });
    // The turn itself waited out the late plan and cancelled it, before the final pass.
    expect(seen[0]!.server).toMatchObject({ kind: 'plan', planStatuses: ['rejected'] });
    expect(turn).toMatchObject({ uiKind: 'timeout', visibleMs: null, frontendMs: null, resolved: true });
    expect(turn!.server).toMatchObject({ kind: 'plan', planStatuses: ['rejected'], executionSteps: 0 });
    expect((await plansOf(pool, [turn!.conversationId])).map(({ status, steps }) => [status, steps])).toEqual([['rejected', 0]]);
  } finally {
    await pool.end();
  }
});

/** Holds the plan insert of conversations whose prompt carries the marker, so the response arrives after the batch has looked. */
async function withSlowPlans(pool: pg.Pool, marker: string, seconds: number, run: () => Promise<void>) {
  const name = `w404_slow_${marker}`;
  await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF EXISTS (SELECT 1 FROM messages WHERE conv_id = NEW.conv_id AND content LIKE '%${marker}%') THEN PERFORM pg_sleep(${seconds}); END IF;
    RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON plans FOR EACH ROW EXECUTE FUNCTION ${name}()`);
  try { await run(); } finally {
    await pool.query(`DROP TRIGGER IF EXISTS ${name} ON plans`);
    await pool.query(`DROP FUNCTION IF EXISTS ${name}()`);
  }
}

test('W4-04: a response that arrives after the final check leaves the batch unsettled', async ({ page }) => {
  test.setTimeout(90_000);
  const pool = new pg.Pool({ connectionString });
  try {
    await loginAtLoginPage(page, email!, password!);
    const marker = `late${Date.now()}`;
    let conversationId: string | null = null;
    await withSlowPlans(pool, marker, 6, async () => {
      const [turn] = await runLatencyBatch(page, pool, [{ id: 'w404-unsettled', services: ['trello', 'slack'], prompt: `Tạo task Trello và báo Slack W4-04 ${marker}` }],
        { pauseMs: 0, timeoutMs: 25, graceMs: 0, finalWaitMs: 0 });
      conversationId = turn!.conversationId;
      expect(turn).toMatchObject({ uiKind: 'timeout', resolved: false });
      expect(turn!.server).toMatchObject({ kind: null, plans: 0 });
      const summary = summarizeLatency([turn!], { timeoutMs: 25 });
      expect(summary.unresolved).toEqual([{ id: 'w404-unsettled', conversationId }]);
    });
    // The plan the batch could not see still arrives; it is pending until someone cancels it.
    await expect.poll(async () => (await readServerTiming(pool, conversationId!)).planStatuses, { timeout: 20_000 }).toEqual(['pending']);
    await cancelThroughUi(page, pool, conversationId!);
    expect((await readServerTiming(pool, conversationId!)).planStatuses).toEqual(['rejected']);
  } finally {
    await pool.end();
  }
});

test('W4-04: the final wait settles a response that arrives after its turn and grace', async ({ page }) => {
  test.setTimeout(90_000);
  const pool = new pg.Pool({ connectionString });
  try {
    await loginAtLoginPage(page, email!, password!);
    const marker = `final${Date.now()}`;
    await withSlowPlans(pool, marker, 6, async () => {
      const [turn] = await runLatencyBatch(page, pool, [{ id: 'w404-final', services: ['trello', 'slack'], prompt: `Tạo task Trello và báo Slack W4-04 ${marker}` }],
        { pauseMs: 0, timeoutMs: 25, graceMs: 0, finalWaitMs: 30_000 });
      expect(turn).toMatchObject({ uiKind: 'timeout', resolved: true });
      expect(turn!.server).toMatchObject({ kind: 'plan', planStatuses: ['rejected'], executionSteps: 0 });
      expect(summarizeLatency([turn!], { timeoutMs: 25 }).unresolved).toEqual([]);
    });
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
    const [turn] = await runLatencyBatch(page, pool, prompts, { pauseMs: 0, timeoutMs: 20_000, graceMs: 5_000, finalWaitMs: 5_000 });
    expect(turn!.uiKind).toBe('clarification');
    expect(turn!.visibleMs).toBeGreaterThan(0);
    expect(turn!.server).toMatchObject({ kind: 'clarification', plans: 0, executionSteps: 0 });
  } finally {
    await pool.end();
  }
});
