import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {SLACK_DERIVED_TARGET_KINDS} from '@wap/tool-schemas';
import {createSlackReadEnvironment,TEST_ENV,type SlackReadEnvironment} from '../helpers/slack-private-read-fixture.js';
import {SlackDerivedLineageRepo} from '../../src/db/repositories/slack-derived-lineage-repo.js';
import {MessageRepo} from '../../src/db/repositories/message-repo.js';
import {PlanRepo} from '../../src/db/repositories/plan-repo.js';
import {ConversationRepo} from '../../src/db/repositories/conversation-repo.js';
import {ChatService} from '../../src/services/chat-service.js';
import {ScheduleService} from '../../src/services/schedules/schedule-service.js';
import {ScheduleRunner} from '../../src/services/schedules/schedule-runner.js';
import {SlackMessagePurgeConsumer} from '../../src/services/slack/slack-message-purge-consumer.js';
import {SSEManager} from '../../src/sse/sse-manager.js';
import {SlackMessageContentPurger} from '../../src/services/slack/slack-message-content-purger.js';
import express from 'express';
import request from 'supertest';
import {createScheduleRoutes} from '../../src/routes/schedule-routes.js';
import {captureScheduleArtifact,prelockScheduleArtifacts,guardScheduleArtifact,scheduleRegistry,registerScheduleFields} from '../../src/services/slack/slack-schedule-lineage.js';

