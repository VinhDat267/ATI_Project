import {createHash,createHmac,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createSlackReadEnvironment,TEST_KEY,TEST_ENV,type SlackReadEnvironment,type SeededUser} from '../../helpers/slack-private-read-fixture.js';
import {SlackSafeWriter} from '../../../src/services/slack/slack-safe-writer.js';
import {SlackIngressService} from '../../../src/services/slack/slack-ingress-service.js';
import {SlackEventReceiptRepo} from '../../../src/db/repositories/slack-event-receipt-repo.js';
import {SlackOAuthClient} from '../../../src/services/slack/oauth-client.js';
import {SlackTokenManager} from '../../../src/services/slack/token-manager.js';
import {SlackWriteOutboxRepo} from '../../../src/db/repositories/slack-write-outbox-repo.js';

describe('04C real PostgreSQL/HTTP write attempt, echo and readback',()=>{
 let env:SlackReadEnvironment,seed:SeededUser,input:any,saved:any[];
 beforeAll(async()=>{env=await createSlackReadEnvironment('slack_write_safety');});
 beforeEach(async()=>{
  await env.db.pool.query('DELETE FROM slack_event_receipts');env.fixture.clearHandlers();env.fixture.reset();saved=[];
  seed=await env.addUser({name:'write',workspaceId:`T${randomUUID()}`,actorId:`U${randomUUID()}`,accessToken:'WRITE_FIXTURE'});
  await env.db.pool.query("UPDATE slack_connections SET scopes=ARRAY['chat:write','channels:read','channels:history'] WHERE id=$1",[seed.binding.connectionId]);
  const conv=randomUUID(),plan=randomUUID();input={planId:plan,stepId:'post',planHash:'f'.repeat(64),appId:seed.row.app_id,binding:seed.binding,params:{channel:'C_FIXTURE',text:'USER_AUTHORED_SENTINEL'}};
  await env.db.pool.query('INSERT INTO conversations(id,user_id,title) VALUES($1,$2,$3)',[conv,seed.person.id,'Fixture']);
  const body={kind:'plan',steps:[{id:'post',tool:'myslack.chat_postMessage',args:input.params,dependsOn:[]}],connections:{myslack:{bindings:{[seed.binding.connectionId]:seed.binding},steps:{post:{connectionId:seed.binding.connectionId,tool:'myslack.chat_postMessage',dependencies:[]}}}}};
  input.planHash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
  await env.db.pool.query("INSERT INTO plans(id,conv_id,plan_json,plan_text,plan_hash,status,expires_at) VALUES($1,$2,$3,$4,$5,'approved',clock_timestamp()+interval '1 hour')",[plan,conv,body,JSON.stringify(body),input.planHash]);
  env.fixture.setHandler('/conversations.info',()=>({body:{ok:true,channel:{id:'C_FIXTURE',is_member:true}}}));
  env.fixture.setHandler('/chat.postMessage',r=>{const b=JSON.parse(r.body);const m={user:seed.binding.slackUserId,text:b.text,client_msg_id:b.client_msg_id,ts:'1730000000.000001'};saved.push(m);return {body:{ok:true,channel:b.channel,ts:m.ts,message:m}};});
  env.fixture.setHandler('/conversations.history',()=>({body:{ok:true,messages:saved,has_more:false,response_metadata:{next_cursor:''}}}));
 });
 afterAll(async()=>{await env?.close();});
 function writer(extraAuthorize?:(i:any,c:any)=>Promise<void>){return new SlackSafeWriter({pool:env.db.pool,apiBaseUrl:env.fixture.url,timeoutMs:500,
  tokens:new SlackTokenManager(env.connectionRepo,new SlackOAuthClient({appId:seed.row.app_id,clientId:'fixture',clientSecret:'fixture',redirectUri:'http://127.0.0.1/callback',authorizationUrl:'https://slack.com/oauth/v2/authorize',apiBaseUrl:env.fixture.url}),TEST_KEY),
  authorize:async(i,c)=>{const d=await env.policyService.resolveSlackModelPolicy({binding:seed.binding,purpose:'planning',requestedRetentionDays:0},c);if(!d.allowed)throw new Error('DENIED');if((await env.invalidationService.checkBarriers({binding:seed.binding,channelId:'C_FIXTURE'},c)).blocked)throw new Error('DENIED');await extraAuthorize?.(i,c);}});}
 const posts=()=>env.fixture.requests.filter(r=>r.path==='/chat.postMessage');
 const outbox=async()=>(await env.db.pool.query('SELECT * FROM slack_write_outbox WHERE plan_id=$1',[input.planId])).rows[0];
 async function child(mode='execute'){
  const p=spawn(process.execPath,['--import','tsx',fileURLToPath(new URL('../../helpers/slack-safe-writer-child.mts',import.meta.url))],{windowsHide:true,env:{...process.env,DATABASE_URL:env.db.pool.options.connectionString,FIXTURE_KEY:TEST_KEY,FIXTURE_POLICY_ENV:JSON.stringify(TEST_ENV)},stdio:['pipe','pipe','pipe']});
  let output='';p.stdout.on('data',c=>{output+=c;});p.stderr.resume();const timer=setTimeout(()=>p.kill(),12000);p.stdin.end(JSON.stringify({input,mode,endpoint:env.fixture.url}));
  try{await new Promise<void>((resolve,reject)=>{p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(new Error('fixture child failed')));});return JSON.parse(output);}finally{clearTimeout(timer);if(p.exitCode===null)p.kill();}
 }
 async function echo(overrides:Record<string,unknown>={}){
  const row=await outbox();const e={type:'message',channel:'C_FIXTURE',user:seed.binding.slackUserId,ts:'1730000000.000001',event_ts:'1730000000.000001',client_msg_id:row?.client_msg_id,text:'BODY_NEVER_PERSISTED',...overrides};
  const rawBody=Buffer.from(JSON.stringify({type:'event_callback',api_app_id:seed.row.app_id,team_id:seed.binding.workspaceId,event_id:`Ev${randomUUID()}`,event_context:'opaque',event:e})),time=String(Math.floor(Date.now()/1000));
  return new SlackIngressService({config:{appId:seed.row.app_id,signingSecret:'FIXTURE_SIGNING',automationEnabled:true},repo:new SlackEventReceiptRepo(env.db.pool,env.invalidationService)}).handleRequest({rawBody,timestampHeader:time,signatureHeader:'v0='+createHmac('sha256','FIXTURE_SIGNING').update('v0:'+time+':').update(rawBody).digest('hex')});
 }
 it('commits its attempt before HTTP, confirms via authorized readback and returns metadata only',async()=>{
  env.fixture.setHandler('/chat.postMessage',async r=>{expect((await outbox()).status).toBe('dispatching');const b=JSON.parse(r.body);saved.push({user:seed.binding.slackUserId,text:b.text,client_msg_id:b.client_msg_id,ts:'1730000000.000001'});return {body:{ok:true,channel:b.channel,ts:saved[0].ts,message:saved[0]}};});
  const receipt=await writer().execute(input);expect(receipt).toMatchObject({status:'confirmed',channel:'C_FIXTURE',ts:'1730000000.000001'});expect(JSON.stringify(receipt)).not.toContain(input.params.text);expect((await outbox()).status).toBe('confirmed');expect(posts()).toHaveLength(1);expect(posts()[0]!.authorization).toBe('Bearer WRITE_FIXTURE');expect(JSON.stringify(await outbox())).not.toContain(input.params.text);
 });
 it('two concurrent attempts and a new process cannot write the same approved step twice',async()=>{
  await Promise.allSettled([writer().execute(input),writer().execute(input)]);expect(await child()).toMatchObject({status:'confirmed'});expect(posts()).toHaveLength(1);expect(saved).toHaveLength(1);
 });
 it('keeps UNKNOWN after provider commit then real abort and reconciles by read only after restart',async()=>{
  const controller=new AbortController();let release!:()=>void;
  env.fixture.setHandler('/chat.postMessage',async r=>{const b=JSON.parse(r.body);saved.push({user:seed.binding.slackUserId,text:b.text,client_msg_id:b.client_msg_id,ts:'1730000000.000001'});controller.abort();await new Promise<void>(r=>{release=r;});return {body:{ok:true,channel:b.channel,ts:saved[0].ts,message:saved[0]}};});
  try{await expect(writer().execute({...input,signal:controller.signal})).rejects.toMatchObject({category:'UNKNOWN'});expect((await outbox()).status).toBe('unknown');expect(await child()).toEqual({category:'UNKNOWN'});expect(posts()).toHaveLength(1);expect(await child('reconcile')).toMatchObject({status:'confirmed'});expect(posts()).toHaveLength(1);}finally{release?.();}
 });
 it.each(['absent','foreign','duplicate','differentText'])('readback %s cannot turn an ambiguous attempt into a new write',async mode=>{
  env.fixture.setHandler('/chat.postMessage',()=>({status:503,body:{ok:false,error:'RAW_PROVIDER_SECRET'}}));await expect(writer().execute(input)).rejects.toMatchObject({category:'UNKNOWN'});const row=await outbox(),m={user:seed.binding.slackUserId,text:input.params.text,client_msg_id:row.client_msg_id,ts:'1730000000.000001'};
  saved=mode==='absent'?[]:mode==='foreign'?[{...m,user:'U_OTHER'}]:mode==='duplicate'?[m,{...m,ts:'1730000000.000002'}]:[{...m,text:'different'}];await expect(writer().reconcile(input)).rejects.toMatchObject({category:'UNKNOWN'});expect(posts()).toHaveLength(1);expect((await outbox()).status).toBe('unknown');
 });
 it('a confirmed provider receipt followed by unavailable readback remains UNKNOWN without resend',async()=>{
  env.fixture.setHandler('/conversations.history',()=>({status:503,body:{ok:false}}));await expect(writer().execute(input)).rejects.toMatchObject({category:'UNKNOWN'});expect((await outbox()).provider_ts).toBe('1730000000.000001');await expect(writer().execute(input)).rejects.toMatchObject({category:'UNKNOWN'});expect(posts()).toHaveLength(1);
 });
 it.each(['pending','hash','actor','permission','membership','integrity','expired','completed'])('denies %s before sending any write',async reason=>{
  if(reason==='pending')await env.db.pool.query("UPDATE plans SET status='pending' WHERE id=$1",[input.planId]);
  if(reason==='hash')input.planHash='e'.repeat(64);
  if(reason==='actor')input.binding={...input.binding,slackUserId:'U_OTHER'};
  if(reason==='permission')await env.db.pool.query("UPDATE slack_connections SET scopes='{}'::text[] WHERE id=$1",[seed.binding.connectionId]);
  if(reason==='membership')env.fixture.setHandler('/conversations.info',()=>({body:{ok:true,channel:{id:'C_FIXTURE',is_member:false}}}));
  if(reason==='integrity')await env.db.pool.query("UPDATE plans SET plan_text='{}' WHERE id=$1",[input.planId]);
  if(reason==='expired')await env.db.pool.query("UPDATE plans SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[input.planId]);
  if(reason==='completed')await env.db.pool.query("UPDATE plans SET status='completed' WHERE id=$1",[input.planId]);
  await expect(writer().execute(input)).rejects.toMatchObject({details:{requestSent:false}});expect(posts()).toHaveLength(0);
 });
 it('changed params, binding or plan hash cannot rebind an existing operation',async()=>{
  await writer().execute(input);for(const changed of [{...input,params:{...input.params,text:'MUTATION'}},{...input,planHash:'e'.repeat(64)},{...input,binding:{...input.binding,identityVersion:input.binding.identityVersion+1}}])await expect(writer().execute(changed)).rejects.toMatchObject({details:{requestSent:false}});expect(posts()).toHaveLength(1);
 });
 it('signed echo before provider receipt is quarantined and never becomes a fanout job',async()=>{
  env.fixture.setHandler('/chat.postMessage',async r=>{const b=JSON.parse(r.body);expect((await echo()).status).toBe(200);expect((await env.db.pool.query('SELECT status,discard_reason FROM slack_event_receipts ORDER BY created_at DESC LIMIT 1')).rows[0]).toEqual({status:'discarded',discard_reason:'echo_pending'});saved.push({user:seed.binding.slackUserId,text:b.text,client_msg_id:b.client_msg_id,ts:'1730000000.000001'});return {body:{ok:true,channel:b.channel,ts:saved[0].ts,message:saved[0]}};});await writer().execute(input);expect((await env.db.pool.query('SELECT count(*)::int n FROM slack_triage_jobs')).rows[0].n).toBe(0);
 });
 it('confirmed exact native timestamp is an echo; another message from the same human remains ordinary',async()=>{
  await writer().execute(input);await echo({client_msg_id:undefined});await echo({client_msg_id:undefined,ts:'1730000000.000002'});const rows=(await env.db.pool.query('SELECT status,discard_reason FROM slack_event_receipts ORDER BY created_at')).rows;expect(rows).toEqual([{status:'discarded',discard_reason:'ati_echo'},{status:'pending_fanout',discard_reason:null}]);expect(JSON.stringify((await env.db.pool.query('SELECT * FROM slack_event_receipts')).rows)).not.toContain('BODY_NEVER_PERSISTED');
 });
 it('reconciliation checks current authority and keeps UNKNOWN after disconnect',async()=>{
  env.fixture.setHandler('/chat.postMessage',()=>({status:503,body:{ok:false}}));await expect(writer().execute(input)).rejects.toMatchObject({category:'UNKNOWN'});await env.connectionRepo.disconnect(seed.person.id,seed.binding.connectionId);const reads=env.fixture.requests.length;await expect(writer().reconcile(input)).rejects.toMatchObject({details:{requestSent:false}});expect(env.fixture.requests).toHaveLength(reads);expect(posts()).toHaveLength(1);
 });
 async function prepare(){const repo=new SlackWriteOutboxRepo(env.db.pool);const row=await repo.withOwner(input,c=>repo.transaction(c,async()=>{await repo.authority(c,input);return repo.prepare(c,input);}));return {repo,row};}
 it('reclaims an expired pre-dispatch preparation without changing its stable client message ID',async()=>{
  const {row}=await prepare();await env.db.pool.query("UPDATE slack_write_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE operation_id=$1",[row.operation_id]);await writer().execute(input);expect(posts()).toHaveLength(1);expect((await outbox()).client_msg_id).toBe(row.client_msg_id);
 });
 it('a process crash after dispatch checkpoint is UNKNOWN even without execution-step persistence',async()=>{
  const {repo,row}=await prepare();await repo.withOwner(input,c=>repo.transaction(c,()=>repo.dispatch(c,row)));await expect(writer().execute(input)).rejects.toMatchObject({category:'UNKNOWN'});expect(posts()).toHaveLength(0);expect((await env.db.pool.query('SELECT count(*)::int n FROM execution_steps WHERE plan_id=$1',[input.planId])).rows[0].n).toBe(0);
 });
 it('can reconcile an already dispatched attempt after plan expiry using fresh read authority only',async()=>{
  env.fixture.setHandler('/chat.postMessage',()=>({status:503,body:{ok:false}}));await expect(writer().execute(input)).rejects.toMatchObject({category:'UNKNOWN'});const row=await outbox();saved=[{user:seed.binding.slackUserId,text:input.params.text,client_msg_id:row.client_msg_id,ts:'1730000000.000001'}];await env.db.pool.query("UPDATE plans SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[input.planId]);expect(await writer().reconcile(input)).toMatchObject({status:'confirmed'});expect(posts()).toHaveLength(1);
 });
 it.each([{user:'U_OTHER'},{channel:'C_OTHER'}])('same client correlation with wrong actor/channel remains an ordinary message: %j',async other=>{
  await writer().execute(input);await echo(other);expect((await env.db.pool.query('SELECT status FROM slack_event_receipts ORDER BY created_at DESC LIMIT 1')).rows[0].status).toBe('pending_fanout');
 });
 it('blocks a permission change observed during membership lookup before the write checkpoint',async()=>{
  env.fixture.setHandler('/conversations.info',async()=>{await env.db.pool.query("UPDATE slack_connections SET scopes='{}'::text[] WHERE id=$1",[seed.binding.connectionId]);return {body:{ok:true,channel:{id:'C_FIXTURE',is_member:true}}};});await expect(writer().execute(input)).rejects.toMatchObject({details:{requestSent:false}});expect(posts()).toHaveLength(0);expect(await outbox()).toBeUndefined();
 });
 it('never follows a write redirect with the private credential',async()=>{
  env.fixture.setHandler('/chat.postMessage',()=>({status:302,headers:{Location:env.fixture.url+'/credential_sink'},body:{}}));await expect(writer().execute(input)).rejects.toMatchObject({category:'UNKNOWN'});expect(env.fixture.requests.some(r=>r.path==='/credential_sink')).toBe(false);
 });
 it('a match on a partial readback page cannot confirm before later pages succeed',async()=>{
  let reads=0;env.fixture.setHandler('/conversations.history',()=>++reads===1?{body:{ok:true,messages:saved,has_more:true,response_metadata:{next_cursor:'page2'}}}:{status:503,body:{ok:false,error:'RAW_SECRET'}});await expect(writer().execute(input)).rejects.toMatchObject({message:'SLACK_WRITE_UNKNOWN',category:'UNKNOWN'});expect((await outbox()).status).toBe('unknown');expect(posts()).toHaveLength(1);
 });
 it('cancellation before dispatch creates no provider request or durable attempt',async()=>{
  const c=new AbortController();c.abort();await expect(writer().execute({...input,signal:c.signal})).rejects.toMatchObject({details:{requestSent:false}});expect(env.fixture.requests).toHaveLength(0);expect(await outbox()).toBeUndefined();
 });
 it('preserves UNKNOWN when PostgreSQL rejects persistence after the provider accepted the post',async()=>{
  await env.db.pool.query("CREATE FUNCTION fail_unknown() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='unknown' THEN RAISE EXCEPTION 'fixture persistence outage'; END IF; RETURN NEW; END $$");
  await env.db.pool.query('CREATE TRIGGER fail_unknown BEFORE UPDATE ON slack_write_outbox FOR EACH ROW EXECUTE FUNCTION fail_unknown()');
  env.fixture.setHandler('/chat.postMessage',()=>{saved.push({committed:true});return {status:503,body:{ok:false}};});
  try{await expect(writer().execute(input)).rejects.toMatchObject({category:'UNKNOWN',details:{requestSent:true}});expect(posts()).toHaveLength(1);expect((await outbox()).status).toBe('dispatching');}finally{await env.db.pool.query('DROP TRIGGER fail_unknown ON slack_write_outbox');}
 });
 it('cannot report not-sent when real SQL advisory-unlock cleanup fails after confirmation',async()=>{
  const schema=(await env.db.pool.query('SELECT quote_ident(current_schema()) s')).rows[0].s;
  await env.db.pool.query(`CREATE FUNCTION ${schema}.pg_advisory_unlock(integer,integer) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture cleanup outage'; END $$`);
  try{await expect(writer(async(_i,c)=>{if((await c.query("SELECT 1 FROM slack_write_outbox WHERE plan_id=$1 AND status='dispatching'",[input.planId])).rowCount){const schema=(await c.query('SELECT quote_ident(current_schema()) s')).rows[0].s;await c.query(`SET search_path TO ${schema},pg_catalog`);}}).execute(input)).rejects.toMatchObject({category:'UNKNOWN',details:{requestSent:true}});expect((await outbox()).status).toBe('confirmed');expect(posts()).toHaveLength(1);}finally{await env.db.pool.query(`DROP FUNCTION ${schema}.pg_advisory_unlock(integer,integer)`);}
 });
 it('rechecks actual SQL plan expiry after the final callback before committing dispatch',async()=>{
  await expect(writer(async(_i,c)=>{const row=(await c.query("SELECT operation_id FROM slack_write_outbox WHERE plan_id=$1 AND status='prepared'",[input.planId])).rows[0];if(row){await c.query("UPDATE plans SET expires_at=clock_timestamp()+interval '50 milliseconds' WHERE id=$1",[input.planId]);await c.query('SELECT pg_sleep(0.08)');}}).execute(input)).rejects.toMatchObject({details:{requestSent:false}});expect(posts()).toHaveLength(0);expect((await outbox()).status).toBe('prepared');
 });
 it('stops history pagination immediately after a real consent revocation in the first response',async()=>{
  let reads=0;env.fixture.setHandler('/conversations.history',async()=>{reads++;if(reads===1){const [consent]=await env.consentRepo.listConsentsForWorkspace(seed.binding.workspaceId);await env.consentRepo.revokeConsent({workspaceId:seed.binding.workspaceId,providerId:consent!.providerId,recordedBy:'fixture',reason:'fixture',expectedRevision:consent!.revision});return {body:{ok:true,messages:saved,has_more:true,response_metadata:{next_cursor:'page2'}}};}return {body:{ok:true,messages:[],has_more:false}};});await expect(writer().execute(input)).rejects.toMatchObject({category:'UNKNOWN'});expect(reads).toBe(1);
 });
 it.each([null,{},'junk',{ts:'bad'}, {ts:'1730000000.000002',text:42}])('malformed complete history page %j cannot contribute confirmation',async malformed=>{
  env.fixture.setHandler('/conversations.history',()=>({body:{ok:true,messages:[...saved,malformed],has_more:false,response_metadata:{next_cursor:''}}}));await expect(writer().execute(input)).rejects.toMatchObject({category:'UNKNOWN'});expect((await outbox()).status).toBe('unknown');
 });
 it('checks the actual SQL lease clock after a row-lock wait before dispatch',async()=>{
  const {repo,row}=await prepare(),holder=await env.db.pool.connect(),c=await env.db.pool.connect();let running:Promise<unknown>|undefined;
  try{await env.db.pool.query("UPDATE slack_write_outbox SET lease_until=clock_timestamp()+interval '200 milliseconds' WHERE operation_id=$1",[row.operation_id]);await holder.query('BEGIN');await holder.query('SELECT operation_id FROM slack_write_outbox WHERE operation_id=$1 FOR UPDATE',[row.operation_id]);const pid=(await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid;running=repo.transaction(c,()=>repo.dispatch(c,row));const rejected=expect(running).rejects.toMatchObject({details:{requestSent:false}});
   const end=Date.now()+1000;let blocked=false;while(Date.now()<end){blocked=(await env.db.pool.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) b',[pid])).rows[0].b;if(blocked)break;await new Promise(r=>setTimeout(r,5));}expect(blocked).toBe(true);
   while(!(await env.db.pool.query('SELECT lease_until<clock_timestamp() expired FROM slack_write_outbox WHERE operation_id=$1',[row.operation_id])).rows[0].expired)await new Promise(r=>setTimeout(r,5));await holder.query('COMMIT');await rejected;expect((await outbox()).status).toBe('prepared');expect(posts()).toHaveLength(0);
  }finally{await holder.query('ROLLBACK');holder.release();await running?.catch(()=>{});c.release();}
 });
});
