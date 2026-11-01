import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {createSlackReadEnvironment,type SlackReadEnvironment,TEST_ENV} from '../../helpers/slack-private-read-fixture.js';
import {SlackFanoutRepo} from '../../../src/db/repositories/slack-fanout-repo.js';
import {SlackEventReceiptRepo} from '../../../src/db/repositories/slack-event-receipt-repo.js';
import {SlackFanoutWorker,createSlackFanoutRuntime} from '../../../src/services/slack/slack-fanout-runtime.js';
import {SlackAuthorizationsResolver} from '../../../src/services/slack/slack-authorizations-resolver.js';
let env:SlackReadEnvironment,repo:SlackFanoutRepo,receipts:SlackEventReceiptRepo;
beforeAll(async()=>{env=await createSlackReadEnvironment('fanout_runtime');repo=new SlackFanoutRepo(env.db.pool,env.policyService);receipts=new SlackEventReceiptRepo(env.db.pool,env.invalidationService);});
afterAll(async()=>{await env?.close();});
async function addReceipt(context:string|null='ctx'){
 const {epoch,iso}=(await env.db.pool.query(`SELECT extract(epoch FROM clock_timestamp())::text AS epoch,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS iso`)).rows[0];
 return (await receipts.recordOrdinary({appId:'A_TEST',eventId:'Ev_'+randomUUID(),teamId:'T_RUNTIME',eventType:'message',eventSubtype:null,eventContext:context,channelId:'C_RUNTIME',messageTs:epoch,sourceEventTs:epoch,sourceEventTimeIso:iso,payloadHash:'c'.repeat(64),discardReason:null})).receipt;
}
const config=()=>({...TEST_ENV,MYSLACK_ENABLED:'on',MYSLACK_AUTOMATION_ENABLED:'on',MYSLACK_APP_ID:'A_TEST',SLACK_SIGNING_SECRET:'fixture-signing',MYSLACK_APP_TOKEN:'xapp-private-fixture',MYSLACK_API_BASE_URL:env.fixture.url});
it('failed authorization pagination publishes no partial jobs and persists only a fixed retry code',async()=>{
 await repo.setRuntime('A_TEST',true);const receipt=await addReceipt();
 env.fixture.setHandler('/apps.event.authorizations.list',request=>({body:new URLSearchParams(request.body).has('cursor')?{ok:false,error:'TOKEN_PRIVATE_PROVIDER_DETAIL'}:{ok:true,authorizations:[{team_id:'T_RUNTIME',user_id:'U_ONE',is_bot:false}],response_metadata:{next_cursor:'page2'}}}));
 const worker=new SlackFanoutWorker({repo,resolver:new SlackAuthorizationsResolver({appToken:'xapp-private-fixture',apiBaseUrl:env.fixture.url}),appId:'A_TEST',workerId:'fixture-worker'});
 expect(await worker.runOnce(5)).toMatchObject({claimed:1,retried:1,applied:0});
 const row=(await env.db.pool.query('SELECT * FROM slack_event_receipts WHERE id=$1',[receipt.id])).rows[0];
 expect(row.status).toBe('failed');expect(row.fanout_error_code).toBe('authorization_failed');expect(JSON.stringify(row)).not.toContain('TOKEN_PRIVATE');
 expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_triage_jobs WHERE receipt_id=$1',[receipt.id])).rows[0].n).toBe(0);
});
it('missing context is discarded without consulting a first sender or calling an authorization endpoint',async()=>{
 const receipt=await addReceipt(null),before=env.fixture.requests.length;
 const worker=new SlackFanoutWorker({repo,resolver:new SlackAuthorizationsResolver({appToken:'xapp-private-fixture',apiBaseUrl:env.fixture.url}),appId:'A_TEST',workerId:'fixture-worker'});
 expect(await worker.runOnce(5)).toMatchObject({applied:1});expect(env.fixture.requests).toHaveLength(before);
 expect((await env.db.pool.query('SELECT discard_reason FROM slack_event_receipts WHERE id=$1',[receipt.id])).rows[0].discard_reason).toBe('missing_event_context');
});
it('native supervisor coalesces ticks and aborts pending HTTP on stop while keeping leases recoverable',async()=>{
 let release!:(value:any)=>void;const blocked=new Promise<any>(resolve=>{release=resolve;});
 env.fixture.setHandler('/apps.event.authorizations.list',()=>blocked);
 const runner=await createSlackFanoutRuntime({pool:env.db.pool,env:config(),live:false,intervalMs:10,stopGraceMs:200});
 await addReceipt();const before=env.fixture.requests.length;runner!.start();
 await vi.waitFor(()=>expect(env.fixture.requests.length).toBeGreaterThan(before),{timeout:2000});
 const first=runner!.tick(),second=runner!.tick();expect(first).toBe(second);
 await runner!.stop();release({body:{ok:true,authorizations:[]}});await first;
 expect(runner!.isRunning()).toBe(false);expect(env.fixture.requests.length-before).toBe(1);
});
it('disabled automation requires no app token and makes no new fanout request',async()=>{
 const before=env.fixture.requests.length;
 expect(await createSlackFanoutRuntime({pool:env.db.pool,env:{...config(),MYSLACK_AUTOMATION_ENABLED:'off',MYSLACK_APP_TOKEN:undefined},live:false})).toBeUndefined();
 expect(env.fixture.requests).toHaveLength(before);
 expect((await env.db.pool.query('SELECT enabled FROM slack_fanout_runtime WHERE app_id=$1',['A_TEST'])).rows[0].enabled).toBe(false);
});
it('live automation fails startup with a fixed configuration error if the app token is missing',async()=>{
 await expect(createSlackFanoutRuntime({pool:env.db.pool,env:{...config(),MYSLACK_APP_TOKEN:undefined},live:true})).rejects.toThrow('SLACK_AUTHORIZATIONS_CONFIG_INVALID');
});
