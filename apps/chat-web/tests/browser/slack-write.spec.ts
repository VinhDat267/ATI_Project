import {test,expect} from '@playwright/test';
import pg from 'pg';
import {SlackConsentRepo} from '../../../chat-api/src/db/repositories/slack-consent-repo.js';
import {resolveRuntimeProviderIdentity} from '../../../chat-api/src/config/slack-policy-runtime.js';
for(const width of [375,1440])for(const theme of ['light','dark']){
 test(`SLACK-M3: explicit approved post and UNKNOWN reconciliation ${width} ${theme}`,async({page},info)=>{
  test.setTimeout(90000);await page.setViewportSize({width,height:900});await page.addInitScript(t=>localStorage.setItem('ati-theme',t),theme);
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
  await page.getByRole('button',{name:'Gửi tin Slack',exact:true}).click();
  const section=page.getByRole('region',{name:'Gửi tin Slack'}),select=section.getByLabel('Workspace Slack');await expect(select).toHaveValue('');await select.selectOption(connections[1].id);await page.getByLabel('Mã kênh Slack').fill('C_FIXTURE');
  const field=page.getByLabel('Mô tả công việc bạn muốn thực hiện');await field.fill('Nội dung gửi nguyên văn M3');const statsURL=new URL('/__stats',process.env.MYSLACK_API_BASE_URL).href;
  const before=(await(await page.request.get(statsURL)).json()).posts;await page.getByRole('button',{name:'Gửi yêu cầu',exact:true}).click();await expect(page.getByRole('button',{name:/Duyệt/}).first()).toBeVisible();expect((await(await page.request.get(statsURL)).json()).posts).toBe(before);
  await expect(page.locator('#plan-cards-container').getByText('Nội dung gửi nguyên văn M3',{exact:true})).toBeVisible();await expect(page.locator('#moment-4 p').filter({hasText:connections[1].workspaceName})).toBeVisible();await page.getByRole('button',{name:/Duyệt/}).first().click();await expect(page.getByText('Đã xác nhận gửi trên Slack',{exact:true}).first()).toBeVisible();expect((await(await page.request.get(statsURL)).json()).posts).toBe(before+1);
  await page.screenshot({path:info.outputPath(`slack-post-${width}-${theme}.png`),fullPage:true});
  await page.getByRole('button',{name:'Nhờ việc khác',exact:true}).first().click();if(await page.getByRole('button',{name:'Gửi tin Slack',exact:true}).getAttribute('aria-pressed')!=='true')await page.getByRole('button',{name:'Gửi tin Slack',exact:true}).click();await page.getByRole('region',{name:'Gửi tin Slack'}).getByLabel('Workspace Slack').selectOption(connections[1].id);await page.getByLabel('Mã kênh Slack').fill('C_FIXTURE');await page.getByLabel('Mô tả công việc bạn muốn thực hiện').fill('FIXTURE_UNKNOWN_M3');await page.getByRole('button',{name:'Gửi yêu cầu',exact:true}).click();await page.getByRole('button',{name:/Duyệt/}).first().click();await expect(page.getByRole('button',{name:'Đối soát Slack',exact:true})).toBeVisible({timeout:20000});await page.reload();await page.getByRole('button',{name:'Đối soát Slack',exact:true}).click();await expect(page.getByText('Đã xác nhận gửi trên Slack',{exact:true}).first()).toBeVisible();expect((await(await page.request.get(statsURL)).json()).posts).toBe(before+2);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 });
}
