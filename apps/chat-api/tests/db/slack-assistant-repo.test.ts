import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import {defaultSlackAssistantConfig} from '@wap/tool-schemas';
import {SlackAssistantRepo} from '../../src/db/repositories/slack-assistant-repo.js';
import {SlackFanoutRepo} from '../../src/db/repositories/slack-fanout-repo.js';
import {SlackEventReceiptRepo} from '../../src/db/repositories/slack-event-receipt-repo.js';
import {createSlackReadEnvironment,type SlackReadEnvironment,type SeededUser} from '../helpers/slack-private-read-fixture.js';
let env:SlackReadEnvironment,repo:SlackAssistantRepo,fanout:SlackFanoutRepo,seed:SeededUser;
beforeAll(async()=>{env=await createSlackReadEnvironment('assistant_repo');repo=new SlackAssistantRepo(env.db.pool,env.policyService,{appId:'A_TEST',automationEnabled:true});fanout=new SlackFanoutRepo(env.db.pool,env.policyService);});
beforeEach(async()=>{await env.db.pool.query('DELETE FROM slack_event_receipts');seed=await env.addUser({name:'assistant',workspaceId:'T_'+randomUUID().replaceAll('-',''),actorId:'U_ONE'});await fanout.setRuntime('A_TEST',true);});
afterAll(async()=>{await env?.close();});
async function enabled(){const view=await repo.getConfig(seed.person.id,seed.row.id),cfg=defaultSlackAssistantConfig();cfg.enabled=true;return repo.updateConfig(seed.person.id,seed.row.id,view.configVersion,cfg);}
async function enqueue(){
 const cut=(await env.db.pool.query(`WITH stamp AS MATERIALIZED(SELECT clock_timestamp() AS value) SELECT to_char(value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS iso,extract(epoch FROM value)::text AS ts FROM stamp`)).rows[0];
 const r=(await new SlackEventReceiptRepo(env.db.pool,env.invalidationService).recordOrdinary({appId:'A_TEST',eventId:'Ev_'+randomUUID(),teamId:seed.binding.workspaceId,eventType:'message',eventSubtype:null,eventContext:'ctx',sourceEventTs:cut.ts,sourceEventTimeIso:cut.iso,channelId:'C_ASSISTANT',messageTs:cut.ts,payloadHash:'a'.repeat(64),discardReason:null})).receipt;
 const lease=(await fanout.claim(10,'fanout',60,'A_TEST')).find(j=>j.id===r.id)!;expect(lease).toBeDefined();await fanout.complete(lease,[seed.binding.slackUserId]);
 await env.db.pool.query("UPDATE slack_triage_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE receipt_id=$1",[r.id]);return (await env.db.pool.query('SELECT id FROM slack_triage_jobs WHERE receipt_id=$1',[r.id])).rows[0].id as string;
}
it('initializes only owned metadata with disabled hybrid config and no credential DTO',async()=>{
 const view=await repo.getConfig(seed.person.id,seed.row.id);expect(view.config).toMatchObject({enabled:false,mode:'hybrid'});expect(view.configVersion).toBe('1');
 expect(JSON.stringify(view)).not.toContain('xoxp-');expect(JSON.stringify(view)).not.toContain('config_fingerprint');
 await expect(repo.getConfig(randomUUID(),seed.row.id)).rejects.toThrow('SLACK_ASSISTANT_NOT_FOUND');
});
it('real concurrent CAS updates accept exactly one expected config revision',async()=>{
 const view=await repo.getConfig(seed.person.id,seed.row.id),rules={...view.config,mode:'rules' as const},ai={...view.config,mode:'ai' as const};
 const results=await Promise.allSettled([repo.updateConfig(seed.person.id,seed.row.id,view.configVersion,rules),repo.updateConfig(seed.person.id,seed.row.id,view.configVersion,ai)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
 expect((await repo.getConfig(seed.person.id,seed.row.id)).configVersion).toBe('2');
});
it('cannot enable processing after real organizational consent revocation',async()=>{
 const view=await repo.getConfig(seed.person.id,seed.row.id),consent=(await env.consentRepo.getConsent(seed.binding.workspaceId,env.runtimeIdentity.providerId))!;
 await env.consentRepo.revokeConsent({workspaceId:seed.binding.workspaceId,providerId:env.runtimeIdentity.providerId,expectedRevision:consent.revision,recordedBy:'fixture',reason:'fixture'});
 await expect(repo.updateConfig(seed.person.id,seed.row.id,view.configVersion,{...view.config,enabled:true})).rejects.toThrow('SLACK_POLICY_DENIED');
 expect((await repo.getConfig(seed.person.id,seed.row.id)).config.enabled).toBe(false);
});
it('enabling processing captures current SQL controls, while pure mode changes preserve queued work',async()=>{
 const view=await enabled(),id=await enqueue();const before=(await env.db.pool.query('SELECT version::text,processing_started_at::text,config_revision_at::text,resumed_at::text FROM slack_processing_controls WHERE connection_id=$1',[seed.row.id])).rows[0];
 await repo.updateConfig(seed.person.id,seed.row.id,view.configVersion,{...view.config,mode:'rules'});
 expect((await env.db.pool.query('SELECT version::text,processing_started_at::text,config_revision_at::text,resumed_at::text FROM slack_processing_controls WHERE connection_id=$1',[seed.row.id])).rows[0]).toEqual(before);
 expect((await env.db.pool.query('SELECT status FROM slack_triage_jobs WHERE id=$1',[id])).rows[0].status).toBe('pending');
});
it('actual parallel claimers retain one SQL running lease per connection',async()=>{
 await enabled();await enqueue();await enqueue();
 const [a,b]=await Promise.all([repo.claim(5,'worker-a'),repo.claim(5,'worker-b')]);expect(a.length+b.length).toBe(1);
 expect((await env.db.pool.query("SELECT count(*)::int AS n FROM slack_triage_jobs WHERE connection_id=$1 AND status='running'",[seed.row.id])).rows[0].n).toBe(1);
});
it('changed in-flight config requeues without publishing a decision or reusing old results',async()=>{
 const view=await enabled(),id=await enqueue(),lease=(await repo.claim(1,'old-mode'))[0]!;
 await repo.updateConfig(seed.person.id,seed.row.id,view.configVersion,{...view.config,mode:'rules'});
 expect(await repo.publish(lease,{kind:'no_action'},[])).toMatchObject({status:'requeued'});
 expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_triage_decisions WHERE job_id=$1',[id])).rows[0].n).toBe(0);
 expect((await env.db.pool.query('SELECT status FROM slack_triage_jobs WHERE id=$1',[id])).rows[0].status).toBe('pending');
});
it('budget reservation is SQL-atomic across attempts and keeps unprocessed work held',async()=>{
 let view=await enabled();view=await repo.updateConfig(seed.person.id,seed.row.id,view.configVersion,{...view.config,budget:{...view.config.budget,dailyCalls:1,monthlyCalls:1,dailyTokens:2500,monthlyTokens:5000}});
 const id=await enqueue(),lease=(await repo.claim(1,'budget'))[0]!;await repo.reserveAttempt(lease,2500);
 await expect(repo.reserveAttempt(lease,2500)).rejects.toThrow('SLACK_BUDGET_HELD');
 expect((await env.db.pool.query('SELECT calls,reserved_tokens FROM slack_assistant_budget_usage WHERE connection_id=$1 ORDER BY period_kind',[seed.row.id])).rows).toEqual([{calls:1,reserved_tokens:'2500'},{calls:1,reserved_tokens:'2500'}]);
 expect((await env.db.pool.query('SELECT status FROM slack_triage_jobs WHERE id=$1',[id])).rows[0].status).toBe('held_budget');
 expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_triage_decisions WHERE job_id=$1',[id])).rows[0].n).toBe(0);
 expect(await repo.claim(1,'another-worker')).toEqual([]);
});
it('expired pending jobs become needs_attention rather than no_action or discarded content',async()=>{
 await enabled();const id=await enqueue();await env.db.pool.query("UPDATE slack_triage_jobs SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);
 expect(await repo.claim(1,'expiry')).toEqual([]);expect((await env.db.pool.query('SELECT status FROM slack_triage_jobs WHERE id=$1',[id])).rows[0].status).toBe('needs_attention');
});
it('expired lease cannot finish after a fresh worker reclaims it',async()=>{
 await enabled();const id=await enqueue(),old=(await repo.claim(1,'old'))[0]!;await env.db.pool.query("UPDATE slack_triage_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);
 const current=(await repo.claim(1,'fresh'))[0]!;expect(current.leaseToken).not.toBe(old.leaseToken);
 await expect(repo.publish(old,{kind:'no_action'},[])).rejects.toThrow('SLACK_TRIAGE_LEASE_LOST');
 expect(await repo.publish(current,{kind:'no_action'},[])).toMatchObject({status:'published'});
});

it('concurrent model attempts cannot exceed the actual SQL call cap',async()=>{
 let view=await enabled();await repo.updateConfig(seed.person.id,seed.row.id,view.configVersion,{...view.config,budget:{...view.config.budget,dailyCalls:1,monthlyCalls:1}});await enqueue();const lease=(await repo.claim(1,'race'))[0]!;
 const results=await Promise.allSettled([repo.reserveAttempt(lease,512),repo.reserveAttempt(lease,512)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect((await env.db.pool.query('SELECT calls,reserved_tokens FROM slack_assistant_budget_usage WHERE connection_id=$1',[seed.row.id])).rows).toEqual([{calls:1,reserved_tokens:'512'},{calls:1,reserved_tokens:'512'}]);
});
it('budget hold suppresses other pending jobs on the same connection',async()=>{
 let view=await enabled();await repo.updateConfig(seed.person.id,seed.row.id,view.configVersion,{...view.config,budget:{...view.config.budget,dailyCalls:1,monthlyCalls:1}});await enqueue();const lease=(await repo.claim(1,'cap'))[0]!;
 await repo.reserveAttempt(lease,100);await expect(repo.reserveAttempt(lease,100)).rejects.toThrow('SLACK_BUDGET_HELD');await enqueue();expect(await repo.claim(10,'no-fallback')).toEqual([]);
});
it('revoked consent denies a real reservation and publication without counters or decisions',async()=>{
 await enabled();await enqueue();const lease=(await repo.claim(1,'revoked'))[0]!,consent=(await env.consentRepo.getConsent(seed.binding.workspaceId,env.runtimeIdentity.providerId))!;
 await env.consentRepo.revokeConsent({workspaceId:seed.binding.workspaceId,providerId:env.runtimeIdentity.providerId,expectedRevision:consent.revision,recordedBy:'fixture',reason:'fixture'});
 await expect(repo.reserveAttempt(lease,512)).rejects.toThrow();await expect(repo.publish(lease,{kind:'no_action'},[])).rejects.toThrow();
 expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_assistant_budget_usage WHERE connection_id=$1',[seed.row.id])).rows[0].n).toBe(0);
 expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_triage_decisions WHERE job_id=$1',[lease.id])).rows[0].n).toBe(0);
});
it('processing disable cancels a running SQL job immediately',async()=>{
 const view=await enabled();const id=await enqueue(),lease=(await repo.claim(1,'disable'))[0]!;await repo.updateConfig(seed.person.id,seed.row.id,view.configVersion,{...view.config,enabled:false});
 expect((await env.db.pool.query('SELECT status FROM slack_triage_jobs WHERE id=$1',[id])).rows[0].status).toBe('cancelled');await expect(repo.publish(lease,{kind:'no_action'},[])).rejects.toThrow('SLACK_TRIAGE_LEASE_LOST');
});
it('checks SQL lease time after an actual provider row-lock wait',async()=>{
 await enabled();await enqueue();const lease=(await repo.claim(1,'row-wait'))[0]!,blocker=await env.db.pool.connect();await blocker.query('BEGIN');
 try{
  await blocker.query('SELECT id FROM slack_trusted_providers WHERE id=$1 FOR UPDATE',[env.runtimeIdentity.providerId]);
  await env.db.pool.query("UPDATE slack_triage_jobs SET lease_until=clock_timestamp()+interval '300 milliseconds' WHERE id=$1",[lease.id]);
  const result=repo.publish(lease,{kind:'no_action'},[]);const observed=result.then(()=>({ok:true}),e=>({error:e.message}));
  for(let n=0;n<100;n++){const waiting=await env.db.pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT id FROM slack_trusted_providers%' AND pid<>pg_backend_pid()");if(waiting.rowCount)break;if(n===99)throw new Error('actual SQL wait not observed');await new Promise(r=>setTimeout(r,5));}
  await blocker.query('SELECT pg_sleep(0.35)');await blocker.query('COMMIT');expect(await observed).toEqual({error:'SLACK_TRIAGE_LEASE_LOST'});
  expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_triage_decisions WHERE job_id=$1',[lease.id])).rows[0].n).toBe(0);
 }finally{await blocker.query('ROLLBACK');blocker.release();}
});
it('follow intervals apply only to new events and preserve exact timestamp identity',async()=>{
 await enabled();await enqueue();const lease=(await repo.claim(1,'follow'))[0]!,trigger=lease.triggers[0]!;expect(await repo.isFollowed(lease,trigger)).toBe(false);
 await repo.followThread(seed.person.id,seed.row.id,trigger.channelId,trigger.threadTs,true);expect(await repo.isFollowed(lease,trigger)).toBe(false);
 const later=(await env.db.pool.query('SELECT extract(epoch FROM clock_timestamp())::text AS ts')).rows[0].ts;expect(await repo.isFollowed(lease,{...trigger,sourceEventTs:later})).toBe(true);
 await repo.followThread(seed.person.id,seed.row.id,trigger.channelId,trigger.threadTs,false);expect(await repo.isFollowed(lease,{...trigger,sourceEventTs:later})).toBe(true);
 const after=(await env.db.pool.query('SELECT extract(epoch FROM clock_timestamp())::text AS ts')).rows[0].ts;expect(await repo.isFollowed(lease,{...trigger,sourceEventTs:after})).toBe(false);
});

it('a held owner with100 pending receipts cannot starve a different eligible connection',async()=>{
 const view=await enabled();await repo.updateConfig(seed.person.id,seed.row.id,view.configVersion,{...view.config,budget:{...view.config.budget,dailyCalls:1,monthlyCalls:1}});await enqueue();const held=(await repo.claim(1,'hold-a'))[0]!;await repo.reserveAttempt(held,100);await expect(repo.reserveAttempt(held,100)).rejects.toThrow('SLACK_BUDGET_HELD');
 await env.db.pool.query(`WITH more AS(INSERT INTO slack_event_receipts(slack_app_id,event_id,team_id,event_type,source_event_ts,source_event_time,event_context,channel_id,message_ts,payload_hash,status)
 SELECT r.slack_app_id,'Ev_STARVE_'||n,r.team_id,r.event_type,r.source_event_ts,r.source_event_time,r.event_context,r.channel_id,r.message_ts,r.payload_hash,'processed' FROM slack_triage_jobs j JOIN slack_event_receipts r ON r.id=j.receipt_id CROSS JOIN generate_series(1,100) n WHERE j.id=$1 RETURNING id)
 INSERT INTO slack_triage_jobs(receipt_id,connection_id,user_id,workspace_id,slack_user_id,identity_version,policy_reference,processing_version,runtime_version,available_at)
 SELECT more.id,j.connection_id,j.user_id,j.workspace_id,j.slack_user_id,j.identity_version,j.policy_reference,j.processing_version,j.runtime_version,clock_timestamp()-interval '1 second' FROM more CROSS JOIN slack_triage_jobs j WHERE j.id=$1`,[held.id]);
 const queue=(await repo.getConfig(seed.person.id,seed.row.id)).queue;expect(queue).toMatchObject({pending:100,held:1,running:0});
 const original=seed;seed=await env.addUser({name:'not-starved',workspaceId:'T_'+randomUUID().replaceAll('-',''),actorId:'U_ONE'});await enabled();const id=await enqueue();seed=original;
 const leases=await repo.claim(1,'fair-worker');expect(leases).toHaveLength(1);expect(leases[0]!.id).toBe(id);
});
