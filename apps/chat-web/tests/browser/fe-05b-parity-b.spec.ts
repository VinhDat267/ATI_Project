import { test,expect } from '@playwright/test';
import pg from 'pg';
import { createHash } from 'node:crypto';

for(const width of [1440,375]) for(const theme of ['light','dark'] as const) {
  test(`FE-05: FE-05b real approval wait, saved receipt references and single composer ${width} ${theme}`,async({page},info)=>{
    await page.setViewportSize({width,height:width===375?812:900});await page.emulateMedia({colorScheme:theme});
    await page.goto('/login');await page.getByLabel('Email', { exact: true }).fill(process.env.CHAT_ADMIN_EMAIL!);await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.CHAT_ADMIN_PASSWORD!);await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
    await expect(page.getByRole('heading',{level:1})).toHaveText('Hôm nay bạn muốn nhờ việc gì?');
    const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
    try {
      const owner=(await db.query('SELECT id FROM users WHERE email=$1',[process.env.CHAT_ADMIN_EMAIL])).rows[0].id;
      const title=`Kiểm chứng biên nhận ${width} ${theme} ${Date.now()}`;
      const conv=(await db.query('INSERT INTO conversations(user_id,title) VALUES($1,$2) RETURNING id',[owner,title])).rows[0].id;
      await db.query("INSERT INTO messages(conv_id,role,content) VALUES($1,'user','Tạo issue rồi báo nhóm')",[conv]);
      const plan={kind:'plan',summary:'Tạo issue rồi báo nhóm',resourceLabels:{'owner/repo':'owner/repo','#general':'#general'},steps:[{id:'step_1',tool:'github.create_issue',description:'Tạo issue',args:{repo:'owner/repo',title:'Kiểm chứng',body:'Mô tả'}},{id:'step_2',tool:'slack.send_message',description:'Báo nhóm',args:{channel:'#general',text:{$template:'Issue ${step_1.output.number}'}}}]};
      const text=JSON.stringify(plan);
      const id=(await db.query("INSERT INTO plans(conv_id,plan_json,plan_text,plan_hash,status,expires_at) VALUES($1,$2::jsonb,$2,$3,'pending',now()+interval '30 minutes') RETURNING id",[conv,text,createHash('sha256').update(text).digest('hex')])).rows[0].id;
      for(const [i,step] of plan.steps.entries()) await db.query("INSERT INTO execution_steps(plan_id,step_id,tool,args_json,status,output_json,requested_by,duration_ms,started_at,completed_at) VALUES($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8,now()-interval '1 second',CASE WHEN $5='succeeded' THEN now() ELSE NULL END)",[id,step.id,step.tool,JSON.stringify(step.args),i?'running':'succeeded',JSON.stringify(i?{number:999,url:'https://slack.com/app_redirect?channel=general'}:{number:42,url:'https://github.com/owner/repo/issues/42'}),owner,i?7:1200]);
      await page.goto(`/c/${conv}`);await expect(page.locator('#moment-4')).toBeVisible();await expect(page.locator('textarea:visible')).toHaveCount(0);
      const historyOpener=page.getByRole('button',{name:'Mở danh sách hội thoại'});await historyOpener.click();
      const history=page.getByRole('dialog',{name:'Lịch sử yêu cầu'});
      // Keep the last focusable control stable while testing wrapping; FE-02 tests scrolling pagination separately.
      await history.getByRole('searchbox').fill(title);await expect(history.getByRole('button',{name:title,exact:true})).toBeVisible();
      const closeHistory=history.getByRole('button',{name:'Đóng Lịch sử yêu cầu'});await closeHistory.focus();
      await closeHistory.press('Shift+Tab');const lastHistoryControl=history.locator('button:not([disabled])').last();await expect(lastHistoryControl).toBeFocused();
      await lastHistoryControl.press('Tab');await expect(closeHistory).toBeFocused();await page.keyboard.press('Escape');await expect(historyOpener).toBeFocused();
      await expect(page.locator('textarea:visible')).toHaveCount(0);
      let release!:()=>void;const approval=new Promise<void>(resolve=>{release=resolve;});
      await page.route('**/api/plans/*/approve',async route=>{await approval;await route.fulfill({status:409,json:{error:'Explicit bounded approval fixture'}});});
      await page.getByRole('button',{name:'Duyệt kế hoạch',exact:true}).click();await expect(page.locator('#moment-5')).toBeVisible();
      await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','0');await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuemax','2');
      expect(await page.locator('#exec-progress-bar').evaluate(node=>(node as HTMLElement).style.width)).toBe('0%');
      await expect(page.locator('#exec-item-2')).not.toContainText('999');await expect(page.locator('#exec-item-2 a')).toHaveCount(0);await expect(page.locator('#exec-item-2')).not.toContainText('✓ Đã');
      await expect(page.locator('textarea:visible')).toHaveCount(1);await expect(page.locator('#global-bottom-bar')).toHaveCSS('position','fixed');
      const draft=page.getByRole('textbox');await draft.fill('Một\nhai');await draft.press('Shift+Enter');await expect(draft).toHaveValue('Một\nhai\n');
      const opener=page.getByRole('button',{name:'Xem hội thoại',exact:true});await opener.click();await expect(page.locator('textarea:visible')).toHaveCount(1);await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue('Một\nhai\n');
      await expect(page.locator('#chat-drawer')).toHaveCSS('width',`${width===375?375:420}px`);await expect(page.locator('#drawer-backdrop')).toHaveCSS('backdrop-filter','blur(4px)');
      const close=page.getByRole('button',{name:'Đóng Nhật ký hội thoại'});await expect(close).toBeFocused();await close.press('Shift+Tab');await expect(page.getByRole('button',{name:'Gửi tin nhắn',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(opener).toBeFocused();
      release();await expect(page.locator('#moment-4')).toBeVisible();
      await db.query("UPDATE execution_steps SET status='succeeded',completed_at=now() WHERE plan_id=$1 AND step_id='step_2'",[id]);await db.query("UPDATE plans SET status='completed' WHERE id=$1",[id]);
      await page.reload();await expect(page.getByRole('heading',{level:1})).toHaveText('Đã xong 2 việc trên 2 công cụ');
      await expect(page.locator('[data-receipt-connector]')).toHaveAttribute('data-from','step_1');await expect(page.locator('[data-receipt-connector]')).toContainText('number');
      for(const link of await page.locator('#receipt-chain a').all()){await expect(link).toHaveAttribute('href',/^https:/);await expect(link).toHaveAttribute('target','_blank');await expect(link).toHaveAttribute('rel','noopener noreferrer');}
      await expect(page.getByText('< 0,1 giây',{exact:true})).toBeVisible();await expect(page.getByText('github.create_issue',{exact:true})).toBeHidden();
      const metrics=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth,main:document.querySelector('#stage-container')!.getBoundingClientRect().width}));expect(metrics.scroll).toBeLessThanOrEqual(width);expect(metrics.main).toBe(width===1440?1120:375);
      const last=page.locator('#receipt-chain a').last();await last.scrollIntoViewIfNeeded();const linkBox=await last.boundingBox(),footer=await page.locator('#global-bottom-bar form').boundingBox();expect(linkBox!.y+linkBox!.height).toBeLessThan(footer!.y);
      await info.attach('FE05b-progress-and-receipt',{body:JSON.stringify(metrics),contentType:'application/json'});
      await db.query('UPDATE plans SET plan_json=$2::jsonb WHERE id=$1',[id,JSON.stringify({...plan,steps:plan.steps.map((step,i)=>i?{...step,args:{channel:'#general',text:'A plain step_1.output.number'},dependsOn:['step_1']}:step)})]);
      await page.reload();await expect(page.locator('#moment-6')).toBeVisible();await expect(page.locator('[data-receipt-connector]')).toHaveCount(0);
    } finally {await db.end();}
  });
}
