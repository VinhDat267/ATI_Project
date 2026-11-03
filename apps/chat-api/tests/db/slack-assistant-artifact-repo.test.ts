import {SlackDerivedExpiryFanout} from '../../src/services/slack/slack-derived-expiry.js';
import {SlackDerivedPolicyFanout} from '../../src/services/slack/slack-derived-policy-fanout.js';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import type {SlackTriageDecision} from '@wap/tool-schemas';
import {SlackAssistantRepo,type SlackTriageLease} from '../../src/db/repositories/slack-assistant-repo.js';
import {SlackAssistantArtifactRepo} from '../../src/db/repositories/slack-assistant-artifact-repo.js';
import {SlackFanoutRepo} from '../../src/db/repositories/slack-fanout-repo.js';
import {SlackEventReceiptRepo} from '../../src/db/repositories/slack-event-receipt-repo.js';
import {SlackMessagePurgeConsumer} from '../../src/services/slack/slack-message-purge-consumer.js';
import {createSlackReadEnvironment,type SlackReadEnvironment,type SeededUser} from '../helpers/slack-private-read-fixture.js';
let env:SlackReadEnvironment,repo:SlackAssistantRepo,artifacts:SlackAssistantArtifactRepo,fanout:SlackFanoutRepo,seed:SeededUser;
const text='Ngân sách khách hàng bí mật: <@U_ONE> giúp chuẩn bị báo cáo';
const decision:SlackTriageDecision={kind:'proposal',title:'Chuẩn bị báo cáo',rationale:'Yêu cầu trực tiếp',sourceIndices:[0],relevance:{kind:'mention',sourceIndex:0,evidence:'<@U_ONE>'},intents:[{action:'task',service:'trello',summary:'Chuẩn bị báo cáo khách hàng'}]};
beforeAll(async()=>{env=await createSlackReadEnvironment('assistant_artifact');artifacts=new SlackAssistantArtifactRepo(env.db.pool,env.policyService);repo=new SlackAssistantRepo(env.db.pool,env.policyService,{appId:'A_TEST',automationEnabled:true},artifacts);fanout=new SlackFanoutRepo(env.db.pool,env.policyService);});
beforeEach(async()=>{
 await env.db.pool.query('DELETE FROM slack_event_receipts');seed=await env.addUser({name:'artifact',workspaceId:'T_'+randomUUID().replaceAll('-',''),actorId:'U_ONE'});
 const consent=(await env.consentRepo.getConsent(seed.binding.workspaceId,env.runtimeIdentity.providerId))!;
 await env.consentRepo.grantConsent({workspaceId:seed.binding.workspaceId,providerId:env.runtimeIdentity.providerId,expectedRevision:consent.revision,policyVersion:'v1.0.0',purposes:['triage','planning','manual_lookup','storage','digest'],retentionDays:7,organizationRepresentative:'fixture',evidenceRef:'fixture',recordedBy:'fixture'});
 await fanout.setRuntime('A_TEST',true);const view=await repo.getConfig(seed.person.id,seed.row.id);await repo.updateConfig(seed.person.id,seed.row.id,view.configVersion,{...view.config,enabled:true});
});
afterAll(async()=>{await env?.close();});
async function claimed(){
 const cut=(await env.db.pool.query(`WITH stamp AS MATERIALIZED(SELECT clock_timestamp() AS value) SELECT to_char(value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS iso,extract(epoch FROM value)::text AS ts FROM stamp`)).rows[0];
 const r=(await new SlackEventReceiptRepo(env.db.pool,env.invalidationService).recordOrdinary({appId:'A_TEST',eventId:'Ev_'+randomUUID(),teamId:seed.binding.workspaceId,eventType:'message',eventSubtype:null,eventContext:'ctx',sourceEventTs:cut.ts,sourceEventTimeIso:cut.iso,channelId:'C_ASSISTANT',messageTs:cut.ts,payloadHash:'a'.repeat(64),discardReason:null})).receipt;
 const parent=(await fanout.claim(10,'fanout',60,'A_TEST')).find(j=>j.id===r.id)!;await fanout.complete(parent,[seed.binding.slackUserId]);await env.db.pool.query("UPDATE slack_triage_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE receipt_id=$1",[r.id]);
 return (await repo.claim(1,'classifier'))[0]!;
}
function context(lease:SlackTriageLease){return [{text,user:'U_OTHER',ts:lease.triggers[0]!.messageTs,channelId:'C_ASSISTANT',conversationType:'public' as const}];}
function segments(lease:SlackTriageLease){return [{sourceRef:{binding:lease.binding,resourceType:'message' as const,resourceId:JSON.stringify(['C_ASSISTANT',lease.triggers[0]!.messageTs]),revision:lease.triggers[0]!.messageTs},acquisitionPolicyRef:lease.policyReference,storagePolicyRef:{...lease.policyReference,purpose:'storage' as const,requestedRetentionDays:1},captureHash:'a'.repeat(64),channelId:'C_ASSISTANT',capturedAt:new Date().toISOString()}];}
async function publish(){const lease=await claimed(),result=await repo.publish(lease,decision,segments(lease),undefined,context(lease));expect(result.status).toBe('published');return {lease,id:result.artifactId!};}
it('publishes body and registry atomically, then returns only owned guarded proposals',async()=>{
 const f=await publish(),row=(await env.db.pool.query('SELECT * FROM slack_assistant_artifacts WHERE id=$1',[f.id])).rows[0];expect(row.body_json.context[0].text).toBe(text);
 const copy=(await env.db.pool.query("SELECT * FROM slack_derived_copies WHERE target_id=$1 AND target_kind='proposal_excerpt'",[f.id])).rows[0];expect(copy.status).toBe('active');expect(copy.target_sub_id).toBe('body_json');
 expect((await artifacts.get(seed.person.id,f.id,'planning')).body.decision).toEqual(decision);expect(await artifacts.list(seed.person.id,seed.row.id)).toHaveLength(1);
 await expect(artifacts.get(randomUUID(),f.id,'planning')).rejects.toThrow('SLACK_PROPOSAL_NOT_FOUND');expect(await artifacts.list(randomUUID(),seed.row.id)).toEqual([]);
 expect(JSON.stringify((await env.db.pool.query('SELECT * FROM slack_triage_decisions WHERE job_id=$1',[f.lease.id])).rows)).not.toContain('báo cáo');
});
it('requires real source coverage and rolls back all source bytes when storage consent is missing',async()=>{
 const lease=await claimed();await expect(repo.publish(lease,decision,[],undefined,context(lease))).rejects.toThrow();
 expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_assistant_artifacts WHERE connection_id=$1',[seed.row.id])).rows[0].n).toBe(0);
 const s=segments(lease);s[0]!.storagePolicyRef.consentRevision='999';await expect(repo.publish(lease,decision,s,undefined,context(lease))).rejects.toThrow();
 expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_triage_decisions WHERE job_id=$1',[lease.id])).rows[0].n).toBe(0);
});
it('blocks raw SQL payload tampering rather than treating an absent proof as source-free',async()=>{
 const f=await publish();await env.db.pool.query("UPDATE slack_assistant_artifacts SET body_json=jsonb_set(body_json,'{context,0,text}',to_jsonb('tampered private text'::text)) WHERE id=$1",[f.id]);
 const read=await artifacts.get(seed.person.id,f.id,'planning');expect(read.status).toBe('stale');expect(read.body).toBeNull();expect(JSON.stringify(await artifacts.list(seed.person.id,seed.row.id))).not.toContain('tampered');
});
it('a metadata binding swap cannot relabel source content into another workspace',async()=>{
 const f=await publish(),other=await env.addUser({name:'other-binding',workspaceId:'T_'+randomUUID().replaceAll('-',''),actorId:'U_ONE'});
 await env.db.pool.query('UPDATE slack_assistant_artifacts SET connection_id=$2 WHERE id=$1',[f.id,other.row.id]);expect((await artifacts.get(seed.person.id,f.id,'planning')).body).toBeNull();
});
it('review expiry blocks approval candidates',async()=>{
 const f=await publish();await env.db.pool.query("UPDATE slack_assistant_artifacts SET review_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[f.id]);expect((await artifacts.get(seed.person.id,f.id,'planning')).body).toBeNull();
});
it('source delete blocks a proposal immediately and physically erases its only payload selector with flags absent',async()=>{
 const f=await publish();await env.stageBarriers([{effectKey:'deleted',barrier:{barrierType:'resource',workspaceId:seed.binding.workspaceId,resourceType:'message',resourceId:JSON.stringify(['C_ASSISTANT',f.lease.triggers[0]!.messageTs]),deleted:true,reason:'deleted'},purgeTarget:{scope:'resource_lifecycle',workspaceId:seed.binding.workspaceId,resourceType:'message',resourceId:JSON.stringify(['C_ASSISTANT',f.lease.triggers[0]!.messageTs]),tombstoneReason:'source_deleted',cascadeTargetKinds:['proposal_excerpt']}}], 'delete-'+randomUUID());
 expect((await artifacts.get(seed.person.id,f.id,'planning')).body).toBeNull();const consumer=new SlackMessagePurgeConsumer(env.db.pool,{targetKind:'proposal_excerpt'});await consumer.runOnce();
 const row=(await env.db.pool.query('SELECT body_json,status FROM slack_assistant_artifacts WHERE id=$1',[f.id])).rows[0];expect(row.body_json).toEqual({__slack_purged:true});expect(row.status).toBe('stale');
 expect(JSON.stringify((await env.db.pool.query('SELECT payload FROM slack_derived_artifact_payloads WHERE copy_id IN (SELECT id FROM slack_derived_copies WHERE target_id=$1)',[f.id])).rows)).not.toContain('Ngân sách');
});
it('reject is revision-CAS and produces no external execution',async()=>{
 const f=await publish();expect(await artifacts.reject(seed.person.id,f.id,'1')).toMatchObject({status:'rejected',revision:'2'});await expect(artifacts.reject(seed.person.id,f.id,'1')).rejects.toThrow('SLACK_PROPOSAL_VERSION_CONFLICT');
 expect(env.fixture.requests.filter(r=>r.method==='POST')).toHaveLength(0);
});

it('missing active lineage never falls back to an ordinary source-free artifact',async()=>{
 const f=await publish();await env.db.pool.query('DELETE FROM slack_derived_copies WHERE target_id=$1',[f.id]);expect((await artifacts.get(seed.person.id,f.id,'planning')).body).toBeNull();
});
it('policy revocation blocks reads immediately and physically purges the concrete proposal kind',async()=>{
 const f=await publish(),consent=(await env.consentRepo.getConsent(seed.binding.workspaceId,env.runtimeIdentity.providerId))!;
 await env.consentRepo.revokeConsent({workspaceId:seed.binding.workspaceId,providerId:env.runtimeIdentity.providerId,expectedRevision:consent.revision,recordedBy:'fixture',reason:'fixture'});
 expect((await artifacts.get(seed.person.id,f.id,'planning')).body).toBeNull();await new SlackDerivedPolicyFanout(env.db.pool,env.invalidationService).runOnce();await new SlackMessagePurgeConsumer(env.db.pool,{targetKind:'proposal_excerpt'}).runOnce();
 expect((await env.db.pool.query('SELECT body_json FROM slack_assistant_artifacts WHERE id=$1',[f.id])).rows[0].body_json).toEqual({__slack_purged:true});
});
it('lowering retention expires existing assistant copies without extending any stored capture',async()=>{
 let view=await repo.getConfig(seed.person.id,seed.row.id);view=await repo.updateConfig(seed.person.id,seed.row.id,view.configVersion,{...view.config,retentionDays:7});
 const lease=await claimed(),s=segments(lease);s[0]!.storagePolicyRef.requestedRetentionDays=7;const result=await repo.publish(lease,decision,s,undefined,context(lease));
 await env.db.pool.query("WITH stamp AS MATERIALIZED(SELECT clock_timestamp() AS at) UPDATE slack_derived_provenance_segments SET captured_at=stamp.at-interval '2 days',expires_at=stamp.at+interval '5 days' FROM stamp WHERE derived_copy_id IN (SELECT id FROM slack_derived_copies WHERE target_id=$1)",[result.artifactId]);
 await repo.updateConfig(seed.person.id,seed.row.id,view.configVersion,{...view.config,retentionDays:1});
 expect((await env.db.pool.query('SELECT expires_at<=clock_timestamp() AS expired FROM slack_derived_provenance_segments WHERE derived_copy_id IN (SELECT id FROM slack_derived_copies WHERE target_id=$1)',[result.artifactId])).rows[0].expired).toBe(true);
 await new SlackDerivedExpiryFanout(env.db.pool).runOnce();await new SlackMessagePurgeConsumer(env.db.pool,{targetKind:'proposal_excerpt'}).runOnce();expect((await env.db.pool.query('SELECT body_json FROM slack_assistant_artifacts WHERE id=$1',[result.artifactId])).rows[0].body_json).toEqual({__slack_purged:true});
});

it('triage/storage consent permits reading an Inbox proposal without silently granting planning',async()=>{
 const consent=(await env.consentRepo.getConsent(seed.binding.workspaceId,env.runtimeIdentity.providerId))!;await env.consentRepo.grantConsent({workspaceId:seed.binding.workspaceId,providerId:env.runtimeIdentity.providerId,expectedRevision:consent.revision,policyVersion:'v1.0.0',purposes:['triage','storage'],retentionDays:7,organizationRepresentative:'fixture',evidenceRef:'fixture',recordedBy:'fixture'});
 const f=await publish(),rows=await artifacts.list(seed.person.id,seed.row.id);expect(rows).toHaveLength(1);expect(rows[0]!.body?.context[0].text).toBe(text);expect((await artifacts.get(seed.person.id,f.id,'planning')).body).toBeNull();
});
