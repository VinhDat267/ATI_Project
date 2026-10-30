import { randomUUID, createHash } from 'node:crypto';
import { afterAll,beforeAll,expect,it,vi } from 'vitest';
import { SLACK_DERIVED_TARGET_KINDS } from '@wap/tool-schemas';
import { createSlackReadEnvironment,TEST_ENV,type SlackReadEnvironment } from '../helpers/slack-private-read-fixture.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { StepRepo } from '../../src/db/repositories/step-repo.js';
import { SlackDerivedLineageRepo } from '../../src/db/repositories/slack-derived-lineage-repo.js';
import { SlackMessagePurgeConsumer } from '../../src/services/slack/slack-message-purge-consumer.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { ChatService } from '../../src/services/chat-service.js';
import { ExecutionService } from '../../src/services/execution-service.js';
import { SSEManager } from '../../src/sse/sse-manager.js';
import express from 'express';
import request from 'supertest';
import { createConversationRoutes } from '../../src/routes/conversation-routes.js';
import { SlackMessageContentPurger } from '../../src/services/slack/slack-message-content-purger.js';

let env:SlackReadEnvironment,plans:PlanRepo,steps:StepRepo;
beforeAll(async()=>{env=await createSlackReadEnvironment('slack_plan_execution');const registry=new SlackDerivedLineageRepo(env.db.pool,env.policyService);plans=new PlanRepo(env.db.pool,registry);steps=new StepRepo(env.db.pool,registry);});
afterAll(async()=>{await env?.close();});
async function fixture(){
  const owner=await env.addUser({name:'plan fixture',workspaceId:`T${randomUUID()}`,actorId:`U${randomUUID()}`});
  const current=await env.consentRepo.getConsent(owner.binding.workspaceId,env.runtimeIdentity.providerId);
  await env.consentRepo.grantConsent({workspaceId:owner.binding.workspaceId,providerId:env.runtimeIdentity.providerId,expectedRevision:current!.revision,policyVersion:'v1.0.0',purposes:['storage','manual_lookup','planning'],retentionDays:14,organizationRepresentative:'fixture',evidenceRef:'FIXTURE',recordedBy:'fixture'});
  const policy=await env.policyService.resolveSlackModelPolicy({binding:owner.binding,purpose:'storage',requestedRetentionDays:7,env:TEST_ENV});if(!policy.allowed)throw new Error('fixture policy denied');
  const conv=(await env.db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id',[owner.person.id])).rows[0].id;
  const context={segments:[{sourceRef:{binding:owner.binding,resourceType:'message' as const,resourceId:JSON.stringify(['C_PLAN','1730000000.000001']),revision:'1730000000.000001'},storagePolicyRef:policy.policyReference,acquisitionPolicyRef:{...policy.policyReference,purpose:'planning' as const,requestedRetentionDays:0},captureHash:'a'.repeat(64),capturedAt:new Date().toISOString()}]};
  const planJson={kind:'plan',summary:'private plan',thinking:'private thought',warnings:[],steps:[{id:'s1',tool:'trello.create_card',description:'private description',args:{name:'private card'},dependsOn:[] as string[]}]};
  const text=JSON.stringify(planJson),data={convId:conv,planJson,planText:text,planHash:createHash('sha256').update(text).digest('hex'),expiresAt:new Date(Date.now()+600000),resourceLabels:{slack:'private label',trello:'keep'}};
  return {owner,conv,context,data};
}
async function invalidate(f:Awaited<ReturnType<typeof fixture>>){const key=`plan:${randomUUID()}`;await env.stageBarriers([{effectKey:'revoke',barrier:{barrierType:'binding',binding:f.owner.binding,reason:'fixture'},purgeTarget:{scope:'authorization_disconnect',binding:f.owner.binding,cascadeTargetKinds:[...SLACK_DERIVED_TARGET_KINDS],tombstoneReason:'connection_disconnected'}}],key);return key;}
it('actual plan/step/audit writers register atomically and ordinary readers mask before physical erasure',async()=>{
  const f=await fixture();
  const plan=await plans.createSlackPlan(f.data,{...f.context,selectors:['plan_json','plan_text','plan_hash','resource_labels/slack']});
  const step=await steps.createStep({planId:plan.id,stepId:'s1',tool:'trello.create_card',argsJson:{name:'private card'},requestedBy:f.owner.person.id});
  await steps.updateStepStatus(step.id,'succeeded',{title:'private output'},{message:'private error'});
  expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_derived_copies WHERE target_id=ANY($1::text[])',[[plan.id,step.id]])).rows[0].n).toBe(7);
  expect((await plans.getPlan(plan.id))?.plan_json.summary).toBe('private plan');
  await invalidate(f);
  expect(JSON.stringify(await plans.getPlan(plan.id))).not.toContain('private');
  expect(JSON.stringify(await steps.listSteps(plan.id))).not.toContain('private');
  expect(await plans.approvePlan(plan.id,f.data.planHash,f.owner.person.id)).toBe(false);
  for(const targetKind of ['plan_step_arg','audit_log_entry'] as const)expect((await new SlackMessagePurgeConsumer(env.db.pool,{targetKind}).runOnce(50)).completed).toBeGreaterThan(0);
  const persisted=(await env.db.pool.query('SELECT plan_json,plan_text,plan_hash,resource_labels,status FROM plans WHERE id=$1',[plan.id])).rows[0];
  expect(JSON.stringify(persisted)).not.toContain('private');expect(persisted.status).toBe('superseded');expect(persisted.resource_labels).toEqual({trello:'keep'});
  const audit=(await env.db.pool.query('SELECT args_json,output_json,error_json FROM execution_steps WHERE id=$1',[step.id])).rows[0];
  expect(audit).toEqual({args_json:{__slack_purged:true},output_json:{__slack_purged:true},error_json:{__slack_purged:true}});
});
it('rolls back real plan and registry together on stale acquisition authority',async()=>{
  const f=await fixture();f.context.segments[0]!.storagePolicyRef.consentRevision='999';
  await expect(plans.createSlackPlan(f.data,{...f.context,selectors:['plan_json','plan_text','plan_hash']})).rejects.toThrow();
  expect((await env.db.pool.query('SELECT count(*)::int AS n FROM plans WHERE conv_id=$1',[f.conv])).rows[0].n).toBe(0);
});
it('real chat creates a source-bound plan, approved execution records provenance through HTTP fixture and SSE caches no source output',async()=>{
  const f=await fixture(),registry=new SlackDerivedLineageRepo(env.db.pool,env.policyService),messages=new MessageRepo(env.db.pool,registry),sse=new SSEManager();
  await messages.createSlackMessage(f.conv,'assistant','private plan source',{type:'answer'},{...f.context,selectors:['content']});
  const chat=new ChatService({msgRepo:messages,planRepo:plans,eventEmitter:{emit:(name,payload)=>sse.emitEvent(f.conv,name,payload)},planner:{processMessage:async()=>f.data.planJson as any,routeSchedule:async()=>({services:[],unavailable:[]})}});
  await chat.handleUserMessage({conversationId:f.conv,userId:f.owner.person.id,content:'make a card'});
  await vi.waitFor(async()=>expect((await env.db.pool.query('SELECT count(*)::int AS n FROM plans WHERE conv_id=$1',[f.conv])).rows[0].n).toBe(1));
  const plan=(await env.db.pool.query('SELECT * FROM plans WHERE conv_id=$1',[f.conv])).rows[0];
  const path=`/plan-write-${randomUUID()}`;env.fixture.setHandler(path,req=>({body:{id:'fixture-card',name:JSON.parse(req.body).name,excerpt:'private provider output'}}));
  const service=new ExecutionService({planRepo:plans,stepRepo:steps,convRepo:new ConversationRepo(env.db.pool),sseManager:sse,adapterFactory:{getAdapterForService:()=>({execute:async(_tool:string,args:any,options:any)=>{
    const response=await fetch(env.fixture.url+path,{method:'POST',body:JSON.stringify(args),signal:options.signal});return response.json();
  }})}});
  expect((await service.approveAndStart(plan.id,f.owner.person.id)).success).toBe(true);
  await vi.waitFor(async()=>expect((await env.db.pool.query('SELECT status FROM plans WHERE id=$1',[plan.id])).rows[0].status).toBe('completed'));
  expect(env.fixture.requests.filter(r=>r.path===path)).toHaveLength(1);
  const rows=await steps.listSteps(plan.id);expect(rows[0]?.output_json.excerpt).toBe('private provider output');
  expect((await env.db.pool.query("SELECT count(*)::int AS n FROM slack_derived_copies WHERE target_kind='audit_log_entry' AND target_id=$1 AND status='active'",[rows[0]!.id])).rows[0].n).toBe(1);
  expect(JSON.stringify(sse.getMissedEvents(f.conv,0))).not.toContain('private');
  await invalidate(f);expect(JSON.stringify(await service.getLatestExecutionSnapshot(f.conv,f.owner.person.id))).not.toContain('private');
});
it('rechecks source after an asynchronous adapter factory and never dispatches a revoked plan',async()=>{
  const f=await fixture(),plan=await plans.createSlackPlan(f.data,f.context),path=`/never-write-${randomUUID()}`;
  let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
  env.fixture.setHandler(path,()=>({body:{ok:true}}));
  const service=new ExecutionService({planRepo:plans,stepRepo:steps,convRepo:new ConversationRepo(env.db.pool),adapterFactory:{getAdapterForService:async()=>{
    entered();await gate;return {execute:async(_tool:string,args:any,options:any)=>(await fetch(env.fixture.url+path,{method:'POST',body:JSON.stringify(args),signal:options.signal})).json()};
  }}});
  expect((await service.approveAndStart(plan.id,f.owner.person.id)).success).toBe(true);await ready;await invalidate(f);release();
  await vi.waitFor(async()=>expect((await env.db.pool.query('SELECT status FROM plans WHERE id=$1',[plan.id])).rows[0].status).toBe('failed'));
  expect(env.fixture.requests.filter(r=>r.path===path)).toHaveLength(0);
});
it('records a provider result racing revoke without its payload, keeps UNKNOWN non-retriable and makes no next write',async()=>{
  const f=await fixture();
  f.data.planJson.steps.push({id:'s2',tool:'trello.create_card',description:'private second',args:{name:'private next'},dependsOn:['s1']});
  f.data.planText=JSON.stringify(f.data.planJson);f.data.planHash=createHash('sha256').update(f.data.planText).digest('hex');
  const plan=await plans.createSlackPlan(f.data,f.context),path=`/race-write-${randomUUID()}`,sse=new SSEManager();
  env.fixture.setHandler(path,async()=>{await invalidate(f);return {body:{id:'written-before-revoke',excerpt:'private late provider result'}};});
  const service=new ExecutionService({planRepo:plans,stepRepo:steps,convRepo:new ConversationRepo(env.db.pool),sseManager:sse,adapterFactory:{getAdapterForService:()=>({execute:async(_tool:string,args:any,options:any)=>(await fetch(env.fixture.url+path,{method:'POST',body:JSON.stringify(args),signal:options.signal})).json()})}});
  expect((await service.approveAndStart(plan.id,f.owner.person.id)).success).toBe(true);
  await vi.waitFor(async()=>expect((await env.db.pool.query('SELECT status FROM plans WHERE id=$1',[plan.id])).rows[0].status).toBe('failed'));
  expect(env.fixture.requests.filter(r=>r.path===path)).toHaveLength(1);
  const stored=(await env.db.pool.query('SELECT output_json,error_json,status FROM execution_steps WHERE plan_id=$1 ORDER BY step_id',[plan.id])).rows;
  expect(stored[0]!.status).toBe('unknown');expect(JSON.stringify(stored)).not.toContain('private late');
  expect(JSON.stringify(sse.getMissedEvents(f.conv,0))).not.toContain('private');
  await expect(service.retryStep(plan.id,'s1',f.owner.person.id)).rejects.toThrow();
});
it('guards the actual HTTP pending-plan preview before purge and preserves a different owner',async()=>{
  const f=await fixture(),other=await fixture(),plan=await plans.createSlackPlan(f.data,f.context),otherPlan=await plans.createSlackPlan(other.data,other.context);
  const app=express();app.use((req,_res,next)=>{(req as any).user={id:req.headers['x-fixture-owner']};next();});
  app.use('/conversations',createConversationRoutes({convRepo:new ConversationRepo(env.db.pool),msgRepo:new MessageRepo(env.db.pool),planRepo:plans,chatService:{} as ChatService}));
  expect((await request(app).get(`/conversations/${f.conv}/plans/active`).set('x-fixture-owner',other.owner.person.id)).status).toBe(403);
  expect((await request(app).get(`/conversations/${f.conv}/plans/active`).set('x-fixture-owner',f.owner.person.id)).text).toContain('private plan');
  await invalidate(f);
  const hidden=await request(app).get(`/conversations/${f.conv}/plans/active`).set('x-fixture-owner',f.owner.person.id);expect(hidden.text).not.toContain('private');
  expect((await plans.getPlan(otherPlan.id))?.plan_json.summary).toBe('private plan');
  await new SlackMessagePurgeConsumer(env.db.pool,{targetKind:'plan_step_arg'}).runOnce(50);
  expect((await env.db.pool.query('SELECT plan_json FROM plans WHERE id=$1',[otherPlan.id])).rows[0].plan_json.summary).toBe('private plan');
  expect((await plans.getPlan(plan.id))?.status).toBe('superseded');
});
it('BIGINT version stays exact for plan selectors and fingerprint mismatch never overwrites replacement text',async()=>{
  const f=await fixture();await env.db.pool.query("SELECT setval('slack_derived_target_version_seq',9007199254740992)");
  const plan=await plans.createSlackPlan(f.data,f.context),copy=(await env.db.pool.query("SELECT * FROM slack_derived_copies WHERE target_id=$1 AND target_sub_id='plan_json'",[plan.id])).rows[0];
  expect(copy.target_version).toBe('9007199254740993');
  await env.db.pool.query('UPDATE plans SET plan_json=$2 WHERE id=$1',[plan.id,JSON.stringify({...f.data.planJson,summary:'new replacement'})]);
  await invalidate(f);
  const consumer=new SlackMessagePurgeConsumer(env.db.pool,{targetKind:'plan_step_arg'});expect((await consumer.runOnce(50)).retried).toBeGreaterThan(0);
  expect((await env.db.pool.query('SELECT plan_json FROM plans WHERE id=$1',[plan.id])).rows[0].plan_json.summary).toBe('new replacement');
  expect((await env.db.pool.query('SELECT status,retired_reason FROM slack_derived_copies WHERE id=$1',[copy.id])).rows[0]).toEqual({status:'retired',retired_reason:'fingerprint_mismatch'});
});
it('rejects wrong owner, stale approved step args and an actual aborted writer signal without partial artifacts',async()=>{
  const f=await fixture(),other=await fixture(),controller=new AbortController();controller.abort();
  await expect(plans.createSlackPlan(f.data,f.context,undefined,controller.signal)).rejects.toThrow();
  await expect(plans.createSlackPlan({...f.data,convId:other.conv},f.context)).rejects.toThrow();
  expect((await env.db.pool.query('SELECT count(*)::int AS n FROM plans WHERE conv_id=ANY($1::uuid[])',[[f.conv,other.conv]])).rows[0].n).toBe(0);
  const plan=await plans.createSlackPlan(f.data,f.context);
  await expect(steps.createStep({planId:plan.id,stepId:'s1',tool:'trello.create_card',argsJson:{name:'tampered'},requestedBy:f.owner.person.id})).rejects.toThrow('SLACK_STEP_SNAPSHOT_MISMATCH');
  expect((await env.db.pool.query('SELECT count(*)::int AS n FROM execution_steps WHERE plan_id=$1',[plan.id])).rows[0].n).toBe(0);
});
it('physically invalidates a linked run without retaining its source error',async()=>{
  const f=await fixture(),plan=await plans.createSlackPlan(f.data,f.context);
  const schedule=(await env.db.pool.query("INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status) VALUES($1,$2,'fixture','fixture','{}',ARRAY['trello'],'paused') RETURNING id",[f.owner.person.id,f.conv])).rows[0];
  const run=(await env.db.pool.query("INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status,conv_id,plan_id,error) VALUES($1,1,'manual',now(),'planned',$2,$3,'private run error') RETURNING id",[schedule.id,f.conv,plan.id])).rows[0];
  await invalidate(f);await new SlackMessagePurgeConsumer(env.db.pool,{targetKind:'plan_step_arg'}).runOnce(50);
  const row=(await env.db.pool.query('SELECT status,plan_id,error FROM schedule_runs WHERE id=$1',[run.id])).rows[0];
  expect(row.status).toBe('discarded');expect(row.plan_id).toBeNull();expect(row.error).not.toContain('private');
});
it('rolls physical plan erasure back after a real expired lease is reclaimed',async()=>{
  const f=await fixture(),plan=await plans.createSlackPlan(f.data,f.context),key=await invalidate(f);
  const job=(await env.db.pool.query("SELECT id FROM slack_invalidation_intents WHERE source_event_key=$1 AND target_kind='plan_step_arg'",[key])).rows[0];
  const real=new SlackMessageContentPurger(),other=new SlackMessagePurgeConsumer(env.db.pool,{targetKind:'plan_step_arg'});let replacement:any;
  const consumer=new SlackMessagePurgeConsumer(env.db.pool,{targetKind:'plan_step_arg',purger:{sourceLockKeysInTransaction:(...args)=>real.sourceLockKeysInTransaction(...args),purgeInTransaction:async(client,input)=>{
    const result=await real.purgeInTransaction(client,input);
    if(!replacement){await env.db.pool.query("UPDATE slack_invalidation_intents SET leased_until=clock_timestamp()-interval '1 second' WHERE id=$1",[job.id]);replacement=(await other.claim(50)).find(j=>j.id===job.id);}
    return result;
  }}});
  const lease=(await consumer.claim(50)).find(j=>j.id===job.id);expect(lease).toBeDefined();expect(await consumer.process(lease!)).toBe('lost');
  expect((await env.db.pool.query('SELECT plan_json FROM plans WHERE id=$1',[plan.id])).rows[0].plan_json.summary).toBe('private plan');
  expect(replacement).toBeDefined();expect(await other.process(replacement)).toBe('completed');
});
it('exclusive source-edit cutoff erases the old plan while a newly authorized equal revision remains readable',async()=>{
  const f=await fixture(),old=await plans.createSlackPlan(f.data,f.context),source=f.context.segments[0]!.sourceRef;
  await env.stageBarriers([{effectKey:'edit',barrier:{barrierType:'resource',workspaceId:f.owner.binding.workspaceId,resourceType:'message',resourceId:source.resourceId,minValidRevision:'1730000000.000002',reason:'edit'},
    purgeTarget:{scope:'resource_lifecycle',workspaceId:f.owner.binding.workspaceId,resourceType:'message',resourceId:source.resourceId,beforeRevision:'1730000000.000002',cascadeTargetKinds:[...SLACK_DERIVED_TARGET_KINDS],tombstoneReason:'source_edited'}}]);
  const fresh=structuredClone(f.context);fresh.segments[0]!.sourceRef.revision='1730000000.000002';fresh.segments[0]!.capturedAt=new Date().toISOString();
  const next=await plans.createSlackPlan(f.data,fresh);
  expect(JSON.stringify(await plans.getPlan(old.id))).not.toContain('private');expect((await plans.getPlan(next.id))?.plan_json.summary).toBe('private plan');
  await new SlackMessagePurgeConsumer(env.db.pool,{targetKind:'plan_step_arg'}).runOnce(50);
  expect((await env.db.pool.query('SELECT plan_json FROM plans WHERE id=$1',[old.id])).rows[0].plan_json.summary).not.toContain('private');
  expect((await env.db.pool.query('SELECT plan_json FROM plans WHERE id=$1',[next.id])).rows[0].plan_json.summary).toBe('private plan');
});
