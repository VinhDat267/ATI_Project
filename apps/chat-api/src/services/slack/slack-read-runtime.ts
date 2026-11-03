import {computeSlackExecutionDigest,canonicalSlackJson,slackMemberObservation,type SlackExecutionSnapshot,type SlackDispatchGuard} from '@wap/executor';
import {validateSlackPolicyReference,slackPolicyRefToEpoch,sameSlackPolicyEpoch,sameSlackBinding,type SlackBinding} from '@wap/tool-schemas';
import type {SlackReadPlanBindings} from './slack-plan-bindings.js';
import type {SlackPrivateReadWrapper} from './slack-private-read-wrapper.js';
import type {SlackPolicyService} from './policy-service.js';
import type {SlackInvalidationService} from './slack-invalidation-service.js';
import type {PlanRepo} from '../../db/repositories/plan-repo.js';
import type {StepRepo} from '../../db/repositories/step-repo.js';
import type {DerivedSegmentInput} from '../../db/repositories/slack-derived-lineage-repo.js';
import {createSlackDispatchGuard} from './slack-dispatch-guard.js';
interface Options{binder:SlackReadPlanBindings;wrapper:SlackPrivateReadWrapper;plans:PlanRepo;steps:StepRepo;policy:SlackPolicyService;invalidation:SlackInvalidationService}
export class SlackReadRuntime{
 private evidence=new WeakMap<object,{digest:string;segments:DerivedSegmentInput[]}>();
 constructor(private options:Options){}
 async assertApproval(snapshot:SlackExecutionSnapshot,signal?:AbortSignal):Promise<void>{
  await this.options.binder.assert(snapshot.userId,snapshot.steps,snapshot.bindings,signal);
  for(const record of Object.values(snapshot.bindings.steps)){
   signal?.throwIfAborted();const expected={...record.policyReference,purpose:'storage' as const,requestedRetentionDays:1};
   if(!(await this.options.policy.resolveSlackModelPolicy({binding:expected.binding,purpose:'storage',requestedRetentionDays:1,expectedPolicyReference:expected})).allowed)throw new Error('SLACK_READ_STORAGE_REQUIRED');
  }
  signal?.throwIfAborted();
 }
 guard(snapshot:SlackExecutionSnapshot):SlackDispatchGuard{
  const inner=createSlackDispatchGuard({...this.options,snapshot});
  return {authorize:async input=>{await inner.authorize(input);await this.assertApproval(snapshot,input.signal);}};
 }
 adapter(userId:string){
  return {execute:async(tool:string,args:any,context?:{signal?:AbortSignal})=>{
   if(args.binding?.atiUserId!==userId)throw new Error('SLACK_READ_IDENTITY_MISMATCH');
   const result=await this.options.wrapper.executeRead({callerAtiUserId:userId,binding:args.binding,tool,params:args.params,purpose:'planning',signal:context?.signal});
   // Persist and bind exactly the JSON representation; adapter optional fields may be undefined.
   const data=JSON.parse(JSON.stringify(result.data));
   const acquisition=validateSlackPolicyReference(result.policyReference),expected={...acquisition,purpose:'storage' as const,requestedRetentionDays:1};
   const storage=await this.options.policy.resolveSlackModelPolicy({binding:args.binding,purpose:'storage',requestedRetentionDays:1,expectedPolicyReference:expected});
   if(!storage.allowed||!sameSlackPolicyEpoch(slackPolicyRefToEpoch(acquisition),slackPolicyRefToEpoch(storage.policyReference)))throw new Error('SLACK_READ_POLICY_DENIED');
   const observations:any[]=[];const walk=(v:any,depth=0)=>{if(depth>32)throw new Error('SLACK_READ_PROVENANCE_INVALID');if(v&&typeof v==='object'){if(v.provenance)observations.push(v);for(const [key,item] of Object.entries(v))if(key!=='provenance')walk(item,depth+1);}};walk(data);
   for(const value of [...observations])if(value.provenance.resourceIdentity?.type==='members'&&Array.isArray(value.members)){
    for(const member of value.members)observations.push(slackMemberObservation(member,value.provenance));
   }
   if(!observations.length||observations.length>256)throw new Error('SLACK_READ_PROVENANCE_INVALID');
   const segments:DerivedSegmentInput[]=observations.map(value=>{
    const p=value.provenance,id=p.resourceIdentity,ref=validateSlackPolicyReference(p.acquisitionPolicyReference);
    if(!sameSlackBinding(p.binding,args.binding)||canonicalSlackJson(ref)!==canonicalSlackJson(acquisition)||!/^[a-f0-9]{64}$/.test(p.observationalDigest))throw new Error('SLACK_READ_PROVENANCE_INVALID');
    let resourceType:'user'|'message'|'conversation',resourceId:string,channelId:string|undefined;
    if((id.type==='message'||id.type==='permalink')&&id.channelId&&id.messageTs){resourceType='message';resourceId=JSON.stringify([id.channelId,id.messageTs]);channelId=id.channelId;}
    else if(id.type==='user'&&id.userId){resourceType='user';resourceId=id.userId;}
    else if(id.channelId){resourceType='conversation';resourceId=id.channelId;channelId=id.channelId;}
    else{
     // Explicit server observation of a collection/page, not a fabricated native entity.
     resourceType=id.type==='users'?'user':'conversation';resourceId='$collection:'+tool+':'+computeSlackExecutionDigest(args.params);
     if(resourceType==='conversation')channelId=resourceId;
    }
    return {sourceRef:{binding:args.binding as SlackBinding,resourceType,resourceId,revision:p.nativeRevision??p.observationalDigest},acquisitionPolicyRef:ref,storagePolicyRef:validateSlackPolicyReference(storage.policyReference),captureHash:p.observationalDigest,capturedAt:p.observedAt,...(channelId?{channelId}:{})};
   });
   context?.signal?.throwIfAborted();
   this.evidence.set(data as object,{digest:computeSlackExecutionDigest(data),segments});return data;
  }};
 }
 async persist(id:string,output:unknown,snapshot:SlackExecutionSnapshot,stepId:string,signal?:AbortSignal){
  if(!output||typeof output!=='object')throw new Error('SLACK_READ_PROVENANCE_REQUIRED');
  const proof=this.evidence.get(output);
  if(!proof||proof.digest!==computeSlackExecutionDigest(output))throw new Error('SLACK_READ_PROVENANCE_REQUIRED');
  await this.assertApproval(snapshot,signal);
  const row=await this.options.steps.updateSlackReadResult(id,output,proof.segments,{userId:snapshot.userId,planHash:snapshot.planHash,stepId},signal);
  this.evidence.delete(output);return row;
 }
}
