import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createHmac,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {it,expect,vi} from 'vitest';
import {generateAccessToken} from '../../src/auth/jwt.js';
import {createSlackReadEnvironment,TEST_KEY} from '../helpers/slack-private-read-fixture.js';
const root=fileURLToPath(new URL('../../../../',import.meta.url)),secret='m4-native-fixture-signing-secret',jwt='m4-native-fixture-private-jwt-long-secret';
async function start(env:Awaited<ReturnType<typeof createSlackReadEnvironment>>,enabled:boolean){
 const socket=createServer();await new Promise<void>(r=>socket.listen(0,'127.0.0.1',r));const port=(socket.address() as any).port;await new Promise<void>(r=>socket.close(()=>r()));
 const variables:NodeJS.ProcessEnv={};for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA'])if(process.env[key])variables[key]=process.env[key];
 Object.assign(variables,env.runtimeEnv,{NODE_ENV:'test',RUNTIME_MODE:'sandbox',PORT:String(port),DATABASE_URL:env.db.pool.options.connectionString,ENCRYPTION_KEY:TEST_KEY,JWT_SECRET:jwt,AUTH_SIGNUP_ENABLED:'false',GMAIL_ENABLED:'off',MYCALENDAR_ENABLED:'off',MYSHEETS_ENABLED:'off',SCHEDULES_ENABLED:'off',MYSLACK_ENABLED:enabled?'on':'off',MYSLACK_AUTOMATION_ENABLED:enabled?'on':'off',MYSLACK_APP_ID:'A_TEST',SLACK_SIGNING_SECRET:secret,MYSLACK_APP_TOKEN:'xapp-fixture-only',MYSLACK_OAUTH_CLIENT_ID:'fixture',MYSLACK_OAUTH_CLIENT_SECRET:'fixture',MYSLACK_OAUTH_REDIRECT_URI:'https://ati.example/connections/myslack/callback',MYSLACK_API_BASE_URL:env.fixture.url,MYSLACK_OAUTH_AUTH_URL:env.fixture.url+'/authorize'});
 const child=spawn(process.execPath,['--import','tsx','apps/chat-api/src/server.ts'],{cwd:root,env:variables,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{output=(output+b).slice(-6000);});const exited=new Promise<void>(r=>child.once('close',()=>r()));const url='http://127.0.0.1:'+port;
 const stop=async()=>{child.kill();let timer:ReturnType<typeof setTimeout>|undefined;await Promise.race([exited,new Promise<void>(r=>{timer=setTimeout(()=>{child.kill('SIGKILL');r();},5000);})]);clearTimeout(timer);await exited;};
 try{await vi.waitFor(async()=>{if(child.exitCode!==null)throw new Error('M4 server fixture failed: '+output);expect((await fetch(url+'/api/health')).ok).toBe(true);},{timeout:25000,interval:50});}catch(e){await stop();throw e;}
 return {url,stop,output:()=>output};
}
async function signed(url:string,workspace:string,event:Record<string,unknown>,eventId='Ev_'+randomUUID()){
 const timestamp=String(Math.floor(Date.now()/1000)),raw=JSON.stringify({type:'event_callback',api_app_id:'A_TEST',team_id:workspace,event_id:eventId,event_time:Number(timestamp),event_context:'ctx-m4',event});
 const signature='v0='+createHmac('sha256',secret).update('v0:'+timestamp+':'+raw).digest('hex');return {eventId,response:await fetch(url+'/api/slack/events',{method:'POST',headers:{'content-type':'application/json','x-slack-request-timestamp':timestamp,'x-slack-signature':signature},body:raw})};
}
it('actual server bootstrap: signed metadata→fresh private HTTP→bounded model→guarded proposal; global cap503; flags-off lifecycle purge',async()=>{
 const env=await createSlackReadEnvironment('assistant_native',f=>({LLM_PROVIDER:'openai-compatible',LLM_MODEL:'fixture',LLM_BASE_URL:f.url,RUNTIME_ACCOUNT_ID:'M4_NATIVE_LOOPBACK'}));let app:Awaited<ReturnType<typeof start>>|undefined;
 try{
  const seed=await env.addUser({name:'native',workspaceId:'T_'+randomUUID().replaceAll('-',''),actorId:'U_ONE'}),consent=(await env.consentRepo.getConsent(seed.binding.workspaceId,env.runtimeIdentity.providerId))!;
  await env.consentRepo.grantConsent({workspaceId:seed.binding.workspaceId,providerId:env.runtimeIdentity.providerId,expectedRevision:consent.revision,policyVersion:'v1.0.0',purposes:['triage','storage','planning','manual_lookup','digest'],retentionDays:7,organizationRepresentative:'fixture',evidenceRef:'fixture',recordedBy:'fixture'});
  env.fixture.setHandler('/apps.event.authorizations.list',r=>{expect(r.authorization).toBe('Bearer xapp-fixture-only');return {body:{ok:true,authorizations:[{team_id:seed.binding.workspaceId,user_id:'U_ONE',is_bot:false}],response_metadata:{next_cursor:''}}};});
  env.fixture.setHandler('/conversations.info',()=>({body:{ok:true,channel:{id:'C_NATIVE',is_channel:true,is_member:true}}}));
  const actualText='<@U_ONE> giúp chuẩn bị báo cáo khách hàng từ nguồn HTTP',messages:any[]=[];
  env.fixture.setHandler('/conversations.history',()=>({body:{ok:true,messages,response_metadata:{next_cursor:''}}}));
  env.fixture.setHandler('/chat/completions',r=>{const body=JSON.parse(r.body);expect(body.max_completion_tokens).toBe(1024);expect(r.body).toContain(actualText);expect(r.body).not.toContain('INGRESS_BODY_MUST_NOT_CLASSIFY');expect(r.body).not.toContain(seed.person.id);return {body:{model:'fixture',choices:[{message:{content:JSON.stringify({kind:'proposal',title:'Báo cáo khách hàng',rationale:'Nhờ trực tiếp',sourceIndices:[0],relevance:{kind:'mention',sourceIndex:0,evidence:'<@U_ONE>'},intents:[{action:'task',service:'trello',summary:'Chuẩn bị báo cáo khách hàng'}]})}}]}};});
  app=await start(env,true);const headers={Authorization:'Bearer '+generateAccessToken(seed.person,jwt,seed.person.sid).accessToken},path='/api/connections/myslack/'+seed.row.id+'/assistant';
  const current=await (await fetch(app.url+path,{headers})).json();expect(current.available).toBe(true);expect((await fetch(app.url+path,{method:'PUT',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({expectedVersion:current.configVersion,config:{...current.config,enabled:true,mode:'ai'}})})).status).toBe(200);
  const ts=(await env.db.pool.query('SELECT extract(epoch FROM clock_timestamp())::text AS ts')).rows[0].ts;messages.push({type:'message',user:'U_REQUESTER',ts,text:actualText});
  const incoming=await signed(app.url,seed.binding.workspaceId,{type:'message',user:'U_REQUESTER',channel:'C_NATIVE',ts,event_ts:ts,thread_ts:ts,text:'INGRESS_BODY_MUST_NOT_CLASSIFY'});expect(incoming.response.status).toBe(200);
  await vi.waitFor(async()=>expect((await env.db.pool.query('SELECT j.id FROM slack_triage_jobs j JOIN slack_event_receipts r ON r.id=j.receipt_id WHERE r.event_id=$1',[incoming.eventId])).rowCount).toBe(1),{timeout:15000});
  await env.db.pool.query("UPDATE slack_triage_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE connection_id=$1",[seed.row.id]);
  await vi.waitFor(async()=>expect((await env.db.pool.query('SELECT id FROM slack_assistant_artifacts WHERE connection_id=$1',[seed.row.id])).rowCount).toBe(1),{timeout:15000});
  const proposals=await (await fetch(app.url+'/api/slack/proposals?connectionId='+seed.row.id,{headers})).json();expect(proposals.proposals).toHaveLength(1);expect(proposals.proposals[0].body.context[0].text).toBe(actualText);
  expect((await env.db.pool.query('SELECT thread_ts FROM slack_event_receipts WHERE event_id=$1',[incoming.eventId])).rows[0].thread_ts).toBe(ts);expect(JSON.stringify((await env.db.pool.query('SELECT * FROM slack_event_receipts WHERE event_id=$1',[incoming.eventId])).rows)).not.toContain('INGRESS_BODY_MUST_NOT_CLASSIFY');
  await env.db.pool.query(`INSERT INTO slack_event_receipts(slack_app_id,event_id,team_id,event_type,source_event_ts,source_event_time,event_context,channel_id,message_ts,payload_hash,status) SELECT 'A_TEST','Ev_FULL_'||n,'T_CAP','message',$1::text,to_timestamp(($1::text)::numeric),NULL,'C_CAP',$1::text,repeat('a',64),'pending_fanout' FROM generate_series(1,10020) n`,[ts]);
  const rejected=await signed(app.url,seed.binding.workspaceId,{type:'message',user:'U_REQUESTER',channel:'C_NATIVE',ts,event_ts:ts,text:'not durably accepted'});expect(rejected.response.status).toBe(503);expect((await env.db.pool.query('SELECT id FROM slack_event_receipts WHERE event_id=$1',[rejected.eventId])).rowCount).toBe(0);
  await app.stop();app=await start(env,false);const before=env.fixture.requests.length;
  const lifecycle=await signed(app.url,seed.binding.workspaceId,{type:'message',subtype:'message_deleted',channel:'C_NATIVE',deleted_ts:ts,event_ts:(await env.db.pool.query('SELECT extract(epoch FROM clock_timestamp())::text AS ts')).rows[0].ts});expect(lifecycle.response.status).toBe(200);
  expect((await (await fetch(app.url+'/api/slack/proposals?connectionId='+seed.row.id,{headers})).json()).proposals[0].body).toBeNull();
  await vi.waitFor(async()=>expect((await env.db.pool.query('SELECT body_json FROM slack_assistant_artifacts WHERE id=$1',[proposals.proposals[0].id])).rows[0].body_json).toEqual({__slack_purged:true}),{timeout:15000});
  expect(env.fixture.requests.slice(before).filter(r=>r.path==='/chat/completions'||r.path==='/chat.postMessage')).toEqual([]);expect(app.output()).not.toContain(actualText);expect(env.fixture.requests.filter(r=>r.path==='/chat.postMessage')).toEqual([]);
 }finally{await app?.stop();await env.close();}
},90000);
