import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import {fixtureConversation,fixtureMessage,certifyFixtureSchedule} from './persisted-artifacts.fixture.js';
import { hashPassword } from '../../../chat-api/src/db/repositories/user-repo.js';

const enabled = process.env.SANDBOX_SCENARIO === 'schedule';
const pool = () => new pg.Pool({ connectionString: process.env.DATABASE_URL });
const requestBox = (page: Page) => page.getByRole('textbox', { name: 'Mô tả công việc bạn muốn thực hiện' });
async function login(page: Page, db: pg.Pool) {
  const email = `sched03-${randomUUID()}@example.test`, password = 'Sched03!browser-password';
  const owner = (await db.query("INSERT INTO users(email,password,name,status,email_verified) VALUES($1,$2,'Người thử lịch','active',true) RETURNING id", [email, hashPassword(password)])).rows[0].id;
  const result = await page.request.post('/api/auth/login', { data: { email, password } });
  expect(result.status()).toBe(200); const tokens = await result.json();
  await page.goto('/login');
  await page.evaluate(value => { localStorage.setItem('wap_access_token', value.accessToken); localStorage.setItem('wap_refresh_token', value.refreshToken); localStorage.setItem('wap_user', JSON.stringify(value.user)); }, tokens);
  await page.goto('/');
  await expect(requestBox(page)).toBeVisible();
  return owner as string;
}
async function send(page: Page, value: string) { await requestBox(page).fill(value); await requestBox(page).press('Enter'); await expect(page.locator('[data-moment="schedule"]')).toBeVisible(); }
async function create(page: Page) {
  await send(page, 'Mỗi sáng 8 giờ, gửi lịch họp hôm nay lên Slack #ati-test');
  await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Đang bật' })).toBeVisible();
}
async function shot(page: Page, name: string, info: TestInfo) {
  const folder = resolve('node_modules/.cache/sched03/screenshots'); await mkdir(folder, { recursive: true });
  const path = resolve(folder, `${info.title.replace(/[^a-zA-Z0-9-]/g, '_')}-${name}.png`);
  await page.screenshot({ path, fullPage: true });
  const sha = createHash('sha256').update(await readFile(path)).digest('hex');
  await appendFile(resolve(folder, 'manifest.sha256'), `${sha}  ${path}\n`); console.log(`SCHED-03 screenshot ${sha} ${path}`);
}
async function pendingBadge(page: Page, width: number, count: number) {
  if (width >= 900) await expect(page.getByRole('link', { name: count ? `Nhật ký, ${count} lượt chờ duyệt` : 'Nhật ký', exact: true })).toBeVisible();
  else {
    await page.getByRole('button', { name: /Menu người dùng:/ }).click();
    await expect(page.getByRole('menuitem', { name: count ? `Nhật ký điều phối, ${count} lượt chờ duyệt` : 'Nhật ký điều phối', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
  }
}
for (const width of [1440, 375]) for (const theme of ['light', 'dark'] as const) {
  const label = `${width} ${theme}`;
  test(`SCHED-03: create, edit and confirm a schedule from chat ${label}`, async ({ page }, info) => {
    test.skip(!enabled); const db = pool();
    try {
      await page.setViewportSize({ width, height: 900 }); await login(page, db);
      await page.evaluate(value => { localStorage.setItem('ati-theme', value); document.documentElement.classList.toggle('dark', value === 'dark'); }, theme);
      await send(page, 'Mỗi sáng 8 giờ, gửi lịch họp hôm nay lên Slack #ati-test');
      await expect(page.getByText('Tới giờ, ATI lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào.')).toBeVisible();
      await shot(page, 'proposal-create', info);
      await page.getByRole('button', { name: 'Sửa', exact: true }).click(); await expect(requestBox(page)).toBeFocused();
      await page.getByRole('button', { name: 'Xác nhận', exact: true }).click(); await expect(page.getByText(/^Đang bật/)).toBeVisible();
      await shot(page, 'state', info);
      await send(page, 'Đổi sang 8 giờ 30, chỉ thứ Hai đến thứ Sáu');
      await expect(page.locator('del')).toHaveText('Hằng ngày, 08:00, giờ Việt Nam');
      await expect(page.getByText('Thứ Hai đến thứ Sáu, 08:30, giờ Việt Nam', { exact: true })).toBeVisible(); await shot(page, 'proposal-update', info);
      await page.getByRole('button', { name: 'Xác nhận', exact: true }).click(); await expect(page.getByText(/^Đang bật/)).toBeVisible();
      await page.reload(); await expect(page.getByText('Thứ Hai đến thứ Sáu, 08:30, giờ Việt Nam', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await db.end(); }
  });
  test(`SCHED-03: run now, see the pending count, approve ${label}`, async ({ page }, info) => {
    test.skip(!enabled); const db = pool();
    try {
      await page.setViewportSize({ width, height: 900 }); const owner = await login(page, db);
      await page.evaluate(value => { localStorage.setItem('ati-theme', value); document.documentElement.classList.toggle('dark', value === 'dark'); }, theme);
      await create(page); await page.getByRole('button', { name: 'Chạy lượt này ngay' }).click();
      await expect(page.getByRole('button', { name: 'Duyệt kế hoạch' })).toBeVisible();
      await expect(page.locator('[data-schedule-origin]')).toContainText('Lịch "Lịch họp hằng ngày" tự gửi lúc');
      await expect(page.locator('[data-request-echo]')).toHaveCount(0);
      const plan = (await db.query('SELECT p.id,p.plan_json FROM plans p JOIN conversations c ON c.id=p.conv_id WHERE c.user_id=$1 ORDER BY p.created_at DESC LIMIT 1', [owner])).rows[0];
      expect(plan.plan_json.steps.map((step: any) => step.tool)).toEqual(['calendar.create_event', 'slack.send_message']);
      expect((await db.query('SELECT count(*)::int AS n FROM execution_steps WHERE plan_id=$1', [plan.id])).rows[0].n).toBe(0);
      await pendingBadge(page, width, 1); await shot(page, 'pending', info);
      await page.getByRole('button', { name: 'Duyệt kế hoạch' }).click();
      await expect(page.getByText('Quy trình đã hoàn thành.', { exact: true })).toBeVisible();
      await pendingBadge(page, width, 0);
      expect((await db.query('SELECT status FROM plans WHERE id=$1', [plan.id])).rows[0].status).toBe('completed');
    } finally { await db.end(); }
  });
  test(`SCHED-03: pause, resume and cancel from the history page ${label}`, async ({ page }, info) => {
    test.skip(!enabled); const db = pool();
    try {
      await page.setViewportSize({ width, height: 900 }); await login(page, db);
      await page.evaluate(value => { localStorage.setItem('ati-theme', value); document.documentElement.classList.toggle('dark', value === 'dark'); }, theme);
      await create(page); await page.goto('/history');
      const section = page.getByRole('region', { name: 'Lịch chạy' }); await expect(section).toBeVisible(); await shot(page, 'history', info);
      await section.getByRole('button', { name: 'Tạm dừng', exact: true }).click(); await expect(section.getByText('Đã tạm dừng', { exact: true })).toBeVisible();
      await section.getByRole('button', { name: 'Chạy tiếp', exact: true }).click(); await expect(section.getByText(/^Đang bật/)).toBeVisible();
      await section.getByRole('button', { name: 'Xem 10 lượt gần nhất' }).click(); await expect(section.getByText('Chưa có lượt chạy.')).toBeVisible();
      await section.getByRole('button', { name: 'Hủy lịch', exact: true }).click();
      const dialog = page.getByRole('alertdialog'); await expect(dialog.getByRole('button', { name: 'Giữ lịch' })).toBeFocused();
      await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(section.getByRole('button', { name: 'Hủy lịch', exact: true })).toBeFocused();
      await section.getByRole('button', { name: 'Hủy lịch', exact: true }).click(); await dialog.getByRole('button', { name: 'Xác nhận hủy lịch' }).click();
      await expect(section.getByText('Đã hủy', { exact: true })).toBeVisible(); await expect(section.getByRole('button', { name: 'Chạy tiếp' })).toHaveCount(0);
    } finally { await db.end(); }
  });
  test(`SCHED-03: confirming an older proposal shows the stale message ${label}`, async ({ page }) => {
    test.skip(!enabled); const db = pool();
    try {
      await page.setViewportSize({ width, height: 900 }); const owner = await login(page, db);
      await send(page, 'Mỗi sáng 8 giờ, gửi lịch họp hôm nay lên Slack #ati-test');
      const old = (await db.query("SELECT m.* FROM messages m JOIN conversations c ON c.id=m.conv_id WHERE c.user_id=$1 AND m.metadata->>'type'='schedule_proposal'", [owner])).rows[0];
      const metadata = { ...old.metadata, proposal: { ...old.metadata.proposal, name: 'Đề xuất mới nhất' } };
      const newest=await fixtureMessage(db,old.conv_id,'assistant','Đề xuất mới',metadata);
      await db.query("UPDATE messages SET created_at=now()+interval '1 second' WHERE id=$1",[newest]);
      await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveText('Đề xuất này đã cũ. Hãy xem đề xuất mới nhất.');
      await expect(page.getByRole('heading', { name: 'Đề xuất mới nhất', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Xem hội thoại', exact: true }).click();
      const log = page.getByRole('log', { name: 'Hội thoại' });
      await expect(log).toContainText('Đề xuất mới');
      expect(await log.locator('p').allTextContents()).not.toContain('');
      const visibleMessages = (await db.query("SELECT count(*)::int AS n FROM messages WHERE conv_id=$1 AND (metadata->>'type' IS DISTINCT FROM 'working_memory' OR content<>'')", [old.conv_id])).rows[0].n;
      await expect(log.locator('p')).toHaveCount(visibleMessages);
      await expect(log.locator('time')).toHaveCount(visibleMessages);
      expect((await db.query('SELECT count(*)::int AS n FROM schedules WHERE user_id=$1', [owner])).rows[0].n).toBe(0);
    } finally { await db.end(); }
  });
}
test('SCHED-03: schedule status SSE stays readable in the conversation drawer', async ({ page }) => {
  test.skip(!enabled); const db = pool();
  try {
    await login(page, db); await create(page);
    const openAndCheck = async (text: string) => {
      await page.getByRole('button', { name: 'Xem hội thoại', exact: true }).click();
      const log = page.getByRole('log', { name: 'Hội thoại' });
      await expect(log.locator('p').last()).toContainText(text);
      expect(await log.locator('p').allTextContents()).not.toContain('');
      await page.getByRole('button', { name: 'Đóng Nhật ký hội thoại' }).click();
    };
    await openAndCheck('Đang bật');
    await page.getByRole('button', { name: 'Tạm dừng', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Đã tạm dừng' })).toBeVisible();
    await openAndCheck('Đã tạm dừng');
    await page.getByRole('button', { name: 'Chạy tiếp', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Đang bật' })).toBeVisible();
    await openAndCheck('Đang bật');
    await page.getByRole('button', { name: 'Hủy lịch', exact: true }).click();
    await page.getByRole('button', { name: 'Xác nhận hủy lịch' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Đã hủy' })).toBeVisible();
    await openAndCheck('Đã hủy');
  } finally { await db.end(); }
});

test('SCHED-03: long names and requests fit 375 pixels and ignore remains local', async ({ page }) => {
  test.skip(!enabled); const db = pool();
  try {
    await page.setViewportSize({ width: 375, height: 900 }); const owner = await login(page, db);
    const convId = await fixtureConversation(db,owner);
    const metadata = { type: 'schedule_proposal', proposal: { kind: 'schedule', action: 'create', name: 'a'.repeat(80), request: 'b'.repeat(1000), recurrence: { type: 'daily', time: '08:00' }, summary: 'Lịch dài' }, services: ['calendar', 'slack'], nextRuns: [], previous: null, baseVersion: null, scheduleId: null };
    await fixtureMessage(db,convId,'assistant','Lịch dài',metadata);
    await page.goto(`/c/${convId}`); await expect(page.locator('[data-moment="schedule"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const mutations: string[] = []; page.on('request', request => { if (request.method() !== 'GET' && /schedules|schedule-proposals/.test(request.url())) mutations.push(request.url()); });
    await page.getByRole('button', { name: 'Bỏ qua' }).click(); await expect(page.getByText('Đã bỏ qua đề xuất trong phiên này.')).toBeVisible(); expect(mutations).toEqual([]);
    await page.reload(); await expect(page.getByRole('button', { name: 'Xác nhận', exact: true })).toBeVisible();
  } finally { await db.end(); }
});
test('SCHED-03: stale versions reload before a second action', async ({ page }) => {
  test.skip(!enabled); const db = pool();
  try {
    const owner = await login(page, db); await create(page); await page.goto('/history');
    const section = page.getByRole('region', { name: 'Lịch chạy' }); await expect(section.getByRole('button', { name: 'Tạm dừng', exact: true })).toBeVisible();
    const renamed = await db.query("UPDATE schedules SET version=version+1,name='Phiên bản mới' WHERE user_id=$1 RETURNING id", [owner]);
    for (const row of renamed.rows) await certifyFixtureSchedule(db, row.id);
    await section.getByRole('button', { name: 'Tạm dừng', exact: true }).click();
    await expect(section.getByRole('alert')).toHaveText('Lịch vừa thay đổi ở nơi khác. Đã tải lại.');
    await expect(section.getByRole('heading', { name: 'Phiên bản mới' })).toBeVisible();
    await section.getByRole('button', { name: 'Tạm dừng', exact: true }).click(); await expect(section.getByText('Đã tạm dừng', { exact: true })).toBeVisible();
  } finally { await db.end(); }
});
for (const state of ['expired', 'planning_failed', 'interrupted'] as const) test(`SCHED-03: replan a ${state} run into a fresh conversation`, async ({ page }) => {
  test.skip(!enabled); const db = pool();
  try {
    const owner = await login(page, db); await create(page); await page.getByRole('button', { name: 'Chạy lượt này ngay' }).click();
    await expect(page.getByRole('button', { name: 'Duyệt kế hoạch' })).toBeVisible();
    const run = (await db.query('SELECT r.* FROM schedule_runs r JOIN schedules s ON s.id=r.schedule_id WHERE s.user_id=$1 ORDER BY r.created_at DESC LIMIT 1', [owner])).rows[0];
    if (state === 'expired') await db.query("UPDATE plans SET expires_at=now()-interval '1 minute' WHERE id=$1", [run.plan_id]);
    else {
      await db.query('UPDATE schedule_runs SET status=$2,plan_id=null WHERE id=$1', [run.id, state]);
      await db.query("UPDATE plans SET status='failed' WHERE id=$1", [run.plan_id]);
      const first = (await db.query("SELECT id FROM messages WHERE conv_id=$1 AND metadata->>'type'='schedule_run'", [run.conv_id])).rows[0].id;
      await fixtureMessage(db,run.conv_id,'system','Không lập được kế hoạch',{type:'planning_error',replyToMessageId:first});
    }
    await page.reload(); await expect(page.getByRole('button', { name: 'Lập lại kế hoạch', exact: true })).toBeVisible();
    if (state !== 'expired') { await expect(page.locator('[data-schedule-origin]')).toBeVisible(); await expect(page.getByText('Câu yêu cầu của bạn:')).toHaveCount(0); }
    await page.getByRole('button', { name: 'Lập lại kế hoạch', exact: true }).click();
    await expect(page).not.toHaveURL(new RegExp(run.conv_id)); await expect(page.getByRole('button', { name: 'Duyệt kế hoạch' })).toBeVisible();
    const replanned = (await db.query("SELECT r.* FROM schedule_runs r WHERE schedule_id=$1 AND trigger='replan'", [run.schedule_id])).rows[0];
    expect(replanned.conv_id).not.toBe(run.conv_id); expect(replanned.plan_id).not.toBe(run.plan_id);
    expect((await db.query('SELECT count(*)::int AS n FROM execution_steps WHERE plan_id=$1', [replanned.plan_id])).rows[0].n).toBe(0);
  } finally { await db.end(); }
});
test('SCHED-03 off: no schedule requests or history section', async ({ page }) => {
  test.skip(enabled); const db = pool();
  try {
    const calls: string[] = []; page.on('request', request => { if (/\/api\/(schedules|schedule-runs)/.test(request.url())) calls.push(request.url()); });
    await login(page, db); await expect(page.locator('[data-schedule-count]')).toHaveCount(0);
    await page.goto('/history'); await expect(page.getByRole('heading', { name: /Nhật ký điều phối &/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Lịch chạy', exact: true })).toHaveCount(0); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    expect(calls).toEqual([]);
  } finally { await db.end(); }
});
