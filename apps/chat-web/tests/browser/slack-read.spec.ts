import {test,expect} from '@playwright/test';
import pg from 'pg';
import {createHmac,randomUUID} from 'node:crypto';
import {SlackConsentRepo} from '../../../chat-api/src/db/repositories/slack-consent-repo.js';
import {resolveRuntimeProviderIdentity} from '../../../chat-api/src/config/slack-policy-runtime.js';
for(const width of [375,1440])for(const theme of ['light','dark']){
 test(`SLACK-M2: approved read, explicit workspace and signed deletion ${width} ${theme}`,async({page},info)=>{
  test.setTimeout(60000);
  await page.setViewportSize({width,height:900});await page.addInitScript(t=>localStorage.setItem('ati-theme',t),theme);
  await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill(process.env.CHAT_ADMIN_EMAIL!);await page.getByLabel('Mật khẩu',{exact:true}).fill(process.env.CHAT_ADMIN_PASSWORD!);await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
  await page.waitForURL(url=>url.pathname!=='/login');
  const token=await page.evaluate(()=>localStorage.getItem('wap_access_token')),headers={Authorization:'Bearer '+token};
  const previous=await(await page.request.get('/api/connections/myslack',{headers})).json();for(const row of previous.connections)await page.request.delete('/api/connections/myslack/'+row.id,{headers});
  await page.goto('/settings');
  for(let i=0;i<2;i++){await page.getByRole('button',{name:'Kết nối workspace Slack',exact:true}).click();await expect(page.getByRole('heading',{name:'Đã kết nối Slack'})).toBeVisible();await page.getByRole('button',{name:'Về Kết nối dịch vụ'}).click();}
  const connections=(await(await page.request.get('/api/connections/myslack',{headers})).json()).connections;
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),repo=new SlackConsentRepo(pool),identity=resolveRuntimeProviderIdentity(process.env);
  try{
   const existing=(await pool.query('SELECT id FROM slack_trusted_providers WHERE id=$1',[identity.providerId])).rows[0];
   if(!existing)await repo.attestProvider({id:identity.providerId,name:identity.name,verified:true,noTraining:true,maxRetentionDays:30,configurationFingerprint:identity.fingerprint,evidenceRef:'BROWSER_FIXTURE',verifiedBy:'fixture',verifiedAt:new Date()});
   for(const row of connections){const previous=await repo.getConsent(row.workspaceId,identity.providerId);await repo.grantConsent({workspaceId:row.workspaceId,providerId:identity.providerId,...(previous?{expectedRevision:previous.revision}:{}),policyVersion:'v1.0.0',purposes:['manual_lookup','planning','storage'],retentionDays:7,organizationRepresentative:'fixture',evidenceRef:'BROWSER_FIXTURE',recordedBy:'fixture'});}
  }finally{await pool.end();}
  await page.goto('/');
  await page.getByRole('button',{name:'Tra cứu Slack của bạn',exact:true}).click();
  const select=page.getByLabel('Workspace Slack');await expect(select).toHaveValue('');
  await select.selectOption(connections[1].id);
  const field=page.getByLabel('Mô tả công việc bạn muốn thực hiện');await field.fill('Đọc10tin kênh C_FIXTURE');
  const statsURL=new URL('/__stats',process.env.MYSLACK_API_BASE_URL).href;
  const before=(await(await page.request.get(statsURL)).json()).reads;
  await page.getByRole('button',{name:'Gửi yêu cầu',exact:true}).click();
  await expect(page.getByRole('button',{name:/Duyệt/}).first()).toBeVisible();
  expect((await(await page.request.get(statsURL)).json()).reads).toBe(before);
  await expect(page.locator('#moment-4 p').filter({hasText:connections[1].workspaceName})).toBeVisible();
  await page.getByRole('button',{name:/Duyệt/}).first().click();
  await expect(page.getByText('Nội dung Slack fixture M2 · '+connections[1].workspaceId,{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`slack-read-${width}-${theme}.png`),fullPage:true});
  const ts=String(Math.floor(Date.now()/1000)),raw=JSON.stringify({type:'event_callback',api_app_id:'A_FIXTURE',team_id:connections[1].workspaceId,event_id:'EvM2_'+randomUUID().replaceAll('-',''),event_time:Number(ts),event:{type:'message',subtype:'message_deleted',channel:'C_FIXTURE',deleted_ts:'1730000000.000001',event_ts:ts+'.000001'}});
  const signature='v0='+createHmac('sha256',process.env.SLACK_SIGNING_SECRET!).update('v0:'+ts+':'+raw).digest('hex');
  const ack=await page.request.post('/api/slack/events',{headers:{'content-type':'application/json','x-slack-request-timestamp':ts,'x-slack-signature':signature},data:raw});expect(ack.status()).toBe(200);
  await expect(page.getByText('Nội dung Slack fixture M2 · '+connections[1].workspaceId,{exact:true})).toHaveCount(0,{timeout:15000});
 });
}
