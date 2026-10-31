import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
import {createMigratedSchema} from '../helpers/gmail-test-db.js';
import {MessageRepo} from '../../src/db/repositories/message-repo.js';
import {ConversationRepo} from '../../src/db/repositories/conversation-repo.js';
import {ChatService} from '../../src/services/chat-service.js';
import {createConversationRoutes} from '../../src/routes/conversation-routes.js';
import {createSlackReadEnvironment,TEST_ENV} from '../helpers/slack-private-read-fixture.js';
import {SlackMessageOriginBackfill} from '../../src/services/slack/slack-message-origin-backfill.js';
import {SlackMessagePurgeConsumer} from '../../src/services/slack/slack-message-purge-consumer.js';
import {SLACK_DERIVED_TARGET_KINDS} from '@wap/tool-schemas';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {SlackDerivedLineageRepo} from '../../src/db/repositories/slack-derived-lineage-repo.js';

let db:Awaited<ReturnType<typeof createMigratedSchema>>,messages:MessageRepo,conversations:ConversationRepo;
let env:Awaited<ReturnType<typeof createSlackReadEnvironment>>;
beforeAll(async()=>{for(const [k,v] of Object.entries(TEST_ENV))vi.stubEnv(k,v);env=await createSlackReadEnvironment('message_origin');db=env.db;messages=new MessageRepo(db.pool);conversations=new ConversationRepo(db.pool);});
afterAll(async()=>{await env?.close();vi.unstubAllEnvs();});
async function fixture(){const owner=await db.person();const conv=await conversations.createConversation(owner.id);return {owner,conv};}
function app(owner:string){const a=express();a.use((req,_res,next)=>{(req as any).user={id:owner};next();});a.use('/conversations',createConversationRoutes({convRepo:conversations,msgRepo:messages,chatService:{} as ChatService}));return a;}

it('quarantines unmarked legacy content, memory and title at actual HTTP and planner hydration',async()=>{
  const {owner,conv}=await fixture();
  await db.pool.query('UPDATE conversations SET title=$2 WHERE id=$1',[conv.id,'unknown legacy private title']);
  await db.pool.query("INSERT INTO messages(conv_id,role,content,metadata) VALUES($1,'assistant','unknown legacy private answer',$2),($1,'system','',$3)",
    [conv.id,{type:'answer'},{type:'working_memory',state:{thread:{id:'OLD',name:'unknown legacy private memory'}}}]);
  const a=app(owner.id);
  for(const path of [`/conversations/${conv.id}`,`/conversations/${conv.id}/messages/latest`,'/conversations?search=private']){
    const response=await request(a).get(path);expect(response.status).toBe(200);expect(response.text).not.toContain('unknown legacy private');
  }
  const inputs:any[]=[],events:any[]=[];
  const chat=new ChatService({msgRepo:messages,planner:{processMessage:async input=>{inputs.push(input);return {kind:'answer',text:'safe new answer',lookups:[],usedDirectory:[]};},routeSchedule:async()=>({services:[],unavailable:[]})},eventEmitter:{emit:(name,value)=>events.push({name,value})}});
  await chat.handleUserMessage({conversationId:conv.id,userId:owner.id,content:'a new human request'});
  await vi.waitFor(()=>expect(inputs).toHaveLength(1));
  expect(JSON.stringify(inputs)).not.toContain('unknown legacy private');
  await vi.waitFor(()=>expect(events.some(e=>e.name==='answer')).toBe(true));
  expect((await db.pool.query('SELECT content FROM messages WHERE conv_id=$1 AND role=$2',[conv.id,'assistant'])).rows.some(r=>r.content==='unknown legacy private answer')).toBe(true);
});

