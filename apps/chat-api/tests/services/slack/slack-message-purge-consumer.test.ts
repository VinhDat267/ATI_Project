import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import { SLACK_DERIVED_TARGET_KINDS, type SlackPurgeTarget, type SlackPolicyReference } from '@wap/tool-schemas';
import { createSlackReadEnvironment, TEST_ENV, type SlackReadEnvironment } from '../../helpers/slack-private-read-fixture.js';
import { SlackDerivedLineageRepo, type RegisterDerivedCopyInput } from '../../../src/db/repositories/slack-derived-lineage-repo.js';
import { SlackMessageContentPurger } from '../../../src/services/slack/slack-message-content-purger.js';
import { SlackMessagePurgeConsumer, type MessagePurgeLease } from '../../../src/services/slack/slack-message-purge-consumer.js';
import { SlackInvalidationRunner } from '../../../src/services/slack/slack-invalidation-runner.js';
import { SlackSourceRepo } from '../../../src/db/repositories/slack-source-repo.js';
import { SlackPolicyEventConsumer } from '../../../src/services/slack/slack-policy-event-consumer.js';
import type { SlackInvalidationBarrier } from '../../../src/services/slack/slack-invalidation-service.js';

describe('03B2C fenced registered-message erasure on real PostgreSQL',()=>{
  let env:SlackReadEnvironment,repo:SlackDerivedLineageRepo;
  beforeAll(async()=>{env=await createSlackReadEnvironment('slack_message_consumer');repo=new SlackDerivedLineageRepo(env.db.pool,env.policyService);});
  beforeEach(async()=>{await env.db.pool.query('DELETE FROM slack_invalidation_intents; DELETE FROM slack_invalidation_barriers; DELETE FROM slack_invalidation_receipts; DELETE FROM slack_derived_copies');});
  afterAll(async()=>{await env?.close();});
  async function fixture(revision='1730000000.000001') {
    const seed=await env.addUser({name:'purge-consumer',workspaceId:`T${randomUUID()}`,actorId:`U${randomUUID()}`});
    const current=await env.consentRepo.getConsent(seed.binding.workspaceId,env.runtimeIdentity.providerId);
    await env.consentRepo.grantConsent({workspaceId:seed.binding.workspaceId,providerId:env.runtimeIdentity.providerId,policyVersion:'v1.0.0',expectedRevision:current!.revision,purposes:['storage','manual_lookup'],retentionDays:14,organizationRepresentative:'fixture',evidenceRef:'FIXTURE',recordedBy:'fixture'});
    const decision=await env.policyService.resolveSlackModelPolicy({binding:seed.binding,purpose:'storage',requestedRetentionDays:7,env:TEST_ENV});
    if(!decision.allowed)throw new Error('Fixture storage denied');const storage=decision.policyReference as SlackPolicyReference;
    const conv=(await env.db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id',[seed.person.id])).rows[0].id;
    const input:RegisterDerivedCopyInput={atiUserId:seed.person.id,targetKind:'chat_history_message',targetId:'',targetSubId:'content',segments:[{
      sourceRef:{binding:seed.binding,resourceType:'message',resourceId:JSON.stringify(['C_QUEUE','1730000000.000001']),revision},storagePolicyRef:storage,
      acquisitionPolicyRef:{...storage,purpose:'manual_lookup',requestedRetentionDays:0},captureHash:'a'.repeat(64),capturedAt:new Date().toISOString()}]};
    const targetId=(await env.db.pool.query("INSERT INTO messages(conv_id,role,content) VALUES($1,'assistant','Queue fixture') RETURNING id",[conv])).rows[0].id;input.targetId=targetId;
    const c=await env.db.pool.connect();let copy;
    try {await c.query('BEGIN');copy=await repo.registerDerivedCopyInTransaction(c,input);await c.query('COMMIT');}finally{c.release();}
    return {seed,input,copy:copy!,conv,targetId};
  }
  type F=Awaited<ReturnType<typeof fixture>>;
  async function stage(f:F,t?:SlackPurgeTarget,b?:SlackInvalidationBarrier) {
    const key=`consumer:${randomUUID()}`,c=await env.db.pool.connect();
    try {await c.query('BEGIN');await env.invalidationService.stageInTransaction(c,{sourceEventKey:key,effects:[{effectKey:'purge',barrier:b??{barrierType:'binding',binding:f.seed.binding,reason:'disconnect'},purgeTarget:t??{scope:'authorization_disconnect',binding:f.seed.binding,cascadeTargetKinds:[...SLACK_DERIVED_TARGET_KINDS],tombstoneReason:'connection_disconnected'}}]});await c.query('COMMIT');}finally{c.release();}
    return (await env.db.pool.query("SELECT * FROM slack_invalidation_intents WHERE source_event_key=$1 AND target_kind='chat_history_message'",[key])).rows[0];
  }
  async function content(f:F){return (await env.db.pool.query('SELECT content FROM messages WHERE id=$1',[f.targetId])).rows[0].content;}
  async function job(id:string){return (await env.db.pool.query('SELECT status,last_error FROM slack_invalidation_intents WHERE id=$1',[id])).rows[0];}
  function onlyLease(rows:MessagePurgeLease[]):MessagePurgeLease {expect(rows).toHaveLength(1);return rows[0]!;}
  it('atomically erases matching copies and completes only its registered-message intent',async()=>{
    const f=await fixture(),j=await stage(f),consumer=new SlackMessagePurgeConsumer(env.db.pool);
    expect(await consumer.runOnce()).toMatchObject({claimed:1,completed:1,lost:0});expect(await content(f)).toBe('Slack content is unavailable.');expect((await job(j.id)).status).toBe('completed');
    expect((await env.db.pool.query("SELECT count(*)::int AS n FROM slack_invalidation_intents WHERE source_event_key=$1 AND target_kind<>'chat_history_message' AND status='pending'",[j.source_event_key])).rows[0].n).toBe(7);
  });
  it('claims distinct jobs with real SKIP LOCKED and safely serializes overlapping effects',async()=>{
    const f=await fixture();await stage(f);await stage(f);const a=new SlackMessagePurgeConsumer(env.db.pool),b=new SlackMessagePurgeConsumer(env.db.pool);
    const rows=await Promise.all([a.claim(1),b.claim(1)]),one=onlyLease(rows[0]!),two=onlyLease(rows[1]!);expect(one.id).not.toBe(two.id);expect(one.workerNonce).not.toBe(two.workerNonce);
    const outcomes=await Promise.all([a.process(one),b.process(two)]);expect(outcomes).toContain('completed');expect(outcomes).not.toContain('lost');
    if(outcomes.includes('retried')) {
      const failed=(await env.db.pool.query("SELECT last_error FROM slack_invalidation_intents WHERE id=ANY($1::uuid[]) AND status='failed'",[[one.id,two.id]])).rows;
      expect(failed.map(row=>row.last_error)).toEqual(['code:RETRY_SCAN']);
    }
    await a.runOnce();expect((await job(one.id)).status).toBe('completed');expect((await job(two.id)).status).toBe('completed');
    expect(await content(f)).toBe('Slack content is unavailable.');
  });
  it('keeps partial progress durable and finishes a later batch without closing other kinds',async()=>{
    const f=await fixture();const c=await env.db.pool.connect();
    try {await c.query('BEGIN');const id=(await c.query("INSERT INTO messages(conv_id,role,content) VALUES($1,'assistant','Second copy') RETURNING id",[f.conv])).rows[0].id;await repo.registerDerivedCopyInTransaction(c,{...f.input,targetId:id});await c.query('COMMIT');}finally{c.release();}
    const j=await stage(f),consumer=new SlackMessagePurgeConsumer(env.db.pool,{batchSize:1});
    expect((await consumer.runOnce()).retried).toBe(1);expect(await job(j.id)).toEqual({status:'failed',last_error:'code:PARTIAL_PURGE'});
    expect((await consumer.runOnce()).completed).toBe(1);expect((await job(j.id)).status).toBe('completed');
  });
  it.each(['fingerprint','late','unsupported','resurrected'] as const)('keeps %s lineage unresolved across retries',async kind=>{
    const f=await fixture(),j=await stage(f),consumer=new SlackMessagePurgeConsumer(env.db.pool);
    if(kind==='fingerprint')await env.db.pool.query("UPDATE messages SET content='Replacement' WHERE id=$1",[f.targetId]);
    if(kind==='late')await env.db.pool.query('UPDATE slack_derived_copies SET created_at=clock_timestamp()+interval \'1 second\' WHERE id=$1',[f.copy.derivedCopyId]);
    if(kind==='unsupported')await env.db.pool.query("UPDATE slack_derived_copies SET target_sub_id='metadata.lookups' WHERE id=$1",[f.copy.derivedCopyId]);
    if(kind==='resurrected'){await consumer.runOnce();await env.db.pool.query("UPDATE slack_invalidation_intents SET status='pending',completed_at=NULL WHERE id=$1",[j.id]);await env.db.pool.query("UPDATE messages SET content='Resurrected' WHERE id=$1",[f.targetId]);}
    expect((await consumer.runOnce()).retried).toBe(1);expect((await job(j.id)).status).toBe('failed');expect((await consumer.runOnce()).completed).toBe(0);
    expect((await job(j.id)).last_error).toMatch(/^code:(STALE_LINEAGE|MISSING_HANDLER)$/);
  });
  it('rejects unlinked proof and never treats an empty fabricated job as complete',async()=>{
    const f=await fixture(),j=await stage(f);await env.db.pool.query('DELETE FROM slack_invalidation_barriers WHERE source_event_key=$1',[j.source_event_key]);
    expect((await new SlackMessagePurgeConsumer(env.db.pool).runOnce()).retried).toBe(1);expect(await job(j.id)).toEqual({status:'failed',last_error:'code:INVALID_PROVENANCE'});expect(await content(f)).toBe('Queue fixture');
  });
  it('rolls actual erasure back when another real claim replaces its expired lease',async()=>{
    const f=await fixture();await stage(f);const real=new SlackMessageContentPurger(),other=new SlackMessagePurgeConsumer(env.db.pool);let replacement:Awaited<ReturnType<typeof other.claim>>=[];
    const consumer=new SlackMessagePurgeConsumer(env.db.pool,{purger:{sourceLockKeysInTransaction:(...a)=>real.sourceLockKeysInTransaction(...a),purgeInTransaction:async(c,input)=>{
      const result=await real.purgeInTransaction(c,input);await env.db.pool.query("UPDATE slack_invalidation_intents SET leased_until=clock_timestamp()-interval '1 second' WHERE id=$1",[input.intentId]);replacement=await other.claim(1);return result;}}});
    const lease=onlyLease(await consumer.claim(1));expect(await consumer.process(lease)).toBe('lost');expect(await content(f)).toBe('Queue fixture');
    expect((await env.db.pool.query('SELECT status FROM slack_derived_copies WHERE id=$1',[f.copy.derivedCopyId])).rows[0].status).toBe('active');expect(await other.process(onlyLease(replacement))).toBe('completed');
  });
  it('checks lease expiry after waiting on the actual job row, then rolls erasure back',async()=>{
    const f=await fixture();await stage(f);const real=new SlackMessageContentPurger(),holder=await env.db.pool.connect();let pid=0,ready!:()=>void;const atFence=new Promise<void>(r=>{ready=r;});
    const consumer=new SlackMessagePurgeConsumer(env.db.pool,{leaseSeconds:1,purger:{sourceLockKeysInTransaction:(...a)=>real.sourceLockKeysInTransaction(...a),purgeInTransaction:async(c,input)=>{
      const result=await real.purgeInTransaction(c,input);pid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;await holder.query('BEGIN');await holder.query('SELECT id FROM slack_invalidation_intents WHERE id=$1 FOR UPDATE',[input.intentId]);ready();return result;}}});
    let pending:ReturnType<typeof consumer.process>|undefined;
    try {const lease=onlyLease(await consumer.claim(1));pending=consumer.process(lease);await atFence;const end=Date.now()+1500;let waiting=false;
      while(Date.now()<end){waiting=(await env.db.pool.query("SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.waiting===true;if(waiting)break;await new Promise(r=>setTimeout(r,10));}
      expect(waiting).toBe(true);await new Promise(r=>setTimeout(r,1100));await holder.query('ROLLBACK');expect(await pending).toBe('lost');expect(await content(f)).toBe('Queue fixture');
    }finally{await holder.query('ROLLBACK');holder.release();await pending;}
  });
  it('preserves the equal edit cutoff while completing only matched dependencies',async()=>{
    const f=await fixture('1730000000.000002'),resource=f.input.segments[0]!.sourceRef;
    const j=await stage(f,{scope:'resource_lifecycle',workspaceId:f.seed.binding.workspaceId,resourceType:'message',resourceId:resource.resourceId,beforeRevision:'1730000000.000002',cascadeTargetKinds:[...SLACK_DERIVED_TARGET_KINDS],tombstoneReason:'source_edited'},
      {barrierType:'resource',workspaceId:f.seed.binding.workspaceId,resourceType:'message',resourceId:resource.resourceId,minValidRevision:'1730000000.000002',reason:'edited'});
    expect((await new SlackMessagePurgeConsumer(env.db.pool).runOnce()).completed).toBe(1);expect(await content(f)).toBe('Queue fixture');expect((await job(j.id)).status).toBe('completed');
  });
  it('native invalidation sweep completes raw/message only with no content configuration',async()=>{
    const f=await fixture(),j=await stage(f),sources=new SlackSourceRepo(env.db.pool);
    const runner=new SlackInvalidationRunner(sources,env.invalidationService,new SlackPolicyEventConsumer(env.db.pool,env.invalidationService,sources),{messagePurgeConsumer:new SlackMessagePurgeConsumer(env.db.pool)});
    const stats=await runner.tick();expect(stats.messageIntentsCompleted).toBeGreaterThanOrEqual(1);expect(await content(f)).toBe('Slack content is unavailable.');
    expect((await env.db.pool.query("SELECT count(*)::int AS n FROM slack_invalidation_intents WHERE source_event_key=$1 AND status='pending'",[j.source_event_key])).rows[0].n).toBe(6);await runner.stop();
  });
  it.each(['channel','epoch','delete','edit_older','retention'] as const)('selects and erases an exact %s staged dependency',async scope=>{
    const f=await fixture(),r=f.input.segments[0]!.sourceRef,p=f.input.segments[0]!.storagePolicyRef,common={cascadeTargetKinds:[...SLACK_DERIVED_TARGET_KINDS]};
    let target:SlackPurgeTarget,barrier:SlackInvalidationBarrier;
    if(scope==='channel'){target={...common,scope:'channel_membership_lost',binding:f.seed.binding,channelId:'C_QUEUE',tombstoneReason:'channel_membership_lost'};barrier={barrierType:'channel',binding:f.seed.binding,channelId:'C_QUEUE',reason:'lost'};}
    else if(scope==='epoch'){const {purpose,requestedRetentionDays,...epoch}=p;target={...common,scope:'policy_epoch_invalidated',epoch,tombstoneReason:'policy_changed'};barrier={barrierType:'epoch',epoch,reason:'policy'};}
    else if(scope==='retention'){target={...common,scope:'owner_retention',binding:f.seed.binding,resourceType:'message',resourceId:r.resourceId,revision:r.revision,policyRef:p,tombstoneReason:'retention_expired'};barrier={barrierType:'resource',workspaceId:f.seed.binding.workspaceId,resourceType:'message',resourceId:r.resourceId,deleted:true,reason:'expired'};}
    else {target={...common,scope:'resource_lifecycle',workspaceId:f.seed.binding.workspaceId,resourceType:'message',resourceId:r.resourceId,...(scope==='edit_older'?{beforeRevision:'1730000000.000002'}:{}),tombstoneReason:scope==='edit_older'?'source_edited':'source_deleted'};
      barrier={barrierType:'resource',workspaceId:f.seed.binding.workspaceId,resourceType:'message',resourceId:r.resourceId,...(scope==='edit_older'?{minValidRevision:'1730000000.000002'}:{deleted:true}),reason:'lifecycle'};}
    await stage(f,target,barrier);expect((await new SlackMessagePurgeConsumer(env.db.pool).runOnce()).completed).toBe(1);expect(await content(f)).toBe('Slack content is unavailable.');
  });
  it.each(['binding','channel','epoch'] as const)('preserves a copy outside the exact %s target',async kind=>{
    const f=await fixture(),common={cascadeTargetKinds:[...SLACK_DERIVED_TARGET_KINDS]};let target:SlackPurgeTarget,barrier:SlackInvalidationBarrier;
    if(kind==='binding'){const b={...f.seed.binding,identityVersion:2};target={...common,scope:'authorization_disconnect',binding:b,tombstoneReason:'connection_disconnected'};barrier={barrierType:'binding',binding:b,reason:'other_generation'};}
    else if(kind==='channel'){target={...common,scope:'channel_membership_lost',binding:f.seed.binding,channelId:'OTHER',tombstoneReason:'channel_membership_lost'};barrier={barrierType:'channel',binding:f.seed.binding,channelId:'OTHER',reason:'other_channel'};}
    else {const {purpose,requestedRetentionDays,...p}=f.input.segments[0]!.storagePolicyRef,epoch={...p,providerRevision:'99'};target={...common,scope:'policy_epoch_invalidated',epoch,tombstoneReason:'policy_changed'};barrier={barrierType:'epoch',epoch,reason:'other_epoch'};}
    await stage(f,target,barrier);expect((await new SlackMessagePurgeConsumer(env.db.pool).runOnce()).completed).toBe(1);expect(await content(f)).toBe('Queue fixture');
  });
  it.each([null,'CONTRADICTORY'] as const)('derives canonical membership channel and rejects contradictory persisted channel %s',async channel=>{
    const f=await fixture();await env.db.pool.query('UPDATE slack_derived_provenance_segments SET channel_id=$2 WHERE derived_copy_id=$1',[f.copy.derivedCopyId,channel]);
    const j=await stage(f,{scope:'channel_membership_lost',binding:f.seed.binding,channelId:'C_QUEUE',cascadeTargetKinds:[...SLACK_DERIVED_TARGET_KINDS],tombstoneReason:'channel_membership_lost'},{barrierType:'channel',binding:f.seed.binding,channelId:'C_QUEUE',reason:'lost'});
    const result=await new SlackMessagePurgeConsumer(env.db.pool).runOnce();expect(result[channel===null?'completed':'retried']).toBe(1);
    expect((await job(j.id)).status).toBe(channel===null?'completed':'failed');
  });
  it('keeps an orphan registered copy without provenance unresolved instead of completing an empty scan',async()=>{
    const f=await fixture(),j=await stage(f);await env.db.pool.query('DELETE FROM slack_derived_provenance_segments WHERE derived_copy_id=$1',[f.copy.derivedCopyId]);
    expect((await new SlackMessagePurgeConsumer(env.db.pool).runOnce()).retried).toBe(1);expect(await job(j.id)).toEqual({status:'failed',last_error:'code:STALE_LINEAGE'});expect(await content(f)).toBe('Queue fixture');
  });
  it('rolls actual erasure back if immutable job target changes before finalization',async()=>{
    const f=await fixture();await stage(f);const real=new SlackMessageContentPurger();
    const consumer=new SlackMessagePurgeConsumer(env.db.pool,{purger:{sourceLockKeysInTransaction:(...a)=>real.sourceLockKeysInTransaction(...a),purgeInTransaction:async(c,input)=>{
      const result=await real.purgeInTransaction(c,input);await env.db.pool.query("UPDATE slack_invalidation_intents SET purge_target=jsonb_set(purge_target,'{binding,identityVersion}','2') WHERE id=$1",[input.intentId]);return result;}}});
    const lease=onlyLease(await consumer.claim(1));expect(await consumer.process(lease)).toBe('lost');expect(await content(f)).toBe('Queue fixture');
  });
  it('refuses a global consent target whose active staging proof cannot represent that scope',async()=>{
    const f=await fixture(),j=await stage(f),p=f.input.segments[0]!.storagePolicyRef;
    const target:SlackPurgeTarget={scope:'workspace_consent_revocation',workspaceId:f.seed.binding.workspaceId,providerProfileId:p.providerProfileId,policyVersion:p.policyVersion,consentRevision:'3',cascadeTargetKinds:[...SLACK_DERIVED_TARGET_KINDS],tombstoneReason:'consent_revoked'};
    await env.db.pool.query('UPDATE slack_invalidation_intents SET purge_target=$2 WHERE id=$1',[j.id,JSON.stringify(target)]);
    expect((await new SlackMessagePurgeConsumer(env.db.pool).runOnce()).retried).toBe(1);expect(await job(j.id)).toEqual({status:'failed',last_error:'code:INVALID_PROVENANCE'});
  });
  it('does not let another owner orphan block this owner-scoped purge',async()=>{
    const f=await fixture(),other=await fixture();await env.db.pool.query('DELETE FROM slack_derived_provenance_segments WHERE derived_copy_id=$1',[other.copy.derivedCopyId]);
    const j=await stage(f);expect((await new SlackMessagePurgeConsumer(env.db.pool).runOnce()).completed).toBe(1);expect((await job(j.id)).status).toBe('completed');
    expect(await content(f)).toBe('Slack content is unavailable.');expect(await content(other)).toBe('Queue fixture');
  });
  it('recovers an actual SQL error with a one-connection pool and persists no raw error payload',async()=>{
    const f=await fixture(),j=await stage(f);
    await env.db.pool.query(`CREATE FUNCTION fail_message_purge_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF current_setting('ati.message_purge_fail',true)='on' AND NEW.status='purged' THEN RAISE EXCEPTION 'RAW_PAYLOAD_FIXTURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_message_purge_fixture BEFORE UPDATE ON slack_derived_copies FOR EACH ROW EXECUTE FUNCTION fail_message_purge_fixture()`);
    const url=new URL(env.db.pool.options.connectionString!);url.searchParams.set('options',`${url.searchParams.get('options')??''} -c ati.message_purge_fail=on`);
    const pool=new pg.Pool({connectionString:url.href,max:1});
    try {expect((await new SlackMessagePurgeConsumer(pool).runOnce()).retried).toBe(1);expect(await job(j.id)).toEqual({status:'failed',last_error:'code:PURGE_FAILED'});expect(await content(f)).toBe('Queue fixture');}
    finally {await pool.end();}
  });
  it('rolls actual erasure back when an AbortSignal fires before finalization',async()=>{
    const f=await fixture(),j=await stage(f),real=new SlackMessageContentPurger(),controller=new AbortController();
    const consumer=new SlackMessagePurgeConsumer(env.db.pool,{purger:{sourceLockKeysInTransaction:(...a)=>real.sourceLockKeysInTransaction(...a),purgeInTransaction:async(c,input)=>{
      const result=await real.purgeInTransaction(c,input);controller.abort();return result;}}});
    expect((await consumer.runOnce(5,controller.signal)).retried).toBe(1);expect(await content(f)).toBe('Queue fixture');expect(await job(j.id)).toEqual({status:'failed',last_error:'code:ABORTED'});
  });
  it('orders parents across two conversations when disjoint workspace jobs would otherwise take opposite orders',async()=>{
    const f=await fixture(),secondConnection=randomUUID(),secondWorkspace=`T${randomUUID()}`,secondActor=`U${randomUUID()}`;
    await env.db.pool.query(`INSERT INTO slack_connections(id,user_id,app_id,workspace_id,workspace_name,actor_id,identity_version,status,config,scopes,connected_at,last_state_order)
      VALUES($1,$2,'A_READ',$3,'Second workspace',$4,1,'active','FIXTURE',ARRAY['channels:history'],now(),'1')`,[secondConnection,f.seed.person.id,secondWorkspace,secondActor]);
    const binding={...f.seed.binding,connectionId:secondConnection,workspaceId:secondWorkspace,slackUserId:secondActor};
    await env.consentRepo.grantConsent({workspaceId:secondWorkspace,providerId:env.runtimeIdentity.providerId,policyVersion:'v1.0.0',purposes:['storage','manual_lookup'],retentionDays:14,organizationRepresentative:'fixture',evidenceRef:'FIXTURE',recordedBy:'fixture'});
    const decision=await env.policyService.resolveSlackModelPolicy({binding,purpose:'storage',requestedRetentionDays:7,env:TEST_ENV});if(!decision.allowed)throw new Error('Fixture second storage denied');
    const storage=decision.policyReference as SlackPolicyReference,sourceB={...f.input.segments[0]!,sourceRef:{...f.input.segments[0]!.sourceRef,binding},storagePolicyRef:storage,acquisitionPolicyRef:{...storage,purpose:'manual_lookup' as const,requestedRetentionDays:0}};
    const convY=(await env.db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id',[f.seed.person.id])).rows[0].id;
    async function extra(conv:string,segments:RegisterDerivedCopyInput['segments']) {
      const c=await env.db.pool.connect();try {await c.query('BEGIN');const id=(await c.query("INSERT INTO messages(conv_id,role,content) VALUES($1,'assistant','Batch lock fixture') RETURNING id",[conv])).rows[0].id;
        const copy=await repo.registerDerivedCopyInTransaction(c,{...f.input,targetId:id,segments});await c.query('COMMIT');return copy;
      }finally{c.release();}
    }
    const ay=await extra(convY,f.input.segments),by=await extra(convY,[sourceB]),bx=await extra(f.conv,[sourceB]);
    // Deterministic valid server metadata IDs exercise a possible UUID ordering:
    // workspace A selects X then Y, workspace B selects Y then X. Versions stay in PG.
    async function rekey(oldId:string,newId:string) {
      const c=await env.db.pool.connect();try {await c.query('BEGIN');
        await c.query('CREATE TEMP TABLE rekey_copy ON COMMIT DROP AS SELECT * FROM slack_derived_copies WHERE id=$1',[oldId]);
        await c.query('CREATE TEMP TABLE rekey_segments ON COMMIT DROP AS SELECT * FROM slack_derived_provenance_segments WHERE derived_copy_id=$1',[oldId]);
        await c.query('DELETE FROM slack_derived_copies WHERE id=$1',[oldId]);
        await c.query('INSERT INTO slack_derived_copies SELECT (jsonb_populate_record(NULL::slack_derived_copies,to_jsonb(r)||jsonb_build_object(\'id\',$1::uuid))).* FROM rekey_copy r',[newId]);
        await c.query('INSERT INTO slack_derived_provenance_segments SELECT (jsonb_populate_record(NULL::slack_derived_provenance_segments,to_jsonb(r)||jsonb_build_object(\'derived_copy_id\',$1::uuid))).* FROM rekey_segments r',[newId]);await c.query('COMMIT');
      }finally{c.release();}
    }
    const ids=['10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001'];
    await rekey(f.copy.derivedCopyId,ids[0]!);await rekey(by.derivedCopyId,ids[1]!);await rekey(ay.derivedCopyId,ids[2]!);await rekey(bx.derivedCopyId,ids[3]!);
    const ja=await stage(f),jb=await stage({...f,seed:{...f.seed,binding}}),real=new SlackMessageContentPurger();
    let reached!:()=>void,release!:()=>void;const first=new Promise<void>(r=>{reached=r;}),resume=new Promise<void>(r=>{release=r;});
    const a=new SlackMessagePurgeConsumer(env.db.pool,{purger:{sourceLockKeysInTransaction:(...args)=>real.sourceLockKeysInTransaction(...args),purgeInTransaction:async(c,input)=>{
      const result=await real.purgeInTransaction(c,input);if(input.derivedCopyId===ids[0]){reached();await resume;}return result;}}});
    const poolB=new pg.Pool({connectionString:env.db.pool.options.connectionString,max:1}),b=new SlackMessagePurgeConsumer(poolB);
    let pa:ReturnType<typeof a.process>|undefined,pb:ReturnType<typeof b.process>|undefined;
    try {const la=onlyLease(await a.claim(1)),lb=onlyLease(await b.claim(1));expect(la.id).toBe(ja.id);expect(lb.id).toBe(jb.id);
      const pid=(await poolB.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;pa=a.process(la);await first;pb=b.process(lb);
      const end=Date.now()+1500;let waiting=false;while(Date.now()<end){waiting=(await env.db.pool.query("SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.waiting===true;if(waiting)break;await new Promise(r=>setTimeout(r,10));}
      expect(waiting).toBe(true);release();expect(await Promise.all([pa,pb])).toEqual(['completed','completed']);
    }finally{release?.();await pa;await pb;await poolB.end();}
  },10000);
});
