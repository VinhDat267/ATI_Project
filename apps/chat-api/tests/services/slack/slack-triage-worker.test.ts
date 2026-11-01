import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import {OpenAICompatibleProvider,SlackTriagePlanner} from '@wap/planner';
import type {SlackAssistantMode,SlackTriageDecision} from '@wap/tool-schemas';
import {SlackTriageWorker} from '../../../src/services/slack/slack-triage-worker.js';
import {SlackAssistantRepo} from '../../../src/db/repositories/slack-assistant-repo.js';
import {SlackAssistantArtifactRepo} from '../../../src/db/repositories/slack-assistant-artifact-repo.js';
import {SlackFanoutRepo} from '../../../src/db/repositories/slack-fanout-repo.js';
import {SlackEventReceiptRepo} from '../../../src/db/repositories/slack-event-receipt-repo.js';
import {createSlackReadEnvironment,waitFor,type SlackReadEnvironment,type SeededUser} from '../../helpers/slack-private-read-fixture.js';
let env:SlackReadEnvironment,repo:SlackAssistantRepo,artifacts:SlackAssistantArtifactRepo,fanout:SlackFanoutRepo,worker:SlackTriageWorker,seed:SeededUser,messages:any[],modelDecision:SlackTriageDecision|string;
const proposal:SlackTriageDecision={kind:'proposal',title:'Chuẩn bị báo cáo',rationale:'Được nhờ trực tiếp',sourceIndices:[0],relevance:{kind:'mention',sourceIndex:0,evidence:'<@U_ONE>'},intents:[{action:'task',service:'trello',summary:'Chuẩn bị báo cáo'}]};
const modelReply=()=>({model:'fixture',choices:[{message:{content:typeof modelDecision==='string'?modelDecision:JSON.stringify(modelDecision)}}],usage:{prompt_tokens:60,completion_tokens:30}});
const modelRequests=()=>env.fixture.requests.filter(r=>r.path==='/chat/completions');
beforeAll(async()=>{
 env=await createSlackReadEnvironment('triage_worker',f=>({LLM_PROVIDER:'openai-compatible',LLM_MODEL:'fixture',LLM_BASE_URL:f.url,RUNTIME_ACCOUNT_ID:'M4_LOCAL_MODEL'}));
 artifacts=new SlackAssistantArtifactRepo(env.db.pool,env.policyService);repo=new SlackAssistantRepo(env.db.pool,env.policyService,{appId:'A_TEST',automationEnabled:true},artifacts);fanout=new SlackFanoutRepo(env.db.pool,env.policyService);
 worker=new SlackTriageWorker({repo,wrapper:env.buildWrapper().wrapper,policy:env.policyService,planner:new SlackTriagePlanner(new OpenAICompatibleProvider({baseUrl:env.fixture.url,model:'fixture',maxRetries:1,retryDelayMs:1,timeoutRetries:0,timeoutMs:4000})),workerId:'fixture-classifier'});
});
beforeEach(async()=>{
 await env.db.pool.query('DELETE FROM slack_event_receipts');env.fixture.reset();env.fixture.clearHandlers();messages=[];modelDecision=proposal;
 env.fixture.setHandler('/conversations.info',r=>({body:{ok:true,channel:{id:r.query.channel,is_channel:true,is_member:true}}}));
 const history=()=>({body:{ok:true,messages,response_metadata:{next_cursor:''},has_more:false}});
 env.fixture.setHandler('/conversations.history',history);env.fixture.setHandler('/conversations.replies',history);env.fixture.setHandler('/chat/completions',()=>({body:modelReply()}));
 seed=await env.addUser({name:'triage',workspaceId:'T_'+randomUUID().replaceAll('-',''),actorId:'U_ONE'});
 const consent=(await env.consentRepo.getConsent(seed.binding.workspaceId,env.runtimeIdentity.providerId))!;
 await env.consentRepo.grantConsent({workspaceId:seed.binding.workspaceId,providerId:env.runtimeIdentity.providerId,expectedRevision:consent.revision,policyVersion:'v1.0.0',purposes:['triage','planning','storage','manual_lookup','digest'],retentionDays:7,organizationRepresentative:'fixture',evidenceRef:'fixture',recordedBy:'fixture'});await fanout.setRuntime('A_TEST',true);
});
afterAll(async()=>{await env?.close();});
async function configure(mode:SlackAssistantMode){const view=await repo.getConfig(seed.person.id,seed.row.id);return repo.updateConfig(seed.person.id,seed.row.id,view.configVersion,{...view.config,enabled:true,mode});}
async function enqueue(text='<@U_ONE> giúp chuẩn bị báo cáo',threadTs?:string){
 const cut=(await env.db.pool.query(`WITH stamp AS MATERIALIZED(SELECT clock_timestamp() AS value) SELECT to_char(value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS iso,extract(epoch FROM value)::text AS ts FROM stamp`)).rows[0];
 messages.push({type:'message',user:'U_OTHER',text,ts:cut.ts,...(threadTs?{thread_ts:threadTs}:{})});
 const r=(await new SlackEventReceiptRepo(env.db.pool,env.invalidationService).recordOrdinary({appId:'A_TEST',eventId:'Ev_'+randomUUID(),teamId:seed.binding.workspaceId,eventType:'message',eventSubtype:null,eventContext:'ctx',sourceEventTs:cut.ts,sourceEventTimeIso:cut.iso,channelId:'C_TEST',messageTs:cut.ts,threadTs:threadTs??null,payloadHash:'a'.repeat(64),discardReason:null})).receipt;
 const parent=(await fanout.claim(10,'fanout',60,'A_TEST')).find(j=>j.id===r.id)!;await fanout.complete(parent,['U_ONE']);await env.db.pool.query("UPDATE slack_triage_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE receipt_id=$1",[r.id]);
 return (await env.db.pool.query('SELECT id FROM slack_triage_jobs WHERE receipt_id=$1',[r.id])).rows[0].id as string;
}
it.each(['rules','hybrid','ai'] as const)('%s runs through real private Slack HTTP and publishes a guarded registered proposal without writes',async mode=>{
 await configure(mode);const id=await enqueue();await worker.runOnce();const rows=await artifacts.list(seed.person.id,seed.row.id);expect(rows).toHaveLength(1);expect(rows[0]!.body.context[0].text).toContain('<@U_ONE>');expect(rows[0]!.status).toBe('pending');
 expect(modelRequests()).toHaveLength(mode==='rules'?0:1);expect(env.fixture.requests.filter(r=>r.path.startsWith('/chat.')||r.path.startsWith('/views.'))).toHaveLength(0);
 expect((await env.db.pool.query('SELECT status FROM slack_triage_jobs WHERE id=$1',[id])).rows[0].status).toBe('decided');expect((await env.db.pool.query("SELECT count(*)::int AS n FROM slack_derived_copies WHERE target_id=$1 AND status='active'",[rows[0]!.id])).rows[0].n).toBe(1);
});
it.each(['rules','hybrid','ai'] as const)('%s generic chatter keeps AI mode distinct from the hybrid prefilter',async mode=>{
 await configure(mode);modelDecision={kind:'no_action'};const id=await enqueue('@channel chúc mừng sinh nhật mọi người');await worker.runOnce();expect(modelRequests()).toHaveLength(mode==='ai'?1:0);expect(await artifacts.list(seed.person.id,seed.row.id)).toEqual([]);expect((await env.db.pool.query('SELECT kind FROM slack_triage_decisions WHERE job_id=$1',[id])).rows[0].kind).toBe('no_action');
});
it('AI cannot publish a fabricated personal assignment from @channel even when model returns a proposal',async()=>{
 await configure('ai');await enqueue('@channel báo cáo của nhóm khác');await worker.runOnce();expect(modelRequests()).toHaveLength(1);expect(await artifacts.list(seed.person.id,seed.row.id)).toEqual([]);
});
it('invalid JSON is needs_attention, never silently no_action, and the dispatched attempt stays charged',async()=>{
 await configure('ai');modelDecision='private malformed source';const id=await enqueue();await worker.runOnce();expect((await env.db.pool.query('SELECT status,attention_code FROM slack_triage_jobs WHERE id=$1',[id])).rows[0]).toEqual({status:'needs_attention',attention_code:'model_failed'});expect(await artifacts.list(seed.person.id,seed.row.id)).toEqual([]);
 expect((await env.db.pool.query('SELECT calls FROM slack_assistant_budget_usage WHERE connection_id=$1',[seed.row.id])).rows).toEqual([{calls:1},{calls:1}]);
});
it('a pure mode change during actual model HTTP discards the old result and requeues under the new config',async()=>{
 const view=await configure('ai');const id=await enqueue();let release!:()=>void;const pending=new Promise<void>(r=>{release=r;});env.fixture.setHandler('/chat/completions',async()=>{await pending;return {body:modelReply()};});
 const run=worker.runOnce();await waitFor(()=>modelRequests().length===1);await repo.updateConfig(seed.person.id,seed.row.id,view.configVersion,{...view.config,mode:'rules'});release();await run;
 expect((await env.db.pool.query('SELECT status FROM slack_triage_jobs WHERE id=$1',[id])).rows[0].status).toBe('pending');expect(await artifacts.list(seed.person.id,seed.row.id)).toEqual([]);await worker.runOnce();expect(await artifacts.list(seed.person.id,seed.row.id)).toHaveLength(1);expect(modelRequests()).toHaveLength(1);
});
it('source deletion committed during actual model HTTP blocks all proposal publication',async()=>{
 await configure('ai');await enqueue();let release!:()=>void;const pending=new Promise<void>(r=>{release=r;});env.fixture.setHandler('/chat/completions',async()=>{await pending;return {body:modelReply()};});
 const run=worker.runOnce();await waitFor(()=>modelRequests().length===1);await env.stageBarriers([{effectKey:'deleted',barrier:{barrierType:'resource',workspaceId:seed.binding.workspaceId,resourceType:'message',resourceId:JSON.stringify(['C_TEST',messages[0].ts]),deleted:true,reason:'deleted'}}],'delete-'+randomUUID());release();await run;expect(await artifacts.list(seed.person.id,seed.row.id)).toEqual([]);
});
it('every actual retry reserves again and a spent cap prevents a second HTTP request',async()=>{
 const view=await configure('ai');await repo.updateConfig(seed.person.id,seed.row.id,view.configVersion,{...view.config,budget:{...view.config.budget,dailyCalls:1,monthlyCalls:1}});const id=await enqueue();env.fixture.setHandler('/chat/completions',()=>({status:503,body:{error:{message:'fixture transient'}}}));await worker.runOnce();expect(modelRequests()).toHaveLength(1);expect((await env.db.pool.query('SELECT status FROM slack_triage_jobs WHERE id=$1',[id])).rows[0].status).toBe('held_budget');expect(await artifacts.list(seed.person.id,seed.row.id)).toEqual([]);
});
it('missing exact trigger source holds work rather than creating a proposal from earlier context',async()=>{
 await configure('ai');const id=await enqueue();messages=[{type:'message',user:'U_OTHER',text:'<@U_ONE> older request',ts:'1712345678.000001'}];await worker.runOnce();expect(modelRequests()).toHaveLength(0);expect((await env.db.pool.query('SELECT status FROM slack_triage_jobs WHERE id=$1',[id])).rows[0].status).toBe('needs_attention');
});