let env:SlackReadEnvironment,registry:SlackDerivedLineageRepo,messages:MessageRepo;
const zone='Asia/Ho_Chi_Minh';
beforeAll(async()=>{for(const [k,v] of Object.entries(TEST_ENV))vi.stubEnv(k,v);env=await createSlackReadEnvironment('slack_schedule');registry=new SlackDerivedLineageRepo(env.db.pool,env.policyService);messages=new MessageRepo(env.db.pool,registry);});
afterAll(async()=>{try{await env?.close();}finally{vi.unstubAllEnvs();}});
async function fixture(){
  const owner=await env.addUser({name:'schedule fixture',workspaceId:`T${randomUUID()}`,actorId:`U${randomUUID()}`});
  const old=await env.consentRepo.getConsent(owner.binding.workspaceId,env.runtimeIdentity.providerId);
  await env.consentRepo.grantConsent({workspaceId:owner.binding.workspaceId,providerId:env.runtimeIdentity.providerId,expectedRevision:old!.revision,policyVersion:'v1.0.0',purposes:['storage','manual_lookup','planning'],retentionDays:14,organizationRepresentative:'fixture',evidenceRef:'FIXTURE',recordedBy:'fixture'});
  const policy=await env.policyService.resolveSlackModelPolicy({binding:owner.binding,purpose:'storage',requestedRetentionDays:7,env:TEST_ENV});if(!policy.allowed)throw Error('fixture denied');
  const conv=(await env.db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id',[owner.person.id])).rows[0].id;
  const context={segments:[{sourceRef:{binding:owner.binding,resourceType:'message' as const,resourceId:JSON.stringify(['C_SCHEDULE','1730000000.000001']),revision:'1730000000.000001'},storagePolicyRef:policy.policyReference,acquisitionPolicyRef:{...policy.policyReference,purpose:'planning' as const,requestedRetentionDays:0},captureHash:'a'.repeat(64),capturedAt:new Date().toISOString()}]};
  const proposal={kind:'schedule' as const,action:'create' as const,name:'private schedule',request:'private request',recurrence:{type:'daily' as const,time:'09:00'},summary:'private summary'};
  const metadata={type:'schedule_proposal',proposal,services:['trello'],nextRuns:[],scheduleId:null,baseVersion:null};
  const message=await messages.createSlackMessage(conv,'assistant',proposal.summary,metadata,{...context,selectors:['content','metadata.proposal']});
  const service=new ScheduleService({pool:env.db.pool,timeZone:zone});
  return {owner,conv,context,proposal,message,service};
}
async function confirmed(){const f=await fixture();const change=await f.service.confirmProposal({userId:f.owner.person.id,convId:f.conv,messageId:f.message.id,now:new Date()});return {...f,change};}
async function invalidate(f:Awaited<ReturnType<typeof fixture>>){const key=`schedule:${randomUUID()}`;await env.stageBarriers([{effectKey:'revoke',barrier:{barrierType:'binding',binding:f.owner.binding,reason:'fixture'},purgeTarget:{scope:'authorization_disconnect',binding:f.owner.binding,cascadeTargetKinds:[...SLACK_DERIVED_TARGET_KINDS],tombstoneReason:'connection_disconnected'}}],key);return key;}

it('actual proposal confirmation registers schedule and state atomically; ordinary reads mask before physical erasure',async()=>{
  const f=await confirmed(),other=await confirmed(),id=f.change.schedule.id;
  expect(f.change.schedule.request).toBe('private request');
  const copies=(await env.db.pool.query("SELECT target_sub_id FROM slack_derived_copies WHERE target_kind='scheduled_workflow_arg' AND target_id=$1 AND status='active' ORDER BY target_sub_id",[id])).rows;
  expect(copies.map(c=>c.target_sub_id)).toEqual(['name','recurrence','request']);
  const app=express();app.use(express.json());app.use((req,_res,next)=>{(req as any).user={id:req.headers['x-fixture-owner']};next();});app.use('/api',createScheduleRoutes({service:f.service}));
  expect((await request(app).get('/api/schedules').set('x-fixture-owner',other.owner.person.id)).text).not.toContain(id);
  await invalidate(f);
  expect((await request(app).get('/api/schedules').set('x-fixture-owner',f.owner.person.id)).text).not.toContain('private');
  expect((await request(app).post(`/api/schedules/${id}/run-now`).set('x-fixture-owner',f.owner.person.id)).status).toBe(409);
  expect(JSON.stringify(await f.service.list(f.owner.person.id,new Date()))).not.toContain('private');
  await expect(f.service.startRun({userId:f.owner.person.id,scheduleId:id,trigger:'manual',now:new Date()})).rejects.toMatchObject({code:'SCHEDULE_SOURCE_PURGED'});
  const consumer=new SlackMessagePurgeConsumer(env.db.pool,{targetKind:'scheduled_workflow_arg' as any});
  expect((await consumer.runOnce(50)).completed).toBeGreaterThan(0);
  await new SlackMessagePurgeConsumer(env.db.pool).runOnce(50);
  const row=(await env.db.pool.query('SELECT name,request,recurrence,status,pause_reason,next_run_at,version,services FROM schedules WHERE id=$1',[id])).rows[0];
  expect(row).toMatchObject({name:'Slack content is unavailable.',request:'Slack content is unavailable.',recurrence:{},status:'paused',pause_reason:'slack_source_invalidated',next_run_at:null,services:['trello']});
  expect(row.version).toBeGreaterThan(1);
  expect(JSON.stringify((await env.db.pool.query('SELECT content,metadata FROM messages WHERE conv_id=$1',[f.conv])).rows)).not.toContain('private');
  expect((await other.service.list(other.owner.person.id,new Date()))[0]!.request).toBe('private request');
  await expect(f.service.setStatus({userId:f.owner.person.id,scheduleId:id,action:'resume',version:row.version,now:new Date()})).rejects.toMatchObject({code:'SCHEDULE_SOURCE_PURGED'});
},20_000);

it('actual chat history produces source proposal then run title/message/plan provenance without source SSE replay',async()=>{
  const f=await fixture(),sse=new SSEManager(),plans=new PlanRepo(env.db.pool,registry);
  const chat=new ChatService({msgRepo:messages,planRepo:plans,schedules:{repo:f.service.repo,timeZone:zone},eventEmitter:{emit:(event,payload)=>sse.emitEvent(String(payload.conversationId),event,payload)},planner:{routeSchedule:async()=>({services:['trello'],unavailable:[]}),processMessage:async input=>input.scheduledRun?{kind:'plan',summary:'private run plan',thinking:'',warnings:[],steps:[{id:'s1',tool:'trello.create_card',args:{name:'private run card'},description:'private description',dependsOn:[]}]}:f.proposal}});
  await chat.handleUserMessage({conversationId:f.conv,userId:f.owner.person.id,content:'make recurring'});
  await vi.waitFor(async()=>expect((await env.db.pool.query("SELECT count(*)::int AS n FROM messages WHERE conv_id=$1 AND metadata->>'type'='schedule_proposal'",[f.conv])).rows[0].n).toBe(2),{timeout:5000});
  const latest=(await env.db.pool.query("SELECT id FROM messages WHERE conv_id=$1 AND metadata->>'type'='schedule_proposal' ORDER BY created_at DESC,id DESC LIMIT 1",[f.conv])).rows[0];
  const change=await f.service.confirmProposal({userId:f.owner.person.id,convId:f.conv,messageId:latest.id,now:new Date()});
  const run=await f.service.startRun({userId:f.owner.person.id,scheduleId:change.schedule.id,trigger:'manual',now:new Date()});
  const runner=new ScheduleRunner({pool:env.db.pool,timeZone:zone,recordState:(...args)=>f.service.recordState(...args),planRun:(...args)=>chat.planScheduledRun(...args),emit:(conv,event,payload)=>sse.emitEvent(conv,event,payload)});
  await runner.planNow(run.id);
  const persisted=(await env.db.pool.query('SELECT * FROM schedule_runs WHERE id=$1',[run.id])).rows[0];
  expect(persisted.status).toBe('planned');expect(persisted.plan_id).toBeTruthy();
  expect(await f.service.pendingCount(f.owner.person.id,new Date())).toBe(1);
  expect((await env.db.pool.query("SELECT count(*)::int AS n FROM slack_derived_copies WHERE target_kind='scheduled_workflow_arg' AND target_id=$1 AND target_sub_id='title'",[persisted.conv_id])).rows[0].n).toBe(1);
  expect(JSON.stringify(sse.getMissedEvents(persisted.conv_id,0))).not.toContain('private');
  await invalidate(f);
  expect(await f.service.pendingCount(f.owner.person.id,new Date())).toBe(0);
  expect((await new ConversationRepo(env.db.pool).getConversation(persisted.conv_id))?.title).toBe('Slack content is unavailable.');
  for(const targetKind of ['scheduled_workflow_arg','chat_history_message','plan_step_arg'] as const)await new SlackMessagePurgeConsumer(env.db.pool,{targetKind:targetKind as any}).runOnce(50);
  expect(JSON.stringify((await env.db.pool.query('SELECT title FROM conversations WHERE id=$1',[persisted.conv_id])).rows)).not.toContain('private');
},20_000);

it('revoke while real scheduled planning awaits HTTP discards result and cannot publish a late plan',async()=>{
  const f=await confirmed(),plans=new PlanRepo(env.db.pool,registry);let started!:()=>void;
  const entered=new Promise<void>(r=>{started=r;});let release!:()=>void;const waiting=new Promise<void>(r=>{release=r;});
  const path=`/schedule-model-${randomUUID()}`;env.fixture.setHandler(path,async()=>{started();await waiting;return {body:{kind:'plan',thinking:'',summary:'private late plan',warnings:[],steps:[{id:'s1',tool:'trello.create_card',args:{name:'private'},description:'private',dependsOn:[]}]}};});
  const chat=new ChatService({msgRepo:messages,planRepo:plans,schedules:{repo:f.service.repo,timeZone:zone},eventEmitter:{emit:()=>{}},planner:{routeSchedule:async()=>({services:[],unavailable:[]}),processMessage:async input=>(await fetch(env.fixture.url+path,{signal:input.signal})).json()}});
  const runner=new ScheduleRunner({pool:env.db.pool,timeZone:zone,recordState:(...args)=>f.service.recordState(...args),planRun:(...args)=>chat.planScheduledRun(...args)});
  const run=await f.service.startRun({userId:f.owner.person.id,scheduleId:f.change.schedule.id,trigger:'manual',now:new Date()});
  const job=runner.planNow(run.id);await entered;try{await invalidate(f);}finally{release();}await job;
  const row=(await env.db.pool.query('SELECT * FROM schedule_runs WHERE id=$1',[run.id])).rows[0];
  expect(row.status).toBe('discarded');expect(row.plan_id).toBeNull();
  expect((await env.db.pool.query('SELECT count(*)::int AS n FROM plans WHERE conv_id=$1',[row.conv_id])).rows[0].n).toBe(0);
  expect(JSON.stringify((await env.db.pool.query('SELECT content,metadata FROM messages WHERE conv_id=$1',[row.conv_id])).rows)).not.toContain('private late');
},20_000);

it('due tick never calls the planner for a revoked schedule and preserves another owner due at the same instant',async()=>{
  const f=await confirmed(),other=await confirmed(),now=new Date();
  await env.db.pool.query("UPDATE schedules SET next_run_at=$2 WHERE id=ANY($1::uuid[])",[[f.change.schedule.id,other.change.schedule.id],now]);
  await invalidate(f);const planned:string[]=[];
  const runner=new ScheduleRunner({pool:env.db.pool,timeZone:zone,now:()=>now,recordState:(...args)=>f.service.recordState(...args),planRun:async run=>{planned.push(run.scheduleId);return {persist:async()=>({state:'needs_attention'}),afterCommit:()=>{}};}});
  await runner.tick();expect(planned).toEqual([other.change.schedule.id]);
  expect((await env.db.pool.query('SELECT status,next_run_at FROM schedules WHERE id=$1',[f.change.schedule.id])).rows[0]).toEqual({status:'paused',next_run_at:null});
  expect((await env.db.pool.query('SELECT count(*)::int AS n FROM schedule_runs WHERE schedule_id=$1',[f.change.schedule.id])).rows[0].n).toBe(0);
},20_000);

it('authenticated human title replacement survives old purge evidence; search cannot reveal a revoked title',async()=>{
  const f=await confirmed(),convRepo=new ConversationRepo(env.db.pool),conv=(await convRepo.createConversation(f.owner.person.id)).id;
  const held=await env.db.pool.connect();try{await held.query('BEGIN');await registry.prepareConversationWriteInTransaction(held,conv,f.owner.person.id,f.context.segments);
    await held.query("UPDATE conversations SET title='private title' WHERE id=$1",[conv]);await registerScheduleFields(held,registry,'conversations',conv,f.owner.person.id,f.context.segments,['title']);await held.query('COMMIT');}finally{held.release();}
  expect((await convRepo.listConversationPage(f.owner.person.id,{search:'private title'})).conversations).toHaveLength(1);
  await invalidate(f);
  expect((await convRepo.listConversationPage(f.owner.person.id,{search:'private title'})).conversations).toHaveLength(0);
  const consumer=new SlackMessagePurgeConsumer(env.db.pool,{targetKind:'scheduled_workflow_arg' as any});await consumer.runOnce(50);
  const copy=(await env.db.pool.query("SELECT status FROM slack_derived_copies WHERE target_id=$1 AND target_sub_id='title'",[conv])).rows[0];expect(copy.status).toBe('purged');
  await convRepo.renameConversation(conv,f.owner.person.id,'Human replacement');await invalidate(f);
  expect((await consumer.runOnce(50)).retried).toBe(0);
  expect((await convRepo.getConversation(conv))?.title).toBe('Human replacement');
  expect((await env.db.pool.query("SELECT status FROM slack_derived_copies WHERE target_id=$1 AND target_sub_id='title'",[conv])).rows[0].status).toBe('purged');
  await env.db.pool.query("UPDATE conversations SET title='private resurrection' WHERE id=$1",[conv]);
  expect((await convRepo.getConversation(conv))?.title).toBe('Slack content is unavailable.');
  await invalidate(f);expect((await consumer.runOnce(50)).retried).toBeGreaterThan(0);
},20_000);

it('source/copy changes after metadata preparation fail closed without attaching the old acquisition context',async()=>{
  const f=await confirmed(),held=await env.db.pool.connect(),id=f.change.schedule.id;
  try{await held.query('BEGIN');const state=await captureScheduleArtifact(held,registry,'schedules',id);await prelockScheduleArtifacts(held,registry,[state]);
    // A real competing transaction updates the artifact after metadata snapshot.
    await env.db.pool.query("UPDATE schedules SET request='replacement value',version=version+1 WHERE id=$1",[id]);
    await expect(guardScheduleArtifact(held,registry,state!)).rejects.toThrow('SLACK_SCHEDULE_CHANGED');
    await held.query('ROLLBACK');}finally{held.release();}
  expect(JSON.stringify(await f.service.list(f.owner.person.id,new Date()))).not.toContain('replacement value');
},20_000);

it('parallel confirmation has one durable schedule; update replaces fields atomically and terminal purge preserves status',async()=>{
  const f=await fixture(),args={userId:f.owner.person.id,convId:f.conv,messageId:f.message.id,now:new Date()};
  const [a,b]=await Promise.all([f.service.confirmProposal(args),f.service.confirmProposal(args)]);
  expect(a.schedule.id).toBe(b.schedule.id);
  const proposal={...f.proposal,action:'update',name:'private updated',request:'private updated request'};
  const metadata={type:'schedule_proposal',proposal,services:['trello'],nextRuns:[],scheduleId:a.schedule.id,baseVersion:a.schedule.version};
  const changed=await messages.createSlackMessage(f.conv,'assistant','private updated',metadata,{...f.context,selectors:['content','metadata.proposal']});
  const update=await f.service.confirmProposal({...args,messageId:changed.id});expect(update.schedule.name).toBe('private updated');
  const closed=await f.service.setStatus({userId:f.owner.person.id,scheduleId:a.schedule.id,action:'cancel',version:update.schedule.version,now:new Date()});
  await invalidate(f);await new SlackMessagePurgeConsumer(env.db.pool,{targetKind:'scheduled_workflow_arg' as any}).runOnce(50);
  expect((await env.db.pool.query('SELECT status,name,services FROM schedules WHERE id=$1',[a.schedule.id])).rows[0]).toEqual({status:'cancelled',name:'Slack content is unavailable.',services:['trello']});
  expect(closed.schedule.status).toBe('cancelled');
},20_000);

it('real lease reclaim rolls back partial schedule erasure and the replacement worker finishes it',async()=>{
  const f=await confirmed(),key=await invalidate(f),id=f.change.schedule.id;
  const intent=(await env.db.pool.query("SELECT id FROM slack_invalidation_intents WHERE source_event_key=$1 AND target_kind='scheduled_workflow_arg'",[key])).rows[0];
  const real=new SlackMessageContentPurger(),next=new SlackMessagePurgeConsumer(env.db.pool,{targetKind:'scheduled_workflow_arg' as any});let replacement:any;
  const first=new SlackMessagePurgeConsumer(env.db.pool,{targetKind:'scheduled_workflow_arg' as any,purger:{sourceLockKeysInTransaction:(...args)=>real.sourceLockKeysInTransaction(...args),purgeInTransaction:async(client,input)=>{const result=await real.purgeInTransaction(client,input);
    if(!replacement){await env.db.pool.query("UPDATE slack_invalidation_intents SET leased_until=clock_timestamp()-interval '1 second' WHERE id=$1",[intent.id]);replacement=(await next.claim(50)).find(j=>j.id===intent.id);}return result;}}});
  const lease=(await first.claim(50)).find(j=>j.id===intent.id);expect(await first.process(lease!)).toBe('lost');
  expect((await env.db.pool.query('SELECT name,version FROM schedules WHERE id=$1',[id])).rows[0]).toEqual({name:'private schedule',version:1});
  expect(await next.process(replacement)).toBe('completed');
  expect((await env.db.pool.query('SELECT name FROM schedules WHERE id=$1',[id])).rows[0].name).toBe('Slack content is unavailable.');
},20_000);

it('timeout aborts real HTTP planning and stores no late result',async()=>{
  const f=await confirmed();let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});let aborted=false;
  const path=`/slow-schedule-${randomUUID()}`;env.fixture.setHandler(path,async()=>{await gate;return {body:{kind:'answer',text:'private late',lookups:[],usedDirectory:[]}};});
  const chat=new ChatService({msgRepo:messages,planRepo:new PlanRepo(env.db.pool,registry),schedules:{repo:f.service.repo,timeZone:zone},eventEmitter:{emit:()=>{}},planner:{routeSchedule:async()=>({services:[],unavailable:[]}),processMessage:async input=>{try{return await(await fetch(env.fixture.url+path,{signal:input.signal})).json();}finally{aborted=input.signal?.aborted===true;}}}});
  const runner=new ScheduleRunner({pool:env.db.pool,timeZone:zone,planTimeoutMs:150,recordState:(...args)=>f.service.recordState(...args),planRun:(...args)=>chat.planScheduledRun(...args)});
  const run=await f.service.startRun({userId:f.owner.person.id,scheduleId:f.change.schedule.id,trigger:'manual',now:new Date()});
  try{await runner.planNow(run.id);await vi.waitFor(()=>expect(aborted).toBe(true));}finally{release();await runner.stop();}
  const row=(await env.db.pool.query('SELECT status,conv_id,plan_id FROM schedule_runs WHERE id=$1',[run.id])).rows[0];expect(row.status).toBe('planning_failed');expect(row.plan_id).toBeNull();
  expect(JSON.stringify((await env.db.pool.query('SELECT content,metadata FROM messages WHERE conv_id=$1',[row.conv_id])).rows)).not.toContain('private late');
},20_000);

