import { test, expect } from '@playwright/test';
import pg from 'pg';
import { createHash } from 'node:crypto';

/** The send button of the main chat composer; a clarification card has its own "Gửi" button. */
const composerSend = (page: import('@playwright/test').Page) => page.locator('form')
  .filter({ has: page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...') })
  .getByRole('button', { name: 'Gửi', exact: true });

const email = process.env.CHAT_ADMIN_EMAIL;
const password = process.env.CHAT_ADMIN_PASSWORD;
const connectionString = process.env.DATABASE_URL;
if (!email || !password || !connectionString) throw new Error('Browser E2E requires provisioned CHAT_ADMIN_* and DATABASE_URL');

test('real browser and PostgreSQL: login, chat, approval and execution recovery after reload', async ({ page }, testInfo) => {
  const pool = new pg.Pool({ connectionString });
  try {
    await login(page);
    const owner = (await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;
    const convId = (await pool.query('INSERT INTO conversations (user_id) VALUES ($1) RETURNING id', [owner])).rows[0].id;
    const title = `Đối soát E2E ${Date.now()}`;
    await pool.query("INSERT INTO messages (conv_id, role, content) VALUES ($1, 'user', $2)", [convId, title]);
    const plan = { kind: 'plan', summary: 'Khôi phục sau restart', steps: [
      { id: 'step_1', tool: 'trello.create_card', description: 'Tạo thẻ trước restart', args: { listId: 'list_1', title: 'Task đã tạo' }, dependsOn: [] },
      { id: 'step_2', tool: 'trello.add_member', description: 'Gán Minh vào thẻ đã tạo', args: { cardId: { $ref: 'step_1.output.id' }, memberId: 'minh' }, dependsOn: ['step_1'] },
      { id: 'step_3', tool: 'slack.send_message', description: 'Thông báo sau đối soát', args: { channel: '#general', text: { $template: 'Task đã đối soát: ${step_1.output.url}' } }, dependsOn: ['step_1'] },
    ], warnings: [] };
    const text = JSON.stringify(plan);
    const planId = (await pool.query(`INSERT INTO plans (conv_id, plan_json, plan_text, plan_hash, status, expires_at, decided_at)
      VALUES ($1, $2::jsonb, $3::text, $4, 'reconciliation_required', now() + interval '30 minutes', now()) RETURNING id`,
      [convId, text, text, createHash('sha256').update(text).digest('hex')])).rows[0].id;
    for (const [index, step] of plan.steps.entries()) {
      await pool.query(`INSERT INTO execution_steps (plan_id, step_id, tool, args_json, status, output_json, requested_by, started_at, completed_at, duration_ms)
        VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, CASE WHEN $8 THEN now() ELSE NULL END, CASE WHEN $8 THEN now() ELSE NULL END, CASE WHEN $8 THEN 250 ELSE NULL END)`,
        [planId, step.id, step.tool, JSON.stringify(step.args), ['succeeded', 'unknown', 'pending'][index],
          index === 0 ? JSON.stringify({ id: 'saved-browser-card', url: 'https://trello.com/c/saved-browser' }) : null, owner, index < 2]);
    }
    const before = (await pool.query('SELECT * FROM execution_steps WHERE plan_id = $1 AND step_id = $2', [planId, 'step_1'])).rows[0];
    const writes: string[] = [];
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes(`/api/executions/${planId}`)) writes.push(new URL(request.url()).pathname); });
    // PostgreSQL conversations currently have no title field; select the newest row
    // after verifying the real list endpoint returned the seeded conversation first.
    const listed = page.waitForResponse(response => response.url().endsWith('/api/conversations') && response.request().method() === 'GET');
    await page.reload();
    expect((await (await listed).json()).conversations[0].id).toBe(convId);
    await page.getByRole('button', { name: /^Hội thoại mới/ }).first().click();
    const notice = page.getByRole('region', { name: 'Cần đối soát trước khi tiếp tục' });
    await expect(notice).toBeVisible();
    await expect(notice.getByText('trello.add_member')).toBeVisible();
    await expect(notice.getByText(/saved-browser-card/)).toBeVisible();
    await expect(page.getByRole('button', { name: /thử lại|retry|Duyệt kế hoạch/i })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('reconciliation-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await notice.scrollIntoViewIfNeeded();
    await expect(notice.getByRole('button', { name: 'Dừng plan' })).toBeVisible();
    await notice.screenshot({ path: testInfo.outputPath('reconciliation-mobile.png') });
    await notice.getByRole('button', { name: 'Skip step này rồi chạy tiếp' }).click();
    await expect(page.getByText('Quy trình đã hoàn thành.')).toBeVisible();
    await expect(notice).toHaveCount(0);
    expect((await pool.query('SELECT status FROM plans WHERE id = $1', [planId])).rows[0].status).toBe('completed');
    const rows = (await pool.query('SELECT * FROM execution_steps WHERE plan_id = $1 ORDER BY step_id', [planId])).rows;
    expect(rows.map(row => row.status)).toEqual(['succeeded', 'skipped', 'succeeded']);
    expect(rows[0]).toEqual(before);
    expect(rows[2].output_json.text).toContain('https://trello.com/c/saved-browser');
    expect(writes).toEqual([`/api/executions/${planId}/steps/step_2/skip`]);
  } finally { await pool.end(); }
});

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

test('real browser and PostgreSQL: login, chat, approval and execution Continue safe pending after reload', async ({ page }, testInfo) => {
  const pool = new pg.Pool({ connectionString });
  try {
    await login(page);
    const owner = (await pool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id;
    const convId = (await pool.query('INSERT INTO conversations (user_id) VALUES ($1) RETURNING id', [owner])).rows[0].id;
    await pool.query("INSERT INTO messages (conv_id, role, content) VALUES ($1, 'user', $2)", [convId, `Continue E2E ${Date.now()}`]);
    const plan = { kind: 'plan', summary: 'Chạy tiếp sau restart', steps: [
      { id: 'step_1', tool: 'trello.create_card', description: 'Thẻ đã tạo', args: { listId: 'list_1', title: 'Saved task' }, dependsOn: [] },
      { id: 'step_2', tool: 'slack.send_message', description: 'Thông báo chưa gửi', args: { channel: '#general', text: { $template: 'Saved ${step_1.output.url}' } }, dependsOn: ['step_1'] },
      { id: 'step_3', tool: 'slack.send_message', description: 'Thông báo tiếp theo', args: { channel: '#general', text: 'Done' }, dependsOn: ['step_2'] },
    ], warnings: [] };
    const text = JSON.stringify(plan);
    const planId = (await pool.query(`INSERT INTO plans (conv_id, plan_json, plan_text, plan_hash, status, expires_at, decided_at)
      VALUES ($1, $2::jsonb, $3, $4, 'reconciliation_required', now() + interval '30 minutes', now()) RETURNING id`,
      [convId, text, text, createHash('sha256').update(text).digest('hex')])).rows[0].id;
    for (const [index, step] of plan.steps.entries()) await pool.query(`INSERT INTO execution_steps (plan_id, step_id, tool, args_json, status, output_json, requested_by)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7)`,
      [planId, step.id, step.tool, JSON.stringify(step.args), index === 0 ? 'succeeded' : 'pending',
        index === 0 ? JSON.stringify({ id: 'saved-continue-card', url: 'https://trello.com/c/saved-continue' }) : null, owner]);
    const before = (await pool.query("SELECT * FROM execution_steps WHERE plan_id = $1 AND step_id = 'step_1'", [planId])).rows[0];
    const writes: string[] = [];
    page.on('request', req => { if (req.method() === 'POST' && req.url().includes('/api/executions/')) writes.push(new URL(req.url()).pathname); });
    await page.reload();
    await page.getByRole('button', { name: /^Hội thoại mới/ }).first().click();
    const notice = page.getByRole('region', { name: 'Cần đối soát trước khi tiếp tục' });
    await expect(notice.getByText(/chưa từng được gửi/)).toBeVisible();
    await expect(notice.getByRole('button', { name: /Skip/ })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('continue-pending.png'), fullPage: true });
    await notice.getByRole('button', { name: 'Chạy tiếp các bước còn lại' }).click();
    await expect(page.getByText('Quy trình đã hoàn thành.')).toBeVisible();
    await expect.poll(async () => (await pool.query('SELECT status FROM plans WHERE id = $1', [planId])).rows[0].status).toBe('completed');
    const rows = (await pool.query('SELECT * FROM execution_steps WHERE plan_id = $1 ORDER BY step_id', [planId])).rows;
    expect(rows.map(row => row.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    expect(rows[0]).toEqual(before);
    expect(rows[1].output_json.text).toBe('Saved https://trello.com/c/saved-continue');
    expect(writes).toEqual([`/api/executions/${planId}/continue`]);
    await page.screenshot({ path: testInfo.outputPath('continue-completed.png'), fullPage: true });
  } finally { await pool.end(); }
});

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

test('real browser and PostgreSQL: edit a pending plan through chat', async ({ page }, testInfo) => {
  const pool = new pg.Pool({ connectionString });
  try {
    await login(page);
    const prompt = `Tạo task Trello và báo Slack E2E edit ${Date.now()}`;
    const composer = page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...');
    await composer.fill(prompt);
    await composerSend(page).click();
    const approve = page.getByRole('button', { name: /Duyệt kế hoạch/ });
    await expect(approve).toBeVisible();
    // The whole preview, approve button included, must be reachable above the composer.
    await approve.scrollIntoViewIfNeeded();
    const approveBox = (await approve.boundingBox())!;
    const composerBox = (await composer.boundingBox())!;
    expect(approveBox.y + approveBox.height).toBeLessThanOrEqual(composerBox.y);
    await page.screenshot({ path: testInfo.outputPath('plan-preview.png') });
    const convId = (await pool.query('SELECT conv_id FROM messages WHERE content = $1', [prompt])).rows[0]?.conv_id;
    const first = (await pool.query("SELECT id FROM plans WHERE conv_id = $1 AND status = 'pending'", [convId])).rows[0]?.id;
    expect(first).toBeTruthy();

    await page.getByRole('button', { name: 'Sửa qua Chat' }).click();
    await expect(composer).toHaveValue(/^Điều chỉnh kế hoạch: /);
    await composer.pressSequentially('đổi tiêu đề thành Sửa CSS trang chủ');
    await composerSend(page).click();

    await expect.poll(async () => (await pool.query('SELECT status FROM plans WHERE id = $1', [first])).rows[0]?.status).toBe('superseded');
    const plans = (await pool.query("SELECT id, status FROM plans WHERE conv_id = $1 ORDER BY created_at", [convId])).rows;
    expect(plans.map((p) => p.status)).toEqual(['superseded', 'pending']);
    const saved = await pool.query("SELECT count(*)::int AS n FROM messages WHERE conv_id = $1 AND metadata->>'type' = 'plan'", [convId]);
    expect(saved.rows[0].n).toBe(2);
    await expect(approve).toBeVisible();
    await page.getByRole('button', { name: 'Hủy', exact: true }).click();
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

for (const action of ['skip', 'stop'] as const) test(`real browser and PostgreSQL: partial failure and skip — ${action}`, async ({ page }, testInfo) => {
  test.skip(process.env.SANDBOX_SCENARIO !== 'partial_failure', 'requires the explicit failure sandbox scenario');
  const pool = new pg.Pool({ connectionString });
  try {
    await login(page);
    const disabledSample = page.getByRole('button', { name: /Cần kết nối/ }).first();
    await expect(disabledSample).toBeDisabled();
    expect(await disabledSample.evaluate(element => Number(getComputedStyle(element).opacity))).toBeLessThan(1);
    const prompt = `Tạo task Trello rồi báo Slack E2E partial failure ${Date.now()}`;
    await page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...').fill(prompt);
    await composerSend(page).click();
    await expect(page.getByRole('button', { name: /Duyệt kế hoạch/ })).toBeVisible();
    const planId = (await pool.query('SELECT p.id FROM plans p JOIN messages m ON p.conv_id = m.conv_id WHERE m.content = $1', [prompt])).rows[0]?.id;
    expect(planId).toBeTruthy();
    await page.getByRole('button', { name: /Duyệt kế hoạch/ }).click();
    await expect(page.getByText(/Tạm dừng quy trình tại bước: step_3/)).toBeVisible();
    await expect.poll(async () => (await pool.query('SELECT status FROM execution_steps WHERE plan_id = $1 AND step_id = $2', [planId, 'step_3'])).rows[0]?.status).toBe('failed');
    await expect(page.getByText('Chế độ thử nghiệm: kế hoạch mẫu, không gọi dịch vụ thật')).toBeVisible();
    const writes: string[] = [];
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes(`/api/executions/${planId}`)) writes.push(new URL(request.url()).pathname); });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect((await pool.query('SELECT status FROM plans WHERE id=$1',[planId])).rows[0].status).toBe('partial');
    expect(writes).toEqual([]);
    await page.screenshot({path:testInfo.outputPath('paused-dismissed-desktop.png'),fullPage:true});
    await page.getByRole('button',{name:'Mở lại xử lý lỗi'}).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    if(action === 'stop') {
      await page.getByRole('button',{name:/Dừng lại toàn bộ/}).click();
      await expect(page.getByText(/Không thể chạy tiếp sau khi dừng/)).toBeVisible();
      expect(writes).toEqual([]);
      expect((await pool.query('SELECT status FROM plans WHERE id=$1',[planId])).rows[0].status).toBe('partial');
      await page.getByRole('button',{name:'Dừng hẳn quy trình'}).click();
      await expect.poll(async()=> (await pool.query('SELECT status FROM plans WHERE id=$1',[planId])).rows[0].status).toBe('stopped');
      expect(writes).toEqual([`/api/executions/${planId}/stop`]);
      return;
    }
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('alertdialog').screenshot({path:testInfo.outputPath('paused-reopened-mobile.png')});
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

test('real browser and PostgreSQL: approved Sheets workflow carries updatedRange to Slack', async ({ page }, testInfo) => {
  test.skip(process.env.SANDBOX_SCENARIO !== 'sheets_slack', 'requires Sheets sandbox scenario');
  const pool = new pg.Pool({ connectionString });
  try {
    await login(page);
    const prompt = `Đọc Google Sheets, thêm dòng và báo Slack E2E ${Date.now()}`;
    await page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...').fill(prompt);
    await composerSend(page).click();
    await expect(page.getByRole('button', { name: /Duyệt kế hoạch/ })).toBeVisible();
    const planId = (await pool.query('SELECT p.id FROM plans p JOIN messages m ON p.conv_id = m.conv_id WHERE m.content = $1', [prompt])).rows[0]?.id;
    expect(planId).toBeTruthy();
    const preview = (await pool.query('SELECT plan_json FROM plans WHERE id = $1', [planId])).rows[0].plan_json;
    expect(preview.steps.map((step: any) => step.tool)).toEqual(['sheets.read_range', 'sheets.append_rows', 'slack.send_message']);
    await page.getByRole('button', { name: /Duyệt kế hoạch/ }).click();
    await expect.poll(async () => (await pool.query('SELECT status FROM plans WHERE id = $1', [planId])).rows[0]?.status).toBe('completed');
    const steps = (await pool.query('SELECT step_id, tool, status, output_json FROM execution_steps WHERE plan_id = $1 ORDER BY step_id', [planId])).rows;
    expect(steps.map(step => step.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    expect(steps[0].output_json.values).toEqual([['Task', 'Status'], ['Sandbox task', 'To Do']]);
    expect(steps[1].output_json.updatedRange).toBe('Tasks!A4:A4');
    expect(steps[2].output_json.text).toContain(steps[1].output_json.updatedRange);
    await expect(page.getByText('3/3 hoàn thành')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('sheets-slack-approved.png'), fullPage: true });
  } finally { await pool.end(); }
});

test('real browser and PostgreSQL: approved Calendar workflow carries event url and start to Slack', async ({ page }, testInfo) => {
  test.skip(process.env.SANDBOX_SCENARIO !== 'calendar_slack', 'requires Calendar sandbox scenario');
  const pool = new pg.Pool({ connectionString });
  try {
    await login(page);
    const prompt = `Đặt lịch họp Google Calendar và báo Slack E2E ${Date.now()}`;
    await page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...').fill(prompt);
    await composerSend(page).click();
    await expect(page.getByRole('button', { name: /Duyệt kế hoạch/ })).toBeVisible();
    const planId = (await pool.query('SELECT p.id FROM plans p JOIN messages m ON p.conv_id = m.conv_id WHERE m.content = $1', [prompt])).rows[0]?.id;
    expect(planId).toBeTruthy();
    const preview = (await pool.query('SELECT plan_json FROM plans WHERE id = $1', [planId])).rows[0].plan_json;
    expect(preview.steps.map((step: any) => step.tool)).toEqual(['calendar.create_event', 'slack.send_message']);
    await page.getByRole('button', { name: /Duyệt kế hoạch/ }).click();
    await expect.poll(async () => (await pool.query('SELECT status FROM plans WHERE id = $1', [planId])).rows[0]?.status).toBe('completed');
    const steps = (await pool.query('SELECT step_id, tool, status, output_json FROM execution_steps WHERE plan_id = $1 ORDER BY step_id', [planId])).rows;
    expect(steps.map(step => step.status)).toEqual(['succeeded', 'succeeded']);
    expect(steps[0].output_json.url).toMatch(/^https:\/\/www\.google\.com\/calendar\/event\?/);
    expect(steps[0].output_json.start).toBe(preview.steps[0].args.start);
    expect(steps[1].output_json.text).toContain(steps[0].output_json.url);
    expect(steps[1].output_json.text).toContain(steps[0].output_json.start);
    await expect(page.getByText('2/2 hoàn thành')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('calendar-slack-approved.png'), fullPage: true });
  } finally { await pool.end(); }
});
test('real browser and PostgreSQL: approved Notion workflow carries page url to Slack', async ({ page }, testInfo) => {
  test.skip(process.env.SANDBOX_SCENARIO !== 'notion_slack', 'requires Notion sandbox scenario');
  const pool = new pg.Pool({ connectionString });
  try {
    await login(page);
    const prompt = `Tạo page Notion biên bản và báo Slack E2E ${Date.now()}`;
    await page.getByPlaceholder('Mô tả công việc bạn muốn thực hiện...').fill(prompt);
    await composerSend(page).click();
    await expect(page.getByRole('button', { name: /Duyệt kế hoạch/ })).toBeVisible();
    const planId = (await pool.query('SELECT p.id FROM plans p JOIN messages m ON p.conv_id = m.conv_id WHERE m.content = $1', [prompt])).rows[0]?.id;
    expect(planId).toBeTruthy();
    const preview = (await pool.query('SELECT plan_json FROM plans WHERE id = $1', [planId])).rows[0].plan_json;
    expect(preview.steps.map((step: any) => step.tool)).toEqual(['notion.create_page', 'slack.send_message']);
    await page.getByRole('button', { name: /Duyệt kế hoạch/ }).click();
    await expect.poll(async () => (await pool.query('SELECT status FROM plans WHERE id = $1', [planId])).rows[0]?.status).toBe('completed');
    const steps = (await pool.query('SELECT step_id, tool, status, output_json FROM execution_steps WHERE plan_id = $1 ORDER BY step_id', [planId])).rows;
    expect(steps.map(step => step.status)).toEqual(['succeeded', 'succeeded']);
    expect(steps[0].output_json.url).toBe('https://www.notion.so/22222222333344445555666666666666');
    expect(steps[1].output_json.text).toContain(steps[0].output_json.url);
    await expect(page.getByText('2/2 hoàn thành')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('notion-slack-approved.png'), fullPage: true });
  } finally { await pool.end(); }
});