it('keeps real source-free human and machine writers usable, including first title and rename',async()=>{
  const {owner,conv}=await fixture();
  await messages.createMessage(conv.id,'user','new human request');
  await messages.createMessage(conv.id,'assistant','new machine answer',{type:'answer'});
  expect((await messages.listMessages(conv.id)).map(m=>m.content)).toEqual(['new human request','new machine answer']);
  expect((await conversations.getConversation(conv.id))?.title).toBe('new human request');
  await conversations.renameConversation(conv.id,owner.id,'new human title');
  expect((await conversations.getConversation(conv.id))?.title).toBe('new human title');
  expect(JSON.stringify((await request(app(owner.id)).get(`/conversations/${conv.id}`)).body)).not.toContain('slack_artifact_origin');
});

it('does not trust raw SQL written after a genuine new writer or a different conversation title',async()=>{
  const {owner,conv}=await fixture(),other=await conversations.createConversation(owner.id);
  await messages.createMessage(conv.id,'user','verified first message');
  await db.pool.query("INSERT INTO messages(id,conv_id,role,content) VALUES($1,$2,'assistant','uncertified SQL bypass')",[randomUUID(),conv.id]);
  await db.pool.query('UPDATE conversations SET title=$2 WHERE id=$1',[other.id,'uncertified SQL bypass']);
  expect(JSON.stringify(await messages.listMessages(conv.id))).not.toContain('uncertified SQL bypass');
  expect((await conversations.getConversation(other.id))?.title).not.toBe('uncertified SQL bypass');
});

it('denies copied certificates across ID/conversation/table/owner and a changed source-free remainder',async()=>{
  const {owner,conv}=await fixture(),other=await conversations.createConversation(owner.id),foreign=await fixture();
  const good=await messages.createMessage(conv.id,'assistant','certified answer',{type:'answer'});
  const clone=(await db.pool.query("INSERT INTO messages(conv_id,role,content,metadata) VALUES($1,'assistant','certified answer',$2) RETURNING id",[other.id,{type:'answer'}])).rows[0];
  await db.pool.query(`INSERT INTO slack_message_origins SELECT artifact_table,$2,ati_user_id,conv_id,cutover_id,producer,selectors,remainder_fingerprint,recorded_at
    FROM slack_message_origins WHERE artifact_table='messages' AND artifact_id=$1`,[good.id,clone.id]);
  expect(JSON.stringify(await messages.listMessages(other.id))).not.toContain('certified answer');
  await db.pool.query('UPDATE messages SET conv_id=$2 WHERE id=$1',[good.id,foreign.conv.id]);
  expect(JSON.stringify(await messages.listMessages(foreign.conv.id))).not.toContain('certified answer');
  await db.pool.query('UPDATE messages SET conv_id=$2,metadata=$3 WHERE id=$1',[good.id,conv.id,{type:'answer',extra:'uncertified new remainder'}]);
  expect(JSON.stringify(await messages.listMessages(conv.id))).not.toContain('uncertified new remainder');
  expect(JSON.stringify(await messages.listMessages(conv.id))).not.toContain('certified answer');
  await db.pool.query('UPDATE conversations SET title=$2 WHERE id=$1',[other.id,'certified answer']);
  await db.pool.query("DELETE FROM slack_message_origins WHERE artifact_table='conversations' AND artifact_id=$1",[other.id]);
  expect((await db.pool.query("UPDATE slack_message_origins SET artifact_table='conversations',artifact_id=$2,conv_id=$2 WHERE artifact_table='messages' AND artifact_id=$1",[clone.id,other.id])).rowCount).toBe(1);
  expect((await conversations.getConversation(other.id))?.title).not.toBe('certified answer');
});