it('uncovered or expired schedule provenance blocks real reads and run creation without partial state',async()=>{
  const f=await confirmed(),id=f.change.schedule.id;
  await env.db.pool.query("UPDATE schedules SET slack_lineage_manifest='[\"name\",\"recurrence\"]' WHERE id=$1",[id]);
  expect(JSON.stringify(await f.service.list(f.owner.person.id,new Date()))).not.toContain('private');
  await expect(f.service.startRun({userId:f.owner.person.id,scheduleId:id,trigger:'manual',now:new Date()})).rejects.toMatchObject({code:'SCHEDULE_SOURCE_PURGED'});
  await env.db.pool.query("UPDATE schedules SET slack_lineage_manifest='[\"name\",\"request\",\"recurrence\"]' WHERE id=$1",[id]);
  await env.db.pool.query("UPDATE slack_derived_provenance_segments SET captured_at=now()-interval '8 days',expires_at=now()-interval '1 day' WHERE derived_copy_id IN(SELECT id FROM slack_derived_copies WHERE target_id=$1)",[id]);
  expect(JSON.stringify(await f.service.list(f.owner.person.id,new Date()))).not.toContain('private');
  await expect(f.service.startRun({userId:f.owner.person.id,scheduleId:id,trigger:'manual',now:new Date()})).rejects.toMatchObject({code:'SCHEDULE_SOURCE_PURGED'});
  expect((await env.db.pool.query('SELECT count(*)::int AS n FROM schedule_runs WHERE schedule_id=$1',[id])).rows[0].n).toBe(0);
},20_000);
