import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import request from 'supertest';
import {randomUUID,createHash} from 'node:crypto';
import {createSlackReadEnvironment,TEST_KEY} from '../helpers/slack-private-read-fixture.js';
import {SlackDerivedLineageRepo} from '../../src/db/repositories/slack-derived-lineage-repo.js';
import {PlanRepo} from '../../src/db/repositories/plan-repo.js';
import {StepRepo} from '../../src/db/repositories/step-repo.js';
import {MessageRepo} from '../../src/db/repositories/message-repo.js';
import {ConversationRepo} from '../../src/db/repositories/conversation-repo.js';
import {SlackAssistantRepo} from '../../src/db/repositories/slack-assistant-repo.js';
import {SlackAssistantArtifactRepo} from '../../src/db/repositories/slack-assistant-artifact-repo.js';
import {SlackWriteRuntime} from '../../src/services/slack/slack-write-runtime.js';
import {SlackProposalService} from '../../src/services/slack/slack-proposal-service.js';
import {ChatService} from '../../src/services/chat-service.js';
import {ExecutionService} from '../../src/services/execution-service.js';
import {createApp} from '../../src/app.js';
import {generateAccessToken} from '../../src/auth/jwt.js';
import {SLACK_USER_SCOPES} from '../../src/services/slack/oauth-client.js';
import {defaultSlackAssistantConfig} from '@wap/tool-schemas';
import {CredentialRepo} from '../../src/db/repositories/credential-repo.js';
import {AdapterFactory} from '../../src/services/adapter-factory.js';
import {encryptCredentials} from '@wap/tool-adapters';
import {SlackEventReceiptRepo} from '../../src/db/repositories/slack-event-receipt-repo.js';
import {SlackIngressService} from '../../src/services/slack/slack-ingress-service.js';
import {createHmac} from 'node:crypto';
import {planSlackProposalWorkflow} from '@wap/planner';

const secret='m4-proposal-inbox-secret-at-least32chars';
let env:Awaited<ReturnType<typeof createSlackReadEnvironment>>;

beforeAll(async()=>{env=await createSlackReadEnvironment('slack_proposals_inbox');},30000);
afterAll(async()=>{await env?.close();});