it('requires an enabled explicit cutover, rolls back both real writers and never auto-reenables it',async()=>{
  const {conv}=await fixture();
  await db.pool.query('UPDATE slack_message_origin_cutovers SET enabled=false');
  try{
    await db.pool.query(await readFile(new URL('../../../../db/v3/0025_slack_message_origin.sql',import.meta.url),'utf8'));
    expect((await db.pool.query('SELECT enabled FROM slack_message_origin_cutovers')).rows[0].enabled).toBe(false);
    await expect(messages.createMessage(conv.id,'user','must roll back')).rejects.toThrow('SLACK_ORIGIN_CUTOVER_REQUIRED');
    expect((await db.pool.query('SELECT count(*)::int AS n FROM messages WHERE conv_id=$1',[conv.id])).rows[0].n).toBe(0);
    expect((await db.pool.query('SELECT title FROM conversations WHERE id=$1',[conv.id])).rows[0].title).toBeNull();
    expect((await conversations.getConversation(conv.id))?.title).toBe('Slack content is unavailable.');
  }finally{await db.pool.query('UPDATE slack_message_origin_cutovers SET enabled=true');}
});

async function sourceFixture(){
  const owner=await env.addUser({name:'origin fixture',workspaceId:`T${randomUUID()}`,actorId:`U${randomUUID()}`});
  const current=await env.consentRepo.getConsent(owner.binding.workspaceId,env.runtimeIdentity.providerId);
  await env.consentRepo.grantConsent({workspaceId:owner.binding.workspaceId,providerId:env.runtimeIdentity.providerId,expectedRevision:current!.revision,policyVersion:'v1.0.0',purposes:['storage','manual_lookup','planning'],retentionDays:14,organizationRepresentative:'fixture',evidenceRef:'FIXTURE',recordedBy:'fixture'});
  const policy=await env.policyService.resolveSlackModelPolicy({binding:owner.binding,purpose:'storage',requestedRetentionDays:7,env:TEST_ENV});
  if(!policy.allowed)throw Error('fixture denied');
  const conv=await conversations.createConversation(owner.person.id);
  const segments=[{sourceRef:{binding:owner.binding,resourceType:'message' as const,resourceId:JSON.stringify(['C_ORIGIN','1730000000.000001']),revision:'1730000000.000001'},
    acquisitionPolicyRef:{...policy.policyReference,purpose:'manual_lookup' as const,requestedRetentionDays:0},storagePolicyRef:policy.policyReference,captureHash:'a'.repeat(64),capturedAt:new Date().toISOString()}];
  return {owner,conv,segments};
}
async function invalidateSource(f:Awaited<ReturnType<typeof sourceFixture>>){
  await env.stageBarriers([{effectKey:'origin revoke',barrier:{barrierType:'binding',binding:f.owner.binding,reason:'fixture'},purgeTarget:{scope:'authorization_disconnect',binding:f.owner.binding,cascadeTargetKinds:[...SLACK_DERIVED_TARGET_KINDS],tombstoneReason:'connection_disconnected'}}],`origin:${randomUUID()}`);
}

it('keeps certified mixed-service remainder after invalidation/physical erasure but never launders a tampered remainder',async()=>{
  const f=await sourceFixture();
  const good=await messages.createSlackMessage(f.conv.id,'system','',{type:'working_memory',state:{members:[{id:'S',name:'private origin source'},{id:'T',name:'known Trello remainder'}]}},{segments:f.segments,selectors:['state:/members#id=S']});
  const bad=await messages.createSlackMessage(f.conv.id,'system','',{type:'working_memory',state:{members:[{id:'S',name:'private origin source'},{id:'T',name:'known Trello remainder'}]}},{segments:f.segments,selectors:['state:/members#id=S']});
  await db.pool.query("UPDATE messages SET metadata=jsonb_set(metadata,'{state,members,1,name}','\"uncertified remainder mutation\"') WHERE id=$1",[bad.id]);
  await invalidateSource(f);await new SlackMessagePurgeConsumer(db.pool,{targetKind:'working_memory_entity'}).runOnce(50);
  const visible=await messages.listMessages(f.conv.id);
  expect(visible.find(m=>m.id===good.id)?.metadata.state.members).toEqual([{id:'T',name:'known Trello remainder'}]);
  expect(JSON.stringify(visible)).not.toContain('private origin source');expect(JSON.stringify(visible)).not.toContain('uncertified remainder mutation');
  expect((await db.pool.query('SELECT metadata FROM messages WHERE id=$1',[bad.id])).rows[0].metadata.state.members).toEqual([{id:'T',name:'uncertified remainder mutation'}]);
});

