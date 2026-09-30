/**
 * One chat request through the real product path: web UI -> chat-api (live
 * mode) -> real model -> plan preview -> human approval -> executor -> real
 * Trello, Slack and GitHub, with every state read back from PostgreSQL.
 *
 * The test stops at the preview, saves plan.json and waits for a reviewer to
 * write the plan's hash into confirm.txt in the run directory. Without that
 * file it cancels the plan, so nothing is written to an external service
 * unless a person approved exactly the plan that is on screen.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import pg from 'pg';

const email = process.env.CHAT_ADMIN_EMAIL;
const password = process.env.CHAT_ADMIN_PASSWORD;
const connectionString = process.env.DATABASE_URL;
const prompt = process.env.LIVE_APP_PROMPT;
const runDir = resolve(process.env.LIVE_APP_RUN_DIR || join('docs/ai-evidence/V3-LIVE-EXECUTION', `app-${new Date().toISOString().replace(/[:.]/g, '-')}`));
const confirmMinutes = Number(process.env.LIVE_APP_CONFIRM_TIMEOUT_MIN) || 25;
if (!email || !password || !connectionString || !prompt) {
  throw new Error('Live app run requires CHAT_ADMIN_*, DATABASE_URL and LIVE_APP_PROMPT');
}

const save = (name: string, value: unknown) => writeFileSync(join(runDir, name), `${JSON.stringify(value, null, 2)}\n`);

/** Resolves to the reviewer's decision: the approved hash, 'cancel', or null on timeout. */
async function waitForDecision(): Promise<string | null> {
  const file = join(runDir, 'confirm.txt');
  const deadline = Date.now() + confirmMinutes * 60_000;
  while (Date.now() < deadline) {
    if (existsSync(file)) return readFileSync(file, 'utf8').trim();
    await new Promise((done) => setTimeout(done, 1000));
  }
  return null;
}

test('live app: chat, preview, human approval and real execution', async ({ page }) => {
  mkdirSync(runDir, { recursive: true });
  const pool = new pg.Pool({ connectionString });
  try {
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Email' }).fill(email!);
    await page.getByLabel('Mật khẩu').fill(password!);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'AI Workflow Platform' })).toBeVisible();

    const created = page.waitForResponse((response) => response.url().endsWith('/api/conversations') && response.request().method() === 'POST');
    await page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...').fill(prompt!);
    const sentAt = Date.now();
    await page.getByRole('button', { name: 'Gửi' }).click();
    const body = await (await created).json();
    const conversationId = body.conversation?.id || body.id;
    expect(conversationId).toBeTruthy();

    const approve = page.getByRole('button', { name: /Duyệt kế hoạch/ });
    try {
      await expect(approve).toBeVisible({ timeout: 90_000 });
    } catch (err) {
      await page.screenshot({ path: join(runDir, 'no-preview.png'), fullPage: true });
      save('no-preview.json', {
        prompt,
        messages: (await pool.query("SELECT role, content, metadata->>'type' AS type FROM messages WHERE conv_id = $1 AND COALESCE(metadata->>'type', '') <> 'working_memory' ORDER BY created_at", [conversationId])).rows,
      });
      throw err;
    }
    const previewMs = Date.now() - sentAt;
    const planRow = (await pool.query('SELECT id, status, plan_hash, plan_json FROM plans WHERE conv_id = $1', [conversationId])).rows[0];
    expect(planRow?.status).toBe('pending');
    await page.screenshot({ path: join(runDir, 'preview.png'), fullPage: true });
    save('plan.json', { prompt, conversationId, planId: planRow.id, hash: planRow.plan_hash, previewMs, plan: planRow.plan_json });

    const decision = await waitForDecision();
    if (decision !== planRow.plan_hash) {
      await page.getByRole('button', { name: 'Hủy', exact: true }).click();
      await expect.poll(async () => (await pool.query('SELECT status FROM plans WHERE id = $1', [planRow.id])).rows[0]?.status).toBe('rejected');
      save('result.json', { planId: planRow.id, status: 'rejected', reason: decision === null ? 'no decision before the timeout' : 'confirm.txt did not carry this plan\'s hash' });
      throw new Error('Plan was not approved; it was cancelled and nothing was executed');
    }

    await approve.click();
    const terminal = ['completed', 'failed', 'paused', 'stopped'];
    let status = '';
    await expect.poll(async () => {
      status = (await pool.query('SELECT status FROM plans WHERE id = $1', [planRow.id])).rows[0]?.status;
      return terminal.includes(status);
    }, { timeout: 120_000 }).toBe(true);
    const steps = (await pool.query('SELECT step_id, tool, status, output_json, error_json, duration_ms FROM execution_steps WHERE plan_id = $1 ORDER BY step_id', [planRow.id])).rows;
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(runDir, 'executed.png'), fullPage: true });
    save('result.json', { planId: planRow.id, status, steps });

    expect(status).toBe('completed');
    expect(steps.map((step) => step.status)).toEqual(steps.map(() => 'succeeded'));
    expect(steps).toHaveLength(planRow.plan_json.steps.length);
    await expect(page.getByText(`${steps.length}/${steps.length} hoàn thành`)).toBeVisible();
  } finally {
    await pool.end();
  }
});
