import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';
import { createHash } from 'node:crypto';

const email = process.env.CHAT_ADMIN_EMAIL!;
const password = process.env.CHAT_ADMIN_PASSWORD!;
const pool = () => new pg.Pool({ connectionString: process.env.DATABASE_URL });
async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ })).toBeVisible();
}
async function owner(db: pg.Pool) { return (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id; }

test('FE-02: Back/Forward, direct reload restores pending plan and saved execution, foreign link has no data', async ({ page }, testInfo) => {
  const db = pool();
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Đăng nhập vào hệ thống' }).click(); await expect(page).toHaveURL(/\/login$/);
    await page.goBack(); await expect(page.getByRole('button', { name: 'Đăng nhập vào hệ thống' })).toBeVisible();
    await page.goForward(); await expect(page.getByLabel('Email')).toBeVisible();
    await login(page); await expect(page).toHaveURL(/\/$/);
    const userId = await owner(db);
    const id = (await db.query('INSERT INTO conversations(user_id,title) VALUES($1,$2) RETURNING id', [userId, 'FE02 direct saved'])).rows[0].id;
    await db.query("INSERT INTO messages(conv_id,role,content) VALUES($1,'user','FE02 saved request')", [id]);
    for (const [status, summary] of [['reconciliation_required', 'FE02 saved UNKNOWN'], ['pending', 'FE02 pending preview']]) {
      const plan = { kind: 'plan', summary, steps: [{ id: 'step_1', tool: 'slack.send_message', description: 'Saved operation', args: { channel: '#general', text: 'Saved output' } }], warnings: [] };
      const text = JSON.stringify(plan);
      const planId = (await db.query("INSERT INTO plans(conv_id,plan_json,plan_text,plan_hash,status,expires_at) VALUES($1,$2::jsonb,$3,$4,$5,now()+interval '30 minutes') RETURNING id", [id, text, text, createHash('sha256').update(text).digest('hex'), status])).rows[0].id;
      if (status !== 'pending') await db.query("INSERT INTO execution_steps(plan_id,step_id,tool,args_json,status,requested_by,error_json) VALUES($1,'step_1','slack.send_message',$2::jsonb,'unknown',$3,$4::jsonb)", [planId, JSON.stringify(plan.steps[0].args), userId, JSON.stringify({ message: 'Interrupted saved write' })]);
    }
    await page.goto(`/c/${id}`); await page.reload();
    await expect(page.getByText('FE02 saved request')).toBeVisible();
    await expect(page.getByText('FE02 pending preview', {exact:true})).toBeVisible();
    await expect(page.getByRole('region', { name: /Hệ thống vừa khởi động lại|Chưa rõ kết quả/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('FE02-direct-reload.png'), fullPage: true });
    await page.getByRole('button', {name:'Mở danh sách hội thoại'}).click(); await page.getByRole('button', {name:/Cuộc hội thoại mới/}).click();
    await expect(page).not.toHaveURL(new RegExp(`/c/${id}$`));
    await page.goBack(); await expect(page.getByText('FE02 saved request')).toBeVisible();
    const foreignUser = (await db.query("INSERT INTO users(email,password,name) VALUES($1,'fixture-hash','Foreign fixture') RETURNING id", [`foreign-fe02-${Date.now()}@example.test`])).rows[0].id;
    const foreign = (await db.query('INSERT INTO conversations(user_id,title) VALUES($1,$2) RETURNING id', [foreignUser, 'Foreign private title'])).rows[0].id;
    await db.query("INSERT INTO messages(conv_id,role,content) VALUES($1,'user','Foreign private message')", [foreign]);
    await page.goto(`/c/${foreign}`);
    await expect(page.getByText('Không tìm thấy hội thoại.')).toBeVisible();
    await expect(page.getByText('Foreign private message')).toHaveCount(0);
    await expect(page.getByText('Foreign private title')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ })).toHaveCount(0);
  } finally { await db.end(); }
});