it('backfills only fully covered registered evidence; dry-run/apply/idempotency leave ambiguous legacy unchanged and blocked',async()=>{
  const f=await sourceFixture(),covered=await messages.createSlackMessage(f.conv.id,'assistant','registered legacy source',{type:'answer'},{segments:f.segments,selectors:['content']});
  await db.pool.query("DELETE FROM slack_message_origins WHERE artifact_table='messages' AND artifact_id=$1",[covered.id]);
  await db.pool.query('UPDATE messages SET slack_lineage_manifest=NULL WHERE id=$1',[covered.id]);
  const unknown=(await db.pool.query("INSERT INTO messages(conv_id,role,content,metadata) VALUES($1,'user','unknown plain legacy',$2) RETURNING *",[f.conv.id,{type:'working_memory',state:{other:'unknown legacy remainder'}}])).rows[0];
  expect(JSON.stringify(await messages.listMessages(f.conv.id))).not.toContain('registered legacy source');
  const backfill=new SlackMessageOriginBackfill(db.pool);
  const dry=await backfill.page('messages',{limit:200});expect(dry.eligible).toBeGreaterThanOrEqual(1);expect(dry.quarantined).toBeGreaterThanOrEqual(1);expect(dry.applied).toBe(0);
  expect((await db.pool.query('SELECT slack_lineage_manifest FROM messages WHERE id=$1',[covered.id])).rows[0].slack_lineage_manifest).toBeNull();
  const applied=await backfill.page('messages',{limit:200,apply:true});expect(applied.applied).toBeGreaterThanOrEqual(1);
  expect((await messages.listMessages(f.conv.id)).find(m=>m.id===covered.id)?.content).toBe('registered legacy source');
  expect((await db.pool.query('SELECT * FROM messages WHERE id=$1',[unknown.id])).rows[0]).toEqual(unknown);
  expect(JSON.stringify(await messages.listMessages(f.conv.id))).not.toContain('unknown plain legacy');
  expect((await backfill.page('messages',{limit:200,apply:true})).applied).toBe(0);
  await invalidateSource(f);await new SlackMessagePurgeConsumer(db.pool).runOnce(50);
  expect(JSON.stringify(await messages.listMessages(f.conv.id))).not.toContain('registered legacy source');
});

it('backfill refuses partial mixed legacy, stale fingerprints and invalid existing origin proofs',async()=>{
  const f=await sourceFixture();
  const partial=await messages.createSlackMessage(f.conv.id,'system','',{type:'working_memory',state:{members:[{id:'S',name:'covered'},{id:'T',name:'unproven other service'}]}},{segments:f.segments,selectors:['state:/members#id=S']});
  const stale=await messages.createSlackMessage(f.conv.id,'assistant','registered',{type:'answer'},{segments:f.segments,selectors:['content']});
  const tamper=await messages.createMessage(f.conv.id,'assistant','certified before tamper');
  await db.pool.query("DELETE FROM slack_message_origins WHERE artifact_table='messages' AND artifact_id=ANY($1::uuid[])",[[partial.id,stale.id]]);
  await db.pool.query("UPDATE messages SET content='unproven changed bytes' WHERE id=ANY($1::uuid[])",[[stale.id,tamper.id]]);
  await new SlackMessageOriginBackfill(db.pool).page('messages',{limit:200,apply:true});
  const visible=await messages.listMessages(f.conv.id);expect(JSON.stringify(visible)).not.toContain('unproven');expect(JSON.stringify(visible)).not.toContain('covered');
});