it('coalesces root plus a fresh reply within30seconds even before the second available_at, using the replies endpoint',async()=>{
 await configure('ai');const root=await enqueue(),reply=await enqueue('<@U_ONE> thêm số liệu doanh thu',messages[0].ts);
 await env.db.pool.query("UPDATE slack_triage_jobs SET available_at=clock_timestamp()+interval '25 seconds' WHERE id=$1",[reply]);
 env.fixture.setHandler('/conversations.history',()=>({body:{ok:true,messages:[messages[0]],response_metadata:{next_cursor:''}}}));
 await worker.runOnce();expect((await env.db.pool.query('SELECT status FROM slack_triage_jobs WHERE id=ANY($1::uuid[])',[[root,reply]])).rows).toEqual([{status:'decided'},{status:'decided'}]);
 expect(modelRequests()).toHaveLength(1);const rows=await artifacts.list(seed.person.id,seed.row.id);expect(rows).toHaveLength(1);expect(rows[0]!.body.context).toHaveLength(2);expect(env.fixture.requests.some(r=>r.path==='/conversations.replies')).toBe(true);
});
it('keeps provider-reported usage separate from conservative reservations on real HTTP',async()=>{
 await configure('ai');const id=await enqueue();await worker.runOnce();const usage=(await env.db.pool.query('SELECT calls,reserved_tokens,actual_tokens,reported_calls FROM slack_assistant_budget_usage WHERE connection_id=$1',[seed.row.id])).rows;
 expect(usage).toHaveLength(2);for(const row of usage){expect(row.calls).toBe(1);expect(BigInt(row.reserved_tokens)).toBeGreaterThan(90n);expect(row.actual_tokens).toBe('90');expect(row.reported_calls).toBe(1);}
 expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_assistant_model_attempts WHERE job_id=$1 AND reported_at IS NOT NULL',[id])).rows[0].n).toBe(1);
});

