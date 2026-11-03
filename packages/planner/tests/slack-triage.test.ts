import {createServer,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {beforeAll,afterAll,beforeEach,it,expect} from 'vitest';
import {SlackTriagePlanner,SlackModelGateError} from '../src/slack-triage.js';
import {OpenAICompatibleProvider} from '../src/providers/openai-compatible-provider.js';
let server:Server,url:string,response:unknown,calls:number;
const binding={atiUserId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',connectionId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',workspaceId:'T_TEST',slackUserId:'U_ONE',identityVersion:1};
const context=[{text:'<@U_ONE> giúp báo cáo',user:'U_OTHER',ts:'1793549000.000001',channelId:'C_TEST',conversationType:'public' as const}];
beforeAll(async()=>{server=createServer(async(req,res)=>{for await(const _ of req){}calls++;res.setHeader('content-type','application/json');res.end(JSON.stringify({model:'fixture',choices:[{message:{content:typeof response==='string'?response:JSON.stringify(response)}}]}));});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});beforeEach(()=>{calls=0;response={kind:'no_action'};});
function planner(){return new SlackTriagePlanner(new OpenAICompatibleProvider({baseUrl:url,model:'fixture',maxRetries:0}));}
it('reserves a finite conservative request/output amount before actual HTTP classification',async()=>{
 const reservations:number[]=[];expect(await planner().classify({binding,context,truncated:false,maxOutputTokens:512,beforeModelAttempt:async(signal,n)=>{expect(signal.aborted).toBe(false);expect(calls).toBe(0);reservations.push(n);}})).toEqual({kind:'no_action'});
 expect(calls).toBe(1);expect(reservations[0]).toBeGreaterThan(Buffer.byteLength(JSON.stringify(context))+512);expect(reservations[0]).toBeLessThan(40000);
});
it.each(['not JSON','{"kind":"no_action","rationale":"private source"}','{"kind":"proposal","title":"x","binding":{"workspaceId":"foreign"}}'])('rejects malformed/untrusted model output without source text in its error',async value=>{
 response=value;await expect(planner().classify({binding,context,truncated:false,maxOutputTokens:512,beforeModelAttempt:async()=>{}})).rejects.toThrow('SLACK_MODEL_INVALID');expect(calls).toBe(1);
});
it('preserves only fixed typed gate errors and makes zero denied requests',async()=>{
 await expect(planner().classify({binding,context,truncated:false,maxOutputTokens:512,beforeModelAttempt:async()=>{throw new SlackModelGateError('SLACK_BUDGET_HELD');}})).rejects.toMatchObject({code:'SLACK_BUDGET_HELD'});expect(calls).toBe(0);
});
it('rejects oversized input and unbounded providers before any model call',async()=>{
 await expect(planner().classify({binding,context:[{...context[0]!,text:'x'.repeat(20001)}],truncated:false,maxOutputTokens:512,beforeModelAttempt:async()=>{}})).rejects.toThrow('SLACK_MODEL_INPUT_INVALID');expect(calls).toBe(0);
 await expect(new SlackTriagePlanner({name:'unsupported',generatePlan:async()=>'{"kind":"no_action"}'}).classify({binding,context,truncated:false,maxOutputTokens:512,beforeModelAttempt:async()=>{}})).rejects.toThrow('SLACK_MODEL_BUDGET_UNSUPPORTED');
});
