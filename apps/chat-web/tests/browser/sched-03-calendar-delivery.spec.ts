import { test, expect } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { hashPassword } from '../../../chat-api/src/db/repositories/user-repo.js';
import type { CalendarDigestConfig } from '@wap/tool-schemas';

for (const width of [1440, 375]) test(`SCHED-03: Calendar uncertain delivery requires verification at ${width}px`, async ({ page }) => {
  test.skip(process.env.SANDBOX_SCENARIO !== 'schedule');
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const email = `calendar-delivery-${randomUUID()}@example.test`, password = 'Calendar!browser-fixture';
    const owner = (await db.query("INSERT INTO users(email,password,name,status,email_verified) VALUES($1,$2,'Calendar reviewer','active',true) RETURNING id", [email, hashPassword(password)])).rows[0].id;
    const conv = async () => (await db.query("INSERT INTO conversations(user_id,title) VALUES($1,'Calendar digest') RETURNING id", [owner])).rows[0].id;
    const scheduleConv = await conv(), runConv = await conv();
    const config: CalendarDigestConfig = { version: 1, source: 'mycalendar', credentialId: randomUUID(), email,
      calendars: [{ id: 'work@example.test', summary: 'Work' }], destination: { service: 'slack', channelId: 'C0123456789' }, windowHours: 24, includeSummary: false };
    const schedule = (await db.query(`INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status,next_run_at,kind,digest_config,digest_config_hash,digest_approved_at)
      VALUES($1,$2,'Agenda','Daily agenda','{"type":"daily","time":"08:00"}',ARRAY['mycalendar','slack'],'active',now()+interval '1 day','calendar_digest',$3,$4,now()) RETURNING id`,
      [owner, scheduleConv, config, createHash('sha256').update(JSON.stringify(config)).digest('hex')])).rows[0].id;
    const instructions = 'Chưa xác định bản tin lịch đã gửi hay chưa. Hãy kiểm tra kênh nhận trước khi gửi thêm; lượt này không tự gửi lại.';
    const run = (await db.query(`INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status,conv_id,error,delivery_started_at)
      VALUES($1,1,'manual',now(),'needs_attention',$2,$3,now()) RETURNING id,due_at`, [schedule, runConv, instructions])).rows[0];
    await db.query("INSERT INTO messages(conv_id,role,content,metadata) VALUES($1,'user','Daily agenda',$2)",
      [runConv, { type: 'schedule_run', scheduleId: schedule, runId: run.id, name: 'Agenda', dueAt: run.due_at.toISOString(), trigger: 'manual' }]);
    const login = await page.request.post('/api/auth/login', { data: { email, password } });
    expect(login.status()).toBe(200);
    const tokens = await login.json();
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/login');
    await page.evaluate(value => {
      localStorage.setItem('wap_access_token', value.accessToken);
      localStorage.setItem('wap_refresh_token', value.refreshToken);
      localStorage.setItem('wap_user', JSON.stringify(value.user));
    }, tokens);
    await page.goto(`/c/${runConv}`);
    await expect(page.getByRole('status').filter({ hasText: 'Hãy kiểm tra kênh nhận' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lập lại kế hoạch' })).toHaveCount(0);
    const retry = await page.request.post(`/api/schedule-runs/${run.id}/replan`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
    expect(retry.status()).toBe(409);
    expect((await retry.json()).error.code).toBe('RUN_NOT_REPLANNABLE');
    expect((await db.query('SELECT count(*)::int n FROM schedule_runs WHERE schedule_id=$1', [schedule])).rows[0].n).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `node_modules/.cache/calendar-delivery-${width}.png`, fullPage: true });
  } finally { await db.end(); }
});
