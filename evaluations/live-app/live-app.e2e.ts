/**
 * One chat request through the real product path: web UI -> chat-api (live
 * mode) -> real model -> plan preview -> human approval -> executor -> real
 * services, with every state read back from PostgreSQL.
 *
 * The test stops at the preview, saves plan.json and waits for a reviewer to
 * write the plan's hash into confirm.txt in the run directory. Without that
 * file it cancels the plan, so nothing is written to an external service
 * unless a person approved exactly the plan that is on screen.
 * LIVE_APP_CANCEL=1 cancels right after the preview, for a run that must not write.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';

const composer = (page: Page) => page.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });
const composerSend = (page: Page) => page.getByRole('button', { name: /^(Gửi|Gửi tin nhắn|Gửi yêu cầu)$/ });

const email = process.env.CHAT_ADMIN_EMAIL;
const password = process.env.CHAT_ADMIN_PASSWORD;
const connectionString = process.env.DATABASE_URL;
const prompt = process.env.LIVE_APP_PROMPT;
const cancelOnly = process.env.LIVE_APP_CANCEL === '1';
const runDir = resolve(process.env.LIVE_APP_RUN_DIR || join('docs/ai-evidence/V3-LIVE-EXECUTION', `app-${new Date().toISOString().replace(/[:.]/g, '-')}`));
const confirmMinutes = Number(process.env.LIVE_APP_CONFIRM_TIMEOUT_MIN) || 25;
if (!email || !password || !connectionString || !prompt) {
  throw new Error('Live app run requires CHAT_ADMIN_*, DATABASE_URL and LIVE_APP_PROMPT');
}

const save = (name: string, value: unknown) => writeFileSync(join(runDir, name), `${JSON.stringify(value, null, 2)}\n`);
/** The user menu carries the account name; screenshots hide it. */
const shot = (page: Page, name: string) => page.screenshot({ path: join(runDir, name), fullPage: true,
  mask: [page.getByRole('button', { name: /^Menu người dùng/ })] });

/** Resolves to the reviewer's decision: the approved hash, 'cancel', or null on timeout. */
async function waitForDecision(): Promise<string | null> {
  if (cancelOnly) return 'cancel';
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
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(email!);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password!);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(composer(page)).toBeVisible({ timeout: 20_000 });

    await composer(page).fill(prompt!);
    const sentAt = Date.now();
    await composerSend(page).click();
    await page.waitForURL(/\/c\/[^/]+$/, { timeout: 30_000 });
    const conversationId = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1)!);

    const approve = page.getByRole('button', { name: 'Duyệt kế hoạch', exact: true });
    try {
      await expect(approve).toBeVisible({ timeout: 120_000 });
    } catch (err) {
      await shot(page, 'no-preview.png');
      save('no-preview.json', {
        prompt, conversationId, waitedMs: Date.now() - sentAt,
        messages: (await pool.query("SELECT role, content, metadata->>'type' AS type FROM messages WHERE conv_id = $1 AND COALESCE(metadata->>'type', '') <> 'working_memory' ORDER BY created_at", [conversationId])).rows,
      });
      throw err;
    }
    const previewMs = Date.now() - sentAt;
    const planRow = (await pool.query("SELECT id, status, plan_hash, plan_json, resource_labels FROM plans WHERE conv_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1", [conversationId])).rows[0];
    expect(planRow?.status).toBe('pending');
    await shot(page, 'preview.png');
    save('plan.json', { prompt, conversationId, planId: planRow.id, hash: planRow.plan_hash, previewMs,
      resourceLabels: planRow.resource_labels, plan: planRow.plan_json });

    const decision = await waitForDecision();
    if (decision !== planRow.plan_hash) {
      await page.getByRole('button', { name: 'Hủy', exact: true }).click();
      await expect.poll(async () => (await pool.query('SELECT status FROM plans WHERE id = $1', [planRow.id])).rows[0]?.status).toBe('rejected');
      const steps = Number((await pool.query('SELECT count(*) FROM execution_steps WHERE plan_id = $1', [planRow.id])).rows[0].count);
      await shot(page, 'cancelled.png');
      save('result.json', { planId: planRow.id, status: 'rejected', executionSteps: steps,
        reason: cancelOnly ? 'LIVE_APP_CANCEL=1' : decision === null ? 'no decision before the timeout' : 'confirm.txt did not carry this plan\'s hash' });
      expect(steps).toBe(0);
      if (cancelOnly) return;
      throw new Error('Plan was not approved; it was cancelled and nothing was executed');
    }

    await approve.click();
    const running = ['pending', 'approved', 'executing'];
    let status = '';
    await expect.poll(async () => {
      status = (await pool.query('SELECT status FROM plans WHERE id = $1', [planRow.id])).rows[0]?.status;
      return !running.includes(status);
    }, { timeout: 180_000 }).toBe(true);
    const steps = (await pool.query('SELECT step_id, tool, status, output_json, error_json, duration_ms FROM execution_steps WHERE plan_id = $1 ORDER BY step_id', [planRow.id])).rows;
    const receipt = page.getByRole('heading', { name: /^Đã xong \d+ việc trên \d+ công cụ$/ });
    if (status === 'completed') await expect(receipt).toBeVisible({ timeout: 30_000 });
    else await page.waitForTimeout(2000);
    const links = await page.locator('#receipt-chain a[href]').evaluateAll((anchors) => anchors.map((a) => ({ text: a.textContent?.trim(), href: a.getAttribute('href') })));
    await shot(page, 'executed.png');
    save('result.json', { planId: planRow.id, status, steps, receiptLinks: links });

    expect(status).toBe('completed');
    expect(steps.map((step) => step.status)).toEqual(steps.map(() => 'succeeded'));
    expect(steps).toHaveLength(planRow.plan_json.steps.length);
  } finally {
    await pool.end();
  }
});