it('a committed consent revoke after HTTP503 prevents the next actual model attempt',async()=>{
 await configure('ai');const id=await enqueue();env.fixture.setHandler('/chat/completions',async()=>{
  const consent=(await env.consentRepo.getConsent(seed.binding.workspaceId,env.runtimeIdentity.providerId))!;
  await env.consentRepo.revokeConsent({workspaceId:seed.binding.workspaceId,providerId:env.runtimeIdentity.providerId,expectedRevision:consent.revision,recordedBy:'fixture',reason:'fixture'});return {status:503,body:{error:{message:'transient after revoke'}}};
 });await worker.runOnce();expect(modelRequests()).toHaveLength(1);expect(await artifacts.list(seed.person.id,seed.row.id)).toEqual([]);expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_triage_decisions WHERE job_id=$1',[id])).rows[0].n).toBe(0);
 await env.db.pool.query("UPDATE slack_triage_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);expect(await repo.claim(1,'after-revoke')).toEqual([]);
});
it('actual AbortSignal during HTTP prevents late publication and does not refund the dispatched attempt',async()=>{
 await configure('ai');const id=await enqueue(),controller=new AbortController();let release!:()=>void;const response=new Promise<void>(r=>{release=r;});env.fixture.setHandler('/chat/completions',async()=>{await response;return {body:modelReply()};});
 const run=worker.runOnce(1,controller.signal);await waitFor(()=>modelRequests().length===1);controller.abort();await run;release();await new Promise(r=>setTimeout(r,25));
 expect(await artifacts.list(seed.person.id,seed.row.id)).toEqual([]);expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_triage_decisions WHERE job_id=$1',[id])).rows[0].n).toBe(0);expect((await env.db.pool.query('SELECT calls,reserved_tokens,actual_tokens FROM slack_assistant_budget_usage WHERE connection_id=$1',[seed.row.id])).rows.every(r=>r.calls===1&&BigInt(r.reserved_tokens)>0n&&r.actual_tokens===null)).toBe(true);
});
