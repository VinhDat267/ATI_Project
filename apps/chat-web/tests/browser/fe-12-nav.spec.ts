import { test, expect, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import {fixtureConversation,fixtureMessage} from './persisted-artifacts.fixture.js';
import { hashPassword } from '../../../chat-api/src/db/repositories/user-repo.js';

const TABS = [
  ['Không gian làm việc', /\/$/],
  ['Nhật ký', /\/history$/],
  ['Kết nối dịch vụ', /\/settings$/],
  ['Cẩm nang', /\/guide$/],
  ['Người dùng', /\/admin\/users$/],
] as const;
const PAGES = [
  { path: '/', current: 'Không gian làm việc' },
  { path: '/history', current: 'Nhật ký' },
  { path: '/settings', current: 'Kết nối dịch vụ' },
  { path: '/account', current: null },
  { path: '/admin/users', current: 'Người dùng' },
  { path: '/guide', current: 'Cẩm nang' },
  { path: '/privacy', current: null },
] as const;
const memberPassword = 'Fe12Browser!password';

async function session(page: Page, email: string, password: string) {
  const response = await page.request.post('/api/auth/login', { data: { email, password } });
  expect(response.status()).toBe(200);
  const tokens = await response.json();
  await page.goto('/login');
  await page.evaluate(value => {
    localStorage.setItem('wap_access_token', value.accessToken); localStorage.setItem('wap_refresh_token', value.refreshToken); localStorage.setItem('wap_user', JSON.stringify(value.user));
  }, tokens);
  return tokens.user as { id: string };
}
const admin = (page: Page) => session(page, process.env.CHAT_ADMIN_EMAIL!, process.env.CHAT_ADMIN_PASSWORD!);
async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate(value => {
    localStorage.setItem('ati-theme', value);
    document.documentElement.classList.toggle('dark', value === 'dark');
    document.documentElement.dataset.theme = value;
  }, theme);
}
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Điều hướng chính' });
async function currentTab(page: Page) {
  return mainNav(page).locator('a[aria-current="page"]').evaluateAll(links => links.map(link => link.getAttribute('aria-label')));
}
// A conversation waiting for approval with a two-digit message count: the widest cockpit bar.
async function seedPlanWithManyMessages(db: pg.Pool, userId: string, request: string) {
  const id = await fixtureConversation(db,userId,'FE12 nav');
  for (let index = 0; index < 11; index++) {
    const message=await fixtureMessage(db,id,index%2?'assistant':'user',`FE12 lượt ${index}`);
    await db.query('UPDATE messages SET created_at=now()-make_interval(secs => $2) WHERE id=$1',[message,60-index]);
  }
  await fixtureMessage(db,id,'user',request);
  const plan = { kind: 'plan', summary: 'FE12 kế hoạch chờ duyệt', steps: [{ id: 'step_1', tool: 'slack.send_message', description: 'Báo Slack', args: { channel: '#ati-test', text: 'FE12' } }], warnings: [] };
  const text = JSON.stringify(plan);
  await db.query("INSERT INTO plans(conv_id,plan_json,plan_text,plan_hash,status,expires_at) VALUES($1,$2::jsonb,$3,$4,'pending',now()+interval '30 minutes')", [id, text, text, createHash('sha256').update(text).digest('hex')]);
  return id as string;
}
type Box = { left: number; right: number; top: number; bottom: number };
async function barLayout(page: Page) {
  return page.locator('[data-main-nav]').evaluate(bar => {
    const box = (element: Element | null): Box | null => {
      if (!element || !(element as HTMLElement).getClientRects().length) return null;
      const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const [left, nav, right] = [bar.children[0], bar.querySelector('nav'), bar.children[bar.children.length - 1]];
    return { bar: box(bar)!, left: box(left), nav: box(nav), right: box(right), scroll: document.documentElement.scrollWidth, viewport: window.innerWidth };
  });
}
const apart = (a: Box, b: Box) => a.right <= b.left || b.right <= a.left;

test('FE-12: an admin reaches every tab from every page and the current tab is marked', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await admin(page);
  for (const entry of PAGES) {
    for (const [name, url] of TABS) {
      await page.goto(entry.path);
      await expect(mainNav(page)).toBeVisible();
      expect(await currentTab(page), `${entry.path} current tab`).toEqual(entry.current ? [entry.current] : []);
      await mainNav(page).getByRole('link', { name, exact: true }).click();
      await expect(page, `${entry.path} → ${name}`).toHaveURL(url);
      await expect.poll(() => currentTab(page), { message: `${entry.path} → ${name} marked` }).toEqual([name]);
    }
  }
});

