import { test, expect } from '@playwright/test';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const diagnostics = new WeakMap<object, string[]>();
test.beforeEach(async ({ page }) => {
  const events: string[] = []; diagnostics.set(page, events);
  page.on('console', message => { if (message.type() === 'error') events.push(`console: ${message.text()}`); });
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) events.push(`navigation: ${Date.now()} ${frame.url()}`); });
  page.on('request', request => { if (['script', 'stylesheet', 'document'].includes(request.resourceType())) events.push(`start: ${Date.now()} ${request.url()}`); });
  page.on('requestfinished', request => { if (['script', 'stylesheet', 'document'].includes(request.resourceType())) events.push(`finish: ${Date.now()} ${request.url()}`); });
  page.on('pageerror', error => events.push(`pageerror: ${error.message}`));
  page.on('requestfailed', request => events.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));
  page.on('response', response => { if (response.status() >= 400) events.push(`response: ${response.status()} ${response.url()}`); });
});

test.afterEach(async ({page},info)=>{
  if(info.status===info.expectedStatus) return;
  const state={events:diagnostics.get(page),url:page.url(),readyState:await page.evaluate(()=>document.readyState),headings:await page.locator('h1').allTextContents(),moments:await page.locator('[data-moment]:visible').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-moment')))};
  await writeFile(info.outputPath('failure-state.json'),JSON.stringify(state,null,2));
  await writeFile(info.outputPath('failure-dom.html'),await page.content());
  await page.screenshot({path:info.outputPath('failure-page.png'),fullPage:true,animations:'disabled'});
  await info.attach('failure-state',{body:JSON.stringify(state),contentType:'application/json'});
});

for(const width of [1440,375]) for(const theme of ['light','dark'] as const) {
  test(`FE-06A: saved recovery moments 7-9 and terminal receipt ${width} ${theme}`,async({page},info)=>{
    test.setTimeout(60_000);
    await page.setViewportSize({width,height:width===375?812:900});await page.emulateMedia({colorScheme:theme});
    await page.goto('/login');await page.getByLabel('Email').fill(process.env.CHAT_ADMIN_EMAIL!);await page.getByLabel('Mật khẩu').fill(process.env.CHAT_ADMIN_PASSWORD!);await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
    await expect(page.getByRole('heading',{level:1})).toHaveText('Hôm nay bạn muốn nhờ việc gì?');
    const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
    const writes:string[]=[];page.on('request',request=>{if(request.method()==='POST' && request.url().includes('/api/executions/'))writes.push(new URL(request.url()).pathname);});
    try {
      const owner=(await db.query('SELECT id FROM users WHERE email=$1',[process.env.CHAT_ADMIN_EMAIL])).rows[0].id;
      for(const moment of [7,8,9,'unsuccessful'] as const) {
        const id=(await db.query('INSERT INTO conversations(user_id,title) VALUES($1,$2) RETURNING id',[owner,`FE06 ${moment} ${theme} ${width}`])).rows[0].id;
        await db.query("INSERT INTO messages(conv_id,role,content) VALUES($1,'user',$2)",[id,'Tạo thẻ, tạo issue, ghi bảng tính rồi báo nhóm']);
        // A long unbroken value (as an edited recovery request can carry) must wrap inside the conversation drawer.
        if(moment===7) await db.query("INSERT INTO messages(conv_id,role,content) VALUES($1,'user',$2)",[id,`Làm lại việc 3 với nội dung: ${'https://docs.google.com/spreadsheets/d/'+'x'.repeat(160)}`]);
        const plan={kind:'plan',summary:'Theo dõi công việc của nhóm',steps:[
          {id:'step_1',tool:'trello.create_card',description:'Tạo card Trello',args:{listId:'list_1',name:'Sửa lỗi đăng nhập'}},
          {id:'step_2',tool:'github.create_issue',description:'Tạo issue kho ati-test',args:{repo:'org/ati-test',title:'Sửa lỗi đăng nhập'}},
          {id:'step_3',tool:'sheets.append_rows',description:'Thêm dòng vào Google Sheets',args:{spreadsheetId:'ati-test-tracker-00000001',sheet:'Tracker',rows:[['Theo dõi']]}},
          {id:'step_4',tool:'slack.send_message',description:'Gửi tin nhắn vào kênh Slack',args:{channel:'#ati-test',text:'Đã cập nhật'}},
        ],warnings:[]};
        const status=moment===9?'reconciliation_required':moment==='unsuccessful'?'stopped':'partial';
        const states=moment===7?['succeeded','succeeded','failed','pending']:moment===9?['succeeded','succeeded','pending','pending']:['succeeded','succeeded','succeeded','unknown'];
        const text=JSON.stringify(plan);const planId=(await db.query("INSERT INTO plans(conv_id,plan_json,plan_text,plan_hash,status,expires_at,decided_at) VALUES($1,$2::jsonb,$3,$4,$5,now()+interval '30 minutes',now()) RETURNING id",[id,text,text,createHash('sha256').update(text).digest('hex'),status])).rows[0].id;
        for(const [index,step] of plan.steps.entries()) await db.query("INSERT INTO execution_steps(plan_id,step_id,tool,args_json,status,output_json,error_json,requested_by,duration_ms) VALUES($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7::jsonb,$8,$9)",[planId,step.id,step.tool,JSON.stringify(step.args),states[index],index===0?JSON.stringify({id:'card',url:'https://trello.com/c/sample-auth-fix',title:'Sửa lỗi đăng nhập'}):index===1?JSON.stringify({number:42,html_url:'https://github.com/org/ati-test/issues/42'}):null,states[index]==='failed'?JSON.stringify({message:'Google Sheets từ chối ghi vì ATI chưa có quyền chỉnh sửa bảng tính ATI Test Tracker.'}):null,owner,index<2?250:null]);
        await page.goto(`/c/${id}`);const stage=page.locator(`#moment-${moment}`);await expect(stage).toBeVisible();
        await expect(page.locator('textarea:visible')).toHaveCount(1);
        const overflow=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));expect(overflow.scroll).toBeLessThanOrEqual(overflow.viewport);
        if(moment===7){await page.getByRole('button',{name:'Xem hội thoại',exact:true}).click();const log=page.locator('#chat-messages-container');await expect(log).toContainText('Làm lại việc 3');const box=await log.evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth}));expect(box.scroll).toBeLessThanOrEqual(box.client);await page.keyboard.press('Escape');await expect(log).toHaveCount(0);}
        if(moment===8){await expect(stage.getByRole('button',{name:/Thử lại|Sửa rồi|Làm tiếp/})).toHaveCount(0);await expect(stage.getByRole('link',{name:'Kiểm tra trên Slack'})).toHaveAttribute('rel','noopener noreferrer');}
        if(moment===9) await expect(stage.getByRole('button',{name:'Làm tiếp các việc còn lại'})).toBeVisible();
        if(moment==='unsuccessful'){await expect(stage.getByRole('button',{name:'Nhờ việc khác'})).toBeVisible();await expect(stage.getByRole('button',{name:/Thử lại|Dừng kế hoạch|Bỏ qua/})).toHaveCount(0);}
        await page.screenshot({path:info.outputPath(`FE06-app-${moment}-${theme}-${width}.png`),animations:'disabled'});
        await info.attach(`FE06-${moment}-measurements`,{body:JSON.stringify({moment,theme,width,...overflow}),contentType:'application/json'});
        if(moment===8){await stage.getByRole('button',{name:'Dừng kế hoạch'}).click();expect(writes).toEqual([]);await page.keyboard.press('Escape');expect(writes).toEqual([]);await stage.getByRole('button',{name:'Dừng kế hoạch'}).click();await page.getByRole('button',{name:'Dừng hẳn quy trình'}).click();await expect(page.locator('#moment-unsuccessful')).toBeVisible();expect(writes).toEqual([`/api/executions/${planId}/stop`]);expect((await db.query("SELECT status FROM execution_steps WHERE plan_id=$1 AND step_id='step_4'",[planId])).rows[0].status).toBe('unknown');writes.length=0;}
      }
    } finally {await db.end();}
  });
}
