import { test, expect } from '@playwright/test';
import pg from 'pg';

/** The send button of the main chat composer; a clarification card has its own "Gửi" button. */
const composerSend = (page: import('@playwright/test').Page) => page.locator('form')
  .filter({ has: page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...') })
  .getByRole('button', { name: 'Gửi', exact: true });

const email = process.env.CHAT_ADMIN_EMAIL;
const password = process.env.CHAT_ADMIN_PASSWORD;
const connectionString = process.env.DATABASE_URL;
if (!email || !password || !connectionString) throw new Error('Browser E2E requires provisioned CHAT_ADMIN_* and DATABASE_URL');

async function login(page: import('@playwright/test').Page) {
  await page.goto('/');
  const landingLoginBtn = page.getByRole('button', { name: 'Đăng nhập vào hệ thống' });
  if (await landingLoginBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await landingLoginBtn.click();
  }
  await page.getByRole('textbox', { name: 'Email' }).fill(email!);
  await page.getByLabel('Mật khẩu').fill(password!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'AI Workflow Platform' })).toBeVisible();
}

test('real browser and PostgreSQL: login, chat, approval and execution', async ({ page }, testInfo) => {
  const pool = new pg.Pool({ connectionString });
  try {
    await login(page);
    const prompt = `Tạo task sửa giao diện cho Minh trên Trello và thông báo Slack E2E ${Date.now()}`;
    const created = page.waitForResponse((response) => response.url().endsWith('/api/conversations') && response.request().method() === 'POST');
    await page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...').fill(prompt);
    await composerSend(page).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const body = await response.json();
    const conversationId = body.conversation?.id || body.id;
    expect(conversationId).toBeTruthy();
    await expect(page.getByRole('button', { name: /Duyệt kế hoạch/ })).toBeVisible();
    const plan = await pool.query('SELECT id, status FROM plans WHERE conv_id = $1', [conversationId]);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].status).toBe('pending');

    await page.getByRole('button', { name: /Duyệt kế hoạch/ }).click();
    await expect.poll(async () => {
      const result = await pool.query('SELECT status FROM plans WHERE id = $1', [plan.rows[0].id]);
      return result.rows[0]?.status;
    }).toBe('completed');
    const steps = await pool.query('SELECT tool, status FROM execution_steps WHERE plan_id = $1 ORDER BY step_id', [plan.rows[0].id]);
    expect(steps.rows.map((row) => row.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    await expect(page.getByText('3/3 hoàn thành')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('approved-plan.png'), fullPage: true });
  } finally {
    await pool.end();
  }
});

test('real browser and PostgreSQL: cancel a pending plan', async ({ page }) => {
  const pool = new pg.Pool({ connectionString });
  try {
    await login(page);
    const prompt = `Tạo task Trello và báo Slack E2E cancel ${Date.now()}`;
    await page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...').fill(prompt);
    await composerSend(page).click();
    await expect(page.getByRole('button', { name: /Duyệt kế hoạch/ })).toBeVisible();
    const planId = (await pool.query('SELECT p.id FROM plans p JOIN messages m ON p.conv_id = m.conv_id WHERE m.content = $1', [prompt])).rows[0]?.id;
    expect(planId).toBeTruthy();
    await page.getByRole('button', { name: 'Hủy', exact: true }).click();
    await expect.poll(async () => (await pool.query('SELECT status FROM plans WHERE id = $1', [planId])).rows[0]?.status).toBe('rejected');
    await expect(page.getByRole('button', { name: /Duyệt kế hoạch/ })).toHaveCount(0);
  } finally {
    await pool.end();
  }
});

test('real browser and PostgreSQL: clarification before plan', async ({ page }) => {
  test.skip(process.env.SANDBOX_SCENARIO !== 'clarification', 'requires the explicit clarification sandbox scenario');
  const pool = new pg.Pool({ connectionString });
  try {
    await login(page);
    const prompt = `Tạo task trên board Frontend, gán Minh và thông báo Slack E2E ambiguous ${Date.now()}`;
    await page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...').fill(prompt);
    await composerSend(page).click();
    await expect(page.getByText('Which member do you mean?')).toBeVisible();
    const clarification = await pool.query("SELECT m.id FROM messages m WHERE m.content = $1 AND m.metadata->>'type' = 'clarification' AND m.conv_id IN (SELECT conv_id FROM messages WHERE content = $2)", ['Which member do you mean?', prompt]);
    expect(clarification.rowCount).toBeGreaterThan(0);
    await page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...').fill('Minh Nguyễn');
    await composerSend(page).click();
    await expect(page.getByRole('button', { name: /Duyệt kế hoạch/ })).toBeVisible();
    await page.getByRole('button', { name: 'Hủy', exact: true }).click();
  } finally {
    await pool.end();
  }
});

