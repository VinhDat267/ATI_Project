import { describe,it,expect } from 'vitest';
import { StepRunner,isWriteTool } from '../src/index.js';
import {deriveSlackDependencySelectors} from '@wap/tool-schemas';
const binding={atiUserId:'owner',connectionId:'connection',workspaceId:'T_ONE',slackUserId:'U_ONE',identityVersion:1};
const policy={binding,purpose:'planning',requestedRetentionDays:0,providerProfileId:'provider',configFingerprint:'a'.repeat(64),policyVersion:'v1',consentRevision:'1',providerRevision:'1'};
const step=()=>({id:'read',tool:'myslack.users_info',description:'Read',args:{user:'U_ONE'},dependsOn:[]});
const snapshot=()=>({planId:'plan',planHash:'a'.repeat(64),userId:'owner',steps:[step()],bindings:{bindings:{connection:binding},steps:{read:{connectionId:'connection',tool:'myslack.users_info',dependencies:[],policyReference:policy}}}});
describe('Slack read dispatch before adapter access',()=>{
 it('denies absent authority before adapter lookup',async()=>{
  let adapters=0;const runner=new StepRunner({getAdapter:()=>{adapters++;return {execute:async()=>({})};}});
  const result=await runner.executeStep(step(),new Map());expect(result.status).toBe('failed');expect(adapters).toBe(0);
 });
 it.each(['myslack.chat_postMessage','myslack.anything','myslack.unknown_read'])('denies %s as write without transport',async(tool)=>{
  let calls=0;const runner=new StepRunner({getAdapter:()=>({execute:async()=>{calls++;}})});
  expect(isWriteTool(tool)).toBe(true);const r=await runner.executeStep({...step(),tool},new Map());expect(r.status).toBe('failed');expect(calls).toBe(0);
 });
 it('dispatches the exact detached authorized envelope and rechecks after factory await',async()=>{
  const original=step(),seen:any[]=[];let dispatched:any;
  const runner=new StepRunner({slackSnapshot:snapshot(),slackDispatchGuard:{authorize:async({envelope}:any)=>{seen.push(envelope);}},getAdapter:async()=>{original.args.user='U_ATTACK';return {execute:async(_t:any,args:any)=>{dispatched=args;return {ok:true};}}}} as any);
  const r=await runner.executeStep(original,new Map());expect(r.status).toBe('success');expect(seen).toHaveLength(2);
  expect(seen[0]).toBe(seen[1]);expect(Object.isFrozen(seen[0].params)).toBe(true);expect(dispatched).toEqual({binding,params:{user:'U_ONE'}});
 });
 it('blocks a revoke during factory creation and redacts hook errors',async()=>{
  let calls=0,checked=0;const runner=new StepRunner({slackSnapshot:snapshot(),slackDispatchGuard:{authorize:async()=>{if(++checked===2)throw new Error('TOKEN_SECRET');}},getAdapter:async()=>({execute:async()=>{calls++;}})} as any);
  const r=await runner.executeStep(step(),new Map());expect(r.status).toBe('failed');expect(calls).toBe(0);expect(JSON.stringify(r)).not.toContain('TOKEN_SECRET');
 });
 it('settles an actual AbortSignal while an authority hook never resolves',async()=>{
  let adapters=0;const runner=new StepRunner({slackSnapshot:snapshot(),slackDispatchGuard:{authorize:()=>new Promise(()=>{})},getAdapter:()=>{adapters++;return {execute:async()=>({})};}} as any);
  const started=Date.now();const r=await runner.executeStep(step(),new Map(),{timeoutMs:25});expect(r.status).toBe('failed');expect(Date.now()-started).toBeLessThan(1000);expect(adapters).toBe(0);
 });
 it('rejects changed step arguments and a forged owner before lookup',async()=>{
  let adapters=0;const runner=new StepRunner({slackSnapshot:{...snapshot(),userId:'attacker'},slackDispatchGuard:{authorize:async()=>{}},getAdapter:()=>{adapters++;return {execute:async()=>({})};}} as any);
  expect((await runner.executeStep(step(),new Map())).status).toBe('failed');expect(adapters).toBe(0);
 });
 it('carries user source evidence when a member string is selected from conversations_members',async()=>{
  const first={id:'members',tool:'myslack.conversations_members',description:'Members',args:{channel:'C_ONE'},dependsOn:[]};
  const second={...step(),args:{user:{$ref:'members.output.members.0'}},dependsOn:['members']};
  const planSteps=[first,second],bindings={bindings:{connection:binding},steps:Object.fromEntries(planSteps.map(s=>[s.id,{connectionId:'connection',tool:s.tool,dependencies:deriveSlackDependencySelectors(s.args,planSteps),policyReference:policy}]))};
  const output={ok:true,members:['U_ONE'],nextCursor:'',hasMore:false,provenance:{binding,resourceIdentity:{type:'members',channelId:'C_ONE'},observedAt:new Date().toISOString(),acquisitionPolicyReference:policy,observationalDigest:'b'.repeat(64)}};
  const seen:any[]=[];const runner=new StepRunner({slackSnapshot:{...snapshot(),steps:planSteps,bindings},slackDispatchGuard:{authorize:async({envelope}:any)=>{seen.push(envelope);}},getAdapter:()=>({execute:async()=>({ok:true})})});
  expect((await runner.executeStep(second as any,new Map([['members',output]]))).status).toBe('success');
  expect(seen[0].sources.map((s:any)=>[s.sourceRef.resourceType,s.sourceRef.resourceId])).toContainEqual(['user','U_ONE']);
 });
});
