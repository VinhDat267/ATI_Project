import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { SlackPurgeTarget, SlackPolicyReference } from '@wap/tool-schemas';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';
import { SlackConsentRepo } from '../../../src/db/repositories/slack-consent-repo.js';
import { SlackPolicyService } from '../../../src/services/slack/policy-service.js';
import { resolveRuntimeProviderIdentity } from '../../../src/config/slack-policy-runtime.js';
import { SlackDerivedLineageRepo, type RegisterDerivedCopyInput } from '../../../src/db/repositories/slack-derived-lineage-repo.js';
import { SlackMessageContentPurger } from '../../../src/services/slack/slack-message-content-purger.js';

describe('03B2B concrete message-content erasure on real PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>, consent: SlackConsentRepo, repo: SlackDerivedLineageRepo, purger: SlackMessageContentPurger;
  const env={LLM_PROVIDER:'gemini',GEMINI_MODEL:'gemini-2.5-flash',RUNTIME_ACCOUNT_ID:'PURGE_FIXTURE'};
  const runtime=resolveRuntimeProviderIdentity(env);
  beforeAll(async()=>{
    db=await createMigratedSchema('slack_message_purge'); consent=new SlackConsentRepo(db.pool);
    repo=new SlackDerivedLineageRepo(db.pool,new SlackPolicyService(db.pool,{env})); purger=new SlackMessageContentPurger();
    await consent.attestProvider({id:runtime.providerId,name:'Fixture',verified:true,noTraining:true,maxRetentionDays:30,
      configurationFingerprint:runtime.fingerprint,evidenceRef:'FIXTURE',verifiedBy:'fixture',verifiedAt:new Date()});
  });
  afterAll(async()=>{await db?.close();});
  async function fixture(revision='1730000000.000001') {
    const person=await db.person(),connectionId=randomUUID(),workspaceId=`T${randomUUID()}`;
    await db.pool.query(`INSERT INTO slack_connections(id,user_id,app_id,workspace_id,workspace_name,actor_id,identity_version,status,config,scopes,connected_at,last_state_order)
      VALUES($1,$2,'A_PURGE',$3,'Fixture','U_PURGE',1,'active','FIXTURE',ARRAY['channels:history'],now(),'1')`,[connectionId,person.id,workspaceId]);
    const granted=await consent.grantConsent({workspaceId,providerId:runtime.providerId,policyVersion:'2026-10-28',purposes:['storage','manual_lookup'],retentionDays:30,organizationRepresentative:'fixture',evidenceRef:'FIXTURE',recordedBy:'fixture'});
    const binding={atiUserId:person.id,connectionId,workspaceId,slackUserId:'U_PURGE',identityVersion:1};
    const acquisition:SlackPolicyReference={binding,purpose:'manual_lookup',requestedRetentionDays:0,providerProfileId:runtime.providerId,configFingerprint:runtime.fingerprint,policyVersion:'2026-10-28',consentRevision:String(granted.revision),providerRevision:'1'};
    const conv=(await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id',[person.id])).rows[0].id;
    const targetId=(await db.pool.query(`INSERT INTO messages(conv_id,role,content,metadata) VALUES($1,'assistant','Derived fixture','{"keep":"unregistered"}') RETURNING id`,[conv])).rows[0].id;
    const input:RegisterDerivedCopyInput={atiUserId:person.id,targetKind:'chat_history_message',targetId,targetSubId:'content',segments:[{
      sourceRef:{binding,resourceType:'message',resourceId:JSON.stringify(['C_PURGE','1730000000.000001']),revision},acquisitionPolicyRef:acquisition,
      storagePolicyRef:{...acquisition,purpose:'storage',requestedRetentionDays:30},captureHash:'a'.repeat(64),capturedAt:new Date().toISOString()}]};
    const client=await db.pool.connect(); let copy;
    try {await client.query('BEGIN');copy=await repo.registerDerivedCopyInTransaction(client,input);await client.query('COMMIT');} finally {client.release();}
    return {input,copy:copy!,conv,targetId,binding};
  }
  type F=Awaited<ReturnType<typeof fixture>>;
  function target(f:F):Extract<SlackPurgeTarget,{scope:'authorization_disconnect'}> {return {scope:'authorization_disconnect',binding:f.binding,cascadeTargetKinds:['chat_history_message'],tombstoneReason:'connection_disconnected'};}
  // Durable queue row only; no mock boolean or fabricated queue completion.
  async function intent(p:SlackPurgeTarget,kind='chat_history_message') {
    return (await db.pool.query(`INSERT INTO slack_invalidation_intents(source_event_key,effect_key,target_kind,purge_target)
      VALUES($1,'fixture',$2,$3) RETURNING id`,[`fixture:${randomUUID()}`,kind,JSON.stringify(p)])).rows[0].id as string;
  }
  async function erase(f:F,intentId:string,extra:Record<string,unknown>={}) {
    const c=await db.pool.connect();
    try {await c.query('BEGIN');const result=await purger.purgeInTransaction(c,{intentId,derivedCopyId:f.copy.derivedCopyId,expectedTargetVersion:f.copy.targetVersion,...extra});await c.query('COMMIT');return result;}
    catch(e){await c.query('ROLLBACK');throw e;} finally {c.release();}
  }
  async function content(f:F) {return (await db.pool.query('SELECT content,metadata FROM messages WHERE id=$1',[f.targetId])).rows[0];}
  it('erases actual content and registry atomically without credentials, keeps unrelated fields and queue open',async()=>{
    const f=await fixture(),id=await intent(target(f));
    await db.pool.query("UPDATE slack_connections SET status='disconnected',config=NULL WHERE id=$1",[f.binding.connectionId]);
    expect(await erase(f,id)).toEqual({status:'purged'});
    expect(await content(f)).toEqual({content:'Slack content is unavailable.',metadata:{keep:'unregistered'}});
    expect((await db.pool.query('SELECT status FROM slack_derived_copies WHERE id=$1',[f.copy.derivedCopyId])).rows[0].status).toBe('purged');
    expect((await db.pool.query('SELECT status FROM slack_invalidation_intents WHERE id=$1',[id])).rows[0].status).toBe('pending');
    expect(await erase(f,id)).toEqual({status:'already_purged'});
  });
  it.each(['owner_retention','channel_membership_lost','resource_lifecycle','workspace_consent_revocation','policy_epoch_invalidated'] as const)('matches exact %s scope',async scope=>{
    const f=await fixture(),s=f.input.segments[0]!,p=s.storagePolicyRef;
    const common={cascadeTargetKinds:['chat_history_message'] as const};
    let t:SlackPurgeTarget;
    if(scope==='owner_retention') t={...common,cascadeTargetKinds:[...common.cascadeTargetKinds],scope,binding:f.binding,resourceType:'message',resourceId:s.sourceRef.resourceId,revision:s.sourceRef.revision,policyRef:p,tombstoneReason:'retention_expired'};
    else if(scope==='channel_membership_lost') t={...target(f),scope,binding:f.binding,channelId:'C_PURGE',tombstoneReason:'channel_membership_lost'};
    else if(scope==='resource_lifecycle') t={...target(f),scope,workspaceId:f.binding.workspaceId,resourceType:'message',resourceId:s.sourceRef.resourceId,revision:s.sourceRef.revision,tombstoneReason:'source_deleted'};
    else if(scope==='workspace_consent_revocation') t={...target(f),scope,workspaceId:f.binding.workspaceId,providerProfileId:p.providerProfileId,policyVersion:p.policyVersion,consentRevision:'2',tombstoneReason:'consent_revoked'};
    else {const {purpose,requestedRetentionDays,...epoch}=p;t={...target(f),scope,epoch,tombstoneReason:'policy_changed'};}
    expect(await erase(f,await intent(t))).toEqual({status:'purged'});
  });
  it('preserves foreign binding, generation, channel, resource, consent and provider epoch',async()=>{
    const f=await fixture(),base=target(f),s=f.input.segments[0]!,{purpose,requestedRetentionDays,...epoch}=s.storagePolicyRef;
    const targets:SlackPurgeTarget[]=[{...base,scope:'authorization_disconnect',binding:{...f.binding,identityVersion:2}},
      {...base,scope:'authorization_disconnect',binding:{...f.binding,atiUserId:randomUUID()}},
      {...base,scope:'channel_membership_lost',binding:f.binding,channelId:'OTHER',tombstoneReason:'channel_membership_lost'},
      {...base,scope:'resource_lifecycle',workspaceId:f.binding.workspaceId,resourceType:'message',resourceId:'OTHER',tombstoneReason:'source_deleted'},
      {...base,scope:'workspace_consent_revocation',workspaceId:f.binding.workspaceId,providerProfileId:epoch.providerProfileId,policyVersion:epoch.policyVersion,consentRevision:'1',tombstoneReason:'consent_revoked'},
      {...base,scope:'policy_epoch_invalidated',epoch:{...epoch,providerRevision:'2'},tombstoneReason:'policy_changed'}];
    for(const t of targets) expect(await erase(f,await intent(t))).toEqual({status:'skipped'});
    expect((await content(f)).content).toBe('Derived fixture');
  });
  it.each([['1730000000.000001','purged'],['1730000000.000002','skipped'],['1730000000.000003','skipped'],['opaque','purged']])('preserves exclusive exact edit cutoff for revision %s',async(revision,status)=>{
    const f=await fixture(revision),s=f.input.segments[0]!;
    const t:SlackPurgeTarget={scope:'resource_lifecycle',workspaceId:f.binding.workspaceId,resourceType:'message',resourceId:s.sourceRef.resourceId,beforeRevision:'1730000000.000002',cascadeTargetKinds:['chat_history_message'],tombstoneReason:'source_edited'};
    expect(await erase(f,await intent(t))).toEqual({status});
  });
  it('keeps canonical BIGINT versions exact and refuses a neighboring expected version',async()=>{
    await db.pool.query("SELECT setval('slack_derived_target_version_seq',9007199254740992)");
    const f=await fixture(),id=await intent(target(f));expect(f.copy.targetVersion).toBe('9007199254740993');
    expect(await erase(f,id,{expectedTargetVersion:'9007199254740992'})).toEqual({status:'stale_lineage'});
    expect(await erase(f,id)).toEqual({status:'purged'});
  });
  it('retires a fingerprint mismatch without erasing replacement text or falsely reporting purge on retry',async()=>{
    const f=await fixture(),id=await intent(target(f));await db.pool.query("UPDATE messages SET content='Replacement' WHERE id=$1",[f.targetId]);
    expect(await erase(f,id)).toEqual({status:'stale_lineage'});expect(await erase(f,id)).toEqual({status:'stale_lineage'});
    expect((await content(f)).content).toBe('Replacement');
    expect((await db.pool.query('SELECT status,retired_reason FROM slack_derived_copies WHERE id=$1',[f.copy.derivedCopyId])).rows[0]).toEqual({status:'retired',retired_reason:'fingerprint_mismatch'});
  });
  it('compares cutoff in PostgreSQL at microsecond precision and leaves late copies unresolved',async()=>{
    const f=await fixture(),id=await intent(target(f));
    await db.pool.query(`UPDATE slack_derived_copies SET created_at=(SELECT created_at+interval '1 microsecond' FROM slack_invalidation_intents WHERE id=$1) WHERE id=$2`,[id,f.copy.derivedCopyId]);
    expect(await erase(f,id)).toEqual({status:'stale_lineage'});expect((await content(f)).content).toBe('Derived fixture');
  });
  it('returns missing handler for unsupported selector and rejects malformed channel lineage',async()=>{
    const f=await fixture(),id=await intent(target(f));
    await db.pool.query("UPDATE slack_derived_copies SET target_sub_id='metadata.lookups' WHERE id=$1",[f.copy.derivedCopyId]);
    expect(await erase(f,id)).toEqual({status:'missing_handler'});
    await db.pool.query("UPDATE slack_derived_copies SET target_sub_id='content' WHERE id=$1",[f.copy.derivedCopyId]);
    await db.pool.query("UPDATE slack_derived_provenance_segments SET channel_id='CONTRADICTORY' WHERE derived_copy_id=$1",[f.copy.derivedCopyId]);
    expect(await erase(f,id)).toEqual({status:'stale_lineage'});
  });
  it('requires a caller transaction and rolls back erasure plus registry on caller failure',async()=>{
    const f=await fixture(),id=await intent(target(f)),c=await db.pool.connect();
    const args={intentId:id,derivedCopyId:f.copy.derivedCopyId,expectedTargetVersion:f.copy.targetVersion};
    try {await expect(purger.purgeInTransaction(c,args)).rejects.toThrow();await c.query('BEGIN');expect(await purger.purgeInTransaction(c,args)).toEqual({status:'purged'});await c.query('ROLLBACK');} finally {c.release();}
    expect((await content(f)).content).toBe('Derived fixture');
    expect((await db.pool.query('SELECT status FROM slack_derived_copies WHERE id=$1',[f.copy.derivedCopyId])).rows[0].status).toBe('active');
  });
  it('does not report already-purged if an ungated writer restored content afterward',async()=>{
    const f=await fixture(),id=await intent(target(f));expect(await erase(f,id)).toEqual({status:'purged'});
    await db.pool.query("UPDATE messages SET content='Legacy resurrection' WHERE id=$1",[f.targetId]);
    expect(await erase(f,id)).toEqual({status:'stale_lineage'});
  });
  async function waitAdvisory(pid:number) {
    const end=Date.now()+2000;
    while(Date.now()<end) {
      const row=(await db.pool.query('SELECT wait_event FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];
      if(row?.wait_event==='advisory') return;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    throw new Error('No real advisory wait observed');
  }
  it('serializes duplicate erasers using actual advisory lock contention',async()=>{
    const f=await fixture(),id=await intent(target(f)),a=await db.pool.connect(),b=await db.pool.connect();
    const args={intentId:id,derivedCopyId:f.copy.derivedCopyId,expectedTargetVersion:f.copy.targetVersion};
    try {
      await a.query('BEGIN');await b.query('BEGIN');const pid=(await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      expect(await purger.purgeInTransaction(a,args)).toEqual({status:'purged'});
      const pending=purger.purgeInTransaction(b,args);pending.catch(()=>{});await waitAdvisory(pid);
      await a.query('COMMIT');expect(await pending).toEqual({status:'already_purged'});await b.query('COMMIT');
    } finally {await a.query('ROLLBACK');await b.query('ROLLBACK');a.release();b.release();}
  });
  it('preserves a newer registered artifact when an old eraser waits behind its writer',async()=>{
    const f=await fixture(),id=await intent(target(f)),writer=await db.pool.connect(),eraser=await db.pool.connect();
    const fresh={...f.input,segments:[{...f.input.segments[0]!,sourceRef:{...f.input.segments[0]!.sourceRef,resourceId:JSON.stringify(['C_NEW','1730000000.000001'])}}]};
    try {
      await writer.query('BEGIN');await eraser.query('BEGIN');const pid=(await eraser.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await repo.prepareMessageWriteInTransaction(writer,fresh);
      await writer.query("UPDATE messages SET content='Fresh registered replacement' WHERE id=$1",[f.targetId]);
      await repo.registerDerivedCopyInTransaction(writer,fresh);
      const pending=purger.purgeInTransaction(eraser,{intentId:id,derivedCopyId:f.copy.derivedCopyId,expectedTargetVersion:f.copy.targetVersion});pending.catch(()=>{});
      await waitAdvisory(pid);await writer.query('COMMIT');expect(await pending).toEqual({status:'skipped'});await eraser.query('COMMIT');
      expect((await content(f)).content).toBe('Fresh registered replacement');
    } finally {await writer.query('ROLLBACK');await eraser.query('ROLLBACK');writer.release();eraser.release();}
  });
  it('honors a real AbortSignal after waiting on a PostgreSQL source lock',async()=>{
    const f=await fixture(),id=await intent(target(f)),holder=await db.pool.connect(),eraser=await db.pool.connect(),controller=new AbortController();
    try {
      await holder.query('BEGIN');await eraser.query('BEGIN');const pid=(await eraser.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await repo.prepareMessageWriteInTransaction(holder,f.input);
      const pending=purger.purgeInTransaction(eraser,{intentId:id,derivedCopyId:f.copy.derivedCopyId,expectedTargetVersion:f.copy.targetVersion,signal:controller.signal});pending.catch(()=>{});
      await waitAdvisory(pid);controller.abort();await holder.query('ROLLBACK');await expect(pending).rejects.toThrow();await eraser.query('ROLLBACK');
      expect((await content(f)).content).toBe('Derived fixture');
    } finally {await holder.query('ROLLBACK');await eraser.query('ROLLBACK');holder.release();eraser.release();}
  });
  it('rolls back an actual SQL failure between content erasure and registry terminal update',async()=>{
    const f=await fixture(),id=await intent(target(f)),c=await db.pool.connect();
    await db.pool.query(`CREATE FUNCTION fail_purge_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF current_setting('ati.purge_fail',true)='on' AND NEW.status='purged' THEN RAISE EXCEPTION 'FIXTURE_CRASH'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_purge_fixture BEFORE UPDATE ON slack_derived_copies FOR EACH ROW EXECUTE FUNCTION fail_purge_fixture()`);
    try {
      await c.query('BEGIN');await c.query("SET LOCAL ati.purge_fail='on'");
      await expect(purger.purgeInTransaction(c,{intentId:id,derivedCopyId:f.copy.derivedCopyId,expectedTargetVersion:f.copy.targetVersion})).rejects.toThrow('FIXTURE_CRASH');await c.query('ROLLBACK');
      expect((await content(f)).content).toBe('Derived fixture');
      expect((await db.pool.query('SELECT status FROM slack_derived_copies WHERE id=$1',[f.copy.derivedCopyId])).rows[0].status).toBe('active');
    } finally {await c.query('ROLLBACK');c.release();}
  });
  it('erases a multi-source artifact if any segment matches and requires the full owner-retention policy',async()=>{
    const f=await fixture(),s=f.input.segments[0]!,other={...s,sourceRef:{...s.sourceRef,resourceId:JSON.stringify(['C_OTHER','1730000000.000001'])}};
    const c=await db.pool.connect();
    try {await c.query('BEGIN');f.copy=await repo.registerDerivedCopyInTransaction(c,{...f.input,segments:[s,other]});await c.query('COMMIT');} finally {c.release();}
    const t:SlackPurgeTarget={scope:'owner_retention',binding:f.binding,resourceType:'message',resourceId:other.sourceRef.resourceId,policyRef:{...s.storagePolicyRef,requestedRetentionDays:29},cascadeTargetKinds:['chat_history_message'],tombstoneReason:'retention_expired'};
    expect(await erase(f,await intent(t))).toEqual({status:'skipped'});
    expect(await erase(f,await intent({...t,policyRef:s.storagePolicyRef}))).toEqual({status:'purged'});
  });
});
