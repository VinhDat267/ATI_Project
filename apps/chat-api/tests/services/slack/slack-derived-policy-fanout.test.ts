import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import { SLACK_DERIVED_TARGET_KINDS,slackPolicyRefToEpoch,type SlackPolicyReference } from '@wap/tool-schemas';
import { createSlackReadEnvironment,TEST_ENV,type SlackReadEnvironment } from '../../helpers/slack-private-read-fixture.js';
import { SlackDerivedLineageRepo,type RegisterDerivedCopyInput } from '../../../src/db/repositories/slack-derived-lineage-repo.js';
import { SlackDerivedPolicyFanout } from '../../../src/services/slack/slack-derived-policy-fanout.js';
import { hashPolicyEpoch } from '../../../src/services/slack/slack-invalidation-service.js';
import { SlackSourceRepo } from '../../../src/db/repositories/slack-source-repo.js';
import { SlackPolicyEventConsumer } from '../../../src/services/slack/slack-policy-event-consumer.js';
import { SlackInvalidationRunner } from '../../../src/services/slack/slack-invalidation-runner.js';

describe('03B2D derived-only policy epochs on real PostgreSQL',()=>{
  let env:SlackReadEnvironment,repo:SlackDerivedLineageRepo;
  beforeAll(async()=>{env=await createSlackReadEnvironment('slack_derived_policy');repo=new SlackDerivedLineageRepo(env.db.pool,env.policyService);});
  beforeEach(async()=>{await env.db.pool.query('DELETE FROM slack_policy_events; DELETE FROM slack_invalidation_intents; DELETE FROM slack_invalidation_barriers; DELETE FROM slack_invalidation_receipts; DELETE FROM slack_derived_copies');});
  afterAll(async()=>{await env?.close();});
  async function fixture() {
    const seed=await env.addUser({name:'derived-policy',workspaceId:`T${randomUUID()}`,actorId:`U${randomUUID()}`});
    const old=await env.consentRepo.getConsent(seed.binding.workspaceId,env.runtimeIdentity.providerId);
    await env.consentRepo.grantConsent({workspaceId:seed.binding.workspaceId,providerId:env.runtimeIdentity.providerId,policyVersion:'v1 tiếng Việt, "policy" /',expectedRevision:old!.revision,purposes:['storage','manual_lookup'],retentionDays:14,organizationRepresentative:'fixture',evidenceRef:'FIXTURE',recordedBy:'fixture'});
    const decision=await env.policyService.resolveSlackModelPolicy({binding:seed.binding,purpose:'storage',requestedRetentionDays:7,env:TEST_ENV});if(!decision.allowed)throw new Error('Fixture storage denied');const policy=decision.policyReference as SlackPolicyReference;
    const c=await env.db.pool.connect();let copy;
    try {await c.query('BEGIN');const conv=(await c.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id',[seed.person.id])).rows[0].id;
      const id=(await c.query("INSERT INTO messages(conv_id,role,content) VALUES($1,'assistant','Derived policy fixture') RETURNING id",[conv])).rows[0].id;
      const input:RegisterDerivedCopyInput={atiUserId:seed.person.id,targetKind:'chat_history_message',targetId:id,targetSubId:'content',segments:[{sourceRef:{binding:seed.binding,resourceType:'message',resourceId:JSON.stringify(['C_POLICY','1730000000.000001']),revision:'1730000000.000001'},storagePolicyRef:policy,acquisitionPolicyRef:{...policy,purpose:'manual_lookup',requestedRetentionDays:0},captureHash:'a'.repeat(64),capturedAt:new Date().toISOString()}]};
      copy=await repo.registerDerivedCopyInTransaction(c,input);await c.query('COMMIT');
    }finally{c.release();}
    await env.db.pool.query('DELETE FROM slack_policy_events');return {seed,policy,copy:copy!};
  }
  type F=Awaited<ReturnType<typeof fixture>>;
  async function event(f:F,type='consent_revoked',revision?:string,workspace?:string,provider?:string) {
    const consent=type.startsWith('consent_'),next=revision??String(BigInt(consent?f.policy.consentRevision:f.policy.providerRevision)+1n);
    return (await env.db.pool.query(`INSERT INTO slack_policy_events(workspace_id,provider_id,event_type,policy_version,consent_revision,provider_revision,reason)
      VALUES($1,$2,$3,'current',$4,$5,'FIXTURE') RETURNING id`,[workspace??(consent?f.seed.binding.workspaceId:'*'),provider??f.policy.providerProfileId,type,consent?next:'1',consent?null:next])).rows[0].id as string;
  }
  async function rows(key:string){return (await env.db.pool.query('SELECT target_kind,status FROM slack_invalidation_intents WHERE source_event_key=$1 ORDER BY target_kind',[key])).rows;}
  it.each(['consent_granted','consent_revoked','provider_attested','provider_updated'])('stages seven derived-only intents for %s with raw absent and raw receipt already sealed',async type=>{
    const f=await fixture(),id=await event(f,type),sources=new SlackSourceRepo(env.db.pool);
    expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_sources')).rows[0].n).toBe(0);
    await new SlackPolicyEventConsumer(env.db.pool,env.invalidationService,sources).consumePendingPolicyEvents();
    const before=(await env.db.pool.query('SELECT * FROM slack_invalidation_receipts WHERE source_event_key=$1',[`policy:${id}`])).rows[0];
    const fanout=new SlackDerivedPolicyFanout(env.db.pool,env.invalidationService);expect(await fanout.runOnce()).toEqual({staged:1});expect(await fanout.runOnce()).toEqual({staged:0});
    const epoch=slackPolicyRefToEpoch(f.policy),key=`derived-policy:${id}:${hashPolicyEpoch(epoch)}`;
    expect((await rows(key)).map(r=>r.target_kind)).toEqual([...SLACK_DERIVED_TARGET_KINDS].sort());
    expect((await env.db.pool.query('SELECT * FROM slack_invalidation_receipts WHERE source_event_key=$1',[`policy:${id}`])).rows[0]).toEqual(before);
    expect((await env.invalidationService.checkBarriers({binding:f.seed.binding,epoch})).blocked).toBe(true);
  });
  it('preserves equal/newer revisions and unrelated workspace/provider epochs',async()=>{
    const f=await fixture();await event(f,'consent_revoked',f.policy.consentRevision);await event(f,'provider_updated',f.policy.providerRevision);
    await event(f,'consent_revoked',undefined,'OTHER');await event(f,'provider_updated',undefined,undefined,'OTHER_PROVIDER');
    expect(await new SlackDerivedPolicyFanout(env.db.pool,env.invalidationService).runOnce()).toEqual({staged:0});expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_invalidation_intents')).rows[0].n).toBe(0);
  });
  it('handles exact revisions beyond2^53 and Unicode policy hashes',async()=>{
    const f=await fixture();f.policy={...f.policy,consentRevision:'9007199254740993'};
    await env.db.pool.query('UPDATE slack_derived_provenance_segments SET consent_revision=$1 WHERE derived_copy_id=$2',[f.policy.consentRevision,f.copy.derivedCopyId]);
    const id=await event(f,'consent_revoked','9007199254740994');expect(await new SlackDerivedPolicyFanout(env.db.pool,env.invalidationService).runOnce()).toEqual({staged:1});
    expect(await rows(`derived-policy:${id}:${hashPolicyEpoch(slackPolicyRefToEpoch(f.policy))}`)).toHaveLength(7);
  });
  it('continues past processed early pairs at a one-pair batch limit and deduplicates concurrent workers',async()=>{
    const f=await fixture();for(let i=0;i<3;i++)await event(f);
    const a=new SlackDerivedPolicyFanout(env.db.pool,env.invalidationService),b=new SlackDerivedPolicyFanout(env.db.pool,env.invalidationService);
    await Promise.all([a.runOnce(1),b.runOnce(1)]);for(let i=0;i<3;i++)await a.runOnce(1);
    expect((await env.db.pool.query("SELECT count(*)::int AS n FROM slack_invalidation_receipts WHERE source_event_key LIKE 'derived-policy:%'")).rows[0].n).toBe(3);
    expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_invalidation_intents')).rows[0].n).toBe(21);
  });
  it('fans provider changes out to two distinct user/workspace bindings',async()=>{
    const a=await fixture(),b=await fixture();await event(a,'provider_updated');await new SlackDerivedPolicyFanout(env.db.pool,env.invalidationService).runOnce();
    const bindings=(await env.db.pool.query("SELECT epoch_json->'binding'->>'atiUserId' AS owner FROM slack_invalidation_barriers WHERE barrier_type='epoch'")).rows.map(r=>r.owner).sort();
    expect(bindings).toEqual([a.seed.person.id,b.seed.person.id].sort());
  });
  it('rolls a crash after real derived staging back and preserves raw/derived replay distinction',async()=>{
    const f=await fixture();await event(f);
    const broken=new SlackDerivedPolicyFanout(env.db.pool,{stageDerivedInTransaction:async(c,input)=>{await env.invalidationService.stageDerivedInTransaction(c,input);throw new Error('FIXTURE_CRASH');}});
    await expect(broken.runOnce()).rejects.toThrow();expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_invalidation_receipts')).rows[0].n).toBe(0);
    const epoch=slackPolicyRefToEpoch(f.policy),input={sourceEventKey:`derived-mode:${randomUUID()}`,effects:[{effectKey:'epoch',barrier:{barrierType:'epoch' as const,epoch,reason:'policy'},purgeTarget:{scope:'policy_epoch_invalidated' as const,epoch,cascadeTargetKinds:[...SLACK_DERIVED_TARGET_KINDS],tombstoneReason:'policy_changed' as const}}]},c=await env.db.pool.connect();
    try {await expect(env.invalidationService.stageDerivedInTransaction(c,input)).rejects.toThrow();await c.query('BEGIN');await env.invalidationService.stageDerivedInTransaction(c,input);await c.query('COMMIT');
      await c.query('BEGIN');await expect(env.invalidationService.stageInTransaction(c,input)).rejects.toThrow('PAYLOAD_CONFLICT');await c.query('ROLLBACK');expect(await rows(input.sourceEventKey)).toHaveLength(7);
    }finally{c.release();}
  });
  it('native invalidation sweep stages derived obligations independently of content configuration',async()=>{
    const f=await fixture();await event(f);const sources=new SlackSourceRepo(env.db.pool);
    const runner=new SlackInvalidationRunner(sources,env.invalidationService,new SlackPolicyEventConsumer(env.db.pool,env.invalidationService,sources),{derivedPolicyFanout:new SlackDerivedPolicyFanout(env.db.pool,env.invalidationService)});
    expect((await runner.tick()).derivedPolicyEpochsStaged).toBe(1);expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_invalidation_intents')).rows[0].n).toBe(7);await runner.stop();
  });
  it('includes unresolved fingerprint-retired lineage and deduplicates repeated segments of its epoch',async()=>{
    const f=await fixture();await env.db.pool.query("UPDATE slack_derived_copies SET status='retired',retired_at=now(),retired_reason='fingerprint_mismatch' WHERE id=$1",[f.copy.derivedCopyId]);
    await env.db.pool.query(`INSERT INTO slack_derived_provenance_segments SELECT (jsonb_populate_record(NULL::slack_derived_provenance_segments,
      to_jsonb(s)||jsonb_build_object('id',gen_random_uuid(),'segment_index',1))).* FROM slack_derived_provenance_segments s WHERE s.derived_copy_id=$1`,[f.copy.derivedCopyId]);
    await event(f);expect(await new SlackDerivedPolicyFanout(env.db.pool,env.invalidationService).runOnce()).toEqual({staged:1});
    expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_invalidation_intents')).rows[0].n).toBe(7);
  });
  it('rejects a corrupt stored epoch without forging any receipt or barrier',async()=>{
    const f=await fixture();await event(f);await env.db.pool.query("UPDATE slack_derived_provenance_segments SET config_fingerprint='' WHERE derived_copy_id=$1",[f.copy.derivedCopyId]);
    await expect(new SlackDerivedPolicyFanout(env.db.pool,env.invalidationService).runOnce()).rejects.toThrow();
    expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_invalidation_receipts')).rows[0].n).toBe(0);expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_invalidation_barriers')).rows[0].n).toBe(0);
  });
});
