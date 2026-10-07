import { test, expect, type Page, type TestInfo } from '@playwright/test';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

async function login(page: Page) {
  await page.goto('/login'); await page.getByLabel('Email').fill(process.env.CHAT_ADMIN_EMAIL!);
  await page.getByLabel('Mật khẩu').fill(process.env.CHAT_ADMIN_PASSWORD!);
  await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Hôm nay bạn muốn nhờ việc gì?'})).toBeVisible();
}
async function seed(page: Page, pending = false, longURL = false, resultURL?: string) {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const owner = (await db.query('SELECT id FROM users WHERE email=$1',[process.env.CHAT_ADMIN_EMAIL])).rows[0].id;
    const convId = (await db.query('INSERT INTO conversations(user_id,title) VALUES($1,$2) RETURNING id',[owner,'Reviewer isolated fixture'])).rows[0].id;
    await db.query("INSERT INTO messages(conv_id,role,content) VALUES($1,'user','Original completed request')",[convId]);
    const old = {kind:'plan',summary:'OLD completed plan',steps:[{id:'step_1',tool:'github.create_issue',description:'OLD operation: create an issue',args:{repo:'VinhDat267/ATI_Project',title:'Old issue'}}]};
    const insert = async (plan: any,status:string) => {
      const text=JSON.stringify(plan);
      return (await db.query("INSERT INTO plans(conv_id,plan_json,plan_text,plan_hash,status,expires_at) VALUES($1,$2::jsonb,$3,$4,$5,now()+interval '30 minutes') RETURNING id",[convId,text,text,createHash('sha256').update(text).digest('hex'),status])).rows[0].id;
    };
    const oldId=await insert(old,'completed');
    const url=resultURL ?? (longURL?'https://github.com/VinhDat267/ATI_Project/issues/12345':'https://github.com/ati/test/issues/42');
    await db.query("INSERT INTO execution_steps(plan_id,step_id,tool,args_json,status,output_json,requested_by,started_at,completed_at,duration_ms) VALUES($1,'step_1','github.create_issue',$2::jsonb,'succeeded',$3::jsonb,$4,now()-interval '3 seconds',now(),3000)",[oldId,JSON.stringify(old.steps[0].args),JSON.stringify({id:'old-issue',number:42,title:'Old issue',url,repo:'VinhDat267/ATI_Project'}),owner]);
    let newId;
    if(pending) newId=await insert({kind:'plan',summary:'NEW pending plan',steps:[{id:'step_1',tool:'slack.send_message',description:'NEW operation: send a message',args:{channel:'#general',text:'New content'}}]},'pending');
    await page.goto(`/c/${convId}`); await expect(page.getByRole('region',{name:/Cockpit|Tôi sẽ làm|Đang thực hiện công việc|Đã xong/})).toHaveAttribute('data-moment',pending?'4':'6');
    return {convId,oldId,newId};
  } finally { await db.end(); }
}
async function save(info:TestInfo,page:Page,name:string,proof:unknown) {
  await writeFile(info.outputPath(`${name}.json`),JSON.stringify(proof,null,2));
  await page.screenshot({path:info.outputPath(`${name}.png`),animations:'disabled'});
}
for (const pending of [false,true]) test(`FE-05: a new request owns planning after ${pending ? 'a pending preview' : 'a completed receipt'}`,async({page},info)=>{
  await login(page); const ids=await seed(page,pending); let unblock!:()=>void; let entered!:()=>void;
  const gate=new Promise<void>(resolve=>unblock=resolve), started=new Promise<void>(resolve=>entered=resolve);
  await page.route('**/api/conversations/*/messages',async route=>{entered();await gate;await route.fulfill({status:503,json:{error:'Reviewer bounded transport failure'}});});
  try {
    if(pending) await page.getByRole('button',{name:'Sửa qua Chat'}).click();
    if(pending) await page.getByRole('button',{name:'Sửa qua Chat'}).click();
    const input=page.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });
    await input.fill('NEW request waiting for planner'); await input.press('Enter'); await started;
    const actual=await page.getByRole('region',{name:/Cockpit|Tôi sẽ làm|Đang thực hiện công việc|Đã xong/}).getAttribute('data-moment');
    await save(info,page,'new-request-stale-receipt',{...ids,actual,expected:'2',request:await page.locator('[data-cockpit-background]').innerText()});
    expect(actual).toBe('2');
  } finally { unblock(); }
});
for (const [service,url] of [
  ['GitHub','https://github.com/VinhDat267/ATI_Project/issues/12345'],
  ['Sheets','https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefgh/edit#gid=123456789'],
  ['Notion','https://www.notion.so/Workspace/Implementation-receipt-0123456789abcdef0123456789abcdef'],
]) test(`FE-05: representative long ${service} receipt link wraps at 375px`,async({page},info)=>{
  await page.setViewportSize({width:375,height:900}); await login(page); const ids=await seed(page,false,true,url);
  const link=page.locator('#receipt-chain a').filter({hasText:'Mở issue'});
  await expect(link).toBeVisible(); await expect(link).toHaveAttribute('target','_blank'); await expect(link).toHaveAttribute('rel','noopener noreferrer');
  const dimensions=await page.evaluate(()=>{const main=document.querySelector<HTMLElement>('#stage-container')!;return {document:document.documentElement.scrollWidth,viewport:innerWidth,mainScroll:main.scrollWidth,mainClient:main.clientWidth};});
  await save(info,page,'long-receipt-link',{...ids,url,dimensions});
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.mainScroll).toBeLessThanOrEqual(dimensions.mainClient);
  await link.focus(); await expect(link).toBeFocused();
});
test('FE-05: approval progress is bound to the new plan instead of an older receipt',async({page},info)=>{
  await login(page); const ids=await seed(page,true); let unblock!:()=>void; let entered!:()=>void;
  const gate=new Promise<void>(resolve=>unblock=resolve), started=new Promise<void>(resolve=>entered=resolve);
  await page.route('**/api/plans/*/approve',async route=>{entered();await gate;await route.fulfill({status:409,json:{error:'Reviewer bounded approval delay'}});});
  try {
    await page.getByRole('button',{name:'Duyệt kế hoạch',exact:true}).click(); await started;
    const actual=await page.getByRole('region',{name:/Cockpit|Tôi sẽ làm|Đang thực hiện công việc|Đã xong/}).getAttribute('data-moment');
    const oldVisible=await page.getByText('OLD operation: create an issue',{exact:true}).isVisible().catch(()=>false);
    await save(info,page,'approval-old-progress',{...ids,actual,oldVisible,body:await page.locator('[data-cockpit-background]').innerText()});
    expect(oldVisible).toBe(false);
    await expect(page.getByRole('region',{name:/Cockpit|Tôi sẽ làm|Đang thực hiện công việc|Đã xong/})).toHaveAttribute('data-moment','5');
    await expect(page.getByText('NEW operation: send a message',{exact:true})).toBeVisible();
    await expect(page.locator('a[href="https://github.com/ati/test/issues/42"]')).toHaveCount(0);
    await expect(page.getByText('Đã hoàn thành 1/1 bước.',{exact:true})).toHaveCount(0);
  } finally { unblock(); }
});
test('FE-05: native terminal SSE planner error remains visible in the cockpit',async({page},info)=>{
  await login(page);let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  const message='Reviewer planner could not finish this request';
  await page.route('**/api/conversations/*/stream',async route=>{await gate;await route.fulfill({status:200,contentType:'text/event-stream',body:`event: error\ndata: ${JSON.stringify({message})}\n\n`});});
  let sends=0;
  await page.route('**/api/conversations/*/messages',async route=>{sends++;await route.fulfill({status:202,json:{messageId:`bounded-message-${sends}`}});});
  try {
    await page.getByRole('button',{name:'Mở danh sách hội thoại'}).click(); await page.getByRole('button',{name:'Cuộc hội thoại mới',exact:true}).click();await expect(page).toHaveURL(/\/c\//);
    const input=page.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });await input.fill('Request with an explicit planning failure');await input.press('Enter');
    // Open while discovery is active; moment 1 hides the source chat button.
    await page.getByRole('button',{name:'Xem hội thoại',exact:true}).click(); release();
    await expect(page.getByRole('log').getByText(`Lỗi: ${message}`,{exact:true}).first()).toBeVisible();
    await page.screenshot({path:info.outputPath('terminal-error-in-log.png'),animations:'disabled'});
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region',{name:/Cockpit|Tôi sẽ làm|Đang thực hiện công việc|Đã xong/}).getByRole('alert')).toHaveText(`Lỗi: ${message}`);
    await expect(page.getByRole('region',{name:/Cockpit|Tôi sẽ làm|Đang thực hiện công việc|Đã xong/}).getByRole('alert')).toBeInViewport();
    const text=await page.getByRole('region',{name:/Cockpit|Tôi sẽ làm|Đang thực hiện công việc|Đã xong/}).innerText();
    const errorVisible=text.includes(message);
    await save(info,page,'terminal-error-hidden',{errorVisible,text,expected:'A visible error fallback after planning ended; frontend SSE boundary proof only'});
    expect(errorVisible).toBe(true);
    await input.fill('A subsequent request after the terminal error');
    await expect(page.getByRole('button',{name:/^(Gửi|Gửi tin nhắn|Gửi yêu cầu)$/})).toBeEnabled(); await input.press('Enter');
    await expect.poll(()=>sends).toBe(2);
  } finally {release();}
});
for (const event of ['clarification','error']) for (const readPhase of ['during planning','after terminal']) test(`FE-05: late snapshot: new ${event} owns the stage after delayed old receipt HTTP begun ${readPhase}`,async({page},info)=>{
  await login(page);
  let releaseTerminal!:()=>void, releaseSnapshot!:()=>void, noteSnapshot!:()=>void;
  const terminalGate=new Promise<void>(resolve=>releaseTerminal=resolve);
  const snapshotGate=new Promise<void>(resolve=>releaseSnapshot=resolve);
  const snapshotStarted=new Promise<void>(resolve=>noteSnapshot=resolve);
  let streamOpens=0, armed=false, terminalStreamOpened=false, requestId:string|undefined;
  let snapshot:any;
  await page.route('**/api/conversations/*/stream',async route=>{
    streamOpens++;
    if (streamOpens===1) { await route.fulfill({status:200,contentType:'text/event-stream',body:': initial connection\n\n'}); return; }
    await terminalGate; terminalStreamOpened=true;
    await route.fulfill({status:200,contentType:'text/event-stream',body:`event: ${event}\ndata: ${JSON.stringify({requestId,question:'NEW request needs a destination',options:['NEW destination A'],message:'NEW request failed before planning finished'})}\n\n`});
  });
  await page.route('**/api/conversations/*/executions/latest',async route=>{
    if (!armed || !terminalStreamOpened || (readPhase==='after terminal' && streamOpens<3)) { await route.continue(); return; }
    const response=await route.fetch(); snapshot=await response.json(); noteSnapshot();
    await snapshotGate; await route.fulfill({response});
  });
  const ids=await seed(page);
  await page.route('**/api/conversations/*/messages',async route=>{
    requestId=route.request().postDataJSON().tempId;
    await route.fulfill({status:202,json:{messageId:'reviewer-new-message'}}); releaseTerminal();
  });
  try {
    armed=true;
    const input=page.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });
    await input.fill(`NEW request ending in ${event}`); await input.press('Enter');
    const cockpit=page.getByRole('region',{name:/Cockpit|Tôi sẽ làm|Đang thực hiện công việc|Đã xong/}), expected=event==='clarification'?'3':'1';
    await expect(cockpit).toHaveAttribute('data-moment',expected); await snapshotStarted;
    const before={moment:await cockpit.getAttribute('data-moment'),body:await cockpit.innerText()};
    await page.screenshot({path:info.outputPath(`late-snapshot-${event}-before.png`),animations:'disabled'});
    const readResponse=page.waitForResponse(response=>response.url().endsWith(`/api/conversations/${ids.convId}/executions/latest`));
    releaseSnapshot(); await readResponse;
    await readResponse.then(response=>response.finished());
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    const after={moment:await cockpit.getAttribute('data-moment'),body:await cockpit.innerText()};
    await save(info,page,`late-snapshot-${event}`,{...ids,readPhase,requestId,streamOpens,expected,before,after,snapshotPlanId:snapshot.plan.id,snapshotStatus:snapshot.execution.status,boundary:'Real fixture DB/HTTP + controlled native SSE; frontend ownership only'});
    expect(after.moment).toBe(expected);
    await expect(page.locator('a[href="https://github.com/ati/test/issues/42"]')).toHaveCount(0);
    if(event==='clarification') {
      await expect(cockpit.getByText('NEW request needs a destination',{exact:true})).toBeVisible();
      await expect(cockpit.getByRole('radio',{name:'NEW destination A',exact:true})).toBeEnabled();
    } else {
      await expect(cockpit.getByRole('alert')).toHaveText('Lỗi: NEW request failed before planning finished');
      await expect(cockpit.getByRole('alert')).toBeInViewport();
    }
  } finally {releaseTerminal();releaseSnapshot();}
});