it('backfills authenticated old manual-title evidence without guessing ordinary legacy titles',async()=>{
  const {owner,conv}=await fixture();await conversations.renameConversation(conv.id,owner.id,'authenticated old rename');
  await db.pool.query("DELETE FROM slack_message_origins WHERE artifact_table='conversations' AND artifact_id=$1",[conv.id]);
  expect((await conversations.getConversation(conv.id))?.title).not.toBe('authenticated old rename');
  await new SlackMessageOriginBackfill(db.pool).page('conversations',{limit:200,apply:true});
  expect((await conversations.getConversation(conv.id))?.title).toBe('authenticated old rename');
});

it('bounds cursor backfill and honors a real AbortSignal without issuing certificates',async()=>{
  const controller=new AbortController();controller.abort();
  const backfill=new SlackMessageOriginBackfill(db.pool);
  await expect(backfill.page('messages',{apply:true,signal:controller.signal})).rejects.toThrow();
  await expect(backfill.page('messages',{limit:201})).rejects.toThrow();
  const first=await backfill.page('messages',{limit:1});expect(first.scanned).toBe(1);expect(first.nextCursor).toBeTruthy();
  const second=await backfill.page('messages',{limit:1,afterId:first.nextCursor!});expect(second.nextCursor).not.toBe(first.nextCursor);
});

it('requires an actual held transaction before a source-free writer can insert',async()=>{
  const {conv}=await fixture(),client=await db.pool.connect();
  try{
    await expect(messages.createMessage(conv.id,'user','autocommit forbidden',undefined,client)).rejects.toThrow();
    expect((await db.pool.query('SELECT count(*)::int AS n FROM messages WHERE conv_id=$1',[conv.id])).rows[0].n).toBe(0);
    await client.query('BEGIN');await messages.createMessage(conv.id,'user','rolled back caller',undefined,client);await client.query('ROLLBACK');
    expect((await messages.listMessages(conv.id))).toEqual([]);
  }finally{client.release();}
});

it('serializes real competing first-title writers and binds the winning title',async()=>{
  const {conv}=await fixture();await Promise.all(['first A','first B'].map(text=>messages.createMessage(conv.id,'user',text)));
  expect(['first A','first B']).toContain((await conversations.getConversation(conv.id))?.title);
  expect((await messages.listMessages(conv.id))).toHaveLength(2);
});

it('quarantines unmarked legacy before the actual planner receives history or working memory',async()=>{
  const {owner,conv}=await fixture();
  await db.pool.query("INSERT INTO messages(conv_id,role,content,metadata) VALUES($1,'system','',$2),($1,'assistant','unknown model secret',null)",[conv.id,{type:'working_memory',state:{thread:{id:'private',name:'unknown model secret'}}}]);
  const inputs:any[]=[],events:any[]=[];
  const chat=new ChatService({msgRepo:messages,planner:{processMessage:async input=>{inputs.push(input);return {kind:'answer',text:'safe result',lookups:[],usedDirectory:[]};},routeSchedule:async()=>({services:[],unavailable:[]})},eventEmitter:{emit:(name,value)=>events.push({name,value})}});
  await chat.handleUserMessage({conversationId:conv.id,userId:owner.id,content:'new request'});
  await vi.waitFor(()=>expect(events.some(e=>e.name==='answer')).toBe(true));
  expect(inputs).toHaveLength(1);expect(JSON.stringify(inputs)).not.toContain('unknown model secret');
});

