import {createHash} from 'node:crypto';
import {MYSLACK_CORE_READ_TOOLS,isSlackReadTool,validateSlackPlanBindings,validateSlackToolExecutionArgs,sameSlackBinding,validateSlackPolicyReference,type PlanStep,type SlackBinding,type SlackPlanBindings,type SlackPolicyReference,type SlackSourceRef,type SlackDependencySelector} from '@wap/tool-schemas';
import {resolveArgs} from '../resolver.js';
import type {AdapterExecutor,StepOutputs} from '../types.js';
export interface SlackExecutionSnapshot {planId:string;planHash:string;userId:string;steps:PlanStep[];bindings:SlackPlanBindings;outputOrigins?:Record<string,'transient'|'persisted'>}
export interface SlackDispatchSource {selector:SlackDependencySelector;sourceRef:SlackSourceRef;provenance:Record<string,any>;policyReference:SlackPolicyReference;origin:'transient'|'persisted'}
export interface SlackDispatchEnvelope {v:'slack-exec-v1';planId:string;planHash:string;stepId:string;tool:string;binding:SlackBinding;params:Record<string,any>;sources:SlackDispatchSource[];policyReference:SlackPolicyReference;digest:string}
export interface SlackDispatchGuard {authorize(input:{envelope:SlackDispatchEnvelope;signal:AbortSignal}):Promise<void>}
export function canonicalSlackJson(value:unknown):string{
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonicalSlackJson).join(',')+']';
 if(value&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value)))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalSlackJson((value as any)[k])).join(',')+'}';
 throw new Error('SLACK_ENVELOPE_INVALID');
}
export function slackDigestInput(envelope:SlackDispatchEnvelope){const {digest:_,...input}=envelope;return input;}
export function computeSlackExecutionDigest(value:unknown){return createHash('sha256').update(canonicalSlackJson(value)).digest('hex');}
/** A member string is a distinct user observation under the verified members response. */
export function slackMemberObservation(id:string,provenance:Record<string,any>){
 if(typeof id!=='string'||!id.trim()||provenance.resourceIdentity?.type!=='members')throw slackDispatchFailure('SLACK_SOURCE_UNVERIFIED');
 const {nativeRevision:_,...rest}=provenance;
 return {id,provenance:{...rest,resourceIdentity:{type:'user',userId:id},observationalDigest:computeSlackExecutionDigest({id})}};
}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export function slackDispatchFailure(code='SLACK_DISPATCH_DENIED'){return Object.assign(new Error(code),{category:'AUTH_ERROR',details:{requestSent:false}});}
export function abortableSlack<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
 if(signal.aborted){work.catch(()=>{});return Promise.reject(slackDispatchFailure('SLACK_READ_ABORTED'));}
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(slackDispatchFailure('SLACK_READ_ABORTED'));signal.addEventListener('abort',abort,{once:true});
  work.then(v=>{signal.removeEventListener('abort',abort);if(signal.aborted)abort();else resolve(v);},()=>{signal.removeEventListener('abort',abort);reject(slackDispatchFailure());});
 });
}
function sourceEvidence(selector:SlackDependencySelector,outputs:StepOutputs,snapshot:SlackExecutionSnapshot):SlackDispatchSource[]{
 if(selector.service!=='myslack')return [];
 let root=outputs.get(selector.refStepId),selected=root,ancestor:any;
 if(root===undefined)throw slackDispatchFailure('SLACK_SOURCE_UNVERIFIED');
 const wrapped=root&&typeof root==='object'&&Object.hasOwn(root,'output')?root:{output:root};
 selected=wrapped;
 for(const part of selector.path.split('.').filter(Boolean)){
  if(selected?.provenance)ancestor=selected;
  if(!selected||typeof selected!=='object'||!Object.hasOwn(selected,part))throw slackDispatchFailure('SLACK_SOURCE_UNVERIFIED');
  selected=selected[part];
 }
 const observations:any[]=[];
 const walk=(v:any,depth=0)=>{if(depth>32)throw slackDispatchFailure();if(v&&typeof v==='object'){
  if(v.provenance){
   observations.push(v);
   if(v.provenance.resourceIdentity?.type==='members'&&Array.isArray(v.members))for(const member of v.members)observations.push(slackMemberObservation(member,v.provenance));
  }
  for(const [k,n] of Object.entries(v))if(k!=='provenance')walk(n,depth+1);
 }};
 if(selected&&typeof selected==='object')walk(selected);
 if(!observations.length&&ancestor)walk(ancestor);
 if(!observations.length)throw slackDispatchFailure('SLACK_SOURCE_UNVERIFIED');
 return observations.filter(v=>v.provenance.resourceIdentity.type!=='users' && !(v.provenance.resourceIdentity.type==='conversation'&&!v.provenance.resourceIdentity.channelId)).map(v=>{
  const p=v.provenance,b=snapshot.bindings.bindings[snapshot.bindings.steps[selector.refStepId]!.connectionId]!,identity=p.resourceIdentity,policy=validateSlackPolicyReference(p.acquisitionPolicyReference);
  if(!sameSlackBinding(p.binding,b)||!sameSlackBinding(policy.binding,b)||!/^[a-f0-9]{64}$/.test(p.observationalDigest)||!Number.isFinite(Date.parse(p.observedAt)))throw slackDispatchFailure('SLACK_SOURCE_UNVERIFIED');
  const type=identity.type==='message'||identity.type==='permalink'?'message':identity.type==='user'?'user':'conversation';
  const resourceId=type==='message'?JSON.stringify([identity.channelId,identity.messageTs]):type==='user'?identity.userId:identity.channelId;
  if(!resourceId||(type==='user'&&v.id!==resourceId)||(identity.type==='message'&&v.ts!==identity.messageTs)||(identity.type==='conversation'&&v.id!==resourceId))throw slackDispatchFailure('SLACK_SOURCE_UNVERIFIED');
  return {selector,sourceRef:{binding:b,resourceType:type,resourceId,revision:p.nativeRevision??p.observationalDigest},provenance:p,policyReference:policy,origin:snapshot.outputOrigins?.[selector.refStepId]??'transient'};
 });
}
export function deriveSlackDispatchSources(selectors:SlackDependencySelector[],outputs:StepOutputs,snapshot:SlackExecutionSnapshot):SlackDispatchSource[]{return selectors.flatMap(d=>sourceEvidence(d,outputs,snapshot));}
export async function executeSlackRead(input:{step:PlanStep;outputs:StepOutputs;snapshot?:SlackExecutionSnapshot;guard?:SlackDispatchGuard;getAdapter:(service:string)=>AdapterExecutor|Promise<AdapterExecutor>;signal:AbortSignal}):Promise<unknown>{
 try{
  const step=structuredClone(input.step),outputs=structuredClone(input.outputs),snapshot=input.snapshot&&structuredClone(input.snapshot);
  if(!isSlackReadTool(step.tool))throw slackDispatchFailure('SLACK_WRITE_DISABLED');
  if(!snapshot||!input.guard||!/^[0-9a-f]{64}$/.test(snapshot.planHash)||!snapshot.planId)throw slackDispatchFailure();
  const bindings=validateSlackPlanBindings(snapshot.bindings,snapshot.steps),approved=snapshot.steps.find(s=>s.id===step.id),record=bindings.steps[step.id],binding=record&&bindings.bindings[record.connectionId];
  if(!approved||canonicalSlackJson(approved)!==canonicalSlackJson(step)||!binding||binding.atiUserId!==snapshot.userId)throw slackDispatchFailure();
  const params=validateSlackToolExecutionArgs(MYSLACK_CORE_READ_TOOLS.find(t=>t.name===step.tool)!,{binding,params:resolveArgs(step.args,outputs)}).params;
  const sources=deriveSlackDispatchSources(record.dependencies,outputs,{...snapshot,bindings});
  const base={v:'slack-exec-v1' as const,planId:snapshot.planId,planHash:snapshot.planHash,stepId:step.id,tool:step.tool,binding,params,sources,policyReference:record.policyReference};
  const envelope=freeze({...base,digest:computeSlackExecutionDigest(base)});
  input.signal.throwIfAborted();
  await abortableSlack(input.guard.authorize({envelope,signal:input.signal}),input.signal);
  const adapter=await abortableSlack(Promise.resolve(input.getAdapter('myslack')),input.signal);
  if(!adapter||typeof adapter.execute!=='function')throw slackDispatchFailure();
  await abortableSlack(input.guard.authorize({envelope,signal:input.signal}),input.signal);
  input.signal.throwIfAborted();
  return await abortableSlack(Promise.resolve(adapter.execute(step.tool,{binding:envelope.binding,params:envelope.params},{signal:input.signal})),input.signal);
 }catch(error){if(error instanceof Error&&/^SLACK_[A-Z_]+$/.test(error.message))throw slackDispatchFailure(error.message);throw slackDispatchFailure();}
}