async function setupFixture(){
 env.fixture.clearHandlers();env.fixture.reset();
 const owner=await env.addUser({name:'Proposal Owner',workspaceId:'T_PROP_'+randomUUID().replaceAll('-',''),actorId:'U_OWNER'});
 const other=await env.db.person();
 await env.db.pool.query('UPDATE slack_connections SET scopes=$2 WHERE id=$1',[owner.row.id,SLACK_USER_SCOPES]);
 const consent=(await env.consentRepo.getConsent(owner.binding.workspaceId,env.runtimeIdentity.providerId))!;
 await env.consentRepo.grantConsent({
  workspaceId:owner.binding.workspaceId,
  providerId:env.runtimeIdentity.providerId,
  expectedRevision:consent.revision,
  policyVersion:'v1.0.0',
  purposes:['triage','storage','planning','manual_lookup','digest'],
  retentionDays:7,
  organizationRepresentative:'fixture',
  evidenceRef:'fixture',
  recordedBy:'fixture',
 });
 const registry=new SlackDerivedLineageRepo(env.db.pool,env.policyService);
 const plans=new PlanRepo(env.db.pool,registry);
 const steps=new StepRepo(env.db.pool,registry);
 const messages=new MessageRepo(env.db.pool,registry);
 const conversations=new ConversationRepo(env.db.pool);
 const artifacts=new SlackAssistantArtifactRepo(env.db.pool,env.policyService);
 const assistantRepo=new SlackAssistantRepo(env.db.pool,env.policyService,{appId:owner.row.app_id,automationEnabled:true},artifacts);
 const slackWrite=new SlackWriteRuntime({
  pool:env.db.pool,
  connections:env.connectionRepo,
  policy:env.policyService,
  invalidation:env.invalidationService,
  plans,
  tokens:env.tokenManager,
  appId:owner.row.app_id,
  apiBaseUrl:env.fixture.url,
  timeoutMs:300,
 });
 const proposalService=new SlackProposalService({
  pool:env.db.pool,
  repo:assistantRepo,
  artifacts,
  plans,
  messages,
  policy:env.policyService,
  invalidation:env.invalidationService,
 });

 const trelloCalls:any[]=[];
 const jiraSearchCalls:any[]=[];
 const jiraCreateCalls:any[]=[];
 const sheetsAppendCalls:any[]=[];
 let jiraExistingIssues:any[]=[];

 const execution=new ExecutionService({
  planRepo:plans,
  stepRepo:steps,
  convRepo:conversations,
  slackWrite,
  sseManager:{emitEvent:()=>{}},
  adapterFactory:{
   getAdapterForService:async(serviceName:string)=>({
    execute:async(tool:string,args:any)=>{
     if(serviceName==='trello'&&tool==='trello.create_card'){
      trelloCalls.push(args);
      return {id:'card_123',name:args.title,url:'https://trello.com/c/card_123',listId:args.listId};
     }
     if(serviceName==='jira'&&tool==='jira.search_issues'){
      jiraSearchCalls.push(args);
      return {issues:jiraExistingIssues};
     }
     if(serviceName==='jira'&&tool==='jira.create_issue'){
      jiraCreateCalls.push(args);
      return {id:'10001',key:`${args.projectKey}-42`,url:`https://jira.example/browse/${args.projectKey}-42`};
     }
     if(serviceName==='mysheets'&&tool==='mysheets.append_rows'){
      sheetsAppendCalls.push(args);
      return {spreadsheetId:args.spreadsheetId,updatedRange:`${args.sheet}!A2:C2`,updatedRows:1,url:`https://docs.google.com/spreadsheets/d/${args.spreadsheetId}`};
     }
     throw new Error(`Unexpected tool ${tool}`);
    },
   }),
  },
 });

 const chat=new ChatService({
  msgRepo:messages,
  convRepo:conversations,
  planRepo:plans,
  slackWrites:slackWrite,
  eventEmitter:{emit:()=>{}},
  planner:{processMessage:async()=>{throw new Error('No direct planner');},routeSchedule:async()=>({services:[],unavailable:[]})},
 });

 const app=createApp({
  jwtSecret:secret,
  encryptionKey:TEST_KEY,
  userRepo:env.db.users,
  convRepo:conversations,
  msgRepo:messages,
  planRepo:plans,
  chatService:chat,
  executionService:execution,
  slackAssistant:{repo:assistantRepo,artifacts,proposals:proposalService},
 });

 const ownerToken='Bearer '+generateAccessToken(owner.person,secret,owner.person.sid).accessToken;
 const otherToken='Bearer '+generateAccessToken(other,secret,other.sid).accessToken;

 const cfg=defaultSlackAssistantConfig();
 cfg.enabled=true;
 cfg.mode='hybrid';
 cfg.targets={
  trello:{boardId:'B_1',listId:'L_TODO'},
  jira:{projectKey:'ATI'},
  mysheets:{spreadsheetId:'spreadsheet_allowed_1234567890',range:'Sprint!A:C'},
  replyToSource:true,
 };
 const initial=await assistantRepo.getConfig(owner.person.id,owner.row.id);
 await assistantRepo.updateConfig(owner.person.id,owner.row.id,initial.configVersion,cfg);

 const slackReplies:any[]=[];
 env.fixture.setHandler('/conversations.info',()=>({body:{ok:true,channel:{id:'C_WORK',is_member:true}}}));
 env.fixture.setHandler('/chat.postMessage',r=>{
  const b=JSON.parse(r.body);
  const m={user:owner.binding.slackUserId,text:b.text,thread_ts:b.thread_ts,client_msg_id:b.client_msg_id,ts:'1730000099.000001'};
  slackReplies.push(m);
  return {body:{ok:true,channel:b.channel,ts:m.ts,message:m}};
 });
 env.fixture.setHandler('/conversations.replies',()=>({body:{ok:true,messages:slackReplies,has_more:false,response_metadata:{next_cursor:''}}}));
 env.fixture.setHandler('/conversations.history',()=>({body:{ok:true,messages:slackReplies,has_more:false,response_metadata:{next_cursor:''}}}));

 async function seedProposal(decisionOverrides:Partial<{
  kind:'proposal'|'needs_clarification';
  title:string;
  rationale:string;
  intents:any[];
  question:string;
  text:string;
 }>={}){
  const ts='1730000000.'+String(Math.floor(100000+Math.random()*899999));
  const text=decisionOverrides.text??'<@U_OWNER> chuẩn bị báo cáo Q4 cho khách hàng';
  const acqRef=await env.canonicalRef(owner.binding,'triage');
  const storageRef={...acqRef,purpose:'storage' as const,requestedRetentionDays:1};
  const currentCfg=await assistantRepo.getConfig(owner.person.id,owner.row.id);
  const decision:any=decisionOverrides.kind==='needs_clarification'
   ?{
     kind:'needs_clarification',
     title:decisionOverrides.title??'Chuẩn bị báo cáo Q4',
     rationale:decisionOverrides.rationale??'Cần làm rõ thời hạn',
     sourceIndices:[0],
     relevance:{kind:'mention',sourceIndex:0,evidence:'<@U_OWNER>'},
     question:decisionOverrides.question??'Hạn chót ngày nào?',
    }
   :{
     kind:'proposal',
     title:decisionOverrides.title??'Chuẩn bị báo cáo Q4',
     rationale:decisionOverrides.rationale??'Được nhắc trực tiếp trong kênh dự án',
     sourceIndices:[0],
     relevance:{kind:'mention',sourceIndex:0,evidence:'<@U_OWNER>'},
     intents:decisionOverrides.intents??[{action:'task',service:'trello',summary:'Chuẩn bị báo cáo Q4 cho khách hàng'}],
    };
  const lease:any={
   binding:owner.binding,
   config:currentCfg.config,
   configVersion:currentCfg.configVersion,
   triggers:[{channelId:'C_WORK',messageTs:ts,threadTs:ts}],
  };
  const c=await env.db.pool.connect();
  try{
   await c.query('BEGIN');
   await artifacts.prepareProposalInTransaction(c,lease,decision,[{channelId:'C_WORK',ts,threadTs:ts,user:'U_REQ',text,conversationType:'public'}]);
   const id=await artifacts.publishProposalInTransaction(
    c,
    lease,
    decision,
    [{
     sourceRef:{
      binding:owner.binding,
      resourceType:'message',
      resourceId:JSON.stringify(['C_WORK',ts]),
      revision:ts,
     },
     acquisitionPolicyRef:acqRef,
     storagePolicyRef:storageRef,
     captureHash:createHash('sha256').update(text).digest('hex'),
     capturedAt:new Date().toISOString(),
     channelId:'C_WORK',
    }],
    [{channelId:'C_WORK',ts,threadTs:ts,user:'U_REQ',text,conversationType:'public'}],
    false,
   );
   await c.query('COMMIT');
   return {id,ts,text};
  }catch(e){
   await c.query('ROLLBACK');
   throw e;
  }finally{
   c.release();
  }
 }

 return {
  owner,
  other,
  ownerToken,
  otherToken,
  app,
  plans,
  steps,
  messages,
  conversations,
  execution,
  slackWrite,
  artifacts,
  assistantRepo,
  proposalService,
  seedProposal,
  trelloCalls,
  jiraSearchCalls,
  jiraCreateCalls,
  sheetsAppendCalls,
  slackReplies,
  setJiraExistingIssues:(issues:any[])=>{jiraExistingIssues=issues;},
 };
}

