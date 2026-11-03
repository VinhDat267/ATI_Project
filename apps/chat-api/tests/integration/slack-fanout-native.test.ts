import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createHmac,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {expect,it,vi} from 'vitest';
import {createSlackReadEnvironment,TEST_ENV,TEST_KEY} from '../helpers/slack-private-read-fixture.js';
import {SlackFanoutRepo} from '../../src/db/repositories/slack-fanout-repo.js';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const secret='fanout-native-fixture-signing-secret';
async function startNative(env:Awaited<ReturnType<typeof createSlackReadEnvironment>>,enabled:boolean){
 const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));
 const port=(socket.address() as any).port;await new Promise<void>(resolve=>socket.close(()=>resolve()));
 const variables:NodeJS.ProcessEnv={};for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA'])if(process.env[key])variables[key]=process.env[key];
 Object.assign(variables,TEST_ENV,{NODE_ENV:'test',RUNTIME_MODE:'sandbox',PORT:String(port),DATABASE_URL:env.db.pool.options.connectionString,
  ENCRYPTION_KEY:TEST_KEY,JWT_SECRET:'fanout-native-fixture-long-jwt-secret',AUTH_SIGNUP_ENABLED:'false',GMAIL_ENABLED:'off',MYCALENDAR_ENABLED:'off',MYSHEETS_ENABLED:'off',SCHEDULES_ENABLED:'off',
  MYSLACK_ENABLED:enabled?'on':'off',MYSLACK_AUTOMATION_ENABLED:enabled?'on':'off',MYSLACK_APP_ID:'A_TEST',SLACK_SIGNING_SECRET:secret,
  MYSLACK_OAUTH_CLIENT_ID:'fixture-client',MYSLACK_OAUTH_CLIENT_SECRET:'fixture-secret',MYSLACK_OAUTH_REDIRECT_URI:'https://ati.example/connections/myslack/callback',
  MYSLACK_API_BASE_URL:env.fixture.url,MYSLACK_OAUTH_AUTH_URL:env.fixture.url+'/authorize',...(enabled?{MYSLACK_APP_TOKEN:'xapp-native-private'}:{})});
 const child=spawn(process.execPath,['--import','tsx','apps/chat-api/src/server.ts'],{cwd:root,env:variables,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',chunk=>{output=(output+chunk).slice(-4000);});child.stderr.on('data',chunk=>{output=(output+chunk).slice(-4000);});
 const exited=new Promise<void>(resolve=>child.once('close',()=>resolve()));
 const url='http://127.0.0.1:'+port;
 try{await vi.waitFor(async()=>{if(child.exitCode!==null)throw new Error('Native bootstrap failed: '+output);expect((await fetch(url+'/api/health')).ok).toBe(true);},{timeout:25000,interval:50});}
 catch(error){child.kill();await exited;throw error;}
 return {url,stop:async()=>{child.kill();let timer:ReturnType<typeof setTimeout>|undefined;await Promise.race([exited,new Promise<void>(resolve=>{timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},5000);})]);clearTimeout(timer);await exited;}};
}
async function event(env:Awaited<ReturnType<typeof createSlackReadEnvironment>>,url:string,workspace:string,context:string){
 const ts=(await env.db.pool.query('SELECT extract(epoch FROM clock_timestamp())::text AS ts')).rows[0].ts;
 const eventId='Ev_'+randomUUID(),timestamp=String(Math.floor(Date.now()/1000));
 const raw=JSON.stringify({type:'event_callback',api_app_id:'A_TEST',team_id:workspace,event_id:eventId,event_time:Number(timestamp),event_context:context,
  event:{type:'message',user:'U_UNRELATED_SENDER',channel:'C_FANOUT',ts,event_ts:ts,text:'PRIVATE_BODY_MUST_NOT_PERSIST'}});
 const signature='v0='+createHmac('sha256',secret).update('v0:'+timestamp+':'+raw).digest('hex');
 const response=await fetch(url+'/api/slack/events',{method:'POST',headers:{'content-type':'application/json','x-slack-request-timestamp':timestamp,'x-slack-signature':signature},body:raw});expect(response.status).toBe(200);return eventId;
}
it('actual native bootstrap fans out signed events through every HTTP authorization page and isolates a private recipient',async()=>{
 const env=await createSlackReadEnvironment('native_fanout');let app:Awaited<ReturnType<typeof startNative>>|undefined;
 try{
  const workspace='T_'+randomUUID().replaceAll('-',''),a=await env.addUser({name:'native-a',workspaceId:workspace,actorId:'U_A'}),b=await env.addUser({name:'native-b',workspaceId:workspace,actorId:'U_B'});
  const repo=new SlackFanoutRepo(env.db.pool,env.policyService);await repo.setProcessing(a.binding,true);await repo.setProcessing(b.binding,true);
  env.fixture.setHandler('/apps.event.authorizations.list',request=>{
   expect(request.authorization).toBe('Bearer xapp-native-private');const body=new URLSearchParams(request.body),context=body.get('event_context');
   expect(body.has('token')).toBe(false);
   return {body:{ok:true,authorizations:[{team_id:workspace,user_id:context==='ctx-dm'||body.has('cursor')?'U_A':'U_B',is_bot:false}],response_metadata:{next_cursor:context==='ctx-shared'&&!body.has('cursor')?'page2':''}}};
  });
  app=await startNative(env,true);
  expect((await env.db.pool.query('SELECT enabled FROM slack_fanout_runtime WHERE app_id=$1',['A_TEST'])).rows[0]?.enabled).toBe(true);
  const shared=await event(env,app.url,workspace,'ctx-shared');
  await vi.waitFor(async()=>expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_triage_jobs j JOIN slack_event_receipts r ON r.id=j.receipt_id WHERE r.event_id=$1',[shared])).rows[0].n).toBe(2),{timeout:15000});
  const dm=await event(env,app.url,workspace,'ctx-dm');
  await vi.waitFor(async()=>expect((await env.db.pool.query('SELECT j.user_id FROM slack_triage_jobs j JOIN slack_event_receipts r ON r.id=j.receipt_id WHERE r.event_id=$1',[dm])).rows).toEqual([{user_id:a.person.id}]),{timeout:15000});
  const rows=(await env.db.pool.query('SELECT * FROM slack_event_receipts WHERE event_id=ANY($1::text[])',[[shared,dm]])).rows;
  expect(rows.every(row=>row.status==='processed')).toBe(true);expect(JSON.stringify(rows)).not.toContain('PRIVATE_BODY_MUST_NOT_PERSIST');
  expect(env.fixture.requests.filter(request=>request.path==='/apps.event.authorizations.list')).toHaveLength(3);
  await app.stop();app=await startNative(env,false);const before=env.fixture.requests.length,ignored=await event(env,app.url,workspace,'ctx-off');
  expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_event_receipts WHERE event_id=$1',[ignored])).rows[0].n).toBe(0);
  expect(env.fixture.requests).toHaveLength(before);
 }finally{await app?.stop();await env.close();}
},60000);