test('FE-02: history cursor reaches older than 50, literal title search and rename persist', async ({ page }, testInfo) => {
  const db = pool();
  try {
    await login(page); const userId = await owner(db); const prefix = `FE02-${Date.now()}`;
    const oldest = (await db.query("INSERT INTO conversations(user_id,title,updated_at) VALUES($1,$2,now()-interval '60 days') RETURNING id", [userId, `${prefix} oldest %_`])).rows[0].id;
    for (let index = 0; index < 55; index++) await db.query('INSERT INTO conversations(user_id,title) VALUES($1,$2)', [userId, `${prefix} history ${index}`]);
    await page.reload(); await page.getByRole('button',{name:'Mở danh sách hội thoại'}).click(); const history = page.getByRole('region', { name: 'Danh sách hội thoại' });
    await expect(history.getByText(`${prefix} history 54`)).toBeVisible();
    await expect(history.getByText(`${prefix} oldest %_`)).toHaveCount(0);
    // Search is sent to the server; literal SQL wildcard characters must not match other titles.
    const search = page.getByRole('searchbox', { name: 'Tìm hội thoại theo tiêu đề' });
    await search.fill(`${prefix} oldest %_`); await expect(history.getByText(`${prefix} oldest %_`)).toBeVisible();
    await expect(history.getByRole('button', { name: /^FE02-.*history/ })).toHaveCount(0);
    await search.fill(prefix); await expect(history.getByText(`${prefix} history 54`)).toBeVisible();
    await history.evaluate(area => { area.scrollTop = area.scrollHeight; });
    await expect(history.getByText(`${prefix} oldest %_`)).toBeAttached();
    await history.getByRole('button', { name: `Đổi tên ${prefix} oldest %_`, exact: true }).click();
    await history.getByRole('textbox', { name: 'Tiêu đề hội thoại' }).fill(`${prefix} renamed`);
    await history.getByRole('button', { name: 'Lưu tên hội thoại' }).click();
    await expect(history.getByText(`${prefix} renamed`)).toBeVisible();
    expect((await db.query('SELECT title FROM conversations WHERE id=$1', [oldest])).rows[0].title).toBe(`${prefix} renamed`);
    await page.screenshot({ path: testInfo.outputPath('FE02-paged-renamed-history.png'), fullPage: true });
  } finally { await db.end(); }
});

test('FE-02: empty chat starts at top', async ({ page }, testInfo) => {
  await login(page);
  const db = pool();
  try {
    // The source hides chat at moment 1; an empty saved preview exposes the drawer.
    const id=(await db.query('INSERT INTO conversations(user_id,title) VALUES($1,$2) RETURNING id',[await owner(db),'Empty transcript preview'])).rows[0].id;
    const text=JSON.stringify({kind:'plan',summary:'Empty transcript',steps:[{id:'step_1',tool:'slack.send_message',description:'Saved preview',args:{channel:'#general',text:'Empty transcript fixture'}}],warnings:[]});
    await db.query("INSERT INTO plans(conv_id,plan_json,plan_text,plan_hash,status,expires_at) VALUES($1,$2::jsonb,$3,$4,'pending',now()+interval '30 minutes')",[id,text,text,createHash('sha256').update(text).digest('hex')]);
    await page.goto(`/c/${id}`);
  } finally {await db.end();}
  await page.getByRole('button',{name:'Xem hội thoại',exact:true}).click();
  const empty = page.getByRole('log',{name:'Hội thoại'});
  await expect(empty).toBeVisible();
  await expect.poll(() => empty.evaluate(area => area.scrollTop)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('FE02-empty-scroll-top.png'), fullPage: true });
});

test('FE-02: messages follow near bottom and preserve reading above', async ({ page }, testInfo) => {
  const db = pool();
  try {
    await login(page);
    const id = (await db.query('INSERT INTO conversations(user_id,title) VALUES($1,$2) RETURNING id', [await owner(db), 'FE02 scrolling'])).rows[0].id;
    for (let index = 0; index < 25; index++) await db.query("INSERT INTO messages(conv_id,role,content) VALUES($1,'user',$2)", [id, `Saved message ${index}: ${'Long scroll content. '.repeat(50)}`]);
    await page.goto(`/c/${id}`);
    await page.getByRole('textbox',{name:'Mô tả công việc bạn muốn thực hiện'}).fill('Tạo công việc Trello và thông báo Slack');
    await page.getByRole('textbox',{name:'Mô tả công việc bạn muốn thực hiện'}).press('Enter');
    await expect(page.getByRole('button',{name:'Duyệt kế hoạch',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Xem hội thoại',exact:true}).click(); const area = page.getByRole('log',{name:'Hội thoại'});
    await expect(page.getByText(/Saved message 24:/)).toBeAttached();
    // Programmatic positioning must deliver the scroll input before a planner
    // response can append another message; native event delivery is asynchronous.
    await area.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
    const composer = page.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });
    await composer.fill('FE02 scroll at bottom'); await page.locator('form').filter({ has: composer }).getByRole('button', { name: 'Gửi tin nhắn', exact: true }).click();
    await expect.poll(() => area.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(120);
    await expect(area.getByText('FE02 scroll at bottom', { exact: true })).toBeAttached();
    await area.evaluate(element => { element.scrollTop = 80; element.dispatchEvent(new Event('scroll')); });
    await expect.poll(() => area.evaluate(element => element.scrollTop)).toBe(80);
    await composer.fill('FE02 while reading above'); await page.locator('form').filter({ has: composer }).getByRole('button', { name: 'Gửi tin nhắn', exact: true }).click();
    await expect(area.getByText('FE02 while reading above', { exact: true })).toBeAttached();
    await expect.poll(() => area.evaluate(element => element.scrollTop)).toBe(80);
    await page.screenshot({ path: testInfo.outputPath('FE02-reading-scroll-preserved.png'), fullPage: true });
  } finally { await db.end(); }
});