test('real browser and PostgreSQL: partial failure and skip', async ({ page }) => {
  test.skip(process.env.SANDBOX_SCENARIO !== 'partial_failure', 'requires the explicit failure sandbox scenario');
  const pool = new pg.Pool({ connectionString });
  try {
    await login(page);
    const prompt = `Tạo task Trello rồi báo Slack E2E partial failure ${Date.now()}`;
    await page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...').fill(prompt);
    await composerSend(page).click();
    await expect(page.getByRole('button', { name: /Duyệt kế hoạch/ })).toBeVisible();
    const planId = (await pool.query('SELECT p.id FROM plans p JOIN messages m ON p.conv_id = m.conv_id WHERE m.content = $1', [prompt])).rows[0]?.id;
    expect(planId).toBeTruthy();
    await page.getByRole('button', { name: /Duyệt kế hoạch/ }).click();
    await expect(page.getByText(/Tạm dừng quy trình tại bước: step_3/)).toBeVisible();
    await expect.poll(async () => (await pool.query('SELECT status FROM execution_steps WHERE plan_id = $1 AND step_id = $2', [planId, 'step_3'])).rows[0]?.status).toBe('failed');
    await page.getByRole('button', { name: /Bỏ qua bước này/ }).click();
    await expect.poll(async () => (await pool.query('SELECT status FROM execution_steps WHERE plan_id = $1 AND step_id = $2', [planId, 'step_3'])).rows[0]?.status).toBe('skipped');
    await expect.poll(async () => (await pool.query('SELECT status FROM plans WHERE id = $1', [planId])).rows[0]?.status).toBe('completed');
    await expect(page.getByText(/Tạm dừng quy trình tại bước: step_3/)).toHaveCount(0);
  } finally {
    await pool.end();
  }
});

test('real browser and PostgreSQL: approved three-service workflow resolves prior outputs', async ({ page }, testInfo) => {
  test.skip(process.env.SANDBOX_SCENARIO !== 'three_service', 'requires the explicit three-service sandbox scenario');
  const pool = new pg.Pool({ connectionString });
  try {
    await login(page);
    const prompt = `Tạo issue GitHub, thẻ Trello và thông báo Slack E2E ${Date.now()}`;
    await page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...').fill(prompt);
    await composerSend(page).click();
    await expect(page.getByRole('button', { name: /Duyệt kế hoạch/ })).toBeVisible();
    const planId = (await pool.query('SELECT p.id FROM plans p JOIN messages m ON p.conv_id = m.conv_id WHERE m.content = $1', [prompt])).rows[0]?.id;
    expect(planId).toBeTruthy();
    const preview = await pool.query('SELECT plan_json FROM plans WHERE id = $1', [planId]);
    const plannedTools = preview.rows[0]?.plan_json?.steps?.map((step: { tool: string }) => step.tool);
    expect(plannedTools).toEqual(['github.create_issue', 'trello.create_card', 'slack.send_message']);
    await page.getByRole('button', { name: /Duyệt kế hoạch/ }).click();
    await expect.poll(async () => (await pool.query('SELECT status FROM plans WHERE id = $1', [planId])).rows[0]?.status).toBe('completed');
    const steps = (await pool.query('SELECT step_id, tool, status, output_json FROM execution_steps WHERE plan_id = $1 ORDER BY step_id', [planId])).rows;
    expect(steps.map((step) => step.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    const issueUrl = steps[0]?.output_json?.url;
    const cardUrl = steps[1]?.output_json?.url;
    expect(issueUrl).toMatch(/^https:\/\/github\.com\/owner\/repo\/issues\//);
    expect(cardUrl).toMatch(/^https:\/\/trello\.com\/c\//);
    expect(steps[1]?.output_json?.desc).toContain(issueUrl);
    expect(steps[2]?.output_json?.text).toContain(issueUrl);
    expect(steps[2]?.output_json?.text).toContain(cardUrl);
    await expect(page.getByText('3/3 hoàn thành')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('three-service-approved.png'), fullPage: true });
  } finally {
    await pool.end();
  }
});
