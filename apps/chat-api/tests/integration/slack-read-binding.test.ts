import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {SlackReadPlanBindings} from '../../src/services/slack/slack-plan-bindings.js';
import {PlanRepo} from '../../src/db/repositories/plan-repo.js';
import {StepRepo} from '../../src/db/repositories/step-repo.js';
import {SlackDerivedLineageRepo} from '../../src/db/repositories/slack-derived-lineage-repo.js';
import {createSlackReadEnvironment,TEST_ENV} from '../helpers/slack-private-read-fixture.js';
import {SLACK_USER_SCOPES} from '../../src/services/slack/oauth-client.js';
import {MYSLACK_CORE_READ_TOOLS} from '@wap/tool-schemas';
import {StepRunner} from '@wap/executor';
import {createSlackDispatchGuard} from '../../src/services/slack/slack-dispatch-guard.js';
import {SlackReadRuntime} from '../../src/services/slack/slack-read-runtime.js';
import {ExecutionService} from '../../src/services/execution-service.js';
import {ConversationRepo} from '../../src/db/repositories/conversation-repo.js';
import {SSEManager} from '../../src/sse/sse-manager.js';
import {vi} from 'vitest';
import {SlackMessagePurgeConsumer} from '../../src/services/slack/slack-message-purge-consumer.js';
describe('approved Slack read binding uses actual PostgreSQL authority',()=>{
 let env:Awaited<ReturnType<typeof createSlackReadEnvironment>>;
 beforeAll(async()=>{env=await createSlackReadEnvironment('read_binding');},30000);
 afterAll(async()=>{await env?.close();});
 async function fixture(){
  const owner=await env.addUser({name:'Read owner',workspaceId:'T_BINDING',actorId:'U_'+Date.now()});
  await env.db.pool.query('UPDATE slack_connections SET scopes=$2 WHERE id=$1',[owner.row.id,SLACK_USER_SCOPES]);
  const steps=[{id:'read',tool:'myslack.users_info',description:'Read Slack user',args:{user:owner.binding.slackUserId},dependsOn:[]}];
  const binder=new SlackReadPlanBindings(env.connectionRepo,env.policyService,env.invalidationService);
  const bindings=await binder.resolve(owner.person.id,steps,[{stepId:'read',connectionId:owner.row.id}]);
  return {owner,steps,binder,bindings};
 }
 async function durableMembers(){
  const owner=await env.addUser({name:'Members',workspaceId:'T_'+randomUUID(),actorId:'U_'+randomUUID()});
  await env.db.pool.query('UPDATE slack_connections SET scopes=$2 WHERE id=$1',[owner.row.id,SLACK_USER_SCOPES]);
  const consent=await env.consentRepo.getConsent(owner.row.workspace_id,env.runtimeIdentity.providerId);
  await env.consentRepo.grantConsent({workspaceId:owner.row.workspace_id,providerId:env.runtimeIdentity.providerId,expectedRevision:consent!.revision,policyVersion:'v1.0.0',purposes:['manual_lookup','planning','storage'],retentionDays:7,organizationRepresentative:'fixture',evidenceRef:'fixture',recordedBy:'fixture'});
  const list=[{id:'read',tool:'myslack.conversations_members',description:'Members',args:{channel:'C_MEMBERS'},dependsOn:[]}],binder=new SlackReadPlanBindings(env.connectionRepo,env.policyService,env.invalidationService);
  const bindings=await binder.resolve(owner.person.id,list,[{stepId:'read',connectionId:owner.row.id}]),registry=new SlackDerivedLineageRepo(env.db.pool,env.policyService),repo=new PlanRepo(env.db.pool,registry),steps=new StepRepo(env.db.pool,registry);
  const conv=(await env.db.pool.query('INSERT INTO conversations(user_id)VALUES($1) RETURNING id',[owner.person.id])).rows[0].id;
  const plan={kind:'plan',thinking:'',summary:'Members',steps:list,warnings:[],connections:{myslack:bindings}},text=JSON.stringify(plan),hash=createHash('sha256').update(text).digest('hex');
  const saved=await repo.createSlackReadPlan({convId:conv,planJson:plan,planText:text,planHash:hash,expiresAt:new Date(Date.now()+60000)},owner.person.id);
  await repo.approvePlan(saved.id,hash,owner.person.id);const stored=await steps.createStep({planId:saved.id,stepId:'read',tool:list[0]!.tool,argsJson:list[0]!.args,requestedBy:owner.person.id});
  env.fixture.setHandler('/conversations.members',()=>({body:{ok:true,members:['U_MEMBER'],response_metadata:{next_cursor:''}}}));
  const {wrapper}=env.buildWrapper(),runtime=new SlackReadRuntime({binder,plans:repo,steps,policy:env.policyService,invalidation:env.invalidationService,wrapper}),snapshot={planId:saved.id,planHash:hash,userId:owner.person.id,steps:list,bindings};
  const output=await runtime.adapter(owner.person.id).execute(list[0]!.tool,{binding:owner.binding,params:list[0]!.args});
  const invalidate=()=>env.stageBarriers([{effectKey:'member_removed',barrier:{barrierType:'resource',workspaceId:owner.binding.workspaceId,resourceType:'user',resourceId:'U_MEMBER',deleted:true,reason:'deleted'}}]);
  return {owner,stored,steps,saved,runtime,snapshot,output,invalidate};
 }
 it('requests sufficient OAuth scopes for every core user read',()=>{
  for(const tool of MYSLACK_CORE_READ_TOOLS.filter(t=>t.name.startsWith('myslack.users_')))expect(SLACK_USER_SCOPES).toContain(tool.userScopes![0]);
 });
 it('blocks a member invalidated between transport and result commit',async()=>{
  const f=await durableMembers();await f.invalidate();
  await expect(f.runtime.persist(f.stored.id,f.output,f.snapshot,'read')).rejects.toThrow();
  expect((await env.db.pool.query('SELECT output_json FROM execution_steps WHERE id=$1',[f.stored.id])).rows[0].output_json).toBeNull();
 },15000);
 it('blocks persisted membership when an individual member is invalidated',async()=>{
  const f=await durableMembers();await f.runtime.persist(f.stored.id,f.output,f.snapshot,'read');await f.invalidate();
  expect(JSON.stringify(await f.steps.listSteps(f.saved.id))).not.toContain('U_MEMBER');
 },15000);
 it('derives owned binding and denies another owner, missing scopes, reconnect and policy changes',async()=>{
  const f=await fixture();expect(f.bindings.bindings[f.owner.row.id]).toEqual(f.owner.binding);
  const other=await env.db.person();
  await expect(f.binder.resolve(other.id,f.steps,[{stepId:'read',connectionId:f.owner.row.id}])).rejects.toThrow();
  await env.db.pool.query("UPDATE slack_connections SET scopes='{}' WHERE id=$1",[f.owner.row.id]);
  await expect(f.binder.assert(f.owner.person.id,f.steps,f.bindings)).rejects.toThrow();
  await env.db.pool.query('UPDATE slack_connections SET scopes=$2,identity_version=identity_version+1 WHERE id=$1',[f.owner.row.id,SLACK_USER_SCOPES]);
  await expect(f.binder.assert(f.owner.person.id,f.steps,f.bindings)).rejects.toThrow();
 });
 it('saves a binding-only read plan via a narrow writer and guards tampering',async()=>{
  const f=await fixture(),repo=new PlanRepo(env.db.pool,new SlackDerivedLineageRepo(env.db.pool,env.policyService));
  const conv=(await env.db.pool.query('INSERT INTO conversations(user_id)VALUES($1) RETURNING id',[f.owner.person.id])).rows[0].id;
  const plan={kind:'plan',thinking:'',summary:'Read Slack',steps:f.steps,warnings:[],connections:{myslack:f.bindings}},text=JSON.stringify(plan);
  const data={convId:conv,planJson:plan,planText:text,planHash:createHash('sha256').update(text).digest('hex'),expiresAt:new Date(Date.now()+60000)};
  await expect(repo.createPlan(data)).rejects.toThrow();
  await expect(repo.createSlackReadPlan({...data,planText:'uncertified source bytes'},f.owner.person.id)).rejects.toThrow();
  const saved=await repo.createSlackReadPlan(data,f.owner.person.id);expect((await repo.getPlan(saved.id))?.plan_json).toEqual(plan);
  await env.db.pool.query("UPDATE plans SET plan_json=jsonb_set(plan_json,'{connections,myslack,bindings,"+f.owner.row.id+",workspaceId}','\"T_ATTACK\"') WHERE id=$1",[saved.id]);
  expect(JSON.stringify((await repo.getPlan(saved.id))?.plan_json)).not.toContain('T_ATTACK');
 });
 it('dispatches a real approved read once and blocks an actual resource barrier before HTTP',async()=>{
  const f=await fixture(),repo=new PlanRepo(env.db.pool,new SlackDerivedLineageRepo(env.db.pool,env.policyService)),steps=new StepRepo(env.db.pool,new SlackDerivedLineageRepo(env.db.pool,env.policyService));
  const conv=(await env.db.pool.query('INSERT INTO conversations(user_id)VALUES($1) RETURNING id',[f.owner.person.id])).rows[0].id;
  const plan={kind:'plan',thinking:'',summary:'Read',steps:f.steps,warnings:[],connections:{myslack:f.bindings}},text=JSON.stringify(plan),hash=createHash('sha256').update(text).digest('hex');
  const saved=await repo.createSlackReadPlan({convId:conv,planJson:plan,planText:text,planHash:hash,expiresAt:new Date(Date.now()+60000)},f.owner.person.id);
  const approvals=await Promise.all([repo.approvePlan(saved.id,hash,f.owner.person.id),repo.approvePlan(saved.id,hash,f.owner.person.id)]);expect(approvals.filter(Boolean)).toHaveLength(1);
  await steps.createStep({planId:saved.id,stepId:'read',tool:f.steps[0]!.tool,argsJson:f.steps[0]!.args,requestedBy:f.owner.person.id});
  const snapshot={planId:saved.id,planHash:hash,userId:f.owner.person.id,steps:f.steps,bindings:f.bindings},guard=createSlackDispatchGuard({snapshot,binder:f.binder,plans:repo,policy:env.policyService,invalidation:env.invalidationService});
  const {wrapper}=env.buildWrapper(),runner=new StepRunner({slackSnapshot:snapshot,slackDispatchGuard:guard,getAdapter:()=>({execute:async(tool,args,options)=>(await wrapper.executeRead({callerAtiUserId:f.owner.person.id,binding:args.binding,tool,params:args.params,purpose:'planning',signal:options?.signal})).data})});
  const first=await runner.executeStep(f.steps[0]!,new Map());expect(first.status).toBe('success');const requests=env.fixture.gets.length;
  await env.stageBarriers([{effectKey:'deny_user',barrier:{barrierType:'resource',workspaceId:f.owner.binding.workspaceId,resourceType:'user',resourceId:f.owner.binding.slackUserId,deleted:true,reason:'deleted'}}]);
  const denied=await runner.executeStep(f.steps[0]!,new Map());expect(denied.status).toBe('failed');expect(env.fixture.gets).toHaveLength(requests);
 });
 it('runs through approval, promotes fresh output atomically and suppresses source SSE payloads',async()=>{
  const owner=await env.addUser({name:'Durable read',workspaceId:'T_DURABLE',actorId:'U_DURABLE'});
  await env.db.pool.query('UPDATE slack_connections SET scopes=$2 WHERE id=$1',[owner.row.id,SLACK_USER_SCOPES]);
  const consent=await env.consentRepo.getConsent(owner.row.workspace_id,env.runtimeIdentity.providerId);
  await env.consentRepo.grantConsent({workspaceId:owner.row.workspace_id,providerId:env.runtimeIdentity.providerId,expectedRevision:consent!.revision,policyVersion:'v1.0.0',purposes:['manual_lookup','planning','storage'],retentionDays:7,organizationRepresentative:'fixture',evidenceRef:'fixture',recordedBy:'fixture'});
  const stepsJson=[{id:'read',tool:'myslack.users_info',description:'Read user',args:{user:owner.binding.slackUserId},dependsOn:[]}],binder=new SlackReadPlanBindings(env.connectionRepo,env.policyService,env.invalidationService);
  const bindings=await binder.resolve(owner.person.id,stepsJson,[{stepId:'read',connectionId:owner.row.id}]);
  const registry=new SlackDerivedLineageRepo(env.db.pool,env.policyService),repo=new PlanRepo(env.db.pool,registry),steps=new StepRepo(env.db.pool,registry);
  const conv=(await env.db.pool.query('INSERT INTO conversations(user_id)VALUES($1) RETURNING id',[owner.person.id])).rows[0].id;
  const plan={kind:'plan',thinking:'',summary:'Read',steps:stepsJson,warnings:[],connections:{myslack:bindings}},text=JSON.stringify(plan),hash=createHash('sha256').update(text).digest('hex');
  const saved=await repo.createSlackReadPlan({convId:conv,planJson:plan,planText:text,planHash:hash,expiresAt:new Date(Date.now()+60000)},owner.person.id);
  env.fixture.setHandler('/users.info',()=>({body:{ok:true,user:{id:owner.binding.slackUserId,name:'PRIVATE_READ_NAME'}}}));
  const {wrapper}=env.buildWrapper(),runtime=new SlackReadRuntime({binder,plans:repo,steps,policy:env.policyService,invalidation:env.invalidationService,wrapper}),events:any[]=[];
  const execution=new ExecutionService({planRepo:repo,stepRepo:steps,convRepo:new ConversationRepo(env.db.pool),slackRead:runtime,sseManager:{emitEvent:(_c,e,p)=>events.push({e,p})},adapterFactory:{getAdapterForService:()=>{throw new Error('Shared fallback forbidden');}}});
  expect((await execution.approveAndStart(saved.id,owner.person.id)).success).toBe(true);
  await vi.waitFor(async()=>{const current=await repo.getPlan(saved.id);expect(current?.status,JSON.stringify(await env.db.pool.query('SELECT status,error_json FROM execution_steps WHERE plan_id=$1',[saved.id]).then(r=>r.rows))).toBe('completed');},{timeout:6000});
  expect((await steps.listSteps(saved.id))[0]?.output_json.user.name).toBe('PRIVATE_READ_NAME');
  expect(JSON.stringify(events)).not.toContain('PRIVATE_READ_NAME');
  const copies=await env.db.pool.query("SELECT target_kind,target_sub_id FROM slack_derived_copies WHERE target_id=$1 AND status='active'",[saved.id]);expect(copies.rows).toHaveLength(3);
  await env.stageBarriers([{effectKey:'delete',barrier:{barrierType:'resource',workspaceId:owner.binding.workspaceId,resourceType:'user',resourceId:owner.binding.slackUserId,deleted:true,reason:'deleted'},purgeTarget:{scope:'resource_lifecycle',workspaceId:owner.binding.workspaceId,resourceType:'user',resourceId:owner.binding.slackUserId,cascadeTargetKinds:['plan_step_arg','audit_log_entry'],tombstoneReason:'source_deleted'}}]);
  expect(JSON.stringify(await steps.listSteps(saved.id))).not.toContain('PRIVATE_READ_NAME');
  expect((await env.db.pool.query('SELECT plan_hash FROM plans WHERE id=$1',[saved.id])).rows[0].plan_hash).toBe(hash);
  for(const targetKind of ['plan_step_arg','audit_log_entry'] as const)expect((await new SlackMessagePurgeConsumer(env.db.pool,{targetKind}).runOnce(50)).completed).toBeGreaterThan(0);
  const physical=(await env.db.pool.query('SELECT output_json FROM execution_steps WHERE plan_id=$1',[saved.id])).rows;
  expect(JSON.stringify(physical)).not.toContain('PRIVATE_READ_NAME');
 },15000);
 it('reuses per-entity provenance across two real reads and retries a known failure',async()=>{
  const owner=await env.addUser({name:'Two reads',workspaceId:'T_TWO_READS',actorId:'U_TWO_READS'});
  await env.db.pool.query('UPDATE slack_connections SET scopes=$2 WHERE id=$1',[owner.row.id,SLACK_USER_SCOPES]);
  const consent=await env.consentRepo.getConsent(owner.row.workspace_id,env.runtimeIdentity.providerId);
  await env.consentRepo.grantConsent({workspaceId:owner.row.workspace_id,providerId:env.runtimeIdentity.providerId,expectedRevision:consent!.revision,policyVersion:'v1.0.0',purposes:['manual_lookup','planning','storage'],retentionDays:7,organizationRepresentative:'fixture',evidenceRef:'fixture',recordedBy:'fixture'});
  const stepsJson=[{id:'list',tool:'myslack.users_list',description:'List',args:{limit:10} as any,dependsOn:[] as string[]},{id:'info',tool:'myslack.users_info',description:'Info',args:{user:{$ref:'list.output.members.0.id'}},dependsOn:['list']}];
  const binder=new SlackReadPlanBindings(env.connectionRepo,env.policyService,env.invalidationService),bindings=await binder.resolve(owner.person.id,stepsJson,stepsJson.map(s=>({stepId:s.id,connectionId:owner.row.id})));
  const registry=new SlackDerivedLineageRepo(env.db.pool,env.policyService),repo=new PlanRepo(env.db.pool,registry),steps=new StepRepo(env.db.pool,registry);
  const conv=(await env.db.pool.query('INSERT INTO conversations(user_id)VALUES($1) RETURNING id',[owner.person.id])).rows[0].id;
  const plan={kind:'plan',thinking:'',summary:'Read two',steps:stepsJson,warnings:[],connections:{myslack:bindings}},text=JSON.stringify(plan),hash=createHash('sha256').update(text).digest('hex');
  const saved=await repo.createSlackReadPlan({convId:conv,planJson:plan,planText:text,planHash:hash,expiresAt:new Date(Date.now()+60000)},owner.person.id);
  env.fixture.setHandler('/users.list',()=>({body:{ok:true,members:[{id:'U_TARGET',name:'List target'}],response_metadata:{next_cursor:''}}}));
  let failInfo=true;
  env.fixture.setHandler('/users.info',r=>({body:failInfo?{ok:false,error:'user_not_found'}:{ok:true,user:{id:r.query.user,name:'TARGET_RESULT'}}}));
  const {wrapper}=env.buildWrapper(),runtime=new SlackReadRuntime({binder,plans:repo,steps,policy:env.policyService,invalidation:env.invalidationService,wrapper});
  const execution=new ExecutionService({planRepo:repo,stepRepo:steps,convRepo:new ConversationRepo(env.db.pool),slackRead:runtime,adapterFactory:{getAdapterForService:()=>{throw new Error('No shared fallback');}}});
  expect((await execution.approveAndStart(saved.id,owner.person.id)).success).toBe(true);
  // Two guarded reads each have a 15s production deadline; allow the complete
  // durable status write while the full PostgreSQL suite runs concurrently.
  await vi.waitFor(async()=>{const row=await repo.getPlan(saved.id);expect(row?.status,JSON.stringify(await steps.listSteps(saved.id))).toBe('partial');},{timeout:35000});
  failInfo=false;
  expect((await execution.retryStep(saved.id,'info',owner.person.id)).status).toBe('completed');
  expect((await steps.listSteps(saved.id)).find(s=>s.step_id==='info')?.output_json.user.id).toBe('U_TARGET');
 },60000);
});
