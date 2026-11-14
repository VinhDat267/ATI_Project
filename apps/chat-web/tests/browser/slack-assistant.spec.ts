import {test,expect} from '@playwright/test';
import pg from 'pg';
import {createHash, randomUUID} from 'node:crypto';
import {SlackConsentRepo} from '../../../chat-api/src/db/repositories/slack-consent-repo.js';
import {SlackPolicyService} from '../../../chat-api/src/services/slack/policy-service.js';
import {SlackAssistantRepo} from '../../../chat-api/src/db/repositories/slack-assistant-repo.js';
import {SlackAssistantArtifactRepo} from '../../../chat-api/src/db/repositories/slack-assistant-artifact-repo.js';
import {resolveRuntimeProviderIdentity} from '../../../chat-api/src/config/slack-policy-runtime.js';
import {encryptCredentials} from '../../../../packages/tool-adapters/src/crypto.js';
import {validateSlackPolicyReference} from '@wap/tool-schemas';

for(const width of [375,1440])for(const theme of ['light','dark']){
 test(`SLACK-M4: per-workspace modes, finite budget and unavailable background ${width} ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.addInitScript(value=>localStorage.setItem('ati-theme',value),theme);await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill(process.env.CHAT_ADMIN_EMAIL!);await page.getByLabel('Mật khẩu',{exact:true}).fill(process.env.CHAT_ADMIN_PASSWORD!);await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await expect(page.getByRole('heading',{level:1})).toHaveText('Hôm nay bạn muốn nhờ việc gì?');
  const token=await page.evaluate(()=>localStorage.getItem('wap_access_token')),headers={Authorization:'Bearer '+token};const prior=await(await page.request.get('/api/connections/myslack',{headers})).json();for(const row of prior.connections)await page.request.delete('/api/connections/myslack/'+row.id,{headers});
  await page.goto('/settings');for(let n=0;n<2;n++){await page.getByRole('button',{name:'Kết nối workspace Slack'}).click();await expect(page.getByRole('heading',{name:'Đã kết nối Slack'})).toBeVisible();await page.getByRole('button',{name:'Về Kết nối dịch vụ'}).click();await expect(page.locator('#myslack li')).toHaveCount(n+1);}
  const rows=await(await page.request.get('/api/connections/myslack',{headers})).json();
  for(let n=0;n<2;n++){
   const connection=rows.connections[n],card=page.locator('#myslack li').filter({has:page.getByRole('heading',{name:connection.workspaceName,exact:true})});await card.getByRole('button',{name:'Tự động hóa '+connection.workspaceName,exact:true}).click();await expect(card.getByRole('combobox',{name:'Chế độ',exact:true})).toHaveValue('hybrid');await expect(card.getByRole('combobox',{name:'Chế độ',exact:true}).locator('option')).toHaveCount(3);await expect(card.getByLabel('Tự động tạo đề xuất',{exact:true})).toBeDisabled();await expect(card.getByText(/Tự động hóa chưa khả dụng/)).toBeVisible();
   await card.getByRole('combobox',{name:'Chế độ',exact:true}).selectOption(n===0?'rules':'ai');await card.getByLabel('Số lượt AI mỗi ngày',{exact:true}).fill(String(10+n));await card.getByRole('button',{name:'Lưu tự động hóa',exact:true}).click();await expect(card.getByText('Đã lưu tự động hóa cho workspace này.',{exact:true})).toBeVisible();
   const stored=await(await page.request.get('/api/connections/myslack/'+connection.id+'/assistant',{headers})).json();expect(stored.config.mode).toBe(n===0?'rules':'ai');expect(stored.config.budget.dailyCalls).toBe(10+n);expect(stored.config.enabled).toBe(false);
   await card.getByLabel('Số lượt AI mỗi ngày',{exact:true}).fill('0');await card.getByRole('button',{name:'Lưu tự động hóa',exact:true}).click();await expect(card.getByRole('alert')).toContainText('giới hạn dương');await card.getByRole('button',{name:'Tải lại cấu hình',exact:true}).click();await expect(card.getByLabel('Số lượt AI mỗi ngày',{exact:true})).toHaveValue(String(10+n));
   await expect(card.getByText(/UTC/)).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`slack-modes-${n}-${width}-${theme}.png`),fullPage:true});await card.getByRole('button',{name:'Tự động hóa '+connection.workspaceName,exact:true}).click();
  }
 });
}

test('SLACK-M4: multi-service targets, URL thread parser, directory picker and Proposal Inbox (/inbox) workflow', async ({ page }, info) => {
 test.setTimeout(90000);
 await page.setViewportSize({ width: 1440, height: 900 });
 await page.addInitScript(value => localStorage.setItem('ati-theme', value), 'light');
 await page.goto('/login');
 await page.getByLabel('Email', { exact: true }).fill(process.env.CHAT_ADMIN_EMAIL!);
 await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.CHAT_ADMIN_PASSWORD!);
 await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
 await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hôm nay bạn muốn nhờ việc gì?');

 const token = await page.evaluate(() => localStorage.getItem('wap_access_token'));
 const headers = { Authorization: 'Bearer ' + token };
 const prior = await (await page.request.get('/api/connections/myslack', { headers })).json();
 for (const row of prior.connections) await page.request.delete('/api/connections/myslack/' + row.id, { headers });

 await page.goto('/settings');
 await page.getByRole('button', { name: 'Kết nối workspace Slack' }).click();
 await expect(page.getByRole('heading', { name: 'Đã kết nối Slack' })).toBeVisible();
 await page.getByRole('button', { name: 'Về Kết nối dịch vụ' }).click();
 await expect(page.locator('#myslack li')).toHaveCount(1);

 const rows = await (await page.request.get('/api/connections/myslack', { headers })).json();
 const connection = rows.connections[0];
 const card = page.locator('#myslack li').first();

 // 1. Verify F1 Consent guidance box and "Kiểm tra kết nối" button
 await expect(card.getByText(/F1 Consent/)).toBeVisible();
 await card.getByRole('button', { name: 'Kiểm tra kết nối ' + connection.workspaceName, exact: true }).click();
 await expect(page.locator('#myslack [role=status]')).toContainText('đang hoạt động nhưng vẫn chờ cấp quyền xử lý dữ liệu');

 // 2. Open Automation Settings, configure multi-service targets, and parse Slack URL
 await card.getByRole('button', { name: 'Tự động hóa ' + connection.workspaceName, exact: true }).click();
 await card.getByText('Đích dịch vụ mặc định cho đề xuất', { exact: true }).click();
 await card.getByLabel('ID danh sách Trello (List ID)', { exact: true }).fill('list-sprint-10');
 await card.getByLabel('Mã dự án Jira (Project Key)', { exact: true }).fill('OPS');
 await card.getByLabel('Kho mã nguồn GitHub (owner/repo)', { exact: true }).fill('acme/platform');
 await card.getByLabel('Email người nhận Gmail mặc định', { exact: true }).fill('ops@acme.vn');
 await card.getByLabel('Mặc định phản hồi kết quả vào thread Slack nguồn', { exact: true }).check();
 await card.getByRole('button', { name: 'Lưu tự động hóa', exact: true }).click();
 await expect(card.getByText('Đã lưu tự động hóa cho workspace này.', { exact: true })).toBeVisible();

 const stored = await (await page.request.get('/api/connections/myslack/' + connection.id + '/assistant', { headers })).json();
 expect(stored.config.targets).toEqual({
  trello: { boardId: 'default', listId: 'list-sprint-10' },
  jira: { projectKey: 'OPS' },
  github: { repo: 'acme/platform' },
  gmail: { to: 'ops@acme.vn' },
  replyToSource: true,
 });

 // Paste Slack message URL -> auto-fills Channel ID & Thread Timestamp
 await card.getByLabel('Dán liên kết tin nhắn Slack', { exact: true }).fill('https://acme.slack.com/archives/C0123ABC/p1730000000000100');
 await expect(card.getByLabel('ID kênh', { exact: true })).toHaveValue('C0123ABC');
 await expect(card.getByLabel('Timestamp gốc của thread', { exact: true })).toHaveValue('1730000000.000100');
 await card.getByRole('button', { name: 'Theo dõi thread', exact: true }).click();
 await expect(card.getByText('Đã theo dõi các sự kiện mới trong thread.', { exact: true })).toBeVisible();

 // 3. Grant F1 Consent, test Directory Picker, and seed a proposal for /inbox
 const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
 const consentRepo = new SlackConsentRepo(pool);
 const identity = resolveRuntimeProviderIdentity(process.env);
 try {
  const existingProvider = (await pool.query('SELECT id FROM slack_trusted_providers WHERE id=$1', [identity.providerId])).rows[0];
  if (!existingProvider) {
   await consentRepo.attestProvider({
    id: identity.providerId,
    name: identity.name,
    verified: true,
    noTraining: true,
    maxRetentionDays: 30,
    configurationFingerprint: identity.fingerprint,
    evidenceRef: 'BROWSER_FIXTURE',
    verifiedBy: 'fixture',
    verifiedAt: new Date(),
   });
  }
  const prevConsent = await consentRepo.getConsent(connection.workspaceId, identity.providerId);
  await consentRepo.grantConsent({
   workspaceId: connection.workspaceId,
   providerId: identity.providerId,
   ...(prevConsent ? { expectedRevision: prevConsent.revision } : {}),
   policyVersion: 'v1.0.0',
   purposes: ['manual_lookup', 'triage', 'planning', 'storage', 'digest'],
   retentionDays: 7,
   organizationRepresentative: 'fixture',
   evidenceRef: 'BROWSER_FIXTURE',
   recordedBy: 'fixture',
  });

  // Load directory on demand in Settings
  await card.getByRole('button', { name: 'Tải danh bạ kênh & thành viên Slack', exact: true }).click();
  await expect(card.getByText('Đã tải 1 kênh · 1 thành viên', { exact: true })).toBeVisible();
  await card.getByLabel('Chọn kênh từ danh bạ Slack', { exact: true }).selectOption('C_FIXTURE');
  await expect(card.getByLabel('ID kênh', { exact: true })).toHaveValue('C_FIXTURE');

  // Seed a proposal into PostgreSQL for this workspace
  const policyService = new SlackPolicyService(pool, { env: process.env });
  const artifacts = new SlackAssistantArtifactRepo(pool, policyService);
  const assistantRepo = new SlackAssistantRepo(pool, policyService, { appId: 'A_FIXTURE', automationEnabled: true }, artifacts);
  const connRow = (await pool.query('SELECT * FROM slack_connections WHERE id=$1', [connection.id])).rows[0];
  const binding = {
   atiUserId: connRow.user_id,
   connectionId: connRow.id,
   workspaceId: connRow.workspace_id,
   slackUserId: connRow.actor_id,
   identityVersion: connRow.identity_version,
  };
  const triageDecision = await policyService.resolveSlackModelPolicy({ binding, purpose: 'triage', requestedRetentionDays: 0 });
  const storageDecision = await policyService.resolveSlackModelPolicy({ binding, purpose: 'storage', requestedRetentionDays: 1 });
  if (!triageDecision.allowed || !storageDecision.allowed) throw new Error('Expected allowed policy decision');
  const acqRef = validateSlackPolicyReference(triageDecision.policyReference);
  const storageRef = validateSlackPolicyReference(storageDecision.policyReference);
  const currentCfg = await assistantRepo.getConfig(connRow.user_id, connRow.id);
  const ts = '1730000000.000100';
  const text = '<@U_FIXTURE> kiểm tra lỗi memory leak trên dịch vụ thanh toán và tạo issue';
  const decision: any = {
   kind: 'proposal',
   title: 'Xử lý lỗi memory leak dịch vụ thanh toán',
   rationale: 'Được nhắc trực tiếp trong kênh kỹ thuật',
   sourceIndices: [0],
   relevance: { kind: 'mention', sourceIndex: 0, evidence: '<@U_FIXTURE>' },
   intents: [{ action: 'task', service: 'trello', summary: 'Kiểm tra và khắc phục lỗi memory leak' }],
  };
  const lease: any = {
   binding,
   config: currentCfg.config,
   configVersion: currentCfg.configVersion,
   triggers: [{ channelId: 'C_FIXTURE', messageTs: ts, threadTs: ts }],
  };
  const client = await pool.connect();
  try {
   await client.query('BEGIN');
   await artifacts.prepareProposalInTransaction(client, lease, decision, [
    { channelId: 'C_FIXTURE', ts, threadTs: ts, user: 'U_LEAD', text, conversationType: 'public' },
   ]);
   await artifacts.publishProposalInTransaction(
    client,
    lease,
    decision,
    [
     {
      sourceRef: {
       binding,
       resourceType: 'message',
       resourceId: JSON.stringify(['C_FIXTURE', ts]),
       revision: ts,
      },
      acquisitionPolicyRef: acqRef,
      storagePolicyRef: storageRef,
      captureHash: createHash('sha256').update(text).digest('hex'),
      capturedAt: new Date().toISOString(),
      channelId: 'C_FIXTURE',
     },
    ],
    [{ channelId: 'C_FIXTURE', ts, threadTs: ts, user: 'U_LEAD', text, conversationType: 'public' }],
    false,
   );
   await client.query('COMMIT');
  } finally {
   client.release();
  }
  const encryptionKey = process.env.ENCRYPTION_KEY || '01234567890123456789012345678901';
  const encryptedGithubCred = encryptCredentials(
   { refreshToken: 'synthetic-refresh', accessToken: 'synthetic-access', githubUserId: 'G_FIXTURE', login: 'fixture_octo' },
   encryptionKey,
  );
  const scopeId = `personal:${connRow.user_id}`;
  await pool.query("DELETE FROM service_credentials WHERE service = 'github' AND user_id = $1 AND workspace_id IS NULL", [connRow.user_id]);
  await pool.query(
   "INSERT INTO service_credentials(id, service, user_id, workspace_id, config, status) VALUES($1, 'github', $2, NULL, $3, 'active')",
   [randomUUID(), connRow.user_id, encryptedGithubCred],
  );
  await pool.query('DELETE FROM github_team_repos WHERE scope_id = $1', [scopeId]);
  await pool.query(
   `INSERT INTO github_team_scope(id, chosen_by, updated_at) VALUES($1, $2, now())
    ON CONFLICT (id) DO UPDATE SET chosen_by = EXCLUDED.chosen_by, updated_at = now()`,
   [scopeId, connRow.user_id],
  );
  await pool.query(
   `INSERT INTO github_team_repos(scope_id, repo_id, full_name, name, position)
    VALUES ($1, 'R_PLATFORM', 'acme/platform', 'platform', 1),
           ($1, 'R_PAYMENT', 'acme/payment-service', 'payment-service', 2)`,
   [scopeId],
  );
 } finally {
  await pool.end();
 }

 // 4. Navigate to /inbox via "Mở hộp thư đề xuất" and verify KPI, Filter, Search, and Target Override
 await card.getByRole('link', { name: 'Mở hộp thư đề xuất' }).first().click();
 await expect(page).toHaveURL(/\/inbox$/);
 await expect(page.getByRole('heading', { name: 'Hộp thư đề xuất & Bản tóm tắt' })).toBeVisible();
 await expect(page.getByLabel('Thống kê đề xuất')).toBeVisible();
 await expect(page.locator('[data-inbox-badge-count]')).toHaveText('1');
 await expect(page.getByText('Xử lý lỗi memory leak dịch vụ thanh toán')).toBeVisible();

 // Override destination service on the proposal card to GitHub and preview plan
 await page.getByText('Đổi dịch vụ đích hoặc điền tham số đích cho đề xuất này').click();
 await page.getByLabel('Dịch vụ đích ghi đè').selectOption('github');
 await page.getByPlaceholder('Ví dụ: acme/platform').fill('acme/payment-service');
 await page.getByRole('button', { name: 'Xem trước kế hoạch', exact: true }).click();

 await expect(page.getByText('Kiểm tra và tạo GitHub Issue: Xử lý lỗi memory leak dịch vụ thanh toán')).toBeVisible();
 await expect(page.getByText('Tra cứu GitHub Issue hiện có trước khi tạo mới')).toBeVisible();
 await expect(page.getByText('Tạo GitHub Issue mới sau khi kiểm tra trùng lặp')).toBeVisible();
 await expect(page.getByText('Phản hồi kết quả đã duyệt vào luồng Slack nguồn')).toBeVisible();
 await expect(page.getByRole('button', { name: 'Phê duyệt và thực thi', exact: true })).toBeVisible();
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
 await page.evaluate(() => window.scrollTo(0, 0));
 await page.screenshot({ path: info.outputPath('slack-inbox-1440-light.png'), fullPage: true });
});