test('FE-12: the bar fits without overlap, centres its tabs and never scrolls sideways, light and dark', async ({ page }, info) => {
  test.setTimeout(480_000);
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const hashes: string[] = [];
  try {
    const user = await admin(page);
    const request = `FE12 tạo issue GitHub rồi báo Slack #ati-test ${randomUUID().slice(0, 8)}`;
    const conversation = await seedPlanWithManyMessages(db, user.id, request);
    const pages = [{ path: `/c/${conversation}`, scope: 'cockpit-plan' }, ...PAGES.filter(entry => entry.path !== '/').map(entry => ({ path: entry.path, scope: entry.path.slice(1).replace('/', '-') }))];
    // Tabs start at 900 px. Review #162 measured them 51 px off centre at 768 px when they started there.
    for (const width of [1440, 1280, 1024, 900, 899, 768, 375]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark'] as const) {
        for (const entry of pages) {
          await page.goto(entry.path); await setTheme(page, theme);
          await expect(page.locator('[data-main-nav]')).toBeVisible();
          if (entry.scope === 'cockpit-plan') {
            await expect(page.getByRole('button', { name: 'Duyệt kế hoạch', exact: true })).toBeVisible();
            await expect(page.locator('#chat-count-badge')).toHaveText('12');
            await expect(page.locator('[data-request-echo]')).toContainText(request);
          }
          const label = `${entry.path} ${width} ${theme}`;
          const layout = await barLayout(page);
          expect(layout.scroll, `${label}: no sideways scroll`).toBeLessThanOrEqual(layout.viewport);
          expect(layout.bar.right - layout.right!.right, `${label}: avatar cluster sits at the right edge`).toBeLessThanOrEqual(24);
          expect(layout.right!.bottom - layout.right!.top, `${label}: right cluster stays on one line`).toBeLessThanOrEqual(40);
          if (width >= 900) {
            expect(layout.nav, `${label}: tabs visible`).not.toBeNull();
            expect(apart(layout.left!, layout.nav!), `${label}: logo and tabs do not overlap`).toBe(true);
            expect(apart(layout.nav!, layout.right!), `${label}: tabs and right cluster do not overlap`).toBe(true);
            const centre = (box: Box) => (box.left + box.right) / 2;
            expect(Math.abs(centre(layout.nav!) - centre(layout.bar)), `${label}: tabs centred`).toBeLessThanOrEqual(2);
          } else {
            expect(layout.nav, `${label}: tabs hidden on phones`).toBeNull();
            if (entry.scope !== 'cockpit-plan') await expect(page.locator('[data-nav-page-name]')).toBeVisible();
          }
          const name = `FE12-${entry.scope}-${width}-${theme}.png`;
          const path = info.outputPath(name);
          await page.screenshot({ path, fullPage: true, animations: 'disabled' });
          hashes.push(`${name} ${createHash('sha256').update(await readFile(path)).digest('hex')}`);
        }
      }
    }
  } finally { await db.end(); }
  console.log(`FE-12 screenshot SHA256\n${hashes.join('\n')}`);
});

