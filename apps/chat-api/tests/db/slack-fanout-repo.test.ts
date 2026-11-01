import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {SlackFanoutRepo} from '../../src/db/repositories/slack-fanout-repo.js';
import {SlackEventReceiptRepo} from '../../src/db/repositories/slack-event-receipt-repo.js';
import {createSlackReadEnvironment,type SlackReadEnvironment} from '../helpers/slack-private-read-fixture.js';
let env:SlackReadEnvironment,repo:SlackFanoutRepo,receipts:SlackEventReceiptRepo;
const before='2000-01-01T00:00:00.000000Z',source='2001-01-01T00:00:00.123456Z',after='2001-01-01T00:00:00.123457Z';
beforeAll(async()=>{env=await createSlackReadEnvironment('fanout');repo=new SlackFanoutRepo(env.db.pool,env.policyService);receipts=new SlackEventReceiptRepo(env.db.pool,env.invalidationService);});
afterAll(async()=>{await env?.close();});
async function setup(){
 const workspace='T_'+randomUUID().replaceAll('-','');
 const a=await env.addUser({name:'fanout-a',workspaceId:workspace,actorId:'U_A'}),b=await env.addUser({name:'fanout-b',workspaceId:workspace,actorId:'U_B'});
 await repo.setRuntime('A_TEST',true);await repo.setProcessing(a.binding,true);await repo.setProcessing(b.binding,true);
 await env.db.pool.query('UPDATE slack_fanout_runtime SET processing_started_at=$1',[before]);
 await env.db.pool.query('UPDATE slack_connections SET connected_at=$1 WHERE workspace_id=$2',[before,workspace]);
 await env.db.pool.query('UPDATE slack_connections SET identity_epoch_at=$1 WHERE workspace_id=$2',[before,workspace]);
 await env.db.pool.query('UPDATE slack_processing_controls SET processing_started_at=$1,config_revision_at=$1,resumed_at=$1 WHERE connection_id=ANY($2::uuid[])',[before,[a.row.id,b.row.id]]);
 await env.db.pool.query('UPDATE slack_processing_consents SET granted_at=$1 WHERE workspace_id=$2',[before,workspace]);
 await env.db.pool.query('UPDATE slack_processing_consents SET processing_effective_at=$1 WHERE workspace_id=$2',[before,workspace]);
 await env.db.pool.query('UPDATE slack_trusted_providers SET verified_at=$1,updated_at=$1',[before]);
 await env.db.pool.query('UPDATE slack_trusted_providers SET processing_effective_at=$1',[before]);
 return {workspace,a,b};
}
async function receipt(workspace:string,context:string|null='ctx',cut={ts:'978307200.123456',iso:source}){
 const result=await receipts.recordOrdinary({appId:'A_TEST',eventId:'Ev_'+randomUUID(),teamId:workspace,eventType:'message',eventSubtype:null,eventContext:context,sourceEventTs:cut.ts,sourceEventTimeIso:cut.iso,channelId:'C_SHARED',messageTs:cut.ts,payloadHash:'a'.repeat(64),discardReason:null});
 return result.receipt;
}
async function claim(id:string){const jobs=await repo.claim(100,'worker-'+randomUUID(),60,'A_TEST');return jobs.find(job=>job.id===id)!;}
async function jobs(id:string){return (await env.db.pool.query('SELECT * FROM slack_triage_jobs WHERE receipt_id=$1 ORDER BY connection_id',[id])).rows;}
async function waitForBlocker(pid:number){await vi.waitFor(async()=>expect((await env.db.pool.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting',[pid])).rows[0].waiting).toBe(true),{timeout:1500});}
async function cutNow(){return (await env.db.pool.query(`WITH cut AS (SELECT clock_timestamp() AS at) SELECT extract(epoch FROM at)::text AS ts,to_char(at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS iso FROM cut`)).rows[0];}
it('maps all authorized actors to separate owned generation-bound metadata jobs, never the sender',async()=>{
 const f=await setup(),r=await receipt(f.workspace),lease=await claim(r.id);
 expect(await repo.complete(lease,['U_B','U_A','U_A'])).toMatchObject({jobs:2});
 const rows=await jobs(r.id);expect(new Set(rows.map(row=>row.user_id))).toEqual(new Set([f.a.person.id,f.b.person.id]));
 expect(rows.every(row=>row.identity_version===1&&row.workspace_id===f.workspace&&row.policy_reference.binding.atiUserId===row.user_id)).toBe(true);
 expect(JSON.stringify(rows)).not.toContain('xoxp');expect(JSON.stringify(rows)).not.toContain('accessToken');
 await expect(repo.complete(lease,['U_A'])).rejects.toThrow('SLACK_FANOUT_LEASE_LOST');expect(await jobs(r.id)).toHaveLength(2);
});
it('a private DM authorization creates only its actual recipient job; foreign/unknown actors do not map',async()=>{
 const f=await setup(),foreign=await env.addUser({name:'foreign',workspaceId:'T_'+randomUUID().replaceAll('-',''),actorId:'U_FOREIGN'}),r=await receipt(f.workspace);
 expect(await repo.complete(await claim(r.id),['U_A','U_FOREIGN','U_UNKNOWN'])).toMatchObject({jobs:1});
 expect((await jobs(r.id))[0].user_id).toBe(f.a.person.id);expect((await jobs(r.id)).some(row=>row.user_id===foreign.person.id)).toBe(false);
});
it('claims real SQL leases without duplicate ownership and rejects the stale claimant after reclaim',async()=>{
 const f=await setup(),r=await receipt(f.workspace),[left,right]=await Promise.all([repo.claim(100,'left',60,'A_TEST'),repo.claim(100,'right',60,'A_TEST')]);
 const owners=[...left,...right].filter(job=>job.id===r.id);expect(owners).toHaveLength(1);
 await env.db.pool.query("UPDATE slack_event_receipts SET fanout_lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[r.id]);
 const fresh=await claim(r.id);expect(fresh.leaseToken).not.toBe(owners[0]!.leaseToken);
 await expect(repo.complete(owners[0]!,['U_A'])).rejects.toThrow('SLACK_FANOUT_LEASE_LOST');expect(await jobs(r.id)).toHaveLength(0);
 expect(await repo.complete(fresh,['U_A'])).toMatchObject({jobs:1});
});
it.each(['processing_start','consent_grant','identity_epoch','provider_attestation','config_revision','resume'])('denies an event one microsecond before %s, without millisecond truncation',async(field)=>{
 const f=await setup(),r=await receipt(f.workspace);
 const updates:Record<string,[string,unknown[]]>={
  processing_start:['UPDATE slack_fanout_runtime SET processing_started_at=$1 WHERE app_id=$2',[after,'A_TEST']],
  consent_grant:['UPDATE slack_processing_consents SET granted_at=$1 WHERE workspace_id=$2',[after,f.workspace]],
  identity_epoch:['UPDATE slack_connections SET connected_at=$1 WHERE id=$2',[after,f.a.row.id]],
  provider_attestation:['UPDATE slack_trusted_providers SET verified_at=$1',[after]],
  config_revision:['UPDATE slack_processing_controls SET config_revision_at=$1 WHERE connection_id=$2',[after,f.a.row.id]],
  resume:['UPDATE slack_processing_controls SET resumed_at=$1 WHERE connection_id=$2',[after,f.a.row.id]],
 };
 const [sql,values]=updates[field]!;await env.db.pool.query(sql,values);
 // Isolate each exact evidence watermark from the independent SQL-write fence.
 if(field==='consent_grant')await env.db.pool.query('UPDATE slack_processing_consents SET processing_effective_at=$1 WHERE workspace_id=$2',[before,f.workspace]);
 if(field==='identity_epoch')await env.db.pool.query('UPDATE slack_connections SET identity_epoch_at=$1 WHERE id=$2',[before,f.a.row.id]);
 if(field==='provider_attestation')await env.db.pool.query('UPDATE slack_trusted_providers SET processing_effective_at=$1',[before]);
 expect(await repo.complete(await claim(r.id),['U_A'])).toMatchObject({jobs:0});expect(await jobs(r.id)).toHaveLength(0);
});
it('allows exact watermark equality and excludes older receipts after a runtime restart',async()=>{
 const f=await setup(),r=await receipt(f.workspace);await env.db.pool.query('UPDATE slack_fanout_runtime SET processing_started_at=$1',[source]);
 expect(await repo.complete(await claim(r.id),['U_A'])).toMatchObject({jobs:1});
 const old=await receipt(f.workspace);await repo.setRuntime('A_TEST',true);
 expect(await repo.complete(await claim(old.id),['U_A'])).toMatchObject({jobs:0});
});
it('does not create work without explicit processing controls or after pause, policy revoke, disabled runtime or inactive owner',async()=>{
 for(const reason of ['no_controls','pause','policy','runtime','owner']){
  const f=await setup(),r=await receipt(f.workspace),lease=await claim(r.id);
  if(reason==='no_controls')await env.db.pool.query('DELETE FROM slack_processing_controls WHERE connection_id=$1',[f.a.row.id]);
  if(reason==='pause')await repo.setProcessing(f.a.binding,false);
  if(reason==='policy')await env.db.pool.query("UPDATE slack_processing_consents SET status='revoked' WHERE workspace_id=$1",[f.workspace]);
  if(reason==='runtime')await repo.setRuntime('A_TEST',false);
  if(reason==='owner')await env.db.pool.query("UPDATE users SET status='disabled' WHERE id=$1",[f.a.person.id]);
  expect(await repo.complete(lease,['U_A'])).toMatchObject({jobs:0});expect(await jobs(r.id)).toHaveLength(0);
 }
});
it('an app disabled after receipt creation cannot claim new ordinary work',async()=>{
 const f=await setup(),r=await receipt(f.workspace);await repo.setRuntime('A_TEST',false);
 expect((await repo.claim(100,'off-worker',60,'A_TEST')).some(value=>value.id===r.id)).toBe(false);
});
it.each(['disconnect','reconnect','owner_disabled','runtime_off'])('cancels pending metadata jobs on %s while preserving another owner where applicable',async(reason)=>{
 const f=await setup(),r=await receipt(f.workspace);await repo.complete(await claim(r.id),['U_A','U_B']);
 if(reason==='disconnect')await env.connectionRepo.disconnect(f.a.person.id,f.a.row.id);
 if(reason==='reconnect')await env.reconnect(f.a);
 if(reason==='owner_disabled')await env.db.pool.query("UPDATE users SET status='disabled' WHERE id=$1",[f.a.person.id]);
 if(reason==='runtime_off')await repo.setRuntime('A_TEST',false);
 const rows=await jobs(r.id);expect(rows.find(row=>row.user_id===f.a.person.id).status).toBe('cancelled');
 expect(rows.find(row=>row.user_id===f.b.person.id).status).toBe(reason==='runtime_off'?'cancelled':'pending');
});
it('pausing processing cancels queued work and resuming cannot replay the old receipt',async()=>{
 const f=await setup(),r=await receipt(f.workspace);await repo.complete(await claim(r.id),['U_A','U_B']);
 await repo.setProcessing(f.a.binding,false);await repo.setProcessing(f.a.binding,true);
 const rows=await jobs(r.id);expect(rows.find(row=>row.user_id===f.a.person.id).status).toBe('cancelled');expect(rows.find(row=>row.user_id===f.b.person.id).status).toBe('pending');
 await expect(repo.complete(await claim(r.id),['U_A'])).rejects.toThrow('SLACK_FANOUT_LEASE_LOST');
});
it('another app cannot claim the receipt and a forged context cannot authorize completion',async()=>{
 const f=await setup(),r=await receipt(f.workspace);await repo.setRuntime('A_OTHER',true);
 expect((await repo.claim(100,'foreign-app-worker',60,'A_OTHER')).some(value=>value.id===r.id)).toBe(false);
 const lease=await claim(r.id);await expect(repo.complete({...lease,eventContext:'forged-context'},['U_A'])).rejects.toThrow('SLACK_FANOUT_LEASE_LOST');expect(await jobs(r.id)).toHaveLength(0);
 expect(await repo.complete(lease,['U_A'])).toMatchObject({jobs:1});
});
it('does not rebind a pending old receipt to a reconnected identity or a newly granted policy',async()=>{
 const f=await setup(),r=await receipt(f.workspace),lease=await claim(r.id);await env.reconnect(f.a);
 expect(await repo.complete(lease,['U_A'])).toMatchObject({jobs:0});
 const other=await setup(),rr=await receipt(other.workspace),consent=await env.consentRepo.getConsent(other.workspace,env.runtimeIdentity.providerId);
 await env.consentRepo.grantConsent({workspaceId:other.workspace,providerId:env.runtimeIdentity.providerId,expectedRevision:consent!.revision,policyVersion:'v2',purposes:['triage'],retentionDays:1,organizationRepresentative:'fixture',evidenceRef:'fixture',recordedBy:'fixture'});
 expect(await repo.complete(await claim(rr.id),['U_A'])).toMatchObject({jobs:0});
});
it('source deletion committed during authorization resolution blocks all related jobs',async()=>{
 const f=await setup(),r=await receipt(f.workspace),lease=await claim(r.id);
 await env.stageBarriers([{effectKey:'deleted',barrier:{barrierType:'resource',workspaceId:f.workspace,resourceType:'message',resourceId:JSON.stringify(['C_SHARED','978307200.123456']),deleted:true,reason:'deleted'}}], 'delete-'+randomUUID());
 expect(await repo.complete(lease,['U_A','U_B'])).toMatchObject({jobs:0});expect(await jobs(r.id)).toHaveLength(0);
});
it('lease expiry after an actual authority row-lock wait rolls back every job',async()=>{
 const f=await setup(),r=await receipt(f.workspace),lease=await claim(r.id),holder=await env.db.pool.connect();
 await holder.query('BEGIN');await holder.query('SELECT * FROM slack_trusted_providers WHERE id=$1 FOR UPDATE',[env.runtimeIdentity.providerId]);
 await env.db.pool.query("UPDATE slack_event_receipts SET fanout_lease_until=clock_timestamp()+interval '200 milliseconds' WHERE id=$1",[r.id]);
 const pending=repo.complete(lease,['U_A','U_B']);const rejection=expect(pending).rejects.toThrow('SLACK_FANOUT_LEASE_LOST');
 await new Promise(resolve=>setTimeout(resolve,350));await holder.query('COMMIT');holder.release();await rejection;expect(await jobs(r.id)).toHaveLength(0);
});
it('an evidence grant timestamp truncated to milliseconds cannot admit a receipt from before processing was actually permitted',async()=>{
 const f=await setup(),r=await receipt(f.workspace),old=await env.consentRepo.getConsent(f.workspace,env.runtimeIdentity.providerId);
 await env.consentRepo.grantConsent({workspaceId:f.workspace,providerId:env.runtimeIdentity.providerId,expectedRevision:old!.revision,policyVersion:'v1.0.0',purposes:['triage'],retentionDays:1,organizationRepresentative:'fixture',evidenceRef:'fixture',recordedBy:'fixture',grantedAt:after});
 expect(await repo.complete(await claim(r.id),['U_A'])).toMatchObject({jobs:0});
});
it.each(['consent','provider'])('a real %s writer waiting on a provider lock cannot backfill receipts recorded before the authority change completes',async(kind)=>{
 const f=await setup();let consent=await env.consentRepo.getConsent(f.workspace,env.runtimeIdentity.providerId);
 if(kind==='consent')consent=await env.consentRepo.revokeConsent({workspaceId:f.workspace,providerId:env.runtimeIdentity.providerId,expectedRevision:consent!.revision,recordedBy:'fixture',reason:'review-regression'});
 const provider=(await env.db.pool.query('SELECT revision FROM slack_trusted_providers WHERE id=$1',[env.runtimeIdentity.providerId])).rows[0];
 const holder=await env.db.pool.connect();await holder.query('BEGIN');const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 await holder.query('SELECT id FROM slack_trusted_providers WHERE id=$1 FOR UPDATE',[env.runtimeIdentity.providerId]);
 const changing=kind==='consent'?env.consentRepo.grantConsent({workspaceId:f.workspace,providerId:env.runtimeIdentity.providerId,expectedRevision:consent!.revision,policyVersion:'v1.0.0',purposes:['triage'],retentionDays:1,organizationRepresentative:'fixture',evidenceRef:'fixture',recordedBy:'fixture'}):env.consentRepo.attestProvider({id:env.runtimeIdentity.providerId,name:env.runtimeIdentity.name,verified:true,noTraining:true,maxRetentionDays:30,configurationFingerprint:env.runtimeIdentity.fingerprint,evidenceRef:'fixture',verifiedBy:'fixture',verifiedAt:before,expectedRevision:provider.revision});
 void changing.catch(()=>{});let r:any;
 try{await waitForBlocker(pid);r=await receipt(f.workspace,'ctx',await cutNow());}
 finally{await holder.query('COMMIT');holder.release();}
 await changing;expect(await repo.complete(await claim(r.id),['U_A'])).toMatchObject({jobs:0});
});
it('rechecks the app after a real connection row-lock wait before publishing any authorization job',async()=>{
 const f=await setup(),r=await receipt(f.workspace),lease=await claim(r.id),holder=await env.db.pool.connect();
 await holder.query('BEGIN');const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 await holder.query('SELECT id FROM slack_connections WHERE id=$1 FOR UPDATE',[f.a.row.id]);
 const completing=repo.complete(lease,['U_A']);void completing.catch(()=>{});
 try{await waitForBlocker(pid);await holder.query("UPDATE slack_connections SET app_id='A_OTHER' WHERE id=$1",[f.a.row.id]);}
 finally{await holder.query('COMMIT');holder.release();}
 expect(await completing).toMatchObject({jobs:0});expect(await jobs(r.id)).toHaveLength(0);
});
it.each([false,true])('cancels the captured old owner job when connection ownership changes (also disconnect=%s)',async(disconnect)=>{
 const f=await setup(),r=await receipt(f.workspace),newOwner=await env.db.person('replacement-owner');await repo.complete(await claim(r.id),['U_A','U_B']);
 await env.db.pool.query(`UPDATE slack_connections SET user_id=$2${disconnect?",identity_version=identity_version+1,status='disconnected',config=NULL":''} WHERE id=$1`,[f.a.row.id,newOwner.id]);
 const rows=await jobs(r.id);expect(rows.find(row=>row.user_id===f.a.person.id).status).toBe('cancelled');expect(rows.find(row=>row.user_id===f.b.person.id).status).toBe('pending');
});
