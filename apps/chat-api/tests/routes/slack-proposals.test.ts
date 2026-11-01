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
});
