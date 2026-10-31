import {describe,it,expect} from 'vitest';
import * as planner from '../src/index.js';
import {MYSLACK_CORE_READ_TOOLS} from '@wap/tool-schemas';
const response=(tool='myslack.users_info',args:any={user:'U_SELF'})=>({kind:'plan',thinking:'Read after approval',summary:'Read my profile',warnings:[],steps:[{id:'step_1',tool,description:'Read',args,dependsOn:[]}]});
const run=(provider:any,input:any)=>(planner as any).planSlackRead(provider,input);
describe('metadata-only personal Slack read proposals',()=>{
 it('plans an approved read without gathering or changing the ordinary workflow rule',async()=>{
  let input:any,calls=0;const provider={name:'fixture',generatePlan:async(v:any)=>{input=v;calls++;return JSON.stringify({...response(),connections:{myslack:'FORGED'}});}};
  const result=await run(provider,{request:'Đọc hồ sơ của tôi',slackUserId:'U_SELF'});
  expect(result.kind).toBe('plan');expect(result.connections).toBeUndefined();expect(calls).toBe(1);
  expect(input.workingMemory).toEqual({});expect(input.conversationHistory).toEqual([{role:'user',content:'Đọc hồ sơ của tôi'}]);
  expect(input.toolCatalog).toHaveLength(8);expect(input.toolCatalog.every((t:any)=>!t.inputSchema.properties.binding)).toBe(true);
  expect(planner.validatePlan(JSON.stringify(response()),input.toolCatalog)).toMatchObject({valid:false,code:'READ_ONLY_PLAN'});
 });
 it.each(['myslack.chat_postMessage','myslack.anything','trello.create_card'])('refuses %s',(tool)=>expect(run({name:'fixture',generatePlan:async()=>JSON.stringify(response(tool))},{request:'Đọc của tôi',slackUserId:'U_SELF'})).resolves.toMatchObject({kind:'refusal'}));
 it('asks for explicit resource identity instead of inventing a channel or selecting an unknown first result',async()=>{
  expect(await run({name:'fixture',generatePlan:async()=>JSON.stringify(response('myslack.conversations_history',{channel:'C_INVENTED'}))},{request:'Đọc kênh general',slackUserId:'U_SELF'})).toMatchObject({kind:'clarification'});
  expect(await run({name:'fixture',generatePlan:async()=>JSON.stringify(response('myslack.users_info',{user:{$ref:'step_0.output.members.0.id'}}))},{request:'Tìm người tên Nam',slackUserId:'U_SELF'})).toMatchObject({kind:'refusal'});
 });
 it('accepts an explicit channel and returns no model-supplied binding fields',async()=>{
  const p=response('myslack.conversations_history',{channel:'C_EXPLICIT',limit:10});
  const result=await run({name:'fixture',generatePlan:async()=>JSON.stringify(p)},{request:'Đọc10tin kênh C_EXPLICIT',slackUserId:'U_SELF'});
  expect(result).toEqual(p);
 });
 it('bounds an uncooperative provider with an actual AbortSignal',async()=>{
  let signal:AbortSignal|undefined;
  const pending=run({name:'fixture',generatePlan:(v:any)=>{signal=v.signal;return new Promise(()=>{});}},{request:'Liệt kê kênh',slackUserId:'U_SELF',timeoutMs:20});
  await expect(pending).rejects.toThrow();expect(signal?.aborted).toBe(true);
 });
});