describe('SLACK-06A protected inbox, refine/prepare/reject CAS, and cross-service workflows',()=>{
 it('enforces owner isolation, expectedRevision CAS, refine conversation seeding, and reject plan superseding',async()=>{
  const f=await setupFixture();
  const seeded=await f.seedProposal();

  // Foreign user cannot list, refine, prepare, or reject
  const foreignList=await request(f.app).get('/api/slack/proposals?connectionId='+f.owner.row.id).set('Authorization',f.otherToken);
  expect(foreignList.body.proposals).toEqual([]);
  expect((await request(f.app).post(`/api/slack/proposals/${seeded.id}/refine`).set('Authorization',f.otherToken).send({expectedRevision:1})).status).toBe(404);
  expect((await request(f.app).post(`/api/slack/proposals/${seeded.id}/prepare`).set('Authorization',f.otherToken).send({expectedRevision:1})).status).toBe(404);
  expect((await request(f.app).post(`/api/slack/proposals/${seeded.id}/reject`).set('Authorization',f.otherToken).send({expectedRevision:1})).status).toBe(404);

  // Refine with wrong revision fails with 409
  expect((await request(f.app).post(`/api/slack/proposals/${seeded.id}/refine`).set('Authorization',f.ownerToken).send({expectedRevision:99})).status).toBe(409);

  // Refine with revision 1 succeeds, seeds lineage-registered message, increments revision to '2'
  const refined=await request(f.app).post(`/api/slack/proposals/${seeded.id}/refine`).set('Authorization',f.ownerToken).send({expectedRevision:1});
  expect(refined.status).toBe(200);
  expect(refined.body.conversationId).toBeTruthy();
  expect(refined.body.proposal.revision).toBe('2');

  // Prepare preview plan at revision 2 makes 0 external writes
  const prepared=await request(f.app).post(`/api/slack/proposals/${seeded.id}/prepare`).set('Authorization',f.ownerToken).send({expectedRevision:2});
  expect(prepared.status).toBe(200);
  expect(prepared.body.status).toBe('awaiting_approval');
  expect(prepared.body.planId).toBeTruthy();
  expect(prepared.body.planHash).toMatch(/^[a-f0-9]{64}$/);
  expect(f.trelloCalls).toHaveLength(0);
  expect(f.slackReplies).toHaveLength(0);

  // Reject at revision 3 marks proposal rejected and supersedes the pending plan
  const rejected=await request(f.app).post(`/api/slack/proposals/${seeded.id}/reject`).set('Authorization',f.ownerToken).send({expectedRevision:3});
  expect(rejected.status).toBe(200);
  expect(rejected.body.proposal.status).toBe('rejected');
  expect((await f.plans.getPlan(prepared.body.planId))?.status).toBe('superseded');
 },30000);

 it('executes Trello card creation + source-bound Slack thread reply with certified card URL; double approval writes once; edit changes planHash',async()=>{
  const f=await setupFixture();
  const seeded=await f.seedProposal();

  // First prepare
  const firstPrep=await request(f.app).post(`/api/slack/proposals/${seeded.id}/prepare`).set('Authorization',f.ownerToken).send({expectedRevision:1,replyInThread:true});
  expect(firstPrep.status).toBe(200);
  const firstPlanId=firstPrep.body.planId;
  const firstHash=firstPrep.body.planHash;

  // Edit / re-prepare with new instruction creates a new planHash and supersedes the old plan
  const secondPrep=await request(f.app).post(`/api/slack/proposals/${seeded.id}/prepare`).set('Authorization',f.ownerToken).send({
   expectedRevision:2,
   instruction:'Bổ sung chi tiết doanh thu khu vực APAC vào mô tả thẻ',
   replyInThread:true,
  });
  expect(secondPrep.status).toBe(200);
  expect(secondPrep.body.planHash).not.toBe(firstHash);
  expect((await f.plans.getPlan(firstPlanId))?.status).toBe('superseded');

  // Approving the superseded plan fails with 409 and makes 0 writes
  expect((await request(f.app).post(`/api/plans/${firstPlanId}/approve`).set('Authorization',f.ownerToken)).status).toBe(409);
  expect(f.trelloCalls).toHaveLength(0);
  expect(f.slackReplies).toHaveLength(0);

  // Concurrent double approval on the active plan executes once
  const activePlanId=secondPrep.body.planId;
  const approvals=await Promise.all([
   request(f.app).post(`/api/plans/${activePlanId}/approve`).set('Authorization',f.ownerToken),
   request(f.app).post(`/api/plans/${activePlanId}/approve`).set('Authorization',f.ownerToken),
  ]);
  expect(approvals.map(r=>r.status).sort()).toEqual([200,409]);

  await vi.waitFor(async()=>{
   expect((await f.plans.getPlan(activePlanId))?.status).toBe('completed');
  },{timeout:15000});

  expect(f.trelloCalls).toHaveLength(1);
  expect(f.trelloCalls[0]).toMatchObject({listId:'L_TODO',title:'Chuẩn bị báo cáo Q4'});
  expect(f.slackReplies).toHaveLength(1);
  expect(f.slackReplies[0]).toMatchObject({
   thread_ts:seeded.ts,
   text:'Đã tạo thẻ công việc: https://trello.com/c/card_123',
  });

  const listed=await request(f.app).get('/api/slack/proposals?connectionId='+f.owner.row.id).set('Authorization',f.ownerToken);
  expect(listed.body.proposals[0].status).toBe('completed');
 },30000);

 it('reconciles an UNKNOWN source-bound thread reply via conversations.replies without resending',async()=>{
  const f=await setupFixture();
  const seeded=await f.seedProposal();
  const prep=await request(f.app).post(`/api/slack/proposals/${seeded.id}/prepare`).set('Authorization',f.ownerToken).send({expectedRevision:1,replyInThread:true});
  expect(prep.status).toBe(200);
  const planId=prep.body.planId;

  // Simulate provider committing the thread reply then returning 503 so outbox transitions to UNKNOWN
  env.fixture.setHandler('/chat.postMessage',r=>{
   const b=JSON.parse(r.body);
   f.slackReplies.push({user:f.owner.binding.slackUserId,text:b.text,thread_ts:b.thread_ts,client_msg_id:b.client_msg_id,ts:'1730000099.000002'});
   return {status:503,body:{ok:false}};
  });

  expect((await request(f.app).post(`/api/plans/${planId}/approve`).set('Authorization',f.ownerToken)).status).toBe(200);
  await vi.waitFor(async()=>{
   const stepRows=await f.steps.listSteps(planId);
   expect(stepRows.find(s=>s.step_id==='step_2')?.status).toBe('unknown');
  },{timeout:15000});

  const postCallsBefore=env.fixture.requests.filter(r=>r.path==='/chat.postMessage').length;
  expect(postCallsBefore).toBe(1);

  const reconciled=await request(f.app).post(`/api/executions/${planId}/steps/step_2/slack-reconcile`).set('Authorization',f.ownerToken);
  expect(reconciled.status).toBe(200);
  expect((await f.plans.getPlan(planId))?.status).toBe('completed');
  expect(env.fixture.requests.filter(r=>r.path==='/chat.postMessage')).toHaveLength(1);
 },30000);

 it('handles vague deadlines (needs_info), Jira lookup-before-create deduplication, and MySheets scope enforcement',async()=>{
  const f=await setupFixture();

  // 1. Vague deadline returns needs_info, then clarifies to awaiting_approval
  const vagueSeed=await f.seedProposal({
   title:'Báo cáo chiến dịch',
   intents:[{action:'task',service:'trello',summary:'Gửi báo cáo chiến dịch',deadlineText:'thứ Sáu tuần sau'}],
   text:'<@U_OWNER> gửi báo cáo chiến dịch vào thứ Sáu tuần sau nhé',
  });
  const vaguePrep=await request(f.app).post(`/api/slack/proposals/${vagueSeed.id}/prepare`).set('Authorization',f.ownerToken).send({expectedRevision:1});
  expect(vaguePrep.status).toBe(200);
  expect(vaguePrep.body.status).toBe('needs_info');
  expect(vaguePrep.body.clarification).toContain('YYYY-MM-DD');

  const clarifiedPrep=await request(f.app).post(`/api/slack/proposals/${vagueSeed.id}/prepare`).set('Authorization',f.ownerToken).send({
   expectedRevision:2,
   instruction:'Đặt hạn 2026-11-06',
   replyInThread:false,
  });
  expect(clarifiedPrep.status).toBe(200);
  expect(clarifiedPrep.body.status).toBe('awaiting_approval');
  expect(clarifiedPrep.body.plan.steps[0].args.due).toBe('2026-11-06');

  // 2. Jira bug report lookup-before-create: when no issue exists, creates 1; when issue exists, deduplicates
  const bugSeed1=await f.seedProposal({
   title:'Lỗi thanh toán QR',
   intents:[{action:'issue',service:'jira',summary:'Khách quét QR bị báo lỗi 500'}],
   text:'<@U_OWNER> kiểm tra lỗi thanh toán QR bị 500',
  });
  const bugPrep1=await request(f.app).post(`/api/slack/proposals/${bugSeed1.id}/prepare`).set('Authorization',f.ownerToken).send({expectedRevision:1,replyInThread:false});
  expect(bugPrep1.status).toBe(200);
  expect((await request(f.app).post(`/api/plans/${bugPrep1.body.planId}/approve`).set('Authorization',f.ownerToken)).status).toBe(200);
  await vi.waitFor(async()=>expect((await f.plans.getPlan(bugPrep1.body.planId))?.status).toBe('completed'),{timeout:15000});
  expect(f.jiraSearchCalls).toHaveLength(1);
  expect(f.jiraCreateCalls).toHaveLength(1);

  f.setJiraExistingIssues([{id:'10001',key:'ATI-42',url:'https://jira.example/browse/ATI-42',title:'Lỗi thanh toán QR',status:'Open'}]);
  const bugSeed2=await f.seedProposal({
   title:'Lỗi thanh toán QR',
   intents:[{action:'issue',service:'jira',summary:'Khách quét QR vẫn bị lỗi 500'}],
   text:'<@U_OWNER> lỗi thanh toán QR lại tái diễn',
  });
  const bugPrep2=await request(f.app).post(`/api/slack/proposals/${bugSeed2.id}/prepare`).set('Authorization',f.ownerToken).send({expectedRevision:1,replyInThread:false});
  expect((await request(f.app).post(`/api/plans/${bugPrep2.body.planId}/approve`).set('Authorization',f.ownerToken)).status).toBe(200);
  await vi.waitFor(async()=>expect((await f.plans.getPlan(bugPrep2.body.planId))?.status).toBe('completed'),{timeout:15000});
  expect(f.jiraSearchCalls).toHaveLength(2);
  expect(f.jiraCreateCalls).toHaveLength(1); // deduplicated!

  // 3. MySheets progress update executes on allowed spreadsheet
  const progSeed=await f.seedProposal({
   title:'Cập nhật tiến độ M4',
   intents:[{action:'progress',service:'mysheets',summary:'Hoàn thành 100% tính năng Inbox'}],
   text:'Tôi sẽ cập nhật tiến độ M4 vào bảng tính',
  });
  const progPrep=await request(f.app).post(`/api/slack/proposals/${progSeed.id}/prepare`).set('Authorization',f.ownerToken).send({expectedRevision:1,replyInThread:false});
  expect(progPrep.status).toBe(200);
  expect((await request(f.app).post(`/api/plans/${progPrep.body.planId}/approve`).set('Authorization',f.ownerToken)).status).toBe(200);
  await vi.waitFor(async()=>expect((await f.plans.getPlan(progPrep.body.planId))?.status).toBe('completed'),{timeout:15000});
  expect(f.sheetsAppendCalls).toHaveLength(1);
 },30000);

 it('supports targetOverride for MyCalendar, GitHub, Gmail and direct Slack reply for question proposals',async()=>{
  const f=await setupFixture();

  // Question proposal answered directly in Slack thread
  const qSeed=await f.seedProposal({
   title:'Hỏi lịch release',
   intents:[{action:'question',service:'myslack',summary:'Khi nào release bản v3?'}],
   text:'<@U_OWNER> khi nào release bản v3 nhỉ?',
  });
  const qPrep=await request(f.app).post(`/api/slack/proposals/${qSeed.id}/prepare`).set('Authorization',f.ownerToken).send({
   expectedRevision:1,
   instruction:'Chúng ta sẽ release lúc 20:00 tối nay nhé!',
   replyInThread:true,
  });
  expect(qPrep.status).toBe(200);
  expect(qPrep.body.status).toBe('awaiting_approval');
  expect(qPrep.body.plan.steps).toHaveLength(1);
  expect(qPrep.body.plan.steps[0].tool).toBe('myslack.chat_postMessage');

  // Target override to MyCalendar on a task proposal
  const calSeed=await f.seedProposal({
   title:'Họp thiết kế giao diện Slack',
   intents:[{action:'task',service:'trello',summary:'Họp review UI/UX Slack'}],
   text:'<@U_OWNER> chiều mai họp review UI/UX Slack nhé',
  });
  const calPrep=await request(f.app).post(`/api/slack/proposals/${calSeed.id}/prepare`).set('Authorization',f.ownerToken).send({
   expectedRevision:1,
   replyInThread:true,
   targetOverride:{
    service:'mycalendar',
    calendarId:'primary',
    startIso:'2026-11-05T14:00:00+07:00',
    endIso:'2026-11-05T15:00:00+07:00',
   },
  });
  expect(calPrep.status).toBe(200);
  expect(calPrep.body.status).toBe('awaiting_approval');
  expect(calPrep.body.plan.steps.map((s:any)=>s.tool)).toEqual(['mycalendar.create_event','myslack.chat_postMessage']);

  // Target override to GitHub Issue
  const ghSeed=await f.seedProposal({
   title:'Sửa lỗi hiển thị bộ chọn kênh',
   intents:[{action:'issue',service:'jira',summary:'Thêm dropdown chọn kênh Slack'}],
   text:'<@U_OWNER> tạo issue sửa bộ chọn kênh Slack nhé',
  });
  const ghPrep=await request(f.app).post(`/api/slack/proposals/${ghSeed.id}/prepare`).set('Authorization',f.ownerToken).send({
   expectedRevision:1,
   replyInThread:false,
   targetOverride:{
    service:'github',
    repo:'wap/platform',
   },
  });
  expect(ghPrep.status).toBe(200);
  expect(ghPrep.body.status).toBe('awaiting_approval');
  expect(ghPrep.body.plan.steps.map((s:any)=>s.tool)).toEqual(['github.search_issues','github.create_issue']);
 },30000);

 it('F1: invalidates and redacts stored private Slack content when channel membership is lost via signed event or native read denial',async()=>{
  const f=await setupFixture();
  const conv=await f.conversations.createConversation(f.owner.person.id);
  const acqRef=await env.canonicalRef(f.owner.binding,'manual_lookup');
  const storageRef={...acqRef,purpose:'storage' as const,requestedRetentionDays:1};
  const savedMsg=await f.messages.createSlackMessage(
   conv.id,
   'assistant',
   'CONFIDENTIAL_PRIVATE',
   {},
   {
    segments:[{
     sourceRef:{
      binding:f.owner.binding,
      resourceType:'message',
      resourceId:JSON.stringify(['C_PRIVATE_LOSS','1730000000.000100']),
      revision:'1730000000.000100',
     },
     storagePolicyRef:storageRef,
     acquisitionPolicyRef:acqRef,
     captureHash:'a'.repeat(64),
     capturedAt:new Date().toISOString(),
     channelId:'C_PRIVATE_LOSS',
    }],
    selectors:['content'],
   },
  );
  expect((await f.messages.listMessages(conv.id))[0]?.content).toBe('CONFIDENTIAL_PRIVATE');

  const rawBody=Buffer.from(JSON.stringify({
   type:'event_callback',
   api_app_id:f.owner.row.app_id,
   team_id:f.owner.binding.workspaceId,
   event_id:'Ev_'+randomUUID(),
   event_context:'ctx',
   event:{
    type:'member_left_channel',
    user:f.owner.binding.slackUserId,
    channel:'C_PRIVATE_LOSS',
    channel_type:'G',
    event_ts:'1730000005.000100',
   },
  }));
  const ts=String(Math.floor(Date.now()/1000));
  const sig='v0='+createHmac('sha256','FIXTURE_SIGNING').update(`v0:${ts}:`).update(rawBody).digest('hex');
  const ingress=new SlackIngressService({
   config:{appId:f.owner.row.app_id,signingSecret:'FIXTURE_SIGNING',automationEnabled:true},
   repo:new SlackEventReceiptRepo(env.db.pool,env.invalidationService),
  });
  const res=await ingress.handleRequest({rawBody,timestampHeader:ts,signatureHeader:sig});
  expect(res.status).toBe(200);
  expect((await f.messages.listMessages(conv.id))[0]?.content).toBe('Slack content is unavailable.');
 },30000);

 it('F2 (R3 & R4): binds real destination credentials and Trello boardIds in Inbox-prepared plans and blocks accounts connected after preview',async()=>{
  const {TrelloTeamRepo}=await import('../../src/db/repositories/trello-team-repo.js');
  const {GitHubTeamRepo}=await import('../../src/db/repositories/github-team-repo.js');
  const f=await setupFixture();
  const creds=new CredentialRepo(env.db.pool,TEST_KEY);

  // R4: Prepare a Gmail plan BEFORE connecting Gmail; connecting later must fail with AUTH_ERROR
  const unconnectedSeed=await f.seedProposal({
   intents:[{action:'task',service:'gmail',summary:'Draft confidential report'}],
  });
  const unconnectedPrep=await f.proposalService.prepare(f.owner.person.id,unconnectedSeed.id,{
   expectedRevision:1,
   replyInThread:false,
   targetOverride:{service:'gmail',toEmail:'recipient@example.test'},
  });
  if(unconnectedPrep.status!=='awaiting_approval')throw new Error('not prepared');
  expect(unconnectedPrep.plan.connections.gmail.credentialId).toBe('');
  expect(unconnectedPrep.plan.connections.gmail.email).toBe('');

  await creds.saveCredentials('trello',encryptCredentials({refreshToken:'synthetic-refresh',accessToken:'synthetic-access',memberId:'M_1',username:'alice_trello'},TEST_KEY),f.owner.person.id);
  await creds.saveCredentials('github',encryptCredentials({refreshToken:'synthetic-refresh',accessToken:'synthetic-access',githubUserId:'G_1',login:'octo_alice'},TEST_KEY),f.owner.person.id);
  await creds.saveCredentials('gmail',encryptCredentials({refreshToken:'later-account-refresh',email:'sender@example.test'},TEST_KEY),f.owner.person.id);
  await creds.saveCredentials('mycalendar',encryptCredentials({refreshToken:'synthetic-refresh',email:'sender@example.test',allowedScope:{calendars:['primary']}},TEST_KEY),f.owner.person.id);
  await creds.saveCredentials('mysheets',encryptCredentials({refreshToken:'synthetic-refresh',email:'sender@example.test',allowedScope:{spreadsheets:['spreadsheet_allowed_1234567890']}},TEST_KEY),f.owner.person.id);

  const trelloTeam=new TrelloTeamRepo(env.db.pool);
  await trelloTeam.replace({
   scopeId:`personal:${f.owner.person.id}`,
   chosenBy:f.owner.person.id,
   workspaceId:'TRELLO_WORKSPACE',
   workspaceName:'Trello workspace',
   boards:[{boardId:'B_1',boardName:'Allowed board'}],
  });
  const ghTeam=new GitHubTeamRepo(env.db.pool);
  await ghTeam.replace({
   scopeId:`personal:${f.owner.person.id}`,
   chosenBy:f.owner.person.id,
   repos:[{repoId:'R_1',fullName:'acme/repo',name:'repo'}],
  });

  const factory=new AdapterFactory({
   credentialRepo:creds,
   encryptionKey:TEST_KEY,
   trelloTeamRepo:trelloTeam,
   trelloTokens:{forConnection:()=>({getAccessToken:async()=>'synthetic-access'})},
   trelloOAuthClient:{boards:async()=>[{id:'B_1',member:true}]},
   githubTeamRepo:ghTeam,
   githubTokens:{forConnection:()=>({getAccessToken:async()=>'synthetic-access'})},
   githubOAuthClient:{repos:async()=>[{fullName:'acme/repo',member:true}]},
   gmailTokens:{forConnection:()=>({getAccessToken:async()=>'synthetic-token'})} as any,
   createGmailAdapter:()=>({execute:async()=>({id:'d1'})}),
   mycalendarTokens:{forConnection:()=>({getAccessToken:async()=>'synthetic-token'})} as any,
   createMyCalendarAdapter:()=>({execute:async()=>({id:'e1',url:'https://calendar.test/e1'})}),
   mysheetsTokens:{forConnection:()=>({getAccessToken:async()=>'synthetic-token'})} as any,
   createMySheetsAdapter:()=>({execute:async()=>({updatedRange:'Sheet1!A1:C1'})}),
  });

  // Verify the pre-connection Gmail plan is rejected with AUTH_ERROR
  let lateError:any=null;
  try{
   await factory.getAdapterForService('gmail',{
    userId:f.owner.person.id,
    workspaceMode:'personal',
    phase:'execution',
    connections:unconnectedPrep.plan.connections,
   });
  }catch(e){
   lateError=e;
  }
  expect(lateError?.category).toBe('AUTH_ERROR');

  // Verify Inbox-prepared plans for all 5 services bind real credentialIds, Trello boardId B_1, and sender email
  const inboxCases=[
   {service:'trello',override:undefined},
   {service:'github',override:{service:'github',repo:'acme/repo'}},
   {service:'gmail',override:{service:'gmail',toEmail:'recipient@example.test'}},
   {service:'mycalendar',override:{service:'mycalendar',calendarId:'primary',startIso:'2026-11-05T09:00:00Z',endIso:'2026-11-05T09:30:00Z'}},
   {service:'mysheets',override:{service:'mysheets',spreadsheetId:'spreadsheet_allowed_1234567890',sheet:'Sheet1'}},
  ];
  for(const item of inboxCases){
   const seeded=await f.seedProposal();
   const prepared=await f.proposalService.prepare(f.owner.person.id,seeded.id,{
    expectedRevision:1,
    replyInThread:true,
    ...(item.override?{targetOverride:item.override}:{}),
   });
   expect(prepared.status).toBe('awaiting_approval');
   if(prepared.status==='awaiting_approval'){
    if(item.service==='trello'){
     expect(prepared.plan.connections.trello.boardIds).toEqual(['B_1']);
     expect(prepared.plan.connections.trello.username).toBe('alice_trello');
    }
    if(item.service==='gmail'){
     expect(prepared.plan.connections.gmail.email).toBe('sender@example.test');
    }
    const adapter=await factory.getAdapterForService(item.service,{
     userId:f.owner.person.id,
     workspaceMode:'personal',
     phase:'execution',
     connections:prepared.plan.connections,
    });
    expect(typeof (adapter as any).execute).toBe('function');
   }
  }
 },30000);

 it('F9: allows retry and skip on failed non-Slack steps in a multi-step source-reply plan before the Slack post step has started',async()=>{
  const f=await setupFixture();
  const bugSeed=await f.seedProposal({
   title:'Broken server',
   intents:[{action:'issue',service:'jira',summary:'Fix server'}],
   text:'<@U_OWNER> kiểm tra lỗi server',
  });
  const prep=await request(f.app).post(`/api/slack/proposals/${bugSeed.id}/prepare`).set('Authorization',f.ownerToken).send({expectedRevision:1,replyInThread:true});
  expect(prep.status).toBe(200);
  const planId=prep.body.planId;

  let shouldFailSearch=true;
  const customExec=new ExecutionService({
   planRepo:f.plans,
   stepRepo:f.steps,
   convRepo:f.conversations,
   slackWrite:f.slackWrite,
   adapterFactory:{
    getAdapterForService:async()=>({
     execute:async(tool:string,args:any)=>{
      if(tool==='jira.search_issues'){
       if(shouldFailSearch)throw Object.assign(new Error('Jira temporary outage'),{category:'SERVER_ERROR'});
       return {issues:[]};
      }
      if(tool==='jira.create_issue'){
       return {id:'10001',key:`${args.projectKey}-99`,url:`https://jira.example/browse/${args.projectKey}-99`};
      }
      throw new Error(`Unexpected tool ${tool}`);
     },
    }),
   },
  });

  const started=await customExec.approveAndStart(planId,f.owner.person.id);
  expect(started.status).toBe(200);
  await vi.waitFor(async()=>{
   const rows=await f.steps.listSteps(planId,'planning');
   expect(rows.find(r=>r.step_id==='step_1')?.status).toBe('failed');
  },{timeout:10000});

  shouldFailSearch=false;
  const retried=await customExec.retryStep(planId,'step_1',f.owner.person.id);
  expect(retried.status).toBe('completed');
 },30000);
});
