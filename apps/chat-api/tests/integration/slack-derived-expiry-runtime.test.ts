import {randomUUID,createHash} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {SLACK_DERIVED_TARGET_KINDS} from '@wap/tool-schemas';
import {createSlackReadEnvironment,TEST_ENV,type SlackReadEnvironment} from '../helpers/slack-private-read-fixture.js';
import {MessageRepo} from '../../src/db/repositories/message-repo.js';
import {SlackDerivedLineageRepo} from '../../src/db/repositories/slack-derived-lineage-repo.js';
import {SlackDerivedExpiryFanout} from '../../src/services/slack/slack-derived-expiry.js';
import {SlackMessagePurgeConsumer} from '../../src/services/slack/slack-message-purge-consumer.js';
import {SlackMessageContentPurger} from '../../src/services/slack/slack-message-content-purger.js';

let env:SlackReadEnvironment,registry:SlackDerivedLineageRepo,messages:MessageRepo,fanout:SlackDerivedExpiryFanout;
beforeAll(async()=>{env=await createSlackReadEnvironment('derived_expiry');registry=new SlackDerivedLineageRepo(env.db.pool,env.policyService);messages=new MessageRepo(env.db.pool,registry);fanout=new SlackDerivedExpiryFanout(env.db.pool);});
afterAll(async()=>{await env?.close();});
async function fixture(){
  const owner=await env.addUser({name:'expiry fixture',workspaceId:`T${randomUUID()}`,actorId:`U${randomUUID()}`});
  const consent=await env.consentRepo.getConsent(owner.binding.workspaceId,env.runtimeIdentity.providerId);
  await env.consentRepo.grantConsent({workspaceId:owner.binding.workspaceId,providerId:env.runtimeIdentity.providerId,expectedRevision:consent!.revision,policyVersion:'v1.0.0',purposes:['storage','manual_lookup','planning'],retentionDays:14,organizationRepresentative:'fixture',evidenceRef:'FIXTURE',recordedBy:'fixture'});
  const policy=await env.policyService.resolveSlackModelPolicy({binding:owner.binding,purpose:'storage',requestedRetentionDays:7,env:TEST_ENV});if(!policy.allowed)throw Error('fixture denied');
  const conv=(await env.db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id',[owner.person.id])).rows[0].id;
  const segments=[{sourceRef:{binding:owner.binding,resourceType:'message' as const,resourceId:JSON.stringify(['C_EXPIRY','1730000000.000001']),revision:'1730000000.000001'},storagePolicyRef:policy.policyReference,acquisitionPolicyRef:{...policy.policyReference,purpose:'planning' as const,requestedRetentionDays:0},captureHash:'a'.repeat(64),capturedAt:new Date().toISOString()}];
  const message=await messages.createSlackMessage(conv,'assistant','private expired content',{type:'answer'},{segments,selectors:['content']});
  const copy=(await env.db.pool.query('SELECT * FROM slack_derived_copies WHERE target_id=$1',[message.id])).rows[0];
  return {owner,conv,segments,message,copy};
}
async function expire(id:string,index?:number){await env.db.pool.query(`UPDATE slack_derived_provenance_segments SET captured_at=statement_timestamp()-interval '8 days',expires_at=statement_timestamp()-interval '1 day' WHERE derived_copy_id=$1${index===undefined?'':' AND segment_index=$2'}`,index===undefined?[id]:[id,index]);}
async function intent(id:string){return (await env.db.pool.query("SELECT i.* FROM slack_invalidation_intents i JOIN slack_derived_expiry_proofs p ON p.source_event_key=i.source_event_key WHERE p.derived_copy_id=$1 AND i.target_kind='chat_history_message' ORDER BY i.created_at LIMIT 1",[id])).rows[0];}
async function lease(consumer:SlackMessagePurgeConsumer,id:string){const target=await intent(id);const found=(await consumer.claim(50)).find(j=>j.id===target.id);expect(found).toBeDefined();return found!;}

it('competing stages atomically create one immutable expiry proof and seven derived intents with no raw/global barrier',async()=>{
  const f=await fixture();await expire(f.copy.id);
  await Promise.all([fanout.runOnce(100),new SlackDerivedExpiryFanout(env.db.pool).runOnce(100)]);
  const proof=(await env.db.pool.query('SELECT * FROM slack_derived_expiry_proofs WHERE derived_copy_id=$1',[f.copy.id])).rows;
  expect(proof).toHaveLength(1);
  const jobs=(await env.db.pool.query('SELECT target_kind,status FROM slack_invalidation_intents WHERE source_event_key=$1',[proof[0].source_event_key])).rows;
  expect(jobs.map(j=>j.target_kind).sort()).toEqual([...SLACK_DERIVED_TARGET_KINDS].sort());expect(jobs.every(j=>j.status==='pending')).toBe(true);
  expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_invalidation_barriers')).rows[0].n).toBe(0);
  expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_sources')).rows[0].n).toBe(0);
},20_000);

it('one expired segment removes mixed output but preserves a fresh equal-reference acquisition and another ATI owner',async()=>{
  const f=await fixture(),other=await fixture();
  const second={...f.segments[0]!,sourceRef:{...f.segments[0]!.sourceRef,resourceId:JSON.stringify(['C_EXPIRY','1730000000.000002']),revision:'1730000000.000002'}};
  const mixed=await messages.createSlackMessage(f.conv,'assistant','private mixed output',{type:'answer'},{segments:[...f.segments,second],selectors:['content']});
  const mixedCopy=(await env.db.pool.query('SELECT id FROM slack_derived_copies WHERE target_id=$1',[mixed.id])).rows[0].id;
  await expire(f.copy.id);await expire(mixedCopy,0);
  const fresh=await messages.createSlackMessage(f.conv,'assistant','Fresh equal reference',{type:'answer'},{segments:f.segments.map(s=>({...s,capturedAt:new Date().toISOString()})),selectors:['content']});
  await fanout.runOnce(100);await new SlackMessagePurgeConsumer(env.db.pool).runOnce(50);
  const rows=(await env.db.pool.query('SELECT id,content FROM messages WHERE id=ANY($1::uuid[])',[[f.message.id,mixed.id,fresh.id,other.message.id]])).rows;
  for(const id of [f.message.id,mixed.id])expect(rows.find(r=>r.id===id).content).toBe('Slack content is unavailable.');
  expect(rows.find(r=>r.id===fresh.id).content).toBe('Fresh equal reference');expect(rows.find(r=>r.id===other.message.id).content).toBe('private expired content');
  expect((await messages.listMessages(f.conv)).find(m=>m.id===fresh.id)?.content).toBe('Fresh equal reference');
},20_000);

it('microsecond timestamps and BIGINT versions remain exact through proof, selection and physical CAS',async()=>{
  await env.db.pool.query("SELECT setval('slack_derived_target_version_seq',9007199254740992)");const f=await fixture();expect(f.copy.target_version).toBe('9007199254740993');
  await env.db.pool.query("UPDATE slack_derived_provenance_segments SET captured_at=date_trunc('second',statement_timestamp())-interval '8 days'+interval '.123456 seconds',expires_at=date_trunc('second',statement_timestamp())-interval '1 day'+interval '.123456 seconds' WHERE derived_copy_id=$1",[f.copy.id]);
  await fanout.runOnce(100);const proof=(await env.db.pool.query('SELECT snapshot,target_version FROM slack_derived_expiry_proofs WHERE derived_copy_id=$1',[f.copy.id])).rows[0];
  expect(proof.target_version).toBe('9007199254740993');expect(proof.snapshot.expiresAt).toMatch(/123456Z$/);
  const c=new SlackMessagePurgeConsumer(env.db.pool);expect(await c.process(await lease(c,f.copy.id))).toBe('completed');
  expect((await env.db.pool.query('SELECT content FROM messages WHERE id=$1',[f.message.id])).rows[0].content).toBe('Slack content is unavailable.');
},20_000);

it('an expiry-looking prefix cannot replace durable proof and corrupted proof cannot erase any content',async()=>{
  const f=await fixture();await expire(f.copy.id);await fanout.runOnce(100);const original=await intent(f.copy.id);
  const fakeKey=`derived-expiry:forged-${randomUUID()}`;
  await env.db.pool.query("INSERT INTO slack_invalidation_receipts(source_event_key,payload_hash) VALUES($1,'forged')",[fakeKey]);
  const fake=(await env.db.pool.query("INSERT INTO slack_invalidation_intents(source_event_key,effect_key,target_kind,purge_target) VALUES($1,'derived_capture_expired','chat_history_message',$2) RETURNING id",[fakeKey,JSON.stringify(original.purge_target)])).rows[0];
  await env.db.pool.query("UPDATE slack_derived_expiry_proofs SET snapshot=jsonb_set(snapshot,'{targetVersion}','\"1\"') WHERE derived_copy_id=$1",[f.copy.id]);
  const c=new SlackMessagePurgeConsumer(env.db.pool),leases=await c.claim(50);
  expect(await c.process(leases.find(j=>j.id===fake.id)!)).toBe('retried');expect(await c.process(leases.find(j=>j.id===original.id)!)).toBe('retried');
  expect((await env.db.pool.query('SELECT content FROM messages WHERE id=$1',[f.message.id])).rows[0].content).toBe('private expired content');
},20_000);

it('physical expiry requires no current connection/consent and never overwrites an unknown fingerprint',async()=>{
  const f=await fixture(),changed=await fixture();await expire(f.copy.id);await expire(changed.copy.id);await fanout.runOnce(100);
  await env.db.pool.query("UPDATE slack_connections SET status='disconnected',config=NULL,identity_version=identity_version+1 WHERE id=$1",[f.owner.binding.connectionId]);
  await env.db.pool.query("UPDATE messages SET content='human replacement' WHERE id=$1",[changed.message.id]);
  const c=new SlackMessagePurgeConsumer(env.db.pool);expect(await c.process(await lease(c,f.copy.id))).toBe('completed');
  // Claiming the first lease also claimed other jobs. Reuse its actual nonce.
  const row=(await env.db.pool.query('SELECT id,worker_id,leased_until::text AS expiry FROM slack_invalidation_intents WHERE id=$1',[(await intent(changed.copy.id)).id])).rows[0];
  expect(await c.process({id:row.id,workerNonce:row.worker_id,leaseUntil:row.expiry})).toBe('retried');
  expect((await env.db.pool.query('SELECT content FROM messages WHERE id=$1',[f.message.id])).rows[0].content).toBe('Slack content is unavailable.');
  expect((await env.db.pool.query('SELECT content FROM messages WHERE id=$1',[changed.message.id])).rows[0].content).toBe('human replacement');
  expect((await intent(changed.copy.id)).status).toBe('failed');
},20_000);

it('real AbortSignal arriving after SQL inserts rolls back stage proof/receipt/intents together',async()=>{
  const f=await fixture();await expire(f.copy.id);const controller=new AbortController();
  const pool=new Proxy(env.db.pool,{get(target,key){if(key==='connect')return async()=>{const client=await target.connect();return {query:async(...args:any[])=>{const result=await(client.query as any)(...args);if(typeof args[0]==='string'&&args[0].startsWith('INSERT INTO slack_invalidation_intents'))controller.abort();return result;},release:()=>client.release()};};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  await expect(new SlackDerivedExpiryFanout(pool).runOnce(100,controller.signal)).rejects.toThrow();
  expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_derived_expiry_proofs WHERE derived_copy_id=$1',[f.copy.id])).rows[0].n).toBe(0);
  expect((await env.db.pool.query("SELECT count(*)::int AS n FROM slack_invalidation_intents WHERE purge_target->'binding'->>'atiUserId'=$1",[f.owner.person.id])).rows[0].n).toBe(0);
},20_000);

it('lease reclaim and real abort after physical SQL both roll back bytes before a replacement worker completes',async()=>{
  const f=await fixture();await expire(f.copy.id);await fanout.runOnce(100);const job=await intent(f.copy.id),real=new SlackMessageContentPurger(),next=new SlackMessagePurgeConsumer(env.db.pool);let replacement:any;
  const c=new SlackMessagePurgeConsumer(env.db.pool,{purger:{sourceLockKeysInTransaction:(...args)=>real.sourceLockKeysInTransaction(...args),purgeInTransaction:async(client,input)=>{const result=await real.purgeInTransaction(client,input);if(!replacement){await env.db.pool.query("UPDATE slack_invalidation_intents SET leased_until=clock_timestamp()-interval '1 second' WHERE id=$1",[job.id]);replacement=(await next.claim(50)).find(j=>j.id===job.id);}return result;}}});
  expect(await c.process(await lease(c,f.copy.id))).toBe('lost');
  expect((await env.db.pool.query('SELECT content FROM messages WHERE id=$1',[f.message.id])).rows[0].content).toBe('private expired content');
  const controller=new AbortController(),aborting=new SlackMessagePurgeConsumer(env.db.pool,{purger:{sourceLockKeysInTransaction:(...args)=>real.sourceLockKeysInTransaction(...args),purgeInTransaction:async(client,input)=>{const result=await real.purgeInTransaction(client,input);controller.abort();return result;}}});
  expect(await aborting.process(replacement,controller.signal)).toBe('retried');expect(controller.signal.aborted).toBe(true);
  expect((await env.db.pool.query('SELECT content FROM messages WHERE id=$1',[f.message.id])).rows[0].content).toBe('private expired content');
  expect(await next.process(await lease(next,f.copy.id))).toBe('completed');
  expect((await env.db.pool.query('SELECT content FROM messages WHERE id=$1',[f.message.id])).rows[0].content).toBe('Slack content is unavailable.');
},20_000);

it('an acquisition that expires after BEGIN receives an honest DB cutoff and can physically complete',async()=>{
  const f=await fixture();await expire(f.copy.id);let moved=false;
  const pool=new Proxy(env.db.pool,{get(target,key){if(key==='connect')return async()=>{const client=await target.connect();return {query:async(...args:any[])=>{const result=await(client.query as any)(...args);if(args[0]==='BEGIN'&&!moved){moved=true;await client.query("UPDATE slack_derived_provenance_segments SET captured_at=statement_timestamp()-interval '7 days',expires_at=statement_timestamp() WHERE derived_copy_id=$1",[f.copy.id]);}return result;},release:()=>client.release()};};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  await new SlackDerivedExpiryFanout(pool).runOnce(100);
  const c=new SlackMessagePurgeConsumer(env.db.pool);expect(await c.process(await lease(c,f.copy.id))).toBe('completed');
  expect((await env.db.pool.query('SELECT content FROM messages WHERE id=$1',[f.message.id])).rows[0].content).toBe('Slack content is unavailable.');
},20_000);

it('a proof for one owner or generation cannot authorize an intent retargeted to another owner',async()=>{
  const f=await fixture(),other=await fixture();await expire(f.copy.id);await expire(other.copy.id);await fanout.runOnce(100);
  const a=await intent(f.copy.id),b=await intent(other.copy.id);
  await env.db.pool.query('UPDATE slack_invalidation_intents SET purge_target=$2 WHERE id=$1',[a.id,JSON.stringify(b.purge_target)]);
  const c=new SlackMessagePurgeConsumer(env.db.pool);expect(await c.process(await lease(c,f.copy.id))).toBe('retried');
  expect((await env.db.pool.query('SELECT content FROM messages WHERE id=$1',[other.message.id])).rows[0].content).toBe('private expired content');
  expect((await intent(f.copy.id)).status).toBe('failed');
},20_000);

it('an expiry proof binds the original artifact fingerprint and cannot bless an in-place rewritten copy',async()=>{
  const f=await fixture();await expire(f.copy.id);await fanout.runOnce(100);
  const replacement='Human replacement outside old proof';
  await env.db.pool.query('UPDATE messages SET content=$2 WHERE id=$1',[f.message.id,replacement]);
  await env.db.pool.query('UPDATE slack_derived_copies SET target_fingerprint=$2 WHERE id=$1',[f.copy.id,createHash('sha256').update(replacement).digest('hex')]);
  const c=new SlackMessagePurgeConsumer(env.db.pool);expect(await c.process(await lease(c,f.copy.id))).toBe('retried');
  expect((await env.db.pool.query('SELECT content FROM messages WHERE id=$1',[f.message.id])).rows[0].content).toBe(replacement);
},20_000);