it('rolls back actual message/copies/certificate when a real signal aborts during the SQL certificate insert',async()=>{
  const f=await sourceFixture(),controller=new AbortController();
  await db.pool.query(`CREATE FUNCTION origin_insert_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$;
    CREATE TRIGGER origin_insert_pause AFTER INSERT ON slack_message_origins FOR EACH ROW EXECUTE FUNCTION origin_insert_pause()`);
  try{
    const running=messages.createSlackMessage(f.conv.id,'assistant','must rollback after insert',{type:'answer'},{segments:f.segments,selectors:['content']},undefined,controller.signal);
    await vi.waitFor(async()=>expect((await db.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND query LIKE 'INSERT INTO slack_message_origins%' AND wait_event='PgSleep'")).rows[0].n).toBeGreaterThan(0),{timeout:4000,interval:20});
    controller.abort();await expect(running).rejects.toThrow();
    expect((await db.pool.query('SELECT count(*)::int AS n FROM messages WHERE conv_id=$1',[f.conv.id])).rows[0].n).toBe(0);
    expect((await db.pool.query("SELECT count(*)::int AS n FROM slack_message_origins WHERE artifact_table='messages' AND conv_id=$1",[f.conv.id])).rows[0].n).toBe(0);
    expect((await db.pool.query('SELECT count(*)::int AS n FROM slack_derived_copies WHERE ati_user_id=$1',[f.owner.person.id])).rows[0].n).toBe(0);
  }finally{await db.pool.query('DROP TRIGGER origin_insert_pause ON slack_message_origins; DROP FUNCTION origin_insert_pause()');}
});

it('source writer rejects an autocommit held client before inserting any artifact',async()=>{
  const f=await sourceFixture(),client=await db.pool.connect();
  try{
    await expect(messages.createSlackMessage(f.conv.id,'assistant','no autocommit source',{type:'answer'},{segments:f.segments,selectors:['content']},client)).rejects.toThrow();
    expect((await db.pool.query('SELECT count(*)::int AS n FROM messages WHERE conv_id=$1',[f.conv.id])).rows[0].n).toBe(0);
  }finally{client.release();}
});

it('actual maintenance CLI defaults to dry run, requires explicit apply and prints only aggregate counts',async()=>{
  const {owner,conv}=await fixture();await conversations.renameConversation(conv.id,owner.id,'CLI old manual private title');
  await db.pool.query("DELETE FROM slack_message_origins WHERE artifact_table='conversations' AND artifact_id=$1",[conv.id]);
  const childEnv:NodeJS.ProcessEnv={DATABASE_URL:db.pool.options.connectionString};
  for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA'])if(process.env[key])childEnv[key]=process.env[key];
  const cli=fileURLToPath(new URL('../../src/cli/slack-message-origin-backfill.ts',import.meta.url));
  const run=(args:string[])=>promisify(execFile)(process.execPath,['--import','tsx',cli,...args],{env:childEnv,windowsHide:true,timeout:15000});
  const dry=await run([]);const rows=dry.stdout.trim().split('\n').map(line=>JSON.parse(line));expect(rows).toHaveLength(2);expect(rows.every(r=>r.mode==='dry_run'&&r.applied===0)).toBe(true);
  expect((await conversations.getConversation(conv.id))?.title).not.toBe('CLI old manual private title');
  const applied=await run(['--apply']);expect(applied.stdout).not.toContain('CLI old manual private title');expect(applied.stderr).toBe('');
  expect((await conversations.getConversation(conv.id))?.title).toBe('CLI old manual private title');
},25_000);

it('registers and certifies the actual internal run-user first-title fallback, then physically erases it',async()=>{
  const f=await sourceFixture(),registry=new SlackDerivedLineageRepo(db.pool,env.policyService),client=await db.pool.connect();
  try{
    await client.query('BEGIN');await registry.prepareConversationWriteInTransaction(client,f.conv.id,f.owner.person.id,f.segments);
    const schedule=(await client.query("INSERT INTO schedules(user_id,conv_id,name,request,recurrence,services,status) VALUES($1,$2,'run private title','run private request','{}',ARRAY['trello'],'paused') RETURNING id",[f.owner.person.id,f.conv.id])).rows[0];
    const run=(await client.query("INSERT INTO schedule_runs(schedule_id,schedule_version,trigger,due_at,status,conv_id) VALUES($1,1,'manual',now(),'planning',$2) RETURNING id",[schedule.id,f.conv.id])).rows[0];
    await messages.createSlackRunMessage(f.conv.id,'run private first seed',{type:'schedule_run',runId:run.id,scheduleId:schedule.id,name:'run private title'},
      {segments:f.segments,selectors:['content','metadata.name']},client);
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  expect((await conversations.getConversation(f.conv.id))?.title).toBe('run private first seed');
  expect((await db.pool.query("SELECT count(*)::int AS n FROM slack_derived_copies WHERE target_id=$1 AND target_sub_id='title' AND status='active'",[f.conv.id])).rows[0].n).toBe(1);
  await invalidateSource(f);await new SlackMessagePurgeConsumer(db.pool).runOnce(50);await new SlackMessagePurgeConsumer(db.pool,{targetKind:'scheduled_workflow_arg'}).runOnce(50);
  expect((await db.pool.query('SELECT title FROM conversations WHERE id=$1',[f.conv.id])).rows[0].title).toBe('Slack content is unavailable.');
  expect(JSON.stringify(await messages.listMessages(f.conv.id))).not.toContain('run private');
});

it('backfill rolls back a real certificate insert when cancellation arrives before commit',async()=>{
  const {owner,conv}=await fixture();await conversations.renameConversation(conv.id,owner.id,'backfill cancelled title');
  await db.pool.query("DELETE FROM slack_message_origins WHERE artifact_table='conversations' AND artifact_id=$1",[conv.id]);
  const hex=(BigInt('0x'+conv.id.replaceAll('-',''))-1n).toString(16).padStart(32,'0');
  const afterId=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  const controller=new AbortController();
  await db.pool.query(`CREATE FUNCTION backfill_insert_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$;
    CREATE TRIGGER backfill_insert_pause AFTER INSERT ON slack_message_origins FOR EACH ROW EXECUTE FUNCTION backfill_insert_pause()`);
  try{
    const running=new SlackMessageOriginBackfill(db.pool).page('conversations',{afterId,limit:1,apply:true,signal:controller.signal});
    await vi.waitFor(async()=>expect((await db.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND query LIKE 'INSERT INTO slack_message_origins%' AND wait_event='PgSleep'")).rows[0].n).toBeGreaterThan(0),{timeout:4000,interval:20});
    controller.abort();await expect(running).rejects.toThrow();
    expect((await db.pool.query("SELECT 1 FROM slack_message_origins WHERE artifact_table='conversations' AND artifact_id=$1",[conv.id])).rowCount).toBe(0);
    expect((await db.pool.query('SELECT title FROM conversations WHERE id=$1',[conv.id])).rows[0].title).toBe('backfill cancelled title');
    expect((await conversations.getConversation(conv.id))?.title).not.toBe('backfill cancelled title');
  }finally{await db.pool.query('DROP TRIGGER backfill_insert_pause ON slack_message_origins; DROP FUNCTION backfill_insert_pause()');}
});

it('snapshots a source-free writer input before a real parent-lock wait',async()=>{
  const {conv}=await fixture(),blocker=await db.pool.connect();const metadata:any={type:'answer'};
  try{
    await blocker.query('BEGIN');await blocker.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE',[conv.id]);
    const running=messages.createMessage(conv.id,'assistant','stable writer input',metadata);
    await vi.waitFor(async()=>expect((await db.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND query LIKE 'SELECT title FROM conversations%' AND wait_event_type='Lock'")).rows[0].n).toBeGreaterThan(0),{timeout:4000,interval:20});
    metadata.changed={service:'myslack',text:'mutated after validation'};
    await blocker.query('COMMIT');const row=await running;
    expect(row.metadata).toEqual({type:'answer'});
    expect((await messages.listMessages(conv.id))[0]?.content).toBe('stable writer input');
  }finally{await blocker.query('ROLLBACK').catch(()=>{});blocker.release();}
});
