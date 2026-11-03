import {createServer,type Server} from 'node:http';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {SlackAuthorizationsResolver} from '../../../src/services/slack/slack-authorizations-resolver.js';
let server:Server,origin:string;
let calls:Array<{body:URLSearchParams;authorization:string|undefined}>;
let respond:(body:URLSearchParams,request:any,response:any)=>void;
const auth=(user:string,team='T_ONE',is_bot=false)=>({user_id:user,team_id:team,is_bot,is_enterprise_install:false});
beforeEach(async()=>{
 calls=[];respond=(_body,_req,res)=>res.end(JSON.stringify({ok:true,authorizations:[auth('U_ONE')]}));
 server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=new URLSearchParams(raw);calls.push({body,authorization:req.headers.authorization});res.setHeader('content-type','application/json');respond(body,req,res);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+(server.address() as any).port;
});
afterEach(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
function resolver(timeoutMs=3000){return new SlackAuthorizationsResolver({appToken:'xapp-fixture-private',apiBaseUrl:origin,timeoutMs});}
describe('complete private app authorization transport',()=>{
 it('reads every page, preserves opaque context, deduplicates actors and excludes bot/foreign/enterprise installations',async()=>{
  respond=(body,_req,res)=>res.end(JSON.stringify(body.has('cursor')?{ok:true,authorizations:[auth('U_TWO'),auth('U_ONE'),auth('U_FOREIGN','T_OTHER'),auth('U_BOT','T_ONE',true),{team_id:null,user_id:'U_ORG',is_bot:false,is_enterprise_install:true}],response_metadata:{next_cursor:''}}:{ok:true,authorizations:[auth('U_ONE')],response_metadata:{next_cursor:'opaque+/='}}));
  expect(await resolver().resolve('ctx /?+ Ω','T_ONE')).toEqual(['U_ONE','U_TWO']);
  expect(calls).toHaveLength(2);expect(calls[0]!.body.get('event_context')).toBe('ctx /?+ Ω');expect(calls[1]!.body.get('cursor')).toBe('opaque+/=');
  expect(calls.every(call=>call.authorization==='Bearer xapp-fixture-private')).toBe(true);expect(calls.every(call=>!call.body.toString().includes('xapp'))).toBe(true);
 });
 it('rejects a partial successful first page if the second page fails',async()=>{
  respond=(body,_req,res)=>res.end(JSON.stringify(body.has('cursor')?{ok:false,error:'private-provider-detail'}:{ok:true,authorizations:[auth('U_ONE')],response_metadata:{next_cursor:'page2'}}));
  await expect(resolver().resolve('ctx','T_ONE')).rejects.toThrow('SLACK_AUTHORIZATIONS_FAILED');expect(calls).toHaveLength(2);
 });
 it.each([{ok:true,authorizations:[{...auth('U_ONE'),is_bot:'false'}]},{ok:true,authorizations:[auth('U_ONE')],response_metadata:{next_cursor:12}},{ok:true,authorizations:[auth('U_ONE')],has_more:true},{ok:true,authorizations:'bad'}])('rejects malformed or incomplete authority without returning a partial list %#',async(body)=>{
  respond=(_body,_req,res)=>res.end(JSON.stringify(body));await expect(resolver().resolve('ctx','T_ONE')).rejects.toThrow('SLACK_AUTHORIZATIONS_FAILED');
 });
 it('rejects repeated cursors instead of treating an incomplete list as complete',async()=>{
  respond=(_body,_req,res)=>res.end(JSON.stringify({ok:true,authorizations:[auth('U_ONE')],response_metadata:{next_cursor:'loop'}}));
  await expect(resolver().resolve('ctx','T_ONE')).rejects.toThrow('SLACK_AUTHORIZATIONS_FAILED');expect(calls).toHaveLength(2);
 });
 it('does not send credentials to a redirect destination',async()=>{
  respond=(_body,_req,res)=>{res.writeHead(302,{location:origin+'/redirect-target'});res.end();};
  await expect(resolver().resolve('ctx','T_ONE')).rejects.toThrow();expect(calls).toHaveLength(1);
 });
 it('uses an actual caller AbortSignal and closes a pending HTTP response',async()=>{
  let started!:()=>void,closed!:()=>void;const received=new Promise<void>(resolve=>{started=resolve;}),ended=new Promise<void>(resolve=>{closed=resolve;});
  respond=(_body,_req,res)=>{res.on('close',closed);started();};
  const controller=new AbortController(),reading=resolver().resolve('ctx','T_ONE',controller.signal);await received;controller.abort();
  await expect(reading).rejects.toThrow('SLACK_AUTHORIZATIONS_FAILED');await ended;expect(controller.signal.aborted).toBe(true);
 });
 it('bounds an incomplete HTTP body and leaves no provider details in its error',async()=>{
  respond=(_body,_req,res)=>{res.write('{"ok":true,');};
  const error=await resolver(100).resolve('ctx','T_ONE').catch(value=>value);
  expect(error.message).toBe('SLACK_AUTHORIZATIONS_FAILED');expect(JSON.stringify(error)).not.toContain('xapp-fixture');
 });
 it('rejects absent context before transport and sanitizes malformed endpoint errors',async()=>{
  await expect(resolver().resolve('','T_ONE')).rejects.toThrow();expect(calls).toHaveLength(0);
  for(const apiBaseUrl of ['https://attacker.example/api','http://token:private@127.0.0.1/api','http://[secret']){
   let caught:any;try{new SlackAuthorizationsResolver({appToken:'xapp-fixture-private',apiBaseUrl});}catch(error){caught=error;}
   expect(caught.message).toBe('SLACK_AUTHORIZATIONS_CONFIG_INVALID');expect(JSON.stringify(caught)).not.toContain('secret');expect(caught.input).toBeUndefined();
  }
 });
});