// Review #162 (P2): a request without spaces (a pasted link) must wrap inside every moment that repeats it.
test('FE-12: a long request without spaces wraps in every cockpit moment and never widens the page', async ({ page }) => {
  test.setTimeout(240_000);
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const user = await admin(page);
    const request = `Tạo issue theo https://example.test/${'a'.repeat(300)}`;
    const plan = { kind: 'plan', summary: 'FE12 câu không có khoảng trắng', steps: [
      { id: 'step_1', tool: 'github.create_issue', description: 'Tạo issue', args: { repo: 'org/ati-test', title: 'FE12' } },
      { id: 'step_2', tool: 'slack.send_message', description: 'Báo Slack', args: { channel: '#ati-test', text: 'FE12' } },
    ], warnings: [] };
    const text = JSON.stringify(plan);
    // Moment 5 is the pending plan with its approval held, as in fe-05b-parity-b.
    const cases = [
      { moment: '4', status: 'pending', steps: [] },
      { moment: '5', status: 'pending', steps: ['succeeded', 'running'] },
      { moment: '6', status: 'completed', steps: ['succeeded', 'succeeded'] },
      { moment: '7', status: 'partial', steps: ['succeeded', 'failed'] },
      { moment: '8', status: 'partial', steps: ['succeeded', 'unknown'] },
      { moment: '9', status: 'reconciliation_required', steps: ['succeeded', 'pending'] },
      { moment: 'unsuccessful', status: 'stopped', steps: ['succeeded', 'pending'] },
    ];
    const seeded: { moment: string; conversation: string }[] = [];
    for (const entry of cases) {
      const conversation = await fixtureConversation(db,user.id,`FE12 long ${entry.moment}`);
      await fixtureMessage(db,conversation,'user',request);
      const planId = (await db.query("INSERT INTO plans(conv_id,plan_json,plan_text,plan_hash,status,expires_at,decided_at) VALUES($1,$2::jsonb,$3,$4,$5,now()+interval '30 minutes',CASE WHEN $5='pending' THEN NULL ELSE now() END) RETURNING id", [conversation, text, text, createHash('sha256').update(text).digest('hex'), entry.status])).rows[0].id;
      for (const [index, status] of entry.steps.entries()) {
        const step = plan.steps[index];
        const output = status === 'succeeded' ? (index ? { ok: true } : { number: 42, html_url: 'https://github.com/org/ati-test/issues/42' }) : null;
        const error = status === 'failed' ? { message: 'Slack từ chối gửi tin nhắn.' } : null;
        await db.query('INSERT INTO execution_steps(plan_id,step_id,tool,args_json,status,output_json,error_json,requested_by,duration_ms) VALUES($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7::jsonb,$8,$9)', [planId, step.id, step.tool, JSON.stringify(step.args), status, output && JSON.stringify(output), error && JSON.stringify(error), user.id, 250]);
      }
      seeded.push({ moment: entry.moment, conversation });
    }
    for (const width of [375, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      for (const { moment, conversation } of seeded) {
        let release: (() => void) | undefined;
        if (moment === '5') {
          const approval = new Promise<void>(resolve => { release = resolve; });
          await page.route('**/api/plans/*/approve', async route => { await approval; await route.fulfill({ status: 409, json: { error: 'FE-12 held approval' } }); });
        }
        await page.goto(`/c/${conversation}`);
        if (moment === '5') {
          await expect(page.locator('#moment-4')).toBeVisible();
          await page.getByRole('button', { name: 'Duyệt kế hoạch', exact: true }).click();
        }
        const stage = page.locator(`section[data-moment="${moment}"]`);
        await expect(stage).toBeVisible();
        await expect(stage.locator('[data-request-echo]')).toContainText(request);
        const measured = await stage.evaluate(section => {
          const right = (selector: string) => section.querySelector(selector)?.getBoundingClientRect().right ?? 0;
          const echo = section.querySelector('[data-request-echo]') as HTMLElement;
          const counter = section.querySelector('#exec-progress-label')?.getBoundingClientRect();
          return { scroll: document.documentElement.scrollWidth, viewport: window.innerWidth, echoScroll: echo.scrollWidth, echoClient: echo.clientWidth, heading: right('h1'), counter: counter?.right ?? 0, counterHeight: counter?.height ?? 0 };
        });
        const label = `moment ${moment} at ${width}`;
        expect(measured.scroll, `${label}: no sideways scroll`).toBeLessThanOrEqual(measured.viewport);
        expect(measured.echoScroll, `${label}: the request wraps inside its line`).toBeLessThanOrEqual(measured.echoClient);
        expect(measured.heading, `${label}: heading stays on screen`).toBeLessThanOrEqual(measured.viewport);
        expect(measured.counter, `${label}: step counter stays on screen`).toBeLessThanOrEqual(measured.viewport);
        expect(measured.counterHeight, `${label}: step counter stays on one line`).toBeLessThanOrEqual(32);
        if (release) {
          release();
          await expect(page.locator('#moment-4')).toBeVisible();
          await page.unroute('**/api/plans/*/approve');
        }
      }
    }
  } finally { await db.end(); }
});

test('FE-12: a member gets four tabs on desktop and reaches every page from the avatar menu on a phone', async ({ page }) => {
  test.setTimeout(120_000);
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const email = `fe12-member-${randomUUID()}@example.test`;
  let id: string | undefined;
  try {
    id = (await db.query("INSERT INTO users(email,password,name,status,email_verified) VALUES($1,$2,'FE12 Member','active',true) RETURNING id", [email, hashPassword(memberPassword)])).rows[0].id;
    await session(page, email, memberPassword);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/history');
    await expect(mainNav(page).getByRole('link')).toHaveCount(4);
    await expect(mainNav(page).getByRole('link', { name: 'Người dùng' })).toHaveCount(0);
    await page.setViewportSize({ width: 375, height: 812 });
    for (const [item, url] of [['Kết nối dịch vụ', /\/settings$/], ['Cẩm nang', /\/guide$/], ['Tài khoản', /\/account$/], ['Chính sách an toàn', /\/privacy$/], ['Nhật ký điều phối', /\/history$/]] as const) {
      await expect(mainNav(page)).toBeHidden();
      await page.getByRole('button', { name: /Menu người dùng/ }).click();
      await page.getByRole('menuitem', { name: item, exact: true }).click();
      await expect(page, `menu → ${item}`).toHaveURL(url);
    }
    await page.getByRole('banner').getByRole('link', { name: /Về không gian làm việc/ }).click();
    await expect(page).toHaveURL(/\/$/);
  } finally {
    if (id) await db.query('DELETE FROM users WHERE id=$1', [id]);
    await db.end();
  }
});

test('FE-12: the cockpit keeps the request on screen without a second bar and the drawers still open', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await admin(page);
  await page.goto('/');
  const input = page.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });
  await expect(input).toBeVisible();
  await expect(page.locator('[data-request-echo]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Xem hội thoại', exact: true })).toBeHidden();
  const request = `FE12 tạo công việc Trello và báo Slack ${randomUUID().slice(0, 8)}`;
  await input.fill(request); await input.press('Enter');
  await expect(page.getByRole('button', { name: 'Duyệt kế hoạch', exact: true })).toBeVisible();
  const echo = page.locator('[data-request-echo]');
  await expect(echo).toContainText(`Bạn nhờ: “${request}”`);
  expect(await echo.evaluate(line => !!(line.compareDocumentPosition(document.querySelector('#heading-moment-4')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.getByRole('banner').getByText(request)).toHaveCount(0);
  await expect(page.locator('#top-bar-query-container')).toHaveCount(0);
  await page.getByRole('button', { name: 'Mở danh sách hội thoại' }).click();
  await expect(page.getByRole('dialog', { name: 'Lịch sử yêu cầu' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Xem hội thoại', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Nhật ký hội thoại' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Hủy', exact: true }).click();
});
